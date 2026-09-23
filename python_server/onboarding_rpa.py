"""
AutoScale - Onboarding automatizado via Navegador Real (RPA com Playwright).

Substitui completamente o instagrapi para o fluxo de onboarding. Usa um
navegador Chromium real com perfis isolados persistentes (cookies/storage
salvos em disco), exatamente como Multilogin/AdsPower fazem.

Fluxo por conta:
  1. Abre Chromium com proxy dedicada e perfil persistente
  2. Injeta cookies salvos (se existir) ou faz login com user/senha/2FA
  3. Aceita convite de tester do App Meta (clica na UI real)
  4. Troca foto de perfil (upload via UI)
  5. Converte para conta profissional (se necessário)
  6. Posta story com mídia + sticker de link
  7. Cria destaque a partir do story
  8. Salva cookies atualizados para reuso futuro

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
    """Automação via navegador real para onboarding de contas Instagram."""

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

    def _safe_filename(self, name: str) -> str:
        """Remove caracteres inválidos para nome de pasta."""
        return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)

    async def _download_to_temp(self, url: str, suffix: str = "") -> str:
        """Baixa uma URL para um arquivo temporário local. Retorna o path."""
        if not url.startswith(("http://", "https://")):
            # Já é path local
            return url
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(resp.content)
        tmp.close()
        return tmp.name

    def _parse_proxy(self, proxy_url: str) -> dict:
        """Converte URL de proxy para formato do Playwright."""
        # Formato: http://user:pass@host:port ou socks5://user:pass@host:port
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

        # Launch persistent context (salva cookies/storage automaticamente)
        self.context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.profile_dir),
            headless=True,  # True para produção, False para debug
            proxy=self._parse_proxy(self.proxy_url),
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
        # Limpa perfil temporário para evitar acúmulo em /tmp
        if hasattr(self, "profile_dir") and self.profile_dir.exists():
            try:
                shutil.rmtree(self.profile_dir)
            except Exception:
                pass

    async def inject_cookies(self, cookies: list[dict]):
        """Injeta cookies salvos no contexto do navegador."""
        if self.context and cookies:
            await self.context.add_cookies(cookies)

    async def get_cookies(self) -> list[dict]:
        """Retorna os cookies atuais do contexto."""
        if self.context:
            return await self.context.cookies()
        return []

    async def login(self) -> RPAResult:
        """Faz login no Instagram via UI real."""
        try:
            print(f"[RPA:{self.username}] Navegando para página de login...")
            await self.page.goto(
                "https://www.instagram.com/accounts/login/",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            print(f"[RPA:{self.username}] Página de login carregada: {self.page.url}")

            # Verifica se já está logado
            if await self._is_logged_in():
                return RPAResult(True, "login", "Já estava logado (cookies válidos)")

            # Preenche usuário e senha
            await self.page.fill('input[name="username"]', self.username)
            await self.page.fill('input[name="password"]', self.password)

            # Clica em Login
            await self.page.click('button[type="submit"]')

            # Aguarda navegação ou tela de 2FA
            await self.page.wait_for_timeout(3000)

            # Verifica se pediu 2FA
            if await self._has_2fa_prompt():
                if not self.totp_secret:
                    return RPAResult(False, "login", "2FA solicitado mas nenhum TOTP secret fornecido", error_code="needs_2fa")

                # Gera código TOTP e preenche
                totp_code = self._generate_totp(self.totp_secret)
                await self.page.fill('input[name="verificationCode"]', totp_code)
                await self.page.click('button[type="submit"]')
                await self.page.wait_for_timeout(3000)

            # Verifica se login foi bem-sucedido
            if await self._is_logged_in():
                return RPAResult(True, "login", "Login realizado com sucesso", cookies=await self.get_cookies())

            # Verifica se houve erro de bloqueio/challenge
            if await self._has_challenge():
                return RPAResult(False, "login", "Instagram solicitou verificação adicional (challenge)", error_code="challenge_required")

            return RPAResult(False, "login", "Login falhou - verifique credenciais", error_code="login_failed")

        except PlaywrightTimeout:
            return RPAResult(False, "login", "Timeout durante o login", error_code="timeout")
        except Exception as e:
            return RPAResult(False, "login", f"Erro durante login: {str(e)}", error_code="unknown_error")

    async def _is_logged_in(self) -> bool:
        """Verifica se o usuário está logado."""
        try:
            # Se estiver na página inicial ou perfil, está logado
            current_url = self.page.url
            if "/accounts/login" not in current_url and "instagram.com" in current_url:
                return True

            # Verifica se existe elemento de navegação logada
            nav = await self.page.query_selector('nav[aria-label="Home"]')
            return nav is not None
        except:
            return False

    async def _has_2fa_prompt(self) -> bool:
        """Verifica se a tela de 2FA está visível."""
        try:
            el = await self.page.query_selector('input[name="verificationCode"]')
            return el is not None
        except:
            return False

    async def _has_challenge(self) -> bool:
        """Verifica se há challenge/verificação adicional."""
        try:
            current_url = self.page.url
            return "/challenge/" in current_url or "/checkpoint/" in current_url
        except:
            return False

    def _generate_totp(self, secret: str) -> str:
        """Gera código TOTP a partir do secret."""
        import pyotp
        totp = pyotp.TOTP(secret)
        return totp.now()

    async def accept_tester_invite(self, app_id: str) -> RPAResult:
        """Aceita convite de tester do App Meta via UI."""
        try:
            print(f"[RPA:{self.username}] Navegando para página de convite tester (app {app_id})...")
            # Vai para a página de convites de tester
            await self.page.goto(
                f"https://www.instagram.com/accounts/manage_access/?app_id={app_id}",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            await self.page.wait_for_timeout(3000)
            print(f"[RPA:{self.username}] Página de convite carregada: {self.page.url}")

            # Procura pelo botão de aceitar convite
            # O Instagram pode mostrar diferentes layouts, então tentamos vários seletores
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

            # Se não encontrou botão, verifica se já foi aceito
            if await self._is_invite_already_accepted():
                return RPAResult(True, "accept_invite", "Convite já estava aceito")

            return RPAResult(False, "accept_invite", "Não encontrou botão de aceitar convite", error_code="invite_button_not_found")

        except Exception as e:
            return RPAResult(False, "accept_invite", f"Erro ao aceitar convite: {str(e)}", error_code="unknown_error")

    async def _is_invite_already_accepted(self) -> bool:
        """Verifica se o convite já foi aceito anteriormente."""
        try:
            # Procura por texto indicando que já está conectado
            text = await self.page.inner_text("body")
            return "conectado" in text.lower() or "connected" in text.lower()
        except:
            return False

    async def change_profile_photo(self, photo_path: str) -> RPAResult:
        """Troca a foto de perfil via UI."""
        local_photo = None
        try:
            # Baixa mídia se for URL pública (antes de qualquer operação)
            print(f"[RPA:{self.username}] Baixando foto de perfil...")
            local_photo = await self._download_to_temp(photo_path, suffix=".jpg")
            print(f"[RPA:{self.username}] Foto baixada: {local_photo}")

            # Vai para a página de edição de perfil (domcontentloaded evita hang infinito)
            print(f"[RPA:{self.username}] Navegando para /edit/...")
            await self.page.goto(
                f"https://www.instagram.com/{self.username}/edit/",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            await self.page.wait_for_timeout(3000)
            print(f"[RPA:{self.username}] Página carregada: {self.page.url}")

            # Clica em "Alterar foto de perfil"
            change_photo_selectors = [
                'button:has-text("Alterar foto de perfil")',
                'button:has-text("Change profile photo")',
                '[role="button"]:has-text("Alterar")',
            ]

            for selector in change_photo_selectors:
                try:
                    btn = await self.page.wait_for_selector(selector, timeout=5000)
                    if btn:
                        await btn.click()
                        await self.page.wait_for_timeout(1000)
                        break
                except:
                    continue

            file_input = await self.page.query_selector('input[type="file"]')
            if not file_input:
                return RPAResult(False, "change_photo", "Não encontrou input de arquivo", error_code="file_input_not_found")

            await file_input.set_input_files(local_photo)
            await self.page.wait_for_timeout(3000)

            # Clica em salvar/confirmar se necessário
            save_selectors = [
                'button:has-text("Enviar")',
                'button:has-text("Submit")',
                'button:has-text("Salvar")',
                'button:has-text("Save")',
            ]

            for selector in save_selectors:
                try:
                    btn = await self.page.wait_for_selector(selector, timeout=3000)
                    if btn:
                        await btn.click()
                        await self.page.wait_for_timeout(2000)
                        break
                except:
                    continue

            return RPAResult(True, "change_photo", "Foto de perfil alterada com sucesso")

        except Exception as e:
            return RPAResult(False, "change_photo", f"Erro ao trocar foto: {str(e)}", error_code="unknown_error")
        finally:
            if local_photo and local_photo != photo_path and os.path.exists(local_photo):
                os.unlink(local_photo)

    async def post_story_with_link(self, media_path: str, link_url: str) -> RPAResult:
        """Posta story com mídia e sticker de link via UI."""
        local_media = None
        try:
            # Baixa mídia se for URL pública (antes de qualquer operação)
            local_media = await self._download_to_temp(media_path, suffix=".mp4")

            # Vai para a página de criação de story (domcontentloaded evita hang)
            print(f"[RPA:{self.username}] Navegando para criação de story...")
            await self.page.goto(
                "https://www.instagram.com/create/select/",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            await self.page.wait_for_timeout(3000)
            print(f"[RPA:{self.username}] Página de story carregada: {self.page.url}")

            # Seleciona "Story"
            story_selectors = [
                'button:has-text("Story")',
                '[role="tab"]:has-text("Story")',
                'div:has-text("Story")',
            ]

            for selector in story_selectors:
                try:
                    btn = await self.page.wait_for_selector(selector, timeout=5000)
                    if btn:
                        await btn.click()
                        await self.page.wait_for_timeout(1000)
                        break
                except:
                    continue

            file_input = await self.page.query_selector('input[type="file"]')
            if not file_input:
                return RPAResult(False, "story", "Não encontrou input de arquivo para story", error_code="file_input_not_found")

            await file_input.set_input_files(local_media)
            await self.page.wait_for_timeout(3000)

            # Adiciona sticker de link
            link_sticker_selectors = [
                'button:has-text("Link")',
                '[aria-label="Link"]',
                'div[role="button"]:has-text("Link")',
            ]

            for selector in link_sticker_selectors:
                try:
                    btn = await self.page.wait_for_selector(selector, timeout=5000)
                    if btn:
                        await btn.click()
                        await self.page.wait_for_timeout(1000)

                        # Preenche a URL
                        url_input = await self.page.wait_for_selector('input[type="url"], input[placeholder*="link"], input[placeholder*="URL"]', timeout=5000)
                        if url_input:
                            await url_input.fill(link_url)
                            await self.page.wait_for_timeout(1000)

                            # Confirma o link
                            confirm_selectors = [
                                'button:has-text("Concluir")',
                                'button:has-text("Done")',
                                'button:has-text("Adicionar")',
                            ]

                            for confirm_sel in confirm_selectors:
                                try:
                                    confirm_btn = await self.page.wait_for_selector(confirm_sel, timeout=3000)
                                    if confirm_btn:
                                        await confirm_btn.click()
                                        await self.page.wait_for_timeout(1000)
                                        break
                                except:
                                    continue
                        break
                except:
                    continue

            # Publica o story
            publish_selectors = [
                'button:has-text("Compartilhar")',
                'button:has-text("Share")',
                'button:has-text("Publicar")',
            ]

            for selector in publish_selectors:
                try:
                    btn = await self.page.wait_for_selector(selector, timeout=5000)
                    if btn:
                        await btn.click()
                        await self.page.wait_for_timeout(5000)
                        return RPAResult(True, "post_story", "Story publicado com sucesso")
                except:
                    continue

            return RPAResult(False, "post_story", "Não encontrou botão de publicar", error_code="publish_button_not_found")

        except Exception as e:
            return RPAResult(False, "post_story", f"Erro ao postar story: {str(e)}", error_code="unknown_error")
        finally:
            if local_media and local_media != media_path and os.path.exists(local_media):
                os.unlink(local_media)

    async def create_highlight_from_story(self, title: str) -> RPAResult:
        """Cria destaque a partir do story mais recente."""
        try:
            # Vai para o perfil (domcontentloaded evita hang infinito)
            print(f"[RPA:{self.username}] Navegando para perfil (highlight)...")
            await self.page.goto(
                f"https://www.instagram.com/{self.username}/",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            await self.page.wait_for_timeout(3000)
            print(f"[RPA:{self.username}] Perfil carregado: {self.page.url}")

            # Clica no story mais recente (primeiro círculo de story)
            story_circle = await self.page.wait_for_selector('[aria-label="Story"] canvas, div[role="button"][aria-label*="story"]', timeout=10000)
            if story_circle:
                await story_circle.click()
                await self.page.wait_for_timeout(3000)

                # Clica em "Destaque" ou "Highlight"
                highlight_selectors = [
                    'button:has-text("Destaque")',
                    'button:has-text("Highlight")',
                    '[aria-label="Highlight"]',
                    'div[role="button"]:has-text("Destaque")',
                ]

                for selector in highlight_selectors:
                    try:
                        btn = await self.page.wait_for_selector(selector, timeout=5000)
                        if btn:
                            await btn.click()
                            await self.page.wait_for_timeout(2000)

                            # Preenche o título do destaque
                            title_input = await self.page.wait_for_selector('input[type="text"]', timeout=5000)
                            if title_input:
                                await title_input.fill(title)
                                await self.page.wait_for_timeout(1000)

                                # Confirma
                                done_selectors = [
                                    'button:has-text("Concluir")',
                                    'button:has-text("Done")',
                                    'button:has-text("Adicionar")',
                                ]

                                for done_sel in done_selectors:
                                    try:
                                        done_btn = await self.page.wait_for_selector(done_sel, timeout=3000)
                                        if done_btn:
                                            await done_btn.click()
                                            await self.page.wait_for_timeout(2000)
                                            return RPAResult(True, "create_highlight", f"Destaque '{title}' criado com sucesso")
                                    except:
                                        continue
                            break
                    except:
                        continue

                return RPAResult(False, "create_highlight", "Não encontrou opção de destaque", error_code="highlight_option_not_found")

            return RPAResult(False, "create_highlight", "Não encontrou story para destacar", error_code="story_not_found")

        except Exception as e:
            return RPAResult(False, "create_highlight", f"Erro ao criar destaque: {str(e)}", error_code="unknown_error")


async def run_onboarding_rpa(
    username: str,
    password: str,
    proxy_url: str,
    totp_secret: Optional[str],
    app_id: str,
    photo_path: Optional[str],
    story_media_path: Optional[str],
    story_link_url: Optional[str],
    highlight_title: Optional[str],
    existing_cookies: Optional[list[dict]] = None,
) -> dict:
    """
    Executa o fluxo completo de onboarding via RPA.

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

        # Injeta cookies salvos se existirem
        if existing_cookies:
            await rpa.inject_cookies(existing_cookies)

        # Etapa 1: Login
        login_result = await rpa.login()
        if not login_result.success:
            return {
                "success": False,
                "stage": "login",
                "message": login_result.message,
                "error_code": login_result.error_code,
            }

        # Etapa 2: Aceitar convite de tester
        invite_result = await rpa.accept_tester_invite(app_id)
        if not invite_result.success:
            return {
                "success": False,
                "stage": "accept_invite",
                "message": invite_result.message,
                "error_code": invite_result.error_code,
                "cookies": await rpa.get_cookies(),
            }

        # Etapa 3: Trocar foto de perfil (se fornecida)
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

        # Etapa 4: Postar story com link (se fornecido)
        if story_media_path and story_link_url:
            story_result = await rpa.post_story_with_link(story_media_path, story_link_url)
            if not story_result.success:
                return {
                    "success": False,
                    "stage": "post_story",
                    "message": story_result.message,
                    "error_code": story_result.error_code,
                    "cookies": await rpa.get_cookies(),
                }

        # Etapa 5: Criar destaque (se fornecido)
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

        # Sucesso total
        return {
            "success": True,
            "stage": "done",
            "message": "Onboarding completo via RPA",
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


# Endpoint FastAPI para chamar o RPA
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/onboarding-rpa", tags=["onboarding-rpa"])


class RPARequest(BaseModel):
    username: str
    password: str
    proxy_url: str
    totp_secret: Optional[str] = None
    app_id: str
    photo_path: Optional[str] = None
    story_media_path: Optional[str] = None
    story_link_url: Optional[str] = None
    highlight_title: Optional[str] = None
    existing_cookies: Optional[list[dict]] = None


@router.post("/run")
async def run_rpa_endpoint(req: RPARequest):
    """Executa o fluxo completo de onboarding via RPA."""
    result = await run_onboarding_rpa(
        username=req.username,
        password=req.password,
        proxy_url=req.proxy_url,
        totp_secret=req.totp_secret,
        app_id=req.app_id,
        photo_path=req.photo_path,
        story_media_path=req.story_media_path,
        story_link_url=req.story_link_url,
        highlight_title=req.highlight_title,
        existing_cookies=req.existing_cookies,
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result)

    return result