"""Health check endpoint simples para o Worker RPA."""
import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from config import WORKER_API_SECRET, HEALTH_PORT

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

    # TODO: Enfileirar job na fila interna (Redis, SQLite local, ou fila em memória)
    # Por enquanto, apenas valida e retorna accepted
    return JSONResponse(
        {"status": "accepted", "username": body["username"]},
        status_code=202,
    )


def start_health_server():
    """Inicia o servidor de health check em background."""
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")