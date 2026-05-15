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
