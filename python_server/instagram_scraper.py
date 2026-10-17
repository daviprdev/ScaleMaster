"""
ScaleMaster — Raspagem de reels de um perfil via conta leitora dedicada
(instagrapi, API privada do app mobile).

Complementa a Apify na aba Inspirações: a Apify nunca traz a lista completa de
reels de um perfil e não enxerga conteúdo privado. Aqui, uma conta leitora já
logada consulta os reels de um perfil-alvo direto pela API privada, com
paginação real (não só a primeira página).

REUSA A SESSÃO já estabelecida (existing_settings): só faz login completo
quando não há sessão salva OU quando a sessão salva expirou. Mesmo isolamento
por conta do login: device fingerprint determinístico + proxy dedicado. A
identidade de device NUNCA é regerada numa sessão já estabelecida (orientação
da doc do instagrapi).

LIMITE DE ITENS: `limit <= 0` significa TODOS os reels do perfil — a paginação
segue enquanto o Instagram devolver cursor. `time_budget_seconds` é o freio
real: ao estourá-lo a busca para e devolve o que já coletou (`truncated=True`),
em vez de morrer no timeout HTTP e perder tudo.

LIMITE DE PRIVACIDADE (honesto, não contornável): um perfil privado só é
raspável se a conta leitora JÁ o seguir de verdade. Não seguimos ninguém
automaticamente nem simulamos acesso — perfil privado sem follow retorna erro
`target_private`.
"""

import time

from instagrapi import Client

from instagram_login import (
    authenticate_client,
    _classify_error,
    _lookup_proxy_geo,
    build_deterministic_settings,
    refresh_app_version,
)

BUILD = "scrapev2"

# Tamanho de página do endpoint privado clips/user/ (o mesmo default do
# instagrapi). Paginamos nós mesmos para poder respeitar um orçamento de tempo
# e devolver o que já foi coletado — user_clips(amount=0) percorreria o perfil
# inteiro sem noção do timeout HTTP, e um estouro perderia TODOS os reels.
PAGE_SIZE = 50
# Teto de segurança contra cursor que nunca termina (PAGE_SIZE * 400 = 20k).
MAX_PAGES = 400


class ScrapeResult:
    def __init__(self, success: bool, **kwargs):
        self.success = success
        self.data = kwargs


def _media_to_reel(m) -> dict:
    """
    Converte um objeto Media do instagrapi no formato cru que o lado Next.js
    interpreta em lib/instagrapi-reel.ts (um único lugar normaliza o payload,
    espelhando a filosofia de lib/scraped-reel.ts para a Apify).

    Preserva a distinção de três estados da legenda: None = não capturada;
    "" = reel sem legenda; texto = legenda. Nunca trunca (ingestão sem
    alteração — regra do projeto).
    """
    code = str(getattr(m, "code", "") or "")

    # play_count é o nº de reproduções do reel; em alguns retornos vem None e
    # o view_count faz o papel. Nenhum dos dois presente → 0.
    views = getattr(m, "play_count", None)
    if views is None:
        views = getattr(m, "view_count", None)

    caption = getattr(m, "caption_text", None)
    user = getattr(m, "user", None)
    owner = getattr(user, "username", None) if user is not None else None

    return {
        "pk": str(getattr(m, "pk", "") or ""),
        "code": code,
        "video_url": str(getattr(m, "video_url", "") or ""),
        "thumbnail_url": (str(getattr(m, "thumbnail_url", "") or "") or None),
        "caption": caption if isinstance(caption, str) else None,
        "views": int(views) if isinstance(views, (int, float)) else 0,
        "likes": int(getattr(m, "like_count", 0) or 0),
        "comments": int(getattr(m, "comment_count", 0) or 0),
        "duration": float(getattr(m, "video_duration", 0) or 0),
        "owner": owner,
        "source_url": f"https://www.instagram.com/reel/{code}/" if code else None,
    }


def _classify_scrape_error(exc: Exception) -> tuple[str, str]:
    """
    Erros específicos da BUSCA (resolução do alvo / listagem de reels),
    classificados por nome de classe + texto (a tipagem do instagrapi varia
    entre versões — mesma abordagem de _classify_error). Cai no classificador
    de login para os transitórios genéricos (rate limit, network, etc.).
    """
    name = type(exc).__name__
    lower = str(exc).lower()

    if name == "UserNotFound" or "not found" in lower or "user not found" in lower:
        return "target_not_found", str(exc)
    if name in ("PrivateError", "PrivateAccount") or "private" in lower or "not authorized to view" in lower:
        return "target_private", str(exc)
    if (
        name in ("LoginRequired", "ClientForbidden")
        or "login_required" in lower
        or "challenge_required" in lower
        or "checkpoint_required" in lower
    ):
        return "session_expired", str(exc)
    return _classify_error(exc)


def fetch_user_reels(
    username: str,
    password: str,
    proxy_url: str,
    device_seed: str,
    target_username: str,
    limit: int,
    totp_secret: str | None = None,
    existing_settings: dict | None = None,
    time_budget_seconds: int = 100,
) -> ScrapeResult:
    # O orçamento de tempo vale para a chamada INTEIRA (geo do proxy, ping da
    # sessão e login inclusos). Antes contava só a partir da paginação: um
    # proxy lento ou login com challenge estourava o timeout HTTP do Next, que
    # abortava e jogava fora os reels E a sessão renovada.
    start = time.monotonic()
    cl = Client()
    cl.delay_range = [1, 3]
    cl.set_proxy(proxy_url)

    proxy_ip, proxy_country = _lookup_proxy_geo(cl)

    settings = (
        refresh_app_version(existing_settings)
        if existing_settings
        else build_deterministic_settings(device_seed, proxy_country)
    )
    cl.set_settings(settings)

    # ── 1. Garante sessão válida ────────────────────────────────────────────
    # Com sessão salva, valida com um ping barato (timeline feed) e só faz
    # login completo se a sessão morreu. Sem sessão salva, login direto.
    # Só sessão realmente expirada (LoginRequired/ClientForbidden) leva a login
    # com senha: timeout de proxy ou rate limit no ping viravam login completo
    # à toa — mais checkpoint, sem resolver nada.
    need_login = existing_settings is None
    if existing_settings is not None:
        try:
            cl.get_timeline_feed()
        except Exception as exc:
            name = type(exc).__name__
            if name in ("LoginRequired", "ClientForbidden") or "login_required" in str(exc).lower():
                need_login = True
            else:
                error_code, error_message = _classify_error(exc)
                return ScrapeResult(
                    False,
                    error_code=error_code,
                    error_message=f"[{BUILD}][proxy_ip={proxy_ip}][ping da sessão] {error_message}"[:500],
                )

    if need_login:
        err = authenticate_client(
            cl, username, password, totp_secret, proxy_ip, proxy_country, settings, BUILD
        )
        if err is not None:
            error_code, error_message = err
            return ScrapeResult(False, error_code=error_code, error_message=error_message)

    # ── 2. Resolve o alvo e busca os reels (paginação real) ─────────────────
    # limit <= 0 → todos os reels do perfil. A paginação é nossa (não
    # user_clips(amount=...)) para respeitar o orçamento de tempo: estourado o
    # prazo, devolvemos o que já veio em vez de perder a busca inteira no
    # timeout HTTP. O instagrapi já dorme delay_range [1,3] a cada requisição
    # privada — nenhum sleep extra é necessário entre as páginas.
    wanted = max(0, int(limit))
    deadline = start + max(20, int(time_budget_seconds))
    truncated = False
    pages = 0
    seen_pks: set[str] = set()
    medias = []

    try:
        target_id = cl.user_id_from_username(target_username)

        next_cursor = ""
        while True:
            page, next_cursor = cl.user_clips_paginated_v1(
                target_id, amount=PAGE_SIZE, end_cursor=next_cursor
            )
            pages += 1

            for m in page:
                pk = str(getattr(m, "pk", "") or "")
                # Dedup por pk: cursor repetido não infla o resultado.
                if pk and pk in seen_pks:
                    continue
                if pk:
                    seen_pks.add(pk)
                medias.append(m)

            # Sem cursor = fim do perfil (a lista está completa).
            if not next_cursor:
                break
            # Página vazia com cursor: o Instagram não tem mais o que devolver.
            if not page:
                break
            if wanted and len(medias) >= wanted:
                break
            if pages >= MAX_PAGES:
                truncated = True
                break
            if time.monotonic() >= deadline:
                truncated = True
                break

        if wanted:
            medias = medias[:wanted]
    except Exception as exc:
        error_code, error_message = _classify_scrape_error(exc)
        return ScrapeResult(
            False,
            error_code=error_code,
            error_message=f"[{BUILD}][proxy_ip={proxy_ip}][geo={proxy_country or settings.get('country')}] {error_message}"[:500],
            # Devolve a sessão mesmo em falha de busca — se um relogin aconteceu
            # acima, o chamador persiste a sessão renovada e não repete o login.
            settings=cl.get_settings(),
        )

    reels = [_media_to_reel(m) for m in medias]
    reels = [r for r in reels if r["video_url"]]

    print(
        f"[{BUILD}] @{target_username}: {len(reels)} reels em {pages} página(s)"
        f" (limite={wanted or 'todos'}, truncado={truncated})",
        flush=True,
    )

    return ScrapeResult(
        True,
        settings=cl.get_settings(),
        ig_user_id=(str(cl.user_id) if cl.user_id else None),
        reels=reels,
        result_count=len(reels),
        truncated=truncated,
    )
