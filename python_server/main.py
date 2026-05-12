"""
AutoScale Python Server — FastAPI
Lida com autenticação e postagem no Instagram via instagrapi.

Startup:
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Variáveis de ambiente:
  PYTHON_SERVER_SECRET  — chave compartilhada com o Next.js (opcional, mas recomendado)
"""

import os
import json
import uuid
import time
import logging
import tempfile
import threading
import urllib.error
import urllib.request
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.disable(logging.CRITICAL)

app = FastAPI(title="AutoScale Python Server", version="1.0.0")

API_SECRET = os.getenv("PYTHON_SERVER_SECRET", "")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Sessões em memória (para fluxo 2FA / checkpoint)
# Mapeiam um token UUID → {settings, last_json, ...} com TTL de 5 minutos
# ---------------------------------------------------------------------------

_sessions: dict[str, dict] = {}
_lock = threading.Lock()
_SESSION_TTL = 300  # segundos


def _clean_expired() -> None:
    now = time.time()
    with _lock:
        expired = [k for k, v in _sessions.items() if now - v["ts"] > _SESSION_TTL]
        for k in expired:
            del _sessions[k]


def _save_session(data: dict) -> str:
    token = str(uuid.uuid4())
    _clean_expired()
    with _lock:
        _sessions[token] = {"data": data, "ts": time.time()}
    return token


def _get_session(token: str) -> dict | None:
    _clean_expired()
    with _lock:
        entry = _sessions.get(token)
        return entry["data"] if entry else None


def _delete_session(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)


# ---------------------------------------------------------------------------
# Autenticação por API key
# ---------------------------------------------------------------------------

async def require_api_key(request: Request) -> None:
    if not API_SECRET:
        return
    if request.headers.get("x-api-key", "") != API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---------------------------------------------------------------------------
# Helper: monta payload de perfil + session_json
# ---------------------------------------------------------------------------

def _profile_payload(cl, username: str) -> dict:
    try:
        session_json = json.dumps(cl.get_settings())
    except Exception:
        session_json = ""

    try:
        info = cl.account_info()
        return {
            "status": "ok",
            "session_json": session_json,
            "username": info.username,
            "full_name": info.full_name or "",
            "biography": info.biography or "",
            "followers": info.follower_count or 0,
            "following": info.following_count or 0,
            "profile_pic_url": str(info.profile_pic_url) if info.profile_pic_url else None,
            "is_private": info.is_private,
        }
    except Exception:
        return {
            "status": "ok",
            "session_json": session_json,
            "username": username,
            "full_name": "",
            "biography": "",
            "followers": 0,
            "following": 0,
            "profile_pic_url": None,
            "is_private": False,
        }


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class VerifyRequest(BaseModel):
    username: str
    code: str
    challenge_type: str          # "2fa" | "checkpoint"
    session_token: str
    two_factor_identifier: Optional[str] = ""


class PublishRequest(BaseModel):
    username: str
    video_url: str
    caption: str
    session_json: str            # JSON string vindo do campo access_token do Supabase


# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/login", dependencies=[Depends(require_api_key)])
def login(req: LoginRequest):
    try:
        from instagrapi import Client
        from instagrapi.exceptions import (
            BadPassword,
            ChallengeRequired,
            TwoFactorRequired,
            LoginRequired,
            PleaseWaitFewMinutes,
            UnknownError,
        )
    except ImportError:
        raise HTTPException(500, "instagrapi não está instalado no servidor.")

    username = req.username.lstrip("@").strip()
    cl = Client()

    try:
        cl.login(username, req.password)
        return _profile_payload(cl, username)

    except TwoFactorRequired:
        two_factor_id = ""
        try:
            two_factor_id = (cl.last_json or {}).get("two_factor_info", {}).get("two_factor_identifier", "")
        except Exception:
            pass

        token = _save_session({
            "settings": cl.get_settings(),
            "last_json": cl.last_json or {},
        })
        return {
            "status": "requires_code",
            "challenge_type": "2fa",
            "verification_method": "authenticator",
            "session_token": token,
            "two_factor_identifier": two_factor_id,
            "username": username,
        }

    except ChallengeRequired:
        verification_method = "sms"
        challenge_response = {}
        try:
            challenge_response = cl.challenge_resolve(cl.last_json) or {}
            step_name = challenge_response.get("step_name", "").lower()
            contact = (challenge_response.get("step_data") or {}).get("contact_point", "") or ""
            if "email" in step_name or ("@" in contact and "*" in contact):
                verification_method = "email"
        except Exception:
            pass

        token = _save_session({
            "settings": cl.get_settings(),
            "last_json": cl.last_json or {},
            "challenge_response": challenge_response,
        })
        return {
            "status": "requires_code",
            "challenge_type": "checkpoint",
            "verification_method": verification_method,
            "session_token": token,
            "username": username,
        }

    except BadPassword:
        raise HTTPException(401, "Senha incorreta.")
    except PleaseWaitFewMinutes:
        raise HTTPException(429, "O Instagram pediu para aguardar alguns minutos. Tente novamente em breve.")
    except LoginRequired:
        raise HTTPException(401, "Login recusado pelo Instagram. Aguarde alguns minutos e tente novamente.")
    except UnknownError as e:
        raise HTTPException(400, f"Erro desconhecido do Instagram: {e}")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/auth/verify", dependencies=[Depends(require_api_key)])
def verify(req: VerifyRequest):
    session_data = _get_session(req.session_token)
    if not session_data:
        raise HTTPException(400, "Sessão expirada ou inválida. Faça login novamente.")

    try:
        from instagrapi import Client
    except ImportError:
        raise HTTPException(500, "instagrapi não está instalado no servidor.")

    cl = Client()
    cl.set_settings(session_data["settings"])
    saved_last_json = session_data.get("last_json", {})
    if saved_last_json:
        cl.last_json = saved_last_json

    code = req.code.replace(" ", "").strip()

    try:
        if req.challenge_type == "2fa":
            cl.two_factor_login(
                verification_code=code,
                two_factor_identifier=req.two_factor_identifier or "",
                username=req.username,
            )
        elif req.challenge_type == "checkpoint":
            try:
                cl.challenge_send_security_code(int(code))
            except (ValueError, TypeError):
                cl.challenge_send_security_code(code)
        else:
            raise HTTPException(400, f"Tipo de desafio inválido: {req.challenge_type}")

        _delete_session(req.session_token)
        return _profile_payload(cl, req.username)

    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if any(k in err for k in ["invalid", "expired", "wrong", "incorrect", "bad", "code"]):
            raise HTTPException(401, "Código inválido ou expirado. Tente novamente.")
        raise HTTPException(500, str(e))


@app.post("/posts/publish", dependencies=[Depends(require_api_key)])
def publish(req: PublishRequest):
    try:
        settings = json.loads(req.session_json)
    except Exception:
        raise HTTPException(400, "session_json inválido.")

    try:
        from instagrapi import Client
    except ImportError:
        raise HTTPException(500, "instagrapi não está instalado no servidor.")

    cl = Client()
    cl.set_settings(settings)

    tmp_video = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            tmp_video = f.name

        urllib.request.urlretrieve(req.video_url, tmp_video)

        media = cl.clip_upload(tmp_video, caption=req.caption)
        return {
            "status": "ok",
            "media_id": str(media.id),
            "code": getattr(media, "code", ""),
        }

    except HTTPException:
        raise
    except urllib.error.URLError as e:
        raise HTTPException(400, f"Erro ao baixar vídeo: {e}")
    except Exception as e:
        err = str(e).lower()
        if any(k in err for k in ["login", "session", "auth", "unauthorized", "not logged", "400 bad request"]):
            raise HTTPException(401, "Sessão expirada. Reconecte a conta no painel.")
        raise HTTPException(500, str(e))

    finally:
        if tmp_video:
            try:
                os.remove(tmp_video)
            except Exception:
                pass
