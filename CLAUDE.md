# CLAUDE.md — NexusSocial (AutoScale AI)

Este arquivo é lido automaticamente pelo Claude Code em toda conversa.
Contém as instruções, contexto e estado atual do projeto.

---

## Visão Geral do Projeto

**Nome provisório:** NexusSocial
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
| Deploy | Vercel (planejado) |

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
│   └── ffmpeg-process.ts             ← Pipeline de processamento de vídeo
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
| **Fase 6** | Integração real Supabase Auth | 🔲 Pendente |
| **Fase 7** | Integração real Apify (scraping real) | 🔲 Pendente |
| **Fase 8** | Deploy Vercel + configuração de produção | 🔲 Pendente |

---

## Diretrizes para o Claude

- Sempre verificar o build (`npm run build`) ao final de cada fase antes de commitar
- Nunca commitar `.env.local`, `node_modules/`, `.next/`, `.claude/`, `.obsidian/`
- Manter o padrão de inicialização lazy para clientes Supabase (evita erros no build)
- Usar `serverExternalPackages` no `next.config.ts` para pacotes com binários nativos (ffmpeg)
- Commitar por fase com mensagens descritivas em português
- Ao terminar cada fase: atualizar o status em `CLAUDE.md` e `docs/MEMORIA.md`, depois commitar e fazer push
- Rodar sempre de dentro de `C:\Users\davip\OneDrive\Documentos\AutoScale AI`
- Branch principal: `main` no remote `origin`
