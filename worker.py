"""
Worker RPA Standalone — Loop principal de onboarding.

Arquitetura:
- Fila interna em memória (asyncio.Queue) — sem banco compartilhado com o SaaS
- Jobs submetidos via POST /jobs (health.py) ou importados de CSV/JSON
- Cada job executa o fluxo completo de onboarding via Playwright
- Última etapa: navega até Magic Link do SaaS para vincular a conta
- Zero conexão com Supabase ou API do SaaS (apenas URL do Magic Link)
"""

import asyncio
import json
import os
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from config import (
    MAX_CONCURRENT_JOBS,
    POLL_INTERVAL_SECONDS,
    PROFILES_DIR,
    SAAS_BASE_URL,
    validate_config,
)
from crypto import decrypt

# Import do motor RPA (copiado de python_server/onboarding_rpa.py)
# Ajuste o path conforme a estrutura final do repositório
try:
    from onboarding_rpa import run_onboarding_rpa
except ImportError:
    print("[WORKER] AVISO: onboarding_rpa não encontrado. Copie o módulo para este diretório.")
    run_onboarding_rpa = None  # type: ignore


@dataclass
class OnboardingJob:
    """Representa um job de onboarding na fila."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    username: str = ""
    password_enc: str = ""
    two_factor_enc: Optional[str] = None
    proxy_url_enc: Optional[str] = None
    photo_url: Optional[str] = None
    story_media_url: Optional[str] = None
    story_link_url: Optional[str] = None
    highlight_title: Optional[str] = None
    magic_link_token: str = ""
    status: str = "pending"  # pending | processing | done | error
    retry_count: int = 0
    error_message: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    processed_at: Optional[float] = None
    max_retries: int = 3


class WorkerQueue:
    """Fila interna de jobs com controle de concorrência."""

    def __init__(self, max_concurrent: int = MAX_CONCURRENT_JOBS):
        self.queue: asyncio.Queue[OnboardingJob] = asyncio.Queue()
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.active_jobs: dict[str, OnboardingJob] = {}
        self.completed_jobs: list[OnboardingJob] = []
        self._running = True

    async def add_job(self, job: OnboardingJob) -> str:
        """Adiciona job à fila. Retorna o ID do job."""
        await self.queue.put(job)
        print(f"[QUEUE] Job adicionado: {job.id} (@{job.username})")
        return job.id

    async def process_job(self, job: OnboardingJob) -> None:
        """Processa um único job de onboarding."""
        async with self.semaphore:
            self.active_jobs[job.id] = job
            job.status = "processing"
            print(f"[WORKER] Iniciando job {job.id} (@{job.username})")

            try:
                # Decifrar credenciais
                password = decrypt(job.password_enc)
                two_factor = decrypt(job.two_factor_enc) if job.two_factor_enc else None
                proxy_url = decrypt(job.proxy_url_enc) if job.proxy_url_enc else None

                # Construir URL do Magic Link
                magic_link_url = f"{SAAS_BASE_URL}/add/{job.magic_link_token}"

                # Executar RPA
                if run_onboarding_rpa is None:
                    raise RuntimeError("Módulo onboarding_rpa não carregado")

                result = await run_onboarding_rpa(
                    username=job.username,
                    password=password,
                    two_factor_secret=two_factor,
                    proxy_url=proxy_url,
                    photo_url=job.photo_url,
                    story_media_url=job.story_media_url,
                    story_link_url=job.story_link_url,
                    highlight_title=job.highlight_title,
                    magic_link_url=magic_link_url,
                    profile_dir=str(Path(PROFILES_DIR) / job.username),
                )

                # Avaliar resultado
                if result.get("success"):
                    job.status = "done"
                    print(f"[WORKER] ✅ Job {job.id} concluído com sucesso")
                else:
                    error_code = result.get("error_code", "unknown")
                    error_msg = result.get("error_message", "Erro desconhecido")

                    # Erros permanentes vs transitórios
                    permanent_errors = {"needs_2fa", "challenge_required", "login_failed", "account_disabled"}
                    if error_code in permanent_errors:
                        job.status = "error"
                        job.error_message = f"[{error_code}] {error_msg}"
                        print(f"[WORKER] ❌ Job {job.id} falha permanente: {error_code}")
                    elif job.retry_count < job.max_retries:
                        job.retry_count += 1
                        job.status = "pending"
                        job.error_message = f"[{error_code}] {error_msg} (retry {job.retry_count}/{job.max_retries})"
                        # Re-enfileirar com backoff
                        backoff = min(300 * (2 ** job.retry_count), 3600)
                        print(f"[WORKER] 🔄 Job {job.id} re-enfileirado (backoff {backoff}s)")
                        await asyncio.sleep(backoff)
                        await self.queue.put(job)
                    else:
                        job.status = "error"
                        job.error_message = f"[{error_code}] {error_msg} (max retries atingido)"
                        print(f"[WORKER] ❌ Job {job.id} falha após {job.max_retries} tentativas")

            except Exception as e:
                job.status = "error"
                job.error_message = str(e)[:500]
                print(f"[WORKER] 💥 Job {job.id} exceção: {e}")

            finally:
                job.processed_at = time.time()
                self.completed_jobs.append(job)
                del self.active_jobs[job.id]

    async def worker_loop(self) -> None:
        """Loop principal que consome jobs da fila."""
        print(f"[WORKER] Loop iniciado (concorrência máx: {MAX_CONCURRENT_JOBS})")
        tasks: set[asyncio.Task] = set()

        while self._running:
            try:
                # Aguardar job com timeout para permitir verificação periódica
                try:
                    job = await asyncio.wait_for(self.queue.get(), timeout=POLL_INTERVAL_SECONDS)
                except asyncio.TimeoutError:
                    continue

                # Criar task para processar o job
                task = asyncio.create_task(self.process_job(job))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[WORKER] Erro no loop: {e}")
                await asyncio.sleep(5)

        # Aguardar tasks ativas finalizarem
        if tasks:
            print(f"[WORKER] Aguardando {len(tasks)} jobs ativos finalizarem...")
            await asyncio.gather(*tasks, return_exceptions=True)

    def stop(self) -> None:
        """Sinaliza parada graciosa."""
        self._running = False


async def main():
    """Entry point do worker."""
    # Validar configuração
    errors = validate_config()
    if errors:
        for err in errors:
            print(f"[CONFIG] ERRO: {err}")
        sys.exit(1)

    print("=" * 60)
    print("  AutoScale RPA Worker — Standalone")
    print(f"  Perfis: {PROFILES_DIR}")
    print(f"  Concorrência: {MAX_CONCURRENT_JOBS}")
    print(f"  SaaS: {SAAS_BASE_URL}")
    print("=" * 60)

    # Criar diretório de perfis
    Path(PROFILES_DIR).mkdir(parents=True, exist_ok=True)

    # Iniciar health server em background
    from health import start_health_server
    import threading
    health_thread = threading.Thread(target=start_health_server, daemon=True)
    health_thread.start()
    print("[WORKER] Health server iniciado")

    # Iniciar fila e loop
    queue = WorkerQueue()

    # Handler de sinal para parada graciosa
    def handle_signal(sig, frame):
        print("\n[WORKER] Sinal recebido, parando graciosamente...")
        queue.stop()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # TODO: Carregar jobs pendentes de persistência local (SQLite/JSON)
    # TODO: Endpoint POST /jobs já está no health.py — integrar com queue.add_job()

    # Loop principal
    await queue.worker_loop()

    print("[WORKER] Worker finalizado")


if __name__ == "__main__":
    asyncio.run(main())