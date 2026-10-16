-- ScaleMaster - Tabela de templates de onboarding
-- Um template define a configuração padrão aplicada a um lote de contas importadas.
-- Executar no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS onboarding_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Meta App usado para gerar o Magic Link automaticamente
  app_id UUID REFERENCES user_meta_apps(id) ON DELETE SET NULL,
  -- URLs das mídias e textos aplicados a todas as contas do lote
  photo_url TEXT,
  story_media_url TEXT,
  story_link_url TEXT,
  highlight_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: cada usuário só vê/edita seus próprios templates
ALTER TABLE onboarding_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_select_own" ON onboarding_templates
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "templates_insert_own" ON onboarding_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "templates_update_own" ON onboarding_templates
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "templates_delete_own" ON onboarding_templates
  FOR DELETE USING (auth.uid() = user_id);

-- Índice para listagem rápida por usuário
CREATE INDEX IF NOT EXISTS idx_onboarding_templates_user_id ON onboarding_templates(user_id, created_at DESC);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_onboarding_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onboarding_templates_updated_at ON onboarding_templates;
CREATE TRIGGER trg_onboarding_templates_updated_at
  BEFORE UPDATE ON onboarding_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_onboarding_templates_updated_at();