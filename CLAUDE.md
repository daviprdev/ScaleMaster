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
│   │   ├── Header.tsx
│   │   ├── DashboardShell.tsx        ← Client component — estado mobile sidebar
│   │   ├── ParticleBackground.tsx
│   │   ├── ImpersonationBanner.tsx
│   │   └── AnnouncementBanner.tsx
│   ├── inspirations/
│   │   ├── InspirationCard.tsx
│   │   └── InspirationGrid.tsx
│   ├── search/
│   │   ├── ReelCard.tsx
│   │   └── ReelGrid.tsx
│   ├── WireframeTerrain.tsx          ← Canvas 3D: terrain padrão (matrix green/cyan)
│   ├── TopographyBackground.tsx      ← Fundo topografia alternativo
│   ├── ParticlesBackground.tsx       ← Fundo partículas alternativo
│   ├── BeamsBackground.tsx           ← Fundo feixes de luz alternativo
│   ├── BackgroundController.tsx      ← Seletor flutuante de modo de fundo
│   └── BackgroundContext.tsx         ← Context global do modo de fundo
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

**Tema:** Cyber-Military Elite — fundo `#000000` puro
**Cores brand:** Matrix Green (`#00FF41`) + Electric Cyan (`#00E5FF`)
**Estilo:** Glassmorphism agressivo — `backdrop-blur-[22px]`, `bg-black/45`, `border border-white/10`

### Tokens CSS (`globals.css`)

```css
--matrix:    #00FF41   /* Verde neon — cor primária de destaque */
--electric:  #00E5FF   /* Ciano elétrico — cor secundária */
--background: #000000  /* Fundo puro */
--surface:   rgba(0,0,0,0.45)
```

### Classes utilitárias principais (`globals.css`)

| Classe | Uso |
|--------|-----|
| `.glass` | Painel glassmorphism pesado (backdrop-blur-[28px]) — modais |
| `.glass-card` | Card glassmorphism médio (backdrop-blur-[22px]) — cards padrão |
| `.ticks` | Miras táticas nos 4 cantos do card (::before pseudo-element) |
| `.neon-border` | Borda matrix green com glow |
| `.gradient-text` | Texto matrix → electric |
| `.btn-primary` | Botão com borda animada conic-gradient (border-spin 5s) |
| `.btn-ghost` | Botão transparente com hover matrix green |
| `.input-glass` | Input com focus matrix green glow |
| `.metric-value` | Número com 3 camadas de glow neon (electric) |
| `.neon-matrix` | Texto matrix green com text-shadow trifásico |
| `.neon-electric` | Texto electric cyan com text-shadow trifásico |
| `.page-title` | Título de página (Space Grotesk, 1.5rem, tracking tight) |
| `.page-subtitle` | Subtítulo de página (text-secondary, 0.875rem) |

### Backgrounds disponíveis

| Componente | Modo | Descrição |
|-----------|------|-----------|
| `WireframeTerrain` | `terrain` (padrão) | Canvas 3D com grid 56×28, ondas seno, glow radial no horizonte |
| `TopographyBackground` | `topography` | Curvas de nível animadas |
| `ParticlesBackground` | `particles` | Partículas flutuantes |
| `BeamsBackground` | `beams` | Feixes de luz lineares |

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
| `/api/logins` | GET/POST/DELETE | Cofre de credenciais de login (Logins Vault) |
| `/api/queue/stats` | GET | Estatísticas da fila de publicação em tempo real |
| `/api/failover/accounts` | GET/PATCH/PUT | Gerenciar health e prioridade de contas para failover |
| `/api/failover/logs` | GET | Histórico de eventos de failover |
| `/api/proxy-download` | GET/HEAD | Proxy de vídeo seguro (streaming puro, allowlist SSRF, iPhone UA) |
| `/api/proxy-sanitize-download` | GET | Proxy com duplo passe FFmpeg: strip total + UUID + bitexact antes de entregar ao browser |

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
| **Fase 37** | Estrutura de Pastas na Biblioteca: tabela `library_folders` com RLS, coluna `folder_id` em `videos_library` (ON DELETE SET NULL), CRUD de pastas via API, navegação breadcrumb, cards de pasta com gradientes, modal Nova Pasta, modal Mover Vídeo, upload ciente da pasta ativa, botão Mover no VideoCard | ✅ Concluída |
| **Fase 38 (Loop)** | Módulo de Looping: tabelas `loops` + `loop_accounts` (N:N) com RLS e trigger `updated_at`, sidebar reorganizada em grupos, UI `/dashboard/loop` com lista de loops + modal de criação/edição, multi-select de contas, seletor de pasta da Biblioteca, toggle infinito/ciclos, slider de intervalo (10–1440 min), captions dinâmicas, upload de capa, toggles espelho/invert | ✅ Concluída |
| **Fase 39 (Loop Cron)** | Motor de execução de loops: `GET /api/cron/process-loops` com autenticação `CRON_SECRET`, seleção round-robin de vídeos por `last_media_index`, legenda aleatória, auto-refresh de token Meta, `processVideoEffects` stub com documentação de arquitetura futura (Worker dedicado), atualização de `cycles_done` + status `completed`, colunas novas `last_posted_at`/`last_media_index`/`cycles_done` via migration SQL, `vercel.json` com cron `*/10 * * * *` | ✅ Concluída |
| **Pipeline Cron Duas Fases** | Refatoração do motor para evitar timeout Vercel: `process-loops` agora só cria containers Meta (Fase 1, `*/15 * * * *`); novo `publish-pending` verifica status e publica os prontos (Fase 2, `*/5 * * * *`); tabela `pending_containers` persiste `creation_id` entre invocações; `vercel.json` configurado com ambos os crons; 3 novos exports em `lib/meta-publish.ts` | ✅ Concluída |
| **Fase 40 (Postar)** | Página de postagem única `/dashboard/postar`: tabelas `single_posts` + `single_post_accounts` com RLS, API `POST /api/posts/create` (publicação imediata via Meta API ou agendamento), UI split-layout com formulário à esquerda + phone mockup ao vivo à direita, drag-and-drop + seletor de Biblioteca, multi-select de contas com chips, textarea caption+primeiro comentário com contador de chars, tipo Reel/Feed/Story, toggle Publicar Agora vs Agendar com datetime picker, primeiro comentário via Graph API comments | ✅ Concluída |
| **Fix Admin** | Correção de aprovação: `.update().select()` detecta 0 rows + fallback insert; `revalidatePath('/admin/users')` + `export const dynamic = 'force-dynamic'`; impersonação server-side: `generateLink` → `verifyOtp({ token_hash })` nos cookies da NextResponse — elimina dependência de Allowed Redirect URLs do Supabase | ✅ Aplicado |
| **Perf** | 15 indexes SQL em FKs e colunas filtradas (`supabase/performance_indexes.sql`); filtro de pasta server-side em `/api/library`; DELETE paralelo via `Promise.all`; fetches paralelos no loop page; `export const dynamic = 'force-dynamic'` em rotas com cookies | ✅ Aplicado |
| **Fase 41 (Horário Humano)** | Anti-shadowban: tabela `human_schedule_settings` (upsert por user_id), página `/dashboard/human-schedule` com relógio ao vivo (Intl.DateTimeFormat, atualização 1s), toggle, janela de tempo customizável, 3 presets (Comercial/Noturno/Pleno dia), seletor de timezone agrupado, auto-save com debounce 1.2s; integrado ao `/api/cron/process-loops` — loops fora da janela são pulados | ✅ Concluída |
| **Fase 42 (Mobile)** | Dashboard totalmente responsivo: `DashboardShell` (client component) gerencia estado `mobileOpen`; `Header` com hamburger + logo strip (`md:hidden`); `Sidebar` com `hidden md:flex` + drawer slide-in 280px via portal (AnimatePresence, backdrop semi-transparente, fecha ao clicar em link); `overflow-x-auto` na tabela de apps | ✅ Concluída |
| **Fase 43 (Failover)** | Sistema de redundância automática: colunas `health_status` + `failover_priority` em `instagram_accounts`; tabela `failover_logs` com RLS; APIs `/api/failover/accounts` (GET/PATCH/PUT) e `/api/failover/logs` (GET); lógica no cron `process-loops` — erro crítico Meta → marca conta como `error` → busca próxima conta `online` por prioridade → tenta publicar → registra em `failover_logs`; UI `/dashboard/failover` com lista reordenável (setas ↑↓), badges de saúde (Online/Erro/Bloqueada), botão Restaurar, histórico de eventos com timeline | ✅ Concluída |
| **Queue Dashboard** | Página `/dashboard/queue` com status da fila em tempo real: auto-refresh a cada 10s, métricas de posts pendentes/publicando/falha, tabela de jobs recentes com timestamp e status animado | ✅ Concluída |
| **Loop Media Limit** | Opção de limite máximo de vídeos por loop: campo `media_limit` na tabela `loops`, slider na UI de criação/edição, integrado ao motor do cron (para quando `cycles_done >= media_limit`) | ✅ Concluída |
| **Design System Cyber-Military Elite** | Redesign completo de toda a UI: paleta matrix green (`#00FF41`) + electric cyan (`#00E5FF`) no lugar de violet/cyan anterior; fundo `#000000`; componente `WireframeTerrain` (canvas 3D 56×28 com perspectiva e ondas seno), `BackgroundController` (seletor flutuante de 4 modos: Terrain/Topography/Particles/Beams), `BackgroundContext` (estado global de modo de fundo), `ParticlesBackground` e `BeamsBackground`; `.ticks` com miras táticas nos cantos dos cards; `.metric-value` com glow neon trifásico; `globals.css` reescrito com novos tokens CSS | ✅ Concluída |
| **Logins Vault** | Página `/dashboard/logins` com cofre seguro de credenciais de login: lista de contas salvas, formulário de adição, ações de cópia e remoção; rota API `GET/POST/DELETE /api/logins`; UI com glassmorphism e design Cyber-Military | ✅ Concluída |
| **Login Simplificado** | Formulário de login `/auth/login` refatorado para solicitar apenas `username` (sem email); lógica de autenticação adaptada | ✅ Concluída |
| **Inspirações (Fase Nova)** | Página `/dashboard/inspirations` reconstruída do zero com design Cyber-Military Elite: header com ícone `Sparkles`, barra de busca com `backdrop-blur-xl` e foco neon verde, cards mockup com `.ticks` e botão "Adicionar à Biblioteca" com glow, cards de histórico redesenhados, modal de importação com progress bar matrix/electric; toda lógica de scraping real mantida via `/api/inspirations/scrape` e `/api/inspirations/history`; link "Inspirações" adicionado na Sidebar (seção CONTEÚDOS) | ✅ Concluída |
| **Download local de Reels** | Downloads de Inspirações salvam MP4 localmente no dispositivo via `/api/proxy-sanitize-download`: duplo passe FFmpeg (Pass 1: strip total `-map_metadata -1`, Pass 2: UUID + `-fflags +bitexact`) antes de enviar ao browser; HEAD validation rápida via `/api/proxy-download`; User-Agent iPhone para bypassar 403 do CDN Instagram; streaming proxy com allowlist SSRF; `InspirationCard` com toasts inline AnimatePresence (Iniciando/Concluído) | ✅ Concluída |
| **Fase 44 (Campanhas)** | Gerenciamento de campanhas em lote na página Postar: coluna `campaign_id` UUID em `scheduled_posts` (fallback gracioso se migration não aplicada), API `GET/DELETE /api/campaigns` (agrupa posts por campaign_id, retorna progresso, cancela pendentes), UI em tabs "Criar Campanha" / "Campanhas Ativas" com cards de progresso (barra animada, badges de status 🟢/⚫, avatares de contas, próximo disparo), confirmação de 2 cliques para excluir, auto-refresh 15s quando há campanhas executando, notificação inline após criação | ✅ Concluída |

**SQL pendente (executar no Supabase):**
```sql
-- Fase 43 — Failover (executar supabase/failover.sql)
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'online'
    CHECK (health_status IN ('online', 'error', 'blocked')),
  ADD COLUMN IF NOT EXISTS failover_priority integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.failover_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  failed_account_id uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  backup_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  error_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.failover_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_failover_logs" ON public.failover_logs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

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

-- Fase 44 — Campanhas (campaign_id em scheduled_posts)
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS campaign_id uuid;
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_campaign_id ON public.scheduled_posts(campaign_id);
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
