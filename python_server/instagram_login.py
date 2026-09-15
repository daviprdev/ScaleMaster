"""
AutoScale — Login automatizado via instagrapi (API privada do app mobile).

Substitui o clique manual em contas que já existem (hoje feito com o
MoreLogin), mantendo o mesmo isolamento por conta: device fingerprint
determinístico + proxy dedicado — só que falando direto com a API privada
que o app Android usa, sem abrir navegador nenhum.
"""

import random
import uuid as uuid_lib

from instagrapi import Client
from instagrapi.exceptions import (
    BadPassword,
    ChallengeRequired,
    ClientConnectionError,
    ClientError,
    ClientThrottledError,
    FeedbackRequired,
    PleaseWaitFewMinutes,
    RateLimitError,
    TwoFactorRequired,
)

# ---------------------------------------------------------------------------
# Device determinístico por conta — gerado uma única vez (primeira tentativa
# de login) e reutilizado pra sempre depois disso. Mesmo princípio do
# _account_color_params em main.py (seed determinístico por conta via hash),
# aplicado aqui a device fingerprint em vez de cor de vídeo.
# ---------------------------------------------------------------------------

_DEVICE_POOL: list[dict] = [
    {"manufacturer": "samsung", "device": "beyond1", "model": "SM-G973F", "cpu": "exynos9820",
     "android_version": 29, "android_release": "10.0", "dpi": "480dpi", "resolution": "1080x2220"},
    {"manufacturer": "samsung", "device": "beyond2", "model": "SM-G975F", "cpu": "exynos9820",
     "android_version": 28, "android_release": "9.0", "dpi": "420dpi", "resolution": "1080x2280"},
    {"manufacturer": "OnePlus", "device": "OnePlus6T", "model": "ONEPLUS A6013", "cpu": "qcom",
     "android_version": 26, "android_release": "8.0.0", "dpi": "480dpi", "resolution": "1080x1920"},
    {"manufacturer": "OnePlus", "device": "OnePlus7", "model": "GM1903", "cpu": "qcom",
     "android_version": 29, "android_release": "10.0", "dpi": "440dpi", "resolution": "1080x2340"},
    {"manufacturer": "Xiaomi", "device": "curtana", "model": "Redmi Note 8", "cpu": "qcom",
     "android_version": 28, "android_release": "9.0", "dpi": "440dpi", "resolution": "1080x2340"},
    {"manufacturer": "google", "device": "walleye", "model": "Pixel 2", "cpu": "qcom",
     "android_version": 28, "android_release": "9.0", "dpi": "420dpi", "resolution": "1080x1920"},
    {"manufacturer": "motorola", "device": "payton", "model": "Moto G (5) Plus", "cpu": "qcom",
     "android_version": 25, "android_release": "7.1.1", "dpi": "400dpi", "resolution": "1080x1920"},
    {"manufacturer": "LGE/lge", "device": "judyln", "model": "LM-Q710(FGN)", "cpu": "qcom",
     "android_version": 28, "android_release": "9.0", "dpi": "480dpi", "resolution": "1080x2160"},
]

# app_version, version_code, bloks_versioning_id — as 3 triplas precisam bater
# exatamente com o que o instagrapi conhece (instagrapi/config.py APP_SETTINGS);
# combos inventados deixam bloks_versioning_id vazio e o login falha com
# "Client.bloks_versioning_id is empty (hash is expected)".
#
# 2026-09-15: o Instagram passou a recusar login de versões antigas do app
# ("Sua versão do Instagram está desatualizada") — 364/385/428 foram
# rejeitadas. Fica SÓ a versão mais nova que o instagrapi instalado conhece
# (3.0.2 → 446). Um aparelho real atualiza o app; isso não é troca de device.
# Ao subir o instagrapi, trocar esta tripla pela DEFAULT_APP_VERSION nova.
_APP_VERSIONS: list[tuple[str, str, str]] = [
    ("446.0.0.49.77", "385211303", "935a519904e9017324cdedb64a283a3c2c1a3d5b0bbc698b451f5aef72cc11df"),
]


def refresh_app_version(settings: dict) -> dict:
    """
    Atualiza SÓ a versão do app numa sessão salva (mantém uuids, modelo,
    país e cookies). Sessões gravadas com versão antiga seriam recusadas pelo
    Instagram no próximo login/relogin — equivalente a o usuário atualizar o
    app no mesmo celular.
    """
    app_version, version_code, bloks_versioning_id = _APP_VERSIONS[0]
    device = dict(settings.get("device_settings") or {})
    device["app_version"] = app_version
    device["version_code"] = version_code
    device["bloks_versioning_id"] = bloks_versioning_id
    updated = dict(settings)
    updated["device_settings"] = device
    # user_agent salvo embute a versão antiga; o instagrapi o regenera a
    # partir de device_settings quando ausente.
    updated.pop("user_agent", None)
    return updated


def _seeded_uuid(rng: random.Random) -> str:
    return str(uuid_lib.UUID(bytes=bytes(rng.getrandbits(8) for _ in range(16))))


# country ISO2 -> (locale, country_code discagem, timezone_offset em segundos).
# A doc oficial do instagrapi (best-practices) é explícita: "Match set_country,
# set_locale, device settings ... to the account's normal environment" — um
# device dizendo país X enquanto conecta por IP de país Y é um sinal clássico
# de account-takeover/bot pro risk engine da Meta. Antes disso era sempre
# BR/pt_BR fixo, descasado sempre que o proxy de teste não era brasileiro.
_COUNTRY_MAP: dict[str, tuple[str, int, int]] = {
    "BR": ("pt_BR", 55, -10800),
    "US": ("en_US", 1, -18000),
    "DE": ("de_DE", 49, 3600),
    "PT": ("pt_PT", 351, 0),
    "GB": ("en_GB", 44, 0),
    "FR": ("fr_FR", 33, 3600),
    "ES": ("es_ES", 34, 3600),
    "MX": ("es_MX", 52, -21600),
    "AR": ("es_AR", 54, -10800),
    "CA": ("en_CA", 1, -18000),
    "IT": ("it_IT", 39, 3600),
    "NL": ("nl_NL", 31, 3600),
    "PL": ("pl_PL", 48, 3600),
}
_DEFAULT_COUNTRY = "BR"


def _lookup_proxy_geo(cl: Client) -> tuple[str, str]:
    """IP + país ISO2 de saída do proxy, via a mesma sessão HTTP do login.
    Fallback pro país default se a lookup falhar (proxy instável, bloqueado
    etc.) — nunca deixa perform_login travar por causa disso."""
    try:
        data = cl.public.get("https://ipinfo.io/json", timeout=10).json()
        ip = str(data.get("ip") or "")
        country = str(data.get("country") or "").upper()
        return ip, country
    except Exception as e:
        return f"erro ao checar IP: {e}", ""


def build_deterministic_settings(device_seed: str, country_iso2: str = _DEFAULT_COUNTRY) -> dict:
    """Settings dict completo (device + uuids) determinístico a partir de device_seed."""
    rng = random.Random(device_seed)
    device = dict(rng.choice(_DEVICE_POOL))
    app_version, version_code, bloks_versioning_id = rng.choice(_APP_VERSIONS)
    device["app_version"] = app_version
    device["version_code"] = version_code
    device["bloks_versioning_id"] = bloks_versioning_id

    locale, country_code, timezone_offset = _COUNTRY_MAP.get(
        country_iso2, _COUNTRY_MAP[_DEFAULT_COUNTRY]
    )

    return {
        "uuids": {
            "phone_id": _seeded_uuid(rng),
            "uuid": _seeded_uuid(rng),
            "client_session_id": _seeded_uuid(rng),
            "advertising_id": _seeded_uuid(rng),
            "device_id": "android-" + "".join(rng.choice("0123456789abcdef") for _ in range(16)),
        },
        "device_settings": device,
        "country": country_iso2 if country_iso2 in _COUNTRY_MAP else _DEFAULT_COUNTRY,
        "country_code": country_code,
        "locale": locale,
        "timezone_offset": timezone_offset,
    }


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


class LoginResult:
    def __init__(self, success: bool, **kwargs):
        self.success = success
        self.data = kwargs


def _classify_error(exc: Exception) -> tuple[str, str]:
    """
    Mapeia qualquer exceção do instagrapi (tipada ou não) para um dos
    error_code estáveis que o cron sabe interpretar — mesma filosofia de
    match por texto já usada no resto do projeto (isAccountDeadError etc.),
    já que a tipagem de exceções do instagrapi varia entre versões.
    """
    msg = str(exc)
    lower = msg.lower()

    # Versão do app recusada pelo Instagram — retry não resolve; precisa
    # atualizar _APP_VERSIONS/instagrapi. Erro explícito em vez de backoff
    # silencioso (a UI ficava "conectando…" para sempre).
    if "desatualizada" in lower or "outdated" in lower or "update your app" in lower or "atualize seu aplicativo" in lower:
        return "app_outdated", msg

    # AccountSuspended (instagrapi >= algumas versões 2.x, ausente em outras —
    # detectado por nome da classe em vez de import direto pra não quebrar em
    # versões sem ela) é um ChallengeRequired cujo challenge.url contém
    # "/suspended/". A mensagem da exceção em si continua sendo o texto genérico
    # "challenge_required" — o sinal real de suspensão está só na URL do
    # challenge, carregada como atributo (ClientError guarda todo **last_json
    # como atributos da instância). Sem esse check aqui, cai no branch de
    # checkpoint_required (transitório) e fica em backoff pra sempre numa conta
    # que a própria Meta já baniu — nunca vai resolver sozinho com retry.
    challenge_url = ""
    challenge_data = getattr(exc, "challenge", None)
    if isinstance(challenge_data, dict):
        challenge_url = str(challenge_data.get("url") or challenge_data.get("api_path") or "")
    if type(exc).__name__ == "AccountSuspended" or "/suspended/" in challenge_url:
        return "banned_or_disabled", f"Conta suspensa pelo Instagram — {msg} (challenge_url={challenge_url})"

    if isinstance(exc, BadPassword) or "the password you entered" in lower:
        return "bad_password", msg
    if isinstance(exc, ChallengeRequired) or "challenge_required" in lower:
        return "checkpoint_required", msg
    if isinstance(exc, TwoFactorRequired) or "two_factor_required" in lower:
        return "checkpoint_required", msg
    if (
        isinstance(exc, (RateLimitError, ClientThrottledError, PleaseWaitFewMinutes))
        or "please wait a few minutes" in lower
        or "too many requests" in lower
    ):
        return "rate_limited", msg
    if "disabled" in lower or "suspended" in lower or "user_has_logged_out" in lower:
        return "banned_or_disabled", msg
    if isinstance(exc, ClientConnectionError) or "proxy" in lower or "connection" in lower or "timeout" in lower:
        return "network_error", msg
    if isinstance(exc, (FeedbackRequired, ClientError)):
        return "unknown", msg
    return "unknown", msg


def authenticate_client(
    cl: Client,
    username: str,
    password: str,
    totp_secret: str | None,
    proxy_ip: str,
    proxy_country: str,
    settings: dict,
    build: str,
) -> tuple[str, str] | None:
    """
    Executa login + auto-resolve de challenge numa Client JÁ configurada
    (proxy + settings aplicados pelo chamador). Retorna None em sucesso, ou
    (error_code, error_message) em falha.

    Extraído de perform_login para ser compartilhado com a raspagem
    (instagram_scraper.fetch_user_reels), que precisa reconectar quando a
    sessão salva expira — sem duplicar a lógica delicada de challenge_resolve.
    """
    verification_code = ""
    if totp_secret:
        import pyotp

        verification_code = pyotp.TOTP(totp_secret).now()

    # A lib nunca deve bloquear esperando input() num servidor headless — os
    # handlers padrão (manual_input_code / manual_change_password) fazem
    # exatamente isso. Sobrescritos para falhar rápido (retornar vazio) sempre
    # que o challenge realmente exigir código de email/SMS ou nova senha —
    # esses casos exigem acesso humano à conta e não são automatizáveis aqui.
    cl.challenge_code_handler = lambda _username, _choice=None: ""
    cl.change_password_handler = lambda _username: ""

    geo = proxy_country or settings.get("country")

    try:
        cl.login(username, password, verification_code=verification_code, relogin=False)
    except ChallengeRequired:
        # Alguns challenges de "dispositivo/local novo" (delta_login_review,
        # scraping_warning, add_birthday, step vazio) são resolvidos sozinhos
        # pela própria lib via challenge_resolve, sem precisar de código —
        # equivalente ao "Fui eu" que o app mostra. Só os que realmente
        # exigem código (email/SMS) ou ação manual continuam falhando aqui,
        # graças aos handlers fail-fast acima.
        try:
            cl.challenge_resolve(cl.last_json)
        except Exception as challenge_exc:
            import traceback

            error_code, error_message = _classify_error(challenge_exc)
            tb = traceback.format_exc(limit=4).replace("\n", " | ")
            return error_code, f"[{build}][proxy_ip={proxy_ip}][geo={geo}][resolve_fail] {error_message} :: {tb}"[:500]
        try:
            cl.relogin()
        except Exception as relogin_exc:
            error_code, error_message = _classify_error(relogin_exc)
            return error_code, f"[{build}][proxy_ip={proxy_ip}][geo={geo}][pos_challenge] {error_message}"[:500]
    except Exception as exc:  # instagrapi lança tipos variados conforme a versão
        error_code, error_message = _classify_error(exc)
        return error_code, f"[{build}][proxy_ip={proxy_ip}][geo={geo}][{type(exc).__name__}] {error_message}"[:500]

    return None


def perform_login(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    totp_secret: str | None = None,
    existing_settings: dict | None = None,
) -> LoginResult:
    cl = Client()
    cl.delay_range = [1, 3]
    cl.set_proxy(proxy_url)

    # IP + país de saída do proxy, via a mesma sessão HTTP que faz o login.
    # Numa conta nova (sem existing_settings), o país detectado decide
    # country/locale/timezone do device — nunca fixo em BR indepenente do
    # proxy, que descasava dispositivo x geografia e é sinal de bot pro risk
    # engine da Meta (ver _COUNTRY_MAP acima). Numa relogin (existing_settings
    # presente), a geografia do device já foi fixada no primeiro login e não é
    # reavaliada aqui — mudar identidade de device em sessões já estabelecidas
    # é o que a doc do instagrapi orienta a NUNCA fazer.
    proxy_ip, proxy_country = _lookup_proxy_geo(cl)

    settings = (
        refresh_app_version(existing_settings)
        if existing_settings
        else build_deterministic_settings(device_seed, proxy_country)
    )
    cl.set_settings(settings)

    # Marcador de build — prefixado em toda mensagem de erro retornada por esta
    # função. Só serve pra confirmar, sem ambiguidade, se este código (versão
    # com auto-resolve de challenge) está mesmo rodando no worker no momento
    # do teste, sem depender do que o painel do Railway mostra como "deploy
    # mais recente" (que pode estar com o build ainda não substituído no ar).
    BUILD = "chgv3"

    err = authenticate_client(
        cl, username, password, totp_secret, proxy_ip, proxy_country, settings, BUILD
    )
    if err is not None:
        error_code, error_message = err
        return LoginResult(False, error_code=error_code, error_message=error_message)

    try:
        info = cl.account_info()
    except Exception:
        info = None

    return LoginResult(
        True,
        settings=cl.get_settings(),
        ig_user_id=str(cl.user_id),
        username=username,
        full_name=(getattr(info, "full_name", None) if info else None),
        profile_pic_url=(str(getattr(info, "profile_pic_url", "") or "") if info else None),
        followers_count=(getattr(info, "follower_count", None) if info else None),
        media_count=(getattr(info, "media_count", None) if info else None),
    )
