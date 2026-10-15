"""
AutoScale - Motor "browser" (Playwright) para contas do Instagram.

Paralelo ao motor instagrapi (instagram_login.py / onboarding.py), que segue
no ar sem alteração. Motivação: o login pela API privada mobile passou a
falhar com app_outdated / "CAA login did not return a session"; o
instagram.com no navegador é a rota mais estável.

Arquitetura:
  1 conta = 1 contexto de navegador isolado = 1 proxy fixa residencial.
  Login uma vez; o storage_state (cookies + localStorage) é salvo e as
  sessões seguintes começam já logadas.

Este módulo NÃO toca no banco. Quem persiste é session_store.py (chamado
pelo endpoint). Aqui só: montar o contexto, reusar sessão, logar, classificar
o resultado e capturar a evidência (texto da tela, resposta bruta do login,
screenshot) — a instagrapi descarta a resposta real; aqui ela é preservada.

Segredos: senha e credenciais da proxy NUNCA entram em log, mensagem ou
screenshot. Loga-se só o IP de SAÍDA da proxy (mesma política do instagrapi).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import random
import re
import subprocess
import time
from dataclasses import dataclass, field
from urllib.parse import unquote, urlparse

import httpx

BUILD = "brwv1"

LOGIN_URL = "https://www.instagram.com/accounts/login/"
SESSION_CHECK_URL = "https://www.instagram.com/accounts/edit/"

# Teto por tentativa de login (requisito: <= 90s). O loop interno usa um
# deadline um pouco menor para ainda conseguir tirar screenshot antes do
# corte duro do asyncio.wait_for.
LOGIN_HARD_TIMEOUT_S = 90
LOGIN_SOFT_BUDGET_S = 78

# Chromium consome ~250-450 MB por contexto ativo. Limita quantos rodam ao
# mesmo tempo no container do Railway; os demais esperam na fila.
_MAX_CONCURRENCY = max(1, int(os.environ.get("BROWSER_MAX_CONCURRENCY", "2")))
_semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)

STATUS_SUCCESS = "success"
STATUS_WRONG_PASSWORD = "wrong_password"
STATUS_CHECKPOINT = "checkpoint"
STATUS_IP_ERROR = "ip_error"
STATUS_UNKNOWN = "unknown_error"


# ---------------------------------------------------------------------------
# Proxy
# ---------------------------------------------------------------------------


@dataclass
class ProxyConfig:
    server: str  # scheme://host:port (sem credenciais)
    username: str | None = None
    password: str | None = None

    def playwright(self) -> dict:
        cfg: dict = {"server": self.server}
        if self.username:
            cfg["username"] = self.username
        if self.password:
            cfg["password"] = self.password
        return cfg

    def httpx_url(self) -> str:
        parsed = urlparse(self.server)
        if self.username:
            from urllib.parse import quote

            auth = quote(self.username, safe="")
            if self.password:
                auth += ":" + quote(self.password, safe="")
            return f"{parsed.scheme}://{auth}@{parsed.hostname}:{parsed.port}"
        return self.server


def parse_proxy(value) -> ProxyConfig:
    """
    Aceita os formatos já usados no projeto:
      - objeto {server, username, password}
      - URL  http://user:pass@host:porta   (formato de instagram_accounts.proxy_url)
      - host:porta:user:pass               (formato gbproxies do CSV bulk-proxy)
      - host:porta
    """
    if isinstance(value, dict):
        server = str(value.get("server") or "").strip()
        if not server:
            raise ValueError("proxy.server ausente")
        if "://" not in server:
            server = "http://" + server
        return ProxyConfig(server, value.get("username") or None, value.get("password") or None)

    raw = str(value or "").strip()
    if not raw:
        raise ValueError("proxy ausente")

    if "://" in raw:
        parsed = urlparse(raw)
        if not parsed.hostname or not parsed.port:
            raise ValueError("proxy URL sem host/porta")
        scheme = parsed.scheme.lower()
        if scheme not in ("http", "https", "socks5"):
            raise ValueError(f"esquema de proxy não suportado: {scheme}")
        user = unquote(parsed.username) if parsed.username else None
        pwd = unquote(parsed.password) if parsed.password else None
        if scheme == "socks5" and user:
            # Chromium não suporta autenticação em proxy SOCKS5.
            raise ValueError("Chromium não suporta SOCKS5 com usuário/senha — use a proxy HTTP")
        return ProxyConfig(f"{scheme}://{parsed.hostname}:{parsed.port}", user, pwd)

    parts = raw.split(":")
    if len(parts) == 4:
        host, port, user, pwd = parts
        return ProxyConfig(f"http://{host}:{port}", user, pwd)
    if len(parts) == 2:
        return ProxyConfig(f"http://{parts[0]}:{parts[1]}")
    raise ValueError("formato de proxy não reconhecido")


# ---------------------------------------------------------------------------
# Geo da proxy (timezone/locale do contexto precisam bater com o IP)
# ---------------------------------------------------------------------------

_PROXY_NET_ERRORS = (
    httpx.ProxyError,
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
)

_COUNTRY_LOCALE = {
    "BR": "pt-BR", "PT": "pt-PT", "US": "en-US", "GB": "en-GB", "CA": "en-CA",
    "MX": "es-MX", "AR": "es-AR", "ES": "es-ES", "DE": "de-DE", "FR": "fr-FR",
    "IT": "it-IT", "NL": "nl-NL", "PL": "pl-PL",
}


@dataclass
class ProxyGeo:
    ip: str
    country: str
    timezone: str


class ProxyUnreachable(Exception):
    pass


async def lookup_proxy_geo(proxy: ProxyConfig) -> ProxyGeo:
    """
    IP de saída + país + timezone pela PRÓPRIA proxy. Falha de conexão aqui é
    o diagnóstico mais barato de proxy morta — nem abre o navegador.
    """
    last_exc: Exception | None = None
    async with httpx.AsyncClient(proxy=proxy.httpx_url(), timeout=15.0) as client:
        for url in ("https://ipinfo.io/json", "http://ip-api.com/json/"):
            try:
                resp = await client.get(url)
            except _PROXY_NET_ERRORS as exc:
                raise ProxyUnreachable(f"{type(exc).__name__}: {str(exc)[:160]}") from exc
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                continue
            if resp.status_code == 407:
                raise ProxyUnreachable("HTTP 407 — proxy recusou a autenticação")
            if resp.status_code != 200:
                last_exc = RuntimeError(f"{url} HTTP {resp.status_code}")
                continue
            try:
                data = resp.json()
            except ValueError as exc:
                last_exc = exc
                continue
            ip = str(data.get("ip") or data.get("query") or "")
            country = str(data.get("country") if "ipinfo" in url else data.get("countryCode") or "").upper()
            tz = str(data.get("timezone") or "")
            if ip:
                return ProxyGeo(ip=ip, country=country or "BR", timezone=tz or "America/Sao_Paulo")
    # Serviço de geo indisponível mas proxy respondeu: segue com o padrão BR.
    return ProxyGeo(ip=f"desconhecido ({last_exc})"[:80], country="BR", timezone="America/Sao_Paulo")


# ---------------------------------------------------------------------------
# Fingerprint determinístico por conta
# ---------------------------------------------------------------------------

_VIEWPORTS = [(1366, 768), (1440, 900), (1536, 864), (1600, 900), (1920, 1080), (1280, 800)]


def build_fingerprint(seed: str, browser_version: str, geo: ProxyGeo) -> dict:
    """
    Mesma conta -> mesmo viewport sempre (seed). O user agent declara Linux de
    propósito: é o SO real do container. UA de Windows num navegador cujo
    navigator.platform diz "Linux x86_64" é uma inconsistência que qualquer
    script anti-bot detecta.
    """
    rng = random.Random(hashlib.sha256(seed.lower().encode()).hexdigest())
    width, height = rng.choice(_VIEWPORTS)
    major = (browser_version or "140").split(".")[0]
    return {
        "user_agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            f"(KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": width, "height": height},
        "locale": _COUNTRY_LOCALE.get(geo.country, "pt-BR"),
        "timezone_id": geo.timezone,
        "browser_major": major,
    }


# ---------------------------------------------------------------------------
# Xvfb (modo "headed" dentro do Docker, sem monitor)
# ---------------------------------------------------------------------------

_xvfb_proc: subprocess.Popen | None = None


def _cleanup_xvfb() -> None:
    """Termina o processo Xvfb ao encerrar o Python, evitando zombies."""
    global _xvfb_proc
    if _xvfb_proc is not None and _xvfb_proc.poll() is None:
        _xvfb_proc.terminate()
        try:
            _xvfb_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _xvfb_proc.kill()
        _xvfb_proc = None


import atexit
atexit.register(_cleanup_xvfb)


def _ensure_display() -> None:
    global _xvfb_proc
    if os.environ.get("DISPLAY"):
        return
    if _xvfb_proc is None or _xvfb_proc.poll() is not None:
        _xvfb_proc = subprocess.Popen(
            ["Xvfb", ":99", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(1.0)
    os.environ["DISPLAY"] = ":99"


def default_headless() -> bool:
    return os.environ.get("BROWSER_HEADLESS", "1").strip().lower() not in ("0", "false", "no")


# ---------------------------------------------------------------------------
# Classificação da tela / resposta
# ---------------------------------------------------------------------------

_WRONG_PASSWORD_PATTERNS = [
    "informações de login que você inseriu estão incorretas", "login information you entered is incorrect",
    "sua senha está incorreta", "senha incorreta", "senha que você inseriu está incorreta",
    "your password was incorrect", "password you entered is incorrect", "incorrect password",
    "doesn't belong to an account", "não pertence a uma conta",
    "username you entered doesn't", "nome de usuário que você inseriu",
]

_IP_ERROR_PATTERNS = [
    "please wait a few minutes", "aguarde alguns minutos", "espere alguns minutos",
    "try again later", "tente novamente mais tarde",
    "problem logging you into instagram", "problema ao entrar no instagram",
    "houve um problema", "ocorreu um problema",
    "sorry, something went wrong", "algo deu errado",
    "ip address", "endereço ip", "unusual traffic", "tráfego incomum",
]

_CHECKPOINT_TEXT_PATTERNS = [
    "confirme que é você", "confirm it's you", "confirm that it's you",
    "we detected an unusual login attempt", "tentativa de login incomum",
    "atividade suspeita", "suspicious", "attività sospetta", "attendasi",
    "check your email", "verifique seu email", "verifique seu e-mail",
    "enter the code we sent", "insira o código que enviamos", "digite o código",
    "security code", "código de segurança",
    "help us confirm", "ajude-nos a confirmar",
    "your account has been suspended", "sua conta foi suspensa",
    "we suspended your account", "suspendemos sua conta",
    "your account has been disabled", "sua conta foi desativada",
]

_CHECKPOINT_URL_MARKERS = [
    ("/challenge", "challenge"),
    ("/checkpoint", "checkpoint"),
    ("/auth_platform", "auth_platform"),
    ("/accounts/suspended", "suspended"),
    ("/accounts/disabled", "disabled"),
]

_NET_ERROR_MARKERS = (
    "ERR_PROXY", "ERR_TUNNEL", "ERR_TIMED_OUT", "ERR_CONNECTION", "ERR_SOCKS",
    "ERR_NAME_NOT_RESOLVED", "ERR_ADDRESS_UNREACHABLE", "ERR_EMPTY_RESPONSE",
    "ERR_INTERNET_DISCONNECTED", "NS_ERROR_PROXY", "Timeout",
)


def _match(text: str, patterns: list[str]) -> str | None:
    for p in patterns:
        if p in text:
            return p
    return None


_FOOTER_MARKERS = (" Meta Sobre Blog", " Meta About Blog", " Sobre Blog Carreiras", " About Blog Jobs")


def _clean_text(text: str, limit: int = 600) -> str:
    """Texto visível sem o rodapé fixo do site (links institucionais/idiomas)."""
    clean = re.sub(r"\s+", " ", text or "").strip()
    for marker in _FOOTER_MARKERS:
        idx = clean.find(marker)
        if idx > 0:
            clean = clean[:idx]
    return clean[:limit]


def _compact_raw(raw_login: dict) -> str | None:
    """Resposta bruta do login, só com o que tem informação (tira null/false)."""
    if not raw_login:
        return None
    caa = raw_login.get("caa")
    if isinstance(caa, dict):
        useful = {k: v for k, v in caa.items() if v not in (None, False, "", [], {})}
        return json.dumps(
            {"status": raw_login.get("status"), "url": raw_login.get("url"), "caa_login_web": useful},
            ensure_ascii=False,
        )[:2000]
    return json.dumps({k: v for k, v in raw_login.items() if k != "caa"}, ensure_ascii=False)[:2000]


# ---------------------------------------------------------------------------
# Resultado
# ---------------------------------------------------------------------------


@dataclass
class LoginOutcome:
    status: str
    message: str
    storage_state: dict | None = None
    fingerprint: dict | None = None
    screenshot_b64: str | None = None
    checkpoint: dict | None = None
    session_reused: bool = False
    proxy_ip: str | None = None
    proxy_country: str | None = None
    elapsed_ms: int = 0
    raw_response: str | None = None
    log: list[dict] = field(default_factory=list)


def _log(outcome_log: list[dict], step: str, t0: float, **extra) -> None:
    entry = {"step": step, "t_ms": int((time.monotonic() - t0) * 1000), **extra}
    outcome_log.append(entry)


async def _human_pause(lo: float = 1.0, hi: float = 4.0) -> None:
    await asyncio.sleep(random.uniform(lo, hi))


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


async def browser_login(
    username: str,
    password: str,
    proxy,
    *,
    totp_secret: str | None = None,
    storage_state: dict | None = None,
    fingerprint: dict | None = None,
    headless: bool | None = None,
    capture_screenshot: bool = True,
) -> LoginOutcome:
    """
    Uma tentativa de login (<= 90s). Sem retry nem troca de proxy aqui — a
    política de rotação (6 tentativas) é responsabilidade do worker (Fase 4).
    """
    t0 = time.monotonic()
    steps: list[dict] = []

    try:
        proxy_cfg = parse_proxy(proxy)
    except ValueError as exc:
        return LoginOutcome(STATUS_IP_ERROR, f"[{BUILD}] Proxy inválida: {exc}", log=steps)

    async with _semaphore:
        _log(steps, "slot_acquired", t0)
        try:
            return await asyncio.wait_for(
                _login_attempt(
                    username.strip().lstrip("@"), password, proxy_cfg, totp_secret,
                    storage_state, fingerprint,
                    default_headless() if headless is None else headless,
                    capture_screenshot, t0, steps,
                ),
                timeout=LOGIN_HARD_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            _log(steps, "hard_timeout", t0)
            return LoginOutcome(
                STATUS_UNKNOWN,
                f"[{BUILD}] Tentativa excedeu {LOGIN_HARD_TIMEOUT_S}s e foi abortada.",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                log=steps,
            )


async def _login_attempt(
    username: str,
    password: str,
    proxy: ProxyConfig,
    totp_secret: str | None,
    storage_state: dict | None,
    fingerprint: dict | None,
    headless: bool,
    capture_screenshot: bool,
    t0: float,
    steps: list[dict],
) -> LoginOutcome:
    from playwright.async_api import Error as PlaywrightError
    from playwright.async_api import async_playwright

    deadline = t0 + LOGIN_SOFT_BUDGET_S

    def finish(outcome: LoginOutcome) -> LoginOutcome:
        outcome.elapsed_ms = int((time.monotonic() - t0) * 1000)
        outcome.log = steps
        return outcome

    # 1) Proxy viva? (sem abrir navegador)
    try:
        geo = await lookup_proxy_geo(proxy)
    except ProxyUnreachable as exc:
        _log(steps, "proxy_unreachable", t0)
        return finish(LoginOutcome(STATUS_IP_ERROR, f"[{BUILD}] Proxy não respondeu: {exc}"))
    _log(steps, "proxy_geo", t0, exit_ip=geo.ip, country=geo.country, tz=geo.timezone)

    if not headless:
        _ensure_display()

    async with async_playwright() as pw:
        launch_kwargs = dict(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            ignore_default_args=["--enable-automation"],
        )
        try:
            # channel="chromium" = Chromium completo no modo headless NOVO
            # (mesmo binário do modo com janela). O "headless shell" antigo se
            # identifica como HeadlessChrome nos client hints.
            browser = await pw.chromium.launch(channel="chromium", **launch_kwargs)
        except PlaywrightError as exc:
            _log(steps, "launch_failed", t0)
            return finish(LoginOutcome(STATUS_UNKNOWN, f"[{BUILD}] Falha ao abrir o Chromium: {str(exc)[:300]}"))

        try:
            fp = fingerprint if (fingerprint and fingerprint.get("user_agent")) else build_fingerprint(
                username, browser.version, geo
            )
            # Timezone/locale sempre coerentes com o IP ATUAL da proxy.
            fp = {**fp, "timezone_id": geo.timezone, "locale": _COUNTRY_LOCALE.get(geo.country, fp.get("locale", "pt-BR"))}

            context = await browser.new_context(
                proxy=proxy.playwright(),
                user_agent=fp["user_agent"],
                viewport=fp["viewport"],
                locale=fp["locale"],
                timezone_id=fp["timezone_id"],
                storage_state=storage_state or None,
                extra_http_headers={"Accept-Language": f"{fp['locale']},pt;q=0.9,en-US;q=0.8,en;q=0.7"},
                color_scheme="light",
            )
            context.set_default_timeout(20_000)
            page = await context.new_page()

            # Resposta BRUTA do login (JSON do endpoint ajax/bloks). É o que a
            # instagrapi joga fora e o que mais ajuda no diagnóstico.
            raw_login: dict = {}

            async def on_response(resp):
                url = resp.url
                if "instagram.com" not in url or resp.request.method != "POST":
                    return
                path = urlparse(url).path
                keyword_url = any(k in path for k in ("login", "two_factor", "checkpoint", "challenge"))
                if not keyword_url and path != "/api/graphql":
                    return
                try:
                    body = await resp.text()
                except Exception:  # noqa: BLE001
                    return
                # /api/graphql recebe dezenas de queries; só interessa a do login
                # (caa_login_web) e as de 2FA/checkpoint.
                if not keyword_url and not any(k in body for k in ("caa_login", "two_factor", "checkpoint", "challenge")):
                    return
                raw_login["status"] = resp.status
                raw_login["url"] = path
                raw_login["body"] = body[:2000]
                try:
                    data = json.loads(body.replace("for (;;);", "", 1))
                    caa = (data.get("data") or {}).get("caa_login_web")
                    if isinstance(caa, dict):
                        raw_login["caa"] = caa
                except Exception:  # noqa: BLE001
                    pass

            page.on("response", on_response)

            async def screenshot() -> str | None:
                if not capture_screenshot:
                    return None
                try:
                    png = await page.screenshot(type="jpeg", quality=55, full_page=False, timeout=8_000)
                    return base64.b64encode(png).decode()
                except Exception:  # noqa: BLE001
                    return None

            async def page_text() -> str:
                try:
                    return await page.inner_text("body", timeout=5_000)
                except Exception:  # noqa: BLE001
                    return ""

            async def has_session_cookie() -> bool:
                cookies = await context.cookies("https://www.instagram.com")
                return any(c["name"] == "sessionid" and c.get("value") for c in cookies)

            async def fail(status: str, message: str, checkpoint: dict | None = None) -> LoginOutcome:
                text = _clean_text(await page_text())
                shot = await screenshot()
                raw = _compact_raw(raw_login)
                full = f"[{BUILD}][exit_ip={geo.ip}][geo={geo.country}] {message}"
                if text:
                    full += f" | tela: {text}"
                if raw:
                    full += f" | resposta_login: {raw}"
                _log(steps, "fail", t0, status=status, url=_safe_url(page.url))
                return finish(LoginOutcome(
                    status, full[:3000], fingerprint=fp, screenshot_b64=shot, checkpoint=checkpoint,
                    proxy_ip=geo.ip, proxy_country=geo.country, raw_response=raw,
                ))

            async def goto(url: str) -> LoginOutcome | None:
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                    return None
                except PlaywrightError as exc:
                    msg = str(exc)
                    if any(m in msg for m in _NET_ERROR_MARKERS):
                        return await fail(STATUS_IP_ERROR, f"Falha de rede/proxy ao abrir {urlparse(url).path}: {msg.splitlines()[0][:200]}")
                    return await fail(STATUS_UNKNOWN, f"Erro ao abrir {urlparse(url).path}: {msg.splitlines()[0][:200]}")

            # 2) Sessão salva: tenta entrar direto.
            if storage_state:
                err = await goto(SESSION_CHECK_URL)
                if err:
                    return err
                await _human_pause(2.0, 3.5)
                if "/accounts/login" not in page.url and await has_session_cookie():
                    cp = _checkpoint_from_url(page.url)
                    if cp:
                        return await fail(STATUS_CHECKPOINT, f"Sessão salva caiu em checkpoint ({cp['type']}).", cp)
                    _log(steps, "session_reused", t0)
                    state = await context.storage_state()
                    return finish(LoginOutcome(
                        STATUS_SUCCESS, f"[{BUILD}] Sessão salva reaproveitada — sem passar pelo login.",
                        storage_state=state, fingerprint=fp, session_reused=True,
                        proxy_ip=geo.ip, proxy_country=geo.country,
                    ))
                _log(steps, "session_expired", t0)

            # 3) Tela de login.
            err = await goto(LOGIN_URL)
            if err:
                return err
            _log(steps, "login_page", t0, url=_safe_url(page.url))
            await _human_pause(1.5, 3.0)
            await _dismiss_cookie_banner(page)

            if await has_session_cookie() and "/accounts/login" not in page.url:
                state = await context.storage_state()
                return finish(LoginOutcome(
                    STATUS_SUCCESS, f"[{BUILD}] Já estava logado.", storage_state=state, fingerprint=fp,
                    session_reused=bool(storage_state), proxy_ip=geo.ip, proxy_country=geo.country,
                ))

            user_input = page.locator(
                'input[name="username"], input[name="email"], input[autocomplete="username"]'
            ).first
            pass_input = page.locator(
                'input[name="password"], input[name="pass"], input[type="password"]'
            ).first
            try:
                await user_input.wait_for(state="visible", timeout=25_000)
                await pass_input.wait_for(state="visible", timeout=5_000)
            except PlaywrightError:
                text = (await page_text()).lower()
                hit = _match(text, _IP_ERROR_PATTERNS)
                if hit:
                    return await fail(STATUS_IP_ERROR, f"Instagram bloqueou antes do formulário ('{hit}').")
                return await fail(STATUS_UNKNOWN, "Formulário de login não apareceu.")

            # 4) Preenche como humano.
            await user_input.click()
            await _human_pause(0.6, 1.4)
            await user_input.press_sequentially(username, delay=random.randint(70, 160))
            await _human_pause(0.8, 2.0)
            await pass_input.click()
            await _human_pause(0.4, 1.0)
            await pass_input.press_sequentially(password, delay=random.randint(60, 140))
            await _human_pause(1.0, 2.2)
            await pass_input.press("Enter")
            _log(steps, "submitted", t0)

            # 5) Espera o desfecho.
            totp_used = False
            while time.monotonic() < deadline:
                await asyncio.sleep(1.0)

                if await has_session_cookie():
                    cp = _checkpoint_from_url(page.url)
                    if cp:
                        return await fail(STATUS_CHECKPOINT, f"Login criou sessão mas caiu em checkpoint ({cp['type']}).", cp)
                    await _human_pause(1.5, 3.0)
                    state = await context.storage_state()
                    _log(steps, "logged_in", t0, url=_safe_url(page.url))
                    return finish(LoginOutcome(
                        STATUS_SUCCESS, f"[{BUILD}][exit_ip={geo.ip}] Login OK.",
                        storage_state=state, fingerprint=fp, proxy_ip=geo.ip, proxy_country=geo.country,
                    ))

                url = page.url
                raw_body = (raw_login.get("body") or "").lower()
                raw_status = raw_login.get("status")
                caa = raw_login.get("caa") or {}
                caa_redirect = str(caa.get("redirect_uri") or "")
                caa_error = " ".join(str(caa.get(k) or "") for k in ("error_code", "error_message")).strip()

                if caa.get("recaptcha_needed") or caa.get("is_ig_login_recaptcha"):
                    return await fail(STATUS_IP_ERROR, "Instagram exigiu reCAPTCHA no login (ambiente/IP considerado suspeito).")

                # 2FA
                code_input = page.locator(
                    'input[name="verificationCode"], input[name="approvals_code"], input[autocomplete="one-time-code"]'
                ).first
                is_2fa = "two_factor" in url or "two_factor_required" in raw_body or bool(caa.get("two_factor_result"))
                if is_2fa or await _visible(code_input):
                    if totp_secret and not totp_used and await _visible(code_input):
                        import pyotp

                        totp_used = True
                        await _human_pause(1.0, 2.0)
                        await code_input.press_sequentially(pyotp.TOTP(totp_secret).now(), delay=random.randint(90, 180))
                        await _human_pause(0.8, 1.6)
                        await code_input.press("Enter")
                        _log(steps, "totp_submitted", t0)
                        continue
                    if not totp_secret:
                        return await fail(
                            STATUS_CHECKPOINT, "Conta exige código de 2FA e nenhum segredo TOTP foi informado.",
                            {"type": "two_factor", "url": _safe_url(url)},
                        )

                cp = _checkpoint_from_url(url) or _checkpoint_from_url(caa_redirect)
                if cp or "checkpoint_required" in raw_body or "challenge_required" in raw_body:
                    cp = cp or {"type": "checkpoint_required", "url": _safe_url(url)}
                    cp["screen_text"] = _clean_text(await page_text(), 400)
                    return await fail(STATUS_CHECKPOINT, f"Instagram pediu verificação ({cp['type']}).", cp)

                if raw_status == 429 or "please wait a few minutes" in raw_body or '"spam": true' in raw_body or '"spam":true' in raw_body:
                    return await fail(STATUS_IP_ERROR, f"Instagram limitou o login (HTTP {raw_status}).")

                text = (await page_text()).lower()

                hit = _match(text, _WRONG_PASSWORD_PATTERNS) or _match(caa_error.lower(), _WRONG_PASSWORD_PATTERNS)
                if hit or ('"authenticated": false' in raw_body or '"authenticated":false' in raw_body):
                    return await fail(STATUS_WRONG_PASSWORD, f"Credenciais recusadas ('{hit or 'authenticated=false'}').")

                if caa_error:
                    hit = _match(caa_error.lower(), _IP_ERROR_PATTERNS)
                    if hit:
                        return await fail(STATUS_IP_ERROR, f"Instagram recusou o login: {caa_error[:200]}")

                hit = _match(text, _CHECKPOINT_TEXT_PATTERNS)
                if hit:
                    return await fail(
                        STATUS_CHECKPOINT, f"Tela de verificação/atividade suspeita ('{hit}').",
                        {"type": "suspicious_login", "url": _safe_url(url), "screen_text": _clean_text(text, 400)},
                    )

                hit = _match(text, _IP_ERROR_PATTERNS)
                if hit and "/accounts/login" in url:
                    return await fail(STATUS_IP_ERROR, f"Instagram recusou o ambiente ('{hit}').")

            return await fail(STATUS_UNKNOWN, f"Sem desfecho reconhecível em {LOGIN_SOFT_BUDGET_S}s após enviar o login.")
        finally:
            try:
                await browser.close()
            except Exception:  # noqa: BLE001
                pass


def _safe_url(url: str) -> str:
    """Só host+path — query string de checkpoint pode carregar tokens."""
    try:
        p = urlparse(url)
        return f"{p.netloc}{p.path}"
    except Exception:  # noqa: BLE001
        return ""


def _checkpoint_from_url(url: str) -> dict | None:
    lower = (url or "").lower()
    for marker, kind in _CHECKPOINT_URL_MARKERS:
        if marker in lower:
            return {"type": kind, "url": _safe_url(url)}
    return None


async def _visible(locator) -> bool:
    try:
        return await locator.is_visible(timeout=300)
    except Exception:  # noqa: BLE001
        return False


async def _dismiss_cookie_banner(page) -> None:
    labels = re.compile(
        r"(Permitir todos os cookies|Allow all cookies|Aceitar tudo|Accept all|"
        r"Recusar cookies opcionais|Decline optional cookies)",
        re.I,
    )
    try:
        btn = page.get_by_role("button", name=labels).first
        if await btn.is_visible(timeout=1_500):
            await _human_pause(0.8, 1.8)
            await btn.click()
            await _human_pause(1.0, 2.0)
    except Exception:  # noqa: BLE001
        pass
