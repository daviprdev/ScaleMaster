-- Tabela de rastreamento de sessões/dispositivos por usuário.
-- Cada registro representa um dispositivo único (deduplicado por user_agent + IP).
-- Criado/atualizado quando o usuário visita a página de configurações.

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_fingerprint text        NOT NULL,
  device_type        text        NOT NULL DEFAULT 'desktop'
                                 CHECK (device_type IN ('desktop', 'mobile', 'tablet')),
  browser            text        NOT NULL DEFAULT 'Desconhecido',
  os                 text        NOT NULL DEFAULT 'Desconhecido',
  ip_address         text,
  country            text,
  city               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
  ON public.user_sessions (user_id);

CREATE INDEX IF NOT EXISTS user_sessions_last_seen_idx
  ON public.user_sessions (user_id, last_seen_at DESC);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_sessions" ON public.user_sessions
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
