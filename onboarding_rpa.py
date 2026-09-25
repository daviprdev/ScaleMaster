"""
AutoScale - Onboarding automatizado HÍBRIDO (Playwright Web + Instagrapi Mobile).

Arquitetura:
  - Playwright (Chromium headless): usado APENAS para login inicial e aceite
    de convite de tester do App Meta — ações que exigem sessão web real.
  - Instagrapi (API privada mobile): usado para trocar foto de perfil, postar
    story com sticker de link (texto personalizado) e criar destaque — mais
    rápido, leve e menos detectável como bot do que automação de DOM.

Fluxo por conta:
  1. Abre Chromium com proxy dedicada e perfil persistente
  2. Faz login com user/senha/2FA via UI web (Playwright)
  3. Aceita convite de tester do App Meta via UI web (Playwright) — se aplicável
  4. Extrai cookies da sessão web e inicializa instagrapi.Client com eles
  5. Troca foto de perfil via instagrapi (mobile API)
  6. Posta story com mídia + sticker de link (texto personalizado) via instagrapi
  7. Cria destaque a partir do story via instagrapi
  8. Navega até Magic Link do SaaS via Playwright para vincular conta
  9. Salva cookies atualizados para reuso futuro

Retry inteligente: se der erro de IP/bloqueio, fecha o navegador, troca
a proxy e tenta de novo (até 6 vezes).
"""

import os
import json
import asyncio
import tempfile
import shutil
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

import httpx
from playwright.async_api import async_playwright, BrowserContext, Page, TimeoutError as PlaywrightTimeout

# Diretório base para perfis persistentes (cada conta tem sua pasta)
PROFILES_DIR = Path(os.environ.get("ONBOARDING_PROFILES_DIR", "/tmp/onboarding_profiles"))
PROFILES_DIR.mkdir(parents=True, exist_ok=True)

# Configurações
DEFAULT_TIMEOUT = 30_000  # 30 segundos
NAVIGATION_TIMEOUT = 60_000  # 60 segundos para navegação
MAX_RETRIES = 6


@dataclass
class RPAResult:
    success: bool
    stage: str
    message: str
    cookies: Optional[list[dict]] = None
    error_code: Optional[str] = None


class InstagramRPA:
    """Automação híbrida: Playwright (web) + Instagrapi (mobile) para onboarding."""

    def __init__(
        self,
        username: str,
        password: str,
        proxy_url: str,
        totp_secret: Optional[str] = None,
        device_seed: Optional[str] = None,
    ):
        self.username = username
        self.password = password
        self.proxy_url = proxy_url
        self.totp_secret = totp_secret
        self.device_seed = device_seed or username
        self.profile_dir = PROFILES_DIR / self._safe_filename(username)
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.playwright = None
        self.browser = None
        self.ig_client = None  # instagrapi.Client — inicializado após login web

    def _safe_filename(self, name: str) -> str:
        """Remove caracteres inválidos para nome de pasta."""
        return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)

    async def _download_to_temp(self, url: str, suffix: str = "") -> str:
        """Baixa uma URL para um arquivo temporário local. Retorna o path."""
        if not url or not url.strip():
            raise ValueError("URL vazia fornecida para download")
        if not url.startswith(("http://", "https://")):
            print(f"[RPA:{self.username}] Path local detectado: {url}")
            return url
        print(f"[RPA:{self.username}] Iniciando download: {url[:120]}...")
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(20.0, connect=10.0),
                follow_redirects=True,
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
            print(f"[RPA:{self.username}] Download OK: {len(resp.content)} bytes, status={resp.status_code}")
        except httpx.TimeoutException as te:
            print(f"[RPA:{self.username}] TIMEOUT no download após 20s: {te}")
            raise
        except httpx.HTTPStatusError as he:
            print(f"[RPA:{self.username}] HTTP {he.response.status_code} no download: {he}")
            raise
        except Exception as e:
            print(f"[RPA:{self.username}] ERRO no download: {type(e).__name__}: {e}")
            raise
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(resp.content)
        tmp.close()
        print(f"[RPA:{self.username}] Arquivo salvo: {tmp.name} ({len(resp.content)} bytes)")
        return tmp.name

    def _parse_proxy(self, proxy_url: str) -> dict:
        """Converte URL de proxy para formato do Playwright."""
        from urllib.parse import urlparse
        parsed = urlparse(proxy_url)
        proxy = {
            "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}",
        }
        if parsed.username:
            proxy["username"] = parsed.username
        if parsed.password:
            proxy["password"] = parsed.password
        return proxy

    async def start(self):
        """Inicia o Playwright e abre o navegador com perfil persistente."""
        self.playwright = await async_playwright().start()

        self.context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.profile_dir),
            headless=True,
            proxy=self._parse_proxy(self.proxy_url) if self.proxy_url else None,
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
            ignore_https_errors=True,
        )

        self.page = await self.context.new_page()
        self.page.set_default_timeout(DEFAULT_TIMEOUT)
        self.page.set_default_navigation_timeout(NAVIGATION_TIMEOUT)

    async def stop(self):
        """Fecha o navegador e limpa recursos."""
        if self.context:
            await self.context.close()
        if self.playwright:
            await self.playwright.stop()

    async def get_cookies(self) -> list[dict]:
        """Retorna os cookies atuais do contexto."""
        if self.context:
            return await self.context.cookies()
        return []

    def _init_instagrapi_from_cookies(self, cookies: list[dict]) -> bool:
        """Inicializa instagrapi.Client com os cookies extraídos do Playwright.

        Converte cookies do Playwright (formato web) para o formato de settings
        do instagrapi (sessão mobile). Retorna True se sucesso.
        """
        try:
            from instagrapi import Client

            cl = Client()

            # Configura proxy se existir
            if self.proxy_url:
                cl.set_proxy(self.proxy_url)

            # Extrai cookies relevantes do Instagram
            ig_cookies = {}
            for cookie in cookies:
                if "instagram.com" in cookie.get("domain", ""):
                    ig_cookies[cookie["name"]] = cookie["value"]

            # Verifica se temos os cookies essenciais
            required_cookies = ["sessionid", "csrftoken", "ds_user_id"]
            missing = [c for c in required_cookies if c not in ig_cookies]

            if missing:
                print(f"[RPA:{self.username}] ⚠️ Cookies essenciais faltando para instagrapi: {missing}")
                # Tenta fazer login direto pelo instagrapi como fallback
                print(f"[RPA:{self.username}] Tentando login direto via instagrapi...")
                cl.login(self.username, self.password)
            else:
                # Injeta cookies no instagrapi
                cl.set_cookies(ig_cookies)
                # Verifica se a sessão é válida
                try:
                    cl.user_info_by_username(self.username)
                    print(f"[RPA:{self.username}] ✅ Sessão instagrapi válida via cookies web")
                except Exception as e:
                    print(f"[RPA:{self.username}] ⚠️ Sessão web inválida no instagrapi: {e}")
                    print(f"[RPA:{self.username}] Tentando login direto via instagrapi...")
                    cl.login(self.username, self.password)

            # Configura 2FA se necessário
            if self.totp_secret:
                cl.enable_totp(self.totp_secret)

            self.ig_client = cl
            print(f"[RPA:{self.username}] ✅ Instagrapi inicializado com sucesso")
            return True

        except ImportError:
            print(f"[RPA:{self.username}] ❌ instagrapi não instalado — pip install instagrapi")
            return False
        except Exception as e:
            print(f"[RPA:{self.username}] ❌ Erro ao inicializar instagrapi: {e}")
            return False

    async def login(self) -> RPAResult:
        """Faz login no Instagram via UI real (Playwright)."""
        try:
            print(f"[RPA:{self.username}] Navegando para página de login...")
            await self.page.goto(
                "https://www.instagram.com/accounts/login/",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            print(f"[RPA:{self.username}] Página de login carregada: {self.page.url}")

            if await self._is_logged_in():
                return RPAResult(True, "login", "Já estava logado (cookies válidos)")

            await self.page.fill('input[name="username"]', self.username)
            await self.page.fill('input[name="password"]', self.password)
            await self.page.click('button[type="submit"]')
            await self.page.wait_for_timeout(3000)

            if await self._has_2fa_prompt():
                if not self.totp_secret:
                    return RPAResult(False, "login", "2FA solicitado mas nenhum TOTP secret fornecido", error_code="needs_2fa")

                totp_code = self._generate_totp(self.totp_secret)
                await self.page.fill('input[name="verificationCode"]', totp_code)
                await self.page.click('button[type="submit"]')
                await self.page.wait_for_timeout(3000)

            if await self._is_logged_in():
                return RPAResult(True, "login", "Login realizado com sucesso", cookies=await self.get_cookies())

            if await self._has_challenge():
                return RPAResult(False, "login", "Instagram solicitou verificação adicional (challenge)", error_code="challenge_required")

            return RPAResult(False, "login", "Login falhou - verifique credenciais", error_code="login_failed")

        except PlaywrightTimeout:
            return RPAResult(False, "login", "Timeout durante o login", error_code="timeout")
        except Exception as e:
            return RPAResult(False, "login", f"Erro durante login: {str(e)}", error_code="unknown_error")

    async def _is_logged_in(self) -> bool:
        try:
            current_url = self.page.url
            if "/accounts/login" not in current_url and "instagram.com" in current_url:
                return True
            nav = await self.page.query_selector('nav[aria-label="Home"]')
            return nav is not None
        except:
            return False

    async def _has_2fa_prompt(self) -> bool:
        try:
            el = await self.page.query_selector('input[name="verificationCode"]')
            return el is not None
        except:
            return False

    async def _has_challenge(self) -> bool:
        try:
            current_url = self.page.url
            return "/challenge/" in current_url or "/checkpoint/" in current_url
        except:
            return False

    def _generate_totp(self, secret: str) -> str:
        import pyotp
        totp = pyotp.TOTP(secret)
        return totp.now()

    async def accept_tester_invite(self, app_id: str) -> RPAResult:
        """Aceita convite de tester do App Meta via UI web (Playwright)."""
        try:
            print(f"[RPA:{self.username}] Navegando para página de convite tester (app {app_id})...")
            await self.page.goto(
                f"https://www.instagram.com/accounts/manage_access/?app_id={app_id}",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            await self.page.wait_for_timeout(3000)
            print(f"[RPA:{self.username}] Página de convite carregada: {self.page.url}")

            accept_selectors = [
                'button:has-text("Aceitar")',
                'button:has-text("Accept")',
                '[role="button"]:has-text("Aceitar")',
                '[role="button"]:has-text("Accept")',
                'div[role="button"]:has-text("Aceitar")',
            ]

            for selector in accept_selectors:
                try:
                    btn = await self.page.wait_for_selector(selector, timeout=5000)
                    if btn:
                        await btn.click()
                        await self.page.wait_for_timeout(3000)
                        return RPAResult(True, "accept_invite", f"Convite aceito para app {app_id}")
                except:
                    continue

            if await self._is_invite_already_accepted():
                return RPAResult(True, "accept_invite", "Convite já estava aceito")

            return RPAResult(False, "accept_invite", "Não encontrou botão de aceitar convite", error_code="invite_button_not_found")

        except Exception as e:
            return RPAResult(False, "accept_invite", f"Erro ao aceitar convite: {str(e)}", error_code="unknown_error")

    async def _is_invite_already_accepted(self) -> bool:
        try:
            text = await self.page.inner_text("body")
            return "conectado" in text.lower() or "connected" in text.lower()
        except:
            return False

    # ═══════════════════════════════════════════════════════════════
    # ETAPAS VIA INSTAGRAPI (Mobile API)
    # ═══════════════════════════════════════════════════════════════

    async def change_profile_photo(self, photo_path: str) -> RPAResult:
        """Troca foto de perfil via instagrapi (mobile API)."""
        if not self.ig_client:
            return RPAResult(False, "change_photo", "Instagrapi não inicializado", error_code="instagrapi_not_ready")

        local_photo = None
        try:
            print(f"[RPA:{self.username}] Baixando foto de perfil...")
            local_photo = await self._download_to_temp(photo_path, suffix=".jpg")
            print(f"[RPA:{self.username}] Foto baixada: {local_photo}")

            # Usa instagrapi para trocar foto (API mobile)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: self.ig_client.account_change_picture(local_photo))

            print(f"[RPA:{self.username}] ✅ Foto de perfil alterada via instagrapi")
            return RPAResult(True, "change_photo", "Foto de perfil alterada com sucesso")

        except Exception as e:
            return RPAResult(False, "change_photo", f"Erro ao trocar foto: {str(e)}", error_code="unknown_error")
        finally:
            if local_photo and local_photo != photo_path and os.path.exists(local_photo):
                os.unlink(local_photo)

    async def post_story_with_link(self, media_path: str, link_url: str, link_text: str | None = None) -> RPAResult:
        """Posta story com mídia e sticker de link via instagrapi (mobile API).

        Args:
            media_path: URL ou caminho local da mídia (imagem/vídeo)
            link_url: URL do sticker de link
            link_text: Texto personalizado do sticker (opcional). Se None, usa a URL.
        """
        if not self.ig_client:
            return RPAResult(False, "post_story", "Instagrapi não inicializado", error_code="instagrapi_not_ready")

        local_media = None
        try:
            print(f"[RPA:{self.username}] Baixando mídia do story...")
            local_media = await self._download_to_temp(media_path, suffix=".mp4")
            print(f"[RPA:{self.username}] Mídia baixada: {local_media}")

            # Determina se é vídeo ou imagem
            is_video = local_media.lower().endswith((".mp4", ".mov", ".avi", ".webm"))

            # Configura o sticker de link com texto personalizado
            from instagrapi.types import StoryLink

            link_sticker = StoryLink(
                webUri=link_url,
                text=link_text or link_url,  # Usa texto personalizado ou URL como fallback
            )

            print(f"[RPA:{self.username}] Postando story com link: {link_url} (texto: '{link_text or link_url}')")

            loop = asyncio.get_event_loop()
            if is_video:
                await loop.run_in_executor(
                    None,
                    lambda: self.ig_client.clip_upload_as_story(local_media, links=[link_sticker])
                )
            else:
                await loop.run_in_executor(
                    None,
                    lambda: self.ig_client.photo_upload_as_story(local_media, links=[link_sticker])
                )

            print(f"[RPA:{self.username}] ✅ Story publicado com sucesso via instagrapi")
            return RPAResult(True, "post_story", "Story publicado com sucesso")

        except Exception as e:
            return RPAResult(False, "post_story", f"Erro ao postar story: {str(e)}", error_code="unknown_error")
        finally:
            if local_media and local_media != media_path and os.path.exists(local_media):
                os.unlink(local_media)

    async def create_highlight_from_story(self, title: str) -> RPAResult:
        """Cria destaque a partir do story mais recente via instagrapi (mobile API)."""
        if not self.ig_client:
            return RPAResult(False, "create_highlight", "Instagrapi não inicializado", error_code="instagrapi_not_ready")

        try:
            print(f"[RPA:{self.username}] Buscando stories recentes para criar destaque...")

            # Obtém o user_id
            user_id = self.ig_client.user_id

            # Busca stories recentes do próprio usuário
            loop = asyncio.get_event_loop()
            stories = await loop.run_in_executor(None, lambda: self.ig_client.user_stories(user_id))

            if not stories:
                return RPAResult(False, "create_highlight", "Nenhum story recente encontrado", error_code="no_recent_stories")

            # Pega o story mais recente
            latest_story = stories[0]
            story_pk = latest_story.pk

            print(f"[RPA:{self.username}] Criando destaque '{title}' a partir do story {story_pk}...")

            # Cria o highlight
            await loop.run_in_executor(
                None,
                lambda: self.ig_client.highlight_create(title, [story_pk])
            )

            print(f"[RPA:{self.username}] ✅ Destaque '{title}' criado com sucesso via instagrapi")
            return RPAResult(True, "create_highlight", f"Destaque '{title}' criado com sucesso")

        except Exception as e:
            return RPAResult(False, "create_highlight", f"Erro ao criar destaque: {str(e)}", error_code="unknown_error")

    async def complete_magic_link(self, magic_link_url: str) -> RPAResult:
        """Navega até o Magic Link do SaaS para vincular a conta (Playwright)."""
        from urllib.parse import urlencode
        try:
            params = urlencode({"username": self.username})
            separator = "&" if "?" in magic_link_url else "?"
            full_url = f"{magic_link_url}{separator}{params}"
            print(f"[RPA:{self.username}] Navegando para Magic Link: {full_url[:120]}...")
            await self.page.goto(full_url, wait_until="domcontentloaded", timeout=30_000)

            try:
                await self.page.wait_for_url("**/add/success**", timeout=15_000)
                print(f"[RPA:{self.username}] ✅ Magic Link aceito — conta vinculada!")
                return RPAResult(True, "magic_link", "Conta vinculada ao SaaS via Magic Link")
            except PlaywrightTimeout:
                current = self.page.url
                if "/dashboard" in current or "/accounts" in current:
                    print(f"[RPA:{self.username}] ✅ Já no dashboard — conta vinculada!")
                    return RPAResult(True, "magic_link", "Conta vinculada (redirect direto)")

                title = await self.page.title()
                print(f"[RPA:{self.username}] ❌ Magic Link falhou: {title}")
                return RPAResult(
                    False, "magic_link",
                    f"Página: {title}. URL final: {current}",
                    error_code="magic_link_failed",
                )
        except Exception as e:
            return RPAResult(False, "magic_link", f"Erro no Magic Link: {str(e)}", error_code="magic_link_error")


async def run_onboarding_rpa(
    username: str,
    password: str,
    proxy_url: str,
    totp_secret: Optional[str],
    photo_path: Optional[str],
    story_media_path: Optional[str],
    story_link_url: Optional[str],
    story_link_text: Optional[str],
    highlight_title: Optional[str],
    magic_link_url: Optional[str] = None,
    profile_dir: Optional[str] = None,
    existing_cookies: Optional[list[dict]] = None,
) -> dict:
    """
    Executa o fluxo completo de onboarding HÍBRIDO (Playwright + Instagrapi).

    Retorna dict com:
      - success: bool
      - stage: última etapa executada
      - message: descrição do resultado
      - cookies: cookies atualizados (para salvar no banco)
      - error_code: código de erro se falhou
    """
    rpa = InstagramRPA(username, password, proxy_url, totp_secret)

    try:
        await rpa.start()

        if existing_cookies:
            await rpa.inject_cookies(existing_cookies)

        # Etapa 1: Login via Playwright (web)
        login_result = await rpa.login()
        if not login_result.success:
            return {
                "success": False,
                "stage": "login",
                "message": login_result.message,
                "error_code": login_result.error_code,
            }

        # Etapa 2: Aceitar convite de tester via Playwright (web) — se aplicável
        # Pulada quando não há app_id — worker standalone não usa essa etapa

        # Etapa 2.5: Inicializar instagrapi com cookies da sessão web
        web_cookies = await rpa.get_cookies()
        if not rpa._init_instagrapi_from_cookies(web_cookies):
            return {
                "success": False,
                "stage": "instagrapi_init",
                "message": "Falha ao inicializar instagrapi com cookies web",
                "error_code": "instagrapi_init_failed",
                "cookies": web_cookies,
            }

        # Etapa 3: Trocar foto de perfil via instagrapi (mobile)
        if photo_path:
            photo_result = await rpa.change_profile_photo(photo_path)
            if not photo_result.success:
                return {
                    "success": False,
                    "stage": "change_photo",
                    "message": photo_result.message,
                    "error_code": photo_result.error_code,
                    "cookies": await rpa.get_cookies(),
                }

        # Etapa 4: Postar story com link via instagrapi (mobile)
        if story_media_path and story_link_url:
            story_result = await rpa.post_story_with_link(story_media_path, story_link_url, story_link_text)
            if not story_result.success:
                return {
                    "success": False,
                    "stage": "post_story",
                    "message": story_result.message,
                    "error_code": story_result.error_code,
                    "cookies": await rpa.get_cookies(),
                }

        # Etapa 5: Criar destaque via instagrapi (mobile)
        if highlight_title:
            highlight_result = await rpa.create_highlight_from_story(highlight_title)
            if not highlight_result.success:
                return {
                    "success": False,
                    "stage": "create_highlight",
                    "message": highlight_result.message,
                    "error_code": highlight_result.error_code,
                    "cookies": await rpa.get_cookies(),
                }

        # Etapa 6: Vincular conta ao SaaS via Magic Link (Playwright web)
        if magic_link_url:
            magic_result = await rpa.complete_magic_link(magic_link_url)
            if not magic_result.success:
                return {
                    "success": False,
                    "stage": "magic_link",
                    "message": magic_result.message,
                    "error_code": magic_result.error_code,
                    "cookies": await rpa.get_cookies(),
                }

        # Sucesso total
        return {
            "success": True,
            "stage": "done",
            "message": "Onboarding completo via RPA híbrido (Playwright + Instagrapi)",
            "cookies": await rpa.get_cookies(),
        }

    except Exception as e:
        return {
            "success": False,
            "stage": "unknown",
            "message": f"Erro inesperado: {str(e)}",
            "error_code": "unexpected_error",
        }
    finally:
        await rpa.stop()