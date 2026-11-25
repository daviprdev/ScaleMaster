-- Login Unificado (Facebook Login for Business): ID da configuração do app.
-- Preenchido = OAuth por facebook.com/dialog/oauth com o App ID do Meta; vazio = Login do Instagram.
alter table public.user_meta_apps add column if not exists config_id text;

notify pgrst, 'reload schema';
