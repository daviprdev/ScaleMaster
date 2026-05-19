-- ─────────────────────────────────────────────────────────────
-- Admin Roles — Fase 34
-- Execute no Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Tabela de roles dos usuários
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user', 'admin', 'banned')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

-- 2. Row-Level Security
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Usuário lê a própria role (necessário para o layout de admin verificar)
CREATE POLICY "own_role_select" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Somente service_role escreve (API admin usa SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY "service_role_write" ON public.user_roles
  FOR ALL USING (auth.role() = 'service_role');

-- 3. Função que atribui 'user' automaticamente no signup
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 4. Trigger disparado após INSERT em auth.users
DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- ─────────────────────────────────────────────────────────────
-- Para promover seu usuário a admin (substitua pelo UUID real):
-- UPDATE public.user_roles SET role = 'admin' WHERE user_id = '<seu-uuid>';
-- ─────────────────────────────────────────────────────────────
