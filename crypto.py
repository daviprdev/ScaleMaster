"""Criptografia AES-256-GCM compatível com lib/encrypt.ts do SaaS."""

import base64
import hashlib
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import ENCRYPTION_SECRET


def _derive_key(secret: str) -> bytes:
    """Deriva chave AES-256 a partir da secret usando SHA-256."""
    return hashlib.sha256(secret.encode("utf-8")).digest()


def decrypt(encrypted_text: str) -> str:
    """Decifra texto criptografado com AES-256-GCM.

    Formato esperado (compatível com lib/encrypt.ts do SaaS):
        base64(iv):base64(tag):base64(ciphertext)
    Três partes separadas por ':', cada uma base64 individualmente.
    """
    if not encrypted_text or not encrypted_text.strip():
        raise ValueError("Texto criptografado vazio")

    if not ENCRYPTION_SECRET:
        raise ValueError("ENCRYPTION_SECRET não configurada")

    parts = encrypted_text.split(":")
    if len(parts) != 3:
        raise ValueError(
            f"Formato de ciphertext inválido: esperava 'iv:tag:enc' "
            f"(3 partes separadas por ':'), recebeu {len(parts)} parte(s). "
            f"Primeiros 40 chars: {encrypted_text[:40]}"
        )

    iv_b64, tag_b64, enc_b64 = parts
    nonce = base64.b64decode(iv_b64)
    tag = base64.b64decode(tag_b64)
    ciphertext = base64.b64decode(enc_b64)

    # cryptography AESGCM espera ciphertext + tag concatenados
    ciphertext_with_tag = ciphertext + tag

    key = _derive_key(ENCRYPTION_SECRET)
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext_with_tag, None)
    return plaintext.decode("utf-8")


def encrypt(plaintext: str) -> str:
    """Cifra texto com AES-256-GCM no formato compatível com lib/encrypt.ts.

    Formato de saída: base64(iv):base64(tag):base64(ciphertext)
    """
    if not ENCRYPTION_SECRET:
        raise ValueError("ENCRYPTION_SECRET não configurada")

    key = _derive_key(ENCRYPTION_SECRET)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)  # type: ignore[attr-defined]
    # cryptography retorna ciphertext + tag concatenados (tag = últimos 16 bytes)
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    ciphertext = ciphertext_with_tag[:-16]
    tag = ciphertext_with_tag[-16:]
    return (
        f"{base64.b64encode(nonce).decode('ascii')}:"
        f"{base64.b64encode(tag).decode('ascii')}:"
        f"{base64.b64encode(ciphertext).decode('ascii')}"
    )