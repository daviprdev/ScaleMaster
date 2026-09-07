-- ─────────────────────────────────────────────────────────────────────────────
-- Links Gerenciáveis (2026-09-07)
--
-- Encurtador próprio do AutoScale. O link público (`/r/{slug}`) nunca muda; o
-- destino (`destination_url`) pode ser trocado a qualquer momento.
--
-- REGRA PERMANENTE: o redirecionador NÃO faz cloaking. Todo visitante do mesmo
-- slug vai para o MESMO `destination_url` ativo. Não existe destino por
-- User-Agent, por referrer, por país ou por "é crawler". Nenhuma coluna desta
-- migration permite armazenar um segundo destino.
--
-- Três tabelas:
--   managed_links          → o link em si (slug, destino, status, vínculos)
--   managed_link_history   → auditoria de troca de destino / status
--   managed_link_clicks    → analytics agregável, sem dado pessoal
--
-- PRIVACIDADE: nenhum IP (bruto ou hasheado) e nenhum User-Agent completo são
-- gravados. Do User-Agent sobra apenas uma categoria (`desktop|mobile|tablet|
-- other`) e a família do navegador. Do Referer sobra apenas o hostname — a URL
-- completa pode carregar parâmetros sensíveis da página de origem.
-- MVP sem "cliques únicos": exigiria derivar identidade do visitante, e a
-- decisão foi não fazer isso.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Links ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.managed_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Slug case-SENSITIVE: slugs automáticos são base62 (A-Za-z0-9) e forçar
  -- lowercase queimaria metade da entropia. Slug customizado é normalizado
  -- para minúsculas na API — o que está gravado é exatamente o que casa.
  slug text NOT NULL,
  name text,

  destination_url text NOT NULL,

  -- Substitui o `is_active boolean` sugerido: 'archived' preserva histórico e
  -- analytics sem manter o link redirecionando (soft delete).
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),

  -- Repassa a query string pública para o destino (merge via URLSearchParams).
  forward_query_params boolean NOT NULL DEFAULT false,

  -- Vínculos são só organização/analytics: não conferem posse do link nem
  -- alteram o redirect.
  instagram_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,

  -- SEM FK de propósito: não existe tabela canônica de campanhas neste schema.
  -- `campaign_id` é um agrupamento virtual de `scheduled_posts` (Postar, Clone,
  -- Loop); só campanhas do Postar têm linha em `distribute_campaigns`. Um FK
  -- para lá impediria vincular campanha de Clone. A API valida server-side que
  -- o campaign_id pertence ao usuário; se a campanha sumir, o link continua
  -- funcionando com um vínculo que a UI mostra como "campanha removida".
  campaign_id uuid,

  click_count bigint NOT NULL DEFAULT 0,
  last_clicked_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT managed_links_slug_key UNIQUE (slug),
  CONSTRAINT managed_links_slug_format CHECK (slug ~ '^[A-Za-z0-9_-]{3,50}$'),
  CONSTRAINT managed_links_destination_len
    CHECK (char_length(destination_url) BETWEEN 8 AND 2048),
  -- Última linha de defesa contra javascript:/data:/file:/ftp: caso alguma
  -- rota futura escreva direto na tabela sem passar por lib/managed-links.ts.
  CONSTRAINT managed_links_destination_scheme
    CHECK (destination_url ~* '^https?://'),
  CONSTRAINT managed_links_name_len CHECK (name IS NULL OR char_length(name) <= 120)
);

-- Lookup do redirect (caminho crítico) — o UNIQUE acima já cria o índice de
-- slug; nenhum índice extra é necessário para a rota pública.
CREATE INDEX IF NOT EXISTS managed_links_user_created_idx
  ON public.managed_links(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS managed_links_user_status_idx
  ON public.managed_links(user_id, status);
CREATE INDEX IF NOT EXISTS managed_links_account_idx
  ON public.managed_links(instagram_account_id)
  WHERE instagram_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS managed_links_campaign_idx
  ON public.managed_links(campaign_id)
  WHERE campaign_id IS NOT NULL;

-- ── 2. Histórico de alterações ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.managed_link_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.managed_links(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_type text NOT NULL CHECK (change_type IN (
    'created', 'destination_changed', 'activated', 'deactivated',
    'archived', 'renamed', 'settings_changed'
  )),
  old_destination_url text,
  new_destination_url text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS managed_link_history_link_idx
  ON public.managed_link_history(link_id, changed_at DESC);

-- ── 3. Cliques (analytics) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.managed_link_clicks (
  id bigserial PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES public.managed_links(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now(),

  referrer_host text,                    -- só o hostname, nunca a URL inteira
  device_type text CHECK (device_type IS NULL OR device_type IN
    ('desktop', 'mobile', 'tablet', 'other')),
  browser_family text CHECK (browser_family IS NULL OR browser_family IN
    ('Chrome', 'Safari', 'Firefox', 'Edge', 'Opera', 'Other')),
  country text CHECK (country IS NULL OR char_length(country) <= 2),

  utm_source text,
  utm_medium text,
  utm_campaign text
);

-- Índice do detalhe por link e da agregação por período.
CREATE INDEX IF NOT EXISTS managed_link_clicks_link_time_idx
  ON public.managed_link_clicks(link_id, clicked_at DESC);
-- Prepara uma futura política de retenção (ex.: apagar > 12 meses) sem
-- varredura completa. NENHUM cleanup automático é criado agora — a decisão
-- de descartar analytics é do dono, não do sistema.
CREATE INDEX IF NOT EXISTS managed_link_clicks_time_idx
  ON public.managed_link_clicks(clicked_at);

-- ── 4. updated_at ───────────────────────────────────────────────────────────

-- Já existia (supabase/loops.sql). Recriada aqui só para acrescentar o
-- search_path fixo, que o linter do Supabase apontava como mutável.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS managed_links_updated_at ON public.managed_links;
CREATE TRIGGER managed_links_updated_at
  BEFORE UPDATE ON public.managed_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- As rotas privadas já filtram por user_id derivado da sessão; a RLS é a
-- segunda camada (um bug de filtro não vira vazamento entre contas).
-- A rota pública /r/[slug] NÃO usa sessão do visitante: ela chama a RPC
-- `resolve_managed_link` com service_role, que é SECURITY DEFINER e só devolve
-- o destino — nunca o user_id nem qualquer outro campo do dono.

ALTER TABLE public.managed_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.managed_link_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.managed_link_clicks  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_links" ON public.managed_links;
CREATE POLICY "users_manage_own_links" ON public.managed_links
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_read_own_link_history" ON public.managed_link_history;
CREATE POLICY "users_read_own_link_history" ON public.managed_link_history
  FOR SELECT USING (auth.uid() = user_id);

-- Cliques são gravados só pela RPC (service_role / SECURITY DEFINER). Usuário
-- tem leitura dos cliques dos PRÓPRIOS links, e nada além disso — sem policy
-- de INSERT ninguém consegue inflar analytics pela API pública do PostgREST.
DROP POLICY IF EXISTS "users_read_own_link_clicks" ON public.managed_link_clicks;
CREATE POLICY "users_read_own_link_clicks" ON public.managed_link_clicks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.managed_links l
       WHERE l.id = managed_link_clicks.link_id
         AND l.user_id = auth.uid()
    )
  );

-- ── 6. Validade do destino, no banco ────────────────────────────────────────
-- Espelha lib/managed-links.ts → validateDestinationUrl(). Existe porque o
-- clique só pode ser contado DEPOIS de saber que o visitante vai mesmo ser
-- redirecionado — e essa decisão precisa acontecer dentro da mesma transação
-- que incrementa o contador, senão sobra a janela em que um destino inválido
-- soma +1 e devolve 410.
--
-- As duas implementações têm de concordar sempre; `scripts/test-managed-links.mjs`
-- roda as duas sobre o mesmo corpus e falha se divergirem em qualquer URL.

CREATE OR REPLACE FUNCTION public.is_valid_link_destination(p_url text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_rest      text;
  v_authority text;
  v_host      text;
  v_octets    text[];
  a int; b int;
BEGIN
  IF p_url IS NULL THEN RETURN false; END IF;
  IF char_length(p_url) < 8 OR char_length(p_url) > 2048 THEN RETURN false; END IF;

  -- Caracteres de controle (CR/LF = header splitting).
  IF p_url ~ '[\x00-\x1F\x7F]' THEN RETURN false; END IF;

  -- Só http/https: barra javascript:, data:, file:, ftp:, chrome:, about:…
  IF p_url !~* '^https?://' THEN RETURN false; END IF;

  v_rest := regexp_replace(p_url, '^https?://', '', 'i');
  v_authority := (regexp_match(v_rest, '^([^/?#]*)'))[1];

  IF v_authority IS NULL OR v_authority = '' THEN RETURN false; END IF;

  -- Credencial embutida (user:senha@host). Nenhum host legítimo tem '@'.
  IF position('@' in v_authority) > 0 THEN RETURN false; END IF;

  -- Host sem a porta. Literal IPv6 vem entre colchetes.
  IF left(v_authority, 1) = '[' THEN
    v_host := lower((regexp_match(v_authority, '^\[([^\]]*)\]'))[1]);
  ELSE
    v_host := lower(split_part(v_authority, ':', 1));
  END IF;

  IF v_host IS NULL OR v_host = '' THEN RETURN false; END IF;

  -- Loopback e nomes de rede interna.
  IF v_host = 'localhost'
     OR v_host LIKE '%.localhost'
     OR v_host LIKE '%.internal'
     OR v_host LIKE '%.local'
     OR v_host = '0.0.0.0'
     OR v_host = '::1'
  THEN RETURN false; END IF;

  -- ULA IPv6 (fc00::/7). O ':' é obrigatório: sem ele, fcbarcelona.com e
  -- fdny.org cairiam aqui como se fossem rede interna.
  IF position(':' in v_host) > 0 AND v_host ~ '^f[cd][0-9a-f:]*$' THEN
    RETURN false;
  END IF;

  -- Faixas IPv4 privadas / link-local / metadata de nuvem / CGNAT.
  v_octets := regexp_match(v_host, '^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$');
  IF v_octets IS NOT NULL THEN
    a := v_octets[1]::int;
    b := v_octets[2]::int;
    IF a = 0 OR a = 10 OR a = 127
       OR (a = 169 AND b = 254)
       OR (a = 172 AND b BETWEEN 16 AND 31)
       OR (a = 192 AND b = 168)
       OR (a = 100 AND b BETWEEN 64 AND 127)
    THEN RETURN false; END IF;
  END IF;

  RETURN true;
END;
$$;

-- ── 7. RPC do redirect ──────────────────────────────────────────────────────
-- UMA ida ao banco resolve o destino E registra o clique.
--
-- ORDEM (nesta sequência, sempre):
--   1. busca o link pelo slug
--   2. valida status = 'active'
--   3. valida o destino
--   4. só então conta o clique
--   5. devolve o destino para a rota emitir o 302
--
-- `click_count` é o contador de REDIRECTS BEM-SUCEDIDOS. Visita a link pausado,
-- arquivado, inexistente ou com destino inválido não entra nele e não vira
-- linha em managed_link_clicks — não existe métrica de "visita rejeitada", e
-- se um dia existir tem de ser coluna/tabela própria, nunca misturada aqui.
--
-- Por que RPC e não duas queries do lado do Node:
--   a) `click_count = click_count + 1` dentro de um único UPDATE é atômico
--      (lock de linha). Ler-somar-gravar no app perderia cliques concorrentes.
--   b) Serverless mata promise solta depois da resposta — `void insert(...)`
--      perderia cliques. Aqui tudo acontece antes do redirect, num round-trip.
--   c) Os dois blocos EXCEPTION isolam a falha de analytics: o redirect nunca
--      depende dela.
--
-- Os savepoints são SEPARADOS de propósito. O contador de redirects e a linha
-- de detalhe são coisas diferentes: se o INSERT de detalhe falhar (tabela
-- cheia, constraint, lock), o redirect aconteceu e portanto o contador
-- continua valendo. Consequência aceita e documentada: em falha do detalhe,
-- `click_count` pode ficar maior que `count(*)` em managed_link_clicks.
--
-- Não recebe nem grava IP, User-Agent bruto ou URL de referer completa: quem
-- reduz esses dados a categorias é a rota, antes de chamar aqui.

DROP FUNCTION IF EXISTS public.resolve_managed_link(
  text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.resolve_managed_link(
  p_slug            text,
  p_referrer_host   text DEFAULT NULL,
  p_device_type     text DEFAULT NULL,
  p_browser_family  text DEFAULT NULL,
  p_country         text DEFAULT NULL,
  p_utm_source      text DEFAULT NULL,
  p_utm_medium      text DEFAULT NULL,
  p_utm_campaign    text DEFAULT NULL
)
RETURNS TABLE (
  out_link_id            uuid,
  out_destination        text,
  out_status             text,
  out_forward            boolean,
  out_destination_valid  boolean,
  out_click_counted      boolean,
  out_click_logged       boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_dest    text;
  v_status  text;
  v_forward boolean;
  v_valid   boolean := false;
  v_counted boolean := false;
  v_logged  boolean := false;
BEGIN
  -- 1. Busca
  SELECT l.id, l.destination_url, l.status, l.forward_query_params
    INTO v_id, v_dest, v_status, v_forward
    FROM public.managed_links l
   WHERE l.slug = p_slug
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;                       -- zero linhas → a rota devolve 404
  END IF;

  -- 2 e 3. Status e destino, ANTES de qualquer escrita.
  v_valid := public.is_valid_link_destination(v_dest);

  -- 4. Só clique que de fato redireciona entra na contagem.
  IF v_status = 'active' AND v_valid THEN
    BEGIN
      UPDATE public.managed_links AS ml
         SET click_count = ml.click_count + 1,
             last_clicked_at = now()
       WHERE ml.id = v_id;
      v_counted := true;
    EXCEPTION WHEN OTHERS THEN
      v_counted := false;         -- nunca bloqueia o redirect
    END;

    BEGIN
      INSERT INTO public.managed_link_clicks (
        link_id, referrer_host, device_type, browser_family, country,
        utm_source, utm_medium, utm_campaign
      ) VALUES (
        v_id,
        left(p_referrer_host, 253),
        p_device_type,
        p_browser_family,
        upper(left(p_country, 2)),
        left(p_utm_source, 200),
        left(p_utm_medium, 200),
        left(p_utm_campaign, 200)
      );
      v_logged := true;
    EXCEPTION WHEN OTHERS THEN
      v_logged := false;          -- idem: detalhe é best-effort
    END;
  END IF;

  -- 5. Devolve o destino.
  out_link_id           := v_id;
  out_destination       := v_dest;
  out_status            := v_status;
  out_forward           := v_forward;
  out_destination_valid := v_valid;
  out_click_counted     := v_counted;
  out_click_logged      := v_logged;
  RETURN NEXT;
END;
$$;

-- SECURITY DEFINER + acesso só do service_role: um visitante anônimo (chave
-- anon) não consegue chamar isso via PostgREST para inflar contadores.
REVOKE ALL ON FUNCTION public.resolve_managed_link(
  text, text, text, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_managed_link(
  text, text, text, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.is_valid_link_destination(text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_link_destination(text) TO service_role;

-- ── 8. RPCs de agregação ────────────────────────────────────────────────────
-- managed_link_clicks cresce sem teto. Nada de trazer linha de clique para o
-- browser: o PostgREST corta em 1000 silenciosamente (lição já registrada em
-- 2026-08-29) e o front não deve somar milhões de linhas. Toda contagem é
-- feita aqui.
--
-- "Hoje" e a série diária usam America/Sao_Paulo — mesma convenção do resto do
-- painel (lib/brt-time.ts).

CREATE OR REPLACE FUNCTION public.get_managed_link_overview(
  p_user_id uuid,
  p_days    int DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH links AS (
    SELECT * FROM public.managed_links WHERE user_id = p_user_id
  ),
  win AS (
    SELECT c.clicked_at
      FROM public.managed_link_clicks c
      JOIN links l ON l.id = c.link_id
     WHERE c.clicked_at >= now() - make_interval(days => GREATEST(COALESCE(p_days, 30), 1))
  )
  SELECT jsonb_build_object(
    'window_days',    GREATEST(COALESCE(p_days, 30), 1),
    'total_links',    (SELECT count(*) FROM links),
    'active_links',   (SELECT count(*) FROM links WHERE status = 'active'),
    'paused_links',   (SELECT count(*) FROM links WHERE status = 'paused'),
    'archived_links', (SELECT count(*) FROM links WHERE status = 'archived'),
    'total_clicks',   (SELECT COALESCE(sum(click_count), 0) FROM links),
    'clicks_today',   (SELECT count(*) FROM win
                        WHERE (clicked_at AT TIME ZONE 'America/Sao_Paulo')
                              >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')),
    'clicks_window',  (SELECT count(*) FROM win),
    'top_link',       (SELECT jsonb_build_object(
                                'id', l.id, 'slug', l.slug, 'name', l.name,
                                'click_count', l.click_count)
                         FROM links l
                        WHERE l.click_count > 0
                        ORDER BY l.click_count DESC, l.created_at DESC
                        LIMIT 1),
    'daily',          (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d.day, 'clicks', d.n)
                                       ORDER BY d.day), '[]'::jsonb)
                         FROM (SELECT date_trunc('day', clicked_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                                      count(*) AS n
                                 FROM win GROUP BY 1) d)
  );
$$;

REVOKE ALL ON FUNCTION public.get_managed_link_overview(uuid, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_managed_link_overview(uuid, int) TO service_role;

CREATE OR REPLACE FUNCTION public.get_managed_link_analytics(
  p_link_id uuid,
  p_user_id uuid,
  p_days    int DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lnk AS (
    -- Ownership dentro da própria query: link de outro usuário devolve NULL,
    -- não os dados dele.
    SELECT * FROM public.managed_links
     WHERE id = p_link_id AND user_id = p_user_id
  ),
  win AS (
    SELECT c.*
      FROM public.managed_link_clicks c
      JOIN lnk ON lnk.id = c.link_id
     WHERE c.clicked_at >= now() - make_interval(days => GREATEST(COALESCE(p_days, 30), 1))
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM lnk) THEN NULL ELSE jsonb_build_object(
    'window_days',   GREATEST(COALESCE(p_days, 30), 1),
    'total_clicks',  (SELECT click_count FROM lnk),
    'clicks_today',  (SELECT count(*) FROM win
                       WHERE (clicked_at AT TIME ZONE 'America/Sao_Paulo')
                             >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')),
    'clicks_7d',     (SELECT count(*) FROM win WHERE clicked_at >= now() - interval '7 days'),
    'clicks_30d',    (SELECT count(*) FROM win WHERE clicked_at >= now() - interval '30 days'),
    'daily',         (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d.day, 'clicks', d.n)
                                      ORDER BY d.day), '[]'::jsonb)
                        FROM (SELECT date_trunc('day', clicked_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                                     count(*) AS n
                                FROM win GROUP BY 1) d),
    'referrers',     (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', t.k, 'clicks', t.n)
                                      ORDER BY t.n DESC), '[]'::jsonb)
                        FROM (SELECT COALESCE(referrer_host, 'direto') AS k, count(*) AS n
                                FROM win GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t),
    'devices',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', t.k, 'clicks', t.n)
                                      ORDER BY t.n DESC), '[]'::jsonb)
                        FROM (SELECT COALESCE(device_type, 'other') AS k, count(*) AS n
                                FROM win GROUP BY 1) t),
    'browsers',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', t.k, 'clicks', t.n)
                                      ORDER BY t.n DESC), '[]'::jsonb)
                        FROM (SELECT COALESCE(browser_family, 'Other') AS k, count(*) AS n
                                FROM win GROUP BY 1) t),
    'utm_sources',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', t.k, 'clicks', t.n)
                                      ORDER BY t.n DESC), '[]'::jsonb)
                        FROM (SELECT COALESCE(utm_source, '(sem utm)') AS k, count(*) AS n
                                FROM win GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t),
    -- Amostra recente para a tabela do detalhe. Teto fixo: a UI nunca pagina
    -- clique a clique, e assim a resposta tem tamanho previsível.
    'recent',        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                        'clicked_at', r.clicked_at,
                                        'referrer_host', r.referrer_host,
                                        'device_type', r.device_type,
                                        'browser_family', r.browser_family,
                                        'country', r.country,
                                        'utm_source', r.utm_source,
                                        'utm_medium', r.utm_medium,
                                        'utm_campaign', r.utm_campaign)
                                      ORDER BY r.clicked_at DESC), '[]'::jsonb)
                        FROM (SELECT * FROM win ORDER BY clicked_at DESC LIMIT 50) r)
  ) END;
$$;

REVOKE ALL ON FUNCTION public.get_managed_link_analytics(uuid, uuid, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_managed_link_analytics(uuid, uuid, int) TO service_role;

-- ── 9. Story: qual link foi divulgado ───────────────────────────────────────
-- Snapshot da URL PÚBLICA do redirect (nunca o destination_url) no post de
-- Story, para saber depois qual link estava sendo divulgado. É registro: a
-- Content Publishing API do Instagram não aceita link sticker por API.
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS story_link_url text,
  ADD COLUMN IF NOT EXISTS managed_link_id uuid
    REFERENCES public.managed_links(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.scheduled_posts.story_link_url IS
  'URL pública divulgada no Story (link direto ou /r/{slug}). Nunca o destination_url.';
COMMENT ON COLUMN public.scheduled_posts.managed_link_id IS
  'Link gerenciado escolhido no Story, quando houver. ON DELETE SET NULL.';

COMMENT ON TABLE public.managed_links IS
  'Links curtos do AutoScale. Slug imutável, destino trocável. Sem cloaking: um slug = um destino para todos os visitantes.';
COMMENT ON COLUMN public.managed_links.status IS
  'active = redireciona; paused = 410; archived = 404 (soft delete, preserva analytics).';
COMMENT ON TABLE public.managed_link_clicks IS
  'Analytics sem dado pessoal: sem IP (nem hash), sem User-Agent bruto, sem URL de referer completa.';
