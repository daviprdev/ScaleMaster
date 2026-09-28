"""Persistência local de jobs via SQLite com lease, heartbeat, checkpoints e orçamento de execução.

Migração v2: adiciona colunas de lease_owner, lease_expires_at, heartbeat_at,
next_attempt_at, max_retries, deadline_at, current_stage, story_pk, highlight_pk,
flow_version. Preserva dados existentes.
"""

import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from config import SQLITE_DB_PATH

DB_PATH: str = SQLITE_DB_PATH

# ─── CONFIGURAÇÃO DE ORÇAMENTO ───────────────────────────────
MAX_TOTAL_RETRIES = 6          # Tentativas máximas totais por job
MAX_STAGE_RETRIES = 3          # Tentativas máximas por etapa
LEASE_DURATION_SECONDS = 600   # 10 minutos de lease inicial
HEARTBEAT_INTERVAL_SECONDS = 60  # Renovação a cada 60s
JOB_DEADLINE_SECONDS = 3600    # Prazo máximo total de execução (1h)
BACKOFF_BASE_SECONDS = 10      # Backoff exponencial base
BACKOFF_MAX_SECONDS = 300      # Backoff máximo (5 min)

# Schema base: apenas CREATE TABLE com colunas que SEMPRE existem
# Colunas novas são adicionadas via _MIGRATIONS (ALTER TABLE)
# Índices que dependem de colunas novas ficam em _INDEXES (após migrações)
_SCHEMA_BASE = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    two_factor_enc TEXT,
    proxy_url_enc TEXT,
    photo_url TEXT,
    story_media_url TEXT,
    story_link_url TEXT,
    highlight_title TEXT,
    magic_link_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at REAL NOT NULL,
    processed_at REAL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS proxies (
    id TEXT PRIMARY KEY,
    proxy_url_enc TEXT NOT NULL,
    provider TEXT,
    country TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_used_at REAL,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS job_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    stage_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt INTEGER NOT NULL DEFAULT 0,
    started_at REAL,
    finished_at REAL,
    error_code TEXT,
    error_message TEXT,
    external_id TEXT,
    data TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
);
"""

# Índices seguros: só usam colunas que existem desde o início OU foram migradas
_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_username ON jobs(username)",
    "CREATE INDEX IF NOT EXISTS idx_proxies_active ON proxies(is_active)",
    "CREATE INDEX IF NOT EXISTS idx_job_stages_job ON job_stages(job_id, stage_key)",
    # Estes dependem de colunas migradas — só criar se a coluna existir
    "CREATE INDEX IF NOT EXISTS idx_jobs_next_attempt ON jobs(next_attempt_at)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs(lease_expires_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL",
]

_MIGRATIONS = [
    ("story_link_text", "ALTER TABLE jobs ADD COLUMN story_link_text TEXT"),
    ("completed_stages", "ALTER TABLE jobs ADD COLUMN completed_stages TEXT DEFAULT ''"),
    ("sessionid_enc", "ALTER TABLE jobs ADD COLUMN sessionid_enc TEXT"),
    ("retry_count", "ALTER TABLE jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0"),
    ("current_stage", "ALTER TABLE jobs ADD COLUMN current_stage TEXT"),
    ("flow_version", "ALTER TABLE jobs ADD COLUMN flow_version INTEGER NOT NULL DEFAULT 2"),
    ("lease_owner", "ALTER TABLE jobs ADD COLUMN lease_owner TEXT"),
    ("lease_expires_at", "ALTER TABLE jobs ADD COLUMN lease_expires_at REAL"),
    ("heartbeat_at", "ALTER TABLE jobs ADD COLUMN heartbeat_at REAL"),
    ("next_attempt_at", "ALTER TABLE jobs ADD COLUMN next_attempt_at REAL DEFAULT 0"),
    ("deadline_at", "ALTER TABLE jobs ADD COLUMN deadline_at REAL"),
    ("story_pk", "ALTER TABLE jobs ADD COLUMN story_pk TEXT"),
    ("highlight_pk", "ALTER TABLE jobs ADD COLUMN highlight_pk TEXT"),
    ("error_code", "ALTER TABLE jobs ADD COLUMN error_code TEXT"),
    ("app_id", "ALTER TABLE jobs ADD COLUMN app_id TEXT"),
    ("idempotency_key", "ALTER TABLE jobs ADD COLUMN idempotency_key TEXT"),
]


def init_db(db_path: str = DB_PATH) -> None:
    """Cria tabelas, aplica migrações e cria índices na ordem correta.

    Ordem: 1) Schema base (tabelas com colunas originais)
           2) Migrações ALTER TABLE (adiciona colunas novas)
           3) Índices (alguns dependem de colunas migradas)
    """
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        # 1) Schema base — só colunas que sempre existiram
        conn.executescript(_SCHEMA_BASE)

        # 2) Migrações — adiciona colunas novas incrementalmente
        for col_name, sql in _MIGRATIONS:
            try:
                conn.execute(sql)
                print(f"[DB] Migração: coluna {col_name} adicionada")
            except sqlite3.OperationalError:
                pass  # Coluna já existe

        # 3) Índices — agora as colunas migradas já existem
        for idx_sql in _INDEXES:
            try:
                conn.execute(idx_sql)
            except sqlite3.OperationalError as e:
                # Índice pode falhar se coluna ainda não existe (migração falhou)
                print(f"[DB] Aviso: índice pulado: {e}")

    print(f"[DB] SQLite inicializado: {db_path}")


@contextmanager
def _connect(db_path: str = DB_PATH):
    """Context manager para conexão SQLite com commit/rollback automático."""
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def insert_job(
    username: str,
    password_enc: str,
    magic_link_token: str,
    two_factor_enc: str = None,
    proxy_url_enc: str = None,
    photo_url: str = None,
    story_media_url: str = None,
    story_link_url: str = None,
    story_link_text: str = None,
    highlight_title: str = None,
    app_id: str = None,
    idempotency_key: str = None,
    db_path: str = DB_PATH,
) -> str:
    """Insere novo job. Retorna ID. Usa idempotency_key se fornecido."""
    now = time.time()
    job_id = str(uuid.uuid4())
    deadline = now + JOB_DEADLINE_SECONDS
    with _connect(db_path) as conn:
        # Verificar idempotency
        if idempotency_key:
            existing = conn.execute(
                "SELECT id FROM jobs WHERE idempotency_key = ?", (idempotency_key,)
            ).fetchone()
            if existing:
                return existing["id"]
        conn.execute(
            """INSERT INTO jobs (
                id, username, password_enc, two_factor_enc, proxy_url_enc,
                photo_url, story_media_url, story_link_url, story_link_text,
                highlight_title, magic_link_token, app_id, status, retry_count,
                created_at, updated_at, next_attempt_at, deadline_at,
                flow_version, idempotency_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, 0, ?, 2, ?)""",
            (
                job_id, username, password_enc, two_factor_enc, proxy_url_enc,
                photo_url, story_media_url, story_link_url, story_link_text,
                highlight_title, magic_link_token, app_id, now, now, deadline,
                idempotency_key,
            ),
        )
    return job_id


def claim_next_job(worker_id: str, db_path: str = DB_PATH) -> Optional[dict]:
    """Claim atômico com lease: pega o próximo job elegível e reserva com lease.

    Elegível = status 'pending', next_attempt_at <= now, retry_count < MAX_TOTAL_RETRIES,
    deadline_at > now (ou NULL).
    Retorna dict com dados do job ou None.
    """
    now = time.time()
    lease_until = now + LEASE_DURATION_SECONDS
    with _connect(db_path) as conn:
        row = conn.execute(
            """SELECT * FROM jobs
               WHERE status = 'pending'
                 AND next_attempt_at <= ?
                 AND retry_count < ?
                 AND (deadline_at IS NULL OR deadline_at > ?)
               ORDER BY created_at ASC LIMIT 1""",
            (now, MAX_TOTAL_RETRIES, now),
        ).fetchone()

        if not row:
            return None

        result = conn.execute(
            """UPDATE jobs
               SET status = 'processing',
                   lease_owner = ?,
                   lease_expires_at = ?,
                   heartbeat_at = ?,
                   processed_at = COALESCE(processed_at, ?),
                   updated_at = ?
               WHERE id = ? AND status = 'pending'""",
            (worker_id, lease_until, now, now, now, row["id"]),
        )

        if result.rowcount == 0:
            return None

        return dict(row)


def renew_lease(job_id: str, worker_id: str, db_path: str = DB_PATH) -> bool:
    """Renova o lease (heartbeat). Retorna True se ainda é proprietário."""
    now = time.time()
    lease_until = now + LEASE_DURATION_SECONDS
    with _connect(db_path) as conn:
        result = conn.execute(
            """UPDATE jobs
               SET lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
               WHERE id = ? AND lease_owner = ? AND status = 'processing'""",
            (lease_until, now, now, job_id, worker_id),
        )
    return result.rowcount > 0


def check_ownership(job_id: str, worker_id: str, db_path: str = DB_PATH) -> bool:
    """Verifica se o worker ainda é proprietário do lease."""
    now = time.time()
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT lease_owner, lease_expires_at FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
    if not row:
        return False
    return row["lease_owner"] == worker_id and (row["lease_expires_at"] or 0) > now


def complete_job(job_id: str, worker_id: str, db_path: str = DB_PATH) -> bool:
    """Marca job como concluído. Só permite se worker_id é o proprietário atual."""
    now = time.time()
    with _connect(db_path) as conn:
        result = conn.execute(
            """UPDATE jobs
               SET status = 'done', processed_at = COALESCE(processed_at, ?),
                   updated_at = ?, lease_owner = NULL, lease_expires_at = NULL
               WHERE id = ? AND lease_owner = ? AND status = 'processing'""",
            (now, now, job_id, worker_id),
        )
    return result.rowcount > 0


def fail_job(
    job_id: str,
    worker_id: str,
    error_message: str,
    error_code: str = "unknown",
    permanent: bool = False,
    db_path: str = DB_PATH,
) -> str:
    """Falha com orçamento: backoff, limite de retries, prazo.

    Retorna novo status ('pending' para retry, 'error' para terminal, 'expired' para prazo).
    """
    now = time.time()
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT retry_count, deadline_at, lease_owner FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if not row:
            return "not_found"

        # Fencing: só o proprietário pode falhar
        if row["lease_owner"] and row["lease_owner"] != worker_id:
            return "stale_owner"

        if permanent:
            conn.execute(
                """UPDATE jobs SET status = 'error', error_message = ?, error_code = ?,
                   processed_at = COALESCE(processed_at, ?), updated_at = ?,
                   lease_owner = NULL, lease_expires_at = NULL
                   WHERE id = ?""",
                (error_message[:500], error_code, now, now, job_id),
            )
            return "error"

        new_retry = (row["retry_count"] or 0) + 1
        deadline = row["deadline_at"]

        # Verificar prazo
        if deadline and now >= deadline:
            conn.execute(
                """UPDATE jobs SET status = 'expired', error_message = ?, error_code = 'deadline_exceeded',
                   retry_count = ?, updated_at = ?, lease_owner = NULL, lease_expires_at = NULL
                   WHERE id = ?""",
                (f"Prazo excedido após {new_retry} tentativas: {error_message[:200]}", new_retry, now, job_id),
            )
            return "expired"

        # Verificar limite de retries
        if new_retry >= MAX_TOTAL_RETRIES:
            conn.execute(
                """UPDATE jobs SET status = 'error', error_message = ?, error_code = 'max_retries_exceeded',
                   retry_count = ?, updated_at = ?, lease_owner = NULL, lease_expires_at = NULL
                   WHERE id = ?""",
                (f"Máximo de {MAX_TOTAL_RETRIES} retries atingido: {error_message[:200]}", new_retry, now, job_id),
            )
            return "error"

        # Backoff exponencial
        backoff = min(BACKOFF_BASE_SECONDS * (2 ** (new_retry - 1)), BACKOFF_MAX_SECONDS)
        next_attempt = now + backoff

        conn.execute(
            """UPDATE jobs SET status = 'pending', retry_count = ?,
               error_message = ?, error_code = ?, next_attempt_at = ?,
               updated_at = ?, lease_owner = NULL, lease_expires_at = NULL
               WHERE id = ?""",
            (new_retry, error_message[:500], error_code, next_attempt, now, job_id),
        )
        return "pending"


def recover_expired_leases(db_path: str = DB_PATH) -> int:
    """Recupera jobs cujo lease expirou (worker morreu). Volta para pending se dentro do orçamento."""
    now = time.time()
    with _connect(db_path) as conn:
        rows = conn.execute(
            """SELECT id, retry_count, deadline_at FROM jobs
               WHERE status = 'processing' AND lease_expires_at < ?""",
            (now,),
        ).fetchall()

        recovered = 0
        for row in rows:
            new_retry = (row["retry_count"] or 0) + 1
            deadline = row["deadline_at"]
            if (deadline and now >= deadline) or new_retry >= MAX_TOTAL_RETRIES:
                status = "expired" if (deadline and now >= deadline) else "error"
                conn.execute(
                    """UPDATE jobs SET status = ?, error_code = 'lease_expired',
                       retry_count = ?, updated_at = ?, lease_owner = NULL, lease_expires_at = NULL
                       WHERE id = ?""",
                    (status, new_retry, now, row["id"]),
                )
            else:
                backoff = min(BACKOFF_BASE_SECONDS * (2 ** (new_retry - 1)), BACKOFF_MAX_SECONDS)
                conn.execute(
                    """UPDATE jobs SET status = 'pending', retry_count = ?,
                       next_attempt_at = ?, updated_at = ?,
                       lease_owner = NULL, lease_expires_at = NULL
                       WHERE id = ?""",
                    (new_retry, now + backoff, now, row["id"]),
                )
            recovered += 1

    if recovered > 0:
        print(f"[DB] Lease recovery: {recovered} jobs recuperados")
    return recovered


def update_stage(job_id: str, stage_key: str, status: str = "processing",
                 error_code: str = None, error_message: str = None,
                 external_id: str = None, data: str = None,
                 db_path: str = DB_PATH) -> None:
    """Atualiza ou cria registro de etapa."""
    now = time.time()
    with _connect(db_path) as conn:
        existing = conn.execute(
            "SELECT id, attempt FROM job_stages WHERE job_id = ? AND stage_key = ?",
            (job_id, stage_key),
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE job_stages SET status = ?, attempt = attempt + 1,
                   finished_at = CASE WHEN ? IN ('done','error') THEN ? ELSE finished_at END,
                   error_code = ?, error_message = ?, external_id = COALESCE(?, external_id),
                   data = COALESCE(?, data)
                   WHERE id = ?""",
                (status, status, now, error_code, error_message[:300] if error_message else None,
                 external_id, data, existing["id"]),
            )
        else:
            conn.execute(
                """INSERT INTO job_stages (job_id, stage_key, status, attempt, started_at,
                   error_code, error_message, external_id, data)
                   VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)""",
                (job_id, stage_key, status, now, error_code,
                 error_message[:300] if error_message else None, external_id, data),
            )

        # Atualizar current_stage e completed_stages no job
        if status == "done":
            row = conn.execute("SELECT completed_stages FROM jobs WHERE id = ?", (job_id,)).fetchone()
            current = row["completed_stages"] or "" if row else ""
            stages = set(current.split(",")) if current else set()
            stages.add(stage_key)
            conn.execute(
                "UPDATE jobs SET completed_stages = ?, current_stage = ?, updated_at = ? WHERE id = ?",
                (",".join(sorted(stages)), stage_key, now, job_id),
            )
        else:
            conn.execute(
                "UPDATE jobs SET current_stage = ?, updated_at = ? WHERE id = ?",
                (stage_key, now, job_id),
            )


def save_checkpoint(job_id: str, stage_key: str, db_path: str = DB_PATH) -> None:
    """Salva uma etapa como concluída."""
    update_stage(job_id, stage_key, status="done", db_path=db_path)


def get_completed_stages(job_id: str, db_path: str = DB_PATH) -> set:
    """Retorna set de etapas já concluídas."""
    with _connect(db_path) as conn:
        row = conn.execute("SELECT completed_stages FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if not row or not row["completed_stages"]:
        return set()
    return set(row["completed_stages"].split(","))


def clear_checkpoints(job_id: str, db_path: str = DB_PATH) -> None:
    """Limpa todos os checkpoints de um job."""
    now = time.time()
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET completed_stages = '', current_stage = NULL, updated_at = ? WHERE id = ?",
            (now, job_id),
        )
        conn.execute("DELETE FROM job_stages WHERE job_id = ?", (job_id,))


def delete_job(job_id: str, db_path: str = DB_PATH) -> bool:
    """Remove job permanentemente."""
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM job_stages WHERE job_id = ?", (job_id,))
        result = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    return result.rowcount > 0


def list_recent_jobs(limit: int = 50, db_path: str = DB_PATH) -> list[dict]:
    """Lista jobs recentes sem credenciais sensíveis."""
    with _connect(db_path) as conn:
        rows = conn.execute(
            """SELECT id, username, status, retry_count, error_message, error_code,
                      created_at, processed_at, updated_at, completed_stages,
                      current_stage, flow_version, next_attempt_at, deadline_at,
                      story_pk, highlight_pk, app_id
               FROM jobs ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_job_by_username(username: str, db_path: str = DB_PATH) -> Optional[dict]:
    """Busca job ativo por username."""
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE username = ? AND status IN ('pending', 'processing') LIMIT 1",
            (username,),
        ).fetchone()
    return dict(row) if row else None


def get_stats(db_path: str = DB_PATH) -> dict:
    """Estatísticas da fila."""
    with _connect(db_path) as conn:
        stats = {}
        for status in ("pending", "processing", "done", "error", "expired"):
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM jobs WHERE status = ?", (status,)
            ).fetchone()
            stats[status] = row["cnt"]
    return stats


def get_job_stages_detail(job_id: str, db_path: str = DB_PATH) -> list[dict]:
    """Retorna detalhes de todas as etapas de um job."""
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM job_stages WHERE job_id = ? ORDER BY started_at ASC",
            (job_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# ─── PROXY POOL MANAGEMENT ──────────────────────────────────

def insert_proxy(proxy_url_enc: str, provider: str = None, country: str = None, db_path: str = DB_PATH) -> str:
    """Insere novo proxy no estoque."""
    now = time.time()
    proxy_id = str(uuid.uuid4())
    with _connect(db_path) as conn:
        conn.execute(
            """INSERT INTO proxies (id, proxy_url_enc, provider, country, is_active, failure_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, 0, ?, ?)""",
            (proxy_id, proxy_url_enc, provider, country, now, now),
        )
    return proxy_id


def list_proxies(include_inactive: bool = False, db_path: str = DB_PATH) -> list[dict]:
    """Lista proxies do estoque."""
    with _connect(db_path) as conn:
        if include_inactive:
            rows = conn.execute("SELECT * FROM proxies ORDER BY created_at DESC").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM proxies WHERE is_active = 1 ORDER BY failure_count ASC, last_used_at ASC"
            ).fetchall()
    return [dict(r) for r in rows]


def get_next_proxy(exclude_ids: list[str] = None, db_path: str = DB_PATH) -> Optional[dict]:
    """Retorna o próximo proxy disponível."""
    with _connect(db_path) as conn:
        if exclude_ids:
            placeholders = ",".join("?" * len(exclude_ids))
            row = conn.execute(
                f"""SELECT * FROM proxies
                    WHERE is_active = 1 AND id NOT IN ({placeholders})
                    ORDER BY failure_count ASC, last_used_at ASC LIMIT 1""",
                exclude_ids,
            ).fetchone()
        else:
            row = conn.execute(
                """SELECT * FROM proxies WHERE is_active = 1
                   ORDER BY failure_count ASC, last_used_at ASC LIMIT 1"""
            ).fetchone()
    return dict(row) if row else None


def mark_proxy_used(proxy_id: str, db_path: str = DB_PATH) -> None:
    """Registra que um proxy foi usado."""
    now = time.time()
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE proxies SET last_used_at = ?, updated_at = ? WHERE id = ?",
            (now, now, proxy_id),
        )


def mark_proxy_failed(proxy_id: str, error: str = None, db_path: str = DB_PATH) -> int:
    """Incrementa contador de falhas do proxy."""
    now = time.time()
    with _connect(db_path) as conn:
        conn.execute(
            """UPDATE proxies SET failure_count = failure_count + 1,
               last_error = ?, last_used_at = ?, updated_at = ? WHERE id = ?""",
            ((error or "")[:500], now, now, proxy_id),
        )
        row = conn.execute("SELECT failure_count FROM proxies WHERE id = ?", (proxy_id,)).fetchone()
    return row["failure_count"] if row else 0


def deactivate_proxy(proxy_id: str, db_path: str = DB_PATH) -> None:
    """Desativa um proxy."""
    now = time.time()
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE proxies SET is_active = 0, updated_at = ? WHERE id = ?",
            (now, proxy_id),
        )


def delete_proxy(proxy_id: str, db_path: str = DB_PATH) -> None:
    """Remove permanentemente um proxy."""
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM proxies WHERE id = ?", (proxy_id,))


def get_proxy_stats(db_path: str = DB_PATH) -> dict:
    """Estatísticas do estoque de proxies."""
    with _connect(db_path) as conn:
        total = conn.execute("SELECT COUNT(*) as cnt FROM proxies").fetchone()["cnt"]
        active = conn.execute("SELECT COUNT(*) as cnt FROM proxies WHERE is_active = 1").fetchone()["cnt"]
        failed = conn.execute("SELECT COUNT(*) as cnt FROM proxies WHERE failure_count > 0").fetchone()["cnt"]
        avg_f = conn.execute("SELECT AVG(failure_count) as avg_f FROM proxies WHERE is_active = 1").fetchone()["avg_f"]
    return {
        "total": total,
        "active": active,
        "inactive": total - active,
        "with_failures": failed,
        "avg_failure_rate": round(avg_f or 0, 2),
    }


# ─── COMPATIBILIDADE LEGACY ─────────────────────────────────

def reset_stale_jobs(timeout_seconds: int = 900, db_path: str = DB_PATH) -> int:
    """Legacy: substituído por recover_expired_leases(). Mantido para compatibilidade."""
    return recover_expired_leases(db_path)