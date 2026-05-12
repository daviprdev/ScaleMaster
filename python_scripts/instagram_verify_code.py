"""
instagram_verify_code.py
Completa login com codigo 2FA (TOTP/SMS do app) ou checkpoint (SMS/email de segurança).

Uso:
  python instagram_verify_code.py <username> <code> <challenge_type> <session_token> [two_factor_identifier]

  challenge_type: "2fa" | "checkpoint"

Saída:
  Sucesso: {"status": "ok", "username": "...", ...}
  Erro:    {"status": "error", "error": "mensagem"}
"""

import sys
import json
import os
import tempfile
import logging

logging.disable(logging.CRITICAL)


def _return_profile(cl, username: str):
    try:
        session_json = json.dumps(cl.get_settings())
    except Exception:
        session_json = ""

    try:
        user_info = cl.account_info()
        print(json.dumps({
            "status": "ok",
            "session_json": session_json,
            "username": user_info.username,
            "full_name": user_info.full_name or "",
            "biography": user_info.biography or "",
            "followers": user_info.follower_count or 0,
            "following": user_info.following_count or 0,
            "profile_pic_url": str(user_info.profile_pic_url) if user_info.profile_pic_url else None,
            "is_private": user_info.is_private,
        }))
    except Exception:
        print(json.dumps({
            "status": "ok",
            "session_json": session_json,
            "username": username,
            "full_name": "",
            "biography": "",
            "followers": 0,
            "following": 0,
            "profile_pic_url": None,
            "is_private": False,
        }))


def main():
    if len(sys.argv) < 5:
        print(json.dumps({"status": "error", "error": "Uso: instagram_verify_code.py <username> <code> <challenge_type> <session_token> [two_factor_identifier]"}))
        return

    username = sys.argv[1]
    code = sys.argv[2].replace(" ", "").strip()
    challenge_type = sys.argv[3]  # "2fa" ou "checkpoint"
    session_token = sys.argv[4]
    two_factor_identifier = sys.argv[5] if len(sys.argv) > 5 else ""

    session_file = os.path.join(tempfile.gettempdir(), f"ig_session_{session_token}.json")

    if not os.path.exists(session_file):
        print(json.dumps({"status": "error", "error": "Sessao expirada ou invalida. Faca login novamente."}))
        return

    try:
        from instagrapi import Client
    except ImportError:
        print(json.dumps({"status": "error", "error": "instagrapi nao esta instalado."}))
        return

    try:
        with open(session_file, "r") as f:
            settings = json.load(f)
    except Exception as e:
        print(json.dumps({"status": "error", "error": f"Erro ao ler sessao: {e}"}))
        return

    # Extrai metadados extras do estado salvo
    extra = settings.pop("__extra__", {})
    saved_last_json = extra.get("last_json", {})

    cl = Client()
    cl.set_settings(settings)

    # Restaura last_json — necessário para challenge_send_security_code saber o endpoint
    if saved_last_json:
        cl.last_json = saved_last_json

    try:
        if challenge_type == "2fa":
            cl.two_factor_login(
                verification_code=code,
                two_factor_identifier=two_factor_identifier,
                username=username,
            )

        elif challenge_type == "checkpoint":
            # Envia o código digitado pelo usuário para completar o checkpoint
            try:
                cl.challenge_send_security_code(int(code))
            except (ValueError, TypeError):
                cl.challenge_send_security_code(code)

        else:
            print(json.dumps({"status": "error", "error": f"Tipo de desafio desconhecido: {challenge_type}"}))
            return

        # Remove arquivo de sessão temporário
        try:
            os.remove(session_file)
        except Exception:
            pass

        _return_profile(cl, username)

    except Exception as e:
        err_lower = str(e).lower()
        if any(k in err_lower for k in ["invalid", "expired", "wrong", "incorrect", "bad", "code", "invalido"]):
            print(json.dumps({"status": "error", "error": "Codigo invalido ou expirado. Tente novamente."}))
        else:
            print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    main()
