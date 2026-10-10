"""
Persistência das sessões de navegador (tabela public.ig_browser_sessions).

Criptografia idêntica a lib/encrypt.ts do Next.js — o que o python_server
grava, o Next lê com decrypt(), e vice-versa:
  chave = sha256(ENCRYPTION_SECRET)
  AES-256-GCM, IV de 12 bytes, tag de 16 bytes
  formato "iv_b64:tag_b64:ciphertext_b64"

Sem ENCRYPTION_SECRET no ambiente, nada é salvo (session_saved=false com o
motivo) — o servidor sobe normalmente, sem quebrar os endpoints atuais.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from datetime import datetime, timezone

import httpx

TABLE = "ig_browser_sessions"


class SessionStoreError(Exception):
    pass


def _key() -> bytes:
    secret = os.environ.get("ENCRYPTION_SECRET", "")
    if not secret:
        raise SessionStoreError("ENCRYPTION_SECRET não configurado no python_server")
    return hashlib.sha256(secret.encode("utf-8")).digest()


def encrypt(plaintext: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    iv = os.urandom(12)
    sealed = AESGCM(_key()).encrypt(iv, plaintext.encode("utf-8"), None)
    ciphertext, tag = sealed[:-16], sealed[-16:]
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    return f"{b64(iv)}:{b64(tag)}:{b64(ciphertext)}"


def decrypt(value: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    parts = value.split(":")
    if len(parts) != 3:
        raise SessionStoreError("ciphertext em formato inválido")
    iv, tag, ciphertext = (base64.b64decode(p) for p in parts)
    return AESGCM(_key()).decrypt(iv, ciphertext + tag, None).decode("utf-8")


def _rest() -> tuple[str, dict]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SessionStoreError("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    return f"{url}/rest/v1/{TABLE}", headers


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def load_session(user_id: str, username: str) -> dict | None:
    """{storage_state, fingerprint, status} ou None se não houver sessão ativa."""
    endpoint, headers = _rest()
    params = {
        "user_id": f"eq.{user_id}",
        "username": f"eq.{username.lower()}",
        "select": "storage_state_enc,fingerprint,status",
        "limit": "1",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(endpoint, headers=headers, params=params)
    if resp.status_code != 200:
        raise SessionStoreError(f"load HTTP {resp.status_code}: {resp.text[:200]}")
    rows = resp.json()
    if not rows:
        return None
    row = rows[0]
    if row.get("status") != "active" or not row.get("storage_state_enc"):
        return {"storage_state": None, "fingerprint": row.get("fingerprint") or None, "status": row.get("status")}
    return {
        "storage_state": json.loads(decrypt(row["storage_state_enc"])),
        "fingerprint": row.get("fingerprint") or None,
        "status": row.get("status"),
    }


async def save_session(
    user_id: str,
    username: str,
    storage_state: dict,
    fingerprint: dict | None,
    proxy_exit_ip: str | None,
    logged_in_now: bool,
) -> None:
    endpoint, headers = _rest()
    row = {
        "user_id": user_id,
        "username": username.lower(),
        "storage_state_enc": encrypt(json.dumps(storage_state, separators=(",", ":"))),
        "fingerprint": fingerprint or {},
        "status": "active",
        "proxy_exit_ip": proxy_exit_ip,
        "last_used_at": _now(),
        "last_error": None,
    }
    if logged_in_now:
        row["last_login_at"] = _now()
    await _upsert(endpoint, headers, row)


async def mark_session(user_id: str, username: str, status: str, error: str | None) -> None:
    """Marca a sessão salva como expired/invalid (não apaga — fica o histórico)."""
    endpoint, headers = _rest()
    params = {"user_id": f"eq.{user_id}", "username": f"eq.{username.lower()}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.patch(
            endpoint,
            headers={**headers, "Prefer": "return=minimal"},
            params=params,
            json={"status": status, "last_error": (error or "")[:500], "last_used_at": _now()},
        )
    if resp.status_code not in (200, 204):
        raise SessionStoreError(f"mark HTTP {resp.status_code}: {resp.text[:200]}")


async def _upsert(endpoint: str, headers: dict, row: dict) -> None:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            endpoint,
            headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "user_id,username"},
            json=row,
        )
    if resp.status_code not in (200, 201, 204):
        raise SessionStoreError(f"save HTTP {resp.status_code}: {resp.text[:200]}")
