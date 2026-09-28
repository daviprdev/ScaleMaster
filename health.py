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
    delete_job,
    insert_proxy,
    list_proxies,
    delete_proxy,
    deactivate_proxy,
    get_proxy_stats,
    get_job_stages_detail,
    recover_expired_leases,
)
from worker import is_queue_paused, set_queue_paused, is_job_paused, pause_job, resume_job, get_paused_jobs

app = FastAPI(title="AutoScale RPA Worker Health")


@app.get("/health")
async def health(request: Request):
    """Health check público — não requer auth."""
    return {"status": "ok", "service": "rpa-worker"}


# ─── JOBS ENDPOINTS ──────────────────────────────────────────

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

    # Validar story_link_url quando story_media_url é fornecido (link é obrigatório)
    story_media = body.get("story_media_url", "").strip()
    story_link = body.get("story_link_url", "").strip()
    if story_media and not story_link:
        return JSONResponse(
            {"error": "story_link_url é obrigatório quando story_media_url é fornecido"},
            status_code=400,
        )

    # Validar formato da URL do link se fornecida
    if story_link:
        from urllib.parse import urlparse
        parsed = urlparse(story_link)
        if parsed.scheme not in ("http", "https"):
            return JSONResponse(
                {"error": "story_link_url deve ser uma URL válida (http/https)"},
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
        story_link_text=body.get("story_link_text"),
        highlight_title=body.get("highlight_title"),
    )
    return JSONResponse({"status": "created", "id": job_id}, status_code=201)


@app.get("/jobs")
async def get_jobs(request: Request):
    """Lista jobs recentes."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse(list_recent_jobs(limit=50))


@app.delete("/jobs/{job_id}")
async def delete_job_endpoint(job_id: str, request: Request):
    """Remove job permanentemente da fila."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    removed = delete_job(job_id)
    if not removed:
        return JSONResponse({"error": "Job não encontrado"}, status_code=404)
    return JSONResponse({"status": "deleted", "id": job_id})


@app.get("/jobs/{job_id}/stages")
async def get_job_stages(job_id: str, request: Request):
    """Retorna progresso por etapa de um job."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    from onboarding_rpa import get_job_stages as _get_stages
    stages = _get_stages(job_id)
    return JSONResponse({"job_id": job_id, "stages": stages})


@app.get("/stats")
async def stats():
    """Estatísticas da fila de jobs."""
    return JSONResponse(get_stats())


# ─── QUEUE PAUSE/RESUME ──────────────────────────────────────

@app.get("/queue/status")
async def queue_status():
    """Retorna status da fila (pausada/ativa)."""
    return JSONResponse({"paused": is_queue_paused()})


@app.post("/queue/pause")
async def pause_queue(request: Request):
    """Pausa a fila de jobs."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    set_queue_paused(True)
    return JSONResponse({"status": "paused"})


@app.post("/queue/resume")
async def resume_queue(request: Request):
    """Retoma a fila de jobs."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    set_queue_paused(False)
    return JSONResponse({"status": "resumed"})


# ─── JOB PAUSE/RESUME INDIVIDUAL ─────────────────────────────

@app.post("/jobs/{job_id}/pause")
async def pause_job_endpoint(job_id: str, request: Request):
    """Pausa um job específico (aborta se estiver em execução)."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    pause_job(job_id)
    return JSONResponse({"status": "paused", "id": job_id})


@app.post("/jobs/{job_id}/resume")
async def resume_job_endpoint(job_id: str, request: Request):
    """Retoma um job pausado."""
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    resume_job(job_id)
    return JSONResponse({"status": "resumed", "id": job_id})


@app.get("/jobs/paused")
async def list_paused_jobs():
    """Lista IDs dos jobs pausados."""
    return JSONResponse({"paused_jobs": get_paused_jobs()})


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


def start_health_server():
    """Inicia o servidor de health check em background."""
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")