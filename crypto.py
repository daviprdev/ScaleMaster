"""Criptografia AES-256-GCM compatível com lib/encrypt.ts do SaaS."""

import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import ENCRYPTION_SECRET


def _derive_key(secret: str) -> bytes:
    """Deriva chave AES-256 a partir da secret usando SHA-256."""
    return hashlib.sha256(secret.encode("utf-8")).digest()


def decrypt(encrypted_text: str) -> str:
    """Decifra texto criptografado com AES-256-GCM.

    Formato esperado: base64(nonce + ciphertext + tag)
    Compatível com encrypt() de lib/encrypt.ts do SaaS.
    """
    if not encrypted_text or not encrypted_text.strip():
        raise ValueError("Texto criptografado vazio")

    if not ENCRYPTION_SECRET:
        raise ValueError("ENCRYPTION_SECRET não configurada")

    raw = base64.b64decode(encrypted_text)
    # nonce = 12 bytes, restante = ciphertext + tag (tag = 16 bytes no final)
    nonce = raw[:12]
    ciphertext_with_tag = raw[12:]

    key = _derive_key(ENCRYPTION_SECRET)
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext_with_tag, None)
    return plaintext.decode("utf-8")


def encrypt(plaintext: str) -> str:
    """Cifra texto com AES-256-GCM. Útil para testes e geração de dados."""
    if not ENCRYPTION_SECRET:
        raise ValueError("ENCRYPTION_SECRET não configurada")

    key = _derive_key(ENCRYPTION_SECRET)
    aesgcm = AESGCM(key)
    nonce = aesgcm._backend._get_random_bytes(12)  # type: ignore[attr-defined]
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext_with_tag).decode("ascii")