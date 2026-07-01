-- Stagger customizável entre contas no Loop
-- Quando NULL, o cron usa cálculo automático (interval_minutes / nº_contas)
ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS account_stagger_seconds integer
    CHECK (account_stagger_seconds IS NULL OR account_stagger_seconds >= 5);
