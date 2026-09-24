"""Configuração centralizada do Worker RPA Standalone."""

import os
from dotenv import load_dotenv

load_dotenv()

# Criptografia
ENCRYPTION_SECRET: str = os.getenv("ENCRYPTION_SECRET", "")

# Perfis persistentes
PROFILES_DIR: str = os.getenv("ONBOARDING_PROFILES_DIR", "/opt/rpa/profiles")

# Concorrência
MAX_CONCURRENT_JOBS: int = int(os.getenv("MAX_CONCURRENT_JOBS", "3"))

# Polling
POLL_INTERVAL_SECONDS: int = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))

# SaaS
SAAS_BASE_URL: str = os.getenv("SAAS_BASE_URL", "https://autoscale-ia.vercel.app")

# API interna
WORKER_API_SECRET: str = os.getenv("WORKER_API_SECRET", "")
HEALTH_PORT: int = int(os.getenv("HEALTH_PORT", "8080"))

# Browser
BROWSER_HEADLESS: bool = os.getenv("BROWSER_HEADLESS", "1") == "1"

# SQLite
SQLITE_DB_PATH: str = os.getenv("SQLITE_DB_PATH", "/app/data/jobs.db")


def validate_config() -> list[str]:
    """Retorna lista de erros de configuração. Lista vazia = OK."""
    errors = []
    if not ENCRYPTION_SECRET:
        errors.append("ENCRYPTION_SECRET não configurada")
    if not WORKER_API_SECRET:
        errors.append("WORKER_API_SECRET não configurada")
    return errors