-- ─────────────────────────────────────────────────────────────────────────────
-- Legenda original de Reels (2026-09-07)
--
-- Preserva o TEXTO da publicação original junto do vídeo raspado, e deixa a
-- publicação escolher entre usar essa legenda, uma personalizada ou nenhuma.
--
-- NÃO TOCA EM MÍDIA. Nenhuma coluna aqui afeta bytes de vídeo, Storage,
-- `video_processing_mode`, FFmpeg, efeitos ou metadata de arquivo. É só texto.
--
-- REUSO EM VEZ DE DUPLICATA: `videos_library` já tinha `caption` e
-- `owner_username`, gravados pelo save-to-library desde as Inspirações. Criar
-- `original_caption`/`source_username` ao lado seria duplicar conceito, então
-- essas duas colunas são REAPROVEITADAS e ganham comentário explicando a
-- semântica. Só `source_url` é nova — `original_url` já existe mas guarda a
-- URL do arquivo no CDN (que expira), não o permalink da publicação.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Origem do vídeo raspado ──────────────────────────────────────────────

ALTER TABLE public.videos_library
  ADD COLUMN IF NOT EXISTS source_url text;

COMMENT ON COLUMN public.videos_library.caption IS
  'Legenda ORIGINAL da publicação raspada, exatamente como veio do Apify: sem truncar, traduzir, resumir ou reescrever. NULL = não capturada (upload manual ou ingestão anterior a 2026-09-07). Cadeia vazia = o Reel não tinha legenda. Só é lida quando a publicação escolhe caption_mode=original.';

COMMENT ON COLUMN public.videos_library.owner_username IS
  'Autor original do Reel (@ sem arroba). É o "source_username" da feature de legenda original.';

COMMENT ON COLUMN public.videos_library.source_url IS
  'Permalink da publicação original no Instagram (campo `url` do Apify). Diferente de original_url, que guarda a URL do arquivo no CDN e expira.';

-- ── 2. Modo de legenda nas CONFIGURAÇÕES ────────────────────────────────────
-- NULLABLE de propósito. NULL = comportamento anterior à feature, que é
-- exatamente o modo `custom`: legenda vinda do pool que o usuário digitou
-- (`captions`) ou do gerador automático. Sem backfill: nenhuma configuração
-- existente muda de conduta.
--
-- Os dois toggles só têm efeito quando caption_mode = 'original'. Default
-- false nos dois: por padrão a legenda original vai intacta, com hashtags e
-- @menções preservadas (remover crédito de criador sem pedido explícito seria
-- alterar o texto do autor).

ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS caption_mode text
    CHECK (caption_mode IS NULL OR caption_mode IN ('original', 'custom', 'none')),
  ADD COLUMN IF NOT EXISTS caption_strip_hashtags boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS caption_strip_mentions boolean NOT NULL DEFAULT false;

ALTER TABLE public.distribute_campaigns
  ADD COLUMN IF NOT EXISTS caption_mode text
    CHECK (caption_mode IS NULL OR caption_mode IN ('original', 'custom', 'none')),
  ADD COLUMN IF NOT EXISTS caption_strip_hashtags boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS caption_strip_mentions boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.loops.caption_mode IS
  'original = legenda do próprio vídeo; custom = pool/automática (comportamento histórico); none = sem legenda. NULL = custom.';
COMMENT ON COLUMN public.distribute_campaigns.caption_mode IS
  'original = legenda do próprio vídeo; custom = pool/automática (comportamento histórico); none = sem legenda. NULL = custom.';

-- ── 3. Snapshot no POST CONCRETO ────────────────────────────────────────────
-- `scheduled_posts.caption` e `pending_containers.caption` JÁ guardam o texto
-- final — nada muda aí. O que se acrescenta é apenas o registro de QUAL modo
-- produziu aquele texto, para auditoria: por que este post saiu sem legenda?
-- Nenhuma leitura de publicação depende dessa coluna; `publish-scheduled`
-- continua usando só `caption`.

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS caption_mode text
    CHECK (caption_mode IS NULL OR caption_mode IN ('original', 'custom', 'none'));

ALTER TABLE public.pending_containers
  ADD COLUMN IF NOT EXISTS caption_mode text
    CHECK (caption_mode IS NULL OR caption_mode IN ('original', 'custom', 'none'));

COMMENT ON COLUMN public.scheduled_posts.caption_mode IS
  'Auditoria: modo que gerou o snapshot em `caption`. A publicação usa `caption`, nunca recalcula a partir daqui.';
COMMENT ON COLUMN public.pending_containers.caption_mode IS
  'Auditoria: modo que gerou o snapshot em `caption`. A publicação usa `caption`, nunca recalcula a partir daqui.';

-- ── 4. Índice ───────────────────────────────────────────────────────────────
-- A UI pergunta "quantos vídeos desta pasta têm legenda original?" ao montar o
-- aviso do modo `original`. Índice parcial: só as linhas COM legenda entram,
-- então ele fica pequeno mesmo com pasta grande.
CREATE INDEX IF NOT EXISTS videos_library_folder_with_caption_idx
  ON public.videos_library(folder_id)
  WHERE caption IS NOT NULL AND caption <> '';
