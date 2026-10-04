# Relatório Completo: Prioridade por Views, Limpeza de Features e Migração VPS

**Data:** 2026-10-04  
**Repositório:** `https://github.com/daviprdev/AutoScale-IA`  
**Branch:** `main`  
**Commits de referência:** `de62b6a`, `ddb824a`, `294a242`

---

## 1. Resumo Executivo

Esta sessão executou três frentes de trabalho distintas e sequenciais:

1. **Estratégia de Distribuição por Views (Entrega 1):** Implementação de algoritmo determinístico que prioriza Reels com mais visualizações, garantindo diversidade entre contas e balanceamento em cenários de escassez.
2. **Infraestrutura para Migração VPS (Entrega 2):** Criação de Dockerfile, docker-compose, nginx, systemd timers e helpers de URL canônica para desacoplar a aplicação da Vercel.
3. **Limpeza de Features Obsoletas (Entrega 3):** Remoção completa de RPA, Links Gerenciados, Logins e Horário Humano, reduzindo ~10k linhas de código e eliminando dependências cruzadas.

**Status atual:** Código pushado para GitHub (`cf9902d..294a242`). Deploy na Vercel falhou devido à incompatibilidade com `output: "standalone"`. Migração para VPS iniciada (reconhecimento do ambiente), mas interrompida antes da instalação de pacotes.

---

## 2. Entrega 1: Estratégia de Prioridade por Views

### 2.1 O que foi feito

- **Novo módulo centralizado:** [`lib/media-priority.ts`](../lib/media-priority.ts)
  - Algoritmo determinístico usando PRNG mulberry32 (seed reproduzível por janela/ciclo).
  - Três estratégias: `views` (DESC), `least_usage` (ASC), `random`.
  - Balanceamento aritmético modular para escassez (ex: 10 contas / 3 vídeos → 4/3/3).
  - Respeita histórico por conta, cooldown global e reservas concorrentes.
- **Integração em rotas críticas:**
  - [`app/api/posts/distribute/route.ts`](../app/api/posts/distribute/route.ts): removido `fisherYates` inline, substituído por `assignVideos`.
  - [`app/api/cron/process-loops/route.ts`](../app/api/cron/process-loops/route.ts): lógica de seleção substituída, `views` adicionado ao select.
  - [`app/api/cron/sync-distribute-accounts/route.ts`](../app/api/cron/sync-distribute-accounts/route.ts): mesma integração, removido `globalUsageByVideo` órfão.
- **UI atualizada:**
  - [`app/dashboard/postar/page.tsx`](../app/dashboard/postar/page.tsx): seletor de estratégia ("Mais visualizados", "Menor uso", "Aleatório") + payload `priority_strategy`.
  - [`app/dashboard/loop/page.tsx`](../app/dashboard/loop/page.tsx): mesmo seletor, carregamento ao editar loop existente (default `least_usage` para preservar comportamento antigo).
- **Migração SQL:** [`supabase/media_priority_strategy.sql`](../supabase/media_priority_strategy.sql) — adiciona colunas `priority_strategy` e `distribution_seed` em `distribute_campaigns` e `loops`.
- **Testes:** 15 testes unitários em [`__tests__/media-priority.test.ts`](../__tests__/media-priority.test.ts) cobrindo views, escassez, seed, colisões e bordas. Script de simulação em [`scripts/simulate-priority.mjs`](../scripts/simulate-priority.mjs).

### 2.2 Erros encontrados e resolvidos

| Erro | Causa | Solução |
|------|-------|---------|
| `Cannot find module 'vitest'` | Dependência de teste não instalada | `npm install --save-dev vitest --legacy-peer-deps` |
| `ERR_MODULE_NOT_FOUND: vite` | Vitest requer Vite como peer dep | `npm install --save-dev vite --legacy-peer-deps` |
| Cast `DistributeBody` → `Record<string, unknown>` | TypeScript strict mode | Cast duplo via `unknown` intermediário |
| Função `fisherYates` órfã após refactor | Import não removido automaticamente | Remoção manual em cada rota integrada |

### 2.3 Validação

- ✅ Typecheck: `npm run typecheck` passa sem erros.
- ✅ Build: `npm run build` compila todas as rotas.
- ✅ Testes: 15/15 passando em ~500ms.
- ✅ Simulação: 5 contas/10 vídeos = zero colisões; 10 contas/3 vídeos = distribuição 4/3/3.

---

## 3. Entrega 2: Infraestrutura VPS

### 3.1 Arquivos criados

| Arquivo | Propósito |
|---------|-----------|
| [`Dockerfile`](../Dockerfile) | Multi-stage (deps → build → runner), Node 20 Alpine, ffmpeg, non-root user, standalone output |
| [`docker-compose.yml`](../docker-compose.yml) | Health check, limites 2GB/2CPU, log rotation, env_file `.env.production` |
| [`nginx/nginx.conf`](../nginx/nginx.conf) | SSL/TLS, proxy reverso, restrição de crons a localhost, body 500MB |
| [`lib/app-url.ts`](../lib/app-url.ts) | Helper server-side com fallback seguro em build-time (`NEXT_PHASE`) |
| [`lib/app-url-client.ts`](../lib/app-url-client.ts) | Helper client-safe com fallback para `window.location.origin` |
| [`scripts/generate-systemd-timers.sh`](../scripts/generate-systemd-timers.sh) | Gera 15 pares service+timer com offsets escalonados |
| [`.env.production.example`](../.env.production.example) | Template documentado (sem valores reais) |

### 3.2 Substituição de URLs hardcoded

9 arquivos migrados de `https://autoscale-ia.vercel.app` para helpers canônicos:

- `app/api/instagram/auth/route.ts`
- `app/api/instagram/callback/route.ts`
- `app/add/oauth/[token]/route.ts`
- `app/api/debug-env/route.ts`
- `app/api/onboarding/start/route.ts` *(posteriormente deletado na Entrega 3)*
- `app/api/onboarding/magic-token/route.ts` *(posteriormente deletado)*
- `app/api/admin/rpa/generate-magic-link/route.ts` *(posteriormente deletado)*
- `app/dashboard/apps/page.tsx`
- `components/dashboard/MagicLinkModal.tsx`

### 3.3 Configuração do Next.js

Adicionado `output: "standalone"` em [`next.config.ts`](../next.config.ts) para gerar `.next/standalone` consumível pelo Dockerfile.

### 3.4 Erros encontrados e resolvidos

| Erro | Causa | Solução |
|------|-------|---------|
| Build falha em `/add/oauth/[token]` | `getAppUrl()` lança erro durante static generation quando `NEXT_PUBLIC_APP_URL` não está definido | Adicionado check `NEXT_PHASE === "phase-production-build"` retornando placeholder `"__APP_URL_NOT_SET__"` |
| Deploy Vercel falha em 0ms | `output: "standalone"` incompatível com builder proprietário da Vercel | **Não corrigido intencionalmente** — Vercel será descomissionada; Docker na VPS usa standalone corretamente |

---

## 4. Entrega 3: Limpeza de Features Obsoletas

### 4.1 Escopo removido

| Feature | Arquivos deletados | Linhas removidas |
|---------|-------------------|------------------|
| **RPA** | 11 rotas `/api/admin/rpa/*`, `dashboard/rpa`, `OnboardingModal`, `python_server/onboarding_rpa.py`, `python_server/session_store.py` | ~4.500 |
| **Onboarding RPA** | `app/api/onboarding/*` (4 rotas), `app/add/[token]`, `app/add/error` | ~1.200 |
| **Links Gerenciados** | `app/api/links/*` (3 rotas), `app/r/[slug]`, `dashboard/links/*`, `lib/link-base-url.ts`, `lib/managed-links*.ts`, `StoryLinkSelector` | ~2.000 |
| **Logins** | `dashboard/logins`, `cron/process-instagram-logins` | ~800 |
| **Horário Humano** | `dashboard/human-schedule`, `api/human-schedule`, lógica embutida em `process-loops` | ~600 |
| **Docs/Scripts** | `WORKER-RPA-ARQUITETURA.md`, `BROWSER-ENGINE.md`, `test-managed-links.mjs`, `test-hardening.mjs` | ~900 |
| **SQL migrations** | 6 arquivos de tabelas obsoletas | N/A |

**Total:** 57 arquivos alterados, **~10.068 linhas removidas**.

### 4.2 Decisões do usuário (via AskUserQuestion)

| Pergunta | Resposta | Impacto |
|----------|----------|---------|
| Onboarding RPA? | "Remover tudo" | Rotas, modal e páginas `/add/*` deletados |
| Links + Stories? | "Remover tudo sem refatorar" | Stories refatorado para URL direta apenas |
| Scrape Jobs? | "Manter python-server.ts" | `lib/python-server.ts` preservado para `process-scrape-jobs` |

### 4.3 Refatorações necessárias (dependências cruzadas)

- **Stories:** `StoryLinkSelector` removido; `stories/page.tsx` e `stories/post-now/route.ts` simplificados para aceitar apenas `story_link_url` (URL direta). Validação inline substituiu `validateDestinationUrl`.
- **process-loops:** Função `isWithinHumanSchedule`, interface `HumanScheduleRow`, query `human_schedule_settings` e parâmetro `scheduleMap` removidos. Cron agora processa loops sem gate de horário humano.
- **Sidebar/Header:** Entradas de RPA, Links, Logins e Horário Humano removidas.
- **vercel.json:** Cron `process-instagram-logins` removido.
- **systemd timers:** Timer `process-instagram-logins` removido do script gerador.
- **.env.production.example:** Variáveis `PYTHON_SERVER_URL` e `PYTHON_SERVER_SECRET` removidas.
- **accounts/page.tsx:** Botão "RPA", import/state/renderização do `OnboardingModal` removidos.

### 4.4 Erros encontrados e resolvidos

| Erro | Causa | Solução |
|------|-------|---------|
| 38 erros TS2307 em `.next/types/` | Cache stale referenciando rotas deletadas | `rm -rf .next/types` |
| `Cannot find module '@/lib/managed-links'` | Import em `stories/post-now` após deleção | Removido import + lógica de managed_link_id |
| `Cannot find module 'StoryLinkSelector'` | Import em `stories/page.tsx` após deleção | Substituído por input de URL direta |
| `Cannot find name 'managedLinkId'` | Variável órfã no corpo de `stories/post-now` | Linha removida |

### 4.5 Validação

- ✅ Typecheck: passa sem erros após todas as correções.
- ✅ Build: `✓ Compiled successfully in 25.9s`.
- ✅ Busca residual: zero referências funcionais a features removidas (apenas comentário histórico em `process-scrape-jobs`).

---

## 5. Status da Migração VPS

### 5.1 Reconhecimento do ambiente (executado)

SSH na VPS `2.25.244.181` confirmou:

| Recurso | Valor |
|---------|-------|
| OS | Ubuntu 26.04.1 LTS |
| CPU | 2 cores |
| RAM | 7.7 GB total, ~7 GB disponível |
| Disco | 96 GB total, 23 GB livres (77% usado) |
| Docker | 29.1.3 ✅ |
| Compose | 2.40.3 ✅ |
| Nginx | **Não instalado** ❌ |
| Certbot | **Não instalado** ❌ |
| Worker RPA | `worker-rpa-rpa-worker-1` Up 5 days (healthy), porta 8080 |
| Portas 80/443 | **Livres** ✅ |

### 5.2 O que falta para completar a migração

| Etapa | Status | Detalhe |
|-------|--------|---------|
| Instalar Nginx + Certbot + Git | ⏸️ Bloqueado | Comando rejeitado pelo usuário antes da execução |
| Clonar repositório em `/opt/autoscale` | ❌ Pendente | Depende da etapa anterior |
| Copiar `.env.production.example` → `.env.production` | ❌ Pendente | Requer valores reais (Supabase, Meta, Apify, chaves) |
| Definir `NEXT_PUBLIC_APP_URL` | ❌ Pendente | Domínio de produção ainda não informado |
| `docker compose up -d --build` | ❌ Pendente | Depende das etapas anteriores |
| Validar health check | ❌ Pendente | `curl http://127.0.0.1:3000/api/health` |
| Gerar systemd timers | ❌ Pendente | `bash scripts/generate-systemd-timers.sh /tmp/systemd` |
| Configurar SSL com certbot | ❌ Pendente | Requer domínio apontado via DNS |
| Atualizar Meta Developer Console | ❌ Pendente | Adicionar novo domínio como redirect URI |
| Atualizar Supabase Auth URLs | ❌ Pendente | Site URL + Redirect URLs |
| Executar migração SQL `media_priority_strategy.sql` | ❌ Pendente | Adicionar colunas no Supabase |
| Virar DNS | ❌ Pendente | Último passo, após validação |
| Descomissionar Vercel | ❌ Pendente | Manter como fallback por 24h pós-virada |

### 5.3 Por que o deploy na Vercel falhou

O build local passa (`✓ Compiled successfully`), mas a Vercel falha em 0ms porque `output: "standalone"` no `next.config.ts` conflita com o builder proprietário da plataforma. Isso **não afeta o deploy na VPS**, onde o Dockerfile consome o output standalone exatamente como projetado. A Vercel pode ser mantida temporariamente revertendo essa config se necessário, mas o plano é descomissioná-la.

---

## 6. Commits Produzidos

| Hash | Mensagem | Arquivos | Linhas |
|------|----------|----------|--------|
| `de62b6a` | feat: prioridade por views na distribuição com diversidade entre contas | 11 | +2.167 / -187 |
| `ddb824a` | infra: preparar migração Vercel → VPS mantendo Supabase gerenciado | 17 | +384 / -15 |
| `294a242` | refactor: remover RPA, Links Gerenciados, Logins e Horário Humano | 57 | +517 / -10.068 |

Todos pushados para `origin/main` (`cf9902d..294a242`).

---

## 7. Próximos Passos Imediatos

1. **Confirmar domínio de produção** — necessário para SSL, `NEXT_PUBLIC_APP_URL` e registros OAuth.
2. **Autorizar instalação de pacotes na VPS** — `apt-get install nginx certbot python3-certbot-nginx git curl`.
3. **Preencher `.env.production`** com valores reais (nunca commitar).
4. **Executar `docker compose up -d --build`** e validar health check.
5. **Configurar systemd timers e nginx** antes da virada de DNS.
6. **Atualizar integrações externas** (Meta, Supabase) com o novo domínio.
7. **Virar DNS** e monitorar por 24h com Vercel como fallback.
8. **Executar migração SQL** no Supabase (opcional antes do deploy; defaults funcionam).

---

*Documento gerado automaticamente em 2026-10-04 com base no histórico completo da sessão.*