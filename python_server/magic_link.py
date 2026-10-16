"""
ScaleMaster - Etapa magic_link do onboarding, automatizada no navegador.

Ultima etapa do onboarding (invite -> photo -> professional ->
verify_professional -> magic_link). Ate aqui ela exigia um humano: copiar o
link /add/{token} e autorizar o app no navegador. Este modulo faz esse mesmo
percurso com Playwright, reaproveitando tudo que o browser_engine ja resolve
(proxy, geo, fingerprint deterministico, limite de concorrencia).

O percurso e exatamente o do usuario real, porque o backend nao muda:

  /add/{token}  -> grava os cookies de contexto OAuth (ig_oauth_state,
                   ig_oauth_magic_user_id, ig_oauth_app_id) no dominio do
                   SaaS e redireciona para o Instagram
  instagram.com/oauth/authorize -> tela de autorizacao do app (ou redirect
                   direto, quando a conta ja autorizou antes)
  /api/instagram/callback -> troca o code, vincula a conta e redireciona
  /add/success  -> confirmacao

Nada em /api/instagram/callback foi tocado: a automacao so entrega o browser
ate la, com os mesmos cookies que um humano teria.

IDENTIDADE: a tela de autorizacao vincula QUEM ESTIVER logado no navegador.
Por isso a sessao e conferida contra o ds_user_id da conta antes de qualquer
clique - sem essa checagem, uma sessao errada no contexto vincularia a conta
errada ao usuario do SaaS, em silencio.

LIMITE CONHECIDO: os seletores do botao de autorizacao sao HIPOTESES. A Meta
nao documenta o DOM dessa tela e ele muda sem aviso. Quando nenhum candidato
casa, a etapa volta needs_manual com screenshot e o texto da tela - nunca
chuta clique em botao desconhecido, que poderia ser "Cancelar".
"""

from __future__ import annotations

import asyncio
import base64
import re
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

from browser_engine import (
    ProxyUnreachable,
    _checkpoint_from_url,
    _clean_text,
    _dismiss_cookie_banner,
    _human_pause,
    _log,
    _safe_url,
    _semaphore,
    _visible,
    _COUNTRY_LOCALE,
    _CHECKPOINT_TEXT_PATTERNS,
    _NET_ERROR_MARKERS,
    _ensure_display,
    build_fingerprint,
    default_headless,
    lookup_proxy_geo,
    parse_proxy,
)

BUILD = "mlnkv1"

HARD_TIMEOUT_S = 100
SOFT_BUDGET_S = 88

STATUS_SUCCESS = "success"
STATUS_NEEDS_MANUAL = "needs_manual"
STATUS_IP_ERROR = "ip_error"
STATUS_UNKNOWN = "unknown_error"

# Rotulos do botao que conclui a autorizacao. HIPOTESES - ver docstring.
_ALLOW_LABELS = re.compile(
    r"^(permitir|allow|autorizar|authorize|continuar|continue"
    r"|allow access|permitir acesso|continuar como|continue as)\b",
    re.I,
)
# Nunca clicar nestes, mesmo que casem por acidente no seletor generico.
_DENY_LABELS = re.compile(
    r"(cancelar|cancel|negar|deny|nao permitir|não permitir|don't allow|do not allow|voltar|back)",
    re.I,
)

_LOGIN_URL_MARKERS = ("/accounts/login", "/accounts/signup", "/login")


@dataclass
class MagicLinkOutcome:
    status: str
    message: str
    storage_state: dict | None = None
    fingerprint: dict | None = None
    screenshot_b64: str | None = None
    checkpoint: dict | None = None
    final_url: str | None = None
    authorized_click: bool = False
    proxy_ip: str | None = None
    proxy_country: str | None = None
    elapsed_ms: int = 0
    log: list[dict] = field(default_factory=list)


def storage_state_from_instagrapi(settings: dict | None) -> dict | None:
    """
    Converte os cookies da sessao instagrapi (API privada, mobile) em
    storage_state do Playwright.

    A instagrapi guarda a sessao em `cookies` e/ou `authorization_data`; o
    `sessionid` e o mesmo token que o instagram.com aceita no navegador. Sem
    sessionid nao ha o que restaurar.
    """
    if not isinstance(settings, dict):
        return None

    cookies = settings.get("cookies") if isinstance(settings.get("cookies"), dict) else {}
    auth = settings.get("authorization_data") if isinstance(settings.get("authorization_data"), dict) else {}

    sessionid = cookies.get("sessionid") or auth.get("sessionid")
    if not sessionid:
        return None

    values = {
        "sessionid": sessionid,
        "ds_user_id": cookies.get("ds_user_id") or auth.get("ds_user_id"),
        "csrftoken": cookies.get("csrftoken"),
        "mid": cookies.get("mid") or settings.get("mid"),
        "ig_did": cookies.get("ig_did"),
        "rur": cookies.get("rur") or settings.get("ig_u_rur"),
    }

    # 1 ano: o proprio Instagram expira a sessao do lado dele; aqui so evita
    # que o cookie nasca como de sessao e morra ao fechar o contexto.
    expires = time.time() + 365 * 24 * 3600
    jar = [
        {
            "name": name,
            "value": str(value),
            "domain": ".instagram.com",
            "path": "/",
            "expires": expires,
            "httpOnly": name in ("sessionid", "ds_user_id"),
            "secure": True,
            "sameSite": "Lax",
        }
        for name, value in values.items()
        if value
    ]
    return {"cookies": jar, "origins": []}


def _expected_ds_user_id(settings: dict | None) -> str | None:
    if not isinstance(settings, dict):
        return None
    auth = settings.get("authorization_data") if isinstance(settings.get("authorization_data"), dict) else {}
    cookies = settings.get("cookies") if isinstance(settings.get("cookies"), dict) else {}
    value = auth.get("ds_user_id") or cookies.get("ds_user_id")
    return str(value) if value else None


async def complete_magic_link(
    magic_url: str,
    username: str,
    proxy,
    *,
    session_settings: dict | None = None,
    storage_state: dict | None = None,
    fingerprint: dict | None = None,
    device_seed: str | None = None,
    headless: bool | None = None,
    capture_screenshot: bool = True,
) -> MagicLinkOutcome:
    """Uma tentativa (<= 100s). Retry e politica de repeticao sao do cron."""
    t0 = time.monotonic()
    steps: list[dict] = []

    parsed = urlparse(magic_url or "")
    if parsed.scheme not in ("http", "https") or not parsed.netloc or "/add/" not in parsed.path:
        return MagicLinkOutcome(
            STATUS_NEEDS_MANUAL,
            f"[{BUILD}] Link magico invalido (esperado .../add/<token>).",
            log=steps,
        )

    try:
        proxy_cfg = parse_proxy(proxy)
    except ValueError as exc:
        return MagicLinkOutcome(STATUS_IP_ERROR, f"[{BUILD}] Proxy invalida: {exc}", log=steps)

    async with _semaphore:
        _log(steps, "slot_acquired", t0)
        try:
            return await asyncio.wait_for(
                _attempt(
                    magic_url, username.strip().lstrip("@").lower(), proxy_cfg,
                    session_settings, storage_state, fingerprint, device_seed,
                    default_headless() if headless is None else headless,
                    capture_screenshot, t0, steps,
                ),
                timeout=HARD_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            _log(steps, "hard_timeout", t0)
            return MagicLinkOutcome(
                STATUS_UNKNOWN,
                f"[{BUILD}] Tentativa excedeu {HARD_TIMEOUT_S}s e foi abortada.",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                log=steps,
            )


async def _attempt(
    magic_url: str,
    username: str,
    proxy,
    session_settings: dict | None,
    storage_state: dict | None,
    fingerprint: dict | None,
    device_seed: str | None,
    headless: bool,
    capture_screenshot: bool,
    t0: float,
    steps: list[dict],
) -> MagicLinkOutcome:
    from playwright.async_api import Error as PlaywrightError
    from playwright.async_api import async_playwright

    deadline = t0 + SOFT_BUDGET_S

    def finish(outcome: MagicLinkOutcome) -> MagicLinkOutcome:
        outcome.elapsed_ms = int((time.monotonic() - t0) * 1000)
        outcome.log = steps
        return outcome

    # Sessao: a do navegador (salva por um login via browser_engine) tem
    # prioridade; senao converte a da instagrapi, que o onboarding ja gravou.
    state = storage_state
    session_origin = "browser"
    if not state:
        state = storage_state_from_instagrapi(session_settings)
        session_origin = "instagrapi"
    if not state:
        return finish(MagicLinkOutcome(
            STATUS_NEEDS_MANUAL,
            f"[{BUILD}] Nenhuma sessao do Instagram disponivel para abrir o link "
            f"(a etapa de login nao deixou sessionid). Autorize o link manualmente.",
        ))
    _log(steps, "session_source", t0, origin=session_origin)

    try:
        geo = await lookup_proxy_geo(proxy)
    except ProxyUnreachable as exc:
        _log(steps, "proxy_unreachable", t0)
        return finish(MagicLinkOutcome(STATUS_IP_ERROR, f"[{BUILD}] Proxy nao respondeu: {exc}"))
    _log(steps, "proxy_geo", t0, exit_ip=geo.ip, country=geo.country)

    if not headless:
        _ensure_display()

    async with async_playwright() as pw:
        try:
            browser = await pw.chromium.launch(
                channel="chromium",
                headless=headless,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
                ignore_default_args=["--enable-automation"],
            )
        except PlaywrightError as exc:
            _log(steps, "launch_failed", t0)
            return finish(MagicLinkOutcome(
                STATUS_UNKNOWN, f"[{BUILD}] Falha ao abrir o Chromium: {str(exc)[:300]}"
            ))

        try:
            fp = fingerprint if (fingerprint and fingerprint.get("user_agent")) else build_fingerprint(
                device_seed or username, browser.version, geo
            )
            fp = {**fp, "timezone_id": geo.timezone,
                  "locale": _COUNTRY_LOCALE.get(geo.country, fp.get("locale", "pt-BR"))}

            context = await browser.new_context(
                proxy=proxy.playwright(),
                user_agent=fp["user_agent"],
                viewport=fp["viewport"],
                locale=fp["locale"],
                timezone_id=fp["timezone_id"],
                storage_state=state,
                extra_http_headers={"Accept-Language": f"{fp['locale']},pt;q=0.9,en-US;q=0.8,en;q=0.7"},
                color_scheme="light",
            )
            context.set_default_timeout(20_000)
            page = await context.new_page()

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

            async def out(status: str, message: str, *, checkpoint=None, clicked=False) -> MagicLinkOutcome:
                text = _clean_text(await page_text())
                full = f"[{BUILD}][exit_ip={geo.ip}][geo={geo.country}] {message}"
                if text:
                    full += f" | tela: {text}"
                _log(steps, "finish", t0, status=status, url=_safe_url(page.url))
                return finish(MagicLinkOutcome(
                    status, full[:3000],
                    storage_state=(await context.storage_state()) if status == STATUS_SUCCESS else None,
                    fingerprint=fp,
                    screenshot_b64=(await screenshot()) if status != STATUS_SUCCESS else None,
                    checkpoint=checkpoint,
                    final_url=_safe_url(page.url),
                    authorized_click=clicked,
                    proxy_ip=geo.ip,
                    proxy_country=geo.country,
                ))

            async def goto(url: str) -> MagicLinkOutcome | None:
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                    return None
                except Exception as exc:  # noqa: BLE001
                    detail = str(exc)
                    if any(m in detail for m in _NET_ERROR_MARKERS):
                        return finish(MagicLinkOutcome(
                            STATUS_IP_ERROR,
                            f"[{BUILD}] Navegacao falhou pela proxy: {detail[:200]}",
                            proxy_ip=geo.ip, proxy_country=geo.country,
                        ))
                    return finish(MagicLinkOutcome(
                        STATUS_UNKNOWN, f"[{BUILD}] Navegacao falhou: {detail[:200]}",
                        proxy_ip=geo.ip, proxy_country=geo.country,
                    ))

            # 1) A sessao esta viva e e da conta CERTA?
            err = await goto("https://www.instagram.com/")
            if err:
                return err
            await _dismiss_cookie_banner(page)
            _log(steps, "instagram_opened", t0, url=_safe_url(page.url))

            cookies = await context.cookies("https://www.instagram.com")
            by_name = {c["name"]: c.get("value") or "" for c in cookies}

            if not by_name.get("sessionid"):
                return await out(
                    STATUS_NEEDS_MANUAL,
                    "A sessao do Instagram nao foi aceita pelo navegador (sem sessionid). "
                    "Refaca o login da conta ou autorize o link manualmente.",
                )

            expected = _expected_ds_user_id(session_settings)
            actual = by_name.get("ds_user_id")
            if expected and actual and str(expected) != str(actual):
                # Vincular a conta errada ao usuario e pior do que nao vincular.
                return await out(
                    STATUS_NEEDS_MANUAL,
                    f"O navegador esta logado em OUTRA conta (ds_user_id {actual}, "
                    f"esperado {expected}). Nada foi autorizado.",
                )

            if any(m in page.url for m in _LOGIN_URL_MARKERS):
                return await out(
                    STATUS_NEEDS_MANUAL,
                    "O Instagram redirecionou para a tela de login - a sessao expirou.",
                )

            checkpoint = _checkpoint_from_url(page.url)
            if checkpoint:
                return await out(
                    STATUS_NEEDS_MANUAL,
                    f"A conta caiu em {checkpoint['type']} ao abrir o Instagram.",
                    checkpoint=checkpoint,
                )

            await _human_pause(1.0, 2.5)

            # 2) Link magico: grava os cookies OAuth e leva ao authorize.
            err = await goto(magic_url)
            if err:
                return err
            _log(steps, "magic_opened", t0, url=_safe_url(page.url))

            clicked = False

            # 3) Percorre a cadeia de redirects ate o desfecho.
            while True:
                if time.monotonic() > deadline:
                    return await out(
                        STATUS_UNKNOWN,
                        "Tempo esgotado antes de concluir a autorizacao.",
                        clicked=clicked,
                    )

                url = page.url
                path = urlparse(url).path

                if "/add/success" in path:
                    _log(steps, "success", t0)
                    return await out(STATUS_SUCCESS, "Conta autorizada e vinculada.", clicked=clicked)

                if "/add/error" in path:
                    reason = (urlparse(url).query or "").replace("reason=", "") or "desconhecido"
                    return await out(
                        STATUS_NEEDS_MANUAL,
                        f"O callback recusou a autorizacao (motivo: {reason}).",
                        clicked=clicked,
                    )

                # O callback do dashboard so aparece quando o cookie de magic
                # link nao chegou - sintoma de link/cookie invalido.
                if "/dashboard/accounts" in path:
                    return await out(
                        STATUS_NEEDS_MANUAL,
                        "O fluxo terminou no dashboard em vez de /add/success - "
                        "o cookie do link magico nao acompanhou a navegacao.",
                        clicked=clicked,
                    )

                checkpoint = _checkpoint_from_url(url)
                if checkpoint:
                    return await out(
                        STATUS_NEEDS_MANUAL,
                        f"O Instagram exigiu {checkpoint['type']} durante a autorizacao.",
                        checkpoint=checkpoint, clicked=clicked,
                    )

                text = await page_text()
                lowered = text.lower()
                if any(p in lowered for p in _CHECKPOINT_TEXT_PATTERNS):
                    return await out(
                        STATUS_NEEDS_MANUAL,
                        "O Instagram pediu verificacao durante a autorizacao.",
                        clicked=clicked,
                    )

                if any(m in path for m in _LOGIN_URL_MARKERS):
                    return await out(
                        STATUS_NEEDS_MANUAL,
                        "O Instagram pediu login na tela de autorizacao.",
                        clicked=clicked,
                    )

                # Tela de autorizacao: procura o botao de permitir.
                if not clicked:
                    button = await _find_allow_button(page)
                    if button is not None:
                        await _human_pause(1.0, 2.5)
                        try:
                            await button.click(timeout=8_000)
                        except Exception as exc:  # noqa: BLE001
                            return await out(
                                STATUS_UNKNOWN,
                                f"Falha ao clicar no botao de autorizacao: {str(exc)[:160]}",
                            )
                        clicked = True
                        _log(steps, "allow_clicked", t0)
                        try:
                            await page.wait_for_url(
                                lambda u: "/add/" in u or "/dashboard/accounts" in u,
                                timeout=30_000,
                            )
                        except Exception:  # noqa: BLE001
                            pass
                        continue

                    # Sem botao conhecido E fora do authorize: ainda navegando.
                    if "/oauth/authorize" in path or "/oauth/" in path:
                        await asyncio.sleep(1.5)
                        # Uma volta so: se continuar na tela sem botao, desiste
                        # com o texto na mensagem em vez de chutar clique.
                        if await _find_allow_button(page) is None and time.monotonic() > deadline - 20:
                            return await out(
                                STATUS_NEEDS_MANUAL,
                                "Tela de autorizacao aberta, mas nenhum botao conhecido "
                                "de permitir foi encontrado (o layout da Meta mudou). "
                                "Autorize o link manualmente.",
                            )
                        continue

                await asyncio.sleep(1.5)

        finally:
            try:
                await browser.close()
            except Exception:  # noqa: BLE001
                pass


async def _find_allow_button(page):
    """
    Primeiro botao/link visivel cujo rotulo casa com permitir/autorizar e NAO
    casa com cancelar/negar. None quando nada bate - o chamador trata.
    """
    for getter in (
        lambda: page.get_by_role("button", name=_ALLOW_LABELS),
        lambda: page.get_by_role("link", name=_ALLOW_LABELS),
        lambda: page.locator("div[role='button']").filter(has_text=_ALLOW_LABELS),
    ):
        try:
            candidates = getter()
            count = min(await candidates.count(), 6)
        except Exception:  # noqa: BLE001
            continue
        for i in range(count):
            item = candidates.nth(i)
            if not await _visible(item):
                continue
            try:
                label = (await item.inner_text(timeout=1_500)).strip()
            except Exception:  # noqa: BLE001
                continue
            if label and not _DENY_LABELS.search(label):
                return item
    return None
