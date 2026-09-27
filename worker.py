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

# Fix para Python 3.10+ em containers Docker: Playwright precisa spawnar
# subprocessos (Chromium) e o event loop default não tem child watcher.
# ThreadedChildWatcher resolve o NotImplementedError no subprocess_exec.
if sys.platform != "win32":
    try:
        asyncio.set_child_watcher(asyncio.ThreadedChildWatcher())
    except (AttributeError, RuntimeError):
        pass  # Já setado ou Windows

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
    get_next_proxy,
    mark_proxy_used,
    mark_proxy_failed,
)
from crypto import encrypt

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

    MAX_PROXY_ATTEMPTS = 6

    async def process_job(self, job: dict) -> None:
        """Processa um job com rotação automática de proxies (até 6 tentativas)."""
        async with self.semaphore:
            job_id = job["id"]
            username = job["username"]
            print(f"[WORKER] Iniciando job {job_id} (@{username})")

            try:
                # Decifrar credenciais
                password = decrypt(job["password_enc"])
                totp_secret = decrypt(job["two_factor_enc"]) if job.get("two_factor_enc") else None
                magic_link_url = f"{SAAS_BASE_URL}/add/{job['magic_link_token']}"

                if run_onboarding_rpa is None:
                    raise RuntimeError("Módulo onboarding_rpa não carregado")

                # ── Loop de rotação de proxies ──
                tried_proxy_ids: list[str] = []
                last_result = None
                success = False

                for attempt in range(1, self.MAX_PROXY_ATTEMPTS + 1):
                    # Buscar próximo proxy do estoque (excluindo já tentados)
                    proxy_row = get_next_proxy(exclude_ids=tried_proxy_ids)
                    if proxy_row is None:
                        print(f"[WORKER] ⚠️ Sem proxies disponíveis no estoque (tentativa {attempt})")
                        break

                    proxy_id = proxy_row["id"]
                    proxy_url = decrypt(proxy_row["proxy_url_enc"])
                    tried_proxy_ids.append(proxy_id)
                    mark_proxy_used(proxy_id)

                    print(f"[WORKER] Tentativa {attempt}/{self.MAX_PROXY_ATTEMPTS} — Proxy: {proxy_row.get('provider', 'N/A')} ({proxy_id[:8]}...)")

                    try:
                        result = await run_onboarding_rpa(
                            username=username,
                            password=password,
                            proxy_url=proxy_url,
                            totp_secret=totp_secret,
                            photo_path=job.get("photo_url"),
                            story_media_path=job.get("story_media_url"),
                            story_link_url=job.get("story_link_url"),
                            story_link_text=job.get("story_link_text"),
                            highlight_title=job.get("highlight_title"),
                            magic_link_url=magic_link_url,
                            profile_dir=str(Path(PROFILES_DIR) / username),
                        )
                    except Exception as rpa_exc:
                        import traceback
                        err_msg = f"{type(rpa_exc).__name__}: {rpa_exc}"
                        print(f"[WORKER] 💥 Exceção RPA na tentativa {attempt}: {err_msg}")
                        mark_proxy_failed(proxy_id, error=err_msg[:300])
                        last_result = {"success": False, "error_code": "rpa_exception", "message": err_msg}
                        continue

                    if result.get("success"):
                        mark_proxy_used(proxy_id)  # reforça sucesso
                        complete_job(job_id)
                        print(f"[WORKER] ✅ Job {job_id} concluído na tentativa {attempt}")
                        success = True
                        break

                    # Falha — avaliar se deve rotacionar proxy
                    error_code = result.get("error_code", "unknown")
                    error_msg = result.get("message", "Erro desconhecido")
                    last_result = result

                    # Erros que justificam trocar proxy
                    proxy_retryable = {
                        "instagrapi_login_failed", "login_failed",
                        "timeout", "unknown_error", "rpa_exception",
                    }
                    # Erros permanentes (não adianta trocar proxy)
                    permanent_errors = {
                        "needs_2fa", "challenge_required",
                        "account_disabled", "sessionid_missing",
                        "validation", "no_stories",
                    }

                    if error_code in permanent_errors:
                        print(f"[WORKER] ❌ Erro permanente ({error_code}), parando rotação")
                        break

                    if error_code in proxy_retryable and attempt < self.MAX_PROXY_ATTEMPTS:
                        fc = mark_proxy_failed(proxy_id, error=f"[{error_code}] {error_msg}"[:300])
                        print(f"[WORKER] 🔄 Falha retryable ({error_code}), proxy {proxy_id[:8]} failure_count={fc}, tentando próximo...")
                        continue

                    # Erro não-retryable ou última tentativa
                    if attempt >= self.MAX_PROXY_ATTEMPTS:
                        mark_proxy_failed(proxy_id, error=f"[{error_code}] {error_msg}"[:300])
                        print(f"[WORKER] ❌ Esgotadas {self.MAX_PROXY_ATTEMPTS} tentativas de proxy")
                    break

                # ── Resultado final ──
                if not success:
                    error_code = last_result.get("error_code", "unknown") if last_result else "no_proxy"
                    error_msg = last_result.get("message", "Sem proxies ou erro desconhecido") if last_result else "No proxies available"
                    is_permanent = error_code in {"needs_2fa", "challenge_required", "account_disabled", "validation"}
                    fail_job(job_id, f"[{error_code}] {error_msg}", permanent=is_permanent)
                    if is_permanent:
                        print(f"[WORKER] ❌ Job {job_id} falha permanente: {error_code}")
                    else:
                        print(f"[WORKER] ❌ Job {job_id} falhou após {len(tried_proxy_ids)} tentativa(s): {error_code}")

            except Exception as e:
                import traceback
                error_type = type(e).__name__
                error_msg = str(e) or f"{error_type} (sem mensagem)"
                full_error = f"[{error_type}] {error_msg}"
                tb = traceback.format_exc()[-500:]
                fail_job(job_id, f"{full_error}\n---TB---\n{tb}", permanent=False)
                print(f"[WORKER] 💥 Job {job_id} exceção fatal: {full_error}")
                print(f"[WORKER] Traceback:\n{tb}")

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