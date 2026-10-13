# ScaleMaster — Contexto do Projeto

## Visão Geral
Plataforma SaaS de automação Instagram hospedada em VPS própria com Supabase gerenciado.
1. **SaaS Frontend/Backend** (Next.js) — dashboard, API routes, agendamentos systemd
2. **Python Server** (FastAPI) — scraping, processamento de vídeo, automação browser

## Repositório
- **GitHub:** `daviprdev/ScaleMaster`
- **Branch `main`:** fonte única de verdade → deploy na VPS via git pull + docker compose

## Arquitetura

### Produção (VPS + Supabase)
- **URL Produção:** https://scalemaster.tech
- **VPS:** `2.25.244.181` (IPv6: `2a02:4780:75:828b::1`)
- **Checkout:** `/opt/autoscale`
- **Framework:** Next.js 15 App Router, Tailwind CSS
- **Database/Auth/Storage:** Supabase (projeto `nulhkxjpsulkoygmralf`)
- **Containers:** `autoscale-app-1` (Next.js :3000) + `autoscale-python-server-1` (FastAPI :8000)
- **Proxy Reverso:** Nginx com HTTPS (Let's Encrypt)
- **Agendamentos:** 15 timers systemd (`autoscale-*.service`) — NÃO usa Vercel Crons
- **Design System:** Cyber-Military Elite — cores #00FF41 (verde neon), #00E5FF (ciano), fundo escuro

### Serviços e Portas
| Serviço | Container | Porta Interna | Exposição |
|---------|-----------|---------------|-----------|
| Next.js App | autoscale-app-1 | 3000 | 127.0.0.1:3000 (Nginx proxy) |
| Python Server | autoscale-python-server-1 | 8000 | Rede interna Docker apenas |

## Deploy

### Procedimento Padrão
```bash
ssh root@2.25.244.181
cd /opt/autoscale
git pull origin main
docker compose --env-file .env.production up -d --build app python-server
curl -sf http://127.0.0.1:3000/api/health  # Deve retornar {"status":"ok"}
```

### Rollback
```bash
cd /opt/autoscale
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
- `ENCRYPTION_SECRET` — AES-256-GCM para credenciais OAuth
- `PYTHON_SERVER_URL=http://python-server:8000` — Comunicação interna
- `PYTHON_SERVER_SECRET` — Auth entre app e python-server
- `META_CLIENT_SECRET` — Meta/Instagram OAuth (modo global fallback)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Push notifications
- `SHARKBOT_WEBHOOK_SECRET`, `APEXVIPS_WEBHOOK_SECRET` — Webhooks de vendas
- `APIFY_API_TOKEN` — Scraper externo (integração opcional)

### Convenções de Segurança
- Webhooks: fail-closed (HTTP 500 se segredo ausente, 401 se inválido)
- Logs OAuth: nunca registrar tokens/códigos, apenas user_id/error_type
- Credenciais por usuário (BYOC): criptografadas com ENCRYPTION_SECRET no banco

## Agendamentos (Systemd Timers)
15 timers ativos em produção. Listar com:
```bash
systemctl list-timers --all | grep autoscale
```

Principais:
- `autoscale-publish-scheduled` — Publicação agendada (* * * * *)
- `autoscale-refresh-tokens` — Renovação tokens Meta (0 */12 * * *)
- `autoscale-process-videos` — Processamento FFmpeg (*/5 * * * *)
- `autoscale-sync-post-insights` — Sincronização métricas (*/5 * * * *)

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
| 502 Bad Gateway | Container app parado | `docker ps`, `docker logs autoscale-app-1` |
| Python indisponível | python-server fora | Verificar compose tem `python-server`, restart |
| Webhook retorna 500 | Secret não configurado | Adicionar `*_WEBHOOK_SECRET` ao .env.production |
| OAuth falha callback | NEXT_PUBLIC_APP_URL errado | Confirmar `https://scalemaster.tech` |
| Build falha EOF | docker-compose.yml sem newline | Adicionar `\n` antes de append de blocos |
| Cron não executa | Timer inativo | `systemctl status autoscale-*.timer` |

## Memória (Claude Code)
- Localização: `~/.claude/projects/C--Users-davip-OneDrive-Documentos-ScaleMaster/memory/`
- MEMORY.md é o índice — uma linha por memory, sem frontmatter
- Sempre salvar novas memórias aqui, independente do diretório de trabalho

## Histórico de Migração
- **2026-10-12:** Migração Vercel → VPS concluída e validada
- Commit final: `246a8a1` (docs: relatório de migração atualizado)
- Relatório completo: `docs/relatorio-migracao-vps-completo.md`
- Vercel: projeto `autoscale-ia` excluído, sem dependências residuais