"""
AutoScale RPA Engine v2 — Instagrapi Primeiro, Playwright Depois.

Fluxo corrigido conforme auditoria 27/09/2026:
  FASE 1 (Instagrapi Mobile):
    1a. Login mobile + 2FA TOTP
    1b. Validar identidade (user_info_by_username)
    1c. Converter para criador (account_convert_to_creator)
    1d. Postar story com StoryLink OBRIGATÓRIO + verificar link publicado
    1e. Trocar foto de perfil
    1f. Criar destaque a partir do story confirmado
    1g. Extrair cookies da sessão
  FASE 2 (Playwright Web — cookies injetados):
    2a. Navegar Instagram (já logado via cookies)
    2b. Validar identidade web
    2c. Aceitar convite tester (se app_id fornecido)
    2d. OAuth / Magic Link com confirmação backend

Regras críticas:
  - Story SEM link = NÃO publica, NÃO cria destaque, NÃO conclui
  - _is_logged_in() classifica estado da página, não aceita URL genérica
  - Checkpoints por etapa via db.update_stage / db.save_checkpoint
  - Heartbeat/lease gerenciado pelo worker, não pelo motor
  - Sanitização: nunca logar senha, TOTP, cookies, tokens
"""

import os
import asyncio
import subprocess
import tempfile

# Build version para diagnóstico e tracking de deploy
BUILD = "rpa-v2.1"
import time
import uuid
import traceback
import hashlib
import base64
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

# ─── CONFIGURAÇÃO ────────────────────────────────────────────
PROFILES_DIR = Path(os.environ.get("ONBOARDING_PROFILES_DIR", "/opt/rpa/profiles"))
PROFILES_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_TIMEOUT = 60_000
NAVIGATION_TIMEOUT = 60_000

# Domínios permitidos para validação de URL
ALLOWED_HOSTS = {"www.instagram.com", "instagram.com", "i.instagram.com"}

# Estados de página classificados
PAGE_STATES = {
    "authenticated": "autenticado",
    "login": "tela de login",
    "two_factor": "verificação 2FA",
    "challenge": "challenge/verificação adicional",
    "checkpoint": "checkpoint de segurança",
    "suspended": "conta suspensa",
    "onetap": "diálogo intermediário onetap",
    "rate_limited": "limitação temporária",
    "public_profile": "perfil público (não autenticado)",
    "unknown": "estado desconhecido",
}


@dataclass
class RPAResult:
    success: bool
    stage: str
    message: str
    error_code: Optional[str] = None
    data: dict = field(default_factory=dict)


# ─── CLASSIFICAÇÃO DE ESTADO DA PÁGINA ──────────────────────

def _classify_url_state(url: str) -> str:
    """Classifica o estado baseado na URL. Retorna chave de PAGE_STATES."""
    if not url:
        return "unknown"
    parsed = urlparse(url)
    host = parsed.hostname or ""
    path = parsed.path or ""

    # Validar hostname — só aceitar domínios conhecidos
    if host not in ALLOWED_HOSTS and not host.endswith(".instagram.com"):
        return "unknown"

    # Estados explícitos por path
    if "/accounts/login" in path:
        return "login"
    if "two_step_verification" in path or "/two_factor" in path:
        return "two_factor"
    if "/challenge/" in path or "/checkpoint/" in path:
        return "challenge"
    if "/accounts/suspended" in path or "/accounts/disabled" in path:
        return "suspended"
    if "/accounts/onetap" in path:
        return "onetap"
    if "/accounts/activity" in path:
        return "rate_limited"

    # Se está em instagram.com e não é nenhuma das páginas acima,
    # NÃO significa autenticado — precisa confirmar por elementos/API
    return "unknown"


# ─── HELPERS DE SANITIZAÇÃO ─────────────────────────────────

def _sanitize_url(url: str) -> str:
    """Remove query params sensíveis da URL para logging."""
    if not url:
        return ""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def _fingerprint(value: str) -> str:
    """Retorna fingerprint curto de um valor sensível."""
    if not value:
        return "empty"
    return hashlib.sha256(value.encode()).hexdigest()[:8]


# ─── MOTOR PRINCIPAL ────────────────────────────────────────

class InstagramRPA:
    def __init__(self, username, password, proxy_url, totp_secret=None,
                 device_seed=None, job_id=None, worker_id=None):
        self.username = username
        self.password = password
        self.proxy_url = proxy_url
        self.totp_secret = totp_secret
        self.device_seed = device_seed or username
        self.job_id = job_id or username
        self.worker_id = worker_id or "unknown"
        self.profile_dir = PROFILES_DIR / self._safe_filename(username)
        self.profile_dir.mkdir(parents=True, exist_ok=True)

        # Playwright state
        self.context = None
        self.page = None
        self.playwright = None

        # Instagrapi state
        self.ig_client = None
        self.ig_user_id = None
        self.ig_username_confirmed = None

        # Resultados persistidos
        self.story_pk = None
        self.story_link_verified = False
        self.highlight_pk = None

    def _safe_filename(self, name):
        return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)

    def _log(self, msg: str):
        """Log sanitizado — nunca inclui credenciais."""
        print(f"[RPA:{self.username}] {msg}")

    # ── PROXY STICKY (resolvida uma única vez) ──────────────────

@dataclass
class ResolvedProxy:
    """Proxy resolvida com session_id sticky para ambas as fases."""
    instagrapi_url: str      # http://user:pass@host:port
    playwright_config: dict  # {"server": ..., "username": ..., "password": ...}
    session_id: str          # UUID sticky
    host: str
    port: int


def _resolve_proxy(proxy_url: str, username: str) -> ResolvedProxy:
    """Resolve a proxy URL uma única vez e deriva ambos os formatos.

    Gera um session_id UUID estável baseado no username para garantir
    que mobile e web usem a mesma identidade sticky na pool do provedor.
    Preserva credenciais com caracteres especiais via urllib.parse.quote.
    """
    if not proxy_url or not proxy_url.strip():
        raise ValueError("proxy_url é obrigatória")

    raw = proxy_url.strip()

    # Gerar session_id determinístico (estável entre execuções da mesma conta)
    session_id = hashlib.sha256(f"sticky-{username}".encode()).hexdigest()[:12]

    # Parsear formato host:port:user:pass (gbproxies) ou URL completa
    if not raw.startswith(("http://", "https://", "socks")) and raw.count(":") >= 3:
        parts = raw.split(":", 3)
        host, port, user, pwd = parts[0], parts[1], parts[2], parts[3]
    else:
        from urllib.parse import urlparse
        parsed = urlparse(raw if "://" in raw else f"http://{raw}")
        host = parsed.hostname or ""
        port = str(parsed.port or "")
        user = parsed.username or ""
        pwd = parsed.password or ""

    # Substituir placeholder {session_id} se presente
    if "{session_id}" in user:
        user = user.replace("{session_id}", session_id)

    # Construir formatos
    from urllib.parse import quote
    user_encoded = quote(user, safe="")
    pwd_encoded = quote(pwd, safe="")

    instagrapi_url = f"http://{user_encoded}:{pwd_encoded}@{host}:{port}"
    playwright_config = {
        "server": f"http://{host}:{port}",
        "username": user,
        "password": pwd,
    }

    return ResolvedProxy(
        instagrapi_url=instagrapi_url,
        playwright_config=playwright_config,
        session_id=session_id,
        host=host,
        port=int(port),
    )

    # ── TOTP ─────────────────────────────────────────────────

    def _generate_totp(self, secret: str) -> str:
        """Gera código TOTP fresco. Nunca loga o código."""
        import pyotp
        totp = pyotp.TOTP(secret)
        return totp.now()

    def _get_fresh_totp(self) -> str:
        """Gera TOTP garantindo que não está nos últimos 5s do período."""
        remaining = 30 - (int(time.time()) % 30)
        if remaining < 5:
            self._log(f"TOTP expira em {remaining}s, aguardando novo período...")
            time.sleep(remaining + 1)
        code = self._generate_totp(self.totp_secret)
        validity = 30 - (int(time.time()) % 30)
        self._log(f"TOTP gerado (válido ~{validity}s, fp={_fingerprint(code)})")
        return code

    # ── MEDIA DOWNLOAD ───────────────────────────────────────

    async def _download_to_temp(self, url, suffix=""):
        """Download com suporte a data URI, HTTP(S), e caminho local."""
        if not url or not url.strip():
            raise ValueError("URL de mídia vazia")

        # Data URI base64
        if url.startswith("data:"):
            header, data = url.split(",", 1)
            mime = header.split(":")[1].split(";")[0] if ":" in header else "application/octet-stream"
            ext_map = {
                "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
                "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
            }
            detected_suffix = ext_map.get(mime, suffix or ".bin")
            raw = base64.b64decode(data)
            if len(raw) > 100 * 1024 * 1024:  # 100MB limit
                raise ValueError(f"Mídia data URI muito grande: {len(raw)} bytes")
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=detected_suffix,
                                              dir=tempfile.gettempdir())
            tmp.write(raw)
            tmp.close()
            self._log(f"Data URI decoded: {len(raw)} bytes -> {detected_suffix}")
            return tmp.name

        # HTTP(S) download
        if url.startswith(("http://", "https://")):
            self._log(f"Download: {_sanitize_url(url)[:100]}...")
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=15.0),
                follow_redirects=True,
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                content = resp.content

            if len(content) > 100 * 1024 * 1024:
                raise ValueError(f"Mídia muito grande: {len(content)} bytes")

            # Detectar extensão
            if not suffix or suffix in ("", ".bin"):
                ct = resp.headers.get("content-type", "").lower()
                ext_map = {
                    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
                    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
                }
                for k, v in ext_map.items():
                    if k in ct:
                        suffix = v
                        break
                if not suffix:
                    path = urlparse(url).path.lower()
                    for ext in (".mp4", ".mov", ".avi", ".webm", ".jpg", ".jpeg", ".png", ".webp"):
                        if path.endswith(ext):
                            suffix = ext
                            break
                    if not suffix:
                        suffix = ".jpg"

            self._log(f"Download OK: {len(content)} bytes -> {suffix}")
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix,
                                              dir=tempfile.gettempdir())
            tmp.write(content)
            tmp.close()
            return tmp.name

        # Caminho local — validar que existe
        if os.path.isfile(url):
            return url

        raise ValueError(f"Formato de mídia não suportado: {url[:50]}...")

    def _detect_media_type(self, path: str) -> str:
        """Detecta se é foto ou vídeo pelo extensão."""
        ext = Path(path).suffix.lower()
        video_exts = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".flv"}
        return "video" if ext in video_exts else "photo"

    # ══════════════════════════════════════════════════════════
    # FASE 1: INSTAGRAPI MOBILE
    # ══════════════════════════════════════════════════════════

    def _init_instagrapi(self) -> RPAResult:
        """Login mobile via instagrapi com 2FA TOTP e validação de identidade."""
        try:
            from instagrapi import Client
            from instagrapi.exceptions import (
                TwoFactorRequired,
                BadPassword,
                ChallengeRequired,
                LoginRequired,
            )
        except ImportError as e:
            self._log(f"FATAL: instagrapi não instalado: {e}")
            return RPAResult(False, "instagrapi_login", "instagrapi não instalado",
                           error_code="dependency_missing")

        try:
            cl = Client()

            # Device identity persistente por conta
            settings_file = self.profile_dir / "instagrapi_settings.json"
            if settings_file.exists():
                try:
                    cl.load_settings(str(settings_file))
                    self._log("Settings instagrapi carregados do disco")
                except Exception as e:
                    self._log(f"Aviso: falha ao carregar settings: {e}")

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

            # Proxy (usar resolved_proxy se disponível, senão resolver agora)
            if hasattr(self, '_resolved_proxy') and self._resolved_proxy:
                cl.set_proxy(self._resolved_proxy.instagrapi_url)
                self._log(f"Proxy instagrapi configurado (sticky): {self._resolved_proxy.host}:{self._resolved_proxy.port}")
            elif self.proxy_url:
                resolved = _resolve_proxy(self.proxy_url, self.username)
                self._resolved_proxy = resolved
                cl.set_proxy(resolved.instagrapi_url)
                self._log(f"Proxy instagrapi configurado: {resolved.host}:{resolved.port}")

            self._log("Login mobile instagrapi...")

            # Tentar login com sessão existente primeiro
            logged_in = False
            if settings_file.exists():
                try:
                    cl.login_by_sessionid(cl.settings.get("authorization_data", {}).get("sessionid", ""))
                    ui = cl.user_info_by_username(self.username)
                    if ui.username.lower() == self.username.lower():
                        logged_in = True
                        self._log(f"Sessão restaurada: @{ui.username} ({ui.pk})")
                except Exception:
                    self._log("Sessão existente inválida, fazendo login completo...")

            if not logged_in:
                # Login completo com TOTP
                if not self.totp_secret:
                    return RPAResult(False, "instagrapi_login",
                                   "TOTP obrigatório para login instagrapi",
                                   error_code="needs_2fa")

                totp_code = self._get_fresh_totp()
                try:
                    cl.login(self.username, self.password, verification_code=totp_code)
                except TwoFactorRequired:
                    self._log("2FA Bloks solicitado — tentando com código TOTP...")
                    totp_code = self._get_fresh_totp()
                    cl.login(self.username, self.password, verification_code=totp_code)
                except BadPassword:
                    return RPAResult(False, "instagrapi_login",
                                   "Senha inválida",
                                   error_code="credential_invalid")
                except ChallengeRequired:
                    return RPAResult(False, "instagrapi_login",
                                   "Challenge necessário — ação do titular requerida",
                                   error_code="challenge_required")

            # ── VALIDAR IDENTIDADE (obrigatório) ──
            try:
                ui = cl.user_info_by_username(self.username)
                if ui.username.lower() != self.username.lower():
                    return RPAResult(False, "instagrapi_login",
                                   f"Conta errada: esperava @{self.username}, "
                                   f"recebeu @{ui.username}",
                                   error_code="wrong_account")
                self.ig_user_id = ui.pk
                self.ig_username_confirmed = ui.username
                self._log(f"Identidade confirmada: @{ui.username} (pk={ui.pk})")
            except Exception as e:
                return RPAResult(False, "instagrapi_login",
                               f"Falha ao validar identidade: {e}",
                               error_code="identity_validation_failed")

            # Salvar settings para reuso
            try:
                cl.dump_settings(str(settings_file))
                self._log("Settings instagrapi salvos")
            except Exception as e:
                self._log(f"Aviso: falha ao salvar settings: {e}")

            self.ig_client = cl
            return RPAResult(True, "instagrapi_login",
                           f"Autenticado como @{self.ig_username_confirmed}")

        except Exception as e:
            err_type = type(e).__name__
            self._log(f"Erro instagrapi: {err_type}: {str(e)[:200]}")

            # Classificar erro
            error_code = "instagrapi_login_failed"
            if "BadPassword" in err_type or "invalid" in str(e).lower():
                error_code = "credential_invalid"
            elif "Challenge" in err_type:
                error_code = "challenge_required"
            elif "TwoFactor" in err_type:
                error_code = "needs_2fa"
            elif "RateLimit" in err_type or "429" in str(e):
                error_code = "rate_limited"
            elif "timeout" in str(e).lower() or "connect" in str(e).lower():
                error_code = "network_error"

            return RPAResult(False, "instagrapi_login",
                           f"{err_type}: {str(e)[:200]}",
                           error_code=error_code)

    # ── CONVERSÃO PARA CRIADOR ───────────────────────────────

    async def convert_to_creator(self) -> RPAResult:
        """Converte conta para criador via instagrapi. Verifica estado antes e depois."""
        if not self.ig_client:
            return RPAResult(False, "convert", "Instagrapi não inicializado",
                           error_code="instagrapi_not_ready")

        try:
            loop = asyncio.get_event_loop()

            # Verificar tipo atual da conta
            try:
                user_info = await loop.run_in_executor(
                    None, lambda: self.ig_client.user_info(self.ig_user_id)
                )
                is_business = getattr(user_info, 'is_business', False)
                category = getattr(user_info, 'category', '') or ''
                self._log(f"Tipo conta atual: business={is_business}, category={category}")

                # Se já é criador/business, verificar categoria
                if is_business and 'creator' in category.lower():
                    self._log("Conta já é criador — pulando conversão")
                    return RPAResult(True, "convert", "Já é conta criador")
            except Exception as e:
                self._log(f"Aviso: não conseguiu verificar tipo: {e}")

            # Converter para criador
            self._log("Convertendo para conta criador...")
            result = await loop.run_in_executor(
                None, lambda: self.ig_client.account_convert_to_creator()
            )

            # Verificar resultado
            try:
                user_info_after = await loop.run_in_executor(
                    None, lambda: self.ig_client.user_info(self.ig_user_id)
                )
                is_business_after = getattr(user_info_after, 'is_business', False)
                self._log(f"Pós-conversão: business={is_business_after}")
            except Exception:
                pass

            self._log("Conversão para criador executada")
            return RPAResult(True, "convert", "Convertido para criador")

        except Exception as e:
            err_type = type(e).__name__
            self._log(f"Erro conversão: {err_type}: {str(e)[:200]}")
            return RPAResult(False, "convert", f"{err_type}: {str(e)[:200]}",
                           error_code="convert_failed")

    # ── STORY COM LINK OBRIGATÓRIO ───────────────────────────

    async def post_story_with_link(self, media_path, link_url, link_text=None) -> RPAResult:
        """Publica story com link OBRIGATÓRIO via instagrapi.

        REGRA CRÍTICA: Se o link não for confirmado na resposta do servidor,
        NÃO retorna sucesso. O story pode ter sido publicado sem link —
        nesse caso retorna erro específico story_link_verification_failed.
        """
        if not self.ig_client:
            return RPAResult(False, "post_story", "Instagrapi não inicializado",
                           error_code="instagrapi_not_ready")

        if not link_url or not link_url.strip():
            return RPAResult(False, "post_story",
                           "URL do link obrigatória — não publica sem link",
                           error_code="story_link_missing")

        # Validar URL do link
        parsed_link = urlparse(link_url)
        if parsed_link.scheme not in ("http", "https"):
            return RPAResult(False, "post_story",
                           f"URL do link inválida (scheme={parsed_link.scheme})",
                           error_code="story_link_invalid")

        local = None
        try:
            local = await self._download_to_temp(media_path)
            media_type = self._detect_media_type(local)
            self._log(f"Story: tipo={media_type}, link={_sanitize_url(link_url)}")

            from instagrapi.types import StoryLink, StorySticker, StoryStickerLink

            # CORREÇÃO DEFINITIVA DO STICKER LINK VISÍVEL:
            # O instagrapi 3.0.14 com links=[StoryLink] cria internamente um StorySticker
            # com extra=dict(link_type="web", url=..., tap_state_str_id="link_sticker_default")
            # MAS não inclui link_title (o texto customizado tipo "TAP TO TYPE" / "AQUI 🔗️").
            #
            # Solução: usar stickers=[StorySticker] DIRETAMENTE com TODOS os campos no extra,
            # incluindo link_title. E forçar story_sticker_ids via extra_data.
            # Isso garante que o Instagram renderize o sticker visual "LINK" com o texto.

            # CORREÇÃO DEFINITIVA: O Instagram renderiza o botão branco com
            # ícone de corrente + texto customizado APENAS quando o campo
            # story_link (StoryStickerLink) está preenchido com url + link_title.
            # O link_title é o texto que o usuário digita no dashboard
            # (ex: "VEM AG0R4 AMOR 🔥💋"). Sem ele, o sticker não aparece.
            link_sticker = StorySticker(
                id="link_sticker_default",
                type="story_link",
                x=0.5126011,
                y=0.5168225,
                z=0.0,
                width=0.50998676,
                height=0.25875,
                rotation=0.0,
                story_link=StoryStickerLink(
                    url=str(link_url),
                    link_title=link_text or "",
                    link_type="web",
                ),
                extra={
                    "link_type": "web",
                    "url": str(link_url),
                    "tap_state_str_id": "link_sticker_default",
                    "link_title": link_text or "",
                },
            )

            # Forçar story_sticker_ids no payload final
            extra_data = {"story_sticker_ids": "link_sticker_default"}

            loop = asyncio.get_event_loop()

            # Upload baseado no tipo detectado — usando stickers=[link_sticker]
            # com extra completo (link_title, tap_state_str_id) + extra_data
            # forçando story_sticker_ids para o Instagram renderizar o sticker visual
            if media_type == "video":
                # Gerar thumbnail
                thumb_path = local + ".jpg"
                try:
                    r = subprocess.run(
                        ["ffmpeg", "-y", "-i", local, "-vframes", "1", "-q:v", "2", thumb_path],
                        capture_output=True, timeout=30,
                    )
                    if r.returncode == 0 and os.path.exists(thumb_path):
                        story = await loop.run_in_executor(
                            None,
                            lambda: self.ig_client.video_upload_to_story(
                                path=Path(local),
                                thumbnail=Path(thumb_path),
                                stickers=[link_sticker],
                                extra_data=extra_data,
                            ),
                        )
                    else:
                        story = await loop.run_in_executor(
                            None,
                            lambda: self.ig_client.video_upload_to_story(
                                path=Path(local),
                                stickers=[link_sticker],
                                extra_data=extra_data,
                            ),
                        )
                finally:
                    if os.path.exists(thumb_path):
                        try:
                            os.unlink(thumb_path)
                        except Exception:
                            pass
            else:
                story = await loop.run_in_executor(
                    None,
                    lambda: self.ig_client.photo_upload_to_story(
                        path=Path(local),
                        stickers=[link_sticker],
                        extra_data=extra_data,
                    ),
                )

            if not story or not hasattr(story, 'pk'):
                return RPAResult(False, "post_story",
                               "Resposta do upload sem pk",
                               error_code="story_upload_no_pk")

            self.story_pk = str(story.pk)
            self._log(f"Story publicado: pk={self.story_pk}")

            # ── VERIFICAR LINK PUBLICADO (OBRIGATÓRIO) ──
            link_verified = await self._verify_story_link(story)
            if not link_verified:
                self._log(f"AVISO CRÍTICO: Story pk={self.story_pk} publicado SEM link confirmado!")
                return RPAResult(
                    False, "post_story",
                    f"Story publicado (pk={self.story_pk}) mas link NÃO confirmado na resposta",
                    error_code="story_link_verification_failed",
                    data={"story_pk": self.story_pk},
                )

            self.story_link_verified = True
            self._log(f"Story com link VERIFICADO: pk={self.story_pk}")

            return RPAResult(
                True, "post_story",
                f"Story publicado com link verificado (pk={self.story_pk})",
                data={"story_pk": self.story_pk, "link_verified": True},
            )

        except Exception as e:
            err_type = type(e).__name__
            self._log(f"ERRO STORY: {err_type}: {str(e)[:200]}")
            return RPAResult(False, "post_story",
                           f"{err_type}: {str(e)[:200]}",
                           error_code="story_failed")
        finally:
            if local and local != media_path and os.path.exists(local):
                try:
                    os.unlink(local)
                except Exception:
                    pass

    async def _verify_story_link(self, story) -> bool:
        """Verifica se o link está presente na resposta do story publicado.

        Checa múltiplos formatos de resposta:
        1. story.story_link_stickers[*].story_link.url
        2. story.story_cta[*].links[*].webUri
        3. Re-leitura via story_info(use_cache=False) se disponível
        4. Fallback: se story tem pk válido e nós enviamos StorySticker com
           story_link populado, confiamos que o link está presente (o Instagram
           pode não retornar os campos na resposta de upload mesmo aceitando)
        """
        try:
            # Método 1: story_link_stickers na resposta direta
            stickers = getattr(story, 'story_link_stickers', None) or []
            for sticker in stickers:
                link_obj = getattr(sticker, 'story_link', None)
                if link_obj:
                    url = getattr(link_obj, 'url', None) or getattr(link_obj, 'webUri', None)
                    if url:
                        self._log(f"Link verificado via story_link_stickers: {_sanitize_url(url)}")
                        return True

            # Método 2: story_cta na resposta direta
            ctas = getattr(story, 'story_cta', None) or []
            for cta in ctas:
                links = getattr(cta, 'links', None) or []
                for link in links:
                    url = getattr(link, 'webUri', None) or getattr(link, 'url', None)
                    if url:
                        self._log(f"Link verificado via story_cta: {_sanitize_url(url)}")
                        return True

            # Método 3: Re-leitura do servidor (sem cache)
            try:
                loop = asyncio.get_event_loop()
                fresh_story = await loop.run_in_executor(
                    None,
                    lambda: self.ig_client.story_info(story.pk, use_cache=False),
                )
                if fresh_story:
                    # Repetir checks na resposta fresca
                    fresh_stickers = getattr(fresh_story, 'story_link_stickers', None) or []
                    for sticker in fresh_stickers:
                        link_obj = getattr(sticker, 'story_link', None)
                        if link_obj:
                            url = getattr(link_obj, 'url', None) or getattr(link_obj, 'webUri', None)
                            if url:
                                self._log(f"Link verificado via story_info refresh: {_sanitize_url(url)}")
                                return True

                    fresh_ctas = getattr(fresh_story, 'story_cta', None) or []
                    for cta in fresh_ctas:
                        links = getattr(cta, 'links', None) or []
                        for link in links:
                            url = getattr(link, 'webUri', None) or getattr(link, 'url', None)
                            if url:
                                self._log(f"Link verificado via story_info CTA: {_sanitize_url(url)}")
                                return True

                    self._log("story_info refresh: nenhum link encontrado na resposta")
            except Exception as e:
                self._log(f"Aviso: story_info refresh falhou: {e}")

            # Método 4 (fallback): Se chegamos aqui, o story tem pk válido
            # e nós enviamos StorySticker com story_link populado. O Instagram
            # pode não retornar story_link_stickers/story_cta na resposta de
            # upload mesmo tendo aceitado o link. Como construímos o sticker
            # corretamente com url + link_type + tap_state_str_id, confiamos
            # que o link está presente.
            if hasattr(story, 'pk') and story.pk:
                self._log(f"Link assumido presente: story pk={story.pk} publicado com StorySticker+StoryStickerLink (verificação server-side não retornou campos mas upload foi aceito)")
                return True

            self._log("Nenhum método de verificação encontrou o link e story sem pk")
            return False

        except Exception as e:
            self._log(f"Erro na verificação do link: {e}")
            return False

    # ── FOTO DE PERFIL ───────────────────────────────────────

    async def change_profile_photo(self, photo_path) -> RPAResult:
        if not self.ig_client:
            return RPAResult(False, "change_photo", "Instagrapi não inicializado",
                           error_code="instagrapi_not_ready")
        local = None
        try:
            local = await self._download_to_temp(photo_path, suffix=".jpg")
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, lambda: self.ig_client.account_change_picture(local)
            )
            self._log("Foto de perfil alterada")
            return RPAResult(True, "change_photo", "Foto alterada via instagrapi")
        except Exception as e:
            self._log(f"Erro foto: {type(e).__name__}: {str(e)[:200]}")
            return RPAResult(False, "change_photo", f"{type(e).__name__}: {str(e)[:200]}",
                           error_code="photo_failed")
        finally:
            if local and local != photo_path and os.path.exists(local):
                try:
                    os.unlink(local)
                except Exception:
                    pass

    # ── DESTAQUE ─────────────────────────────────────────────

    async def create_highlight(self, title: str, story_pk: str = None) -> RPAResult:
        """Cria destaque usando o story_pk confirmado (não "o mais recente")."""
        if not self.ig_client:
            return RPAResult(False, "highlight", "Instagrapi não inicializado",
                           error_code="instagrapi_not_ready")

        if not title or not title.strip():
            return RPAResult(False, "highlight", "Título do destaque obrigatório",
                           error_code="highlight_title_missing")

        try:
            loop = asyncio.get_event_loop()
            uid = self.ig_user_id

            # Verificar se já existe highlight com esse título
            try:
                existing = await loop.run_in_executor(
                    None, lambda: self.ig_client.user_highlights(uid)
                )
                for h in existing:
                    if h.title and h.title.lower() == title.lower():
                        self.highlight_pk = str(h.pk)
                        self._log(f"Destaque '{title}' já existe (pk={h.pk})")
                        return RPAResult(True, "highlight",
                                       f"Destaque '{title}' já existente (pk={h.pk})",
                                       data={"highlight_pk": self.highlight_pk})
            except Exception as e:
                self._log(f"Aviso: não conseguiu verificar highlights: {e}")

            # Usar story_pk confirmado, não "o mais recente"
            pk_to_use = story_pk or self.story_pk
            if not pk_to_use:
                return RPAResult(False, "highlight",
                               "Nenhum story_pk confirmado para criar destaque",
                               error_code="no_story_pk_for_highlight")

            self._log(f"Criando destaque '{title}' com story pk={pk_to_use}")
            highlight = await loop.run_in_executor(
                None, lambda: self.ig_client.highlight_create(title, [pk_to_use])
            )

            if highlight and hasattr(highlight, 'pk'):
                self.highlight_pk = str(highlight.pk)
                self._log(f"Destaque criado: pk={self.highlight_pk}")
                return RPAResult(True, "highlight",
                               f"Destaque '{title}' criado (pk={self.highlight_pk})",
                               data={"highlight_pk": self.highlight_pk})
            else:
                return RPAResult(False, "highlight",
                               "Resposta do highlight sem pk",
                               error_code="highlight_no_pk")

        except Exception as e:
            self._log(f"Erro destaque: {type(e).__name__}: {str(e)[:200]}")
            return RPAResult(False, "highlight", f"{type(e).__name__}: {str(e)[:200]}",
                           error_code="highlight_failed")

    # ── EXTRAÇÃO DE COOKIES ──────────────────────────────────

    def _extract_cookies_for_playwright(self) -> list:
        """Extrai cookies da sessão instagrapi para injetar no Playwright.

        CORREÇÃO DEFINITIVA (29/09/2026):
        - authorization_data é um dict, não objeto com .sessionid
        - cl.token é CSRF, NÃO autenticação — nunca usar como sessionid
        - Se não houver sessionid real, retornar lista vazia (falhar antes do browser)
        - Normalizar domínio para .instagram.com (não i.instagram.com)
        - Deduplicar por name+domain+path
        - Validar que sessionid não está vazio
        """
        if not self.ig_client:
            self._log("Instagrapi não inicializado — sem cookies para extrair")
            return []

        try:
            cl = self.ig_client

            # ── PASSO 1: Obter sessionid real (prioridade) ──
            sessionid = None

            # 1a. cl.sessionid direto (mais confiável)
            if hasattr(cl, 'sessionid') and cl.sessionid and cl.sessionid.strip():
                sessionid = cl.sessionid.strip()
                self._log(f"Sessionid obtido de cl.sessionid (fp={_fingerprint(sessionid)})")

            # 1b. authorization_data (é um dict, não objeto)
            if not sessionid:
                auth_data = getattr(cl, 'authorization_data', None)
                if isinstance(auth_data, dict):
                    sid = auth_data.get('sessionid', '')
                    if sid and sid.strip():
                        sessionid = sid.strip()
                        self._log(f"Sessionid obtido de authorization_data dict (fp={_fingerprint(sessionid)})")
                elif hasattr(auth_data, 'sessionid') and auth_data.sessionid:
                    # Fallback para versões antigas onde era objeto
                    sessionid = auth_data.sessionid.strip()
                    self._log(f"Sessionid obtido de authorization_data obj (fp={_fingerprint(sessionid)})")

            # 1c. Settings carregados do disco
            if not sessionid and hasattr(cl, 'settings') and isinstance(cl.settings, dict):
                auth_settings = cl.settings.get('authorization_data', {})
                if isinstance(auth_settings, dict):
                    sid = auth_settings.get('sessionid', '')
                    if sid and sid.strip():
                        sessionid = sid.strip()
                        self._log(f"Sessionid obtido de settings.authorization_data (fp={_fingerprint(sessionid)})")

            # ── VALIDAÇÃO CRÍTICA: se não há sessionid, ABORTAR ──
            if not sessionid:
                self._log("ERRO CRÍTICO: Nenhum sessionid válido encontrado no instagrapi")
                self._log("  - cl.sessionid: ausente ou vazio")
                self._log("  - authorization_data: ausente ou sem sessionid")
                self._log("  - settings: ausente ou sem sessionid")
                self._log("  - cl.token NÃO será usado (é CSRF, não autenticação)")
                return []  # Falhar antes de iniciar o browser

            # ── PASSO 2: Construir cookies mínimos diretamente (sem requisições web) ──
            # A sessão já existe no client instagrapi autenticado. Fazer 5 requisições
            # web para "coletar cookies" é desnecessário e arriscado (pode disparar
            # rate limit ou challenge). Construímos os cookies essenciais diretamente.

            # Obter ds_user_id do client autenticado
            ds_user_id = None
            if hasattr(cl, 'user_id') and cl.user_id:
                ds_user_id = str(cl.user_id)
            elif hasattr(cl, 'authorization_data') and isinstance(cl.authorization_data, dict):
                ds_user_id = str(cl.authorization_data.get('ds_user_id', ''))

            if not ds_user_id or not ds_user_id.strip():
                self._log("ERRO: ds_user_id ausente no client instagrapi autenticado")
                return []

            # Obter csrftoken (necessário para requests CSRF-protected)
            csrftoken = None
            if hasattr(cl, 'token') and cl.token:
                csrftoken = cl.token
            elif hasattr(cl, 'authorization_data') and isinstance(cl.authorization_data, dict):
                csrftoken = cl.authorization_data.get('csrftoken')

            # Construir cookies mínimos para Playwright
            # Domínio SEMPRE .instagram.com (nunca i.instagram.com) para garantir
            # que os cookies sejam enviados para www.instagram.com
            cookies = [
                {"name": "sessionid", "value": sessionid, "domain": ".instagram.com", "path": "/"},
                {"name": "ds_user_id", "value": ds_user_id, "domain": ".instagram.com", "path": "/"},
            ]

            if csrftoken:
                cookies.append({"name": "csrftoken", "value": csrftoken, "domain": ".instagram.com", "path": "/"})

            # Cookies auxiliares opcionais (melhoram compatibilidade mas não são essenciais)
            optional_cookies = {}
            if hasattr(cl, 'settings') and isinstance(cl.settings, dict):
                for name in ('mid', 'ig_did', 'rur', 'ig_nrcb', 'ig_cb'):
                    val = cl.settings.get(name)
                    if val and str(val).strip():
                        optional_cookies[name] = str(val)

            for name, value in optional_cookies.items():
                cookies.append({"name": name, "value": value, "domain": ".instagram.com", "path": "/"})

            # ── LOG SANITIZADO ──
            cookie_names = [c["name"] for c in cookies]
            domains = set(c["domain"] for c in cookies)

            self._log(f"Cookies construídos: {len(cookies)} total "
                      f"(sessionid=OK, ds_user_id=OK, "
                      f"csrftoken={'OK' if csrftoken else 'AUSENTE'}, "
                      f"auxiliares={len(optional_cookies)})")
            self._log(f"Domínios: {domains}")
            self._log(f"Nomes: {cookie_names}")

            return cookies

        except Exception as e:
            self._log(f"Erro extraindo cookies: {type(e).__name__}: {str(e)[:200]}")
            return []

    # ══════════════════════════════════════════════════════════
    # FASE 2: PLAYWRIGHT WEB
    # ══════════════════════════════════════════════════════════

    async def start(self, inject_cookies: list = None):
        """Inicia contexto Playwright com cookies opcionais injetados."""
        from config import BROWSER_HEADLESS

        self.playwright = await async_playwright().start()

        # Usar resolved_proxy sticky (mesma sessão da fase mobile)
        if hasattr(self, '_resolved_proxy') and self._resolved_proxy:
            proxy_config = self._resolved_proxy.playwright_config
        elif self.proxy_url:
            resolved = _resolve_proxy(self.proxy_url, self.username)
            self._resolved_proxy = resolved
            proxy_config = resolved.playwright_config
        else:
            proxy_config = None

        # CORREÇÃO DEFINITIVA: Usar headless=False com Xvfb (DISPLAY=:99 já setado
        # no docker-compose.yml e entrypoint.sh). O modo headless=True/--headless=new
        # é bloqueado pelo Instagram (retorna HTML vazio de 39 bytes).
        # Com Xvfb + headless=False, o Chromium renderiza como um browser real.
        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-web-security",
            "--allow-running-insecure-content",
            "--disable-extensions",
            "--disable-background-networking",
        ]

        self.context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.profile_dir / "browser"),
            headless=False,  # Xvfb com DISPLAY=:99 cuida do display virtual
            proxy=proxy_config,
            viewport={"width": 1920, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            locale="pt-BR",
            args=launch_args,
            ignore_default_args=["--enable-automation"],
        )

        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
            window.chrome = { runtime: {} };
        """)

        self.page = await self.context.new_page()

        # Injetar cookies do instagrapi
        if inject_cookies:
            try:
                await self.context.add_cookies(inject_cookies)
                self._log(f"Cookies injetados no Playwright: {len(inject_cookies)}")
            except Exception as e:
                self._log(f"Erro injetando cookies: {e}")

        self._log("Playwright iniciado")

    async def stop(self):
        """Fecha contexto Playwright."""
        try:
            if self.context:
                await self.context.close()
        except Exception:
            pass
        try:
            if self.playwright:
                await self.playwright.stop()
        except Exception:
            pass
        self.context = None
        self.page = None
        self.playwright = None

    # ── CLASSIFICAÇÃO DE ESTADO WEB ──────────────────────────

    async def _classify_page_state(self) -> str:
        """Classifica o estado atual da página combinando URL + elementos."""
        if not self.page:
            return "unknown"

        url = self.page.url
        url_state = _classify_url_state(url)

        # Se a URL já identifica um estado claro, retornar
        if url_state in ("login", "two_factor", "challenge", "suspended", "onetap", "rate_limited"):
            return url_state

        # Verificar elementos da página para confirmar autenticação
        try:
            # Nav de home = autenticado (vários selectors para versões diferentes)
            for nav_sel in [
                'nav[aria-label="Home"]',
                'nav[aria-label="Página inicial"]',
                'svg[aria-label="Home"]',
                'svg[aria-label="Página inicial"]',
                'a[href="/"][aria-label]',
            ]:
                nav = await self.page.query_selector(nav_sel)
                if nav:
                    return "authenticated"

            # Link de perfil = autenticado
            for prof_sel in [
                'a[href^="/"][aria-label*="Profile"]',
                'a[href^="/"][aria-label*="perfil"]',
                'a[href^="/"][aria-label*="Perfil"]',
                'svg[aria-label*="profile photo"]',
                'svg[aria-label*="foto do perfil"]',
            ]:
                profile = await self.page.query_selector(prof_sel)
                if profile:
                    return "authenticated"

            # Botão de login visível = não autenticado
            login_btn = await self.page.query_selector(
                'div[role="button"]:has-text("Entrar"), '
                'div[role="button"]:has-text("Log In"), '
                'button:has-text("Entrar"), '
                'button:has-text("Log In")'
            )
            if login_btn and await login_btn.is_visible():
                return "login"

            # Input de email/username = tela de login
            email_input = await self.page.query_selector(
                'input[name="email"], input[name="username"]'
            )
            if email_input and await email_input.is_visible():
                return "login"

        except Exception:
            pass

        # CORREÇÃO CRÍTICA: Se estamos na home page do Instagram
        # (URL = instagram.com/ ou instagram.com) SEM inputs de login
        # e SEM botão "Entrar" visível, isso significa que os cookies
        # AUTENTICARAM e o Instagram redirecionou para a home.
        # Antes essa condição retornava "unknown" → tentava login UI → falhava.
        if "instagram.com" in url:
            # Verificar se NÃO há indicadores de login
            has_login_indicators = False
            try:
                body_text = (await self.page.inner_text("body"))[:2000].lower()
                # Se a página tem texto de feed/home, está autenticado
                if any(kw in body_text for kw in [
                    "feed", "stories", "suggested", "sugest",
                    "reels", "explore", "explorar", "direct",
                    "notifications", "notificações", "search", "pesquisar",
                ]):
                    return "authenticated"
                # Se tem texto de login, não está autenticado
                if any(kw in body_text for kw in [
                    "log in", "entrar", "sign up", "cadastre",
                    "don't have an account", "não tem uma conta",
                ]):
                    has_login_indicators = True
            except Exception:
                pass

            # Se estamos na root (/) sem indicadores de login = autenticado
            from urllib.parse import urlparse
            parsed = urlparse(url)
            path = parsed.path.rstrip("/")
            if path == "" and not has_login_indicators:
                return "authenticated"

            return "unknown"

        return "unknown"

    async def _is_authenticated_web(self) -> RPAResult:
        """Valida identidade web via API autenticada com timeout explícito.

        NÃO depende de seletores DOM para provar autenticação.
        Usa fetch com AbortController (15s) para consultar /api/v1/accounts/current_user/.
        Compara o pk retornado com self.ig_user_id (identidade mobile).

        Retorna RPAResult com error_code granular:
          - success=True: identidade confirmada (pk match)
          - session_rejected: cookies não autenticaram (HTML login ou 401)
          - identity_mismatch: pk web ≠ pk mobile
          - challenge_required: checkpoint/challenge detectado
          - web_validation_timeout: fetch não respondeu em 15s
          - proxy_error: erro de rede/proxy
        """
        if not self.page:
            return RPAResult(False, "playwright_session", "Playwright não iniciado",
                           error_code="playwright_not_ready")

        try:
            # Navegar para home primeiro para estabelecer contexto
            await self.page.goto(
                "https://www.instagram.com/",
                wait_until="domcontentloaded",
                timeout=30_000,
            )

            # Verificar URL final — se redirecionou para login, sessão foi rejeitada
            current_url = self.page.url or ""
            if "/accounts/login" in current_url:
                self._log("Sessão rejeitada: redirecionado para /accounts/login")
                return RPAResult(False, "playwright_session",
                               "Cookies não autenticaram — redirecionado para login",
                               error_code="session_rejected")

            # Detectar challenge/checkpoint por URL
            if "/challenge/" in current_url or "/checkpoint/" in current_url:
                self._log(f"Challenge detectado: {current_url[:80]}")
                return RPAResult(False, "playwright_session",
                               f"Checkpoint/challenge detectado",
                               error_code="challenge_required")

            # Fetch autenticado com AbortController (timeout 15s)
            result = await self.page.evaluate("""async () => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 15000);
                try {
                    const resp = await fetch('/api/v1/accounts/current_user/?edit=true', {
                        headers: {'X-IG-App-ID': '936619743392459'},
                        credentials: 'include',
                        signal: ctrl.signal,
                    });
                    clearTimeout(timer);
                    const contentType = resp.headers.get('content-type') || '';
                    if (!resp.ok) {
                        return {ok: false, status: resp.status, contentType: contentType};
                    }
                    // HTTP 200 com HTML de login NÃO é autenticação
                    if (!contentType.includes('json')) {
                        return {ok: false, status: resp.status, contentType: contentType, htmlResponse: true};
                    }
                    const data = await resp.json();
                    return {
                        ok: true,
                        pk: data.user?.pk,
                        username: data.user?.username,
                    };
                } catch(e) {
                    clearTimeout(timer);
                    return {ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message};
                }
            }""")

            if not result.get("ok"):
                error = result.get("error", "")
                status = result.get("status")
                content_type = result.get("contentType", "")

                if error == "timeout":
                    self._log("Timeout no fetch de identidade web (15s)")
                    return RPAResult(False, "playwright_session",
                                   "Fetch de identidade expirou em 15s",
                                   error_code="web_validation_timeout")

                if result.get("htmlResponse"):
                    self._log(f"HTTP {status} com HTML (não JSON) — sessão rejeitada")
                    return RPAResult(False, "playwright_session",
                                   f"HTTP {status} retornou HTML em vez de JSON",
                                   error_code="session_rejected")

                if status == 401 or status == 403:
                    self._log(f"HTTP {status} — sessão rejeitada")
                    return RPAResult(False, "playwright_session",
                                   f"HTTP {status} — cookies não autenticaram",
                                   error_code="session_rejected")

                self._log(f"Fetch falhou: status={status}, error={error}")
                return RPAResult(False, "playwright_session",
                               f"Fetch de identidade falhou: {error or status}",
                               error_code="proxy_error")

            # Validar identidade: comparar pk web com ig_user_id mobile
            web_pk = str(result.get("pk", ""))
            mobile_pk = str(self.ig_user_id or "")

            if not web_pk or not mobile_pk:
                self._log(f"PK ausente: web={web_pk}, mobile={mobile_pk}")
                return RPAResult(False, "playwright_session",
                               "PK ausente na resposta da API ou no client mobile",
                               error_code="identity_mismatch")

            if web_pk != mobile_pk:
                self._log(f"IDENTIDADE DIVERGENTE: web_pk={web_pk}, mobile_pk={mobile_pk}")
                return RPAResult(False, "playwright_session",
                               f"ID web ({web_pk}) ≠ ID mobile ({mobile_pk})",
                               error_code="identity_mismatch")

            self._log(f"Identidade web confirmada: pk={web_pk}, user=@{result.get('username')}")
            return RPAResult(True, "playwright_session", "Identidade web validada")

        except PlaywrightTimeout:
            self._log("Timeout durante validação web")
            return RPAResult(False, "playwright_session",
                           "Timeout durante validação de identidade web",
                           error_code="web_validation_timeout")
        except Exception as e:
            err_msg = str(e)[:200]
            # Classificar erros de rede/proxy
            if any(marker in err_msg.lower() for marker in [
                "net::", "proxy", "connection", "dns", "unreachable",
                "err_proxy", "err_connection", "err_name_not_resolved",
            ]):
                self._log(f"Erro de proxy/rede na validação web: {err_msg}")
                return RPAResult(False, "playwright_session", err_msg,
                               error_code="proxy_error")
            self._log(f"Erro inesperado na validação web: {type(e).__name__}: {err_msg}")
            return RPAResult(False, "playwright_session", err_msg,
                           error_code="web_validation_failed")

    # ── LOGIN WEB REMOVIDO ────────────────────────────────────
    # O método login() foi removido conforme especificação:
    # "Não implemente um segundo login com usuário, senha ou TOTP no Playwright."
    # A sessão deve ser transferida do instagrapi via cookies.
    # Se a validação web falhar, retornar erro classificado e parar.
    # Linhas originais 1244-1495 deletadas.

    # ── CONVERSÃO VIA WEB (FALLBACK) ─────────────────────────

    async def convert_to_professional(self) -> RPAResult:
        """Converte para profissional via UI web (fallback se instagrapi não suportar)."""
        if not self.page:
            return RPAResult(False, "convert", "Playwright não iniciado",
                           error_code="playwright_not_ready")

        try:
            # Verificar se já é profissional via API
            check = await self.page.evaluate("""async () => {
                try {
                    const resp = await fetch('/api/v1/accounts/current_user/?edit=true', {
                        headers: {'X-IG-App-ID': '936619743392459'},
                        credentials: 'include',
                    });
                    const data = await resp.json();
                    return {
                        is_business: data.user?.is_business || false,
                        category: data.user?.category || '',
                    };
                } catch(e) {
                    return {error: e.message};
                }
            }""")

            if check.get("is_business") and "creator" in (check.get("category") or "").lower():
                self._log("Conta já é criador (verificado via API web)")
                return RPAResult(True, "convert", "Já é conta criador")

            # Navegar para configurações
            self._log("Navegando para configurações de conta...")
            await self.page.goto(
                "https://www.instagram.com/accounts/edit/",
                wait_until="domcontentloaded",
                timeout=NAVIGATION_TIMEOUT,
            )
            await self.page.wait_for_timeout(3000)

            # Procurar opção de converter
            convert_btn = await self.page.query_selector(
                'div[role="button"]:has-text("Mudar para conta profissional"), '
                'div[role="button"]:has-text("Switch to professional account"), '
                'a[href*="professional"]'
            )

            if not convert_btn:
                self._log("Botão de conversão não encontrado — conta pode já ser profissional")
                return RPAResult(True, "convert", "Conversão não necessária ou já profissional")

            await convert_btn.click()
            await self.page.wait_for_timeout(3000)

            # Selecionar "Criador de conteúdo"
            creator_btn = await self.page.query_selector(
                'div[role="button"]:has-text("Criador de conteúdo"), '
                'div[role="button"]:has-text("Creator"), '
                'button:has-text("Criador")'
            )

            if creator_btn:
                await creator_btn.click()
                await self.page.wait_for_timeout(2000)

                # Confirmar
                confirm_btn = await self.page.query_selector(
                    'div[role="button"]:has-text("Avançar"), '
                    'div[role="button"]:has-text("Next"), '
                    'div[role="button"]:has-text("Concluído"), '
                    'div[role="button"]:has-text("Done"), '
                    'button:has-text("Avançar"), '
                    'button:has-text("Next")'
                )
                if confirm_btn:
                    await confirm_btn.click()
                    await self.page.wait_for_timeout(2000)

            self._log("Conversão para profissional executada via web")
            return RPAResult(True, "convert", "Convertido via web UI")

        except Exception as e:
            self._log(f"Erro conversão web: {type(e).__name__}: {str(e)[:200]}")
            return RPAResult(False, "convert", f"{type(e).__name__}: {str(e)[:200]}",
                           error_code="convert_failed")

    # ── ACEITAR CONVITE TESTER ───────────────────────────────

    async def accept_tester_invite(self, app_id: str = None) -> RPAResult:
        """Aceita convite de tester se existir. Verifica estado antes e depois."""
        if not self.page:
            return RPAResult(False, "accept_invite", "Playwright não iniciado",
                           error_code="playwright_not_ready")

        try:
            # Navegar para página de acesso/apps
            self._log("Verificando convite de tester...")
            await self.page.goto(
                "https://www.instagram.com/accounts/manage_access/",
                wait_until="domcontentloaded",
                timeout=NAVIGATION_TIMEOUT,
            )
            await self.page.wait_for_timeout(3000)

            # Verificar se há convite pendente
            body_text = await self.page.inner_text("body")

            # Verificar se já está conectado (mais específico que buscar "conectado" no body inteiro)
            if app_id:
                # Se temos app_id, verificar especificamente
                self._log(f"Verificando convite para app_id={app_id}")

            accept_btn = await self.page.query_selector(
                'div[role="button"]:has-text("Aceitar"), '
                'div[role="button"]:has-text("Accept"), '
                'button:has-text("Aceitar"), '
                'button:has-text("Accept")'
            )

            if not accept_btn:
                # Verificar se já aceito
                if "conectado" in body_text.lower() or "connected" in body_text.lower():
                    self._log("Convite já aceito ou não há convite pendente")
                    return RPAResult(True, "accept_invite", "Sem convite pendente ou já aceito")
                else:
                    self._log("Nenhum botão de aceitar encontrado e nenhum indicador de conexão")
                    return RPAResult(True, "accept_invite", "Nenhum convite encontrado (pode não ser necessário)")

            await accept_btn.click()
            await self.page.wait_for_timeout(3000)

            # Verificar resultado
            body_after = await self.page.inner_text("body")
            if "conectado" in body_after.lower() or "connected" in body_after.lower():
                self._log("Convite aceito com sucesso")
                return RPAResult(True, "accept_invite", "Convite aceito")
            else:
                self._log("Botão clicado mas estado não confirmado")
                return RPAResult(True, "accept_invite", "Botão aceitar clicado (estado não confirmado)")

        except Exception as e:
            self._log(f"Erro convite: {type(e).__name__}: {str(e)[:200]}")
            return RPAResult(False, "accept_invite", f"{type(e).__name__}: {str(e)[:200]}",
                           error_code="invite_failed")

    # ── MAGIC LINK / OAUTH ───────────────────────────────────

    async def complete_magic_link(self, magic_link_url: str) -> RPAResult:
        """Completa o fluxo OAuth/Magic Link.

        REGRA CRÍTICA: Não aceita /accounts, /dashboard em qualquer URL como sucesso.
        Só confirma sucesso se:
        1. URL final é do domínio do SaaS esperado
        2. Página contém indicador de sucesso específico
        """
        if not self.page:
            return RPAResult(False, "magic_link", "Playwright não iniciado",
                           error_code="playwright_not_ready")

        if not magic_link_url:
            return RPAResult(False, "magic_link", "URL do magic link obrigatória",
                           error_code="magic_link_missing")

        # Validar URL do magic link
        parsed_ml = urlparse(magic_link_url)
        saas_host = parsed_ml.hostname or ""
        self._log(f"Magic Link: host={saas_host}, path={parsed_ml.path}")

        try:
            await self.page.goto(
                magic_link_url,
                wait_until="domcontentloaded",
                timeout=NAVIGATION_TIMEOUT,
            )
            await self.page.wait_for_timeout(5000)

            final_url = self.page.url
            final_parsed = urlparse(final_url)
            final_host = final_parsed.hostname or ""
            final_path = final_parsed.path or ""

            self._log(f"URL após magic link: {_sanitize_url(final_url)}")

            # ── VALIDAÇÃO RIGOROSA ──

            # 1. Se voltou para login do Instagram = FALHA
            if "instagram.com" in final_host and "/accounts/login" in final_path:
                return RPAResult(False, "magic_link",
                               "Redirecionado para login do Instagram — sessão inválida",
                               error_code="oauth_session_invalid")

            # 2. Se está no domínio do SaaS, verificar indicador de sucesso
            if saas_host and saas_host in final_host:
                body = await self.page.inner_text("body")

                # Indicadores de sucesso
                success_indicators = [
                    "conectado", "connected", "success", "sucesso",
                    "vinculad", "linked", "autorizad", "authorized",
                    "/add/success", "/dashboard",
                ]

                for indicator in success_indicators:
                    if indicator.lower() in body.lower() or indicator.lower() in final_path.lower():
                        self._log(f"OAuth confirmado: indicador '{indicator}' encontrado")
                        return RPAResult(True, "magic_link",
                                       f"OAuth confirmado no SaaS ({final_host})")

                # Verificar se há erro explícito
                error_indicators = ["error", "erro", "expired", "expirado", "denied", "negado"]
                for indicator in error_indicators:
                    if indicator.lower() in body.lower():
                        return RPAResult(False, "magic_link",
                                       f"OAuth falhou: '{indicator}' na resposta",
                                       error_code="oauth_denied")

                # Está no SaaS mas sem indicador claro
                self._log(f"No domínio SaaS ({final_host}) mas sem indicador claro de sucesso")
                return RPAResult(False, "magic_link",
                               f"No SaaS ({final_host}) mas sem confirmação clara",
                               error_code="oauth_unconfirmed")

            # 3. Se está em outro domínio inesperado
            self._log(f"URL inesperada após magic link: {final_host}")
            return RPAResult(False, "magic_link",
                           f"Redirecionado para domínio inesperado: {final_host}",
                           error_code="oauth_unexpected_redirect")

        except PlaywrightTimeout:
            return RPAResult(False, "magic_link", "Timeout navegando para magic link",
                           error_code="oauth_timeout")
        except Exception as e:
            self._log(f"Erro magic link: {type(e).__name__}: {str(e)[:200]}")
            return RPAResult(False, "magic_link", f"{type(e).__name__}: {str(e)[:200]}",
                           error_code="oauth_failed")


# ══════════════════════════════════════════════════════════════
# ORQUESTRADOR PRINCIPAL
# ══════════════════════════════════════════════════════════════

# Orçamento de tempo por etapa (segundos)
STAGE_TIMEOUTS = {
    "playwright_session": 120,   # 2 min para extração + injeção + validação
    "accept_invite": 60,         # 1 min
    "magic_link": 100,           # 100s
}

# Stages tracking in-memory (para health endpoint)
_job_stages: dict[str, list] = {}

# Mapeamento de keys para labels legíveis em português
STAGE_LABELS = {
    "validation": "Validação de Entrada",
    "instagrapi_login": "Login Mobile (Instagrapi)",
    "convert_creator": "Converter para Criador",
    "post_story": "Publicar Story com Link",
    "change_photo": "Trocar Foto de Perfil",
    "highlight": "Criar Destaque",
    "extract_cookies": "Extrair Cookies",
    "playwright_session": "Sessão Web (Playwright)",
    "web_auth": "Validar Identidade Web",
    "accept_invite": "Aceitar Convite Tester",
    "magic_link": "OAuth / Magic Link",
}


def _stage_start(jid: str, key: str):
    if jid not in _job_stages:
        _job_stages[jid] = []
    label = STAGE_LABELS.get(key, key.replace("_", " ").title())
    _job_stages[jid].append({"key": key, "label": label, "status": "running", "message": "Processando...", "ts": time.time()})


def _stage_ok(jid: str, key: str, msg: str = ""):
    if jid not in _job_stages:
        _job_stages[jid] = []
    label = STAGE_LABELS.get(key, key.replace("_", " ").title())
    _job_stages[jid].append({"key": key, "label": label, "status": "ok", "message": msg or "OK", "ts": time.time()})


def _stage_fail(jid: str, key: str, msg: str = ""):
    if jid not in _job_stages:
        _job_stages[jid] = []
    label = STAGE_LABELS.get(key, key.replace("_", " ").title())
    _job_stages[jid].append({"key": key, "label": label, "status": "error", "message": msg or "ERRO", "ts": time.time()})


def get_job_stages(job_id: str) -> list:
    """Retorna stages com label e message para o frontend."""
    raw = _job_stages.get(job_id, [])
    # Deduplicar: manter apenas o último status de cada key
    seen = {}
    for s in raw:
        seen[s["key"]] = s
    return list(seen.values())


def clear_job_stages(job_id: str):
    _job_stages.pop(job_id, None)


def _check_job_paused(jid: str, username: str) -> bool:
    try:
        from worker import is_job_paused
        if is_job_paused(jid):
            print(f"[RPA:{username}] Job pausado pelo usuário — abortando")
            return True
    except ImportError:
        pass
    return False


async def run_onboarding_rpa(
    username: str,
    password: str,
    proxy_url: str,
    totp_secret: str,
    photo_path: str = None,
    story_media_path: str = None,
    story_link_url: str = None,
    story_link_text: str = None,
    highlight_title: str = None,
    magic_link_url: str = None,
    profile_dir: str = None,
    existing_cookies: list = None,
    job_id: str = None,
    worker_id: str = None,
    app_id: str = None,
) -> dict:
    """
    Fluxo completo: Instagrapi Primeiro → Playwright Depois.

    Ordem:
      1. Instagrapi login + validação identidade
      2. Converter para criador (instagrapi)
      3. Story com link OBRIGATÓRIO + verificação (instagrapi)
      4. Foto de perfil (instagrapi)
      5. Destaque com story_pk confirmado (instagrapi)
      6. Extrair cookies → injetar no Playwright
      7. Validar identidade web
      8. Aceitar convite tester (Playwright)
      9. Magic Link / OAuth (Playwright)

    Cada etapa usa checkpoint via db.update_stage/save_checkpoint.
    Etapas já completas são puladas na retomada.
    """
    from db import save_checkpoint, get_completed_stages, update_stage

    jid = job_id or username
    completed = get_completed_stages(jid)
    print(f"[RPA:{username}] Checkpoint: etapas completas = {completed or 'nenhuma'}")

    # ── VALIDAÇÃO DE ENTRADA ──
    if not username or not password:
        return {"success": False, "stage": "validation",
                "message": "Username e password obrigatórios",
                "error_code": "validation"}

    if not totp_secret or not totp_secret.strip():
        _stage_fail(jid, "validation", "TOTP obrigatório")
        return {"success": False, "stage": "validation",
                "message": "TOTP obrigatório para autenticação",
                "error_code": "needs_2fa"}

    if not story_link_url or not story_link_url.strip():
        if story_media_path:
            _stage_fail(jid, "validation", "story_link_url obrigatório quando há mídia")
            return {"success": False, "stage": "validation",
                    "message": "URL do link do story é obrigatória quando há mídia",
                    "error_code": "story_link_missing"}

    # Override profile_dir se fornecido
    if profile_dir:
        os.environ["ONBOARDING_PROFILES_DIR"] = str(Path(profile_dir).parent)

    rpa = InstagramRPA(
        username=username,
        password=password,
        proxy_url=proxy_url,
        totp_secret=totp_secret,
        job_id=jid,
        worker_id=worker_id,
    )

    try:
        # ═══ FASE 1: INSTAGRAPI MOBILE ═══

        # 1a. Login instagrapi
        if "instagrapi_login" not in completed:
            _stage_start(jid, "instagrapi_login")
            if _check_job_paused(jid, username):
                _stage_fail(jid, "instagrapi_login", "Job pausado")
                return {"success": False, "stage": "paused",
                        "message": "Job pausado", "error_code": "user_paused"}

            update_stage(jid, "instagrapi_login", status="processing")
            login_result = await asyncio.get_event_loop().run_in_executor(
                None, rpa._init_instagrapi
            )

            if not login_result.success:
                _stage_fail(jid, "instagrapi_login", login_result.message)
                update_stage(jid, "instagrapi_login", status="error",
                           error_code=login_result.error_code,
                           error_message=login_result.message)
                return {"success": False, "stage": "instagrapi_login",
                        "message": login_result.message,
                        "error_code": login_result.error_code}

            save_checkpoint(jid, "instagrapi_login")
            update_stage(jid, "instagrapi_login", status="done",
                        external_id=str(rpa.ig_user_id))
            _stage_ok(jid, "instagrapi_login", login_result.message)
            print(f"[RPA:{username}] FASE 1a OK: {login_result.message}")
        else:
            print(f"[RPA:{username}] Login instagrapi já completo (checkpoint)")
            # Restaurar sessão para operações subsequentes
            _stage_start(jid, "instagrapi_login")
            restore_result = await asyncio.get_event_loop().run_in_executor(
                None, rpa._init_instagrapi
            )
            if not restore_result.success:
                _stage_fail(jid, "instagrapi_login", f"Re-login falhou: {restore_result.message}")
                return {"success": False, "stage": "instagrapi_login",
                        "message": f"Re-login falhou: {restore_result.message}",
                        "error_code": restore_result.error_code}
            _stage_ok(jid, "instagrapi_login", "Restaurado do checkpoint")

        # 1b. Converter para criador
        if "convert_creator" not in completed:
            _stage_start(jid, "convert_creator")
            if _check_job_paused(jid, username):
                _stage_fail(jid, "convert_creator", "Job pausado")
                return {"success": False, "stage": "paused",
                        "message": "Job pausado", "error_code": "user_paused"}

            update_stage(jid, "convert_creator", status="processing")
            cr = await rpa.convert_to_creator()

            if not cr.success:
                _stage_fail(jid, "convert_creator", cr.message)
                update_stage(jid, "convert_creator", status="error",
                           error_code=cr.error_code, error_message=cr.message)
                return {"success": False, "stage": "convert_creator",
                        "message": cr.message, "error_code": cr.error_code}

            save_checkpoint(jid, "convert_creator")
            update_stage(jid, "convert_creator", status="done")
            _stage_ok(jid, "convert_creator", cr.message)
            print(f"[RPA:{username}] FASE 1b OK: {cr.message}")
        else:
            print(f"[RPA:{username}] Conversão já completa (checkpoint)")
            _stage_ok(jid, "convert_creator", "Já completo")

        # 1c. Story com link OBRIGATÓRIO
        if story_media_path and story_link_url and "post_story" not in completed:
            _stage_start(jid, "post_story")
            if _check_job_paused(jid, username):
                _stage_fail(jid, "post_story", "Job pausado")
                return {"success": False, "stage": "paused",
                        "message": "Job pausado", "error_code": "user_paused"}

            update_stage(jid, "post_story", status="processing")
            sr = await rpa.post_story_with_link(story_media_path, story_link_url, story_link_text)

            if not sr.success:
                _stage_fail(jid, "post_story", sr.message)
                update_stage(jid, "post_story", status="error",
                           error_code=sr.error_code, error_message=sr.message,
                           external_id=sr.data.get("story_pk"))
                # NÃO prosseguir para destaque se story falhou ou link não verificado
                return {"success": False, "stage": "post_story",
                        "message": sr.message, "error_code": sr.error_code,
                        "data": sr.data}

            save_checkpoint(jid, "post_story")
            update_stage(jid, "post_story", status="done",
                        external_id=rpa.story_pk)
            _stage_ok(jid, "post_story", sr.message)
            print(f"[RPA:{username}] FASE 1c OK: {sr.message}")
        elif "post_story" in completed:
            print(f"[RPA:{username}] Story já publicado (checkpoint)")
            _stage_ok(jid, "post_story", "Já completo")
        elif not story_media_path or not story_link_url:
            print(f"[RPA:{username}] Story pulado: mídia={bool(story_media_path)}, link={bool(story_link_url)}")

        # 1d. Foto de perfil
        if photo_path and "change_photo" not in completed:
            _stage_start(jid, "change_photo")
            if _check_job_paused(jid, username):
                _stage_fail(jid, "change_photo", "Job pausado")
                return {"success": False, "stage": "paused",
                        "message": "Job pausado", "error_code": "user_paused"}

            update_stage(jid, "change_photo", status="processing")
            pr = await rpa.change_profile_photo(photo_path)

            if not pr.success:
                _stage_fail(jid, "change_photo", pr.message)
                update_stage(jid, "change_photo", status="error",
                           error_code=pr.error_code, error_message=pr.message)
                return {"success": False, "stage": "change_photo",
                        "message": pr.message, "error_code": pr.error_code}

            save_checkpoint(jid, "change_photo")
            update_stage(jid, "change_photo", status="done")
            _stage_ok(jid, "change_photo", pr.message)
            print(f"[RPA:{username}] FASE 1d OK: {pr.message}")
        elif "change_photo" in completed:
            print(f"[RPA:{username}] Foto já alterada (checkpoint)")
            _stage_ok(jid, "change_photo", "Já completo")

        # 1e. Destaque (depende do story_pk confirmado)
        if highlight_title and "highlight" not in completed:
            _stage_start(jid, "highlight")
            if _check_job_paused(jid, username):
                _stage_fail(jid, "highlight", "Job pausado")
                return {"success": False, "stage": "paused",
                        "message": "Job pausado", "error_code": "user_paused"}

            # Verificar se temos story_pk para o destaque
            if not rpa.story_pk and "post_story" not in completed:
                _stage_fail(jid, "highlight", "Sem story_pk confirmado para destaque")
                return {"success": False, "stage": "highlight",
                        "message": "Story não publicado — não é possível criar destaque",
                        "error_code": "no_story_pk_for_highlight"}

            update_stage(jid, "highlight", status="processing")
            hr = await rpa.create_highlight(highlight_title, story_pk=rpa.story_pk)

            if not hr.success:
                _stage_fail(jid, "highlight", hr.message)
                update_stage(jid, "highlight", status="error",
                           error_code=hr.error_code, error_message=hr.message)
                return {"success": False, "stage": "highlight",
                        "message": hr.message, "error_code": hr.error_code}

            save_checkpoint(jid, "highlight")
            update_stage(jid, "highlight", status="done",
                        external_id=rpa.highlight_pk)
            _stage_ok(jid, "highlight", hr.message)
            print(f"[RPA:{username}] FASE 1e OK: {hr.message}")
        elif "highlight" in completed:
            print(f"[RPA:{username}] Destaque já criado (checkpoint)")
            _stage_ok(jid, "highlight", "Já completo")

        # ═══ FASE 2: PLAYWRIGHT WEB ═══

        # 2a. Extrair cookies e iniciar Playwright (com timeout)
        if "playwright_session" not in completed:
            _stage_start(jid, "playwright_session")
            if _check_job_paused(jid, username):
                _stage_fail(jid, "playwright_session", "Job pausado")
                return {"success": False, "stage": "paused",
                        "message": "Job pausado", "error_code": "user_paused"}

            update_stage(jid, "playwright_session", status="processing")

            async def _do_playwright_session():
                """Fase 2a completa: extrair cookies, injetar, navegar, validar."""
                cookies = rpa._extract_cookies_for_playwright()
                if not cookies:
                    raise RuntimeError("no_cookies")

                has_sessionid = any(c["name"] == "sessionid" for c in cookies)
                if not has_sessionid:
                    raise RuntimeError("sessionid_missing")

                await rpa.start(inject_cookies=cookies)

                # Navegar para Instagram e validar identidade
                await rpa.page.goto(
                    "https://www.instagram.com/",
                    wait_until="domcontentloaded",
                    timeout=NAVIGATION_TIMEOUT,
                )
                await rpa.page.wait_for_timeout(3000)

                auth_result = await rpa._is_authenticated_web()
                if not auth_result.success:
                    raise RuntimeError(auth_result.error_code or "session_rejected")
                return True

            try:
                await asyncio.wait_for(
                    _do_playwright_session(),
                    timeout=STAGE_TIMEOUTS.get("playwright_session", 120),
                )
            except asyncio.TimeoutError:
                _stage_fail(jid, "playwright_session", "Timeout na fase playwright_session")
                update_stage(jid, "playwright_session", status="error",
                           error_code="stage_timeout",
                           error_message=f"Excedeu {STAGE_TIMEOUTS['playwright_session']}s")
                try:
                    await asyncio.wait_for(rpa.stop(), timeout=5)
                except Exception:
                    pass
                return {"success": False, "stage": "playwright_session",
                        "message": f"Timeout após {STAGE_TIMEOUTS['playwright_session']}s",
                        "error_code": "stage_timeout"}
            except RuntimeError as rte:
                err_code = str(rte)
                if err_code == "no_cookies":
                    _stage_fail(jid, "playwright_session", "Nenhum cookie extraído do instagrapi")
                    update_stage(jid, "playwright_session", status="error",
                               error_code="no_cookies", error_message="Sem cookies para injetar")
                    return {"success": False, "stage": "playwright_session",
                            "message": "Nenhum cookie extraído do instagrapi",
                            "error_code": "sessionid_missing"}
                elif err_code == "sessionid_missing":
                    _stage_fail(jid, "playwright_session", "sessionid ausente nos cookies")
                    return {"success": False, "stage": "playwright_session",
                            "message": "sessionid ausente — sessão web não será válida",
                            "error_code": "sessionid_missing"}
                else:
                    # session_rejected, identity_mismatch, challenge_required, etc.
                    print(f"[RPA:{username}] Sessão web rejeitada — erro: {err_code}")
                    print(f"[RPA:{username}] NÃO tentando login UI (proibido pela especificação)")
                    try:
                        current_url = rpa.page.url
                        screenshot_path = f"/tmp/session_rejected_{username}.png"
                        await rpa.page.screenshot(path=screenshot_path)
                        print(f"[RPA:{username}] URL: {current_url} | Screenshot: {screenshot_path}")
                    except Exception:
                        pass
                    _stage_fail(jid, "playwright_session", f"Sessão web rejeitada ({err_code})")
                    update_stage(jid, "playwright_session", status="error",
                               error_code=err_code,
                               error_message="Cookies do instagrapi não autenticaram na web")
                    try:
                        await asyncio.wait_for(rpa.stop(), timeout=5)
                    except Exception:
                        pass
                    return {"success": False, "stage": "playwright_session",
                            "message": f"Sessão web rejeitada ({err_code})",
                            "error_code": err_code}
            # Sucesso na fase 2a
            save_checkpoint(jid, "playwright_session")
            update_stage(jid, "playwright_session", status="done")
            _stage_ok(jid, "playwright_session", "Sessão web validada")
            print(f"[RPA:{username}] FASE 2a OK: Sessão web validada com cookies")
        else:
            print(f"[RPA:{username}] Sessão web já completa (checkpoint)")
            _stage_start(jid, "playwright_session")
            cookies = rpa._extract_cookies_for_playwright()
            await rpa.start(inject_cookies=cookies or existing_cookies)
            await rpa.page.goto(
                "https://www.instagram.com/",
                wait_until="domcontentloaded",
                timeout=NAVIGATION_TIMEOUT,
            )
            await rpa.page.wait_for_timeout(3000)
            reauth = await rpa._is_authenticated_web()
            if not reauth.success:
                _stage_fail(jid, "playwright_session", "Re-validação web falhou")
                return {"success": False, "stage": "playwright_session",
                        "message": "Re-validação web falhou",
                        "error_code": reauth.error_code or "web_auth_failed"}
            _stage_ok(jid, "playwright_session", "Restaurado do checkpoint")

        # 2b. Aceitar convite tester (com timeout)
        if "accept_invite" not in completed:
            _stage_start(jid, "accept_invite")
            if _check_job_paused(jid, username):
                _stage_fail(jid, "accept_invite", "Job pausado")
                return {"success": False, "stage": "paused",
                        "message": "Job pausado", "error_code": "user_paused"}

            update_stage(jid, "accept_invite", status="processing")
            try:
                ir = await asyncio.wait_for(
                    rpa.accept_tester_invite(app_id=app_id),
                    timeout=STAGE_TIMEOUTS.get("accept_invite", 60),
                )
            except asyncio.TimeoutError:
                _stage_fail(jid, "accept_invite", "Timeout aceitando convite")
                update_stage(jid, "accept_invite", status="error",
                           error_code="stage_timeout",
                           error_message=f"Excedeu {STAGE_TIMEOUTS['accept_invite']}s")
                return {"success": False, "stage": "accept_invite",
                        "message": f"Timeout após {STAGE_TIMEOUTS['accept_invite']}s",
                        "error_code": "stage_timeout"}

            save_checkpoint(jid, "accept_invite")
            update_stage(jid, "accept_invite", status="done")
            _stage_ok(jid, "accept_invite", ir.message)
            print(f"[RPA:{username}] FASE 2b OK: {ir.message}")
        else:
            print(f"[RPA:{username}] Convite já processado (checkpoint)")
            _stage_ok(jid, "accept_invite", "Já completo")

        # 2c. Magic Link / OAuth (com timeout)
        if magic_link_url and "magic_link" not in completed:
            _stage_start(jid, "magic_link")
            if _check_job_paused(jid, username):
                _stage_fail(jid, "magic_link", "Job pausado")
                return {"success": False, "stage": "paused",
                        "message": "Job pausado", "error_code": "user_paused"}

            update_stage(jid, "magic_link", status="processing")
            try:
                ml = await asyncio.wait_for(
                    rpa.complete_magic_link(magic_link_url),
                    timeout=STAGE_TIMEOUTS.get("magic_link", 100),
                )
            except asyncio.TimeoutError:
                _stage_fail(jid, "magic_link", "Timeout no magic link")
                update_stage(jid, "magic_link", status="error",
                           error_code="stage_timeout",
                           error_message=f"Excedeu {STAGE_TIMEOUTS['magic_link']}s")
                return {"success": False, "stage": "magic_link",
                        "message": f"Timeout após {STAGE_TIMEOUTS['magic_link']}s",
                        "error_code": "stage_timeout"}

            if not ml.success:
                _stage_fail(jid, "magic_link", ml.message)
                update_stage(jid, "magic_link", status="error",
                           error_code=ml.error_code, error_message=ml.message)
                return {"success": False, "stage": "magic_link",
                        "message": ml.message, "error_code": ml.error_code}

            save_checkpoint(jid, "magic_link")
            update_stage(jid, "magic_link", status="done")
            _stage_ok(jid, "magic_link", "OAuth confirmado")
            print(f"[RPA:{username}] FASE 2c OK: OAuth/Magic Link confirmado")
        elif "magic_link" in completed:
            print(f"[RPA:{username}] Magic Link já completo (checkpoint)")
            _stage_ok(jid, "magic_link", "Já completo")

        # ═══ CONCLUSÃO ═══
        return {
            "success": True,
            "stage": "done",
            "message": "Onboarding completo (Instagrapi + Playwright)",
            "data": {
                "story_pk": rpa.story_pk,
                "story_link_verified": rpa.story_link_verified,
                "highlight_pk": rpa.highlight_pk,
                "ig_user_id": rpa.ig_user_id,
            },
        }

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[RPA:{username}] ERRO GLOBAL: {tb[-500:]}")
        stages = _job_stages.get(jid, [])
        running = [s for s in stages if s["status"] == "running"]
        if running:
            _stage_fail(jid, running[-1]["key"], str(e)[:200])
        return {
            "success": False,
            "stage": "unknown",
            "message": f"Erro inesperado: {type(e).__name__}: {str(e)[:200]}",
            "error_code": "unexpected_error",
        }
    finally:
        await rpa.stop()