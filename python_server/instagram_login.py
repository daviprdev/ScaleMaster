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
_APP_VERSIONS: list[tuple[str, str, str]] = [
    ("428.0.0.47.67", "961145276", "7189b949425f9bf80ea8bd880cf5a3080b292d9b1c4b38a18d112f7c4b71e7a8"),
    ("364.0.0.35.86", "374010953", "8ccf54aad76788a6ca03ddfc33afcdcf692f2f5a3ba814ea73d5facba7fa2c2d"),
    ("385.0.0.47.74", "378906843", "a8973d49a9cc6a6f65a4997c10216ce2a06f65a517010e64885e92029bb19221"),
]


def _seeded_uuid(rng: random.Random) -> str:
    return str(uuid_lib.UUID(bytes=bytes(rng.getrandbits(8) for _ in range(16))))


def build_deterministic_settings(device_seed: str) -> dict:
    """Settings dict completo (device + uuids) determinístico a partir de device_seed."""
    rng = random.Random(device_seed)
    device = dict(rng.choice(_DEVICE_POOL))
    app_version, version_code, bloks_versioning_id = rng.choice(_APP_VERSIONS)
    device["app_version"] = app_version
    device["version_code"] = version_code
    device["bloks_versioning_id"] = bloks_versioning_id

    return {
        "uuids": {
            "phone_id": _seeded_uuid(rng),
            "uuid": _seeded_uuid(rng),
            "client_session_id": _seeded_uuid(rng),
            "advertising_id": _seeded_uuid(rng),
            "device_id": "android-" + "".join(rng.choice("0123456789abcdef") for _ in range(16)),
        },
        "device_settings": device,
        "country": "BR",
        "country_code": 55,
        "locale": "pt_BR",
        "timezone_offset": -10800,
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

    settings = existing_settings or build_deterministic_settings(device_seed)
    cl.set_settings(settings)
    cl.set_proxy(proxy_url)

    # Diagnóstico temporário — confirma se o proxy está realmente sendo usado
    # pela sessão do instagrapi (mesmo cliente HTTP que faz o login) antes de
    # investigar mais a fundo o 429 recorrente no /accounts/login/.
    try:
        proxy_ip = cl.public.get("https://api.ipify.org?format=json", timeout=10).json().get("ip")
    except Exception as e:
        proxy_ip = f"erro ao checar IP: {e}"

    verification_code = ""
    if totp_secret:
        import pyotp

        verification_code = pyotp.TOTP(totp_secret).now()

    try:
        cl.login(username, password, verification_code=verification_code, relogin=False)
    except Exception as exc:  # instagrapi lança tipos variados conforme a versão
        error_code, error_message = _classify_error(exc)
        return LoginResult(False, error_code=error_code, error_message=f"[proxy_ip={proxy_ip}] {error_message}"[:500])

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
