"""
ScaleMaster - Onboarding automatizado de contas do Instagram (Fase Onboarding 1/3).

Etapas executadas aqui (uma chamada HTTP por etapa, orquestradas pelo cron
/api/cron/process-onboarding-jobs no Next.js):

  invite -> photo -> professional -> verify_professional -> magic_link

A etapa magic_link NAO roda aqui: o link magico e um fluxo OAuth do Instagram
Business Login que so funciona em conta Business/Creator. Por isso a conversao
para profissional (e a confirmacao dela) vem ANTES do link.

Mesmo isolamento por conta do login e da raspagem: device fingerprint
deterministico (device_seed) + proxy dedicado + sessao salva reaproveitada.
So faz login completo quando nao ha sessao salva ou quando ela expirou. A
identidade de device NUNCA e regerada numa sessao ja estabelecida.

Toda funcao publica devolve OnboardingResult com `settings` atualizados sempre
que chegou a ter um client autenticado - o chamador persiste e nao repete o
login no ciclo seguinte.
"""

import os
import tempfile
import uuid as uuid_lib
from pathlib import Path

import httpx
from instagrapi import Client

from instagram_login import (
    _classify_error,
    _lookup_proxy_geo,
    authenticate_client,
    build_deterministic_settings,
    refresh_app_version,
)

BUILD = "onbv1"

# accounts/current_user devolve account_type numerico.
_ACCOUNT_TYPES = {1: "PERSONAL", 2: "BUSINESS", 3: "CREATOR"}

_PHOTO_MAX_BYTES = 10 * 1024 * 1024


class OnboardingResult:
    def __init__(self, success: bool, **kwargs):
        self.success = success
        self.data = kwargs


def _tag(proxy_ip: str, geo: str | None) -> str:
    return f"[{BUILD}][proxy_ip={proxy_ip}][geo={geo}]"


def _prepare_client(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    totp_secret: str | None,
    existing_settings: dict | None,
):
    """
    Client pronto e autenticado. Retorna (cl, err, tag):
      - err None: sessao valida (reaproveitada ou login novo).
      - err (error_code, error_message): falha de autenticacao.
    """
    cl = Client()
    cl.delay_range = [1, 3]
    cl.set_proxy(proxy_url)

    proxy_ip, proxy_country = _lookup_proxy_geo(cl)
    settings = (
        refresh_app_version(existing_settings)
        if existing_settings
        else build_deterministic_settings(device_seed, proxy_country)
    )
    cl.set_settings(settings)
    tag = _tag(proxy_ip, proxy_country or settings.get("country"))

    # Com sessao salva, valida com um ping barato do proprio perfil (o mesmo
    # que o app faz ao abrir a tela de edicao). So loga de novo se morreu.
    need_login = existing_settings is None
    if not need_login:
        try:
            cl.private_request("accounts/current_user/?edit=true")
        except Exception:
            need_login = True

    if need_login:
        err = authenticate_client(
            cl, username, password, totp_secret, proxy_ip, proxy_country, settings, BUILD
        )
        if err is not None:
            return cl, err, tag

    return cl, None, tag


def _fail(cl: Client | None, tag: str, exc: Exception, authenticated: bool) -> OnboardingResult:
    error_code, error_message = _classify_error(exc)
    return OnboardingResult(
        False,
        error_code=error_code,
        error_message=f"{tag}[{type(exc).__name__}] {error_message}"[:500],
        settings=(cl.get_settings() if (cl is not None and authenticated) else None),
    )


def _read_account_type(cl: Client) -> tuple[str, bool]:
    """(account_type textual, is_professional) lido direto do payload cru."""
    raw = cl.private_request("accounts/current_user/?edit=true")
    user = (raw or {}).get("user") or {}
    code = user.get("account_type")
    try:
        code = int(code) if code is not None else None
    except (TypeError, ValueError):
        code = None
    if code in _ACCOUNT_TYPES:
        label = _ACCOUNT_TYPES[code]
        return label, label in ("BUSINESS", "CREATOR")
    # Sem account_type no payload: is_business cobre business e creator.
    if user.get("is_business") is True:
        return "PROFESSIONAL_UNKNOWN", True
    return "UNKNOWN", False


# ---------------------------------------------------------------------------
# Etapa invite
# ---------------------------------------------------------------------------

# Candidatos de endpoint para os convites de testador (Apps e sites ->
# Convites de testador). NAO HA ENDPOINT DOCUMENTADO: estes caminhos sao
# hipoteses a confirmar capturando o trafego real do app/web. Podem ser
# sobrescritos por env var sem novo deploy de codigo:
#   IG_TESTER_INVITES_LIST_URL   (GET, deve devolver JSON com a lista)
#   IG_TESTER_INVITE_ACCEPT_URL  (POST, aceita "{app_id}" como placeholder)
_INVITE_LIST_CANDIDATES = [
    "https://www.instagram.com/api/v1/oauth/tester_invites/",
    "https://i.instagram.com/api/v1/oauth/tester_invites/",
]
_INVITE_ACCEPT_CANDIDATES = [
    "https://www.instagram.com/api/v1/oauth/tester_invites/{app_id}/accept/",
    "https://i.instagram.com/api/v1/oauth/tester_invites/{app_id}/accept/",
]
# App ID publico do cliente web do Instagram (mesmo valor que o site envia).
_WEB_APP_ID = "936619743392459"


def _web_headers(cl: Client) -> dict:
    cookies = {
        "sessionid": cl.sessionid or "",
        "ds_user_id": str(cl.user_id or ""),
        "csrftoken": cl.token,
    }
    return {
        "User-Agent": cl.user_agent,
        "X-IG-App-ID": _WEB_APP_ID,
        "X-CSRFToken": cl.token,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.instagram.com/accounts/manage_access/",
        "Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items() if v),
    }


def _extract_invites(payload) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    for key in ("tester_invites", "invites", "pending_invites", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return [v for v in value if isinstance(v, dict)]
    return []


def _invite_app_id(invite: dict) -> str:
    for key in ("app_id", "application_id", "id"):
        if invite.get(key):
            return str(invite[key])
    app = invite.get("app") or invite.get("application")
    if isinstance(app, dict) and app.get("id"):
        return str(app["id"])
    return ""


def accept_app_invite(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    totp_secret: str | None = None,
    existing_settings: dict | None = None,
    app_id: str | None = None,
) -> OnboardingResult:
    """
    Busca e aceita o convite de testador do App Meta (o mesmo que o usuario
    aceita em Configuracoes -> Apps e sites -> Convites de testador).

    ETAPA MAIS FRAGIL DO PIPELINE. O Instagram nao documenta estes endpoints e
    o protocolo interno muda sem aviso (ja migrou para Bloks/GraphQL em outras
    telas). Os caminhos usados sao hipoteses a confirmar com captura de trafego
    real, sobrescreviveis por env var (ver _INVITE_LIST_CANDIDATES).

    O que esperar quando o protocolo nao bate:
      - Todos os candidatos devolvem 404, HTML (pagina de login/SPA) ou JSON
        sem lista reconhecivel -> success=False, error_code="needs_manual",
        com o status HTTP e um trecho da resposta em error_message. O cron grava
        a etapa como needs_manual (nao como erro transitorio) para o usuario
        aceitar o convite na mao e liberar o job.
      - 401/403 com sessao valida -> mesmo tratamento (endpoint exige outro
        tipo de autenticacao, provavelmente cookie web completo).
    Lista reconhecida e vazia -> success=True com accepted=[] e
    pending_found=0 (convite ja aceito ou ainda nao enviado).
    """
    cl, err, tag = _prepare_client(
        username, password, proxy_url, device_seed, totp_secret, existing_settings
    )
    if err is not None:
        return OnboardingResult(False, error_code=err[0], error_message=err[1])

    list_urls = [os.environ["IG_TESTER_INVITES_LIST_URL"]] if os.environ.get("IG_TESTER_INVITES_LIST_URL") else _INVITE_LIST_CANDIDATES
    accept_urls = [os.environ["IG_TESTER_INVITE_ACCEPT_URL"]] if os.environ.get("IG_TESTER_INVITE_ACCEPT_URL") else _INVITE_ACCEPT_CANDIDATES

    attempts: list[str] = []
    try:
        headers = _web_headers(cl)
        invites: list[dict] | None = None
        for url in list_urls:
            resp = cl.public.get(url, headers=headers, timeout=20, allow_redirects=False)
            ctype = resp.headers.get("content-type", "")
            if resp.status_code == 200 and "json" in ctype:
                payload = resp.json()
                if isinstance(payload, dict) and any(
                    k in payload for k in ("tester_invites", "invites", "pending_invites", "data")
                ):
                    invites = _extract_invites(payload)
                    break
            attempts.append(f"GET {url} -> {resp.status_code} {ctype.split(';')[0]} {resp.text[:80]!r}")

        if invites is None:
            return OnboardingResult(
                False,
                error_code="needs_manual",
                error_message=(f"{tag}[invite_protocol_unknown] " + " | ".join(attempts))[:500],
                settings=cl.get_settings(),
            )

        targets = [i for i in invites if not app_id or _invite_app_id(i) == str(app_id)]
        accepted: list[str] = []
        for invite in targets:
            invite_app_id = _invite_app_id(invite)
            if not invite_app_id:
                continue
            ok = False
            for template in accept_urls:
                url = template.replace("{app_id}", invite_app_id)
                resp = cl.public.post(
                    url,
                    headers=headers,
                    data={"app_id": invite_app_id},
                    timeout=20,
                    allow_redirects=False,
                )
                if resp.status_code == 200 and "json" in resp.headers.get("content-type", ""):
                    body = resp.json()
                    if not isinstance(body, dict) or body.get("status", "ok") == "ok":
                        ok = True
                        break
                attempts.append(f"POST {url} -> {resp.status_code} {resp.text[:80]!r}")
            if not ok:
                return OnboardingResult(
                    False,
                    error_code="needs_manual",
                    error_message=(f"{tag}[invite_accept_failed app_id={invite_app_id}] " + " | ".join(attempts))[:500],
                    settings=cl.get_settings(),
                )
            accepted.append(invite_app_id)

        return OnboardingResult(
            True,
            settings=cl.get_settings(),
            ig_user_id=(str(cl.user_id) if cl.user_id else None),
            accepted=accepted,
            pending_found=len(targets),
        )
    except Exception as exc:
        return _fail(cl, tag, exc, authenticated=True)


# ---------------------------------------------------------------------------
# Etapa photo
# ---------------------------------------------------------------------------


def _download_photo(photo_url: str) -> Path:
    """Baixa a imagem (sem seguir redirect, com teto de tamanho) e normaliza
    para JPEG RGB - formato que o photo_rupload aceita sem surpresa."""
    if not photo_url.lower().startswith(("https://", "http://")):
        raise ValueError("photo_url precisa ser http(s)")

    with httpx.Client(timeout=30.0, follow_redirects=False) as client:
        with client.stream("GET", photo_url) as resp:
            if resp.status_code != 200:
                raise ValueError(f"download da foto falhou: HTTP {resp.status_code}")
            ctype = resp.headers.get("content-type", "")
            if not ctype.startswith("image/"):
                raise ValueError(f"photo_url nao e imagem (content-type={ctype})")
            chunks: list[bytes] = []
            total = 0
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > _PHOTO_MAX_BYTES:
                    raise ValueError("foto maior que 10 MB")
                chunks.append(chunk)

    from io import BytesIO

    from PIL import Image

    img = Image.open(BytesIO(b"".join(chunks))).convert("RGB")
    path = Path(tempfile.gettempdir()) / f"onb_photo_{uuid_lib.uuid4().hex}.jpg"
    img.save(path, format="JPEG", quality=92)
    return path


def change_profile_photo(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    photo_url: str,
    totp_secret: str | None = None,
    existing_settings: dict | None = None,
) -> OnboardingResult:
    try:
        photo_path = _download_photo(photo_url)
    except Exception as exc:
        # Problema da foto, nao da conta: nem autentica.
        return OnboardingResult(False, error_code="invalid_photo", error_message=f"[{BUILD}] {exc}"[:500])

    try:
        cl, err, tag = _prepare_client(
            username, password, proxy_url, device_seed, totp_secret, existing_settings
        )
        if err is not None:
            return OnboardingResult(False, error_code=err[0], error_message=err[1])
        try:
            cl.account_change_picture(photo_path)
        except Exception as exc:
            return _fail(cl, tag, exc, authenticated=True)
        return OnboardingResult(
            True,
            settings=cl.get_settings(),
            ig_user_id=(str(cl.user_id) if cl.user_id else None),
        )
    finally:
        try:
            os.unlink(photo_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Etapas professional / verify_professional
# ---------------------------------------------------------------------------


def switch_to_professional(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    totp_secret: str | None = None,
    existing_settings: dict | None = None,
    to_account_type: int = 3,
) -> OnboardingResult:
    """
    Converte para conta profissional via business/account/convert_account/ (a
    mesma chamada que o app faz em Configuracoes -> Tipo de conta). Padrao:
    Creator (3). Idempotente: se a conta ja e profissional, nao chama de novo.
    """
    cl, err, tag = _prepare_client(
        username, password, proxy_url, device_seed, totp_secret, existing_settings
    )
    if err is not None:
        return OnboardingResult(False, error_code=err[0], error_message=err[1])

    try:
        account_type, is_professional = _read_account_type(cl)
        if not is_professional:
            cl.account_convert_to_professional(to_account_type=to_account_type if to_account_type in (2, 3) else 3)
            account_type, is_professional = _read_account_type(cl)
        return OnboardingResult(
            True,
            settings=cl.get_settings(),
            ig_user_id=(str(cl.user_id) if cl.user_id else None),
            account_type=account_type,
            is_professional=is_professional,
        )
    except Exception as exc:
        return _fail(cl, tag, exc, authenticated=True)


def check_professional(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    totp_secret: str | None = None,
    existing_settings: dict | None = None,
) -> OnboardingResult:
    """account_type atual do perfil (PERSONAL/BUSINESS/CREATOR). A propagacao
    da conversao pode levar minutos - o cron faz polling a cada ciclo."""
    cl, err, tag = _prepare_client(
        username, password, proxy_url, device_seed, totp_secret, existing_settings
    )
    if err is not None:
        return OnboardingResult(False, error_code=err[0], error_message=err[1])

    try:
        account_type, is_professional = _read_account_type(cl)
        return OnboardingResult(
            True,
            settings=cl.get_settings(),
            ig_user_id=(str(cl.user_id) if cl.user_id else None),
            account_type=account_type,
            is_professional=is_professional,
        )
    except Exception as exc:
        return _fail(cl, tag, exc, authenticated=True)


# ---------------------------------------------------------------------------
# Etapa story
# ---------------------------------------------------------------------------

_MEDIA_MAX_BYTES = 100 * 1024 * 1024  # 100 MB para video


def _download_media(media_url: str) -> tuple[Path, str]:
    """Baixa a midia (foto ou video) e retorna (path, media_type).
    media_type é 'photo' ou 'video' baseado no content-type."""
    if not media_url.lower().startswith(("https://", "http://")):
        raise ValueError("media_url precisa ser http(s)")

    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        with client.stream("GET", media_url) as resp:
            if resp.status_code != 200:
                raise ValueError(f"download da midia falhou: HTTP {resp.status_code}")
            ctype = resp.headers.get("content-type", "")
            if ctype.startswith("video/"):
                media_type = "video"
            elif ctype.startswith("image/"):
                media_type = "photo"
            else:
                raise ValueError(f"media_url nao e imagem nem video (content-type={ctype})")

            chunks: list[bytes] = []
            total = 0
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > _MEDIA_MAX_BYTES:
                    raise ValueError("midia maior que 100 MB")
                chunks.append(chunk)

    ext = ".mp4" if media_type == "video" else ".jpg"
    path = Path(tempfile.gettempdir()) / f"onb_story_{uuid_lib.uuid4().hex}{ext}"
    path.write_bytes(b"".join(chunks))

    # Se for foto, normaliza para JPEG RGB
    if media_type == "photo":
        from io import BytesIO
        from PIL import Image
        img = Image.open(BytesIO(path.read_bytes())).convert("RGB")
        jpg_path = path.with_suffix(".jpg")
        img.save(jpg_path, format="JPEG", quality=92)
        path.unlink()
        path = jpg_path

    return path, media_type


def post_story_with_link(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    media_url: str,
    link_url: str,
    totp_secret: str | None = None,
    existing_settings: dict | None = None,
) -> OnboardingResult:
    """Posta um story com foto/video e adiciona um sticker de link externo.
    Retorna o story_pk para uso na etapa highlight."""
    try:
        media_path, media_type = _download_media(media_url)
    except Exception as exc:
        return OnboardingResult(False, error_code="invalid_media", error_message=f"[{BUILD}] {exc}"[:500])

    try:
        cl, err, tag = _prepare_client(
            username, password, proxy_url, device_seed, totp_secret, existing_settings
        )
        if err is not None:
            return OnboardingResult(False, error_code=err[0], error_message=err[1])

        try:
            from instagrapi.types import StoryLink

            # Cria o sticker de link
            link_sticker = StoryLink(webUri=link_url)

            # Upload conforme o tipo de midia
            if media_type == "video":
                story = cl.video_upload_to_story(media_path, links=[link_sticker])
            else:
                story = cl.photo_upload_to_story(media_path, links=[link_sticker])

            story_pk = str(story.pk) if story.pk else None
            if not story_pk:
                return OnboardingResult(
                    False,
                    error_code="story_no_pk",
                    error_message=f"{tag} Story postado mas sem pk retornado.",
                    settings=cl.get_settings(),
                )

            return OnboardingResult(
                True,
                settings=cl.get_settings(),
                ig_user_id=(str(cl.user_id) if cl.user_id else None),
                story_pk=story_pk,
            )
        except Exception as exc:
            return _fail(cl, tag, exc, authenticated=True)
    finally:
        try:
            os.unlink(media_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Etapa highlight
# ---------------------------------------------------------------------------


def create_highlight_from_story(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    story_pk: str,
    highlight_title: str,
    totp_secret: str | None = None,
    existing_settings: dict | None = None,
) -> OnboardingResult:
    """Cria um destaque a partir do story postado na etapa anterior."""
    cl, err, tag = _prepare_client(
        username, password, proxy_url, device_seed, totp_secret, existing_settings
    )
    if err is not None:
        return OnboardingResult(False, error_code=err[0], error_message=err[1])

    try:
        highlight = cl.highlight_create(
            title=highlight_title,
            story_ids=[story_pk],
            cover_story_id=story_pk,
        )
        highlight_pk = str(highlight.pk) if highlight.pk else None

        return OnboardingResult(
            True,
            settings=cl.get_settings(),
            ig_user_id=(str(cl.user_id) if cl.user_id else None),
            highlight_pk=highlight_pk,
        )
    except Exception as exc:
        return _fail(cl, tag, exc, authenticated=True)
