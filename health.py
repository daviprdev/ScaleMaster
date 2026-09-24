"""Health check endpoint simples para o Worker RPA."""
import asyncio
import uuid
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from config import WORKER_API_SECRET, HEALTH_PORT
from db import insert_job, list_recent_jobs, get_stats

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


def start_health_server():
    """Inicia o servidor de health check em background."""
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")