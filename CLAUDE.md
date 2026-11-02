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
- `PUBLISH_PROXIES` — proxies da VPS (URLs separadas por vírgula) para publicar posts **sem** "Usar minhas proxies"; cada post cai numa delas pelo hash do id, proxy morta é pulada, sem nenhuma viva sai direto (`lib/vps-publish-proxy.ts`). **Vazio desde 2026-10-31** (a pedido: posts sem a opção saem direto da VPS); as 3 URLs antigas estão comentadas logo acima no `.env.production`

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
| SharkBot | Webhook vendas | ✅ Seguro | Fail-closed, secret obrigatório. Duas contas pelo link do token: principal `/api/webhooks/sharkbot/<token>` e gringa `.../<token>/gringa` (`source = sharkbot_gringa`); o valor já chega em reais nas duas (a SharkBot converte) |
| ApexVips | Webhook vendas | ✅ Seguro | Fail-closed, secret obrigatório |
| Push (VAPID) | Notificações | ✅ Configurado | Requer inscrição no navegador |
| Apify | Scraper externo | ⚠️ Opcional | Token configurado, billing externo |
| MuMu Player | Agente no PC do dono | Aba Emulador | `agente-mumu/` (Node sem deps) chama `/api/emulador/agente/sync` a cada 3 s com código `smag_` (só o hash no banco); com o PC Offline, o botão "Iniciar agente" abre o link `scalemaster-agente:` (registrado no PC por `agente-mumu/instalar-botao.ps1`, só sobe o agente); abre/fecha instâncias pelo MuMuManager e roda automações de `agente-mumu/tarefas/` via adb. Botão "Criar instância" (`emulator_jobs`, `agente-mumu/fluxos/`): copia a instância padrão, troca IMEI/Android ID/MAC, dá o @ como nome, liga, instala o Instagram pelo Aurora, põe a proxy HTTP no NekoBox e cadastra com o Gmail (código e telas desconhecidas são pedidos ao dono na aba; telas novas salvas em `agente-mumu/telas/`); até duas automações por PC ao mesmo tempo, contando Estruturar para controlar a RAM, e Continuar retoma da etapa que falhou. Editar nome renomeia no MuMu (o comando guarda `params.anterior` e, confirmado no sync, a etapa `nome` dos dados passa para o nome novo — `syncRenames`); Editar dados existe em toda instância: conta parada ou na fila volta à fila ao salvar (o que mudou roda de novo, com o Instagram zerado), conta criada só guarda os dados, rodando só mostra, e instância sem conta do sistema ganha uma linha `done` com a etapa `registro` (dados anotados, nada roda no PC, fora da lista de criação); "Criar conta aqui" faz a conta numa instância existente sem conta ligada. A lixeira na linha (fora a #0, nada dela na fila) apaga a instância do MuMu (`delete`, desliga antes e só apaga se o nome ainda bater, porque o MuMu reaproveita o índice) e, confirmado no sync, tira da aba a conta e as estruturações dela (`syncDeletes`). Aviso de conta travada (telefone ou captcha "Confirma que és uma pessoa") fica no PC (`agente-mumu/alertas.json`, preso ao created_timestamp da instância) e vai no retrato. Botão "Estruturar" (kind `atividade` na mesma fila, `agente-mumu/fluxos/atividade.mjs` + `instagram.mjs`): liga, conecta a proxy do NekoBox antes do Instagram, e faz o marcado — trocar foto, story com sticker de link e destaque — e desliga (o aquecimento — 2–3 verificados de `fluxos/verificados.mjs` + até 2 min de Reels — roda no fim do Criar instância, que depois para o Instagram e desliga a instância); mídias saem da pasta do MuMu no PC (`Documentos\MuMuSharedFolder`): o agente manda a lista em `emulator_agents.media` e copia o arquivo marcado direto do PC (nada sobe para o Storage). Instagram só pela proxy: abre só depois do teste da proxy, para se a VPN cair, e é forçado a parar antes de desligar a instância (não acorda sozinho no boot; o always-on/lockdown do Android não funciona no MuMu). Tabelas em `supabase/emulador_agente.sql`, `supabase/emulador_contas.sql` e `supabase/emulador_atividade.sql` (manuais) |

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
