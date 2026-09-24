"""
Worker RPA Standalone — Loop principal de onboarding.

Arquitetura:
- Fila persistida em SQLite local (db.py) — sem banco compartilhado com o SaaS
- Jobs submetidos via POST /jobs (health.py) → db.insert_job()
- Worker faz polling via db.claim_next_job() com auto-healing
- Cada job executa o fluxo completo de onboarding via Playwright
- Última etapa: navega até Magic Link do SaaS para vincular a conta
- Zero conexão com Supabase ou API do SaaS (apenas URL do Magic Link)
"""

import asyncio
import signal
import sys
import time
from pathlib import Path

from config import (
    MAX_CONCURRENT_JOBS,
    POLL_INTERVAL_SECONDS,
    PROFILES_DIR,
    SAAS_BASE_URL,
    validate_config,
)
from crypto import decrypt
from db import (
    init_db,
    reset_stale_jobs,
    claim_next_job,
    complete_job,
    fail_job,
)

# Import do motor RPA
try:
    from onboarding_rpa import run_onboarding_rpa
except ImportError:
    print("[WORKER] AVISO: onboarding_rpa não encontrado. Copie o módulo para este diretório.")
    run_onboarding_rpa = None  # type: ignore


class RPAWorker:
    """Worker que consome jobs do SQLite e executa RPA."""

    def __init__(self):
        self._running = True
        self.semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)

    async def process_job(self, job: dict) -> None:
        """Processa um único job de onboarding."""
        async with self.semaphore:
            job_id = job["id"]
            username = job["username"]
            print(f"[WORKER] Iniciando job {job_id} (@{username})")

            try:
                # Decifrar credenciais
                password = decrypt(job["password_enc"])
                totp_secret = decrypt(job["two_factor_enc"]) if job.get("two_factor_enc") else None
                proxy_url = decrypt(job["proxy_url_enc"]) if job.get("proxy_url_enc") else None

                # Construir URL do Magic Link
                magic_link_url = f"{SAAS_BASE_URL}/add/{job['magic_link_token']}"

                # Executar RPA
                if run_onboarding_rpa is None:
                    raise RuntimeError("Módulo onboarding_rpa não carregado")

                result = await run_onboarding_rpa(
                    username=username,
                    password=password,
                    proxy_url=proxy_url,
                    totp_secret=totp_secret,
                    photo_path=job.get("photo_url"),
                    story_media_path=job.get("story_media_url"),
                    story_link_url=job.get("story_link_url"),
                    highlight_title=job.get("highlight_title"),
                    magic_link_url=magic_link_url,
                    profile_dir=str(Path(PROFILES_DIR) / username),
                )

                # Avaliar resultado
                if result.get("success"):
                    complete_job(job_id)
                    print(f"[WORKER] ✅ Job {job_id} concluído com sucesso")
                else:
                    error_code = result.get("error_code", "unknown")
                    error_msg = result.get("message", result.get("error_message", "Erro desconhecido"))

                    # Erros permanentes vs transitórios
                    permanent_errors = {"needs_2fa", "challenge_required", "login_failed", "account_disabled"}
                    is_permanent = error_code in permanent_errors
                    fail_job(job_id, f"[{error_code}] {error_msg}", permanent=is_permanent)

                    if is_permanent:
                        print(f"[WORKER] ❌ Job {job_id} falha permanente: {error_code}")
                    else:
                        print(f"[WORKER] 🔄 Job {job_id} falha transitória: {error_code}")

            except Exception as e:
                error_msg = str(e)[:500]
                fail_job(job_id, error_msg, permanent=False)
                print(f"[WORKER] 💥 Job {job_id} exceção: {e}")

    async def worker_loop(self) -> None:
        """Loop principal que faz polling no SQLite por jobs pendentes."""
        print(f"[WORKER] Loop iniciado (concorrência máx: {MAX_CONCURRENT_JOBS}, poll: {POLL_INTERVAL_SECONDS}s)")
        tasks: set[asyncio.Task] = set()

        while self._running:
            try:
                # Auto-healing: recuperar jobs presos em processing
                reset_stale_jobs()

                # Tentar claimar próximo job pendente
                job = claim_next_job()
                if job is None:
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
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

    # Inicializar banco SQLite
    init_db()
    print("[WORKER] Banco SQLite inicializado")

    # Criar diretório de perfis
    Path(PROFILES_DIR).mkdir(parents=True, exist_ok=True)

    # Iniciar health server em background
    from health import start_health_server
    import threading
    health_thread = threading.Thread(target=start_health_server, daemon=True)
    health_thread.start()
    print("[WORKER] Health server iniciado")

    # Iniciar worker
    worker = RPAWorker()

    # Handler de sinal para parada graciosa
    def handle_signal(sig, frame):
        print("\n[WORKER] Sinal recebido, parando graciosamente...")
        worker.stop()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # Loop principal
    await worker.worker_loop()

    print("[WORKER] Worker finalizado")


if __name__ == "__main__":
    asyncio.run(main())