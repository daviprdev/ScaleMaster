"""
instagram_login.py
Tenta fazer login no Instagram via instagrapi e retorna JSON no stdout.

Uso: python instagram_login.py <username> <password>

Saída (stdout):
  Sucesso: {"success": true, "username": "...", "full_name": "...", ...}
  Erro:    {"success": false, "error": "mensagem de erro"}
"""

import sys
import json


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "success": False,
            "error": "Argumentos insuficientes. Uso: instagram_login.py <username> <password>"
        }))
        return

    username = sys.argv[1].lstrip("@").strip()
    password = sys.argv[2]

    try:
        from instagrapi import Client
        from instagrapi.exceptions import (
            BadPassword,
            ChallengeRequired,
            TwoFactorRequired,
            LoginRequired,
            PleaseWaitFewMinutes,
            UnknownError,
        )
    except ImportError:
        print(json.dumps({
            "success": False,
            "error": "instagrapi nao esta instalado. Execute: pip install instagrapi"
        }))
        return

    try:
        cl = Client()
        # Reduzir noise de logs internos para nao poluir o stdout
        import logging
        logging.disable(logging.CRITICAL)

        cl.login(username, password)

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

    except BadPassword:
        print(json.dumps({"success": False, "error": "Senha incorreta."}))
    except TwoFactorRequired:
        print(json.dumps({"success": False, "error": "Esta conta usa autenticacao de dois fatores (2FA). Desative o 2FA temporariamente para conectar."}))
    except ChallengeRequired:
        print(json.dumps({"success": False, "error": "O Instagram pediu uma verificacao de seguranca. Abra o app e confirme o login, depois tente novamente."}))
    except PleaseWaitFewMinutes:
        print(json.dumps({"success": False, "error": "O Instagram pediu para aguardar alguns minutos. Tente novamente em breve."}))
    except LoginRequired:
        print(json.dumps({"success": False, "error": "Login recusado pelo Instagram. Aguarde alguns minutos e tente novamente."}))
    except UnknownError as e:
        print(json.dumps({"success": False, "error": f"Erro desconhecido do Instagram: {e}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
