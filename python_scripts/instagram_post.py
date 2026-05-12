"""
instagram_post.py
Posta um vídeo (Reel/Clip) no Instagram via instagrapi.

Uso: python instagram_post.py <username> <video_url> <caption> <session_file>

  session_file: caminho para o arquivo JSON com as configuracoes da sessao
                (gerado pelo instagram_login.py e salvo pelo backend)

Saida:
  Sucesso: {"status": "ok", "media_id": "...", "code": "..."}
  Erro:    {"status": "error", "error": "mensagem"}
"""

import sys
import json
import os
import tempfile
import logging
import urllib.request

logging.disable(logging.CRITICAL)


def main():
    if len(sys.argv) < 5:
        print(json.dumps({
            "status": "error",
            "error": "Uso: instagram_post.py <username> <video_url> <caption> <session_file>"
        }))
        return

    username = sys.argv[1].lstrip("@").strip()
    video_url = sys.argv[2]
    caption = sys.argv[3]
    session_file = sys.argv[4]

    if not os.path.exists(session_file):
        print(json.dumps({"status": "error", "error": "Sessao nao encontrada. Reconecte a conta no painel."}))
        return

    try:
        with open(session_file, "r") as f:
            settings = json.load(f)
    except Exception as e:
        print(json.dumps({"status": "error", "error": f"Erro ao ler arquivo de sessao: {e}"}))
        return

    try:
        from instagrapi import Client
    except ImportError:
        print(json.dumps({"status": "error", "error": "instagrapi nao instalado. Execute: pip install instagrapi"}))
        return

    cl = Client()
    cl.set_settings(settings)

    tmp_video = None
    try:
        # Baixa o video para arquivo temporario
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            tmp_video = f.name

        try:
            urllib.request.urlretrieve(video_url, tmp_video)
        except Exception as e:
            print(json.dumps({"status": "error", "error": f"Erro ao baixar video: {e}"}))
            return

        # Posta como Reel (clip_upload)
        try:
            media = cl.clip_upload(tmp_video, caption=caption)
            print(json.dumps({
                "status": "ok",
                "media_id": str(media.id),
                "code": getattr(media, "code", ""),
            }))
        except Exception as e:
            err_lower = str(e).lower()
            if any(k in err_lower for k in ["login", "session", "auth", "unauthorized", "not logged", "400 bad request"]):
                print(json.dumps({"status": "error", "error": "Sessao expirada. Reconecte a conta no painel."}))
            else:
                print(json.dumps({"status": "error", "error": str(e)}))

    finally:
        if tmp_video and os.path.exists(tmp_video):
            try:
                os.remove(tmp_video)
            except Exception:
                pass


if __name__ == "__main__":
    main()
