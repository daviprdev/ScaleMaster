"""
AutoScale Railway Worker — FastAPI
Responsável pelo processamento pesado de vídeo (FFmpeg) fora da Vercel.

Endpoints:
  POST /video/effects   — aplica efeitos de vídeo e faz upload para Supabase
  GET  /health          — liveness check para Railway
"""

import asyncio
import os
import subprocess
import tempfile
import uuid

import httpx
from fastapi import Depends, FastAPI, HTTPException, Header
from pydantic import BaseModel

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
    if SERVER_SECRET and authorization != f"Bearer {SERVER_SECRET}":
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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
