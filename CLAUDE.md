# AutoScale-IA — Contexto do Projeto

## Visão Geral
Plataforma SaaS de automação Instagram com duas partes integradas:
1. **SaaS Frontend/Backend** (Next.js) — dashboard, API routes, Supabase
2. **Worker RPA** (Python) — automação de onboarding de contas Instagram via Docker na VPS

## Repositório
- **GitHub:** `daviprdev/AutoScale-IA` (único repo — antigo `AutoScale-RPA` foi obsoleto e pode ser deletado)
- **Branch `main`:** SaaS Next.js → deploy automático na Vercel
- **Branch `master`:** Worker RPA Python → arquivos copiados via SCP para VPS

## Arquitetura

### SaaS (Next.js + Supabase + Vercel)
- **URL Produção:** https://autoscale-ia.vercel.app
- **Framework:** Next.js 14 App Router, Tailwind CSS, Framer Motion
- **Database:** Supabase (PostgreSQL + RLS)
- **Storage:** Supabase Storage (buckets: avatars, media, stories)
- **Auth:** Supabase Auth (email/password + OAuth)
- **Design System:** Cyber-Military Elite — cores #00FF41 (verde neon), #00E5FF (ciano), fundo escuro
- **Deploy:** Push para `main` → Vercel auto-deploy

### Worker RPA (Python + Docker + VPS)
- **VPS:** 2.25.244.181 (Hetzner)
- **Porta:** 8080 (health check + API jobs)
- **Container:** Docker Compose com Xvfb (display virtual :99)
- **Arquivos no servidor:** `/opt/worker-rpa/` (NÃO é git repo — arquivos via SCP)
- **Banco:** SQLite local em `/app/data/jobs.db` (schema v2 com lease/heartbeat)
- **Perfis browser:** `/opt/rpa/profiles/{username}/` (persistente entre runs)

#### Fluxo do Worker (onboarding_rpa.py)
```
FASE 1 — Instagrapi Mobile:
  1a. Login mobile + 2FA TOTP (instagrapi Client)
  1b. Validar identidade (user_info_by_username)
  1c. Converter para criador (account_convert_to_creator)
  1d. Postar story com StoryLink OBRIGATÓRIO + verificar sticker visual
  1e. Trocar foto de perfil
  1f. Criar destaque a partir do story_pk confirmado
  1g. Extrair cookies da sessão

FASE 2 — Playwright Web (cookies injetados):
  2a. Navegar Instagram (já logado via cookies)
  2b. Validar identidade web via /api/v1/accounts/current_user/
  2c. Aceitar convite tester (se app_id fornecido)
  2d. Magic Link OAuth com confirmação backend
```

#### Arquivos-chave do Worker
| Arquivo | Função |
|---------|--------|
| `worker.py` | Loop principal, semaphore, heartbeat, lease management |
| `onboarding_rpa.py` | Motor RPA: Instagrapi + Playwright, checkpoints por etapa |
| `db.py` | SQLite schema v2: jobs, proxies, job_stages, migrações incrementais |
| `health.py` | FastAPI endpoints: /health, /jobs, /stats, /proxies, /queue |
| `config.py` | Variáveis de ambiente, validação |
| `crypto.py` | AES-256-GCM encrypt/decrypt (SHA-256 key derivation) |
| `Dockerfile` | Python 3.11 + Chromium + Xvfb + instagrapi from git |
| `docker-compose.yml` | Service rpa-worker, volumes profiles+data, port 8080 |

#### Schema DB v2 (colunas adicionadas via migração)
- `lease_owner`, `lease_expires_at`, `heartbeat_at` — concorrência com fencing
- `next_attempt_at`, `deadline_at`, `retry_count` — orçamento de execução (MAX_TOTAL_RETRIES=6)
- `current_stage`, `flow_version` — tracking de progresso
- `story_pk`, `highlight_pk` — IDs externos confirmados
- `error_code`, `app_id`, `idempotency_key` — classificação de erros

## Deploy

### VPS Worker
```bash
# Copiar arquivos atualizados
scp -i ~/.ssh/id_ed25519 db.py worker.py onboarding_rpa.py health.py requirements.txt root@2.25.244.181:/opt/worker-rpa/

# Rebuild e restart
ssh root@2.25.244.181 "cd /opt/worker-rpa && docker compose build --no-cache && docker compose up -d"

# Verificar health
curl http://2.25.244.181:8080/health

# Ver logs
ssh root@2.25.244.181 "docker logs worker-rpa-rpa-worker-1 --tail 50"
```

### Vercel SaaS
```bash
# Push para main = deploy automático
git push origin main

# Ver status
# https://vercel.com/daviprdev/autoscale-ia
```

## Variáveis de Ambiente

### VPS (.env em /opt/worker-rpa/.env)
- `ENCRYPTION_SECRET` — chave AES-256 para credenciais
- `WORKER_API_SECRET` — Bearer token para API /jobs
- `SAAS_BASE_URL` — https://autoscale-ia.vercel.app
- `MAX_CONCURRENT_JOBS` — 3 (default)
- `POLL_INTERVAL_SECONDS` — 30 (default)
- `BROWSER_HEADLESS` — true (Docker) / false (debug local)

### Vercel (Dashboard → Settings → Environment Variables)
- `RPA_WORKER_URL` — http://2.25.244.181:8080
- `RPA_WORKER_SECRET` — mesmo WORKER_API_SECRET da VPS
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase
- Outras vars do SaaS (Meta API, etc.)

## Convenções

### Commits
- Worker RPA: commits em `master`, mensagem descritiva em inglês
- SaaS: commits em `main`, deploy automático na Vercel
- Nunca push direto para `main` sem testar worker separadamente

### Proxy Format
- Provider entrega: `host:port:user:pass`
- Worker converte internamente:
  - Playwright: `{server: "http://host:port", username: user, password: pass}`
  - Instagrapi: `http://user:pass@host:port`
- Session ID sticky: substituir `{session_id}` no username por UUID curto

### Encryption
- Algoritmo: AES-256-GCM
- Key derivation: SHA-256(ENCRYPTION_SECRET) — NÃO é PBKDF2
- Formato storage: `base64(nonce):base64(tag):base64(ciphertext)`

### Memory (Claude Code)
- Localização: `~/.claude/projects/C--Users-davip-OneDrive-Documentos-AutoScale-IA/memory/`
- 39 arquivos consolidados (SaaS + Worker RPA)
- MEMORY.md é o índice — uma linha por memory, sem frontmatter
- Sempre salvar novas memórias aqui, independente do diretório de trabalho

## Endpoints API Worker

| Method | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | /health | — | Health check público |
| POST | /jobs | Bearer | Criar job de onboarding |
| GET | /jobs | Bearer | Listar jobs recentes |
| DELETE | /jobs/{id} | Bearer | Remover job |
| GET | /jobs/{id}/stages | Bearer | Progresso por etapa |
| GET | /stats | — | Estatísticas da fila |
| GET | /queue/status | — | Fila pausada? |
| POST | /queue/pause | Bearer | Pausar fila |
| POST | /queue/resume | Bearer | Retomar fila |
| POST | /jobs/{id}/pause | Bearer | Pausar job específico |
| POST | /jobs/{id}/resume | Bearer | Retomar job específico |
| GET | /jobs/paused | Bearer | Listar jobs pausados |
| POST | /proxies | Bearer | Adicionar proxy |
| GET | /proxies | Bearer | Listar proxies |
| DELETE | /proxies/{id} | Bearer | Remover proxy |
| PATCH | /proxies/{id}/deactivate | Bearer | Desativar proxy |
| GET | /proxies/stats | — | Stats do estoque |

## Troubleshooting Rápido

| Problema | Causa Provável | Solução |
|----------|---------------|---------|
| Container crashando no start | Schema migration falhou | Verificar logs, limpar Xvfb lock |
| Health retorna vazio | Worker ainda inicializando | Aguardar 15-20s após `docker compose up` |
| Story sem sticker visual | instagrapi StorySticker.story_link=None | Usar stickers=[] com StoryStickerLink populado |
| Login web falha após cookies | sessionid ausente ou expirado | Verificar _extract_cookies_for_playwright() |
| 2FA não preenche | Input selector mudou | Verificar inspect_2fa.py output, atualizar selectors |
| Proxy não conecta | Formato errado | Verificar conversão host:port:user:pass → http:// |

## Status Atual (2026-09-28)
- ✅ VPS Worker: healthy, schema v2 migrado, loop ativo
- ✅ Vercel SaaS: production ready (commit 144173c)
- ✅ Sticker de link nos stories: corrigido (StorySticker com story_link populado)
- ✅ Lease/heartbeat/fencing: implementado e deployado
- ✅ Checkpoints por etapa: funcionando com resume
- ⏳ Teste end-to-end com contas reais: pendente (aguardando novas credenciais + proxy)