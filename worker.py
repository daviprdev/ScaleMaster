"""
Worker RPA Standalone — Loop principal de onboarding (v2).

Arquitetura corrigida:
- Claim atômico COM lease/heartbeat (db.claim_next_job com worker_id)
- Reserva de capacidade ANTES do claim (semáforo adquirido no loop, não no process_job)
- Heartbeat periódico durante execução (renova lease a cada 60s)
- Fencing: complete_job/fail_job só permitem se worker_id é proprietário
- Orçamento: MAX_TOTAL_RETRIES, deadline, backoff exponencial via db.fail_job
- Instagrapi primeiro, Playwright depois (delegado ao motor RPA)
- Status compatíveis: pending → processing → done/error/expired
"""

import asyncio
import signal
import sys
import time
import uuid
import os
from pathlib import Path

# Fix para Python 3.10+ em containers Docker
if sys.platform != "win32":
    try:
        asyncio.set_child_watcher(asyncio.ThreadedChildWatcher())
    except (AttributeError, RuntimeError):
        pass

# Garantir DISPLAY=:99 para Playwright
if sys.platform != "win32":
    if not os.environ.get("DISPLAY"):
        os.environ["DISPLAY"] = ":99"
        print("[WORKER] DISPLAY=:99 setado (Xvfb deve estar rodando)")

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
    recover_expired_leases,
    claim_next_job,
    complete_job,
    fail_job,
    renew_lease,
    check_ownership,
    get_next_proxy,
    mark_proxy_used,
    mark_proxy_failed,
    update_stage,
    HEARTBEAT_INTERVAL_SECONDS,
)

# Import do motor RPA — falha fatal se não carregar
try:
    from onboarding_rpa import run_onboarding_rpa
except ImportError as e:
    print(f"[WORKER] FATAL: onboarding_rpa não encontrado: {e}")
    print("[WORKER] O motor RPA é obrigatório. Corrija a instalação antes de iniciar.")
    sys.exit(1)


# ─── PAUSE/RESUME GLOBAL ─────────────────────────────────────
_queue_paused = False

def is_queue_paused() -> bool:
    return _queue_paused

def set_queue_paused(paused: bool) -> None:
    global _queue_paused
    _queue_paused = paused

# ─── PAUSE/RESUME POR JOB INDIVIDUAL ─────────────────────────
_paused_jobs: set[str] = set()

def is_job_paused(job_id: str) -> bool:
    return job_id in _paused_jobs

def pause_job(job_id: str) -> None:
    _paused_jobs.add(job_id)

def resume_job(job_id: str) -> None:
    _paused_jobs.discard(job_id)

def get_paused_jobs() -> list[str]:
    return list(_paused_jobs)


class RPAWorker:
    """Worker que consome jobs do SQLite com lease, heartbeat e orçamento."""

    def __init__(self):
        self._running = True
        self.worker_id = f"worker-{uuid.uuid4().hex[:8]}"
        # Semáforo adquirido NO LOOP antes do claim (reserva capacidade)
        self.semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
        print(f"[WORKER] ID: {self.worker_id}")

    MAX_PROXY_ATTEMPTS = 6

    async def _heartbeat_loop(self, job_id: str) -> None:
        """Renova o lease periodicamente enquanto o job está em execução."""
        while self._running:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            if not self._running:
                break
            still_owner = renew_lease(job_id, self.worker_id)
            if not still_owner:
                print(f"[WORKER] ⚠️ Perdi ownership do job {job_id[:8]}... — abortando")
                break

    async def process_job(self, job: dict) -> None:
        """Processa um job com heartbeat, rotação de proxies e orçamento."""
        job_id = job["id"]
        username = job["username"]
        print(f"[WORKER] Iniciando job {job_id[:8]}... (@{username})")

        # Iniciar heartbeat em background
        heartbeat_task = asyncio.create_task(self._heartbeat_loop(job_id))

        try:
            # Decifrar credenciais
            password = decrypt(job["password_enc"])
            totp_secret = decrypt(job["two_factor_enc"]) if job.get("two_factor_enc") else None
            magic_link_url = f"{SAAS_BASE_URL}/add/{job['magic_link_token']}"

            # ── Loop de rotação de proxies ──
            tried_proxy_ids: list[str] = []
            last_result = None
            success = False

            for attempt in range(1, self.MAX_PROXY_ATTEMPTS + 1):
                # Verificar se ainda sou proprietário antes de cada tentativa
                if not check_ownership(job_id, self.worker_id):
                    print(f"[WORKER] ⚠️ Não sou mais proprietário de {job_id[:8]}... — abortando")
                    break

                # Verificar pausa individual
                if is_job_paused(job_id):
                    print(f"[WORKER] ⏸️ Job {job_id[:8]}... pausado pelo usuário")
                    fail_job(job_id, self.worker_id, "Pausado pelo usuário",
                             error_code="user_paused", permanent=True)
                    break

                # Buscar próximo proxy
                proxy_row = get_next_proxy(exclude_ids=tried_proxy_ids)
                if proxy_row is None:
                    print(f"[WORKER] ⚠️ Sem proxies disponíveis (tentativa {attempt})")
                    break

                proxy_id = proxy_row["id"]
                raw_proxy = proxy_row["proxy_url_enc"]
                try:
                    proxy_url = decrypt(raw_proxy)
                except (ValueError, Exception):
                    proxy_url = raw_proxy
                tried_proxy_ids.append(proxy_id)
                mark_proxy_used(proxy_id)

                provider = proxy_row.get("provider", "N/A")
                print(f"[WORKER] Tentativa {attempt}/{self.MAX_PROXY_ATTEMPTS} — "
                      f"Proxy: {provider} ({proxy_id[:8]}...)")

                update_stage(job_id, "proxy_selection", status="processing",
                             data=f"attempt={attempt},provider={provider}")

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
                        job_id=job_id,
                        worker_id=self.worker_id,
                    )
                except Exception as rpa_exc:
                    err_msg = f"{type(rpa_exc).__name__}: {rpa_exc}"
                    print(f"[WORKER] 💥 Exceção RPA na tentativa {attempt}: {err_msg[:200]}")
                    mark_proxy_failed(proxy_id, error=err_msg[:300])
                    last_result = {"success": False, "error_code": "rpa_exception",
                                   "message": err_msg}
                    continue

                if result.get("success"):
                    mark_proxy_used(proxy_id)
                    # Complete com fencing
                    completed = complete_job(job_id, self.worker_id)
                    if completed:
                        print(f"[WORKER] ✅ Job {job_id[:8]}... concluído na tentativa {attempt}")
                        success = True
                    else:
                        print(f"[WORKER] ⚠️ Job {job_id[:8]}... já foi finalizado por outro owner")
                        success = True  # Não retryar
                    break

                # Falha — avaliar
                error_code = result.get("error_code", "unknown")
                error_msg = result.get("message", "Erro desconhecido")
                last_result = result

                permanent_errors = {
                    "needs_2fa", "challenge_required", "account_disabled",
                    "sessionid_missing", "validation", "no_stories",
                    "story_link_verification_failed", "credential_invalid",
                    "user_paused",
                }
                proxy_retryable = {
                    "instagrapi_login_failed", "playwright_login_failed",
                    "login_failed", "timeout", "unknown_error", "rpa_exception",
                    "proxy_error", "network_error",
                }

                if error_code in permanent_errors:
                    print(f"[WORKER] ❌ Erro permanente ({error_code}), parando rotação")
                    break

                if error_code in proxy_retryable and attempt < self.MAX_PROXY_ATTEMPTS:
                    fc = mark_proxy_failed(proxy_id, error=f"[{error_code}] {error_msg}"[:300])
                    backoff = min(10 * (2 ** (attempt - 1)), 180)
                    print(f"[WORKER] 🔄 Falha retryable ({error_code}), "
                          f"proxy failure_count={fc}, backoff {backoff}s...")
                    await asyncio.sleep(backoff)
                    continue

                if attempt >= self.MAX_PROXY_ATTEMPTS:
                    mark_proxy_failed(proxy_id, error=f"[{error_code}] {error_msg}"[:300])
                    print(f"[WORKER] ❌ Esgotadas {self.MAX_PROXY_ATTEMPTS} tentativas de proxy")
                break

            # ── Resultado final ──
            if not success:
                error_code = last_result.get("error_code", "unknown") if last_result else "no_proxy"
                error_msg = last_result.get("message", "Sem proxies ou erro desconhecido") if last_result else "No proxies available"
                is_permanent = error_code in {
                    "needs_2fa", "challenge_required", "account_disabled",
                    "validation", "credential_invalid", "story_link_verification_failed",
                    "user_paused",
                }
                new_status = fail_job(
                    job_id, self.worker_id,
                    f"[{error_code}] {error_msg}",
                    error_code=error_code,
                    permanent=is_permanent,
                )
                if new_status == "stale_owner":
                    print(f"[WORKER] ⚠️ Job {job_id[:8]}... já pertence a outro worker")
                elif new_status in ("error", "expired"):
                    print(f"[WORKER] ❌ Job {job_id[:8]}... terminal ({new_status}): {error_code}")
                else:
                    print(f"[WORKER] 🔄 Job {job_id[:8]}... retry scheduled ({new_status}): {error_code}")

        except Exception as e:
            import traceback
            error_type = type(e).__name__
            error_msg = str(e) or f"{error_type} (sem mensagem)"
            tb = traceback.format_exc()[-500:]
            fail_job(job_id, self.worker_id,
                     f"[{error_type}] {error_msg}\n---TB---\n{tb}",
                     error_code="worker_exception", permanent=False)
            print(f"[WORKER] 💥 Job {job_id[:8]}... exceção fatal: {error_type}: {error_msg[:200]}")

        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

    async def worker_loop(self) -> None:
        """Loop principal: reserva capacidade → claim → processa."""
        print(f"[WORKER] Loop iniciado (concorrência máx: {MAX_CONCURRENT_JOBS}, "
              f"poll: {POLL_INTERVAL_SECONDS}s, worker: {self.worker_id})")
        tasks: set[asyncio.Task] = set()

        while self._running:
            try:
                # Checar pausa global
                if is_queue_paused():
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
                    continue

                # Recuperar leases expirados (substitui reset_stale_jobs)
                recover_expired_leases()

                # RESERVAR CAPACIDADE antes do claim
                # Isso garante que nunca claimamos mais jobs do que podemos processar
                acquired = False
                try:
                    # Tentar adquirir semáforo sem bloquear o loop inteiro
                    # Usamos wait_for com timeout curto para não travar
                    await asyncio.wait_for(self.semaphore.acquire(), timeout=1.0)
                    acquired = True
                except asyncio.TimeoutError:
                    # Sem capacidade disponível — esperar e tentar novamente
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
                    continue

                # Claim atômico com lease
                job = claim_next_job(self.worker_id)
                if job is None:
                    # Nenhum job elegível — liberar capacidade
                    self.semaphore.release()
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
                    continue

                # Criar task — o semáforo será liberado quando a task terminar
                task = asyncio.create_task(self._run_with_semaphore(job))
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

    async def _run_with_semaphore(self, job: dict) -> None:
        """Executa o job e libera o semáforo ao final."""
        try:
            await self.process_job(job)
        finally:
            self.semaphore.release()

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

    # Validar concorrência
    if MAX_CONCURRENT_JOBS < 1:
        print(f"[CONFIG] ERRO: MAX_CONCURRENT_JOBS deve ser >= 1 (atual: {MAX_CONCURRENT_JOBS})")
        sys.exit(1)

    print("=" * 60)
    print("  AutoScale RPA Worker v2 — Standalone")
    print(f"  Perfis: {PROFILES_DIR}")
    print(f"  Concorrência: {MAX_CONCURRENT_JOBS}")
    print(f"  SaaS: {SAAS_BASE_URL}")
    print(f"  Poll: {POLL_INTERVAL_SECONDS}s")
    print("=" * 60)

    # Inicializar banco SQLite (com migrações)
    init_db()
    print("[WORKER] Banco SQLite inicializado com schema v2")

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