"""
AutoScale - Onboarding RPA HIBRIDO (Instagrapi Mobile -> Playwright Web).
Fluxo:
FASE 1 (Instagrapi Mobile):
  1a. Login mobile via instagrapi
  1b. Postar story com sticker de link
  1c. Trocar foto de perfil
  1d. Criar destaque a partir do story
  1e. Extrair cookies da sessao para injetar no Playwright
FASE 2 (Playwright Web - com cookies injetados):
  2a. Navegar para Instagram (ja logado via cookies)
  2b. Converter para conta profissional (criador de conteudo)
  2c. Aceitar convite de tester
  2d. OAuth / Magic Link do SaaS
"""
import os
import asyncio
import subprocess
import tempfile
import uuid
import traceback
from pathlib import Path
from typing import Optional
from dataclasses import dataclass
import httpx
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

PROFILES_DIR = Path(os.environ.get("ONBOARDING_PROFILES_DIR", "/tmp/onboarding_profiles"))
PROFILES_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_TIMEOUT = 60_000
NAVIGATION_TIMEOUT = 60_000


@dataclass
class RPAResult:
    success: bool
    stage: str
    message: str
    cookies: Optional[list] = None
    error_code: Optional[str] = None


class InstagramRPA:
    def __init__(self, username, password, proxy_url, totp_secret=None, device_seed=None):
        self.username = username
        self.password = password
        self.proxy_url = proxy_url
        self.totp_secret = totp_secret
        self.device_seed = device_seed or username
        self.profile_dir = PROFILES_DIR / self._safe_filename(username)
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self.context = None
        self.page = None
        self.playwright = None
        self.ig_client = None

    def _safe_filename(self, name):
        return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)

    async def _download_to_temp(self, url, suffix=""):
        if not url or not url.strip():
            raise ValueError("URL vazia")
        if not url.startswith(("http://", "https://")):
            return url
        print(f"[RPA:{self.username}] Download: {url[:120]}...")
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        print(f"[RPA:{self.username}] Download OK: {len(resp.content)} bytes")
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(resp.content)
        tmp.close()
        return tmp.name

    def _parse_proxy_playwright(self, proxy_url):
        proxy_url = proxy_url.strip()
        if not proxy_url.startswith(("http://", "https://", "socks")) and proxy_url.count(":") >= 3:
            parts = proxy_url.split(":", 3)
            host, port, user, pwd = parts[0], parts[1], parts[2], parts[3]
            if "{session_id}" in user:
                user = user.replace("{session_id}", uuid.uuid4().hex[:8])
            return {"server": f"http://{host}:{port}", "username": user, "password": pwd}
        from urllib.parse import urlparse
        if "://" not in proxy_url:
            proxy_url = "http://" + proxy_url
        p = urlparse(proxy_url)
        r = {"server": f"{p.scheme}://{p.hostname}:{p.port}"}
        if p.username:
            r["username"] = p.username
        if p.password:
            r["password"] = p.password
        return r

    def _parse_proxy_instagrapi(self, proxy_url):
        proxy_url = proxy_url.strip()
        if not proxy_url.startswith(("http://", "https://", "socks")) and proxy_url.count(":") >= 3:
            parts = proxy_url.split(":", 3)
            host, port, user, pwd = parts[0], parts[1], parts[2], parts[3]
            if "{session_id}" in user:
                user = user.replace("{session_id}", uuid.uuid4().hex[:8])
            return f"http://{user}:{pwd}@{host}:{port}"
        return proxy_url

    # ── INSTAGRAPI (FASE 1) ─────────────────────────────────────
    def _init_instagrapi(self):
        """Login mobile via instagrapi."""
        try:
            from instagrapi import Client
            cl = Client()
            cl.set_device({
                "manufacturer": "samsung",
                "model": "SM-G998B",
                "device": "o1s",
                "cpu": "exynos2100",
                "android_version": 33,
                "android_release": "13",
                "dpi": 420,
                "resolution": [1080, 2400],
            })
            if self.proxy_url:
                # Configura proxy se existir — converte formato host:port:user:pass
                # para http://user:pass@host:port (formato esperado pelo instagrapi/requests)
                proxy_str = self.proxy_url.strip()
                if not proxy_str.startswith(("http://", "https://", "socks")) and proxy_str.count(":") >= 3:
                    parts = proxy_str.split(":", 3)
                    host, port, user, password = parts[0], parts[1], parts[2], parts[3]
                    proxy_str = f"http://{user}:{password}@{host}:{port}"
                    print(f"[RPA:{self.username}] Proxy instagrapi convertido: {host}:{port}")
                cl.set_proxy(proxy_str)
            print(f"[RPA:{self.username}] Login mobile instagrapi...")
            if self.totp_secret:
                cl.login(self.username, self.password, verification_code=self._generate_totp(self.totp_secret))
            else:
                cl.login(self.username, self.password)
            ui = cl.user_info_by_username(self.username)
            print(f"[RPA:{self.username}] Instagrapi OK: @{ui.username} ({ui.pk})")
            self.ig_client = cl
            return True
        except Exception as e:
            print(f"[RPA:{self.username}] Erro instagrapi: {type(e).__name__}: {e}")
            traceback.print_exc()
            return False

    def _extract_cookies_from_instagrapi(self):
        """Extrai cookies da sessao do instagrapi para injetar no Playwright."""
        if not self.ig_client:
            return []
        try:
            cookies = []
            # instagrapi armazena cookies no objeto private
            if hasattr(self.ig_client, 'private') and hasattr(self.ig_client.private, 'cookies'):
                jar = self.ig_client.private.cookies
                for cookie in jar:
                    c = {
                        "name": cookie.name,
                        "value": cookie.value,
                        "domain": cookie.domain or ".instagram.com",
                        "path": cookie.path or "/",
                    }
                    if cookie.expires:
                        c["expires"] = cookie.expires
                    cookies.append(c)
            # Fallback: tentar extrair do session
            if not cookies and hasattr(self.ig_client, 'private'):
                session = getattr(self.ig_client.private, 'session', None) or getattr(self.ig_client, '_session', None)
                if session and hasattr(session, 'cookies'):
                    for name, value in session.cookies.items():
                        cookies.append({
                            "name": name,
                            "value": value,
                            "domain": ".instagram.com",
                            "path": "/",
                        })
            # Garantir que sessionid esteja presente
            has_sessionid = any(c["name"] == "sessionid" for c in cookies)
            if not has_sessionid and hasattr(self.ig_client, 'token'):
                cookies.append({
                    "name": "sessionid",
                    "value": self.ig_client.token,
                    "domain": ".instagram.com",
                    "path": "/",
                })
            print(f"[RPA:{self.username}] Cookies extraidos do instagrapi: {len(cookies)}")
            return cookies
        except Exception as e:
            print(f"[RPA:{self.username}] Erro extraindo cookies: {e}")
            return []

    def _upload_video_thumb(self, video_path, link_sticker):
        import pathlib as pl
        thumb = video_path + ".jpg"
        try:
            r = subprocess.run(["ffmpeg", "-y", "-i", video_path, "-vframes", "1", "-q:v", "2", thumb], capture_output=True, timeout=30)
            if r.returncode == 0 and os.path.exists(thumb):
                return self.ig_client.video_upload_to_story(path=pl.Path(video_path), thumbnail=pl.Path(thumb), links=[link_sticker])
            return self.ig_client.video_upload_to_story(path=pl.Path(video_path), links=[link_sticker])
        except Exception as e:
            print(f"[RPA:{self.username}] ffmpeg err: {e}")
            return self.ig_client.video_upload_to_story(path=pl.Path(video_path), links=[link_sticker])
        finally:
            if os.path.exists(thumb):
                try:
                    os.unlink(thumb)
                except Exception:
                    pass

    async def post_story_with_link(self, media_path, link_url, link_text=None):
        if not self.ig_client:
            return RPAResult(False, "post_story", "Instagrapi nao init", error_code="instagrapi_not_ready")
        local = None
        try:
            local = await self._download_to_temp(media_path, suffix=".mp4")
            is_vid = local.lower().endswith((".mp4", ".mov", ".avi", ".webm"))
            from instagrapi.types import StoryLink
            ls = StoryLink(webUri=link_url, text=link_text or link_url)
            print(f"[RPA:{self.username}] Story: {link_url}")
            loop = asyncio.get_event_loop()
            if is_vid:
                await loop.run_in_executor(None, lambda: self._upload_video_thumb(local, ls))
            else:
                await loop.run_in_executor(None, lambda: self.ig_client.photo_upload_to_story(path=local, links=[ls]))
            return RPAResult(True, "post_story", "Story publicado")
        except Exception as e:
            print(f"[RPA:{self.username}] ERRO STORY: {traceback.format_exc()}")
            return RPAResult(False, "post_story", f"{type(e).__name__}: {e}", error_code="story_failed")
        finally:
            if local and local != media_path and os.path.exists(local):
                os.unlink(local)

    async def change_profile_photo(self, photo_path):
        if not self.ig_client:
            return RPAResult(False, "change_photo", "Instagrapi nao init", error_code="instagrapi_not_ready")
        local = None
        try:
            local = await self._download_to_temp(photo_path, suffix=".jpg")
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: self.ig_client.account_change_picture(local))
            return RPAResult(True, "change_photo", "Foto alterada")
        except Exception as e:
            print(f"[RPA:{self.username}] Erro foto: {traceback.format_exc()}")
            return RPAResult(False, "change_photo", f"{type(e).__name__}: {e}", error_code="photo_failed")
        finally:
            if local and local != photo_path and os.path.exists(local):
                os.unlink(local)

    async def create_highlight_from_story(self, title):
        if not self.ig_client:
            return RPAResult(False, "highlight", "Instagrapi nao init", error_code="instagrapi_not_ready")
        try:
            uid = self.ig_client.user_id
            loop = asyncio.get_event_loop()
            stories = await loop.run_in_executor(None, lambda: self.ig_client.user_stories(uid))
            if not stories:
                return RPAResult(False, "highlight", "Sem story recente", error_code="no_stories")
            pk = stories[0].pk
            await loop.run_in_executor(None, lambda: self.ig_client.highlight_create(title, [pk]))
            return RPAResult(True, "highlight", f"Destaque '{title}' criado")
        except Exception as e:
            print(f"[RPA:{self.username}] Erro destaque: {traceback.format_exc()}")
            return RPAResult(False, "highlight", f"{type(e).__name__}: {e}", error_code="highlight_failed")

    # ── PLAYWRIGHT (FASE 2) ─────────────────────────────────────
    async def start(self, inject_cookies=None):
        self.playwright = await async_playwright().start()
        self.context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.profile_dir),
            headless=False,
            proxy=self._parse_proxy_playwright(self.proxy_url) if self.proxy_url else None,
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
            ignore_https_errors=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ],
            ignore_default_args=["--enable-automation"],
        )
        await self.context.add_init_script("""
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['pt-BR', 'pt', 'en']});
window.chrome = {runtime: {}};
""")
        # Injetar cookies do instagrapi antes de criar pagina
        if inject_cookies:
            try:
                await self.context.add_cookies(inject_cookies)
                print(f"[RPA:{self.username}] Cookies injetados no Playwright: {len(inject_cookies)}")
            except Exception as e:
                print(f"[RPA:{self.username}] Erro injetando cookies: {e}")
        self.page = await self.context.new_page()
        self.page.set_default_timeout(DEFAULT_TIMEOUT)
        self.page.set_default_navigation_timeout(NAVIGATION_TIMEOUT)

    async def stop(self):
        if self.context:
            await self.context.close()
        if self.playwright:
            await self.playwright.stop()

    async def get_cookies(self):
        return await self.context.cookies() if self.context else []

    def _generate_totp(self, secret):
        import pyotp
        return pyotp.TOTP(secret).now()

    async def _is_logged_in(self):
        try:
            if "/accounts/login" not in self.page.url and "instagram.com" in self.page.url:
                return True
            return (await self.page.query_selector('nav[aria-label="Home"]')) is not None
        except Exception:
            return False

    async def convert_to_professional(self):
        """Converte conta para profissional (criador de conteudo) via web."""
        try:
            print(f"[RPA:{self.username}] Verificando tipo de conta...")
            await self.page.goto("https://www.instagram.com/accounts/settings/", wait_until="networkidle", timeout=30000)
            await self.page.wait_for_timeout(3000)
            for text in ["Mudar para conta profissional", "Switch to professional account", "Conta profissional", "Professional account"]:
                btn = await self.page.query_selector(f'text="{text}"')
                if btn:
                    print(f"[RPA:{self.username}] Botao converter encontrado: {text}")
                    await btn.click()
                    await self.page.wait_for_timeout(3000)
                    creator = await self.page.query_selector('text="Criador de conteudo"')
                    if not creator:
                        creator = await self.page.query_selector('text="Content creator"')
                    if not creator:
                        creator = await self.page.query_selector('text="Creator"')
                    if creator:
                        await creator.click()
                        await self.page.wait_for_timeout(2000)
                    confirm = await self.page.query_selector('div[role="button"]:has-text("Avancar")')
                    if not confirm:
                        confirm = await self.page.query_selector('div[role="button"]:has-text("Next")')
                    if not confirm:
                        confirm = await self.page.query_selector('div[role="button"]:has-text("Concluir")')
                    if not confirm:
                        confirm = await self.page.query_selector('div[role="button"]:has-text("Done")')
                    if confirm:
                        await confirm.click()
                        await self.page.wait_for_timeout(3000)
                        print(f"[RPA:{self.username}] Conta convertida para profissional")
                        return RPAResult(True, "convert", "Conta profissional")
            print(f"[RPA:{self.username}] Ja e conta profissional ou botao nao encontrado")
            return RPAResult(True, "convert", "Ja profissional ou ignorado")
        except Exception as e:
            print(f"[RPA:{self.username}] Erro converter: {e}")
            return RPAResult(True, "convert", f"Ignorado: {e}")

    async def accept_tester_invite(self):
        try:
            print(f"[RPA:{self.username}] Verificando convite tester...")
            await self.page.goto("https://www.instagram.com/accounts/manage_access/", wait_until="networkidle", timeout=30000)
            await self.page.wait_for_timeout(3000)
            btn = await self.page.query_selector('button:has-text("Aceitar")')
            if not btn:
                btn = await self.page.query_selector('button:has-text("Accept")')
            if not btn:
                btn = await self.page.query_selector('div[role="button"]:has-text("Aceitar")')
            if not btn:
                btn = await self.page.query_selector('div[role="button"]:has-text("Accept")')
            if btn:
                await btn.click()
                await self.page.wait_for_timeout(3000)
                print(f"[RPA:{self.username}] Convite aceito")
                return RPAResult(True, "accept_invite", "Convite aceito")
            print(f"[RPA:{self.username}] Sem convite pendente")
            return RPAResult(True, "accept_invite", "Sem convite")
        except Exception as e:
            print(f"[RPA:{self.username}] Erro convite: {e}")
            return RPAResult(True, "accept_invite", f"Ignorado: {e}")

    async def complete_magic_link(self, magic_link_url):
        from urllib.parse import urlencode
        try:
            params = urlencode({"username": self.username})
            sep = "&" if "?" in magic_link_url else "?"
            url = f"{magic_link_url}{sep}{params}"
            print(f"[RPA:{self.username}] Magic Link: {url[:120]}...")
            await self.page.goto(url, wait_until="networkidle", timeout=30000)
            try:
                await self.page.wait_for_url("**/add/success**", timeout=15000)
                return RPAResult(True, "magic_link", "Conta vinculada")
            except PlaywrightTimeout:
                cur = self.page.url
                if any(x in cur for x in ["/dashboard", "/accounts", "/success", "/connected"]):
                    return RPAResult(True, "magic_link", "Vinculada (redirect)")
                return RPAResult(False, "magic_link", f"Falhou: {cur}", error_code="magic_link_failed")
        except Exception as e:
            return RPAResult(False, "magic_link", f"{type(e).__name__}: {e}", error_code="magic_link_error")


async def run_onboarding_rpa(
    username,
    password,
    proxy_url,
    totp_secret,
    photo_path,
    story_media_path,
    story_link_url,
    story_link_text=None,
    highlight_title=None,
    magic_link_url=None,
    profile_dir=None,
    existing_cookies=None,
):
    """
    Fluxo completo:
    FASE 1: Instagrapi mobile (login + story + foto + destaque + extrair cookies)
    FASE 2: Playwright web com cookies injetados (converter + convite + OAuth)
    """
    if not totp_secret or not totp_secret.strip():
        return {"success": False, "stage": "validation", "message": "TOTP obrigatorio", "error_code": "needs_2fa"}

    rpa = InstagramRPA(username, password, proxy_url, totp_secret)
    try:
        # ═══ FASE 1: INSTAGRAPI MOBILE ═══
        if not rpa._init_instagrapi():
            return {
                "success": False,
                "stage": "instagrapi_login",
                "message": "Falha login mobile via instagrapi",
                "error_code": "instagrapi_login_failed",
            }
        print(f"[RPA:{username}] FASE 1a OK: Login mobile")

        # 1b. Postar story
        if story_media_path and story_link_url:
            sr = await rpa.post_story_with_link(story_media_path, story_link_url, story_link_text)
            if not sr.success:
                return {"success": False, "stage": "post_story", "message": sr.message, "error_code": sr.error_code}
            print(f"[RPA:{username}] FASE 1b OK: Story publicado")

        # 1c. Trocar foto de perfil
        if photo_path:
            pr = await rpa.change_profile_photo(photo_path)
            if not pr.success:
                return {"success": False, "stage": "change_photo", "message": pr.message, "error_code": pr.error_code}
            print(f"[RPA:{username}] FASE 1c OK: Foto de perfil")

        # 1d. Criar destaque
        if highlight_title:
            hr = await rpa.create_highlight_from_story(highlight_title)
            if not hr.success:
                return {"success": False, "stage": "highlight", "message": hr.message, "error_code": hr.error_code}
            print(f"[RPA:{username}] FASE 1d OK: Destaque criado")

        # 1e. Extrair cookies do instagrapi para injetar no Playwright
        ig_cookies = rpa._extract_cookies_from_instagrapi()
        print(f"[RPA:{username}] FASE 1e OK: {len(ig_cookies)} cookies extraidos")

        # ═══ FASE 2: PLAYWRIGHT WEB (com cookies injetados) ═══
        await rpa.start(inject_cookies=ig_cookies)

        # 2a. Verificar se ja esta logado via cookies
        if not await rpa._is_logged_in():
            return {
                "success": False,
                "stage": "playwright_login",
                "message": "Cookies do instagrapi nao autenticaram no Playwright",
                "error_code": "cookie_auth_failed",
            }
        print(f"[RPA:{username}] FASE 2a OK: Logado via cookies")

        # 2b. Converter para conta profissional
        cr = await rpa.convert_to_professional()
        print(f"[RPA:{username}] FASE 2b OK: {cr.message}")

        # 2c. Aceitar convite de tester
        ir = await rpa.accept_tester_invite()
        print(f"[RPA:{username}] FASE 2c OK: {ir.message}")

        # 2d. OAuth / Magic Link do SaaS
        if magic_link_url:
            ml = await rpa.complete_magic_link(magic_link_url)
            if not ml.success:
                return {"success": False, "stage": "magic_link", "message": ml.message, "error_code": ml.error_code}
            print(f"[RPA:{username}] FASE 2d OK: OAuth/Magic Link")

        return {
            "success": True,
            "stage": "done",
            "message": "Onboarding completo (Instagrapi -> Playwright)",
        }
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[RPA] ERRO GLOBAL: {tb}")
        return {
            "success": False,
            "stage": "unknown",
            "message": f"Erro inesperado: {type(e).__name__}: {e}",
            "error_code": "unexpected_error",
        }
    finally:
        await rpa.stop()