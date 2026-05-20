# CLAUDE.md — AutoScale (AutoScale AI)

Este arquivo é lido automaticamente pelo Claude Code em toda conversa.
Contém as instruções, contexto e estado atual do projeto.

---

## Visão Geral do Projeto

**Nome:** AutoScale
**Nome do repositório:** AutoScale-IA
**Dono:** Davi Pereira (`daviprdev`)
**Repositório:** https://github.com/daviprdev/AutoScale-IA.git
**Objetivo:** SaaS completo para automação, scraping e gestão de postagens de múltiplas contas do Instagram.

---

## Stack Tecnológico

| Camada | Tecnologia |
|--------|-----------|
| Framework | Next.js 15 (App Router) + React + TypeScript |
| Estilização | Tailwind CSS |
| Componentes | Shadcn UI (a instalar) + Framer Motion |
| Backend/BaaS | Supabase (PostgreSQL + Auth + Storage) |
| Scraping | Apify — Actor `apify~instagram-reel-scraper` |
| Vídeo | FFmpeg via `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg` |
| Deploy | Vercel (Next.js) + Railway (FastAPI Python) |

---

## Arquitetura de Pastas

```
AutoScale AI/
├── app/
│   ├── api/
│   │   ├── apify/scrape/route.ts     ← Scraping de Reels via Apify
│   │   └── video/process/route.ts    ← Download + FFmpeg + upload Supabase
│   ├── auth/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx                ← Layout com Sidebar + Header
│   │   ├── page.tsx                  ← Visão geral
│   │   ├── search/page.tsx           ← Pesquisa de Reels
│   │   ├── library/page.tsx          ← Biblioteca de vídeos
│   │   └── schedule/page.tsx         ← Agendamento multi-conta
│   ├── globals.css                   ← Design system (glassmorphism)
│   ├── layout.tsx
│   └── page.tsx                      ← Landing page
├── components/
│   ├── dashboard/
│   │   ├── Sidebar.tsx
│   │   └── Header.tsx
│   └── search/
│       ├── ReelCard.tsx
│       └── ReelGrid.tsx
├── lib/
│   ├── utils.ts                      ← cn() helper
│   ├── supabase.ts                   ← Clientes Supabase (lazy init)
│   ├── ffmpeg-process.ts             ← Pipeline de processamento de vídeo
│   └── python-server.ts              ← Helper HTTP para o servidor FastAPI
├── python_server/
│   ├── main.py                       ← FastAPI: /auth/login, /auth/verify, /posts/publish
│   ├── requirements.txt              ← fastapi, uvicorn, instagrapi
│   └── Dockerfile                    ← Para deploy em Railway/Render/VPS
├── python_scripts/                   ← Scripts legados (fallback local sem FastAPI)
│   ├── instagram_login.py
│   ├── instagram_verify_code.py
│   └── instagram_post.py
├── supabase/
│   ├── schema.sql                    ← Tabelas + RLS
│   └── storage.sql                   ← Bucket videos-library
└── docs/
    └── MEMORIA.md                    ← Histórico de decisões e fases
```

---

## Variáveis de Ambiente

Arquivo: `.env.local` (nunca commitar)

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APIFY_API_TOKEN=

# Fase 16 — Servidor FastAPI (opcional; sem ela, usa child_process local)
PYTHON_SERVER_URL=http://localhost:8000
PYTHON_SERVER_SECRET=

# Fase BYOC — Criptografia de App Secret
ENCRYPTION_SECRET=qualquer-string-secreta-aqui
```

---

## Design System

**Tema:** Dark mode nativo — fundo `#030712` (gray-950)
**Cores brand:** Violet (`#8B5CF6`) + Cyan (`#06B6D4`)
**Estilo:** Glassmorphism — `backdrop-blur`, `bg-white/5`, `border border-white/10`

### Classes utilitárias principais (`globals.css`)

| Classe | Uso |
|--------|-----|
| `.glass` | Painel glassmorphism pesado (backdrop-blur-xl) |
| `.glass-card` | Card glassmorphism médio |
| `.neon-border` | Borda com brilho violet |
| `.gradient-text` | Texto violet → cyan |
| `.btn-primary` | Botão gradiente violet/cyan com hover glow |
| `.btn-ghost` | Botão transparente com borda sutil |
| `.input-glass` | Input glassmorphism com focus violet |

---

## Rotas de API

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/apify/scrape` | POST | Scraping de Reels de um perfil. Body: `{ username }` |
| `/api/video/process` | POST | Download + FFmpeg strip + upload Supabase. Body: `{ videoUrl, filename, reelData }` |
| `/api/library` | GET | Lista vídeos da tabela `videos_library` |
| `/api/library` | DELETE | Remove vídeo do Storage e do banco. Body: `{ id, storage_path }` |
| `/api/schedule` | POST | Cria postagens agendadas. Body: `{ video_id, account_ids, caption, scheduled_at }` |
| `/api/schedule` | GET | Lista postagens agendadas com joins |

**Modo mock:** Sem as variáveis de ambiente configuradas, ambas as rotas retornam dados simulados para desenvolvimento local.

---

## Banco de Dados (Supabase)

### Tabelas

- **`videos_library`** — Vídeos processados e salvos pelo usuário
- **`instagram_accounts`** — Contas do Instagram conectadas
- **`scheduled_posts`** — Postagens agendadas
- **`scraped_profiles`** — Cache de perfis raspados (histórico de Inspirações)

Todas as tabelas têm RLS habilitado. Scripts em `supabase/schema.sql` e `supabase/storage.sql`.

### Storage

- **Bucket:** `videos-library` (público, limite 500 MB por arquivo)
- **Tipos aceitos:** `video/mp4`, `video/quicktime`, `video/webm`

---

## Fases do Projeto

| Fase | Descrição | Status |
|------|-----------|--------|
| **Fase 1** | Setup inicial + Landing Page + Auth UI | ✅ Concluída |
| **Fase 2** | Layout do Dashboard + Sidebar + Rotas | ✅ Concluída |
| **Fase 3** | Pesquisa de Reels + Grid + API Apify | ✅ Concluída |
| **Fase 4** | FFmpeg + Upload Supabase Storage | ✅ Concluída |
| **Fase 5** | Biblioteca de Mídia + Agendamento multi-conta | ✅ Concluída |
| **Fase 6** | Integração real Supabase Auth | ✅ Concluída |
| **Fase 7** | Integração real Apify (scraping real) | ✅ Concluída |
| **Fase 8** | Deploy Vercel + configuração de produção | ✅ Concluída |
| **Fase 9** | Seção Inspirações com apify-client + UI de hover | ✅ Concluída |
| **Fase 11** | Login Instagram via instagrapi + child_process | ✅ Concluída |
| **Fase 12** | Fluxo unificado 2FA e checkpoint para login Instagram | ✅ Concluída |
| **Fase 13** | Correção de modal, layout e loop infinito de renders | ✅ Concluída |
| **Fase 14** | Download real das Inspirações + botão Baixar Todos | ✅ Concluída |
| **Fase 15** | Postagem real no Instagram via instagrapi | ✅ Concluída |
| **Fase 16** | Servidor FastAPI para viabilizar operações Python em produção | ✅ Concluída |
| **Fase 22** | Histórico de pesquisas de Inspirações com cache no Supabase | ✅ Concluída |
| **Fase 19** | Dashboard overview com dados reais do Supabase | ✅ Concluída |
| **Fase 20** | Deploy do servidor FastAPI no Railway + correções de login Instagram em produção | ✅ Concluída |
| **Fase 25** | Página de Contas refatorada: grid de cards + dados em tempo real via Apify | ✅ Concluída |
| **Fase 26** | Página de Postagens: agendamento em massa com distribuição inteligente por lotes | ✅ Concluída |
| **Fase 27** | Migração para Meta Graph API: OAuth oficial, abandono do instagrapi para conexão de contas | ✅ Concluída |
| **Fase 28** | Publicação de posts via Meta Graph API: roteamento automático Meta vs instagrapi por conta | ✅ Concluída |
| **Fase 29** | Refresh automático de token Meta: renovação preventiva em < 7 dias, badge de expiração na UI | ✅ Concluída |
| **Fase 30** | Executor de posts agendados: Vercel Cron Job horário com claim atômico e auto-refresh de token | ✅ Concluída |
| **Fase 31** | Gestão de agendamentos: lista real por status, cancelar/reagendar/remover, auto-refresh durante publicação | ✅ Concluída |
| **Fase 32** | Analytics de posts publicados: métricas reais via Meta API (curtidas, comentários, alcance, plays, shares, salvos), página dedicada com cards de resumo e botão Atualizar por post | ✅ Concluída |
| **Fase 33** | Múltiplos Meta Apps: suporte a N apps via env vars `META_APP{N}_*`, modal de seleção no frontend, state codificado com app_id para CSRF + rastreabilidade, coluna `meta_app_used` no banco | ✅ Concluída |
| **Fix** | Correção da URL OAuth do Instagram Login: `URLSearchParams` codificava vírgulas do scope como `%2C`, causando 404. Substituído por concatenação manual com `encodeURIComponent` apenas em `redirect_uri` e `state` | ✅ Aplicado |
| **Refactor** | Migração completa para Instagram Login API (`api.instagram.com`): client_id via `NEXT_PUBLIC_INSTAGRAM_APP_ID`, remoção do fluxo Facebook OAuth (`meta/auth`, `meta/callback`, `meta/connect-token`, `meta/apps`, `lib/meta-apps.ts`), cookie de state via `NextResponse.cookies.set()` | ✅ Aplicado |
| **Fase 34** | Admin Dashboard base: tabela `user_roles` no schema com trigger automático, layout sidebar protegido (redireciona não-admin para `/dashboard`), páginas Visão Geral + Usuários + Contas Conectadas + Suporte, API `/api/admin/accounts` | ✅ Concluída |
| **Fase 34b** | Admin ações: PATCH `/api/admin/users/[userId]` (ban/unban/promover/rebaixar), DELETE `/api/admin/accounts/[accountId]` (revogar conta); UI com confirmação inline de dois cliques; protege automodificação de role | ✅ Concluída |
| **Fase 34c** | Navegação admin: redirecionamento inteligente no login (admin→`/admin`, user→`/dashboard`), mesmo no callback OAuth; botão "Painel Admin" na Sidebar do dashboard visível apenas para admins | ✅ Concluída |
| **Fase 34d** | Admin Contas: refatoração para accordion agrupado por usuário com animação framer-motion; API retorna `{ users: [...] }` com contas aninhadas; revogar remove linha do usuário se ficar vazio | ✅ Concluída |
| **Fase 35a** | Stories Ativos no Dashboard: `GET /api/instagram/stories` chama `graph.facebook.com/v19.0/{id}/stories?fields=id,timestamp`; integrado ao `/api/dashboard/stats`; card âmbar com countdown de expiração (24h rule) | ✅ Concluída |
| **Fase 35b** | Fluxo de aprovação manual: coluna `account_status` (`pending`/`approved`/`banned`) em `user_roles` (default `pending`); dashboard layout bloqueia pending → `/pending`; admins isentos; página `/pending` com glassmorphism; Admin Usuários com highlight âmbar, badge de contagem e botão Aprovar | ✅ Concluída |
| **Fase 36 (BYOC)** | Bring Your Own Credentials: tabela `user_meta_apps` com App ID + App Secret (AES-256-GCM via `ENCRYPTION_SECRET`); página `/dashboard/apps` para CRUD; OAuth `/api/instagram/auth` aceita `?appId=`, lê credenciais do DB; callback lê cookie `ig_oauth_app_id`, decripta; página Contas: 0 apps → redireciona para /apps, 1 app → auto, 2+ apps → modal seletor; fallback para env var global se sem cookie de app | ✅ Concluída |

**SQL pendente (executar no Supabase):**
```sql
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'pending'
  CHECK (account_status IN ('pending', 'approved', 'banned'));
UPDATE public.user_roles SET account_status = 'approved';

-- Fase BYOC
CREATE TABLE IF NOT EXISTS public.user_meta_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_name text NOT NULL,
  ig_app_id text NOT NULL,
  ig_app_secret text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_meta_apps_user_id_idx ON public.user_meta_apps(user_id);
ALTER TABLE public.user_meta_apps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_meta_apps" ON public.user_meta_apps
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

**Env vars novas a adicionar na Vercel:**
- `ENCRYPTION_SECRET` — qualquer string secreta (será hashed com SHA-256 para chave AES-256)

---

## Diretrizes para o Claude

- Sempre verificar o build (`npm run build`) ao final de cada fase antes de commitar
- Nunca commitar `.env.local`, `node_modules/`, `.next/`, `.claude/`, `.obsidian/`
- Manter o padrão de inicialização lazy para clientes Supabase (evita erros no build)
- Usar `serverExternalPackages` no `next.config.ts` para pacotes com binários nativos (ffmpeg)
- Commitar por fase com mensagens descritivas em português
- Ao terminar cada fase: atualizar o status em `CLAUDE.md` e `docs/MEMORIA.md`, depois commitar e fazer push
- Rodar sempre de dentro de `C:\Users\Recepção\Documents\AutoScale IA`
- Branch principal: `main` no remote `origin`
