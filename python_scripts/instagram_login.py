"""
instagram_login.py
Tenta login no Instagram via instagrapi e retorna JSON no stdout.

Uso: python instagram_login.py <username> <password>

Saída:
  Sucesso:    {"status": "ok", "username": "...", ...}
  Código 2FA: {"status": "requires_code", "challenge_type": "2fa",        "verification_method": "authenticator", ...}
  Checkpoint: {"status": "requires_code", "challenge_type": "checkpoint", "verification_method": "sms"|"email", ...}
  Erro:       {"status": "error", "error": "mensagem"}
"""

import sys
import json
import os
import tempfile
import uuid
import logging

logging.disable(logging.CRITICAL)


def _save_session(cl, extra: dict) -> str:
    token = str(uuid.uuid4())
    path = os.path.join(tempfile.gettempdir(), f"ig_session_{token}.json")
    try:
        settings = cl.get_settings()
        settings["__extra__"] = extra
        with open(path, "w") as f:
            json.dump(settings, f)
        return token
    except Exception:
        return ""


def _return_profile(cl, username: str):
    try:
        user_info = cl.account_info()
        print(json.dumps({
            "status": "ok",
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
            "username": username,
            "full_name": "",
            "biography": "",
            "followers": 0,
            "following": 0,
            "profile_pic_url": None,
            "is_private": False,
        }))


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "error": "Uso: instagram_login.py <username> <password>"}))
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
        print(json.dumps({"status": "error", "error": "instagrapi nao esta instalado. Execute: pip install instagrapi"}))
        return

    cl = Client()

    try:
        cl.login(username, password)
        _return_profile(cl, username)

    except TwoFactorRequired:
        two_factor_identifier = ""
        try:
            two_factor_identifier = (cl.last_json or {}).get("two_factor_info", {}).get("two_factor_identifier", "")
        except Exception:
            pass

        token = _save_session(cl, {"last_json": cl.last_json or {}})
        if not token:
            print(json.dumps({"status": "error", "error": "Erro ao salvar sessao 2FA."}))
            return

        print(json.dumps({
            "status": "requires_code",
            "challenge_type": "2fa",
            "verification_method": "authenticator",
            "session_token": token,
            "two_factor_identifier": two_factor_identifier,
            "username": username,
        }))

    except ChallengeRequired:
        challenge_response = {}
        verification_method = "sms"

        try:
            challenge_response = cl.challenge_resolve(cl.last_json) or {}
            step_name = challenge_response.get("step_name", "").lower()
            step_data = challenge_response.get("step_data", {}) or {}
            contact = step_data.get("contact_point", "") or ""

            if "email" in step_name or ("@" in contact and "*" in contact):
                verification_method = "email"
            else:
                verification_method = "sms"
        except Exception:
            pass

        # last_json já foi atualizado pelo challenge_resolve com o estado do desafio
        token = _save_session(cl, {
            "last_json": cl.last_json or {},
            "challenge_response": challenge_response,
        })
        if not token:
            print(json.dumps({"status": "error", "error": "Erro ao salvar sessao de verificacao."}))
            return

        print(json.dumps({
            "status": "requires_code",
            "challenge_type": "checkpoint",
            "verification_method": verification_method,
            "session_token": token,
            "username": username,
        }))

    except BadPassword:
        print(json.dumps({"status": "error", "error": "Senha incorreta."}))
    except PleaseWaitFewMinutes:
        print(json.dumps({"status": "error", "error": "O Instagram pediu para aguardar alguns minutos. Tente novamente em breve."}))
    except LoginRequired:
        print(json.dumps({"status": "error", "error": "Login recusado pelo Instagram. Aguarde alguns minutos e tente novamente."}))
    except UnknownError as e:
        print(json.dumps({"status": "error", "error": f"Erro desconhecido do Instagram: {e}"}))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    main()
