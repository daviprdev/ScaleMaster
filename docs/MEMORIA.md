# MEMORIA.md — Histórico do Projeto AutoScale

Registro cronológico de decisões, problemas encontrados, soluções adotadas e estado de cada fase.

---

## Contexto Geral

**Projeto:** AutoScale / AutoScale AI
**Objetivo:** SaaS para automação de Instagram — scraping de Reels, limpeza de metadados via FFmpeg, biblioteca de vídeos e agendamento de postagens para múltiplas contas.
**Dev:** Davi Pereira (solo)
**Repositório:** https://github.com/daviprdev/AutoScale-IA.git
**Branch principal:** `main`

---

## Decisões de Arquitetura

### Por que Next.js 15 e não 14?
A versão 14.2.x tinha uma vulnerabilidade de segurança conhecida. Migrado para Next.js 15.5 que compila o projeto sem breaking changes relevantes para o App Router.

### Por que inicialização lazy no Supabase?
`createClient()` da `@supabase/supabase-js` lança erro se `supabaseUrl` for string vazia. Durante o build do Next.js, variáveis de ambiente do `.env.local` não estão disponíveis. A inicialização lazy (via funções `getSupabase()` e `getSupabaseAdmin()`) garante que o cliente só é criado dentro de uma request, nunca no build.

### Por que `serverExternalPackages` para o FFmpeg?
`fluent-ffmpeg` e `@ffmpeg-installer/ffmpeg` usam `require()` dinâmico para encontrar o binário de plataforma (`win32-x64`, `linux-x64`, etc.). O webpack do Next.js não consegue resolver esses requires dinâmicos em tempo de build, gerando `MODULE_NOT_FOUND`. Marcar como `serverExternalPackages` faz o Node.js resolver os módulos em runtime, contornando o problema.

### Por que `runtime = "nodejs"` na rota de vídeo?
A rota `/api/video/process` usa `fs`, `os`, `path` e FFmpeg — APIs exclusivas do Node.js. O Edge Runtime do Next.js não suporta essas APIs.

### Por que o git root estava em `C:\Users\davip`?
O repositório `Saas` estava inicializado na pasta home do usuário, não na pasta do projeto. Isso fazia os arquivos aparecerem no GitHub aninhados em `OneDrive/Documentos/AutoScale AI/`. Solução: inicializar um novo `.git` diretamente em `AutoScale AI/` e fazer force push para o repositório correto.

---

## Fases

---

### ✅ Fase 1 — Setup Inicial + Landing Page + Auth UI
**Data:** 10/05/2026
**Commit:** `feat: Fase 1 — setup inicial, landing page e telas de auth`

#### O que foi feito
- Projeto Next.js 15 criado manualmente (create-next-app falhou devido ao OneDrive interferir com a criação de pastas — scaffolding manual foi mais confiável)
- Tailwind CSS 3.x + PostCSS configurados
- TypeScript strict mode
- `framer-motion`, `lucide-react`, `clsx`, `tailwind-merge` instalados
- Design system completo em `globals.css`: glassmorphism, gradient-text, btn-primary, btn-ghost, input-glass, grid-bg
- Cores brand: Violet `#8B5CF6` e Cyan `#06B6D4`
- `tailwind.config.ts` com animações `float`, `glow`, `pulse-slow` e cores brand customizadas

#### Páginas criadas
| Rota | Arquivo | Descrição |
|------|---------|-----------|
| `/` | `app/page.tsx` | Landing page com Hero, Stats, Features (6 cards), CTA, Footer |
| `/auth/login` | `app/auth/login/page.tsx` | Form de login com reveal de senha + placeholder OAuth Google |
| `/auth/register` | `app/auth/register/page.tsx` | Form de cadastro com validador visual de força de senha |

#### Problemas encontrados
- `create-next-app` não criou a pasta no OneDrive (provável interferência do sync)
- Next.js 14.2.29 tinha vulnerabilidade de segurança — atualizado para 15.x

---

### ✅ Fase 2 — Layout do Dashboard + Sidebar + Rotas
**Data:** 10/05/2026
**Commit:** `feat: Fase 2 — layout do dashboard com sidebar glassmorphism`

#### O que foi feito
- Sidebar colapsável com animação suave (largura 240px ↔ 72px via `motion.aside`)
- `layoutId="activeNav"` para o indicador de rota ativa deslizar entre os itens
- `AnimatePresence` para labels da sidebar somem/aparecem com fade + slide
- Header sticky com título dinâmico via `usePathname()`
- Dashboard overview com 4 cards de stats, feed de atividade recente, próximas postagens agendadas e ações rápidas
- Páginas stub para `/dashboard/library` e `/dashboard/schedule`

#### Componentes criados
| Componente | Descrição |
|-----------|-----------|
| `Sidebar.tsx` | Sidebar colapsável com nav, contas Instagram e user card |
| `Header.tsx` | Header com título por rota, busca decorativa, notificação e CTA |

---

### ✅ Fase 3 — Pesquisa de Reels + Grid + API Apify
**Data:** 10/05/2026
**Commit:** `feat: Fase 3 — pesquisa de Reels com grid interativo e API Apify`

#### O que foi feito
- Rota POST `/api/apify/scrape` com modo mock (sem token) e modo real (com polling do Apify Actor)
- `ReelCard` com proporção 9:16, overlay de hover com métricas (views, curtidas, comentários)
- `ReelGridSkeleton` com 12 cards pulsando durante loading
- Grid responsivo de 2 a 6 colunas dependendo da largura da tela
- Página `/dashboard/search` com estados: idle → loading → done → error
- Pesquisas recentes como chips clicáveis
- Ordenação por views / curtidas / comentários / duração

#### Detalhes técnicos
- Actor Apify usado: `apify~instagram-reel-scraper`
- Formato de dados normalizado: `{ id, shortCode, thumbnailUrl, videoUrl, caption, views, likes, comments, duration, owner }`
- Mock retorna 12 Reels com gradientes aleatórios quando `APIFY_API_TOKEN` não está configurado

---

### ✅ Fase 4 — Processamento FFmpeg + Upload Supabase Storage
**Data:** 10/05/2026
**Commit:** `feat: Fase 4 — processamento FFmpeg e upload para Supabase Storage`

#### O que foi feito
- Rota POST `/api/video/process` com runtime Node.js e maxDuration 60s
- Pipeline: download via `fetch` → arquivo temp em `os.tmpdir()` → FFmpeg strip → upload Storage → insert DB → cleanup
- Comando FFmpeg: `-map_metadata -1 -c:v copy -c:a copy` (sem re-encoding, apenas remove metadados)
- Clientes Supabase com lazy init via `getSupabase()` e `getSupabaseAdmin()`
- SQL: tabelas `videos_library`, `instagram_accounts`, `scheduled_posts` com RLS
- Bucket `videos-library` público com limite de 500 MB

#### Problemas encontrados e soluções
| Problema | Solução |
|----------|---------|
| `supabaseUrl is required` no build | Lazy initialization — criar cliente só dentro da request |
| `MODULE_NOT_FOUND` para ffmpeg | `serverExternalPackages: ["fluent-ffmpeg", "@ffmpeg-installer/ffmpeg"]` |
| Callback type error em `fluent-ffmpeg` | `.on("end", () => resolve())` em vez de `.on("end", resolve)` |

---

### ✅ Fase 5 — Biblioteca de Mídia + Agendamento Multi-conta
**Data:** 10/05/2026
**Commit:** `feat: Fase 5 — biblioteca de mídia e agendamento multi-conta`

#### O que foi feito
- `/api/library` (GET + DELETE): lista vídeos e remove do Storage + banco; modo mock sem Supabase
- `/api/schedule` (POST + GET): cria agendamentos para múltiplas contas; modo mock sem Supabase
- `VideoCard`: card 16:9 com hover revelando "Agendar este vídeo" e "Excluir" com confirmação visual
- `/dashboard/library`: busca em tempo real, ordenação por data/views/tamanho/duração, toggle grid/lista, skeleton loader, estados vazio e sem resultados
- `AccountSelector`: multi-seleção de contas com avatares, status online, botões Todas/Limpar
- `/dashboard/schedule`: stepper de 4 passos (Vídeo → Contas → Detalhes → Confirmar), suporte a `?videoId=` para navegar da biblioteca direto ao agendamento, tela de sucesso animada
- Wrapper `Suspense` na página de schedule (obrigatório por causa de `useSearchParams` no Next.js 15)

#### Fluxo completo implementado
`Pesquisa` → Download → `Biblioteca` → "Agendar este vídeo" → `Schedule` (pré-seleciona o vídeo) → Escolhe contas → Define legenda + data → Confirma → Tela de sucesso

---

### ✅ Fase 6 — Integração Supabase Auth
**Data:** 10/05/2026
**Commit:** `feat(auth): Phase 6 - Supabase Auth integration`

#### O que foi feito
- `lib/supabase/client.ts` — browser client via `createBrowserClient` (`@supabase/ssr`)
- `lib/supabase/server.ts` — server client com leitura/escrita de cookies para SSR correto
- `middleware.ts` — protege `/dashboard/*` (sem sessão → `/auth/login`), redireciona usuários autenticados de `/auth/*` para `/dashboard`
- `app/auth/callback/route.ts` — troca código de confirmação de e-mail por sessão (`exchangeCodeForSession`)
- Login: `signInWithPassword()` real + Google OAuth (`signInWithOAuth`) + mensagens de erro em português
- Register: `signUp()` com `emailRedirectTo` + tela de sucesso pedindo confirmação
- Sidebar: logout via `signOut()`, nome e inicial do usuário vindos da sessão real (`getUser()`)

---

### ✅ Fase 7 — Integração Real Apify + user_id nos uploads
**Data:** 10/05/2026
**Commit:** `feat: Fase 7 — Apify real com waitForFinish e user_id nos uploads`

#### O que foi feito
- Rota `/api/apify/scrape` reescrita para produção:
  - `export const maxDuration = 60` para não timeout no Vercel
  - Substituído loop de polling por `waitForFinish=55` na chamada do Actor (mais eficiente e confiável)
  - Dataset buscado via `defaultDatasetId` retornado no run (sem segundo request de status)
  - Filtro de itens sem `videoUrl`, campo `owner` via `ownerUsername`
  - Mensagens de erro da própria API Apify propagadas ao frontend
- Rota `/api/video/process` atualizada:
  - Busca o usuário autenticado via `createClient()` (server) + `auth.getUser()`
  - Passa `userId` real ao insert na tabela `videos_library` (substituindo o `null` fixo)
- Sidebar e header: "Pesquisa de Reels" → "Inspirações"; contas inline removidas e transformadas em item de menu "Contas"
- Página de Inspirações: botão "Baixar todos" com progresso `X/total` e banner de sucesso verde

#### Decisão: `waitForFinish` vs polling manual
O polling manual com `while` e `setTimeout(3000)` bloqueava a Route Handler por tempo indeterminado e podia exceder o timeout do Vercel. O parâmetro `waitForFinish=55` delega a espera para a API do Apify, que retorna quando o Actor termina ou após 55s — dentro do `maxDuration = 60` da rota.

---

### ✅ Fase 8 — Deploy e Produção
**Data:** 11/05/2026
**Commit:** `feat: Fase 8 — deploy Vercel com variáveis de ambiente configuradas`

#### O que foi feito
- Corrigido bug de build: `outputFileTracingRoot` adicionado ao `next.config.ts` para resolver conflito de workspace root (havia um `package-lock.json` em `C:\Users\Recepção\` que fazia o Next.js apontar para a pasta errada, quebrando a resolução dos módulos de API)
- Deploy na Vercel via CLI (`vercel --prod`)
- Projeto vinculado ao repositório GitHub automaticamente pela Vercel
- 4 variáveis de ambiente configuradas em production + preview via `vercel env add`
- Redeploy realizado para ativar as variáveis

#### URLs de produção
- **App:** https://autoscale-ia.vercel.app
- **Painel Vercel:** https://vercel.com/daviprdev-4623s-projects/autoscale-ia

#### Problemas encontrados e soluções
| Problema | Solução |
|----------|---------|
| `PageNotFoundError` para `/api/apify/scrape` no build | `outputFileTracingRoot: path.resolve(__dirname)` no `next.config.ts` |
| Nome do projeto inválido (espaço + maiúsculas na pasta) | Flag `--name autoscale-ia` no primeiro deploy |

#### Observação sobre FFmpeg em produção
A rota `/api/video/process` usa FFmpeg com binário nativo. O Vercel Free tem limite de 10s por função — para vídeos grandes pode ser necessário migrar para Vercel Pro (300s) ou fila assíncrona (Inngest / Trigger.dev).

---

### ✅ Fase 9 — Seção Inspirações com apify-client + UI de hover
**Data:** 11/05/2026
**Commit:** `feat: Fase 9 — seção Inspirações com apify-client e overlay de métricas`

#### O que foi feito
- `apify-client@2.23.3` instalado como dependência oficial para comunicação com a API Apify
- Nova rota `POST /api/inspirations/scrape` criada usando `ApifyClient` com:
  - Actor `apify/instagram-scraper` (mais completo e oficial que o `instagram-reel-scraper`)
  - Input: `{ directUrls: ["/username/reels/"], resultsType: "posts", maxRequestsPerCrawl: 30 }`
  - `waitSecs: 55` na chamada `.call()` do SDK (mesmo padrão da Fase 7 mas via SDK em vez de fetch raw)
  - Filtro por `item.type === "Video" || item.videoUrl`
  - Modo mock sem `APIFY_API_TOKEN`
- Componentes dedicados em `components/inspirations/`:
  - `InspirationCard.tsx` — card 9:16 com overlay de hover revelando Views, Curtidas e Comentários com ícones coloridos (cyan / pink / violet) + botão "Preparar Download" com estado visual de confirmação ("Adicionado à fila ✓")
  - `InspirationGrid.tsx` — grid responsivo 2→6 colunas + skeleton loader
- Página `/dashboard/search` reescrita para usar a nova rota e os novos componentes, mantendo: search input com `@`, pesquisas recentes, ordenação por views/likes/comentários/duração, estados idle/loading/done/error

#### Decisão: componentes dedicados vs reutilizar ReelCard
Criados componentes separados em `components/inspirations/` para não acoplar o fluxo de "Inspirações" (sem FFmpeg) ao fluxo existente de "Pesquisa + Download" (`components/search/`). Facilita implementar FFmpeg na Fase 10 sem alterar a lógica da Inspirações.

#### Botão "Preparar Download"
UI-only: ao clicar, muda para "Adicionado à fila ✓" (verde) por 3s e volta ao estado inicial. A integração real com FFmpeg e a fila de downloads será implementada na próxima fase.
