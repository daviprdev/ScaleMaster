"""
instagram_login.py
Tenta login no Instagram via instagrapi e retorna JSON no stdout.

Uso: python instagram_login.py <username> <password>

Saída (stdout):
  Sucesso:  {"success": true, "username": "...", "full_name": "...", ...}
  2FA:      {"success": false, "requires_2fa": true, "session_token": "...", "two_factor_identifier": "..."}
  Erro:     {"success": false, "error": "mensagem"}
"""

import sys
import json
import os
import tempfile
import uuid
import logging

logging.disable(logging.CRITICAL)


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

    cl = Client()

    try:
        cl.login(username, password)
        _return_profile(cl, username)

    except TwoFactorRequired:
        # Preserva o estado da sessão (cookies do desafio) para o segundo passo
        session_token = str(uuid.uuid4())
        session_file = os.path.join(tempfile.gettempdir(), f"ig_session_{session_token}.json")

        try:
            settings = cl.get_settings()
            with open(session_file, "w") as f:
                json.dump(settings, f)
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Erro ao salvar sessão 2FA: {e}"}))
            return

        # Extrai o two_factor_identifier da última resposta da API do Instagram
        two_factor_identifier = ""
        try:
            last = cl.last_json or {}
            two_factor_identifier = last.get("two_factor_info", {}).get("two_factor_identifier", "")
        except Exception:
            pass

        print(json.dumps({
            "success": False,
            "requires_2fa": True,
            "session_token": session_token,
            "two_factor_identifier": two_factor_identifier,
            "username": username,
        }))

    except BadPassword:
        print(json.dumps({"success": False, "error": "Senha incorreta."}))
    except ChallengeRequired:
        print(json.dumps({"success": False, "error": "O Instagram pediu verificação de segurança. Abra o app, confirme o login e tente novamente."}))
    except PleaseWaitFewMinutes:
        print(json.dumps({"success": False, "error": "O Instagram pediu para aguardar alguns minutos. Tente novamente em breve."}))
    except LoginRequired:
        print(json.dumps({"success": False, "error": "Login recusado pelo Instagram. Aguarde alguns minutos e tente novamente."}))
    except UnknownError as e:
        print(json.dumps({"success": False, "error": f"Erro desconhecido do Instagram: {e}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


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
    except Exception as e:
        # Login ok mas falhou ao buscar perfil — retorna sucesso parcial
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
