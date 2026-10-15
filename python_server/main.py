"""
AutoScale Railway Worker — FastAPI
Responsável pelo processamento pesado de vídeo (FFmpeg) e pelo login
automatizado de contas Instagram via instagrapi, fora da Vercel.

Endpoints:
  POST /video/effects       — aplica efeitos de vídeo e faz upload para Supabase
  POST /instagram/login     — login automatizado via instagrapi (device + proxy dedicados)
  POST /onboarding/*         — etapas do onboarding automatizado (onboarding.py)
  POST /test-browser-login   — login via navegador (Playwright), motor paralelo ao instagrapi
  GET  /health               — liveness check para Railway
"""

import asyncio
import os
import subprocess
import tempfile
import uuid

import httpx
from fastapi import Depends, FastAPI, HTTPException, Header
from pydantic import BaseModel

from instagram_login import perform_login
from instagram_scraper import fetch_user_reels
import session_store
from browser_engine import STATUS_CHECKPOINT, STATUS_SUCCESS, STATUS_WRONG_PASSWORD, browser_login
from magic_link import complete_magic_link
from onboarding import (
    accept_app_invite,
    change_profile_photo,
    check_professional,
    create_highlight_from_story,
    post_story_with_link,
    switch_to_professional,
)
# onboarding_rpa removido no refactor 294a242 — fluxo RPA descontinuado.
# Os endpoints de scraping, vídeo e browser login permanecem ativos.

# ---------------------------------------------------------------------------
# Config — lidas na inicialização; crash imediato se ausentes
# ---------------------------------------------------------------------------

app = FastAPI(title="AutoScale Railway Worker", version="1.0.0", redirect_slashes=False)

SUPABASE_URL: str = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SERVER_SECRET: str = os.environ.get("PYTHON_SERVER_SECRET", "")
BUCKET: str = "videos-library"

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def verify_secret(authorization: str | None = Header(default=None)) -> None:
    """Fail-closed: se PYTHON_SERVER_SECRET não estiver definido, rejeita
    todas as requisições em vez de abrir os endpoints silenciosamente."""
    if not SERVER_SECRET:
        raise HTTPException(status_code=503, detail="PYTHON_SERVER_SECRET não configurado")
    if authorization != f"Bearer {SERVER_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def verify_secret_strict(authorization: str | None = Header(default=None)) -> None:
    """Fail-closed: endpoints que recebem senha e devolvem screenshot da conta
    nunca ficam abertos, mesmo se PYTHON_SERVER_SECRET não estiver definido."""
    if not SERVER_SECRET:
        raise HTTPException(status_code=503, detail="PYTHON_SERVER_SECRET não configurado")
    if authorization != f"Bearer {SERVER_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class VideoEffectsRequest(BaseModel):
    video_url: str
    account_id: str = ""
    mirror: bool = False
    invert: bool = False
    zoom: bool = False
    blur: bool = False
    noise: bool = False
    anti_ai: bool = False


class VideoEffectsResponse(BaseModel):
    url: str


class InstagramLoginRequest(BaseModel):
    username: str
    password: str
    proxy_url: str
    device_seed: str
    totp_secret: str | None = None
    existing_settings: dict | None = None


class InstagramLoginResponse(BaseModel):
    success: bool
    settings: dict | None = None
    ig_user_id: str | None = None
    username: str | None = None
    full_name: str | None = None
    profile_pic_url: str | None = None
    followers_count: int | None = None
    media_count: int | None = None
    error_code: str | None = None
    error_message: str | None = None


class ScrapeProfileRequest(BaseModel):
    # Credenciais da conta LEITORA (pool separado das contas de postagem).
    username: str
    password: str
    proxy_url: str
    device_seed: str
    totp_secret: str | None = None
    existing_settings: dict | None = None
    # Perfil-alvo a raspar + limite de itens (0 = TODOS os reels do perfil).
    target_username: str
    limit: int = 0
    # Freio de tempo da paginação: estourado, devolve o que já coletou com
    # truncated=True (o chamador tem timeout HTTP próprio, menor que o do
    # Railway — é ele quem define este valor).
    time_budget_seconds: int = 100


class ScrapeProfileResponse(BaseModel):
    success: bool
    settings: dict | None = None
    ig_user_id: str | None = None
    reels: list[dict] | None = None
    result_count: int | None = None
    # True quando a paginação parou por orçamento de tempo / teto de páginas —
    # o perfil tem mais reels do que os devolvidos.
    truncated: bool | None = None
    error_code: str | None = None
    error_message: str | None = None


class OnboardingRequest(BaseModel):
    # Credenciais da conta em onboarding + sessao salva (reconecta sem logar).
    username: str
    password: str
    proxy_url: str
    device_seed: str
    totp_secret: str | None = None
    session_settings: dict | None = None


class AcceptInviteRequest(OnboardingRequest):
    app_id: str | None = None


class ChangePhotoRequest(OnboardingRequest):
    photo_url: str


class SwitchProfessionalRequest(OnboardingRequest):
    to_account_type: int = 3


class PostStoryRequest(OnboardingRequest):
    media_url: str
    link_url: str


class CreateHighlightRequest(OnboardingRequest):
    story_pk: str
    highlight_title: str


class OnboardingResponse(BaseModel):
    success: bool
    session_settings: dict | None = None
    ig_user_id: str | None = None
    account_type: str | None = None
    is_professional: bool | None = None
    accepted: list[str] | None = None
    pending_found: int | None = None
    story_pk: str | None = None
    highlight_pk: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class BrowserLoginRequest(BaseModel):
    username: str
    password: str
    # Objeto {server, username, password} ou string (URL / host:porta:user:pass).
    proxy: dict | str
    totp_secret: str | None = None
    # Dono da conta no SaaS — necessário para carregar/salvar a sessão.
    user_id: str | None = None
    use_saved_session: bool = True
    save_session: bool = True
    headless: bool | None = None
    include_screenshot: bool = True


class BrowserLoginResponse(BaseModel):
    status: str
    message: str
    screenshot: str | None = None
    session_saved: bool = False
    session_reused: bool = False
    session_note: str | None = None
    checkpoint: dict | None = None
    proxy_ip: str | None = None
    proxy_country: str | None = None
    elapsed_ms: int = 0
    attempt_log: list[dict] = []


class MagicLinkRequest(BaseModel):
    # URL /add/{token} do proprio SaaS.
    magic_url: str
    username: str
    # Objeto {server, username, password} ou string (URL / host:porta:user:pass).
    proxy: dict | str
    # Sessao instagrapi gravada pelas etapas anteriores do onboarding.
    session_settings: dict | None = None
    device_seed: str | None = None
    # Dono da conta no SaaS - necessario para ler/gravar a sessao de navegador.
    user_id: str | None = None
    use_saved_session: bool = True
    save_session: bool = True
    headless: bool | None = None
    include_screenshot: bool = True


class MagicLinkResponse(BaseModel):
    status: str
    message: str
    screenshot: str | None = None
    checkpoint: dict | None = None
    final_url: str | None = None
    authorized_click: bool = False
    session_saved: bool = False
    session_note: str | None = None
    proxy_ip: str | None = None
    proxy_country: str | None = None
    elapsed_ms: int = 0
    attempt_log: list[dict] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fnv1_hash(s: str) -> int:
    """FNV-1 32-bit hash — mesma implementação do video-effects.ts."""
    h = 0x811C9DC5
    for c in s:
        h ^= ord(c)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _account_color_params(account_id: str) -> tuple[float, float, float]:
    h = _fnv1_hash(account_id)
    contrast   = 1.005 + (h % 11) * 0.001
    brightness = 0.002 + ((h >> 4) % 8) * 0.001
    saturation = 1.005 + ((h >> 8) % 11) * 0.001
    return contrast, brightness, saturation


def _build_vf_chain(req: VideoEffectsRequest) -> list[str]:
    parts: list[str] = []
    if req.mirror:
        parts.append("hflip")
    if req.invert:
        parts.append("negate")
    if req.zoom:
        parts.append(
            "scale=iw*115/100:ih*115/100,"
            "crop=iw*100/115:ih*100/115:(iw-iw*100/115)/2:(ih-ih*100/115)/2"
        )
    if req.blur:
        parts.append("smartblur=lr=1:ls=0.25:lt=0")
    if req.noise:
        parts.append("noise=c0s=3:c0f=t+u")
    if req.anti_ai:
        contrast, brightness, saturation = _account_color_params(req.account_id)
        parts.append(
            f"eq=contrast={contrast:.4f}:brightness={brightness:.4f}:saturation={saturation:.4f}"
        )
    return parts


def _upload_to_supabase(storage_path: str, file_bytes: bytes) -> str:
    """
    Faz upload para Supabase Storage via REST API diretamente com httpx.
    Não usa supabase-py — funciona com qualquer formato de chave (sb_secret_*, eyJ*, etc).
    """
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "video/mp4",
    }
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(upload_url, content=file_bytes, headers=headers)
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Supabase upload falhou: HTTP {resp.status_code} — {resp.text[:300]}"
            )

    # URL pública é determinística — não precisa de chamada adicional
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storage_path}"


def _process_effects_sync(req: VideoEffectsRequest) -> str:
    """
    Pipeline bloqueante: download → FFmpeg → upload Supabase → URL pública.
    Executado em thread separada via asyncio.to_thread para não bloquear o event loop.
    """
    uid = str(uuid.uuid4())
    tmp = tempfile.gettempdir()
    input_path  = os.path.join(tmp, f"vfx_in_{uid}.mp4")
    output_path = os.path.join(tmp, f"vfx_out_{uid}.mp4")

    try:
        # ── 1. Download ────────────────────────────────────────────────────────
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            resp = client.get(req.video_url)
            if resp.status_code != 200:
                raise RuntimeError(f"Download falhou: HTTP {resp.status_code}")
            with open(input_path, "wb") as f:
                f.write(resp.content)

        # ── 2. Monta filtros ───────────────────────────────────────────────────
        vf_parts = _build_vf_chain(req)
        cmd = ["ffmpeg", "-y", "-i", input_path]
        if vf_parts:
            cmd += ["-vf", ",".join(vf_parts)]
        cmd += [
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            "-c:a", "copy",
            "-map_metadata", "-1",
            "-map_chapters", "-1",
            "-movflags", "+faststart",
            "-f", "mp4",
            output_path,
        ]

        # ── 3. Executa FFmpeg ─────────────────────────────────────────────────
        result = subprocess.run(cmd, capture_output=True, timeout=240)
        if result.returncode != 0:
            stderr_tail = result.stderr.decode(errors="replace")[-600:]
            raise RuntimeError(f"FFmpeg erro (code {result.returncode}): {stderr_tail}")

        # ── 4. Upload para Supabase Storage ───────────────────────────────────
        storage_path = f"temp/vfx_{uid}.mp4"
        with open(output_path, "rb") as f:
            file_bytes = f.read()

        public_url = _upload_to_supabase(storage_path, file_bytes)

        active_fx = "+".join(
            label for label, active in [
                ("mirror",   req.mirror),
                ("invert",   req.invert),
                ("zoom",     req.zoom),
                ("blur",     req.blur),
                ("noise",    req.noise),
                ("anti_ai",  req.anti_ai),
            ] if active
        )
        print(
            f"[video-effects] ✓ efeitos [{active_fx}] | "
            f"{len(file_bytes) / 1_048_576:.1f} MB → {storage_path}"
        )

        return public_url

    finally:
        for p in [input_path, output_path]:
            try:
                os.unlink(p)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/video/effects", response_model=VideoEffectsResponse)
@app.post("/video/effects/", response_model=VideoEffectsResponse, include_in_schema=False)
async def video_effects(
    req: VideoEffectsRequest,
    _: None = Depends(verify_secret),
) -> VideoEffectsResponse:
    any_effect = req.mirror or req.invert or req.zoom or req.blur or req.noise or req.anti_ai
    if not any_effect:
        return VideoEffectsResponse(url=req.video_url)

    try:
        url = await asyncio.to_thread(_process_effects_sync, req)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return VideoEffectsResponse(url=url)


@app.post("/instagram/login", response_model=InstagramLoginResponse)
async def instagram_login(
    req: InstagramLoginRequest,
    _: None = Depends(verify_secret),
) -> InstagramLoginResponse:
    result = await asyncio.to_thread(
        perform_login,
        req.username,
        req.password,
        req.proxy_url,
        req.device_seed,
        req.totp_secret,
        req.existing_settings,
    )
    return InstagramLoginResponse(success=result.success, **result.data)


@app.post("/instagram/scrape-profile", response_model=ScrapeProfileResponse)
async def instagram_scrape_profile(
    req: ScrapeProfileRequest,
    _: None = Depends(verify_secret),
) -> ScrapeProfileResponse:
    result = await asyncio.to_thread(
        fetch_user_reels,
        req.username,
        req.password,
        req.proxy_url,
        req.device_seed,
        req.target_username,
        req.limit,
        req.totp_secret,
        req.existing_settings,
        req.time_budget_seconds,
    )
    return ScrapeProfileResponse(success=result.success, **result.data)



def _onboarding_response(result) -> OnboardingResponse:
    data = dict(result.data)
    data["session_settings"] = data.pop("settings", None)
    return OnboardingResponse(success=result.success, **data)


@app.post("/onboarding/accept-invite", response_model=OnboardingResponse)
async def onboarding_accept_invite(
    req: AcceptInviteRequest,
    _: None = Depends(verify_secret),
) -> OnboardingResponse:
    result = await asyncio.to_thread(
        accept_app_invite,
        req.username,
        req.password,
        req.proxy_url,
        req.device_seed,
        req.totp_secret,
        req.session_settings,
        req.app_id,
    )
    return _onboarding_response(result)


@app.post("/onboarding/change-photo", response_model=OnboardingResponse)
async def onboarding_change_photo(
    req: ChangePhotoRequest,
    _: None = Depends(verify_secret),
) -> OnboardingResponse:
    result = await asyncio.to_thread(
        change_profile_photo,
        req.username,
        req.password,
        req.proxy_url,
        req.device_seed,
        req.photo_url,
        req.totp_secret,
        req.session_settings,
    )
    return _onboarding_response(result)


@app.post("/onboarding/switch-professional", response_model=OnboardingResponse)
async def onboarding_switch_professional(
    req: SwitchProfessionalRequest,
    _: None = Depends(verify_secret),
) -> OnboardingResponse:
    result = await asyncio.to_thread(
        switch_to_professional,
        req.username,
        req.password,
        req.proxy_url,
        req.device_seed,
        req.totp_secret,
        req.session_settings,
        req.to_account_type,
    )
    return _onboarding_response(result)


@app.post("/onboarding/check-professional", response_model=OnboardingResponse)
async def onboarding_check_professional(
    req: OnboardingRequest,
    _: None = Depends(verify_secret),
) -> OnboardingResponse:
    result = await asyncio.to_thread(
        check_professional,
        req.username,
        req.password,
        req.proxy_url,
        req.device_seed,
        req.totp_secret,
        req.session_settings,
    )
    return _onboarding_response(result)


@app.post("/onboarding/post-story", response_model=OnboardingResponse)
async def onboarding_post_story(
    req: PostStoryRequest,
    _: None = Depends(verify_secret),
) -> OnboardingResponse:
    result = await asyncio.to_thread(
        post_story_with_link,
        req.username,
        req.password,
        req.proxy_url,
        req.device_seed,
        req.media_url,
        req.link_url,
        req.totp_secret,
        req.session_settings,
    )
    return _onboarding_response(result)


@app.post("/onboarding/create-highlight", response_model=OnboardingResponse)
async def onboarding_create_highlight(
    req: CreateHighlightRequest,
    _: None = Depends(verify_secret),
) -> OnboardingResponse:
    result = await asyncio.to_thread(
        create_highlight_from_story,
        req.username,
        req.password,
        req.proxy_url,
        req.device_seed,
        req.story_pk,
        req.highlight_title,
        req.totp_secret,
        req.session_settings,
    )
    return _onboarding_response(result)


@app.post("/test-browser-login", response_model=BrowserLoginResponse)
async def test_browser_login(
    req: BrowserLoginRequest,
    _: None = Depends(verify_secret_strict),
) -> BrowserLoginResponse:
    import json as _json

    username = req.username.strip().lstrip("@").lower()
    notes: list[str] = []
    saved = None

    if req.user_id and req.use_saved_session:
        try:
            saved = await session_store.load_session(req.user_id, username)
        except Exception as exc:  # noqa: BLE001
            notes.append(f"não carregou sessão salva: {exc}")

    outcome = await browser_login(
        username,
        req.password,
        req.proxy,
        totp_secret=req.totp_secret,
        storage_state=(saved or {}).get("storage_state"),
        fingerprint=(saved or {}).get("fingerprint"),
        headless=req.headless,
        capture_screenshot=req.include_screenshot,
    )

    session_saved = False
    if req.user_id and req.save_session:
        try:
            if outcome.status == STATUS_SUCCESS and outcome.storage_state:
                await session_store.save_session(
                    req.user_id, username, outcome.storage_state, outcome.fingerprint,
                    outcome.proxy_ip, logged_in_now=not outcome.session_reused,
                )
                session_saved = True
            elif saved and saved.get("storage_state") and outcome.status in (STATUS_WRONG_PASSWORD, STATUS_CHECKPOINT):
                await session_store.mark_session(
                    req.user_id, username,
                    "invalid" if outcome.status == STATUS_WRONG_PASSWORD else "expired",
                    outcome.message,
                )
        except Exception as exc:  # noqa: BLE001
            notes.append(f"sessão não salva: {exc}")
    elif not req.user_id:
        notes.append("user_id não informado — sessão não foi carregada nem salva")

    # Log estruturado da tentativa — sem senha, sem credencial de proxy.
    print(_json.dumps({
        "evt": "browser_login",
        "username": username,
        "status": outcome.status,
        "exit_ip": outcome.proxy_ip,
        "country": outcome.proxy_country,
        "elapsed_ms": outcome.elapsed_ms,
        "session_reused": outcome.session_reused,
        "session_saved": session_saved,
        "steps": [s["step"] for s in outcome.log],
    }, ensure_ascii=False))

    return BrowserLoginResponse(
        status=outcome.status,
        message=outcome.message,
        screenshot=outcome.screenshot_b64,
        session_saved=session_saved,
        session_reused=outcome.session_reused,
        session_note="; ".join(notes) or None,
        checkpoint=outcome.checkpoint,
        proxy_ip=outcome.proxy_ip,
        proxy_country=outcome.proxy_country,
        elapsed_ms=outcome.elapsed_ms,
        attempt_log=outcome.log,
    )


@app.post("/onboarding/magic-link", response_model=MagicLinkResponse)
async def onboarding_magic_link(
    req: MagicLinkRequest,
    # Recebe sessao da conta e devolve screenshot: fail-closed, igual ao
    # /test-browser-login.
    _: None = Depends(verify_secret_strict),
) -> MagicLinkResponse:
    import json as _json

    username = req.username.strip().lstrip("@").lower()
    notes: list[str] = []
    saved = None

    # Sessao de navegador salva tem prioridade sobre a conversao da instagrapi.
    if req.user_id and req.use_saved_session:
        try:
            saved = await session_store.load_session(req.user_id, username)
        except Exception as exc:  # noqa: BLE001
            notes.append(f"nao carregou sessao salva: {exc}")

    outcome = await complete_magic_link(
        req.magic_url,
        username,
        req.proxy,
        session_settings=req.session_settings,
        storage_state=(saved or {}).get("storage_state"),
        fingerprint=(saved or {}).get("fingerprint"),
        device_seed=req.device_seed,
        headless=req.headless,
        capture_screenshot=req.include_screenshot,
    )

    session_saved = False
    if req.user_id and req.save_session and outcome.storage_state:
        try:
            await session_store.save_session(
                req.user_id, username, outcome.storage_state, outcome.fingerprint,
                outcome.proxy_ip, logged_in_now=False,
            )
            session_saved = True
        except Exception as exc:  # noqa: BLE001
            notes.append(f"sessao nao salva: {exc}")

    print(_json.dumps({
        "evt": "magic_link",
        "username": username,
        "status": outcome.status,
        "exit_ip": outcome.proxy_ip,
        "country": outcome.proxy_country,
        "clicked": outcome.authorized_click,
        "final_url": outcome.final_url,
        "elapsed_ms": outcome.elapsed_ms,
        "steps": [s["step"] for s in outcome.log],
    }, ensure_ascii=False))

    return MagicLinkResponse(
        status=outcome.status,
        message=outcome.message,
        screenshot=outcome.screenshot_b64,
        checkpoint=outcome.checkpoint,
        final_url=outcome.final_url,
        authorized_click=outcome.authorized_click,
        session_saved=session_saved,
        session_note="; ".join(notes) or None,
        proxy_ip=outcome.proxy_ip,
        proxy_country=outcome.proxy_country,
        elapsed_ms=outcome.elapsed_ms,
        attempt_log=outcome.log,
    )


# Endpoint /onboarding-rpa/run removido — fluxo RPA descontinuado no refactor 294a242.


@app.get("/health")
async def health() -> dict:
    try:
        import importlib.metadata

        instagrapi_version = importlib.metadata.version("instagrapi")
    except Exception as e:
        instagrapi_version = f"erro: {e}"
    try:
        playwright_version = importlib.metadata.version("playwright")
    except Exception as e:
        playwright_version = f"erro: {e}"
    return {
        "status": "ok",
        "instagrapi_version": instagrapi_version,
        "playwright_version": playwright_version,
    }
