"""
instagram_verify2fa.py
Completa o login com código 2FA e retorna JSON no stdout.

Uso: python instagram_verify2fa.py <username> <code> <two_factor_identifier> <session_token>

Saída (stdout):
  Sucesso:  {"success": true, "username": "...", "full_name": "...", ...}
  Erro:     {"success": false, "error": "mensagem"}
"""

import sys
import json
import os
import tempfile
import logging

logging.disable(logging.CRITICAL)


def main():
    if len(sys.argv) < 5:
        print(json.dumps({
            "success": False,
            "error": "Argumentos insuficientes. Uso: instagram_verify2fa.py <username> <code> <two_factor_identifier> <session_token>"
        }))
        return

    username = sys.argv[1]
    verification_code = sys.argv[2].replace(" ", "").strip()
    two_factor_identifier = sys.argv[3]
    session_token = sys.argv[4]

    session_file = os.path.join(tempfile.gettempdir(), f"ig_session_{session_token}.json")

    if not os.path.exists(session_file):
        print(json.dumps({
            "success": False,
            "error": "Sessão 2FA expirada ou inválida. Faça login novamente."
        }))
        return

    try:
        from instagrapi import Client
        from instagrapi.exceptions import (
            TwoFactorRequired,
            BadPassword,
            LoginRequired,
            UnknownError,
        )
    except ImportError:
        print(json.dumps({
            "success": False,
            "error": "instagrapi nao esta instalado. Execute: pip install instagrapi"
        }))
        return

    cl = Client()

    try:
        with open(session_file, "r") as f:
            settings = json.load(f)
        cl.set_settings(settings)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Erro ao restaurar sessão: {e}"}))
        return

    try:
        cl.login_by_sessionid  # warm up client attrs silently
    except Exception:
        pass

    try:
        cl.two_factor_login(
            verification_code=verification_code,
            two_factor_identifier=two_factor_identifier,
            username=username,
        )
        # Limpa o arquivo de sessão após login bem-sucedido
        try:
            os.remove(session_file)
        except Exception:
            pass
        _return_profile(cl, username)

    except Exception as e:
        err = str(e)
        if "two_factor" in err.lower() or "verification" in err.lower() or "invalid" in err.lower() or "code" in err.lower():
            print(json.dumps({"success": False, "error": "Código 2FA inválido ou expirado. Tente novamente."}))
        else:
            print(json.dumps({"success": False, "error": err}))


def _return_profile(cl, username: str):
    try:
        user_info = cl.account_info()
        print(json.dumps({
            "success": True,
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
            "success": True,
            "username": username,
            "full_name": "",
            "biography": "",
            "followers": 0,
            "following": 0,
            "profile_pic_url": None,
            "is_private": False,
        }))


if __name__ == "__main__":
    main()
