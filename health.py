"""Health check endpoint simples para o Worker RPA."""
import asyncio
import uuid
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from config import WORKER_API_SECRET, HEALTH_PORT
from crypto import encrypt
from db import (
    insert_job,
    list_recent_jobs,
    get_stats,
    insert_proxy,
    list_proxies,
    delete_proxy,
    deactivate_proxy,
    get_proxy_stats,
)

app = FastAPI(title="AutoScale RPA Worker Health")


@app.get("/health")
async def health(request: Request):
    """Health check público — não requer auth."""
    return {"status": "ok", "service": "rpa-worker"}


@app.post("/jobs")
async def submit_job(request: Request):
    """Endpoint protegido para submeter jobs de onboarding.

    Body esperado:
    {
        "username": "conta_instagram",
        "password_enc": "base64_aes256gcm...",
        "two_factor_enc": "base64_aes256gcm..." | null,
        "proxy_url_enc": "base64_aes256gcm..." | null,
        "photo_url": "https://..." | null,
        "story_media_url": "https://..." | null,
        "story_link_url": "https://..." | null,
        "highlight_title": "Destaque" | null,
        "magic_link_token": "token-do-magic-link-do-saas"
    }
    """
    # Auth simples via header
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "JSON inválido"}, status_code=400)

    # Validação mínima
    required = ["username", "password_enc", "magic_link_token"]
    missing = [f for f in required if not body.get(f)]
    if missing:
        return JSONResponse(
            {"error": f"Campos obrigatórios ausentes: {', '.join(missing)}"},
            status_code=400,
        )

    # Persistir job no SQLite local
    job_data = {"id": str(uuid.uuid4()), **body}
    try:
        job_id = insert_job(job_data)
        return JSONResponse(
            {"status": "accepted", "id": job_id, "username": body["username"]},
            status_code=202,
        )
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            return JSONResponse(
                {"error": "Job já existe para este username"},
                status_code=409,
            )
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/jobs")
async def get_jobs(request: Request):
    """Lista jobs recentes (últimos 50). Requer auth."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse(list_recent_jobs())


@app.get("/stats")
async def stats():
    """Estatísticas da fila de jobs."""
    return JSONResponse(get_stats())


# ─── PROXY POOL ENDPOINTS ────────────────────────────────────

@app.post("/proxies")
async def add_proxy(request: Request):
    """Adiciona proxy ao estoque. Body: {proxy_url_enc, provider?, country?}"""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "JSON inválido"}, status_code=400)
    if not body.get("proxy_url_enc"):
        return JSONResponse({"error": "proxy_url_enc obrigatório"}, status_code=400)
    pid = insert_proxy(
        proxy_url_enc=body["proxy_url_enc"],
        provider=body.get("provider"),
        country=body.get("country"),
    )
    return JSONResponse({"status": "created", "id": pid}, status_code=201)


@app.get("/proxies")
async def get_proxies(request: Request):
    """Lista proxies do estoque."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    include_inactive = request.query_params.get("include_inactive", "").lower() in ("1", "true")
    return JSONResponse(list_proxies(include_inactive=include_inactive))


@app.delete("/proxies/{proxy_id}")
async def remove_proxy(proxy_id: str, request: Request):
    """Remove proxy do estoque."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    delete_proxy(proxy_id)
    return JSONResponse({"status": "deleted", "id": proxy_id})


@app.patch("/proxies/{proxy_id}/deactivate")
async def disable_proxy(proxy_id: str, request: Request):
    """Desativa proxy sem remover."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    deactivate_proxy(proxy_id)
    return JSONResponse({"status": "deactivated", "id": proxy_id})


@app.get("/proxies/stats")
async def proxy_stats():
    """Estatísticas do estoque de proxies."""
    return JSONResponse(get_proxy_stats())


# ─── JOBS ENDPOINTS ──────────────────────────────────────────
@app.get("/jobs")
async def get_jobs(request: Request):
    """Lista jobs recentes."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse(list_recent_jobs(limit=50))


@app.post("/jobs")
async def create_job(request: Request):
    """Cria novo job de onboarding. Aceita credenciais em texto puro e criptografa internamente."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "JSON inválido"}, status_code=400)

    username = body.get("username", "").strip()
    password = body.get("password", "").strip()
    totp_secret = body.get("totp_secret", "").strip()
    magic_link_token = body.get("magic_link_token", "").strip()

    if not username or not password or not totp_secret or not magic_link_token:
        return JSONResponse(
            {"error": "username, password, totp_secret e magic_link_token são obrigatórios"},
            status_code=400,
        )

    job_id = insert_job(
        username=username,
        password_enc=encrypt(password),
        two_factor_enc=encrypt(totp_secret),
        magic_link_token=magic_link_token,
        photo_url=body.get("photo_url"),
        story_media_url=body.get("story_media_url"),
        story_link_url=body.get("story_link_url"),
        highlight_title=body.get("highlight_title"),
    )
    return JSONResponse({"status": "created", "id": job_id}, status_code=201)


def start_health_server():
    """Inicia o servidor de health check em background."""
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")