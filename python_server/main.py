"""
ScaleMaster Python Server — FastAPI
Raspagem de perfis do Instagram via instagrapi para as contas LEITORAS da aba
Inspirações, fora do app Next.js. Só é acessível pela rede interna do Docker.

Endpoints:
  POST /instagram/scrape-profile — todos os reels de um perfil via conta leitora
  GET  /health                   — liveness check do container

Os endpoints legados do onboarding automatizado / worker RPA (login via
navegador, magic-link, post-story, troca de foto, efeitos de vídeo…) foram
removidos em 2026-10-17: nada no app os chamava e vários faziam ações na
conta ou buscavam URLs arbitrárias. Os módulos seguem no repositório
(onboarding.py, magic_link.py, browser_engine.py, instagram_login.py) só como
referência — instagram_scraper.py ainda usa helpers de instagram_login.
"""

import asyncio
import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from instagram_scraper import fetch_user_reels

# Sem /docs, /redoc e /openapi.json: o servidor é interno e não precisa
# publicar o próprio contrato.
app = FastAPI(
    title="ScaleMaster Python Server",
    version="2.0.0",
    redirect_slashes=False,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

SERVER_SECRET: str = os.environ.get("PYTHON_SERVER_SECRET", "")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def verify_secret(authorization: str | None = Header(default=None)) -> None:
    """Fail-closed: sem PYTHON_SERVER_SECRET definido, rejeita tudo.
    Comparação em tempo constante (hmac.compare_digest)."""
    if not SERVER_SECRET:
        raise HTTPException(status_code=503, detail="PYTHON_SERVER_SECRET não configurado")
    if not hmac.compare_digest(authorization or "", f"Bearer {SERVER_SECRET}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


# O handler padrão do FastAPI (pydantic v2) devolve o "input" de cada erro —
# num campo faltando, o corpo inteiro: senha, proxy com credencial, TOTP,
# cookies de sessão. O Next grava o texto do erro em scrape_jobs.error_message
# (visível na UI). Aqui só sai onde/qual foi o erro.
@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [
        {"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")}
        for e in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


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
    # Orçamento de tempo TOTAL da chamada (login incluso): estourado, devolve o
    # que já coletou com truncated=True. Quem define é o chamador, que tem
    # timeout HTTP próprio um pouco maior.
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


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


@app.get("/health")
async def health() -> dict:
    try:
        import importlib.metadata

        instagrapi_version = importlib.metadata.version("instagrapi")
    except Exception as e:
        instagrapi_version = f"erro: {e}"
    return {"status": "ok", "instagrapi_version": instagrapi_version}
