# ScaleMaster — Contexto do Projeto

## Visão Geral
Plataforma SaaS de automação Instagram hospedada em VPS própria com Supabase gerenciado.
1. **SaaS Frontend/Backend** (Next.js) — dashboard, API routes, agendamentos systemd
2. **Python Server** (FastAPI) — scraping, processamento de vídeo, automação browser

## Repositório
- **GitHub:** `daviprdev/ScaleMaster`
- **Branch `main`:** fonte única de verdade → deploy na VPS via git pull + docker compose

## Arquitetura

### Produção (VPS + Supabase) — único ambiente
- **URL Produção:** https://scalemaster.tech
- **VPS:** `2.25.244.181` (IPv6: `2a02:4780:75:828b::1`)
- **Checkout:** `/opt/scalemaster`
- **Framework:** Next.js 15 App Router, Tailwind CSS
- **Database/Auth/Storage:** Supabase (projeto `nulhkxjpsulkoygmralf`)
- **Containers:** `scalemaster-app-1` (Next.js :3000) + `scalemaster-python-server-1` (FastAPI :8000), projeto compose `scalemaster`
- **Proxy Reverso:** Nginx com HTTPS (Let's Encrypt) — `/etc/nginx/sites-enabled/scalemaster.tech`, espelhado em `nginx/nginx.conf`
- **Agendamentos:** 16 timers systemd (`scalemaster-*.timer`) — nenhum cron roda fora da VPS
- **Design System:** Scale Master — escuro quase preto + azul da logo (#001244/#00498D) + prata (#BEB8BC); tokens em `app/globals.css`, primitivos em `components/ui/`, referência em `docs/design/`.

### Serviços e Portas
| Serviço | Container | Porta Interna | Exposição |
|---------|-----------|---------------|-----------|
| Next.js App | scalemaster-app-1 | 3000 | 127.0.0.1:3000 (Nginx proxy) |
| Python Server | scalemaster-python-server-1 | 8000 | Rede interna Docker apenas |

## Deploy

### Procedimento Padrão
```bash
ssh root@2.25.244.181
cd /opt/scalemaster
git pull origin main
docker compose --env-file .env.production up -d --build app python-server
curl -sf http://127.0.0.1:3000/api/health  # Deve retornar {"status":"ok"}
```

### Rollback
```bash
cd /opt/scalemaster
git revert HEAD  # Ou: git checkout <commit-anterior>
docker compose --env-file .env.production up -d --build app
```

### Verificações Pré-Deploy
- [ ] Git sem rebase/merge pendente (`ls .git/rebase-merge` deve falhar)
- [ ] `docker-compose.yml` contém serviços `app` E `python-server`
- [ ] Arquivo termina com quebra de linha (previne corrupção YAML)
- [ ] Segredos presentes em `.env.production`

## Variáveis de Ambiente

### VPS (.env.production)
- `NEXT_PUBLIC_APP_URL=https://scalemaster.tech`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase público
- `SUPABASE_SERVICE_ROLE_KEY` — Admin access (apenas server-side)
- `SUPABASE_SECRET_KEY` — chave `sb_secret_` (opcional): login por username e `/auth/callback` mandam o IP do cliente no `Sb-Forwarded-For` (exige IP Address Forwarding ligado no Supabase); sem ela, caem na anon key
- `ENCRYPTION_SECRET` — AES-256-GCM para credenciais OAuth
- `PYTHON_SERVER_URL=http://python-server:8000` — Comunicação interna
- `PYTHON_SERVER_SECRET` — Auth entre app e python-server
- `CRON_SECRET` — Bearer dos timers; **tem que ser igual** ao de `/opt/scalemaster/.env.cron`
- `META_CLIENT_SECRET` — Meta/Instagram OAuth (modo global fallback)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Push notifications
- `SHARKBOT_WEBHOOK_SECRET`, `APEXVIPS_WEBHOOK_SECRET` — Webhooks de vendas
- `APIFY_API_TOKEN` — Scraper externo (integração opcional)
- `PUBLISH_PROXIES` — proxies da VPS (URLs separadas por vírgula) para publicar posts **sem** "Usar minhas proxies"; cada post cai numa delas pelo hash do id, proxy morta é pulada, sem nenhuma viva sai direto (`lib/vps-publish-proxy.ts`)

### VPS (.env.cron)
- `CRON_SECRET` — lido pelos timers systemd (`EnvironmentFile=/opt/scalemaster/.env.cron`)

### Convenções de Segurança
- Webhooks: fail-closed (HTTP 500 se segredo ausente, 401 se inválido)
- Logs OAuth: nunca registrar tokens/códigos, apenas user_id/error_type
- Credenciais por usuário (BYOC): criptografadas com ENCRYPTION_SECRET no banco

## Agendamentos (Systemd Timers)
16 timers ativos em produção, gerados por `scripts/generate-systemd-timers.sh`. Listar com:
```bash
systemctl list-timers --all | grep scalemaster
```

Principais:
- `scalemaster-publish-scheduled` — Publicação agendada (* * * * *)
- `scalemaster-refresh-tokens` — Renovação tokens Meta (0 */12 * * *)
- `scalemaster-process-videos` — Processamento FFmpeg (*/5 * * * *)
- `scalemaster-sync-post-insights` — Sincronização métricas (*/5 * * * *)

Saúde dos timers (todos devem sair com sucesso, não `Failed`):
```bash
systemctl list-units --failed | grep scalemaster
journalctl -u scalemaster-publish-scheduled.service --since "-10 min" --no-pager
```

## Integrações Externas

| Integração | Tipo | Status | Notas |
|------------|------|--------|-------|
| Meta/Instagram | OAuth oficial | ✅ Ativo | Graph API, credenciais por usuário ou global |
| Supabase | DB/Auth/Storage | ✅ Ativo | Projeto único, dados preservados |
| SharkBot | Webhook vendas | ✅ Seguro | Fail-closed, secret obrigatório |
| ApexVips | Webhook vendas | ✅ Seguro | Fail-closed, secret obrigatório |
| Push (VAPID) | Notificações | ✅ Configurado | Requer inscrição no navegador |
| Apify | Scraper externo | ⚠️ Opcional | Token configurado, billing externo |

## Worker Legado RPA (Desativado)
O worker RPA Python (`/opt/worker-rpa`) foi desativado durante a migração.
Onboarding agora é feito via API oficial Meta + python-server integrado.
Arquivos históricos podem existir mas NÃO são executados em produção.

## Troubleshooting

| Problema | Diagnóstico | Solução |
|----------|-------------|---------|
| 502 Bad Gateway | Container app parado | `docker ps`, `docker logs scalemaster-app-1` |
| Python indisponível | python-server fora | Verificar compose tem `python-server`, restart |
| Webhook retorna 500 | Secret não configurado | Adicionar `*_WEBHOOK_SECRET` ao .env.production |
| OAuth falha callback | NEXT_PUBLIC_APP_URL errado | Confirmar `https://scalemaster.tech` |
| Build falha EOF | docker-compose.yml sem newline | Adicionar `\n` antes de append de blocos |
| Cron não executa | Timer inativo | `systemctl status scalemaster-*.timer` |
| Todos os timers `Failed` (curl exit 22) | 401: `CRON_SECRET` do `.env.cron` ≠ do container | Igualar os dois e `systemctl reset-failed 'scalemaster-*'` |

## Memória (Claude Code)
- Localização: `~/.claude/projects/C--Users-davip-OneDrive-Documentos-ScaleMaster/memory/`
- MEMORY.md é o índice — uma linha por memory, sem frontmatter
- Sempre salvar novas memórias aqui, independente do diretório de trabalho

## Histórico
- **2026-10-16:** produção 100% na VPS — crons só nos timers systemd, checkout, containers e timers padronizados como `scalemaster`.
- Relatórios antigos de migração ficam em `docs/` como registro histórico.
