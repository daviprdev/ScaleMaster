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
| **Fix — Intervalo por lote (não por conta)** | Bug crítico de lógica no agendamento em massa: o tempo avançava por conta em vez de por lote. Refatoração do loop em `schedule/route.ts` — outer loop por slot de tempo, inner loop serve TODAS as contas (×`batch_size` vídeos) antes de avançar `slotIndex`. Frontend atualizado: `postsPerSlot = contas × batchSize` como divisor nos cálculos de `CampaignPreview`, `previewSlots` e resumo dinâmico | ✅ Aplicado |
| **Fix — Stories API: host errado na Graph API** | `active_stories_count` travado em 0 porque `accounts/stories/route.ts` e `instagram/stories/route.ts` usavam `graph.facebook.com/v19.0` (Facebook Login API). Instagram Login API tokens só autenticam em `graph.instagram.com/v21.0`. Corrigido em ambas as rotas + `accounts/refresh` agora busca stories em paralelo via `Promise.allSettled` e persiste `active_stories_count` com fallback gracioso para coluna ausente | ✅ Aplicado |
| **Style — Overflow nos cards de conta** | Rodapé de métricas dos cards em `/dashboard/accounts` cortava o último item (ex: "1 sto..."). `overflow-x-auto no-scrollbar` não funcionava no desktop (sem scroll wheel horizontal). Substituído por `flex flex-wrap gap-x-3.5 gap-y-2`; labels encurtados: `"sincronizado"→"sync"`, `"expira em"→"exp."` | ✅ Aplicado |
| **Feat — Badge de erro de token na aba Logins** | API `/api/logins` agora inclui `health_status` no cross-reference com `instagram_accounts` e retorna `meta_status: "connected" \| "error" \| "not_connected"` (substitui `is_connected: boolean`). `LoginCard` exibe três estados: 🟢 Conectada / ⚪ Não Conectada / 🔴 Token Inválido (badge pulsante + borda vermelha + faixa de alerta com instrução de reconexão) | ✅ Aplicado |
| **Chore — Limpeza de posts fantasmas + cache do dashboard** | Posts órfãos de campanhas antigas deletados via REST API do Supabase (0 pendentes restantes). Novo `POST /api/posts/clear-pending` para hard-reset da fila (usuário-escoped). Dashboard refatorado: `loadStats()` como `useCallback`, auto-refresh a cada 60s, `cache: "no-store"` nos fetches, botão "Atualizar" manual, botão "Limpar Fila" com 2 cliques no card Próximas Postagens. `export const dynamic = "force-dynamic"` adicionado ao `/api/dashboard/stats` | ✅ Aplicado |
| **Pastas de Contas** | CRUD completo de pastas/clientes na tela Contas: tabela `account_folders` + coluna `folder_id` em `instagram_accounts` (FK ON DELETE SET NULL); APIs `GET/POST /api/accounts/folders` e `PATCH/DELETE /api/accounts/folders/[id]`; UI com tabs horizontais (Todas + por pasta), botão engrenagem na pasta ativa → modal Renomear + dialog Excluir com aviso de desvinculação, botão Nova Pasta, opção "Mover para" no menu ⋯ de cada conta com lista de pastas + "Sem pasta"; atualizações otimistas sem F5 | ✅ Concluída |
| **Fix — Dropdown "Mover para pasta" invisível em contas legadas** | Framer Motion `layout` prop aplica CSS `transform` em cada `AccountCard`, criando um stacking context por card. Dropdown de Card A (z-index: 30 dentro do contexto de A) ficava pintado atrás de Cards B/C (DOM posterior, stacking contexts próprios). Fix: `style={{ position: "relative", zIndex: menuOpen ? 10 : "auto" }}` no `motion.div` do card + `z-[200]` e `min-w-[180px]` no dropdown | ✅ Aplicado |
| **Feat — Aba "Sem Pasta" na tela Contas** | Primeira tab renomeada de "Todas" para "Sem Pasta"; filtra `accounts.filter(a => a.folder_id === null)` em vez de mostrar todas; contador dinâmico mostra só contas não atribuídas; ao mover conta para pasta ela some imediatamente da aba via atualização otimista de state; empty state diferencia "nenhuma conta" (ícone Instagram + botão conectar) de "todas em pastas" (✓ verde + mensagem positiva) | ✅ Aplicado |
| **Hotfix — FFmpeg timeout no download de Inspirações** | `sanitizeDoublePass` (`utils/videoSanitizer.ts`): Pass 2 revertido de libx264 CRF 20 + noise para **stream copy + UUID + bitexact** — elimina re-encode bloqueante na função serverless, zerando o Erro 500 na Vercel. `sanitizeAndHashBust` e `downloadAndStripMetadata`: `-preset fast` → `-preset ultrafast`. Re-encode com noise permanece apenas em operações de background da Library onde não há timeout de browser. | ✅ Aplicado |
| **Fix — Queue Worker: caption vazia + fila travada após Smart Remux** | `process-loops`: `processVideoEffects`, `containerAlreadyExists` e `accountPostedRows` eram chamados fora do try/catch por conta — qualquer exceção propagava para fora do loop inteiro, atualizando `last_posted_at` (CLAIM) sem criar containers, travando o loop até o próximo intervalo. Fix: try/catch unificado por conta envolve TODAS as operações async; `selectedVideo`/`caption`/`videoUrl` declarados antes do try para ficar acessíveis no catch. `videoUrl` usa `selectedVideo.public_url` como fallback se `processVideoEffects` retornar vazio. Outer try/catch por loop impede que um loop com erro bloqueie os demais. `recordContainerError` corrigido para usar `video_id: videoId \|\| null` (evita violação da constraint UUID quando não houve seleção de vídeo). `publish-pending`: guard para `creation_id` vazio descarta containers inválidos imediatamente. `meta-publish`: `safeCaption` garante que `undefined` nunca chegue ao `URLSearchParams` como string literal `"undefined"`; log de auditoria antes de cada chamada à Meta API. | ✅ Aplicado |
| **Fix — Encoding de caption na criação do container Meta API** | `URLSearchParams` codificava espaços como `+` (padrão form-encoded), mas a Meta Graph API descartava silenciosamente captions com quebras de linha, emojis ou aspas nesse formato, gerando posts sem legenda. Substituído por body construído com `encodeURIComponent` (RFC 3986: espaços como `%20`, newlines como `%0A`); `Content-Type: application/x-www-form-urlencoded` adicionado explicitamente; caption omitida do payload quando vazia (evita `caption=`); trim + limite de 2200 chars aplicados antes de enviar; log `ENVIANDO LEGENDA PARA A META:` imediatamente antes da requisição HTTP. Em `process-loops`: log do raw value do banco antes de `buildCaptionPool` (`captions RAW do banco:`) para confirmar que o array chega correto do Supabase. | ✅ Aplicado |
| **Fix — Mapeamento de legenda do Loop (não do vídeo)** | Legenda vem EXCLUSIVAMENTE de `loops.captions` (text[] configurado pelo usuário no painel). `videos_library.caption` é sempre NULL para reels raspados e NUNCA é lido pelo worker. Correções: API POST loops normaliza captions com `trim().filter(Boolean)` antes do INSERT + `console.warn` se array vazio; API PATCH loops tem branch dedicado que normaliza e avisa em update para array vazio; frontend inicializa o form de edição com `Array.isArray(editingLoop.captions)` guard (previne crash `null.length` em loops legados). | ✅ Aplicado |
| **Refactor — Dynamic Caption Selection (Spintax)** | `buildCaptionPool` + `pickCaption` consolidados em `selectDynamicCaption(rawCaptions: string[]): string` — função nomeada que é o ponto de entrada único para seleção de legenda dinâmica no Loop. Pool: trim + filter de entradas em branco; sorteio aleatório entre variações válidas (Spintax); retorna `""` se pool vazio. Log `[dynamic-caption]` por conta mostra pool size e qual variação foi selecionada com índice. `[loop-cron]` outer log exibe `validCaptionCount` (pós-normalização) e raw DB slice para diagnóstico imediato nos logs da Vercel. | ✅ Aplicado |
| **Refactor — Pure Stream Extraction (anti-shadowban)** | Vídeos recebiam shadowban instantâneo (1–5 views) porque o FFmpeg sem `-map` copiava TODOS os streams por padrão — incluindo data streams, SEI custom atoms e trilhas de telemetria dos CDNs do Instagram/TikTok que a Meta API detecta como fingerprint de conteúdo copiado. Substituído em todos os 3 pontos (`lib/ffmpeg-process.ts` → `downloadAndStripMetadata`, `utils/videoSanitizer.ts` → `sanitizeAndHashBust` e `sanitizeDoublePass`) pelo pipeline de Pure Extraction: `-map 0:v:0 -map 0:a:0? -c:v copy -c:a copy -map_metadata -1 -map_chapters -1 -movflags +faststart -f mp4`. Zero re-encode — stream copy preserva 100% do perfil H.264/AAC. | ✅ Aplicado |
| **Fix — Auditoria de Banda: 10 GB Fast Origin Transfer (Vercel Hobby)** | Diagnóstico: o pipeline de postagem (cron `process-loops` + `publish-pending` + `posts/create`) já passava apenas `video_url` à Meta Graph API — zero bytes de vídeo por Vercel. Causa real: cada download de inspiração via `/api/proxy-sanitize-download` roteava ~2× o tamanho do vídeo (download do CDN + envio ao browser), ~100 MB por reel. Fix: URLs do Supabase Storage (`*.supabase.co`) em ambas as rotas de proxy agora retornam HTTP 307 redirect direto ao CDN — zero bytes pela Vercel. HEAD de URLs Supabase retorna 200 instantâneo sem fetch remoto. Log de MB por download adicionado para monitorar consumo futuro. FFmpeg confirmado como rodando apenas no `save-to-library` (uma vez por vídeo). Commit `54c6361`. | ✅ Aplicado |
| **Chore — X-Ray Logs: Diagnóstico Roleta Russa de Legendas** | Comportamento: lotes com postagem inconsistente de legendas (algumas contas com todas, outras sem nenhuma, outras parcial). Blindagens injetadas: (1) `Object.freeze(loopCaptionsRaw)` em `process-loops` — mutação destrutiva (`.pop()/.shift()/.splice()`) lança TypeError imediatamente; (2) log estendido com `type + isArray + rawLen` de `loop.captions` antes do parse para detectar perda silenciosa de variações; (3) `[RAIO-X]` pós-sorteio por conta: pool size + caption sorteada ou `VAZIA!!!`; (4) `[RAIO-X-FINAL]` mostra caption final persistida no container; (5) `[RAIO-X]` em `publish-pending` antes do double-tap: caption armazenada no banco + chars + status; (6) `[META DOUBLE-TAP RAW]` em `updatePostCaption`: resposta RAW completa (sem slice) + HTTP status + detecção inline de `rate_limited=SIM!!!` e `oauth_err=SIM!!!`. Commit `54bf456`. | ✅ Aplicado |
| **Fix — OAuth Instagram: conexão de contas funcionando** | Raiz: commit de scopes (`instagram_manage_comments`, `instagram_manage_insights`) adicionou scopes do Facebook Login no endpoint do Instagram Login API, causando "Invalid platform app". Correções em 3 commits: (1) URL OAuth revertida para `api.instagram.com/oauth/authorize`; (2) scopes trocados pelos equivalentes corretos da Instagram Business Login API (`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`); (3) env vars alinhadas com `NEXT_PUBLIC_META_CLIENT_ID` / `META_CLIENT_SECRET` (o código buscava nomes errados `NEXT_PUBLIC_INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`); (4) redirect URI `https://autoscale-ia.vercel.app/api/instagram/callback` cadastrada no Meta Developer Console em Instagram Business Login → Valid OAuth Redirect URIs. Fluxo completo funcional: tela de login Instagram → `api.instagram.com/oauth/access_token` → `graph.instagram.com/access_token?grant_type=ig_exchange_token` → `graph.instagram.com/me`. | ✅ Aplicado |
| **Fix — Loops paralelos + crons restaurados** | `process-loops` e `publish-pending` estavam faltando no `vercel.json` — crons não disparavam automaticamente. `process-loops` refatorado: loop sequencial `for (const loop of eligible)` substituído por `Promise.allSettled(eligible.map(processOneLoop))` — múltiplos loops rodam em paralelo, eliminando gargalo em cascata. Jitter inter-conta reduzido de 3–15s para 2–7s. `processOneLoop` extraída como função nomeada. | ✅ Aplicado |
| **Fix — Lock atômico pending→publishing (double-publish)** | Race condition: duas invocações concorrentes do `publish-pending` (cron */5) liam os mesmos containers `pending` e publicavam o mesmo reel duas vezes. Fix: antes de `publishReadyContainer`, UPDATE atômico `status='publishing' WHERE status='pending'` — PostgreSQL row-level lock garante que apenas uma invocação vença. Status `publishing` adicionado ao CHECK constraint (`supabase/pending_containers_publishing_status.sql`). AUTO-HEALING estendido para limpar `publishing` stuck >30 min. Erros transitórios (`too many actions`, `unexpected error`) resetam `publishing→pending` para retry automático em 5 min. Delay de 2s entre publishes anti-burst adicionado. | ✅ Aplicado |
| **Fix — Double-tap caption com delay+retry** | `updatePostCaption` chamado imediatamente após publish causava descarte silencioso pela Meta (Reel ainda sendo finalizado). Fix: delay de 4s antes do double-tap + retry automático (2 tentativas, intervalo 6s). Log explícito quando ambas as tentativas falham. Diagnóstico de qualidade de vídeo: `file_size` incluído na query de vídeos em `process-loops`, alerta quando < 2 MB. | ✅ Aplicado |
| **Feat — Motor de Efeitos de Vídeo (6 efeitos reais)** | `lib/video-effects.ts` (novo): `applyVideoEffects()` — download → FFmpeg libx264 ultrafast → upload `temp/` Supabase → retorna URL processada. 6 efeitos: hflip (espelhar), negate (inverter cores — antes stubs inoperantes), zoom +15% (`scale=115%` + crop centrado), smartblur leve (`lr=1 ls=0.25`), ruído temporal (`c0s=3 t+u`), anti-IA (micro-eq determinístico por account_id via FNV-1 hash — cor única por conta). `process-loops` substitui stub por chamada real. UI loop: 4 toggles novos (ZoomIn, Droplets, Waves, Shield) + badges no card. SQL: 4 colunas novas na tabela loops. | ✅ Concluída |
| **Fix — Backoff exponencial no publish-pending (retry storm)** | `publish-pending`: troca reset imediato para "pending" por backoff exponencial (10→20→40→60 min cap) ao receber "too many actions" da Meta. Novas colunas `retry_count` + `retry_after` em `pending_containers`; query filtra `retry_after IS NULL OR retry_after <= now`; delay anti-burst elevado 2s→8s; limit por run 10→5. Auto-healing atualizado para excluir containers em backoff (`OR retry_after.is.null,retry_after.lte.now`). Elimina retry storm que travava 20+ contas por horas a cada noite. SQL: `supabase/pending_containers_backoff.sql` (já aplicado). | ✅ Aplicado |
| **Fix — comment_enabled obrigatório no double-tap** | Meta API passou a exigir `comment_enabled=1` no endpoint `POST /{media-id}` (atualização de legenda pós-publicação). Sem ele, todas as 3 tentativas do double-tap retornavam HTTP 400 `"The parameter comment_enabled is required."`. Adicionado em `updatePostCaption` em `lib/meta-publish.ts`. | ✅ Aplicado |
| **Fix — process-loops auto-healing respeita retry_after** | Auto-healing do `process-loops` matava containers em backoff intencional (status=pending, retry_after futuro) por estarem >30 min em pending — reiniciando o ciclo. Adicionado `.or('retry_after.is.null,retry_after.lte.now')` na query de healing para excluir containers aguardando recuperação do rate-limit. | ✅ Aplicado |
| **Fix — Seleção aleatória de vídeo no loop** | Motor de loops sempre pegava `available[0]` (primeiro da lista por `created_at`): ao criar novo loop com a mesma pasta, a sequência de vídeos era idêntica à anterior. Substituído por `available[randomIdx]` (índice aleatório). Resultado: cada ciclo e cada novo loop possuem ordem de vídeos embaralhada. O histórico de vídeos postados continua por `loop_id` — novo loop começa do zero com todos os vídeos disponíveis, mas em sequência diferente. | ✅ Aplicado |
| **Fix — Contas com erro crítico excluídas do loop + jitter no backoff** | Sessão 2026-06-05. Contas como `leticiafreitas923` (328 erros acumulados) e `catiamartaneves` com "Unsupported request - method type: post" (conta pessoal sem suporte à API de Reels) continuavam sendo incluídas em todo ciclo do loop, gerando centenas de containers de erro que consumiam o rate-limit da Meta e travavam contas saudáveis. Correções: `isCriticalMetaError` expandido com `"unsupported request - method type: post"`, `"not a confirmed user"` e `"sessions for the user are not allowed"`; `process-loops`: `validAccounts` agora filtra `health_status !== 'error'`; ao falhar com erro crítico Meta, conta é marcada automaticamente como `health_status='error'`; `publish-pending`: jitter no backoff aumentado de 0–5 para 0–20 min (evita que todos os containers do batch saiam do backoff ao mesmo tempo). DB: 5 contas marcadas como `health_status='error'` via SQL direto. | ✅ Aplicado |
| **Fix — `accounts/refresh` + `sync-all` sobrescreviam `health_status='online'`** | Bug crítico: toda sincronização de perfil bem-sucedida incluía `health_status: "online"` no UPDATE, desfazendo marcações de erro feitas pelo cron (ex: conta pessoal sem suporte à API continuava sendo tentada indefinidamente). Removido `health_status` do payload de update em ambas as rotas — health status passa a ser gerenciado exclusivamente pelo pipeline de cron e pelo botão "Restaurar" da UI de Failover. | ✅ Aplicado |
| **Feat — AccountHealthBanner no dashboard** | Banner vermelho no topo do dashboard que aparece quando há contas com `health_status='error'`. Busca server-side no layout, categoriza por tipo de erro (conta pessoal sem API / token inválido / desconhecido), exibe lista expansível com link para Failover, dispensável por sessão via `sessionStorage`. Componente: `components/dashboard/AccountHealthBanner.tsx`. | ✅ Concluída |
| **Fix — Thundering herd: stagger inicial de 2min/conta no process-loops** | Causa raiz do travamento geral de todas as contas: `process-loops` criava 25 containers em ~3 segundos. Ficavam prontos na Meta simultaneamente → `publish-pending` tentava publicar todos em ~45s → "User is performing too many actions" (rate-limit por app) em 100% dos containers → todos entram no mesmo backoff → saem juntos → rate-limit de novo → ciclo infinito. Fix: `createContainerForAccount` recebe `initialDelayMinutes = i * 2` (conta[0]=imediato, conta[1]=+2min, conta[24]=+48min), persistido como `retry_after` no INSERT. Com `publish-pending` a cada 2min, exatamente 1 container é publicado por run — nunca acima do rate-limit. `CONTAINER_TTL_MS` elevado de 30 → 90 min em ambos os crons para não matar containers com atraso inicial. Auto-healing de `process-loops` também ajustado para 90 min. | ✅ Aplicado |
| **Feat — Monitor de Postagens (`/dashboard/monitor`)** | Nova página de monitoramento visual do pipeline de Loop. API `GET /api/loop/monitor` retorna: status por conta (último post, próximo agendamento, retry_count, erro), métricas agregadas (publicados 24h, pendentes, erros, countdown próxima postagem, loops ativos), timeline com pontos publicados (6h atrás) e agendados (3h à frente). UI: 5 metric cards com countdown ao vivo; linha do tempo interativa com hover; lista "próximas na fila" com chips; grid de cards por conta com dot de status no avatar, erro expansível, timeIn/timeAgo; abas de filtro (Todas/Publicado/Aguardando/Erro/Inativo); auto-refresh 15s. Link "Monitor" (ícone Radar) adicionado na Sidebar entre Loop e Status da Fila. | ✅ Concluída |
| **Fix — Dropdown de pasta (position:fixed)** | Gear button nas tabs de pasta da aba Contas usava `position:absolute` e ficava invisível pois o container tem `overflow-x-auto`. Fix: captura `getBoundingClientRect()` do botão no clique e usa `position:fixed` com coordenadas calculadas. `folderMenuPos` state adicionado. | ✅ Aplicado |
| **Feat — Loop: seleção de contas redesenhada** | `AccountsMultiSelect` em `/dashboard/loop` substituído por layout inline sem dropdown: seções por pasta como blocos clicáveis (seleciona pasta inteira), contas como chips compactos `@username`. Ignora contas sem `folder_id`. Empty state orienta usuário. | ✅ Aplicado |
| **Feat — Excluir pasta cascade completo** | `DELETE /api/accounts/folders/[id]`: busca IDs das contas → limpa `pending_containers` → deleta `instagram_accounts` → deleta pasta. Dialog de confirmação atualizado: "X contas serão excluídas permanentemente". | ✅ Aplicado |
| **Fix — Monitor: contas deletadas não aparecem mais** | `/api/loop/monitor`: query com `.eq("health_status","online")` + filtro pós-fetch de containers órfãos (deleta silenciosamente). Aba "Inativo" removida. 43 contas inativas sem pasta deletadas diretamente do banco via SQL. | ✅ Aplicado |
| **Feat — Monitor: agrupado por loop + ordem por recência** | Aba "Todas": contas agrupadas por `loop_name` com cabeçalho separador (ícone Activity + nome + count + linha divisória). Grupos em ordem alfabética, "Sem loop" no final. Dentro de cada grupo: ordenado por `last_published_at` desc. Filtros Publicado/Aguardando/Erro: lista plana ordenada por recência. | ✅ Aplicado |
| **Feat — Sidebar simplificada: remove Status da Fila** | Aba `/dashboard/queue` removida da Sidebar. Monitor usa ícone `Activity` (antes `Radar`). Import `Radar` removido do Sidebar.tsx. | ✅ Aplicado |
| **Fix — Stagger dinâmico + jitter ±30% no process-loops** | Stagger fixo `i * 2 min` ultrapassava o ciclo com muitas contas (48 contas × 15 min = conta[47] em +94 min → postava a cada 60–110 min em vez de 15). Substituído por stagger proporcional: `staggerBaseSec = max(5, interval_min × 60 / num_contas)` + jitter aleatório ±30% por conta. Para 48×15 min: 18.75s ± ~5.6s entre contas. `publish-pending` limit 5→10 por run. Timing não-periódico dificulta detecção como bot pela Meta. | ✅ Aplicado |
| **Fix — 4 bugs gerais (revisão do SaaS)** | (1) `posts/create`: faltava proxy em `refreshMetaToken` + `publishViaMetaAPI` — publicações via página Postar saíam pelo IP da Vercel. (2) `publish-pending`: mensagem TTL "30 min" → "90 min". (3) `failover/accounts` PATCH: `Promise.all` → `Promise.allSettled`. (4) `schedule` GET/POST: sem auth — GET listava posts de todos os usuários; POST inseria `user_id: null` (TODO da Fase 6 nunca concluído). | ✅ Aplicado |
| **Fix — TOKEN_ERROR_CODES reduzido a [190, 102, 104]** | `sync-all` e `refresh` tinham TOKEN_ERROR_CODES com código 4 (rate limit) e 200 (permission). Ao subir contas em lote, sync paralelo batia no rate limit (código 4) marcando TODAS como error. Código 200 marcava contas recém-conectadas onde permissões ainda não propagaram. Reduzido para [190, 102, 104] — apenas tokens genuinamente mortos. Erros de permissão/rate-limit viram console.warn sem mudar health_status. | ✅ Aplicado |
| **Fix — callback OAuth reseta health_status='online'** | Upsert no `/api/instagram/callback` não incluía `health_status`. Conta reconectada com token novo mantinha `health_status='error'` do histórico. Adicionado `health_status: "online"` no upsert payload e no fallback update. | ✅ Aplicado |
| **Fix — sync-all não mais re-sincroniza contas com error (flood de failover_logs)** | Contas com `health_status='error'` nunca tinham `profile_refreshed_at` atualizado → sempre "stale" → re-sincronizadas a cada abertura de página → dezenas de entradas duplicadas no `failover_logs` por minuto. Fixes: (1) `.neq("health_status", "error")` na query — contas já marcadas puladas completamente; (2) ao marcar error, atualiza `profile_refreshed_at` para evitar re-sync por 5 min; (3) grava em `failover_logs` com motivo real ao marcar error (elimina "Erro Desconhecido" no diagnóstico). | ✅ Aplicado |
| **Infra — Proxy residencial Smartproxy** | `lib/proxy.ts` com ProxyAgent undici + sticky session por account_id (SHA-256 truncado 8 hex). Integrado em meta-publish, meta-refresh, process-loops, publish-pending. `PROXY_URL_TEMPLATE=http://smart-pfr1h4mxu4py_area-BR_life-15_session-{SESSION}:XRGlTzc7NgqAwhUU@us.smartproxy.net:3120` configurado na Vercel. ATENÇÃO: o código só substitui `{SESSION}` — credenciais reais devem estar literais na env var (sem `{user}`/`{pass}` placeholder). Confirmado funcionando via curl (retorna IP BR). Fallback sem proxy ativo se `fetch failed`. | ✅ Configurado |
| **Fix — sanitizeCaption removia todos os espaços** | Regex na linha 16 de `lib/meta-publish.ts` tinha codepoint 32 (espaço ASCII) em vez de codepoint 0 (null byte `\x00`). Resultado: todos os espaços das legendas eram removidos antes de enviar à Meta API → texto saía colado sem espaços. Corrigido para `/\x00/g`. | ✅ Aplicado |
| **Fix — proxy fallback em publish-pending (fetch failed)** | `publish-pending` não tinha fallback de proxy. Quando ProxyAgent undici retornava "fetch failed" em `pollContainerStatusOnce` ou `publishReadyContainer`, o container era marcado como erro permanente mesmo com `creation_id` válido e vídeo já processado na Meta. Fix: se "fetch failed" com proxy ativo → retry sem proxy (`null`), igual ao padrão do `process-loops`. Commit `6d3ad9f`. | ✅ Aplicado |
| **Fix — monitor + DELETE de loop cancela containers pendentes** | `pending_containers` tem FK `loop_id ON DELETE SET NULL` — deletar loop deixava containers `pending` órfãos bloqueando o `publish-pending`. Fix: DELETE de loop cancela containers `pending/publishing` antes de deletar; monitor faz cleanup de órfãos (`loop_id IS NULL`) a cada visita e filtra containers de contas deletadas. | ✅ Aplicado |
| **Fix — 28 fetch failed em burst no process-loops** | Jitter anti-burst na FASE 2b era condicionado em `containersCreated > 0`. Quando todos falhavam (proxy down), `containersCreated` ficava 0 → nenhum sleep → 28 chamadas simultâneas → proxy rejeitava tudo. Fix: contador `phase2bAttempts` separado, incrementado por conta tentada (não por sucesso). Proxy fallback adicionado: "fetch failed" com proxy ativo → retry sem proxy. | ✅ Aplicado |
| **Fix — PROXY_URL_TEMPLATE com credenciais literais** | `buildProxyAgent` em `lib/proxy.ts` só substitui `{SESSION}`. Se a env var continha `{user}` ou `{pass}` como placeholders literais, a URL ficava inválida → "fetch failed" em massa em todas as contas. URL correta: `http://smart-pfr1h4mxu4py_area-BR_life-15_session-{SESSION}:XRGlTzc7NgqAwhUU@us.smartproxy.net:3120`. Somente `{SESSION}` deve ser placeholder. | ✅ Aplicado |

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

-- Fix Stories — contagem inteira de stories ativos por conta
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS active_stories_count integer NOT NULL DEFAULT 0;

-- Pastas de Contas (account_folders + folder_id em instagram_accounts)
-- Script completo em supabase/account_folders.sql
CREATE TABLE IF NOT EXISTS public.account_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_folders_user_id_idx ON public.account_folders(user_id);
ALTER TABLE public.account_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_account_folders" ON public.account_folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.account_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS instagram_accounts_folder_id_idx ON public.instagram_accounts(folder_id);

-- Lock atômico publish-pending (supabase/pending_containers_publishing_status.sql)
ALTER TABLE public.pending_containers
  DROP CONSTRAINT IF EXISTS pending_containers_status_check;
ALTER TABLE public.pending_containers
  ADD CONSTRAINT pending_containers_status_check
  CHECK (status IN ('pending', 'publishing', 'published', 'error'));

-- Novos efeitos de vídeo (supabase/loops_new_effects.sql)
ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS effect_zoom     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effect_blur     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effect_noise    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS effect_anti_ai  boolean NOT NULL DEFAULT false;

-- Backoff exponencial publish-pending (supabase/pending_containers_backoff.sql) — JÁ APLICADO 2026-06-03
-- ALTER TABLE public.pending_containers
--   ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
--   ADD COLUMN IF NOT EXISTS retry_after  timestamptz;
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
