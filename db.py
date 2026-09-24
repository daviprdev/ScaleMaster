"""Persistência local de jobs via SQLite.

O worker NÃO usa Supabase ou qualquer banco externo.
Jobs são persistidos localmente para sobreviver a reinícios.
"""

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from config import SQLITE_DB_PATH

DB_PATH: str = SQLITE_DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_enc TEXT NOT NULL,
    two_factor_enc TEXT,
    proxy_url_enc TEXT,
    photo_url TEXT,
    story_media_url TEXT,
    story_link_url TEXT,
    highlight_title TEXT,
    magic_link_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at REAL NOT NULL,
    processed_at REAL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_username ON jobs(username);
"""


def init_db(db_path: str = DB_PATH) -> None:
    """Cria tabelas e índices se não existirem."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        conn.executescript(_SCHEMA)
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


def insert_job(job_data: dict, db_path: str = DB_PATH) -> str:
    """Insere novo job. Retorna ID. Raises sqlite3.IntegrityError se username duplicado."""
    now = time.time()
    with _connect(db_path) as conn:
        cursor = conn.execute(
            """INSERT INTO jobs (
                id, username, password_enc, two_factor_enc, proxy_url_enc,
                photo_url, story_media_url, story_link_url, highlight_title,
                magic_link_token, status, retry_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)""",
            (
                job_data["id"],
                job_data["username"],
                job_data["password_enc"],
                job_data.get("two_factor_enc"),
                job_data.get("proxy_url_enc"),
                job_data.get("photo_url"),
                job_data.get("story_media_url"),
                job_data.get("story_link_url"),
                job_data.get("highlight_title"),
                job_data["magic_link_token"],
                now,
                now,
            ),
        )
    return job_data["id"]


def claim_next_job(db_path: str = DB_PATH) -> Optional[dict]:
    """Claim atômico: pega o próximo job pending e marca como processing.

    Retorna dict com dados do job ou None se não há jobs pendentes.
    """
    now = time.time()
    with _connect(db_path) as conn:
        # Buscar próximo job pending (respeitando retry_after se implementado)
        row = conn.execute(
            "SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
        ).fetchone()

        if not row:
            return None

        # Claim atômico
        result = conn.execute(
            "UPDATE jobs SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'",
            (now, row["id"]),
        )

        if result.rowcount == 0:
            return None  # Outro worker pegou primeiro

        return dict(row)


def complete_job(job_id: str, db_path: str = DB_PATH) -> None:
    """Marca job como concluído com sucesso."""
    now = time.time()
    with _connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET status = 'done', processed_at = ?, updated_at = ? WHERE id = ?",
            (now, now, job_id),
        )


def fail_job(job_id: str, error_message: str, permanent: bool = False, db_path: str = DB_PATH) -> None:
    """Marca job como erro permanente ou incrementa retry."""
    now = time.time()
    with _connect(db_path) as conn:
        if permanent:
            conn.execute(
                "UPDATE jobs SET status = 'error', error_message = ?, processed_at = ?, updated_at = ? WHERE id = ?",
                (error_message[:500], now, now, job_id),
            )
        else:
            # Incrementar retry e voltar pra pending
            conn.execute(
                """UPDATE jobs
                   SET status = 'pending',
                       retry_count = retry_count + 1,
                       error_message = ?,
                       updated_at = ?
                   WHERE id = ?""",
                (error_message[:500], now, job_id),
            )


def reset_stale_jobs(timeout_seconds: int = 900, db_path: str = DB_PATH) -> int:
    """Auto-healing: jobs em 'processing' há >timeout voltam pra 'pending'.

    Retorna número de jobs recuperados.
    """
    cutoff = time.time() - timeout_seconds
    with _connect(db_path) as conn:
        result = conn.execute(
            "UPDATE jobs SET status = 'pending', updated_at = ? WHERE status = 'processing' AND updated_at < ?",
            (time.time(), cutoff),
        )
    count = result.rowcount
    if count > 0:
        print(f"[DB] Auto-healing: {count} jobs recuperados de stale processing")
    return count


def list_recent_jobs(limit: int = 50, db_path: str = DB_PATH) -> list[dict]:
    """Lista jobs recentes ordenados por criação descendente."""
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_job_by_username(username: str, db_path: str = DB_PATH) -> Optional[dict]:
    """Busca job ativo (não concluído) por username."""
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
        for status in ("pending", "processing", "done", "error"):
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM jobs WHERE status = ?", (status,)
            ).fetchone()
            stats[status] = row["cnt"]
    return stats