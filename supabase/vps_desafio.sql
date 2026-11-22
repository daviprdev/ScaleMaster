-- Contas VPS (22/11): captcha no cadastro = desafio pendente. Container, proxy e sessão ficam;
-- o sync grava true quando o agente para a conta no captcha e o Responder do card grava false.
-- Manual (SQL Editor). Sem a coluna o sync e o Responder só logam o aviso.
alter table public.vps_devices add column if not exists desafio boolean not null default false;

notify pgrst, 'reload schema';
