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

### ✅ Sessão 2026-07-21 — Dashboard reconstruído + Verificador de Perfis do Instagram

**Dashboard (`/dashboard`) reconstruído.** `GET /api/dashboard/stats` reescrito: `accounts` ganha `added_today/added_yesterday/added_7d`; novo `accounts_down` (total com `health_status='error'` + quedas hoje/ontem/7d via `failover_logs`, deduplicadas por conta); `posts_today.published`; `queue.pending` agora soma `scheduled_posts` (pending/publishing) + `pending_containers` (pending/publishing) — antes só contava agendados futuros. UI: 3 cards simples (Contas Conectadas / Postagens Hoje / Fila) + 2 cards de breakdown com 3 mini-métricas (Hoje/Ontem/7 dias) para Contas Adicionadas (verde) e Contas Caídas (vermelho). Efeito de glow transparente sempre visível atrás de cada card (antes só no hover). Ações Rápidas trocadas para Postar/Automatizar/Loop/Stories (ícones iguais aos da Sidebar). Commit `6a75bc3`.

**Verificador de Perfis do Instagram — nova função na aba Contas.** Botão "Verificar" abre modal: cola usernames (até 60), checa em lotes de 15 via `POST /api/instagram/checker`. Consulta o endpoint público `web_profile_info` do cliente web do Instagram para classificar cada perfil em `active` / `not_found` / `error`. **Limitação estrutural documentada:** o Instagram não expõe publicamente se uma conta foi banida, removida ou nunca existiu — todas caem em `not_found`. Commit `3fd8022`.

**Fix 1 — "Instagram respondeu 400" em toda conta real.** O endpoint `web_profile_info` exige cookie de sessão anônima (`csrftoken`) — sem ele, responde 400 para QUALQUER username, mesmo ativo. Fix: `fetchIgSession()` visita `instagram.com` uma vez por request, extrai cookies via `res.headers.getSetCookie()` (undici 8), reaproveita no lote inteiro. Commit `429bc61`.

**Fix 2 — Instagram escalou para 401 mesmo com csrftoken.** Confirmado pelo usuário que a proteção anti-bot da Meta foi além do cookie de visitante — passou a exigir sessão autenticada real ("login required"), o que é um teto estrutural do método anônimo (não dá pra contornar sem credenciais reais). Fix: fallback OFICIAL via Meta Graph API — `business_discovery` (`graph.instagram.com/v21.0/{id}?fields=business_discovery.username(alvo){...}`) usando o token de uma conta já conectada no SaaS, roteado pelo proxy dela. Não sofre bloqueio anti-bot, mas só confirma contas Business/Creator (não confirma nem descarta contas pessoais — mensagem honesta nesse caso). Commit `eb33850`.

**Lição geral:** para qualquer feature nova que precise consultar dados do Instagram fora do fluxo de conta conectada (ex.: esse checker), o caminho anônimo (scraping de `www.instagram.com`) tem viabilidade decrescente — a Meta está fechando isso progressivamente. Preferir sempre, quando possível, um caminho oficial via Graph API com token de conta já conectada como fallback (ou como primário).

---

### ✅ Sessão 2026-07-07 — Diagnóstico de quedas + sync tempo real + idade da conta

**Diagnóstico das quedas de contas (25 subidas, ~13 caíram).** Causa raiz: **volume de postagem alto demais para contas novas** — loops a 30 e 60 min = 24 a 48 posts/dia em contas com dias de vida. O Instagram lê como bot e derruba. Não era warmup, proxy nem excesso de requisição. A conta que viralizou (1640 seg.) levou **checkpoint de conta** (`code=190 — "you cannot access the app till you log in to www.instagram.com"`), que é restrição real no nível da conta com o token ainda válido — por isso o painel mostrava "online". Régua recomendada: semana 1 = 1–2 posts/dia, subindo devagar até teto ~10/dia.

**Warmup confirmado inexistente no código.** A feature "Warmup automático" (2026-06-10) não está em nenhum `.ts` — foi revertida ou nunca commitada. `warmup_posts_done` travado em 0 mesmo com 140+ posts. Colunas no banco viraram no-op. Controle de volume passa a ser 100% manual (decisão do usuário).

**sync-accounts: 6h → tempo real.** O painel só sincronizava a cada 6h (cron) e o sync ao abrir a página era estrangulado. Mudado: cron `* * * * *` + `STALE_MINUTES=5` (era 6h) — cada conta atualiza sozinha a cada ~5 min, ritmo ~14 contas/min, sem burst. Com o auto-refresh de 60s da página, atualiza sem clicar. São 2 requisições de leitura por conta a cada ~5 min, muito abaixo do limite da Meta. Commit `ffb7530`.

**Idade da conta no card.** Helper `accountAge(connected_at)` mostra "hoje / 5 dias / 3 semanas / 2 meses" no rodapé do card de Contas, sem ícone — pra decidir quando subir posts/dia. Commit `006f8be`.

**Proxies das 21 contas novas (sem pasta).** Importados via CSV (`username,http://user:pass@ip:porta`). Confirmado no código: cada conta usa só o seu `proxy_url` (sem cruzar), e a **postagem não cai pro IP da Vercel** se o proxy falha (process-loops pula a conta; publish-pending relança pra backoff). Teste real via curl: **5 dos 24 proxies estão mortos** (exit 56) — 3 em contas (`araujocardosooh273`, `melissamaiabeattriz`, `alinekiararamos`) e 2 nos reservas. Contas com proxy morto não postam (ficam puladas). Pendente: 2 proxies bons de reposição.

---

### ✅ Sessão 2026-06-24 — Fix histórico Clone + Style + Drag-and-drop Pastas

#### Fix — Excluir histórico Clone não persistia
- **Raiz:** `DELETE /api/campaigns` só executava `UPDATE status='cancelled'`. Em campanhas inativas (pending=0), zero rows eram afetadas → registro continuava no banco → voltava no reload.
- **Fix:** Novo query param `?hard=true` executa `.delete()` real de todas as linhas da campanha. `handleDeleteHistory` no frontend passa `?hard=true`. Fluxo de cancelar campanha ativa continua sem o parâmetro.
- Commits: `ea97e9c`

#### Style — Nome completo das contas no histórico Clone
- Chips de conta tinham `truncate max-w-[100px]` cortando usernames longos.
- Removidas as duas classes do `span` em `app/dashboard/clone/page.tsx:1213`.
- Commit: `9e8f1da`

#### Feat — Drag-and-drop para reordenar abas de pastas em Contas
- HTML5 DnD nativo (`draggable` + `onDragStart/Over/Drop/End`) — zero dependências novas.
- Ordem salva em `localStorage("folder_order")` como array de IDs. Persiste entre reloads.
- `sortedFolders` useMemo aplica a ordem ao renderizar (nova pastas sem ordem vão pro final).
- `fetchFolders` carrega a ordem do localStorage ao buscar pastas da API.
- Visual: tab arrastada fica `opacity: 0.4`; tab destino recebe `outline violeta`.
- Commit: `46a0640`

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

---

### ✅ Fase 11 — Login Instagram via instagrapi + child_process
**Data:** 11/05/2026
**Commit:** `feat: Fase 11 — login Instagram via instagrapi e child_process`

#### O que foi feito
- `python_scripts/instagram_login.py` — script Python que recebe `username` e `password` via `sys.argv`, faz login com `instagrapi.Client`, e retorna JSON no stdout com os dados do perfil (`username`, `full_name`, `followers`, `profile_pic_url`, etc.)
  - Trata exceções específicas do instagrapi: `BadPassword`, `TwoFactorRequired`, `ChallengeRequired`, `PleaseWaitFewMinutes`, `LoginRequired`
  - Suprime logs internos do instagrapi para não poluir o stdout com output fora do JSON
- `app/api/accounts/login/route.ts` — rota `POST /api/accounts/login` com `runtime: "nodejs"` e `maxDuration: 60`
  - Usa `child_process.execFile` (promisificado) para chamar o script Python
  - Comando Python configurável via `PYTHON_CMD` env var (padrão: `python` no Windows, `python3` no Linux/Mac)
  - Parseia a última linha JSON do stdout (ignora logs residuais)
  - Em caso de sucesso: faz upsert na tabela `instagram_accounts` (verifica existência por `user_id + username`)
  - Erros mapeados: `ENOENT` (Python não encontrado), timeout (ETIMEDOUT), erro de login
- `app/dashboard/accounts/page.tsx` reescrito:
  - Modal com campos `@usuário` e senha (com toggle show/hide)
  - Aviso de segurança explicando que a senha não é armazenada
  - Loading de até 30s com mensagem contextual
  - Lista de contas atualizada para exibir `avatar_url` real quando disponível
  - Handler chama `/api/accounts/login` em vez de inserir diretamente no Supabase

#### Decisão: instagrapi via child_process
A Graph API do Instagram exige aprovação de app e não suporta contas pessoais facilmente. O `instagrapi` faz login via API privada do Instagram (mesma usada pelo app móvel). Como o Next.js é JavaScript/TypeScript, a integração é feita via `child_process` que invoca o script Python. **Funciona apenas em execução local** — não funciona no Vercel (sem Python no ambiente serverless). Para produção, seria necessário um servidor Python separado (FastAPI/Flask) ou um runner dedicado.

#### Variável de ambiente opcional
```
PYTHON_CMD=python   # ou python3, py, caminho absoluto
```
Adicionar ao `.env.local` se o comando padrão não funcionar.

---

### ✅ Fase 12 — Fluxo de 2FA e Checkpoint (verificação de segurança)
**Data:** 11/05/2026
**Commits:** `feat: suporte a autenticacao 2FA`, `fix: inclui versao 2FA do instagram_login.py`, `feat: Fase 12 — fluxo unificado 2FA e checkpoint`

#### O que foi feito
- `python_scripts/instagram_login.py` reescrito com formato de resposta unificado:
  - Retorna `{"status": "ok"|"requires_code"|"error", ...}` em vez de `{"success": bool}`
  - `TwoFactorRequired` → `status: requires_code`, `challenge_type: "2fa"`, `verification_method: "authenticator"`
  - `ChallengeRequired` → chama `cl.challenge_resolve(last_json)` para disparar SMS/email, salva estado completo (settings + last_json) em `/tmp/ig_session_{uuid}.json`, retorna `challenge_type: "checkpoint"`, `verification_method: "sms"|"email"`
  - Método de verificação detectado a partir de `step_name` e `contact_point` da resposta do desafio
- `python_scripts/instagram_verify_code.py` criado (script unificado para ambos os tipos):
  - Args: `username`, `code`, `challenge_type`, `session_token`, `[two_factor_identifier]`
  - Para `2fa`: chama `cl.two_factor_login(verification_code, two_factor_identifier, username)`
  - Para `checkpoint`: restaura `cl.last_json` do estado salvo, chama `cl.challenge_send_security_code(int(code))`
  - Remove o arquivo de sessão temporário após login bem-sucedido
- `app/api/accounts/login/route.ts` atualizado: detecta `status === "requires_code"` e retorna `{requires_code: true, challenge_type, verification_method, session_token, ...}` ao frontend (HTTP 200)
- `app/api/accounts/verify/route.ts` criado (rota unificada `/api/accounts/verify`): chama `instagram_verify_code.py` e faz upsert no Supabase em caso de sucesso
- `app/dashboard/accounts/page.tsx` reescrito com modal de duas etapas:
  - Etapa 1: usuário + senha (igual ao anterior)
  - Etapa 2: exibida quando backend retorna `requires_code: true`; campo de código 6 dígitos; ícone e texto de hint mudam conforme `verification_method` (authenticator/sms/email); botão "Voltar" retorna à etapa 1

#### Sessão temporária
O estado do cliente instagrapi é serializado com `cl.get_settings()` e `cl.last_json`, persistido em `/tmp/ig_session_{uuid}.json`. O token UUID é retornado ao frontend e reenviado na verificação, permitindo retomar a mesma sessão de login. O arquivo é deletado após sucesso.

#### Fluxo checkpoint vs 2FA
- **2FA (app autenticador/SMS do app):** `TwoFactorRequired` — código TOTP ou de texto do app de autenticação
- **Checkpoint (segurança):** `ChallengeRequired` — `challenge_resolve` dispara um código de verificação por SMS ou email; o código é submetido via `challenge_send_security_code`

---

### ✅ Fase 13 — Faxina de UI e Performance
**Data:** 11/05/2026
**Commit:** `fix: Fase 13 — correcao de modal, layout e loop infinito de renders`

#### Bugs corrigidos

**1. Loop infinito de re-renders (accounts/page.tsx)**
`createClient()` de `@supabase/ssr` retorna uma **nova instância** a cada chamada. O componente chamava `createClient()` no nível do render, o que criava uma nova referência `supabase` a cada render. Como `useCallback(fetchAccounts, [supabase])` dependia dessa referência instável, `fetchAccounts` também era recriada a cada render. Isso fazia o `useEffect(() => { fetchAccounts() }, [fetchAccounts])` disparar novamente, que chamava `setLoading()`, que causava um novo render, formando um loop. Resultado: dezenas de re-renders por segundo, sluggishness total e necessidade de 2–3 cliques para registrar qualquer ação.
**Correção:** `const supabase = useMemo(() => createClient(), [])` — instância estável por todo o ciclo de vida do componente.

**2. Modal aparecendo cortado/fora de posição**
O modal usava `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2` para centralizar. Em certos contextos de viewport (scroll, transforms de ancestrais, telas menores), essa abordagem de transform-based centering falha.
**Correção:** O overlay agora é `fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4`. O modal fica dentro do flex container, centralizado por `items-center justify-center` — confiável em qualquer viewport.

**3. Layout espremido na esquerda (accounts/page.tsx)**
O container principal tinha `max-w-3xl` (768px) sem `mx-auto`, colando o conteúdo na lateral esquerda. Removido o `max-w` — o conteúdo agora preenche toda a área disponível do main.

**4. Botões sem proteção contra duplo-clique**
`handleToggle` e `handleDelete` não tinham `try/finally`, então se o Supabase falhasse, o estado `togglingId`/`deletingId` ficava travado para sempre. Adicionado `try/finally` e guard `if (togglingId) return` / `if (deletingId) return` para impedir acionamento concorrente.

#### Regra importante para evitar o bug de loop
Sempre que um componente precisar do cliente Supabase browser em múltiplas funções:
```tsx
// ✅ Correto — instância estável
const supabase = useMemo(() => createClient(), []);

// ❌ Errado — nova instância a cada render
const supabase = createClient();
```

---

### ✅ Fase 14 — Download Real das Inspirações + Baixar Todos
**Data:** 12/05/2026
**Commit:** `feat: Fase 14 — download real das inspirações e botão baixar todos`

#### O que foi feito
- Constatado que o fluxo individual já estava parcialmente implementado: `InspirationCard` chamava `onProcess` (desde Fase 9) e a página já repassava a chamada para `/api/video/process` (rota completa com FFmpeg + Supabase Storage desde Fase 4)
- O que estava faltando: orquestração de download em lote na página
- `app/dashboard/search/page.tsx` atualizado:
  - Estado `bulkProgress: { done, errors, total } | null` para rastrear progresso do lote
  - Estado `bulkDone: boolean` para exibir banner de conclusão
  - Função `handleBulkDownload`: itera `sortedReels` sequencialmente com `for...of`, chama `handleProcess` para cada reel, conta erros sem interromper o loop, atualiza o contador a cada iteração
  - Botão "Baixar todos" no results header: desabilitado durante o lote, mostra spinner + contador `X/total baixados` em tempo real
  - Banner verde de sucesso animado (Framer Motion) ao término do lote
  - Estados de bulk resetados a cada nova busca

#### Fluxo completo validado
`Inspirações (busca) → "Preparar Download" (individual, card)` — FFmpeg → Supabase → Biblioteca  
`Inspirações (busca) → "Baixar todos" (lote, header)` — processa todos sequencialmente → banner de sucesso → Biblioteca

---

### ✅ Fase 15 — Postagem Real no Instagram
**Data:** 12/05/2026
**Commit:** `feat: Fase 15 — postagem real no Instagram via instagrapi`

#### O que foi feito

**Scripts Python:**
- `instagram_login.py` e `instagram_verify_code.py` atualizados: `_return_profile` agora inclui `session_json` (resultado de `cl.get_settings()`) no payload de retorno `{"status": "ok"}`
- `python_scripts/instagram_post.py` criado:
  - Args: `username`, `video_url`, `caption`, `session_file` (caminho para JSON de sessão)
  - Restaura sessão via `cl.set_settings(settings)`
  - Baixa vídeo para arquivo temporário via `urllib.request.urlretrieve`
  - Posta como Reel via `cl.clip_upload(tmp_video, caption=caption)`
  - Retorna `{"status": "ok", "media_id": "...", "code": "..."}` ou `{"status": "error", "error": "..."}`
  - Limpa arquivo temporário no `finally`

**Banco de dados:**
- `access_token` na tabela `instagram_accounts` agora armazena o JSON completo de sessão do instagrapi (cookies, device_id, etc.) após login bem-sucedido
- Rotas `accounts/login` e `accounts/verify` atualizadas para salvar `session_json` no campo `access_token`

**Backend:**
- `app/api/accounts/list/route.ts` criada (GET): lista contas ativas do usuário autenticado (incluindo `access_token` para verificar se sessão está salva)
- `app/api/posts/publish/route.ts` criada (POST):
  - Body: `{ video_id, account_ids, caption }`
  - Busca `public_url` do vídeo e sessão de cada conta no Supabase
  - Para cada conta: escreve sessão em arquivo temp → chama `instagram_post.py` → limpa temp
  - Retorna `{ results: PostResult[] }` com status por conta

**UI:**
- `components/library/PostModal.tsx` criado:
  - Carrega contas via `/api/accounts/list`
  - Pré-seleciona contas com sessão salva; desabilita as sem sessão
  - Campo de legenda (pré-preenchido com `video.caption`)
  - Botão "Postar agora" com contador de contas selecionadas
  - Loading inline por conta; resultados por conta (✓/✗ com media_id ou mensagem de erro)
- `VideoCard` atualizado: novo prop `onPost`, botão "Postar agora" (gradiente rosa→violet) acima do "Agendar"
- `library/page.tsx` atualizado: estado `postingVideo`, handler `handlePost`, `<PostModal>` com `AnimatePresence`

#### Limitação conhecida
Postagem via instagrapi funciona **apenas localmente** (sem Python/instagrapi no ambiente serverless do Vercel). Em produção exigiria um servidor Python separado (FastAPI/Flask) ou um worker dedicado.

#### Fluxo completo
`Biblioteca → hover card → "Postar agora" → PostModal → seleciona contas → legenda → Postar → resultado por conta`

---

### ✅ Fase 16 — Servidor FastAPI (Python em produção)
**Data:** 12/05/2026
**Commit:** `feat: Fase 16 — servidor FastAPI para operações Python em produção`

#### O que foi feito

**`python_server/main.py`** — servidor FastAPI com 3 rotas:
- `GET /health` — health check
- `POST /auth/login` — login instagrapi (lógica portada do `instagram_login.py`); sessões 2FA/checkpoint armazenadas em memória com TTL de 5 minutos
- `POST /auth/verify` — verificação de código 2FA ou checkpoint (portada do `instagram_verify_code.py`)
- `POST /posts/publish` — postagem de Reel via `clip_upload` (portada do `instagram_post.py`); recebe `session_json` diretamente no body, sem arquivo temporário
- Autenticação por `x-api-key` header (variável `PYTHON_SERVER_SECRET`)
- Sessões 2FA/checkpoint em dict em memória com lock thread-safe e limpeza automática de expirados

**`python_server/requirements.txt`** — `fastapi`, `uvicorn[standard]`, `instagrapi`

**`python_server/Dockerfile`** — imagem `python:3.11-slim` para deploy em Railway/Render/VPS

**`lib/python-server.ts`** — helper TypeScript:
- `hasPythonServer()` — retorna `true` se `PYTHON_SERVER_URL` está configurado
- `callPythonServer<T>(endpoint, body)` — faz `fetch` POST com `x-api-key` e trata erros HTTP

**Rotas Next.js atualizadas com modo duplo:**
- `app/api/accounts/login/route.ts`
- `app/api/accounts/verify/route.ts`
- `app/api/posts/publish/route.ts`
- Cada rota verifica `hasPythonServer()`: se `true` → chama FastAPI via HTTP; se `false` → fallback para `child_process` (scripts locais, comportamento anterior)
- Lógica de Supabase (upsert de conta, busca de sessão) permanece no Next.js em ambos os modos

#### Variáveis de ambiente novas
```
PYTHON_SERVER_URL=http://localhost:8000   # URL do servidor FastAPI
PYTHON_SERVER_SECRET=                     # Chave compartilhada (opcional mas recomendado)
```

#### Como rodar localmente
```bash
# Terminal 1 — Next.js
npm run dev

# Terminal 2 — FastAPI
cd python_server
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

#### Deploy recomendado
- **Railway** ou **Render** — free tier suficiente para este volume
- Definir `PYTHON_SERVER_SECRET` no painel de env vars do Railway/Render
- Definir `PYTHON_SERVER_URL` + `PYTHON_SERVER_SECRET` no Vercel (env vars de production)

#### Decisão: sessões em memória vs Redis
Para o volume atual (usuário único, poucas contas), sessões em memória com lock thread-safe são suficientes. O TTL de 5 minutos cobre o tempo de digitar o código 2FA. Em escala maior, trocar por Redis com `redis-py`.

#### Decisão: manter fallback child_process
Os scripts Python em `python_scripts/` continuam funcionando para desenvolvimento local sem precisar subir o FastAPI. O fallback é transparente: se `PYTHON_SERVER_URL` não estiver no `.env.local`, o comportamento é idêntico ao das fases anteriores.

---

### ✅ Fase 17 — Página de Configurações + Otimização de Performance
**Data:** 12/05/2026
**Commits:** `perf: remover backdrop-blur...` + `feat: Fase 17 — pagina de Configuracoes`

#### Página de Configurações (`app/dashboard/settings/page.tsx`)

**Seção Perfil:**
- Busca usuário via `supabase.auth.getUser()` em `useEffect`
- Exibe avatar com inicial gerada, e-mail somente leitura
- Campo de nome editável com `supabase.auth.updateUser({ data: { full_name } })`
- Botão "Salvar alterações": mostra spinner enquanto salva, muda para "Salvo! ✓" por 3 segundos após sucesso
- `useRef _savingRef` para guard síncrono contra duplo-clique

**Seção Assinatura (UI Only):**
- Card com gradiente violet/cyan no cabeçalho
- Badge "GRATUITO" no canto
- Grid 3 colunas com limites: 3 contas, 50 vídeos, 30 posts/mês
- Botão "Fazer Upgrade para Pro" → `alert("Em breve!")` — placeholder para futura integração de pagamento

**Seção Sessão:**
- Exibe e-mail do usuário com indicador "Ativo" (dot verde com glow)
- Botão "Sair da Conta": `supabase.auth.signOut()` + `router.push("/auth/login")`
- `useRef _loggingOutRef` para guard síncrono

**Header atualizado:**
- `/dashboard/accounts` e `/dashboard/settings` adicionados ao mapa `pageTitles` (anteriormente exibiam "Dashboard" genérico)

#### Otimização de performance (commit anterior)
- Removido `backdrop-blur-xl/md/sm` de Sidebar, Header, `.glass`, `.glass-card`, `.btn-ghost`, `.input-glass`, badges de VideoCard e InspirationCard
- Header: substituído `motion.header` com animação de entrada por `<header>` simples
- Dashboard layout: removidos os dois círculos decorativos com `blur-[100px]` e `blur-[80px]`
- `app/dashboard/loading.tsx` criado: spinner instantâneo durante navegação entre páginas
- `useRef` guards adicionados em: `handleConnect`, `handleVerifyCode`, `handleToggle`, `handleDelete` (accounts), `handleDelete` (library), `handleSearch`, `handleBulkDownload` (search)

---

### ✅ Fase 18 — Redesign Premium: Sidebar Dropdown + Settings com Tabs
**Data:** 12/05/2026
**Commit:** `feat: Fase 18 — sidebar dropdown portal + settings premium redesign`

#### Sidebar — Menu de usuário via portal (`components/dashboard/Sidebar.tsx`)

**Problema:** Sidebar usa `overflow-hidden` (obrigatório para a animação de colapso), o que clipa qualquer dropdown filho.

**Solução:** `createPortal(dropdown, document.body)` com `position: fixed` calculado via `getBoundingClientRect()` no momento de abertura.

**Comportamento do dropdown:**
- **Sidebar expandida:** dropdown abre ACIMA do user card (`bottom = window.innerHeight - rect.top + 6`)
- **Sidebar colapsada:** dropdown abre À DIREITA do user card (`top = rect.top, left = rect.right + 8`)
- Backdrop invisível `fixed inset-0 z-[190]` fecha ao clicar fora; `Escape` também fecha
- Animação `framer-motion` de entrada (scale + opacity)

**Itens do dropdown:**
1. "Meu Perfil" → `router.push("/dashboard/settings")`
2. "Pagamento / Assinatura" — `disabled`, badge "Em breve" (violet)
3. Separador + "Sair da Conta" — `supabase.auth.signOut()` + redirect

**Dados exibidos:** Nome de usuário + e-mail do Supabase no cabeçalho do dropdown.

**Estado `mounted`:** checado antes de chamar `createPortal` para evitar erro de SSR (`document` não existe no servidor).

#### Página de Configurações Redesenhada (`app/dashboard/settings/page.tsx`)

**Layout:** `flex-col lg:flex-row` com nav de tabs vertical (44 wide) + conteúdo à direita.

**3 tabs com `AnimatePresence mode="wait"` para transição suave entre elas:**

| Tab | Conteúdo |
|-----|----------|
| **Perfil** | Avatar circular (gradiente com inicial + overlay camera no hover), grid 2 colunas: Nome Completo, Apelido, Telefone + E-mail (somente leitura) |
| **Segurança** | Senha Atual (com toggle show/hide), Nova Senha + indicador de força (4 critérios: 8 chars, maiúscula, número, especial), Confirmar Senha + validação inline |
| **Assinatura** | Card plano atual (idêntico ao anterior), input de cupom com botão "Aplicar" (mock delay + alert) |

**Guards `useRef` em todos os formulários:**
- `_savingProfileRef` — previne duplo-submit de perfil
- `_savingPasswordRef` — previne duplo-submit de senha
- `_couponRef` — previne duplo-clique em "Aplicar cupom"

**Indicador de força de senha (`PasswordStrength`):**
- Componente inline que avalia 4 critérios via regex
- Barra segmentada 4 divisões com cor gradual (vermelho → amarelo → azul → verde)
- Labels: Fraca / Razoável / Boa / Forte

**Dados salvos via Supabase:**
- Perfil: `supabase.auth.updateUser({ data: { full_name, nickname, phone } })`
- Senha: `supabase.auth.updateUser({ password: newPassword })`

---

### ✅ Fase 19 — Dashboard Overview com Dados Reais
**Data:** 13/05/2026
**Commit:** `feat: Fase 19 — dashboard overview com dados reais do Supabase`

#### O que foi feito
- Nova rota `GET /api/dashboard/stats`: 9 queries em paralelo no Supabase (Promise.all), todas filtradas por `user_id`
  - Contas conectadas: total + quantas este mês
  - Vídeos baixados: total + quantas esta semana
  - Postagens pendentes: count + `scheduled_at` da próxima
  - Posts publicados: total
  - Feed de atividade recente: últimos 5 eventos (downloads + agendamentos mesclados por `created_at`)
  - Próximas 4 postagens futuras com conta e horário
- Dashboard `page.tsx` reescrito: fetch client-side + skeletons pulsando + empty states
- Helpers sem dependências externas: `timeAgo`, `nextPostIn`, `formatScheduled`
- 4º card substituído de "Engajamento Médio" (mock) → "Posts Publicados" (real)

---

### ✅ Fase 20 — Deploy FastAPI no Railway + Correções de Login em Produção
**Data:** 13/05/2026
**Commits:** múltiplos fixes de login Instagram em produção

#### O que foi feito
- Servidor FastAPI deployado no Railway via Dockerfile em `python_server/`
- URL de produção: `https://autoscale-ia-production.up.railway.app`
- `PYTHON_SERVER_URL` e `PYTHON_SERVER_SECRET` configurados no Vercel
- `lib/python-server.ts`: auto-prefixo `https://` se URL vier sem protocolo
- `app/api/accounts/login/route.ts`: erro claro quando servidor Python inacessível em produção
- Correções iterativas do fluxo 2FA no instagrapi 2.x:
  - `two_factor_login()` removido no instagrapi 2.x → substituído por `private_request("accounts/two_factor_login/")`
  - `two_factor_identifier` armazenado na sessão em memória durante o login
  - Fallback com `hasattr` para compatibilidade com versões antigas

---

### ✅ Rotação de Tokens Apify (Inspirações)
**Data:** 13/05/2026

#### Lógica implementada
- `APIFY_API_TOKENS` (vírgula) + `APIFY_API_TOKEN` (legado, também aceita vírgulas) são combinados num único array sem duplicatas
- Loop `for...of` instancia um `ApifyClient` diferente por token
- `isQuotaError()` captura: `"limit exceeded"`, `"usage"`, `"quota"`, `"rate limit"`, `429`, `401`, `403`, `unauthorized`, `authentication`, `forbidden`, `"not found or authentication"`
- Em caso de quota/auth → `console.warn` com os últimos 6 chars do token + `continue`
- Erro não relacionado a token (perfil privado, actor falhou) → retorna erro imediatamente sem tentar próximo
- Se todos falharem → 503 com contagem e último erro

#### Lição aprendida
`"Monthly usage hard limit exceeded"` não contém `"429"` nem `"rate limit"` — a string `"limit exceeded"` e `"usage"` precisam estar explicitamente no `isQuotaError`. Sempre testar o texto exato do erro do Apify antes de definir os critérios de fallback.

#### Lição aprendida: `.call()` com `waitSecs`
Usar `.call(input, { waitSecs: 55 })` faz o SDK retornar o objeto de run com `status: "RUNNING"` quando o ator demora mais de 55s — não lança exceção. Nosso código jogava esse status no catch como erro não-quota, retornando 500 direto em vez de continuar o loop. Solução: remover `waitSecs` do `.call()` e deixar o SDK aguardar a conclusão naturalmente (padrão do SDK). `maxDuration` da rota elevado para 120s para cobrir atores mais lentos.

---

### ✅ Loading Modal de Inspirações (Fase 21)
**Data:** 13/05/2026

#### O que foi feito
- Componente `ImportingModal` inline em `app/dashboard/search/page.tsx`
- Abre imediatamente ao clicar "Buscar Reels" (antes do fetch terminar)
- Barra de progresso simulada: incremento aleatório de 0→95% a cada 350ms; pula para 100% quando API responde
- Spinner CSS (`border-t-cyan-400 animate-spin`) vira verde e para de girar ao completar
- Status items: "Buscando posts via API" (spinner azul → check) + "Processando resultados" (círculo vazio → check)
- Ao sucesso: `modalDone=true` por 700ms (mostra estado done) → fecha modal → exibe grid
- Ao erro: fecha modal imediatamente → exibe toast vermelho
- `InspirationGridSkeleton` removido (substituído pelo modal)
- `status` simplificado para `"idle" | "done" | "error"` (sem `"loading"`, controlado por `showModal`)

#### Lição aprendida: instagrapi 2.x e 2FA
O instagrapi 2.x removeu `two_factor_login()` e mudou `login()` para não aceitar `two_factor_identifier`. A solução correta é chamar `cl.private_request("accounts/two_factor_login/", {...})` diretamente com `csrftoken`, `uuid` e `two_factor_identifier` restaurados da sessão salva. Nunca chamar `cl.login()` novamente num cliente novo para completar 2FA — o Instagram trata o username como email/telefone nesse fluxo e rejeita.

---

### ✅ Fase 22 — Histórico de Pesquisas de Inspirações
**Data:** 13/05/2026
**Commit:** `feat: Fase 22 — histórico de pesquisas com cache no Supabase`

#### O que foi feito
- Nova tabela `scraped_profiles` no Supabase com constraint UNIQUE em `(user_id, username)`
  - Campos: `id`, `user_id`, `username`, `full_name`, `profile_pic_url`, `videos_data` (JSONB), `video_count`, `scraped_at`
  - RLS habilitado: usuário só acessa seus próprios registros
- `app/api/inspirations/scrape/route.ts` agora faz **upsert** em `scraped_profiles` após cada scraping bem-sucedido
  - `scrapeWithToken` retorna `{ reels, fullName, profilePicUrl }` extraindo dados do primeiro item Apify
  - Upsert usa `onConflict: "user_id,username"` para atualizar registros existentes
  - Bloco try/catch independente — falha no upsert nunca impede a resposta de reels ao usuário
- `GET /api/inspirations/history` — retorna todos os perfis do usuário ordenados por `scraped_at desc` (inclui `videos_data` para "Ver Vídeos" instantâneo)
- `DELETE /api/inspirations/history/[id]` — remove registro do histórico, com guard `user_id` para segurança
- `app/dashboard/search/page.tsx` reescrito com duas views:
  - **`view === "history"`**: grid de cards de perfil (`HistoryCard`) com avatar (fallback gradiente+inicial se imagem falhar), username, full_name, video_count, timeAgo, botão "Ver Vídeos", botão de lixeira (aparece no hover)
  - **`view === "grid"`**: grid de reels com botão "← Voltar", igual ao anterior
- Fluxo: nova busca → modal loading → scrape + upsert DB → fecha modal 700ms → view="grid" + refreshHistory()
- "Ver Vídeos" → carrega reels do cache local (sem nova request)
- Lixeira → remoção otimista da UI + DELETE em background
- Skeletons enquanto carrega o histórico inicial (4 cards pulsando)

#### SQL para executar no Supabase Dashboard
```sql
create table if not exists public.scraped_profiles (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  username        text        not null,
  full_name       text        not null default '',
  profile_pic_url text,
  videos_data     jsonb       not null default '[]',
  video_count     integer     not null default 0,
  scraped_at      timestamptz not null default now(),
  constraint uq_scraped_profiles_user_username unique (user_id, username)
);

create index if not exists scraped_profiles_user_id_idx on public.scraped_profiles(user_id);
alter table public.scraped_profiles enable row level security;
create policy "users_manage_own_scraped_profiles"
  on public.scraped_profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

#### Decisão: `videos_data` no SELECT da history list
Incluir o JSONB completo na listagem evita um segundo fetch ao clicar "Ver Vídeos". Para 10-20 perfis × 20 reels cada, o payload estimado é ~100-200KB — aceitável. Se escalar, criar endpoint separado `/api/inspirations/history/[id]/videos` e paginar.

---

### ✅ Proxy de Imagens Instagram (Fase 23)
**Data:** 13/05/2026
**Commit:** `feat: proxy de imagens para contornar CORS/Referrer do CDN do Instagram`

#### Problema
Thumbnails e fotos de perfil do Instagram quebram no browser com erro CORS/Referrer. O CDN (`scontent*.cdninstagram.com`, `fbcdn.net`) valida o header `Referer` da requisição e bloqueia origem fora de `instagram.com`.

#### Solução
Nova rota `GET /api/proxy-image?url=<encoded>`:
- Executa no servidor Node.js (sem CORS)
- Faz `fetch` da URL com headers que simulam browser dentro do Instagram: `Referer: https://www.instagram.com/`, `User-Agent: Mozilla/5.0...`, `sec-fetch-dest: image`
- Devolve os bytes da imagem com `Content-Type` original
- `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` — cache de 1 dia, stale-while-revalidate de 7 dias
- Allowlist de hosts: apenas `cdninstagram.com`, `fbcdn.net`, `instagram.com`, `lookaside.fbsbx.com` — previne uso como proxy genérico (SSRF)
- Retorna 403 para URLs fora da allowlist

#### Componentes atualizados
Todos os `<img src={url}>` onde `url` pode ser do CDN do Instagram foram substituídos por `<img src={/api/proxy-image?url=${encodeURIComponent(url)}} />`:
- `components/inspirations/InspirationCard.tsx` — thumbnail do Reel
- `components/search/ReelCard.tsx` — thumbnail do Reel (seção search)
- `app/dashboard/search/page.tsx` (HistoryCard) — foto de perfil no card de histórico
- `app/dashboard/accounts/page.tsx` — avatar da conta Instagram conectada

---

### ✅ Fix — Cache Busting e Tratamento de Sessão no Histórico de Inspirações
**Data:** 13/05/2026
**Commit:** `fix: cache busting e tratamento de sessão no histórico de Inspirações`

#### Problema
Ao fechar o sistema e entrar novamente, o histórico de pesquisas da página Inspirações aparecia vazio, mesmo com dados no Supabase. A causa era dupla:
1. **Cache do Next.js:** a rota `GET /api/inspirations/history` não tinha diretivas `force-dynamic` nem `revalidate = 0`, então o framework podia servir uma resposta cacheada vazia da sessão anterior.
2. **Falha silenciosa em 401:** quando o cookie de sessão ainda não havia sido restaurado no cliente (race condition na montagem do componente), a API retornava `401` e o frontend simplesmente definia `history = []` sem mostrar feedback nem forçar re-autenticação.

#### Correções aplicadas

**`app/api/inspirations/history/route.ts`**
- Adicionado `export const dynamic = "force-dynamic"` — instrui o Next.js a nunca fazer cache desta rota.
- Adicionado `export const revalidate = 0` — garante que o Next.js não aplique ISR ou revalidação incremental.

**`app/dashboard/search/page.tsx`**
- Ambos os `fetch("/api/inspirations/history")` (montagem + `refreshHistory`) receberam `{ cache: "no-store" }` — impede o cache do browser e do service worker.
- Tratamento de `r.status === 401` adicionado em ambos: `console.warn` + `window.location.href = "/auth/login"` imediato. Isso resolve o caso em que a sessão expirou e elimina a lista silenciosamente vazia.

#### Lição aprendida
Em Next.js 15 com App Router, rotas de API autenticadas que dependem de cookies de sessão devem sempre ter `export const dynamic = "force-dynamic"`. Sem isso, o framework pode memorizar a resposta de um usuário deslogado e servi-la novamente após re-login. Além disso, nunca deixar erros 401 silenciosos em fetches de dados de usuário — sempre redirecionar para login.

---

### ✅ Fase 25 — Página de Contas Refatorada com Dados em Tempo Real
**Data:** 15/05/2026
**Commit:** `feat: Fase 25 — grid de cards em Contas com refresh de dados via Apify`

#### O que foi feito

**Backend — `app/api/accounts/refresh/route.ts`** (nova rota)
- `POST /api/accounts/refresh` recebe `{ accountId }`, valida que o usuário autenticado é dono da conta
- Usa o actor `apify/instagram-scraper` com `resultsType: "details"` na URL de perfil para buscar:
  - `followersCount` (seguidores)
  - `postsCount` (total de posts)
  - `lastPostAt` — extraído de `latestPosts[0].timestamp`
  - `has_active_stories` — **não suportado** pelo actor atual (requer autenticação + ator dedicado); sempre `null`
- Lógica de rotação de tokens idêntica à de Inspirações (`isQuotaError` → próximo token)
- Modo mock (sem tokens Apify): gera dados aleatórios realistas para desenvolvimento local
- Após busca bem-sucedida, faz `UPDATE` em `instagram_accounts` com os novos campos

**Banco de dados — `supabase/schema.sql`**
Adicionadas 5 novas colunas à tabela `instagram_accounts` (execute `ALTER TABLE` se a tabela já existir):
```sql
alter table public.instagram_accounts
  add column if not exists followers_count    integer,
  add column if not exists posts_count        integer,
  add column if not exists last_post_at       timestamptz,
  add column if not exists has_active_stories boolean,
  add column if not exists profile_refreshed_at timestamptz;
```

**Frontend — `app/dashboard/accounts/page.tsx`** (reescrito)
- Layout de lista (`divide-y`) substituído por **grid responsivo** de cards (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`)
- Componente `AccountCard` encapsula cada card com estado local do menu dropdown
- Cada card exibe:
  - **Cabeçalho:** avatar (via proxy) ou inicial com gradiente, `@username`, badge "● ATIVA / INATIVA"
  - **Menu ⋯:** AnimatePresence com click-outside via `useEffect + menuRef`; opções: Atualizar Dados, Ativar/Desativar, Remover
  - **Métricas:** seguidores, posts, último post (`timeAgo`), status online (`profile_refreshed_at`), story ativo (só aparece se `has_active_stories === true`)
- Componente `AccountSkeleton`: 3 cards pulsando durante carregamento
- `fetchAccounts` atualizado para selecionar os 5 novos campos do Supabase
- `handleRefresh(id)`: chama `/api/accounts/refresh` e re-fetcha a lista; guard `_refreshingRef` evita chamadas paralelas
- Helpers `formatNumber` (1K/1M) e `timeAgo` inline no arquivo

#### Limitação documentada: Stories
O actor `apify/instagram-scraper` não expõe dados de stories — eles exigem autenticação e são efêmeros (24h). Para suportar `has_active_stories` no futuro, seria necessário um ator dedicado (ex: `apify/instagram-stories-scraper`) com credenciais de login. O campo já existe na tabela e na interface do frontend, mas sempre virá como `null` por enquanto.

#### Decisão: estado de menu por card (local) vs global
O `menuOpen` é gerenciado dentro de cada `AccountCard` (não no pai) pois cada card tem seu próprio `menuRef` para click-outside. Isso evita um único `openMenuId` no pai que exigiria passar props extras. Com poucas contas (< 10 tipicamente), o overhead de múltiplos `useEffect` é desprezível.

---

### ✅ Fase 26 — Página de Postagens (Agendamento em Massa)
**Data:** 15/05/2026
**Commit:** `feat: Fase 26 — agendamento em massa com algoritmo de distribuição inteligente`

#### O que foi feito

**Backend — `app/api/posts/schedule/route.ts`** (nova rota)
- `POST /api/posts/schedule` recebe `{ video_ids, account_ids, captions, start_datetime, videos_per_batch, interval_hours }`
- **Algoritmo Fisher-Yates:** para cada conta, cria shuffles independentes dos vídeos e das legendas — garante que Conta A não poste o mesmo vídeo da Conta B no mesmo horário
- **Cálculo de lotes:** `batchIndex = floor(i / videos_per_batch)` → `scheduled_at = start + batchIndex × interval_hours × 3.600.000ms`
- **Distribuição de legendas:** round-robin sobre as captions embaralhadas (`i % captions.length`)
- **Inserção em massa:** todos os posts calculados são inseridos num único `admin.from("scheduled_posts").insert(posts)`
- Validações: ao menos 1 vídeo, 1 conta, 1 legenda não-vazia e data de início válida

**Banco de dados**
```sql
-- Adicione se a tabela scheduled_posts já existia antes desta fase:
alter table public.scheduled_posts
  add column if not exists video_url text;
```

**Frontend — `app/dashboard/posts/page.tsx`** (nova página)
4 seções em cartões glassmorphism com step badges numéricos que viram ✓ quando preenchidos:

| Seção | Componente | Comportamento |
|-------|-----------|---------------|
| 1. Vídeos | Grid 4-8 colunas `aspect-[9/16]` | Click para selecionar; borda violet + checkmark overlay; "Todos / Limpar"; max-h com scroll |
| 2. Contas | Grid 1-3 colunas | Mostra apenas contas ativas; avatar via proxy + followers_count |
| 3. Legendas | Textareas dinâmicos com AnimatePresence | Até 10 variações; contador de chars; botão Adicionar |
| 4. Config de Lote | 3 inputs: datetime-local, videosPerBatch, intervalHours | Preview calculado em tempo real com data do último lote |

- **Barra de ação sticky (`sticky bottom-0`)** com fundo gradient fade e rodapé glassmorphism: mostra resumo "X posts · N contas · M lotes" e botão "Agendar X Posts" com Loader2 durante `scheduling`
- **Tela de sucesso:** AnimatePresence com `CheckCircle2`, contadores e links "Agendar Mais" e "Ver Agendamentos"

**Sidebar — `components/dashboard/Sidebar.tsx`**
- Novo item "Postagens" com ícone `CalendarRange` inserido antes de "Agendamento"
- `CalendarRange` = agendamento em intervalo de datas; `CalendarClock` existente = evento pontual

**Header — `components/dashboard/Header.tsx`**
- Adicionado título `"Postagens"` / subtitle `"Agendamento em massa..."` para `/dashboard/posts`

#### Algoritmo de distribuição inteligente — exemplo
```
Vídeos selecionados: [A, B, C, D, E]  |  videos_per_batch: 2  |  interval: 3h
Conta 1 (shuffle): [C, A, E, B, D]
  → Lote 0 (C, A): scheduled_at = T+0h
  → Lote 1 (E, B): scheduled_at = T+3h
  → Lote 2 (D):   scheduled_at = T+6h
Conta 2 (shuffle): [E, D, B, A, C]
  → Lote 0 (E, D): scheduled_at = T+0h   ← vídeo diferente da Conta 1 no mesmo horário ✓
  → Lote 1 (B, A): scheduled_at = T+3h
  → Lote 2 (C):   scheduled_at = T+6h
```

#### SQL para executar no Supabase Dashboard (se tabela já existia)
```sql
alter table public.scheduled_posts
  add column if not exists video_url text;
```

---

### ✅ Fase 27 — Migração para Meta Graph API (OAuth Oficial)
**Data:** 16/05/2026
**Commit:** `feat: Fase 27 — autenticação OAuth oficial via Meta Graph API`

#### Motivação (pivot de arquitetura)
Após análise competitiva, foi decidido abandonar o `instagrapi` (API privada não-oficial) e migrar para a **Meta Graph API** oficial. Benefícios:
- Segurança: fluxo OAuth 2.0 padrão — nenhuma senha armazenada
- Estabilidade: endpoint oficial, sem risco de bloqueio por mudanças internas do Instagram
- Compliance: conformidade com os Termos de Uso da plataforma
- Suporte a contas **Business** e **Creator** (Professional Accounts)

#### Banco de dados — novas colunas em `instagram_accounts`
```sql
alter table public.instagram_accounts
  add column if not exists meta_access_token      text,
  add column if not exists ig_business_account_id text,
  add column if not exists fb_page_id             text,
  add column if not exists token_expires_at       timestamptz;
```

#### Rotas de API criadas

**`app/api/meta/auth/route.ts`** — inicia o fluxo OAuth
- `GET /api/meta/auth`: gera `state` UUID, armazena em cookie httpOnly com TTL de 10 minutos, redireciona para `https://www.facebook.com/v19.0/dialog/oauth`
- Escopos solicitados: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`
- Variáveis necessárias: `NEXT_PUBLIC_META_CLIENT_ID`, `NEXT_PUBLIC_APP_URL`

**`app/api/meta/callback/route.ts`** — processa o retorno do Facebook
1. Trata cancelamento (`?error=...`)
2. Verifica CSRF via comparação `state` vs cookie `meta_oauth_state`
3. Troca `code` por User Access Token (short-lived) via `POST /oauth/access_token`
4. Troca short token por Long-Lived Token (~60 dias) via `GET /oauth/access_token?grant_type=fb_exchange_token`
5. Consulta `GET /me/accounts` com campos `instagram_business_account{id,username,name,profile_picture_url}` para listar Páginas FB e suas contas IG Business vinculadas
6. Salva/atualiza cada conta em `instagram_accounts` (select + insert/update manual, sem constraint UNIQUE)
7. Redireciona para `/dashboard/accounts?connected=N`
- Variáveis necessárias: `META_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`

#### Frontend — `app/dashboard/accounts/page.tsx`
- **Removido:** modal de credenciais (username/password) + fluxo 2FA completo + todos os estados associados
- **Adicionado:** botão "Conectar conta" faz `window.location.href = '/api/meta/auth'` (navegação completa, não fetch)
- **Adicionado:** banner informativo azul explicando o fluxo OAuth e exigência de conta Business/Creator
- **Adicionado:** badge `META API` (azul) nos cards de contas conectadas via Graph API (`ig_business_account_id` preenchido)
- **Adicionado:** sistema de notificação que lê `?connected=N` ou `?error=...` da URL após o callback, exibe banner de sucesso/erro e limpa a URL com `history.replaceState`
- `Account` interface: novo campo `ig_business_account_id`
- `fetchAccounts`: inclui `ig_business_account_id` no SELECT

#### Variáveis de ambiente necessárias
```env
# Meta for Developers → Meu App → Configurações → Básico
NEXT_PUBLIC_META_CLIENT_ID=   # App ID (público — aparece no client side)
META_CLIENT_SECRET=           # App Secret (secreto — nunca expor no frontend)
NEXT_PUBLIC_APP_URL=          # URL base (ex: https://autoscale.vercel.app ou http://localhost:3000)
```

#### Configuração no Meta for Developers
1. Criar app em https://developers.facebook.com → Tipo: Business
2. Adicionar produto: **Instagram Graph API**
3. Em "Facebook Login" → "Configurações": adicionar URI de redirecionamento válido:
   - Produção: `https://sua-url.vercel.app/api/meta/callback`
   - Desenvolvimento: `http://localhost:3000/api/meta/callback`
4. Solicitar as permissões: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`
5. Em produção: submeter para revisão da Meta para usar permissões avançadas

#### Segurança implementada
- **CSRF:** `state` UUID gerado no servidor, salvo em cookie httpOnly (SameSite=Lax, TTL 10min), verificado no callback
- **Client Secret:** nunca exposto no frontend (somente em variáveis server-side sem `NEXT_PUBLIC_`)
- **Token expirado:** campo `token_expires_at` salvo para futuro refresh automático
- **Usuário cancelou:** `?error=access_denied` → redirect para accounts com mensagem amigável

#### Fluxo completo
```
Usuário → "Conectar conta" → GET /api/meta/auth
  → redireciona para Facebook (dialog OAuth)
  → usuário autoriza
  → Facebook redireciona para GET /api/meta/callback?code=...&state=...
  → troca code por short token → long-lived token
  → busca Páginas FB + contas IG Business vinculadas
  → salva em instagram_accounts
  → redireciona para /dashboard/accounts?connected=N
```

#### Limitação: contas pessoais
A Meta Graph API **não suporta** contas pessoais (apenas Business e Creator). Contas pessoais precisam ser convertidas em Professional Account no Instagram antes de conectar.

#### Decisão: manter rotas legadas do instagrapi
As rotas `/api/accounts/login`, `/api/accounts/verify` e o servidor FastAPI continuam no codebase. A remoção será feita em fase futura após validar o fluxo Meta em produção. `/api/posts/publish` foi atualizado na Fase 28 para rotear automaticamente entre Meta API e instagrapi.

---

### ✅ Fase 28 — Publicação via Meta Graph API
**Data:** 17/05/2026
**Commit:** `feat: Fase 28 — publicação de posts via Meta Graph API`

#### O que foi feito

**`lib/meta-publish.ts`** (novo helper compartilhado)
- `publishViaMetaAPI(igBusinessAccountId, metaAccessToken, videoUrl, caption)` — encapsula o fluxo de 3 etapas
- Etapa 1: `POST /{ig-id}/media` com `media_type=REELS`, `video_url`, `caption` → retorna `creation_id`
- Etapa 2: poll `GET /{creation_id}?fields=status_code` a cada 10s (5s inicial) até `status_code=FINISHED` — timeout em 12 tentativas (~2 min)
- Etapa 3: `POST /{ig-id}/media_publish` com `creation_id` → retorna `media_id`
- Retorna `MetaPublishResult { status: "ok"|"error", media_id?, error? }`

**`app/api/meta/publish/route.ts`** (novo endpoint)
- `POST /api/meta/publish` com `{ account_id, video_url, caption }`
- Verifica autenticação Supabase + busca `meta_access_token` e `ig_business_account_id` da conta
- `maxDuration = 120` para suportar o polling de até 2 minutos

**`app/api/posts/publish/route.ts`** (atualizado)
- SELECT de contas agora inclui `meta_access_token, ig_business_account_id`
- Por conta: se tem `meta_access_token` → usa `publishViaMetaAPI` (Meta Graph API); senão → usa instagrapi (legacy)
- Suporta mix: algumas contas Meta, outras instagrapi na mesma chamada

**`app/api/accounts/list/route.ts`** (atualizado)
- SELECT agora inclui `ig_business_account_id` para o frontend identificar contas Meta

**`components/library/PostModal.tsx`** (atualizado)
- Interface `Account`: novo campo `ig_business_account_id: string | null`
- `hasSession` = `!!access_token || !!ig_business_account_id` (ambos tipos habilitam o botão)
- Badge `META` azul nos cards de contas conectadas via Graph API
- Removido aviso "instagrapi funciona apenas localmente" (Meta API funciona em produção)

#### Fluxo de publicação via Meta Graph API
```
PostModal → /api/posts/publish
  → conta tem meta_access_token?
    sim → publishViaMetaAPI(ig_business_account_id, meta_access_token, video_url, caption)
           → POST /v19.0/{ig-id}/media (cria container REELS)
           → poll status_code a cada 10s até FINISHED
           → POST /v19.0/{ig-id}/media_publish
           → retorna media_id
    não → instagrapi (FastAPI ou child_process)
```

#### Limitação do fluxo Meta API
- O `video_url` deve ser uma URL publicamente acessível (bucket Supabase Storage é público ✓)
- Apenas contas Business/Creator (já documentado na Fase 27)
- Tokens expiram em ~60 dias — renovação automática implementada na Fase 29

---

### ✅ Fase 29 — Refresh Automático de Token Meta
**Data:** 18/05/2026
**Commit:** `feat: Fase 29 — refresh automático de token Meta`

#### O que foi feito

**`lib/meta-refresh.ts`** (novo helper)
- `refreshMetaToken(currentToken)` — chama `GET /oauth/access_token?grant_type=fb_exchange_token` na Graph API, retorna `{ token, expiresAt }` com novo Long-Lived Token (~60 dias)
- `isTokenExpiringSoon(tokenExpiresAt, thresholdDays)` — retorna `true` se o token expira dentro de `thresholdDays` dias (padrão: 7) ou já expirou

**`app/api/meta/refresh-token/route.ts`** (novo endpoint)
- `POST /api/meta/refresh-token` com `{ account_id }`
- Verifica autenticação Supabase + ownership da conta
- Chama `refreshMetaToken`, salva novo token e `token_expires_at` no banco
- Usado tanto pelo frontend (manual) quanto pela lógica de auto-refresh na carga da página

**`app/api/meta/publish/route.ts`** (atualizado)
- SELECT inclui `token_expires_at`
- Antes de publicar: `isTokenExpiringSoon(token_expires_at, 7)` → se verdadeiro, chama `refreshMetaToken` e atualiza DB; usa novo token na publicação
- Falha no refresh não bloqueia publicação (warn + continua com token atual)

**`app/api/posts/publish/route.ts`** (atualizado)
- SELECT inclui `token_expires_at` para contas Meta
- Mesma lógica de auto-refresh antes de chamar `publishViaMetaAPI` para cada conta Meta

**`app/dashboard/accounts/page.tsx`** (atualizado)
- `Account` interface: novo campo `token_expires_at: string | null`
- Helpers `daysUntilExpiry` e `tokenStatusChip` para calcular status do token
- Badge de status no cabeçalho de cada card Meta:
  - Chip âmbar "Expira em Xd" para 8–15 dias restantes
  - Chip vermelho "Expira em Xd" para ≤ 7 dias restantes
  - Chip vermelho "Token expirado" se já expirou
  - Sem chip se token saudável (> 15 dias)
- Menu dropdown de cada card Meta: novo item "Renovar Token" (ícone `KeyRound` violeta)
- `handleRefreshToken` — chama `/api/meta/refresh-token`, atualiza `token_expires_at` local na UI sem re-fetch
- Auto-refresh na carga da página: após o primeiro `fetchAccounts`, detecta contas com token expirando em < 7 dias e renova silenciosamente; exibe banner de sucesso se renovações ocorreram

#### Fluxo de renovação
```
Carga da página Contas
  → fetchAccounts()
  → detecta tokens expirando em < 7 dias
  → POST /api/meta/refresh-token para cada conta
  → atualiza DB + exibe banner "X tokens renovados automaticamente"

Publicação (PostModal / botão Postar)
  → /api/posts/publish ou /api/meta/publish
  → isTokenExpiringSoon(token_expires_at, 7) ?
    sim → refreshMetaToken → salva novo token no DB → usa novo token
    não → usa token atual

Manual (menu ⋯ → "Renovar Token")
  → POST /api/meta/refresh-token
  → atualiza token_expires_at na UI
  → exibe "Token Meta renovado com sucesso!"
```

#### Decisão: renovar preventivamente em 7 dias, não no dia da expiração
Tokens Meta podem demorar algumas horas para propagar. Renovar com 7 dias de antecedência garante margem contra falhas temporárias na API do Facebook sem ser excessivamente agressivo (não renovar todo dia).

---

### ✅ Fase 30 — Executor de Posts Agendados (Vercel Cron)
**Data:** 18/05/2026
**Commit:** `feat: Fase 30 — executor de posts agendados via Vercel Cron`

#### O que foi feito

**`supabase/schema.sql`** (atualizado)
- Check constraint de `status` recriado para incluir `'publishing'` (travamento atômico)
- Colunas adicionadas: `published_at timestamptz`, `media_id text`
- Índice parcial `scheduled_posts_cron_idx ON (scheduled_at) WHERE status IN ('pending','publishing')` — acelera a query do cron

**`app/api/cron/publish-scheduled/route.ts`** (novo endpoint)
- `POST /api/cron/publish-scheduled` — protegido por `Authorization: Bearer CRON_SECRET`
- `runtime = "nodejs"`, `maxDuration = 300` (5 minutos para batch de até 20 posts)
- Fluxo por post:
  1. **Claim atômico**: `UPDATE status='publishing' WHERE id=? AND status='pending'` — previne dupla publicação em invocações concorrentes
  2. Validação: conta ativa + `video_url` disponível
  3. **Meta API**: auto-refresh de token se < 7 dias → `publishViaMetaAPI` → atualiza `status='published'`, `published_at`, `media_id`
  4. **instagrapi (fallback)**: se `PYTHON_SERVER_URL` configurado, chama FastAPI `/posts/publish`
  5. Qualquer erro → `status='failed'`, `error_message` salvo
- Retorna `{ ok, total, published, failed, skipped }`

**`vercel.json`** (novo arquivo)
```json
{
  "crons": [{ "path": "/api/cron/publish-scheduled", "schedule": "0 * * * *" }]
}
```
Executa a cada hora no minuto 0. Requer plano Vercel Pro para intervalos menores que 1 hora.

#### Variável de ambiente necessária
```env
CRON_SECRET=<gerar com: openssl rand -hex 32>
```
Adicionar em `.env.local` (dev) e nas variáveis de ambiente do Vercel (produção).

#### Configuração no Supabase Dashboard (se a tabela já existia)
```sql
-- Recriar constraint com 'publishing'
do $$
begin
  alter table public.scheduled_posts drop constraint if exists scheduled_posts_status_check;
  alter table public.scheduled_posts add constraint scheduled_posts_status_check
    check (status in ('pending', 'publishing', 'published', 'failed', 'cancelled'));
exception when others then null;
end $$;

alter table public.scheduled_posts
  add column if not exists published_at timestamptz,
  add column if not exists media_id     text;

create index if not exists scheduled_posts_cron_idx
  on public.scheduled_posts(scheduled_at) where status in ('pending', 'publishing');
```

#### Teste manual do cron
```bash
curl -X POST https://autoscale.vercel.app/api/cron/publish-scheduled \
  -H "Authorization: Bearer <CRON_SECRET>"
```

#### Fluxo completo
```
[Horário X] Usuário agenda post via /dashboard/posts
  → scheduled_posts: { status: 'pending', scheduled_at: X }

[Toda hora] Vercel dispara POST /api/cron/publish-scheduled
  → busca posts pending com scheduled_at <= now()
  → claim atômico: status = 'publishing'
  → publica via Meta API (ou instagrapi)
  → status = 'published' + published_at + media_id
  → ou status = 'failed' + error_message
```

#### Decisão: claim atômico com status 'publishing'
Sem o status intermediário, duas execuções paralelas do cron (possível se o job leva mais de 1 hora) publicariam o mesmo post duas vezes. O UPDATE com `WHERE status='pending'` é atômico no PostgreSQL — apenas uma das execuções consegue "reclamar" cada post.

---

### ✅ Fase 31 — Gestão de Agendamentos
**Data:** 18/05/2026
**Commit:** `feat: Fase 31 — gestão de agendamentos com status real`

#### O que foi feito

**`app/dashboard/schedule/page.tsx`** (reescrito completamente)
- Substituiu o wizard legado com contas mock pela tela de gestão real
- Usa o cliente Supabase browser com RLS — só exibe posts do usuário autenticado
- SELECT com joins: `instagram_accounts(username, display_name, avatar_url)` + `videos_library(filename, public_url)` + todos os campos novos (`published_at`, `media_id`, `error_message`)
- **Tabs de filtro**: Todos | Pendentes | Publicando | Publicados | Com falha | Cancelados — tabs com contadores, apenas exibidas quando count > 0
- **PostRow**: thumbnail 9:16 com gradiente por conta, badge de status, data agendada + tempo relativo ("em 2h" / "publicado 3h atrás"), box de erro para posts failed, botões de ação
- **Ações**:
  - Cancelar (pending → cancelled): update otimista local + Supabase
  - Reagendar (failed → pending): reseta error_message, nova tentativa no próximo cron
  - Remover (cancelled/failed/published): DELETE + remove do estado local
- **Auto-refresh a cada 15s** enquanto houver posts com `status = 'publishing'` — mostra indicador animado
- **Header** com contadores reais e link "Novo agendamento" → `/dashboard/posts`
- Skeletons de loading (4 linhas pulsando) enquanto busca dados

**`components/dashboard/Sidebar.tsx`**
- "Agendamento" → "Agendamentos"

**`components/dashboard/Header.tsx`**
- Título: "Agendamentos" | Subtitle: "Acompanhe o status de todos os posts agendados"

#### Ciclo completo do agendamento (Fases 26 + 30 + 31)
```
/dashboard/posts  → cria N posts agendados (status='pending') no Supabase
/dashboard/schedule → usuário vê a fila, pode cancelar ou reagendar
Vercel Cron (1×h)   → publica posts vencidos, atualiza status → 'published'/'failed'
/dashboard/schedule → auto-refresh mostra status final com media_id ou erro
```

---

### ✅ Fase 32 — Analytics de Posts Publicados
**Data:** 18/05/2026
**Commit:** `feat: Fase 32 — analytics de posts publicados via Meta API`

#### O que foi feito

**`app/api/meta/insights/route.ts`** (novo endpoint)
- `POST /api/meta/insights` com `{ post_id }`
- **Métricas básicas** (`instagram_basic` — já disponível): `GET /{media-id}?fields=like_count,comments_count`
- **Métricas avançadas** (`instagram_manage_insights` — requer reconexão das contas): `GET /{media-id}/insights?metric=reach,plays,shares,saved&period=lifetime` — falha graciosamente se permissão não concedida
- Salva resultados nas novas colunas de `scheduled_posts` e retorna `{ ok, metrics }`

**`app/api/analytics/summary/route.ts`** (novo endpoint)
- `GET /api/analytics/summary` — lista todos os posts publicados do usuário com joins, calcula totais agregados de todas as métricas

**`app/dashboard/analytics/page.tsx`** (nova página)
- 7 cards de resumo: Publicados, Curtidas, Comentários, Alcance, Plays, Shares, Salvos
- Grid de PostRow: thumbnail, conta, data publicação, legenda, métricas por linha, botão "Atualizar" individual
- Botão "Atualizar todos" no header da página
- Aviso ambar explicando que Alcance/Plays/Shares/Salvos exigem `instagram_manage_insights`
- Empty state quando não há posts publicados

**`app/api/meta/auth/route.ts`** (atualizado)
- Adicionado `instagram_manage_insights` ao escopo OAuth — contas precisam ser reconectadas para habilitar métricas avançadas

#### SQL para executar no Supabase Dashboard
```sql
alter table public.scheduled_posts
  add column if not exists insights_likes      integer,
  add column if not exists insights_comments   integer,
  add column if not exists insights_reach      integer,
  add column if not exists insights_plays      integer,
  add column if not exists insights_shares     integer,
  add column if not exists insights_saved      integer,
  add column if not exists insights_fetched_at timestamptz;
```

#### Decisão: buscar métricas sob demanda (não automático)
Métricas não são buscadas automaticamente ao publicar para evitar latência extra no cron. O usuário clica "Atualizar" por post ou "Atualizar todos" quando quiser ver os dados — dá controle e evita rate limit da Meta API.

#### Permissão `instagram_manage_insights`
Esta permissão requer **App Review** pela Meta para apps em produção (não-development). No modo Development, funciona para contas de teste. Contas existentes precisam ser reconectadas via OAuth para incluir o novo escopo.

---

### ✅ Fase 33 — Múltiplos Meta Apps
**Data:** 18/05/2026
**Commits:** `feat: Fase 33 — múltiplos Meta Apps para contingência e distribuição de carga` + `fix: corrige montagem da URL OAuth do Instagram Login`

#### Motivação
Contingência e distribuição de carga: se um app Meta atingir limite de rate, bater em quota de tokens ou for bloqueado, outro app assume imediatamente. O usuário escolhe qual app usar ao conectar cada conta.

#### Arquitetura

**`lib/meta-apps.ts`** (novo helper central)
- `getMetaApps()` — lê `META_APP{N}_CLIENT_ID`, `META_APP{N}_CLIENT_SECRET`, `META_APP{N}_NAME` do env (N=1..10); fallback retrocompatível: se `META_APP1_*` ausente, usa `NEXT_PUBLIC_META_CLIENT_ID` + `META_CLIENT_SECRET`
- `getMetaApp(id)` — busca app pelo id (`"app1"`, `"app2"`, etc.)

**`GET /api/meta/apps`** (novo endpoint)
- Retorna `[{id, name}]` sem secrets — consumido pelo frontend para montar o modal

**`GET /api/instagram/auth?app_id=appN`** (atualizado)
- Aceita `app_id` explícito; se ausente, usa o primeiro app disponível
- State codificado como `"{appId}:{uuid}"` — permite ao callback identificar qual app foi usado sem estado servidor

**`GET /api/meta/callback`** (atualizado)
- Extrai `appId` do state fazendo `indexOf(":")` + `substring(0, colonIdx)`
- Busca credenciais via `getMetaApp(appId)` — usa `client_id` e `client_secret` corretos para a troca de token
- Salva `meta_app_used: appId` na coluna nova do banco

**`app/dashboard/accounts/page.tsx`** (atualizado)
- Carrega lista de apps via `GET /api/meta/apps` na montagem
- `handleConnectClick`: se `apps.length > 1` → abre `AppSelectModal`; se 1 app → redireciona direto sem modal
- `AppSelectModal`: lista glassmorphism com número do app, nome, id (mono) e chevron; clique redireciona para `/api/instagram/auth?app_id=appN`

#### Variáveis de ambiente
```env
# App 1 (retrocompatível com variáveis já existentes)
META_APP1_CLIENT_ID=       # ou NEXT_PUBLIC_META_CLIENT_ID como fallback
META_APP1_CLIENT_SECRET=   # ou META_CLIENT_SECRET como fallback
META_APP1_NAME=AutoPost 1  # opcional

# Apps adicionais
META_APP2_CLIENT_ID=...
META_APP2_CLIENT_SECRET=...
META_APP2_NAME=AutoPost 2
```

#### SQL para executar no Supabase
```sql
alter table public.instagram_accounts
  add column if not exists meta_app_used text;
```

#### Bug crítico corrigido: URL OAuth com %2C no scope
`URLSearchParams` codifica vírgulas como `%2C`. O endpoint `api.instagram.com/oauth/authorize` espera vírgulas literais no parâmetro `scope` — com `%2C` retornava 404 direto.

**Antes (quebrado):**
```ts
const params = new URLSearchParams({ scope: "instagram_business_basic,..." });
// → scope=instagram_business_basic%2C...  ← 404
```

**Depois (correto):**
```ts
const oauthUrl =
  `https://api.instagram.com/oauth/authorize` +
  `?client_id=${app.clientId}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}` +
  `&scope=${SCOPES}` +           // ← vírgulas literais
  `&response_type=code` +
  `&state=${encodeURIComponent(state)}`;
```

Regra: para OAuth do Instagram Login API, **nunca usar `URLSearchParams` para montar a URL inteira** — usar concatenação manual com `encodeURIComponent` apenas em `redirect_uri` e `state`.

---

### ✅ Fase 37 — Estrutura de Pastas na Biblioteca de Mídia
**Data:** 20/05/2026
**Commit:** `feat: add folders structure to media library for future looping integration`

#### Objetivo
Adicionar suporte a pastas na biblioteca de vídeos, preparando a infraestrutura para o módulo de Looping (que usará pastas como fontes de conteúdo).

#### O que foi feito

**Banco de dados (`supabase/library_folders.sql`)**
- Nova tabela `library_folders` (id, user_id, name, created_at) com RLS `users_manage_own_folders`
- Coluna `folder_id uuid` adicionada em `videos_library` com FK para `library_folders.id ON DELETE SET NULL`
  - `ON DELETE SET NULL` garante que deletar uma pasta move os vídeos de volta à raiz automaticamente

**APIs novas**
- `GET /api/library/folders` — lista pastas do usuário autenticado
- `POST /api/library/folders` — cria pasta
- `PATCH /api/library/folders/[id]` — renomeia pasta
- `DELETE /api/library/folders/[id]` — deleta pasta (vídeos → raiz via SET NULL)

**APIs atualizadas**
- `GET /api/library`: aceita `?folderId=root` (IS NULL) ou `?folderId=<uuid>`. Filtra em JS após fetch para evitar problemas com colunas fora dos tipos TypeScript gerados
- `PATCH /api/library`: move vídeo entre pastas (`{ id, folder_id }`)
- `POST /api/library/record`: aceita `folderId` opcional no body do upload

**UI (`app/dashboard/library/page.tsx`)**
- Cabeçalho com breadcrumbs (Biblioteca > [Nome da pasta]) e botão "+ Nova Pasta"
- Grid de cards de pastas com gradientes coloridos rotativos, ícone de pasta grande, botão de excluir no hover
- Navegação ao clicar em pasta: mostra apenas vídeos com aquele `folder_id`
- Separador "Vídeos na raiz" entre pastas e vídeos
- Upload ciente do contexto: se estiver dentro de uma pasta, o `folderId` é passado automaticamente para `/api/library/record`
- Modal "Nova Pasta" com input + tecla Enter
- Modal "Mover vídeo" com lista de pastas + opção "Raiz (sem pasta)"
- Modal de confirmação antes de deletar pasta

**`components/library/VideoCard.tsx`**
- Interface `LibraryVideo` recebe `folder_id?: string | null`
- Nova prop `onMove?: (video: LibraryVideo) => void`
- Botões "Agendar" e "Mover" ficam em grid 2 colunas no hover overlay

#### Decisão de design
`folder_id` não existe nos tipos TypeScript gerados do Supabase. Para o GET foi escolhido filtrar em JavaScript (em vez de monkey-patching do query builder) — mais legível e seguro para uma biblioteca de tamanho razoável. Para o PATCH/INSERT, é usado `as unknown as Record<string, unknown>` conforme padrão já documentado no projeto.

---

## Fase 38 — Módulo de Looping (`/dashboard/loop`)

**Commit:** `feat: build looping configuration UI and database schema`

**Problema resolvido:** Necessidade de um módulo central de looping para publicação automatizada e recorrente de conteúdo para múltiplas contas do Instagram.

**Schema SQL** (`supabase/loops.sql`)
- Tabela `loops`: `id`, `user_id`, `folder_id` (FK → `library_folders`, ON DELETE SET NULL), `name`, `is_infinite`, `cycles`, `interval_minutes`, `captions` (text[]), `cover_image_url`, `effect_mirror`, `effect_invert`, `status` (active/paused), `created_at`, `updated_at`
- Tabela `loop_accounts`: junction N:N entre `loops` e `instagram_accounts` (ON DELETE CASCADE em ambas as FKs)
- RLS habilitado em ambas, policies via `auth.uid() = user_id` (loops) e EXISTS subquery (loop_accounts)
- Trigger `loops_updated_at` para atualizar `updated_at` automaticamente

**APIs novas**
- `GET /api/loops` — lista loops do usuário com join `loop_accounts(instagram_accounts)` e `library_folders`
- `POST /api/loops` — cria loop + insere loop_accounts em bulk
- `PATCH /api/loops/[id]` — atualiza campos escalares e substitui lista de contas
- `DELETE /api/loops/[id]` — remove loop (cascade para loop_accounts)

**UI (`app/dashboard/loop/page.tsx`)**
- Layout split: lista de cards à esquerda + botão "+ Novo Loop"
- `LoopCard` com badge de status (ativo/pausado), contagem de contas, intervalo humanizado, pasta vinculada
- `LoopFormModal`: modal completo com todos os campos do schema
- `AccountsMultiSelect`: dropdown custom com checkboxes para selecionar múltiplas contas Instagram
- Slider de intervalo com preenchimento visual via `linear-gradient` no `style` inline
- Upload de capa para bucket `videos-library` sob path `covers/`
- `.range-slider` adicionado ao `globals.css` com thumb violet customizado

**Decisão técnica:** Novas tabelas não presentes nos tipos gerados do Supabase são acessadas via `getSupabaseAdmin() as any`. Padrão já estabelecido na Fase 37.

**Sidebar** reorganizada em grupos: MENU, POSTAGENS (Contas, Postar, Automatizar, Loop), CONTEÚDOS (Biblioteca), CONFIGURAÇÃO (Meus Apps, Failover, Horário Humano).

---

## Fase 39 — Motor de Execução de Loops (Cron Job)

**Commit:** `feat: implement background cron job to process active loops`

**Problema resolvido:** A UI de loops existia mas sem executor — os loops precisam de um motor que rode periodicamente e publique os vídeos automaticamente.

**Arquivos criados/modificados**
- `app/api/cron/process-loops/route.ts` — rota de cron (GET, requerido pelo Vercel)
- `supabase/loops_cron_migration.sql` — migration para as 3 novas colunas + constraint expandida
- `vercel.json` — crons configurados: `/api/cron/publish-scheduled` (horário) + `/api/cron/process-loops` (a cada 10 min)

**Colunas adicionadas à tabela `loops`** (executar `loops_cron_migration.sql` no Supabase)
- `last_posted_at timestamptz` — quando o loop foi executado pela última vez
- `last_media_index int DEFAULT 0` — índice round-robin do próximo vídeo a postar
- `cycles_done int DEFAULT 0` — quantos ciclos de publicação já foram completados

**Status `completed` adicionado** à constraint de `status` (antes era apenas `active`/`paused`).

**Fluxo do Motor**
1. Busca todos os loops com `status = 'active'`
2. Filtra em JS os elegíveis: `last_posted_at IS NULL` ou `now >= last_posted_at + interval_minutes`
3. Para cada loop elegível:
   - Busca vídeos da pasta vinculada ordenados por `created_at`
   - Seleciona vídeo no índice `last_media_index % total`
   - Sorteia legenda aleatória do array `captions`
   - Chama `processVideoEffects` (stub — retorna URL original, documentado para Worker futuro)
   - Publica via `publishViaMetaAPI` para cada conta, com auto-refresh de token
   - Incrementa `cycles_done`, avança `last_media_index`, atualiza `last_posted_at`
   - Se `!is_infinite && cycles_done >= cycles` → `status = 'completed'`

**Decisão técnica — `processVideoEffects` como stub**
Efeitos de vídeo (espelhar/inverter) requerem FFmpeg com operações longas que excedem o limite de 300s do Vercel. A função tem assinatura final (recebe `videoUrl, effectMirror, effectInvert`, retorna `string`) mas retorna a URL original até que um Worker dedicado seja configurado. Comentários no código documentam o fluxo esperado (enqueue → Worker processa → upload Storage → retorna nova URL).

---

### ✅ Fix Admin — Aprovação + Impersonação (2026-05-20)
**Commits:** `fix: persist user approval status...` + `fix: server-side session exchange for impersonation`

#### Bug 1 — Aprovação não persistia após F5

**Sintoma:** Clicar em "Aprovar" na tabela de usuários admin mostrava sucesso, mas ao recarregar a página o status voltava para "pendente".

**Causa raiz:** `.update().eq()` do Supabase retorna `{ error: null }` mesmo quando 0 linhas são afetadas (usuário sem linha em `user_roles`). O campo `account_status` era atualizado na memória da UI mas não no banco.

**Solução:** Adicionar `.select("user_id")` ao `.update()` para detectar 0 rows, depois fallback para `.insert()` se necessário. Adicionado `revalidatePath('/admin/users')` + `export const dynamic = 'force-dynamic'` na rota de listagem.

#### Bug 2 — Impersonação redirecionava para `http://localhost:3000/#access_token=...`

**Sintoma:** Clicar em "Impersonar" abria uma URL do tipo `http://localhost:3000/#access_token=eyJhbG...` — sessão não criada corretamente.

**Causa raiz:** A implementação anterior usava `admin.auth.admin.generateLink({ redirectTo: prodUrl })`. O Supabase ignora `redirectTo` se a URL não estiver cadastrada em "Allowed Redirect URLs" do projeto, e cai de volta para o Site URL (configurado como `http://localhost:3000`) com o fluxo de token implícito via hash.

**Solução (server-side token exchange):**
1. `generateLink({ type: "magiclink", email })` → obtém `hashed_token`
2. `createServerClient` com `setAll` escrevendo nos cookies da `NextResponse`
3. `targetClient.auth.verifyOtp({ token_hash, type: "email" })` → cria sessão real no servidor
4. Retorna `{ redirectTo: "/dashboard" }` — cliente faz `window.location.href`

Nenhuma requisição passa pelo Supabase no browser; a sessão já chega nos cookies da resposta HTTP.

---

### ✅ Perf — Otimização de Performance (2026-05-20)
**Commit:** `perf: optimize database queries, add indexes and reduce re-renders`

#### Indexes SQL
15 indexes criados em `supabase/performance_indexes.sql` cobrindo todas as FK columns e colunas frequentemente filtradas: `instagram_accounts`, `scheduled_posts`, `loops`, `loop_accounts`, `single_posts`, `single_post_accounts`, `videos_library`.

#### Filtro server-side na Biblioteca
`/api/library` antes carregava todos os vídeos do usuário e filtrava em JS. Agora:
- `folder_id = null` → `.is("folder_id", null)` (vídeos sem pasta)
- `folder_id = <uuid>` → `.eq("folder_id", id)` (pasta específica)
- DELETE de vídeo passa a ser paralelo via `Promise.all([storage.remove, db.delete])`

#### Fetches paralelos no Loop
Loop page antes fazia 3 fetches sequenciais no `useEffect`. Substituídos por `Promise.all([fetchLoops(), fetchFolders, fetchAccounts])`.

---

### ✅ Fase 41 — Horário Humano / Anti-Shadowban (2026-05-20)
**Commit:** `feat: implement human schedule settings and integrate with loop cron job`

#### Objetivo
Evitar shadowban publicando apenas dentro de uma janela de horário que imita comportamento humano natural.

#### Banco de dados
```sql
create table public.human_schedule_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default false,
  start_time time not null default '07:00',
  end_time time not null default '23:00',
  timezone text not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now()
);
```
Arquivo: `supabase/human_schedule.sql`

#### API
- `GET /api/human-schedule` — retorna configurações do usuário (ou defaults se sem linha)
- `PUT /api/human-schedule` — upsert via admin client

#### UI (`/dashboard/human-schedule`)
- Relógio ao vivo na timezone selecionada (Intl.DateTimeFormat, atualiza a cada 1s)
- Badge "Dentro da janela" / "Fora da janela" em tempo real
- Toggle para ativar/desativar
- Inputs de horário início/fim
- Barra visual de progresso da janela ativa
- 3 presets rápidos: Comercial (08–22), Noturno (18–02), Pleno dia (06–24)
- Seletor de timezone agrupado por continente (América, Europa, Ásia, África, Oceania)
- Auto-save com debounce de 1.2s — sem botão "Salvar"

#### Integração com Loop Cron
`/api/cron/process-loops` busca configurações de todos os users com loops ativos em um único `.in()`, cria um `Map<userId, settings>`. Para cada loop, antes de publicar:
```typescript
if (schedule?.is_active) {
  const allowed = isWithinHumanSchedule(now, schedule.timezone, schedule.start_time, schedule.end_time);
  if (!allowed) { summary.skipped++; continue; }
}
```
`isWithinHumanSchedule` usa `Intl.DateTimeFormat` puro (sem deps externas) — failsafe: retorna `true` em caso de erro de timezone para não bloquear publicação.

---

### ✅ Fase 42 — Mobile Responsivo (2026-05-20)
**Commit:** `style: make dashboard and core features fully responsive for mobile devices`

#### Problema
O dashboard não tinha suporte mobile — sidebar ocupava 240px da tela, sem hamburger, sem drawer.

#### Arquitetura

**`DashboardShell` (novo — `components/dashboard/DashboardShell.tsx`)**
Client component que centraliza o estado `mobileOpen`. Substitui o Sidebar+Header direto no layout server component.
```tsx
const [mobileOpen, setMobileOpen] = useState(false);
<Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
<Header onMobileMenuToggle={() => setMobileOpen(v => !v)} />
```

**`Header` (`components/dashboard/Header.tsx`)**
- Hamburger `Menu` icon + logo strip — visíveis apenas no mobile (`md:hidden`)
- Título da página — visível apenas no desktop (`hidden md:block`)
- Altura responsiva: `h-14 md:h-16`

**`Sidebar` (`components/dashboard/Sidebar.tsx`)**
- Desktop aside: `hidden md:flex` — não renderiza no mobile
- Props novas: `mobileOpen?: boolean`, `onMobileClose?: () => void`
- Drawer mobile via portal (`createPortal`):
  - `AnimatePresence` com backdrop (`opacity: 0 → 1`) e painel (`x: -100% → 0`)
  - Largura 280px, `z-index: 260`
  - Fecha ao clicar no backdrop ou em qualquer link de navegação
  - Conteúdo sempre "expandido" (sem collapsed state no mobile)
  - Botão de logout simplificado no rodapé

**Tabela de Apps**
`AppsTable` envolto em `overflow-x-auto` para evitar overflow horizontal em telas pequenas.

---

### ✅ Fase 43 — Sistema de Failover Automático (2026-05-20)
**Commit:** `feat: implement account failover system with automatic redundancy`

#### O que foi feito

**Schema (novas colunas + tabela)**
```sql
ALTER TABLE instagram_accounts
  ADD COLUMN health_status text DEFAULT 'online' CHECK (health_status IN ('online','error','blocked')),
  ADD COLUMN failover_priority integer DEFAULT 0;

CREATE TABLE failover_logs (
  id uuid PRIMARY KEY, user_id uuid, failed_account_id uuid,
  backup_account_id uuid, error_reason text, created_at timestamptz
);
```

**APIs**
- `GET/PATCH/PUT /api/failover/accounts` — lista, atualiza health, reordena prioridade
- `GET /api/failover/logs` — histórico de eventos de failover

**Motor de loops (`/api/cron/process-loops`)**
Quando publicação falha com erro crítico da Meta API → marca conta como `error` → busca próxima conta `online` ordenada por `failover_priority` → tenta publicar → registra em `failover_logs`.

**UI `/dashboard/failover`**
- Lista reordenável com setas ↑↓ e `failover_priority`
- Badges de saúde: Online (verde) / Erro (vermelho) / Bloqueada (âmbar)
- Botão "Restaurar" reseta `health_status = 'online'`
- Timeline de eventos de failover com timestamps

---

### ✅ Queue Status Dashboard (2026-05-20)
**Commit:** `feat: build queue status dashboard with real-time auto-refresh`

**UI `/dashboard/queue`**
- Auto-refresh a cada 10 segundos
- Métricas de posts: pendentes / publicando / publicados / com falha
- Tabela de jobs recentes com status animado e timestamps

**API `/api/queue/stats`**
- `GET` — conta posts por status via Supabase, retorna `{ pending, publishing, published, failed, recent }`

---

### ✅ Loop Media Limit (2026-05-21)
**Commit:** `feat: add media limit option to loops and update processing engine`

**Mudanças**
- Coluna `media_limit integer` na tabela `loops` (nullable — null = sem limite)
- Slider na UI de criação/edição de loops
- Motor do cron verifica `cycles_done >= media_limit` antes de executar; se atingido, marca loop como `completed`

---

### ✅ Redesign — Cyber-Military Elite (2026-05-21)
**Commits:** `style: redesign UI`, `style: complete redesign to elite high-tech futuristic aesthetics`, `feat: implement Cyber-Military Elite design system with multi-mode animated backgrounds`, `fix: remove harsh horizontal gradient line from terrain background`

#### Decisão de design
Paleta anterior (violet `#8B5CF6` + cyan `#06B6D4`) substituída por:
- **Matrix Green** `#00FF41` — cor primária de destaque
- **Electric Cyan** `#00E5FF` — cor secundária
- **Background** `#000000` puro

#### Novos componentes
| Componente | Descrição |
|-----------|-----------|
| `WireframeTerrain.tsx` | Canvas 3D: grid 56×28 com perspectiva, múltiplas camadas de ondas seno, glow radial no horizonte, fade top; 30 FPS via `requestAnimationFrame` |
| `BackgroundController.tsx` | Seletor flutuante com 4 modos: Terrain (padrão) / Topography / Particles / Beams |
| `BackgroundContext.tsx` | Context + Provider para estado global de modo de fundo |
| `TopographyBackground.tsx` | SVG animado com curvas de nível em verde neon |
| `ParticlesBackground.tsx` | 80 partículas flutuantes + 25 estrelas piscando |
| `BeamsBackground.tsx` | Feixes de luz lineares animados |

#### Classes CSS novas em `globals.css`
- `.ticks` — miras táticas com `::before` usando 8 gradientes lineares nos 4 cantos
- `.metric-value` — número com glow 3-camadas: `0 0 4px`, `0 0 14px`, `0 0 38px`
- `.neon-matrix` / `.neon-electric` — text-shadow trifásico
- `.page-title` / `.page-subtitle` — tipografia de página padronizada
- `.btn-primary` agora usa `conic-gradient` animado com `@property --angle`

---

### ✅ Logins Vault (2026-05-21)
**Commit:** `feat: implement secure logins vault with cyber-military UI`

**Página `/dashboard/logins`**
- Cofre de credenciais de login de contas Instagram
- Lista de credenciais salvas com máscara de senha
- Formulário de adição de nova credencial
- Ações: copiar username/senha, remover credencial
- Design Cyber-Military com glassmorphism + ticks

**API `/api/logins`**
- `GET` — lista credenciais do usuário autenticado
- `POST` — salva nova credencial
- `DELETE` — remove credencial por ID

---

### ✅ Login Simplificado (2026-05-21)
**Commit:** `refactor: simplify login form to require only username`

Formulário `/auth/login` refatorado para solicitar apenas `username`. Fluxo de autenticação Supabase adaptado.

---

### ✅ Inspirações — Redesign Cyber-Military (2026-05-21)
**Commit:** `feat: build inspirations page with cyber-military design and add to sidebar`

#### Problema
A aba "Inspirações" não aparecia na Sidebar — a funcionalidade existia em `/dashboard/search` mas nunca tinha link ou rota própria.

#### Solução
Nova página `/dashboard/inspirations/page.tsx` criada do zero:
- Header com ícone `Sparkles` e título "Inspirações e Scraper"
- Barra de busca `bg-black/45 backdrop-blur-xl border border-white/10` com ícone `@` em matrix green
- `MockCard` — cards placeholder com `.glass-card .ticks`, shimmer animado e botão "Adicionar à Biblioteca" (desabilitado no estado vazio)
- `HistoryCard` — cards do histórico redesenhados com `.ticks`, glow verde e hover effects inline
- Modal de importação com progress bar matrix/electric e 3 steps animados
- Toda lógica de scraping real mantida: `/api/inspirations/scrape` + `/api/inspirations/history`
- Sidebar: link "Inspirações" adicionado na seção CONTEÚDOS com ícone `Sparkles`, antes de "Biblioteca"

---

### ✅ Hotfix — getLongLivedToken: POST → GET (2026-05-21)
**Commit:** `fix: change getLongLivedToken fetch method to GET to comply with Meta Graph API`

#### Problema
Erro `[getLongLivedToken] Unsupported request - method type: post` ao conectar conta no Instagram.
A função `getLongLivedToken` em `app/api/instagram/callback/route.ts` enviava um `POST` com body `URLSearchParams` para `https://graph.instagram.com/access_token`, mas a Meta Graph API exige estritamente `GET` com parâmetros na query string para esse endpoint.

#### Causa raiz
Confusão entre dois endpoints distintos:
- `POST https://api.instagram.com/oauth/access_token` — troca do `code` por short-lived token (`exchangeCode`). **POST está correto.**
- `GET https://graph.instagram.com/access_token` — upgrade de short-lived para long-lived token (`getLongLivedToken`). **Exige GET.**

#### Solução aplicada
Substituído `body: new URLSearchParams(...)` + `method: "POST"` por `URLSearchParams` embutido na URL com `GET` implícito (padrão do `fetch`):
```ts
// antes
const body = new URLSearchParams({ grant_type, client_secret, access_token });
fetchWithTimeout(url, { method: "POST", body: body.toString() });

// depois
const params = new URLSearchParams({ grant_type, client_secret, access_token });
fetchWithTimeout(`${GRAPH_IG}/access_token?${params.toString()}`);
```
`exchangeCode` e `getIGProfile` não foram alterados (já estavam corretos).

---

### ✅ Deep Error Logging — Meta Graph API (2026-05-21)
**Commit:** `feat: surface detailed Meta Graph API error messages to frontend`

#### Problema
A 8ª conta falhou ao conectar com uma rejeição contextual da Meta (rate limit, Dev Mode limit ou outro). O sistema mascarava o erro real com mensagens genéricas como "Erro ao processar a conexão." ou classificava qualquer `error_type` como "conta pessoal", impedindo o diagnóstico.

#### Mudanças no backend (`app/api/instagram/callback/route.ts`)

**Helper `metaErrorDetail`** — formata `[fn] Type (#code): message` de forma consistente para todos os pontos de falha.

**`exchangeCode`** — classificação refinada:
- `code 4 ou 17` → `isRateLimit: true`
- mensagem com "permission"/"business"/"professional"/"creator" → `isPersonalAccount: true`
- qualquer outro erro → `server_error` com detalhe completo da Meta
- Antes: qualquer `error_type` disparava "conta pessoal" (falso positivo para Dev Mode limit, invalid app, etc.)

**`getLongLivedToken`** — tipo expandido para incluir `type` e `fbtrace_id`; detecção de rate limit via JSON body (Meta retorna HTTP 200 com `error.code 4/17/32`, não HTTP 429).

**`getIGProfile`** — mesmo padrão: rate limit / account type / genérico; antes jogava "conta pessoal" para qualquer `OAuthException`.

**`redirectWithError`** — slice de `detail` aumentado de 200 → 500 chars para comportar mensagens longas da Meta.

#### Mudanças no frontend (`app/dashboard/accounts/page.tsx`)
- `server_error` base: `"Erro ao processar a conexão."` → `"Erro retornado pela Meta API:"`
- Detalhe passa de `"${base} Detalhe: ${detail}"` para `"${base}\n${detail}"` com `whitespace-pre-line` no span
- Resultado visual:
  ```
  Erro retornado pela Meta API:
  [getLongLivedToken] OAuthException (#17): User request limit reached
  ```

#### Lição aprendida
A Meta retorna rate limit e outros erros contextuais como HTTP 200 com payload `{ error: { code, type, message } }`. Verificar apenas o status HTTP é insuficiente — sempre ler e logar o corpo JSON completo.

---

### ✅ Motor Cron + Pipeline de Publicação em Duas Fases (2026-05-22)
**Commit:** `feat: implement serverless cron engine and Meta Graph API video publishing pipeline`

#### Problema
O `vercel.json` estava vazio — nenhum cron estava agendado no Vercel. Além disso, a lógica existente em `process-loops` fazia polling inline (até 120s por conta), o que causaria timeout da função Vercel (300s) com múltiplos loops e contas simultâneas.

#### Solução: Arquitetura de Duas Fases

**Fase 1 — `GET /api/cron/process-loops` (a cada 15 min)**
- Seleciona loops `status=active` cujo `interval_minutes` já expirou desde `last_posted_at`
- Para cada conta válida: chama `createMediaContainerOnly()` — apenas cria o container na Meta Graph API, **sem polling**
- Insere o `creation_id` na nova tabela `pending_containers` com status `pending`
- Atualiza o estado do loop (`last_posted_at`, `last_media_index`, `cycles_done`) imediatamente — previne double-firing entre invocações concorrentes
- Toda a lógica de failover, renovação preventiva de token e Horário Humano permanece intacta

**Fase 2 — `GET /api/cron/publish-pending` (a cada 5 min)**
- Busca todos os `pending_containers` com status `pending`
- Para cada container: chama `pollContainerStatusOnce()` — **uma verificação por invocação, sem loop de polling**
  - `in_progress` → ignora (próxima execução do cron verifica de novo)
  - `finished` → chama `publishReadyContainer()` → marca como `published`
  - `error`/`expired` → marca como `error` com mensagem
- Containers com mais de 30 min são expirados automaticamente (Meta processa em no máximo ~15 min)

#### Arquivos novos/modificados

| Arquivo | Mudança |
|---------|---------|
| `vercel.json` | Adicionados 2 crons: `*/15` e `*/5 * * * *` |
| `lib/meta-publish.ts` | 3 novos exports: `createMediaContainerOnly`, `pollContainerStatusOnce`, `publishReadyContainer` |
| `app/api/cron/process-loops/route.ts` | Substituído `publishViaMetaAPI` por `createMediaContainerOnly` + insert em `pending_containers` |
| `app/api/cron/publish-pending/route.ts` | Novo — publica containers prontos sem bloquear |
| `supabase/pending_containers.sql` | Nova tabela com RLS (sem policy: só service_role acessa) |

#### Tabela `pending_containers`
```sql
CREATE TABLE public.pending_containers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  loop_id                uuid REFERENCES public.loops(id) ON DELETE SET NULL,
  account_id             uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  ig_business_account_id text NOT NULL,
  creation_id            text NOT NULL,
  caption                text NOT NULL DEFAULT '',
  status                 text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'error')),
  error_message          text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
```

#### Variáveis de ambiente necessárias na Vercel
- `CRON_SECRET` — secret compartilhado; o Vercel envia `Authorization: Bearer <CRON_SECRET>` automaticamente ao invocar cron routes
- Sem essa variável, todas as invocações retornam 401 e nada é publicado

#### Por que separar em duas fases?
A Meta processa vídeos de forma assíncrona (Upload → Processamento → Pronto). O polling inline bloqueava a thread por até 120s por conta. Com 5 loops × 3 contas = potencial de 1800s — muito acima do `maxDuration=300`. A Fase 1 retorna em ~2s por conta (só cria o container), e a Fase 2 verifica o status sem esperar, tornando o sistema escalável.

---

### ✅ Fix — Lógica de Intervalo por Lote no Agendamento em Massa (2026-05-23)
**Commit:** `fix: apply time interval per batch instead of per account in campaign scheduling`

#### Problema
O `CampaignPreview` no frontend (`app/dashboard/postar/page.tsx`) calculava `slots = ceil(videos / batchSize)`, ignorando o número de contas. A lógica correta (já aplicada no backend em `app/api/posts/schedule/route.ts`) é: todas as contas recebem seus posts **no mesmo slot de tempo** — o intervalo avança uma vez por "lote completo de todas as contas".

#### Solução
Introduzida variável `postsPerSlot = max(1, totalAccounts) × effectiveBatch`:
- `slots = ceil(totalVideos / postsPerSlot)`
- `CampaignPreview` usa `postsPerSlot` como divisor em todas as previsões
- Texto de resumo inline também recalcula com a mesma fórmula
- Deps do `useMemo` simplificadas: `[startDatetime, slots, postsPerSlot, intervalMinutes, totalVideos]`

---

### ✅ Fix — Stories API: host errado na Graph API (2026-05-23)

#### Problema
`active_stories_count` ficava travado em 0 em todas as contas. Causa: `app/api/accounts/stories/route.ts` e `app/api/instagram/stories/route.ts` usavam `graph.facebook.com/v19.0` — host inválido para tokens do Instagram Login API.

#### Solução
Substituído por `graph.instagram.com/v21.0` em todas as rotas de stories. O endpoint `accounts/refresh` agora também busca stories em paralelo no mesmo ciclo de atualização.

---

### ✅ Style — Overflow nos Cards de Conta (2026-05-23)
**Commit:** `style: fix metadata row overflow on account cards`

#### Problema
A linha inferior de metadados dos cards em `/dashboard/accounts` (seguidores, posts, sync, stories) estava sendo cortada à direita em telas menores (ex.: "1 sto..." em vez de "1 story"). `overflow-x-auto` sem scrollbar visível é inacessível no desktop com mouse padrão.

#### Solução
Substituído `flex + overflow-x-auto + no-scrollbar` por `flex-wrap + gap-x-3.5 + gap-y-2`. Os itens quebram para a linha seguinte se não couberem. Labels compactados: `"sincronizado"` → `"sync"`, `"expira em"` → `"exp."`.

---

### ✅ Feat — Badge de Erro de Token na Aba Logins (2026-05-23)
**Commit:** `feat: mirror meta account error status to logins table with red alert badge`

#### Problema
A aba de Logins (`/dashboard/logins`) mostrava apenas "Conectada" ou "Não Conectada" — sem distinguir o caso em que a conta existe mas o token caiu ou a saúde está degradada (`health_status = 'error'`/`'blocked'`).

#### Solução

**API (`app/api/logins/route.ts`):**
- Adicionado `health_status` ao select de `instagram_accounts`
- `is_connected: boolean` → `meta_status: "connected" | "error" | "not_connected"`
- `accountMap` (Map) armazena o estado tristate por username

**UI (`app/dashboard/logins/page.tsx`):**
- Badge vermelho pulsante com ícone `WifiOff` + texto "Token Inválido" quando `meta_status === "error"`
- Alert strip vermelho abaixo do divisor: "Token caiu na Meta API — acesse Contas para reconectar ou exclua este login."
- Borda vermelha sutil no card (`border-red-500/25`)
- Badge cinza "Não Conectada" (antes "Pendente") quando `meta_status === "not_connected"`

---

### ✅ Chore — Limpeza de Posts Fantasmas + Cache do Dashboard (2026-05-23)
**Commit:** `chore: clear orphaned scheduled posts and fix dashboard widgets cache`

#### Problema
Uma campanha criada antes de refatorações recentes gerou posts presos com status `pending`/`publishing` que nunca seriam publicados. Eles apareciam nos widgets "Atividade Recente" e "Próximas Postagens" do Dashboard sem opção de cancelamento na UI.

#### Solução — Limpeza de DB
Posts deletados diretamente via script Node.js usando a Supabase REST API com service role key. `DELETE FROM scheduled_posts WHERE status IN ('pending','publishing')` removeu todos os registros órfãos.

#### Solução — Novo endpoint de limpeza
`POST /api/posts/clear-pending` — remove em paralelo todos os `scheduled_posts` e `pending_containers` com status `pending`/`publishing`/`processing` do usuário autenticado. Retorna contagem de linhas deletadas.

#### Solução — Freshness do Dashboard
- `app/api/dashboard/stats/route.ts`: adicionado `export const dynamic = "force-dynamic"` para desabilitar cache do Next.js
- `app/dashboard/page.tsx`:
  - `loadStats` extraído como `useCallback` com `fetch(..., { cache: "no-store" })`
  - `useEffect` registra `setInterval(loadStats(silent), 60_000)` — auto-refresh a cada 60s
  - Botão "Atualizar" (ícone `RefreshCw`) visível no header do dashboard
  - Botão "Limpar Fila" (2-click confirmation) no card de Próximas Postagens, visível apenas quando `pending > 0`

---

### ✅ Fix — Auditoria de Banda: 10 GB Fast Origin Transfer (2026-05-27)
**Commits:** `54c6361` — `refactor: offload video bandwidth from vercel by passing direct public urls to meta api`

#### Diagnóstico completo

**Posting pipeline — ✅ Já estava correto**
O caminho `process-loops → createContainerForAccount → createMediaContainerOnly → Meta Graph API` já enviava apenas o campo form `video_url=<URL_Supabase>`. A Meta faz pull direto do Supabase CDN. FFmpeg (`processVideoEffects`) era stub que retornava a URL sem alteração. Zero bytes de vídeo passavam pela Vercel ao publicar.

**Causa real — `/api/proxy-sanitize-download`**
Cada download de Inspiração no device roteava ~2× o tamanho do vídeo pela Vercel:
1. Vercel baixava o MP4 do Instagram/Apify CDN (50–150 MB)
2. FFmpeg processava em `/tmp`
3. `fs.readFileSync` carregava o arquivo inteiro em memória
4. Vercel enviava o buffer completo ao browser

Custo estimado: 100 downloads × ~100 MB = **10 GB** — exatamente o limite do plano Hobby.

#### Correções aplicadas

| Rota | Antes | Depois |
|------|-------|--------|
| `proxy-sanitize-download GET` | Sempre baixava, processava FFmpeg, enviava buffer | URLs `*.supabase.co` → HTTP 307 redirect (zero bytes Vercel) |
| `proxy-download GET` | Sempre fazia fetch e streamava | URLs `*.supabase.co` → HTTP 307 redirect |
| `proxy-download HEAD` | Sempre fazia HEAD request remoto | URLs `*.supabase.co` → 200 instantâneo sem fetch |
| `proxy-sanitize-download` | Log sem tamanho | Log de MB por download para monitorar consumo |

#### Limitação permanente
URLs do Instagram CDN (inspirações não salvas na biblioteca) ainda precisam do proxy — CORS + Referer restrictions impedem fetch direto pelo browser. Solução de longo prazo: exigir save na biblioteca antes de download (usa a URL Supabase já limpa).

#### Upgrade de plano
Vercel Hobby migrado para **Vercel Pro** nesta data. 1 TB de banda disponível, sem limites de timeout nas funções.

---

### ✅ Chore — X-Ray Logs: Diagnóstico Roleta Russa de Legendas (2026-05-27)
**Commit:** `54bf456` — `chore: inject aggressive x-ray logs to debug caption russian roulette`

#### Comportamento observado
Lotes com postagem inconsistente de legendas: algumas contas publicavam todas as variações corretamente, outras publicavam posts sem legenda, outras parcialmente. Impossível distinguir se o bug era interno (array vazio no banco → seleção falhando) ou externo (Meta API descartando o double-tap silenciosamente).

#### Blindagens injetadas

**`app/api/cron/process-loops/route.ts`**

| Adição | Propósito |
|--------|-----------|
| `Object.freeze(loopCaptionsRaw)` após parse | Qualquer `.pop()/.shift()/.splice()` lança `TypeError` imediatamente — revela mutação destrutiva |
| Log estendido: `type + isArray + rawLen` de `loop.captions` | Detecta perda silenciosa de variações no parse (ex: array de 5 vira array de 0) |
| `[RAIO-X]` pós-`selectDynamicCaption` | Por conta: pool size + caption sorteada (ou `VAZIA!!!`) — snapshot antes do fallback |
| `[RAIO-X-FINAL]` | Caption final que efetivamente entra no container — confirma se fallback de emergência foi usado |

**`app/api/cron/publish-pending/route.ts`**

| Adição | Propósito |
|--------|-----------|
| `[RAIO-X]` antes do double-tap | Caption armazenada no banco (chars + preview + flag `VAZIA!!!`) — isola se o problema é interno |

**`lib/meta-publish.ts` — `updatePostCaption`**

| Adição | Propósito |
|--------|-----------|
| `[META DOUBLE-TAP RAW]` com `rawText` completo (sem slice) | Expõe qualquer resposta silenciosa da Meta que estava sendo truncada |
| `HTTP status` no log | Detecta 429 imediatamente |
| `rate_limited=SIM!!!` | Detecção inline de rate limit por regex |
| `oauth_err=SIM!!!` | Detecção inline de `OAuthException`/token inválido |

#### Como interpretar os logs na Vercel
- `[RAIO-X] Sorteada: VAZIA!!!` → bug interno (parse do `loops.captions` está retornando array vazio)
- `[RAIO-X] Sorteada: "OK"` + `[META DOUBLE-TAP RAW] rate_limited=SIM!!!` → Meta bloqueando edições consecutivas (rate limit no endpoint de caption update)
- `[RAIO-X-FINAL]` com texto de emergência (`🔥 [TESTE DE SISTEMA]`) → pool estava vazio mas fallback funcionou; verificar configuração das legendas no painel Loop

---

### ✅ Fix — OAuth Instagram: fluxo de conexão de contas corrigido (2026-05-29)
**Commits:** `f4da4c7`, `15a64a8`, `c94fa9c`

#### Histórico do problema

**Commit `feat: add insights and comments management to oauth scopes`** adicionou os scopes `instagram_manage_comments` e `instagram_manage_insights` ao endpoint `api.instagram.com/oauth/authorize`. Esses dois scopes são exclusivos do **Facebook Login for Business** (`graph.facebook.com`) e não existem na **Instagram Business Login API** (`api.instagram.com`). Resultado: erro "Invalid platform app" ao clicar em Adicionar Conta.

#### Tentativa 1 — Mudar URL para Facebook Login
Alterado para `https://www.facebook.com/v21.0/dialog/oauth` com scopes do Facebook Login. Funcionou tecnicamente mas exibia **tela de login do Facebook** em vez do Instagram — UX errado.

#### Tentativa 2 — Alinhar env vars
Descoberto que o código buscava `NEXT_PUBLIC_INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`, mas o `.env.local` e a Vercel têm `NEXT_PUBLIC_META_CLIENT_ID` / `META_CLIENT_SECRET`. Corrigido o mapeamento das variáveis.

#### Tentativa 3 — Reverter para Instagram Business Login com scopes corretos
Revertido para `api.instagram.com/oauth/authorize` e substituídos os scopes por equivalentes corretos:

| Scope inválido (Facebook Login) | Scope correto (Instagram Business Login) |
|---|---|
| `instagram_business_basic` | `instagram_business_basic` ✓ (já correto) |
| `instagram_business_content_publish` | `instagram_business_content_publish` ✓ (já correto) |
| `instagram_manage_comments` | `instagram_business_manage_comments` |
| `instagram_manage_insights` | **removido** (não existe no Instagram Login) |

#### Erro "página não disponível" em `instagram.com/oauth/authorize/third_party/`
Instagram detectou que o app é um **Business App** e roteou para `third_party/` automaticamente. A URI de redirecionamento `https://autoscale-ia.vercel.app/api/instagram/callback` não estava cadastrada nas configurações de Instagram Login do app no Meta Developer Console.

**Fix no Meta Developer Console:**
1. App `1011659591297709` → Instagram → Instagram Business Login → Configurações
2. Adicionado `https://autoscale-ia.vercel.app/api/instagram/callback` em Valid OAuth Redirect URIs

#### Estado final funcional
- URL OAuth: `https://api.instagram.com/oauth/authorize`
- Scopes: `instagram_business_basic, instagram_business_content_publish, instagram_business_manage_comments`
- Troca de código: `api.instagram.com/oauth/access_token`
- Token longo: `graph.instagram.com/access_token?grant_type=ig_exchange_token`
- Profile: `graph.instagram.com/me?fields=id,username,name,profile_picture_url`
- Env vars: `NEXT_PUBLIC_META_CLIENT_ID` / `META_CLIENT_SECRET`

#### Lição aprendida
`api.instagram.com` usa scopes com prefixo `instagram_business_*`. `graph.facebook.com/dialog/oauth` usa scopes sem esse prefixo (`instagram_basic`, `instagram_manage_*`). Misturar os dois conjuntos no mesmo endpoint gera erro silencioso ou "Invalid platform app".

---

### ✅ Fix — Backoff exponencial + comment_enabled + rotação aleatória de vídeos (2026-06-03)
**Commits:** `ae8b30a`, `e9e9fbd`, `8f6ec02`, `77ac28a`

#### Problema 1: Retry storm de "too many actions" travando 20+ contas por horas

**Sintoma:** A cada noite, o `publish-pending` tentava publicar 10 containers ao mesmo tempo. Os que falhavam com "User is performing too many actions" eram imediatamente resetados para `pending` e tentados de novo em 5 min — criando um ciclo infinito. Com o `process-loops` criando novos containers a cada vez que o auto-healing matava os velhos, o ciclo se autoperpetua. 21 contas chegaram a ficar 6+ horas sem publicar.

**Root cause:** Sem backoff, cada falha → retry imediato em 5 min → falha de novo → sem fim.

**Fix em `publish-pending`:**
- Novas colunas `retry_count` (int, default 0) e `retry_after` (timestamptz) em `pending_containers`
- Ao receber erro transitório: `retry_count++`, `retry_after = now() + min(60, 10 × 2^(retry_count-1)) min` (10→20→40→60 min)
- Query filtra `.or('retry_after.is.null,retry_after.lte.now')` — containers em backoff não são selecionados
- Delay anti-burst: 2s → 8s entre publishes; batch limit: 10 → 5 por run
- Auto-healing também exclui containers com `retry_after` futuro (não mata quem está em backoff intencional)

**Fix em `process-loops`:** Auto-healing recebia `.in("status", ["pending","publishing"]).lt("created_at", cutoff)` sem considerar `retry_after` — matava containers em backoff, triggering nova criação e reiniciando o ciclo. Adicionado `.or('retry_after.is.null,retry_after.lte.now')` aqui também.

**Por que funciona:** Container em backoff permanece `status=pending`. `containerAlreadyExists` retorna true → `process-loops` não cria novo container → sem cascade.

**SQL aplicado em 2026-06-03:**
```sql
ALTER TABLE public.pending_containers
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_after  timestamptz;
CREATE INDEX IF NOT EXISTS pending_containers_retry_idx
  ON public.pending_containers (retry_after) WHERE status = 'pending';
```

#### Problema 2: comment_enabled obrigatório no double-tap de legenda

**Sintoma:** Todas as tentativas de `updatePostCaption` retornavam HTTP 400: `"The parameter comment_enabled is required."` — legendas nunca eram aplicadas pós-publicação.

**Fix:** Adicionar `comment_enabled=1` ao form body em `lib/meta-publish.ts` → `updatePostCaption`.

#### Problema 3: Novo loop repetia a mesma sequência de vídeos

**Sintoma:** Ao pausar um loop e criar outro com a mesma pasta, os vídeos eram postados na mesma ordem de antes (ordenados por `created_at` asc, sempre `available[0]`).

**Fix:** Substituir `available[0]` por `available[Math.floor(Math.random() * available.length)]`. O histórico de vídeos continua por `loop_id` (novo loop começa do zero com todos disponíveis), mas a sequência é sempre embaralhada.

#### Lição aprendida: backoff implícito via status=pending
Containers em backoff ficam com `status=pending` (não `error`). Isso é intencional: `containerAlreadyExists` busca `in(status,["pending","publishing"])` → encontra → retorna `true` → `process-loops` não cria novo container. O backoff no `publish-pending` serve automaticamente como circuit breaker para o `process-loops`.

---

### ✅ Fix — Double-tap limpava legenda dos Reels pós-publish (2026-06-08)
**Commits:** `402f210`

#### Problema
Loop novo postando todos os vídeos sem legenda. Legendas estavam corretas no DB (`loops.captions` e `pending_containers.caption`), e o double-tap (`updatePostCaption`) retornava HTTP 200 sem erros — mas os posts chegavam sem legenda no Instagram.

#### Root cause
`updatePostCaption` chamava `POST /{media-id}` com `caption + comment_enabled=1` após o publish. A Meta Graph API v21 aceitava o request (HTTP 200) mas apagava silenciosamente a legenda original do container — efeito colateral documentado para Reels quando `comment_enabled` é enviado junto com `caption` no endpoint de atualização de post.

#### Fix
Double-tap removido de `publish-pending`. A legenda é definida corretamente em `createMediaContainer` (criação do container, Fase 1 do pipeline) e não precisa ser reaplicada após o publish. Comentário explicativo adicionado no código.

#### Lição aprendida
HTTP 200 da Meta API não garante que o campo foi aplicado. Para Reels, a legenda deve ser enviada APENAS na criação do container (`POST /{ig-user-id}/media` com `caption=...`). Qualquer `POST /{media-id}` pós-publish pode silenciosamente apagar campos do container original.

---

### ✅ Fix — Intervalo efetivo dobrado por stagger ultrapassando a janela (2026-06-08)
**Commits:** `252c45b`

#### Problema
Loop configurado com 15 min postando a cada ~30–50 min para algumas contas.

#### Root cause
Com 24 contas e intervalo de 15 min, `staggerBaseSec = 900/24 = 37.5s`. Com jitter +30%, a conta[23] (última) recebia `retry_after = now + 23 × 37.5 × 1.3 / 60 = 18.7 min` — ultrapassando a janela de 15 min. Quando o `process-loops` rodava no ciclo seguinte (T+15min), esse container ainda estava `status=pending` → `containerAlreadyExists = true` → conta pulava um ciclo inteiro → próximo post só no ciclo T+30min.

#### Fix
Cap em `initialDelayMinutes`: `min(rawDelay, interval_minutes - 3)`. Para 15 min: max delay = 12 min. Garante que todas as contas têm pelo menos 3 min de folga para o `publish-pending` (roda a cada 2 min) processar o container antes do próximo ciclo do `process-loops`.

#### Lição aprendida
O jitter ±30% sobre o stagger já calculado sem margem causava overflow da janela para as contas de índice mais alto. O cap deve ser aplicado APÓS adicionar o jitter (não no stagger base), garantindo que o valor final nunca exceda o limite. Buffer de 3 min é suficiente com publish-pending a cada 2 min.

---

### ✅ Fix + Feat — Distribuição de Campanha (aba Postar) — 2026-06-09
**Commits:** `6b3ff29`, `13f7c88`

#### Problema
O algoritmo de agendamento em massa distribuía vídeos **diferentes por conta** em cada slot de tempo (`postsPerSlot = contas × batch_size`). Com 30 vídeos, 3 contas, intervalo 15min → 10 disparos — cada conta recebia 10 vídeos distintos, mas o "intervalo" era na prática entre lotes de contas, não entre vídeos. O usuário queria o oposto: **1 vídeo a cada 15min por conta**, ou seja, todos postando o mesmo vídeo ao mesmo tempo.

#### Fix (commit 6b3ff29)
Algoritmo refatorado em `app/api/posts/schedule/route.ts`:
- Cada slot coleta `batch_size` vídeos do pool shuffled
- Distribui os **mesmos vídeos** para TODAS as contas selecionadas
- `ptr` avança por vídeo (não por conta × vídeo)
- Resultado: 30 vídeos, 3 contas, 15min → 30 disparos × 90 posts totais, 1 vídeo a cada 15min por conta

#### Feat — Toggle de modo (commit 13f7c88)
Adicionado toggle "Modo de distribuição" na seção Distribuição de Tempo:
- **Mesmo vídeo** (padrão): slot inteiro → todas as contas (novo comportamento)
- **Vídeo único por conta** (anti-spam): vídeo diferente por conta no mesmo slot (comportamento original)

Parâmetro `same_video_per_slot: boolean` adicionado ao body de `POST /api/posts/schedule`. `CampaignPreview`, resumo dinâmico e timeline atualizam em tempo real conforme o modo selecionado.

#### Lição aprendida
O conceito de "intervalo" era ambíguo: intervalo entre **lotes** (grupo de contas × vídeos) vs intervalo entre **vídeos**. O usuário pensa em "1 vídeo a cada N min", o que mapeia para intervalo entre vídeos com todas as contas recebendo o mesmo vídeo. A lógica de campanha agora reflete esse modelo mental, com o modo anti-spam disponível como opção secundária.

---

### ✅ Fix — Rate limit Meta: skip silencioso no process-loops — 2026-06-09
**Commits:** `ed119e8`, `2c4db59`

#### Problema (root cause das "quedas em cascata")
Quando `process-loops` recebia "User is performing too many actions" ao criar um container, chamava `recordContainerError` → gravava `pending_container status=error` no banco. No próximo ciclo de 15 min, `containerAlreadyExists` checava apenas `pending/publishing` → ignorava o erro → criava OUTRO container → que falhava de novo → loop infinito. Com 14 contas throttled simultaneamente: 46 erros acumulados em horas, monitor poluído, chamadas desnecessárias à Meta a cada 15 min.

#### Fix (commit `2c4db59`)
`isRateLimitError()` adicionada ao `process-loops`. Quando container creation falha com rate limit:
- `continue` — pula a conta naquele ciclo
- Zero escrita no banco (sem `recordContainerError`)
- Zero mudança em `health_status`
- Log de aviso: `⏸ @username: rate limit Meta — pulando este ciclo. Tentará em N min`
- Retoma automaticamente quando Meta liberar (horas, não 24h)

Padrões tratados: "too many actions", "performing too many", "retry your request later", "please retry", "service temporarily unavailable".

#### Também corrigido na mesma sessão (commit `ed119e8`)
- `publish-scheduled` **não estava no `vercel.json`** — cron nunca havia disparado automaticamente. Adicionado `*/5 * * * *`.
- `publish-scheduled`: proxy por conta via `getProxyForAccount` adicionado.
- `publish-scheduled`: rate limit errors resetam para `pending` em vez de `failed` permanente.

#### Lição aprendida
Cap diário (40 posts/dia) foi implementado e revertido na mesma sessão. Bloqueia contas por horas artificialmente — usuário quer postagem contínua 24/7. O skip silencioso é a abordagem correta: não acumula erros, não bloqueia outras contas, retoma sozinho. A Meta limita por janela temporal (horas), não por dia fixo.

---

### ✅ Sessão 2026-06-10 — Fixes críticos de pipeline + Redesign aba Postar + Crons 1 min
**Commits:** `6c0e375`, `6e84e50`, `4a78ff2`, `f5907f8`, `e5e26b7`, `945bcd8`, `cfb063b`, `8bacd05`

---

#### Fix 1 — `isCriticalMetaError` muito amplo derrubava contas saudáveis

**Problema:** O padrão `"access token"` em `isCriticalMetaError` (`process-loops`) é genérico demais. Qualquer mensagem de erro da Meta contendo "access token" (incluindo erros transitórios de rate-limit ou mensagens de serviço temporário) marcava a conta como `health_status='error'` de forma permanente. Resultado: contas caindo em massa sem motivo real.

**Fix:** Padrão `"access token"` removido. Lista restrita a erros genuinamente permanentes:
- `"oauthexception"`, `"invalid_token"`, `"token has expired"`, `"session has been invalidated"`
- `"invalid oauth access token"`, `"cannot parse access token"`
- `"account has been restricted"`, `"blocked"`, `"checkpoint"`
- `"error code 190"`, `"error code 102"`, `"error code 104"`
- `"unsupported request - method type: post"` (conta pessoal sem API)
- `"not a confirmed user"`, `"sessions for the user are not allowed"`

**Lição aprendida:** Nunca usar strings genéricas presentes em múltiplos contextos de erro para decisões permanentes (marcar conta como error). Preferir códigos de erro numéricos ou mensagens de erro únicas e inequívocas.

---

#### Fix 2 — `publish-pending` tratava todos os erros como permanentes

**Problema:** O bloco `catch` único do `publish-pending` marcava qualquer erro como `status='error'` permanente (FAIL FAST). Erros de proxy (`fetch failed`), rate-limit (`too many actions`) e timeout eram tratados da mesma forma que tokens inválidos. Resultado: containers com `creation_id` válido eram descartados permanentemente → conta perdia o slot de postagem → intervalo efetivo dobrava.

**Fix:** Detecção de erros transitórios:
```typescript
const isTransient = (
  lower.includes("fetch failed") || lower.includes("smartproxy") ||
  lower.includes("proxy") || lower.includes("timeout") ||
  lower.includes("too many actions") || lower.includes("performing too many") ||
  lower.includes("retry your request later") || lower.includes("please retry") ||
  lower.includes("service temporarily unavailable") ||
  lower.includes("an unexpected error has occurred")
);
// Transitório → status='pending', retry_after=+5min (não conta como erro)
// Permanente → FAIL FAST como antes
```

---

#### Fix 3 — Storage leak: temp/vfx_* nunca eram apagados

**Problema:** `lib/video-effects.ts` faz upload de `temp/vfx_${uid}.mp4` para processar efeitos de vídeo mas nunca deleta o arquivo após uso. Com o tempo, o bucket acumulava centenas de arquivos temporários.

**Fix:** Cleanup no início de cada run do `process-loops`: lista `temp/` do bucket, filtra arquivos `vfx_*` com mais de 2h, deleta em lote. Erro no cleanup é silencioso (não bloqueia o ciclo principal).

---

#### Crons: todos para 1 minuto

Baseado em networking com outro operador de SaaS (contas estáveis, cron a cada 1 min). Todos os crons alterados para `* * * * *`:

| Cron | Antes | Depois |
|------|-------|--------|
| `process-loops` | `*/15 * * * *` | `* * * * *` |
| `publish-pending` | `*/2 * * * *` | `* * * * *` |
| `publish-scheduled` | `*/5 * * * *` | `* * * * *` |

`BATCH_SIZE` do `publish-scheduled` elevado de 5 → 10 (adequado ao ciclo de 1 min).

---

#### Redesign: aba "Postar" → "Distribuição de Conteúdo"

**Motivação:** Baseado em aprendizado de networking — campanhas por pasta são mais robustas e anti-spam do que o loop contínuo. O novo modelo distribui um conjunto fixo de vídeos para múltiplas contas sem repetição (não é loop).

**Novo fluxo (`POST /api/posts/distribute`):**
1. Usuário seleciona **pasta de mídias** (contagem via `video_count` do `/api/library/folders`, não da API paginada)
2. **Quantidade de vídeos** a usar: 10 / 20 / 50 / Todos
3. **Posts por dia por conta**: botões 1, 2, 3, 4, 6, 8, 12, 24, 36, 48, 72 (cada um exibe o intervalo resultante em horas/minutos)
4. **Data e hora de início**
5. **Legendas dinâmicas** (rotativas)

**Algoritmo:**
```
intervalMinutes = floor(1440 / posts_per_day)
Para cada conta [i]:
  accountVideos = fisherYates(baseVideos)  ← shuffle único por conta
  Para cada vídeo [j]:
    scheduledAt = startTime + j × intervalMinutes × 60000 + i × 5 × 60000 (stagger)
    caption = validCaptions[random]
```

**Detecção de contas sem campanha:** Ao abrir a aba, busca `/api/campaigns` e extrai `account_ids` de campanhas em execução. Contas SEM campanha ativa: borda vermelha + dot vermelho no card. Botão "Novas (N)" seleciona automaticamente apenas essas.

**Bug corrigido:** Validação original bloqueava `posts_per_day > 10` — campanhas com 12/24/36/48/72 posts/dia falhavam com erro 400 silencioso. Corrigido para aceitar 1–1440.

**Bug corrigido:** `/api/library` tem `PAGE_SIZE=16` — contagem de vídeos da pasta mostrava 16 em vez do total real (ex: 247). Corrigido usando `folder.video_count` já carregado por `/api/library/folders` (usa `count: "exact"` do Supabase).

---

#### Chore: remoção da aba "Automatizar contas"

Link `/dashboard/automation` e ícone `Bot` removidos de `Sidebar.tsx`. A funcionalidade foi descontinuada em favor do módulo Loop e da nova Distribuição de Conteúdo.

---

### ✅ Sessão 2026-06-10 — Monitor de Campanhas + Abas Loop/Campanhas

**Commit:** `a6657a1` — feat(monitor): abas Loop / Campanhas com monitor por conta

#### Motivação

O Monitor de Postagens existente só cobria o pipeline de Loop (`pending_containers`). Campanhas criadas na aba Postar (`scheduled_posts`) não tinham visibilidade: sem saber quantos posts foram enviados por conta, quantos estão na fila, próximo agendado ou curtidas acumuladas.

#### O que foi feito

**Nova rota `GET /api/campaigns/monitor`**
- Agrega `scheduled_posts` (com `campaign_id IS NOT NULL`) por conta do usuário
- Retorna por conta: `published`, `pending`, `failed`, `last_published_at`, `next_scheduled_at`, `total_likes` (soma de `insights_likes`), lista de `campaign_ids`
- Timeline: publicados nas últimas 6h + agendados nas próximas 3h
- Métricas globais: total publicados, fila, falhas, curtidas, countdown para próxima postagem, contagem de campanhas únicas

**Refatoração de `/dashboard/monitor/page.tsx`**
- Duas abas principais no topo: **Loop** (Radio icon, violet) | **Campanhas** (Send icon, electric) com AnimatePresence
- `LoopView` — conteúdo anterior extraído para componente isolado sem mudança de comportamento
- `CampaignView` — nova view dedicada a campanhas:
  - 5 metric cards: Publicados / Na fila / Falhas / Próxima postagem (countdown) / Curtidas totais (pink)
  - Linha do tempo compartilhada (mesmo componente `Timeline`)
  - Filtros: Todas / Ativas (pending > 0) / Concluídas
  - Grid de `CampaignAccountCard` por conta com:
    - Barra de progresso animada (`published / total`)
    - Grid 4-col: ✓ publicados / ⏱ fila / ✗ falhas / ♥ likes
    - Último post + próximo agendado
    - Badge de quantas campanhas a conta participa
  - Empty state quando não há campanhas

#### Arquitetura da rota

```
GET /api/campaigns/monitor
  → scheduled_posts WHERE campaign_id IS NOT NULL
      AND (status IN (pending,publishing) OR published_at >= 24h atrás)
  → agrupa por account_id em JS
  → retorna: metrics + accounts[] + timeline { published, upcoming }
```

#### Componentes criados/alterados

| Arquivo | Mudança |
|---------|---------|
| `app/api/campaigns/monitor/route.ts` | Novo — agrega scheduled_posts por conta |
| `app/dashboard/monitor/page.tsx` | Refatorado — tabs Loop/Campanhas, LoopView, CampaignView, CampaignAccountCard |

---

### ✅ Sessão 2026-06-10 — Proxy Fixo por Conta + Warmup Automático

**Commits:** `0777bdf` — feat(warmup) | docs: atualiza CLAUDE.md

---

#### Refactor: Proxy fixo por conta (remoção do PROXY_URL_TEMPLATE)

**Motivação:** O proxy rotativo com `PROXY_URL_TEMPLATE` (life-720) tinha dois problemas:
1. Para postar Stories é necessário entrar na conta — dois IPs diferentes (proxy na criação + IP real no login) levantam flags de segurança
2. Mesmo com life-720, o IP muda a cada 12h, rompendo a consistência de IP por conta

**Decisão:** Remover completamente o `PROXY_URL_TEMPLATE`. Cada conta tem **1 proxy estático dedicado** configurado manualmente via UI (menu ⋯ → "Configurar Proxy"). Contas sem proxy postam pelo IP da Vercel com badge âmbar de aviso.

**Mudanças técnicas:**
- `lib/proxy.ts`: removida função `sessionId`, removido branch do `PROXY_URL_TEMPLATE`; `getProxyForAccount` agora tem apenas 2 caminhos: proxy dedicado AES-256-GCM ou `null`
- `process-loops` e `publish-pending`: removidas verificações de startup do `PROXY_URL_TEMPLATE`; "fetch failed" com proxy dedicado → skip silencioso sem container de erro
- `app/api/debug/proxy-check-all/route.ts` e `proxy-check/route.ts`: removido branch `PROXY_URL_TEMPLATE` do campo `source`

---

#### Feat: Warmup automático de contas novas no Loop

**Motivação:** Insight de networking — contas recém-conectadas que postam em ritmo normal imediatamente levam shadowban. O padrão seguro é: 10 posts → pausa 8h → 10 posts → pausa 8h → 10 posts → modo normal (30 posts total).

**Escopo:** Aplica-se **exclusivamente ao pipeline de Loop** (`process-loops` + `publish-pending`). A aba **Postar** (distribuição de campanhas via `publish-scheduled`) posta normalmente, sem warmup.

**Lógica de warmup:**
- Conta com `is_warmed_up = false` e `posts_count < 30` no momento da conexão entra em warmup
- A cada 10 posts via Loop: pausa de 8h (`warmup_paused_until = now + 8h`)
- Ao atingir 30 posts: `is_warmed_up = true`, `warmup_paused_until = null` → modo normal
- Durante a pausa: `process-loops` pula a conta com log `[warmup] @username em pausa Xh`
- Contas existentes: todas marcadas `is_warmed_up = true` na migration (sem warmup retroativo)
- Conta conectada com ≥ 30 posts no Instagram: callback OAuth detecta via `media_count` e marca `is_warmed_up = true` imediatamente

**Novas colunas em `instagram_accounts`:**
```sql
is_warmed_up        boolean    NOT NULL DEFAULT false
warmup_posts_done   integer    NOT NULL DEFAULT 0
warmup_paused_until timestamptz
```

**Arquivos alterados:**

| Arquivo | Mudança |
|---------|---------|
| `app/api/cron/process-loops/route.ts` | AccountRow + SELECT + bloco de skip se pausado |
| `app/api/cron/publish-pending/route.ts` | AccountRow + SELECT + contador pós-publish |
| `app/api/instagram/callback/route.ts` | Fetch `media_count` no `/me`; `is_warmed_up=true` se ≥ 30 |
| `app/dashboard/accounts/page.tsx` | Interface + SELECT + badge âmbar "warmup N/30" / "pausa Xh" |
| `supabase/warmup.sql` | Migration: 3 colunas + UPDATE SET is_warmed_up=true para existentes |

**SQL a executar no Supabase:**
```sql
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS is_warmed_up       boolean    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warmup_posts_done  integer    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_paused_until timestamptz;
UPDATE public.instagram_accounts SET is_warmed_up = true;
```

---

### ✅ Fix — publish-scheduled: timeout de processamento virava falha permanente
**Data:** 11/06/2026
**Commit:** `754e637`

#### Problema

A aba **Distribuição de Conteúdo (Postar)** criava posts corretamente no banco, mas nenhuma conta recebia o vídeo após o horário configurado.

**Causa raiz:** `publishViaMetaAPI` em `lib/meta-publish.ts` faz o fluxo síncrono completo:
1. `createMediaContainer` (~3s)
2. `pollContainerStatus` — **6 tentativas × 8s = 5s + 5×8s = 45s máx**
3. `publishContainer` (~2s)

Quando a Meta demorava >43s para processar o Reel (situação comum), `pollContainerStatus` lançava `"Timeout: o vídeo não terminou de processar no tempo esperado."`. Esse erro **não batia em nenhum padrão de retry** em `RATE_LIMIT_PATTERNS` → post marcado como `status='failed'` permanente, sem possibilidade de retentativa.

Com `BATCH_SIZE=10` e cron a cada 1 minuto, o primeiro ciclo falhava todos os posts, e eles ficavam presos em `failed` para sempre.

#### Correções aplicadas

**1. `app/api/cron/publish-scheduled/route.ts` — RATE_LIMIT_PATTERNS**

Adicionados padrões de timeout de processamento como erros retryables (resetam para `pending`):
```typescript
"não terminou de processar",
"did not finish processing",
"timeout",
```

**2. `lib/meta-publish.ts` — `publishViaMetaAPI`**

Poll reduzido de 6×8s → **4×6s = 23s máx** (5s inicial + 3×6s):
```typescript
await pollContainerStatus(creationId, metaAccessToken, 4, 6_000, proxy);
```

Resultado: se a Meta não processar em 23s, falha rápido com erro retryable e tenta de novo no próximo cron (1 min), em vez de consumir 45s e falhar permanentemente.

**3. `app/api/cron/publish-scheduled/route.ts` — auto-healing**

O cron agora reseta automaticamente posts `failed` por timeout nas últimas 48h de volta para `pending`:
```typescript
const { data: healed } = await admin
  .from("scheduled_posts")
  .update({ status: "pending", error_message: null })
  .eq("status", "failed")
  .gte("scheduled_at", healCutoff)  // últimas 48h
  .or("error_message.ilike.%não terminou de processar%,error_message.ilike.%timeout%,...")
```

Isso garante que posts que já falharam com o bug antigo sejam recuperados automaticamente no próximo ciclo do cron após o deploy.

---

### ✅ Sessão 2026-06-11 — Fix constraint + redesign visual de Campanhas

#### Bug crítico: CHECK constraint bloqueava CLAIM de scheduled_posts

**Causa raiz:** A tabela `scheduled_posts` tinha `CHECK (status IN ('pending', 'published', 'failed', 'cancelled'))` — sem `'publishing'`. O CLAIM atômico `UPDATE status='publishing' WHERE status='pending'` retornava HTTP 400 para 100% dos posts. Resultado: nenhuma campanha/distribuição publicava jamais.

**Fix:** Migration `supabase/scheduled_posts_publishing_status.sql`:
```sql
ALTER TABLE public.scheduled_posts
  DROP CONSTRAINT IF EXISTS scheduled_posts_status_check;
ALTER TABLE public.scheduled_posts
  ADD CONSTRAINT scheduled_posts_status_check
  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'cancelled'));
NOTIFY pgrst, 'reload schema';
```

**Como diagnosticar:** Nos logs do Supabase API (`GET scheduled_posts` → 200, `PATCH scheduled_posts` → 400 repetindo a cada minuto). PostgREST 400 em UPDATE = constraint violation.

#### Colunas adicionadas a scheduled_posts

Via MCP Supabase (execute_sql) durante sessão:
- `creation_id text` — reutiliza container Meta entre ciclos do cron (dois-fase)
- `published_at timestamptz` — timestamp de publicação real
- `media_id text` — ID da mídia publicada na Meta

#### Redesign: publish-scheduled → dois-fase

`publish-scheduled` foi reescrito de `publishViaMetaAPI` (poll inline, recriava container a cada minuto) para:
1. **Fase 1:** `createMediaContainerOnly` → salva `creation_id` no banco
2. **Fase 2:** `pollContainerStatusOnce` → se IN_PROGRESS, volta para pending (mesmo container); se ERROR, marca failed; se FINISHED, `publishReadyContainer`

Elimina 120 criações/hora por post que causava rate-limit e queda de contas.

`publish-pending` (Loop): throttle de 2 min para containers IN_PROGRESS via `retry_after`.

#### Redesign visual: Campanhas Ativas (página Postar)

`CampaignsList` em `app/dashboard/postar/page.tsx` completamente redesenhado:

**Status dinâmico** (substituiu "🟢 Executando" estático):
- **Na Fila** (cyan) — aguardando horário
- **Publicando** (green pulse) — publicou nos últimos 30min
- **Atrasada** (amber pulse) — `next_pending < now`
- **Concluída** (green) — sem pendências

**Novos detalhes:**
- "Último publicado: Xmin atrás" — atualiza a cada 10s (tick state)
- "Próximo: em Ymin" com cor âmbar quando atrasado
- Banner âmbar "Post atrasado — cron publicará em <1min"
- Erro expansível (último `error_message` de falha)
- Grid Fila / Falhas / Cancelados com cores contextuais
- Refresh button com spinner + label "Atualizando…" durante fetch

**API `/api/campaigns`:** adicionados `published_at`, `error_message` ao select; track `last_published_at` e `last_error_message` por campanha.

#### Redesign visual: aba Campanhas no Monitor

`CampaignView` em `app/dashboard/monitor/page.tsx` e `CampaignAccountCard`:
- Mesmos status dinâmicos + `overdue_count` por conta
- 5 filtros: Todas / Na Fila / Atrasadas / Com Erros / Concluídas
- Métrica "Atrasados" no topo (substituiu Curtidas)
- API `/api/campaigns/monitor`: `total_overdue`, `overdue_count` por conta, `last_error_message`

---

### ✅ Feat — Seleção de contas por pasta na aba Postar (2026-06-12)

**Arquivo:** `app/dashboard/postar/page.tsx`

#### Problema
A seleção de contas na aba "Distribuição de Conteúdo" exibia todas as contas em um grid 2-colunas plano. Com muitas contas (ex: 50+), a lista ficava enorme e difícil de navegar por cliente/pasta.

#### Solução
Interface `Account` estendida com `folder_id` e `account_folders.name` (já retornados pelo `/api/accounts/list`).

**`accountsByFolder` (useMemo):** agrupa contas por `folder_id`. Contas sem pasta ficam em grupo "Sem pasta" no final. Grupos em ordem alfabética.

**Accordion por pasta:**
- `expandedFolders: Set<string>` — controla quais pastas estão abertas
- `toggleExpand(folderId)` — abre/fecha o grupo sem afetar seleção
- Clicar no header da pasta → expande/colapsa com `AnimatePresence` (height 0 → auto)
- Chevron rotaciona 180° quando aberto

**Seleção em massa:**
- Botão "selecionar / desmarcar" no canto direito de cada header — `e.stopPropagation()` para não fechar o accordion
- `toggleFolder(accounts)` seleciona/desmarca todos os IDs do grupo
- Header muda de cor: verde (todos selecionados) / ciano (alguns) / cinza (nenhum)
- Contador inline "· N sel." visível mesmo com accordion fechado

#### Comportamento
Por padrão todas as pastas ficam fechadas. Usuário abre apenas as pastas que quer usar. "Todas" / "Nenhuma" / "Novas (N)" continuam funcionando normalmente.

---

### ✅ Fix — Histórico de Inspirações não salvo (2026-06-12)

**Arquivo:** `app/api/inspirations/scrape/poll/route.ts`

#### Problema
Após a refatoração para async polling (Fase 931c2ad), o `saveToHistory` passou a ser chamado como fire-and-forget:
```ts
saveToHistory(username, reels, list).catch(() => {});
return NextResponse.json({ status: "done", reels });
```

O `saveToHistory` internamente chamava `createClient()` que usa `cookies()` do `next/headers`. No Next.js 15, `cookies()` é request-scoped — ao retornar a resposta, o framework finaliza o contexto de cookies. Quando `createClient()` executava dentro do fire-and-forget, `auth.getUser()` retornava `null` e o upsert em `scraped_profiles` era silenciosamente ignorado.

#### Fix
`auth.getUser()` resolvido **dentro do handler GET** (ainda no escopo da request), antes de retornar a resposta. O `user_id` é passado como parâmetro para `saveToHistory`, que não precisa mais de `createClient()`:

```ts
// Antes (quebrado)
async function saveToHistory(username, reels, items) {
  const supabase = await createClient(); // cookies() perdido aqui
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // sempre null no fire-and-forget
  ...
}

// Depois (correto)
async function saveToHistory(userId: string, username, reels, items) {
  // userId já resolvido fora, sem depender de cookies()
  const admin = getSupabaseAdmin();
  await admin.from("scraped_profiles").upsert({ user_id: userId, ... });
}

// No handler GET, antes de retornar:
const supabase = await createClient(); // ainda no contexto da request
const { data: { user } } = await supabase.auth.getUser();
if (user) saveToHistory(user.id, username, reels, list).catch(console.error);
return NextResponse.json({ status: "done", reels });
```

#### Lição
Em Next.js 15 App Router, **nunca chamar `cookies()` ou `headers()` dentro de callbacks async disparados após o retorno da resposta**. Resolver todos os dados request-scoped antes do `return NextResponse.json(...)` e passar como parâmetros para funções background.

---

### ✅ Sessão 2026-06-14 — Revisão geral + fix postFirstComment

#### Bug encontrado e corrigido

**`postFirstComment` em `app/api/posts/create/route.ts` (linhas 32–39)**

A função usava `fetch` global (que o Next.js 15 patcha e descarta silenciosamente a propriedade `dispatcher`) e não recebia o proxy da conta. Resultado: primeiro comentário sempre enviado pelo IP puro da Vercel, independente do proxy configurado na conta — misturando tráfego proxied e direto para a mesma conta.

Fix:
- Migrado de `fetch` global para `undiciFetch` (undici nativo, lê `dispatcher` corretamente)
- Adicionado parâmetro `proxy: ProxyAgent | null = null`
- Body construído com `encodeURIComponent` + `Content-Type: application/x-www-form-urlencoded` explícito (consistente com `createMediaContainer`)
- Timeout de 30s via `AbortSignal.timeout`
- Caller (`posts/create`) passa o `proxy` da conta para a função

#### Falsos positivos descartados durante a revisão

| Item | Motivo |
|------|--------|
| Double-tap desativado em `publish-pending` | Intencional — documentado; endpoint `POST /{media-id}` limpava a legenda dos Reels silenciosamente |
| `publishContainer` sem Content-Type explícito | undici trata `URLSearchParams` como body e auto-injeta o header correto |
| Stagger 5min por conta no `distribute` | Comportamento por design — escalonamento entre contas |
| `summary.skipped++` em erros transitórios (`publish-scheduled`) | Métrica cosmética — comportamento funcional correto (retry) |
| `failover_logs` fire-and-forget em `sync-all` | Aceitável para log não-crítico; não afeta o fluxo principal |
| Warmup counter stale (`publish-pending`) | Teoricamente possível mas impossível na prática: stagger dinâmico garante no máximo 1 container por conta por run |

#### Contexto de proxies (sessão atual)

- 19 contas com proxy ISP estático dedicado: 13 pasta LEXY + 6 novas movidas para LEXY
- 11 proxies de reserva em `proxies_sobrando.csv` (C:\Users\davip\Downloads\)
- Loop recomendado para contas novas: warmup automático (10 posts + pausa 8h × 3) exclusivo ao motor de Loop

---

### ✅ Fix — Loop travado + pool de vídeos independente (2026-06-15)
**Commits:** `00d5ffb`, `d53887d`

#### Problema 1 — Loop postando em somente 1 conta (warmup bloqueado)

**Causa raiz:** migração SQL `UPDATE instagram_accounts SET is_warmed_up = true` nunca foi executada no Supabase, apesar de estar marcada como "← EXECUTAR" no CLAUDE.md.

**Efeito:** 13 das 14 contas da pasta LEXY tinham `is_warmed_up = false` + `warmup_posts_done = 20` + `warmup_paused_until` no futuro (pausa de 8h após lote 2/3 do warmup). O `process-loops` pulava essas contas silenciosamente com `continue` no warmup check. Somente `ursulajessicaemanuela` (única com `is_warmed_up = true` manual) postava.

**Fix:**
- SQL executado no Supabase: `UPDATE instagram_accounts SET is_warmed_up = true` → 21 contas atualizadas
- Guarda de auto-graduação adicionada em `process-loops` (FASE 2b, antes do warmup check): se `warmup_posts_done >= 30` e `is_warmed_up = false`, persiste a correção e prossegue — safety net para evitar reincidência se publish-pending falhar ao persistir a graduação no 30º post

**Regra aprendida:** Toda migration que adiciona coluna booleana de feature-flag com `DEFAULT false` deve incluir `UPDATE` imediato para linhas existentes. O warmup só faz sentido para contas NOVAS adicionadas via OAuth após o deploy da feature.

#### Problema 2 — 247 vídeos divididos entre contas em vez de 247 por conta

**Causa raiz:** `assignVideosForLoop` em `process-loops` usava `locallyAssigned` — um Set que marcava o vídeo escolhido por uma conta como indisponível para as demais no mesmo ciclo.

**Efeito:** Com 247 vídeos e 14 contas, cada ciclo distribuía 14 vídeos únicos (um por conta). Cada conta só completaria a rotação dos 247 vídeos após ~18 ciclos, compartilhando o pool global — em vez de cada conta ter seu próprio percurso independente pelos 247.

**Comportamento correto:** 247 vídeos **por conta**; cada conta percorre o pool completo individualmente, independente das demais.

**Fix:** Removido `locallyAssigned` do filtro de disponibilidade. Agora `available = allVideos.filter(v => !postedByAccount.has(v.id) && !globallyTaken.has(v.id))` — a única exclusão por conta é o histórico individual (`postedByAccount`). O mesmo vídeo pode ser atribuído a múltiplas contas no mesmo ciclo (normal e esperado).

---

### ✅ Sessão 2026-06-16 — Anti-fingerprint v1 + FFmpeg 6.1.1 + efeitos em todos os fluxos

#### Feat — Anti-fingerprint v1: 4 melhorias em `lib/video-effects.ts`
**Commit:** `7944be5`

Primeira rodada de reforço do base fingerprint gerado por `baseParams()`:

1. **`-map 0:v:0 / -map 0:a:0?` explícito** — descarta data streams, SEI custom atoms e trilhas de telemetria dos CDNs que passavam pelo re-encode sem o map explícito. Antes o FFmpeg copiava todos os streams por padrão.

2. **`volume=N` por conta (±3%)** via FNV-1a(accountId) — quebra Chromaprint/AudioID da Meta. Antes só `atempo` existia (mudava velocidade, mas amplitude do áudio era idêntica entre contas).

3. **`hue=h=N` por conta (±3° base / ±5° antiAi)** — rotação de matiz nos canais Cb/Cr de todos os pixels. Quebra pHash residual que sobrevivia às variações sutis de `eq` (±1.2% contrast).

4. **Ranges expandidos:** speed ±0.2% → ±0.5% (5 → 11 valores); lumaNoise 1–3 → 2–5; contrast/saturation ±1.2% → ±1.6%; brightness ±0.9% → ±1.4%.

---

#### Chore — Migração `@ffmpeg-installer` → `ffmpeg-static` (FFmpeg 4.1 → 6.1.1)
**Commit:** `bd77cf8`

`@ffmpeg-installer/ffmpeg` estava abandonado desde 2021 com FFmpeg 4.1 (novembro/2018). Substituído por `ffmpeg-static` com FFmpeg 6.1.1 (dezembro/2023).

**Benefícios:**
- libx264 mais moderno → NAL units com estrutura diferente por conta
- Filtros `hue`, `noise`, `volume`, `eq` mais precisos e corretos no 6.x
- Pacote mantido ativamente (último update 2024)

**Arquivos alterados:** `lib/ffmpeg-process.ts`, `lib/video-effects.ts`, `utils/videoSanitizer.ts`, `next.config.ts` (serverExternalPackages).

---

#### Feat — `applyVideoEffects` em todos os fluxos de postagem
**Commit:** `cdffe32`

Anti-fingerprint existia **apenas** no fluxo Loop (`process-loops`). A aba Postar (`publish-scheduled` e `posts/create`) enviava vídeos 100% idênticos para todas as contas — fingerprint trivialmente detectável pela Meta.

**Fix:**
- `app/api/cron/publish-scheduled/route.ts`: aplica `applyVideoEffects` antes de criar container Meta, **apenas quando `!creationId`** (container novo) — evita re-processar containers já criados em ciclos anteriores.
- `app/api/posts/create/route.ts`: aplica efeitos dentro do loop de publicação imediata, uma vez por conta com o `account.id` como seed.
- Ambos com fallback gracioso: FFmpeg falha → usa URL original + log de aviso, sem interromper a postagem.

---

### ✅ Sessão 2026-06-17 (cont.) — Fix ERANGE/EINVAL no FFmpeg 4.1: remoção de colorchannelmixer e crop+scale

**Commits:** `0e1d7f6`, `437cb8f`, `191b2c8`

#### Problema: ERANGE e EINVAL persistentes após anti-fingerprint v3

Após adicionar `colorchannelmixer` e `crop+scale` ao pipeline de efeitos, múltiplas contas passaram a falhar com:

```
Error reinitializing filters!
Failed to inject frame into filter network: Numerical result out of range   ← ERANGE
Failed to inject frame into filter network: Invalid argument                ← EINVAL
```

O erro não era de configuração inicial — era **mid-stream**, durante o processamento de frames específicos.

#### Causa raiz

**Por que ocorre "Error REINITIALIZING filters":**
Em FFmpeg 4.1, alguns streams H.264 do Instagram contêm mudanças de SPS/PPS mid-stream (parameter set change). Quando isso ocorre, o FFmpeg tenta reinicializar o grafo de filtros para os novos parâmetros. Filtros que dependem de colorspace conversion ou que mudam dimensões falham nessa reinicialização.

**`colorchannelmixer` → ERANGE:**
- Opera no colorspace RGB; FFmpeg insere automaticamente um filtro `format` (YUV→RGB) antes e outro (RGB→YUV) depois
- O filtro `format` implícito não suporta reinicialização graceful no FFmpeg 4.1
- Combinado com `setpts` (que modifica PTS), a reinicialização falha com ERANGE

**`crop+scale` → EINVAL:**
- `crop` reduz dimensões (ex: 1080×1920 → 1076×1916); `scale` restaura
- Mudança de dimensões durante reinicialização do grafo de filtros → EINVAL
- `pad+crop` tinha o mesmo problema (ERANGE); substituir por `crop+scale` não ajudou

**Flags temporais `t+u` no noise → ERANGE (causa anterior):**
- `c0f=t+u:c1f=t+u:c2f=t+u` usa o PTS como seed do noise
- Combinado com `setpts`, os PTS modificados causavam ERANGE em streams com timing não-standard
- Removidos primeiro (`0e1d7f6` + `437cb8f`), mas ERANGE persistia por causa do `colorchannelmixer`

#### Filtros seguros no FFmpeg 4.1

Todos os filtros do pipeline v2 operam em **yuv420p sem mudar colorspace ou dimensões**:

| Filtro | Colorspace | Dimensão | Reinit safe? |
|--------|------------|----------|--------------|
| `eq` | yuv | inalterada | ✅ |
| `hue` | yuv | inalterada | ✅ |
| `setpts` | n/a | n/a | ✅ |
| `noise=c0s:c1s:c2s` (sem flags) | yuv | inalterada | ✅ |
| `unsharp` | yuv | inalterada | ✅ |
| `colorchannelmixer` | **RGB** | inalterada | ❌ (ERANGE) |
| `crop` + `scale` | yuv | **muda** | ❌ (EINVAL) |

#### Fix aplicado

Removidos `colorchannelmixer` (seção 3f) e `crop+scale` (seção 3g) de `lib/video-effects.ts`. Chain de filtros estabilizado:

```
eq=contrast=X:brightness=Y:saturation=Z
hue=h=N
setpts=SPEED*PTS
noise=c0s=LUMA:c1s=CHROMA:c2s=CHROMA
unsharp=3:3:SHARP:3:3:0.0
```

`h3 = fnv1a(accountId + "\x03")` e os campos `cropX`, `cropY`, `ccm` removidos de `baseParams()`. Hash agora usa apenas 3 entradas independentes (h0, h1, h2).

#### Estado atual do pipeline de efeitos

O baseline v2 já tem 10 dimensões de variação únicas por conta:
- Speed ±1.5% (31 valores) — temporal
- Contrast ±2.4% — luma
- Brightness 0.5–2.5% — luma
- Saturation ±2.4% — chroma
- Luma noise 6–18 — DCT
- Chroma noise 2–6 — colorimétrico
- Volume ±4.5% — áudio
- Hue ±8° — colorimétrico
- CRF 18–24 — quantização DCT
- Unsharp 0.2–0.8 — bordas

---

#### Fix — Loop analytics: conta contas do modo pasta
**Commit:** `d21e473`

**Problema:** `GET /api/loops/[id]/analytics` usava `loop_accounts` (join direto) para calcular `accountCount`. Em loops com `account_folder_id` (modo pasta dinâmico), `loop_accounts` fica **vazia** (nenhuma conta está vinculada diretamente). Resultado: `accountCount=0` → `total_videos = videos_count × 1` em vez de `× N_contas`.

**Fix:** Detecta modo pasta via `loop.account_folder_id` e executa query separada em `instagram_accounts WHERE folder_id = account_folder_id AND is_active = true AND health_status != 'error'` para obter o count real de contas.

---

### ✅ Sessão 2026-06-17 — Anti-fingerprint v2: 6 melhorias para quebrar pHash da Meta

**Commit:** `7b38bfd`

#### Diagnóstico: por que os vídeos travavam em ~300 views

O Instagram usa **pHash (perceptual hash)** de frames amostrados em 32×32 para detectar conteúdo duplicado entre contas. Os parâmetros da v1 eram sutis demais:

| Parâmetro | v1 (antes) | v2 (depois) | Por quê importa |
|---|---|---|---|
| Speed | ±0.5% (11 val.) | **±1.5% (31 val.)** | Frame amostrado em t=5s muda ±0.225s — muda qual frame entra no pHash |
| Hue | ±3° | **±8° base / ±12° antiAi** | ±3° não movia Cb/Cr o suficiente para flipar bits do hash colorimétrico |
| Luma noise | c0s=2–5 | **c0s=6–18** | c0s=5/255≈2% — downsampling para 32×32 anulava o efeito |
| Chroma noise | **c1s=0 (fixo!)** | **c1s/c2s=2–6** | Zero fixo = canais Cb/Cr idênticos entre contas → pHash colorimétrico passava |
| CRF | **22 (fixo!)** | **18–24 por conta** | CRF igual = macroblocks quasi-idênticos = mesmo hash de bitstream |
| Unsharp mask | ausente | **0.2–0.8 por conta** | Edge fingerprint (Canny/LoG) ficava idêntico entre contas |

**O mais crítico:** `c1s=0:c2s=0` era hardcoded — os canais de cor Cb/Cr eram idênticos para todas as contas postando o mesmo vídeo.

#### Arquitetura do `baseParams()` na v2

Três entradas FNV-1a independentes para eliminar correlação entre dimensões:
- `h0 = fnv1a(accountId)` → speed, contrast, brightness, saturation
- `h1 = fnv1a(accountId + "\x01")` → lumaNoise, chromaNoise, volume
- `h2 = fnv1a(accountId + "\x02")` → hue, crf, unsharp

#### Cadeia de filtros FFmpeg final (por conta)

```
eq=contrast=X:brightness=Y:saturation=Z
hue=h=N
setpts=SPEED*PTS
noise=c0s=LUMA:c0f=t+u:c1s=CHROMA:c2s=CHROMA:c1f=t+u:c2f=t+u
unsharp=3:3:SHARP:3:3:0.0
```

Audio: `volume=VOL,atempo=SPEED`

Encode: `-c:v libx264 -preset ultrafast -crf CRF -c:a aac -b:a 128k`

#### Como verificar nos logs da Vercel

Filtrar por `[video-effects]` — cada conta deve ter valores diferentes:
```
[video-effects] ✓ [spd=0.998+luma=12+chroma=4+vol=0.975+hue=-3°+crf=21+sharp=0.5] | 8.3 MB → temp/vfx_...
[video-effects] ✓ [spd=1.003+luma=8+chroma=6+vol=1.020+hue=+5°+crf=24+sharp=0.3] | 9.1 MB → temp/vfx_...
```

---

## Sessão 2026-06-18 — stagger cap + video-effects refactoring + SEI stripping

### Fix — stagger cap 50% do interval (commit `8e9a4ce`)

**Problema:** Contas com índice alto no loop recebiam `retry_after = now + (interval_minutes - 3)`. Margem de 3 min era insuficiente — `publish-pending` poderia não ter processado o container antes do próximo `process-loops`. Resultado: `containerAlreadyExists = true` → conta pulava o ciclo → intervalo efetivo dobrava.

**Fix:** `initialDelayMinutes = Math.min(rawDelay, Math.floor(interval_minutes * 0.5))`

Com 50% do intervalo como cap, todos os containers da janela anterior são publicados com folga antes do próximo ciclo.

---

### Fix — video-effects: zero re-encoding automático (commits `03aa175`, `5b553eb`)

**Problema:** Base fingerprint automático (speed ±4%, eq, CRF variável) foi adicionado para derrotar VPDQ da Meta. Views caíram de normal para **4–8 por vídeo**.

**Linha do tempo do base fingerprint:**
| Commit | Speed | CRF | Resultado |
|---|---|---|---|
| `1835f38` — primeiro base | ±0.2% | 22 fixo | ✅ ok |
| `7944be5` | ±0.5% | 22 fixo | ✅ ok |
| `7b38bfd` | ±1.5% | 18–24 | ⚠️ arquivos grandes |
| `c5f3237` | **±4%** | 18–26 | ❌ speed perceptível |
| `ac323c3` | ±4% | **30–34** | ❌ dupla compressão |

**Causa raiz dupla:**
1. Speed ±4% é perceptível ao espectador → queda de retenção → algoritmo suprime
2. CRF 30–34 + fonte Instagram ~CRF 32 = dupla compressão lossy → qualidade degradada → Instagram re-transcodifica de fonte ruim → menos views

**Decisão:** FFmpeg NÃO é executado automaticamente. Só roda quando usuário ativa efeito criativo (hflip/negate/zoom/blur/noise/antiAi) no painel do Loop. Sem efeito ativo → URL original postada diretamente (zero re-encoding, qualidade máxima).

**Lição:** Re-encoding automático para "derrotar fingerprint" causa mais dano (qualidade) do que o fingerprinting em si. Prioridade: qualidade do vídeo > derrota de VPDQ.

---

### Fix — SEI NAL units stripping (commit `0e32c69`)

**Problema:** `-map_metadata -1` limpa apenas metadados do container MP4. SEI NAL units (H.264 tipo 6) ficam embutidos no bitstream de vídeo e sobrevivem ao stream copy com `-c:v copy`. Contêm:
- UUID de rastreamento do CDN Instagram
- Creator ID
- Fingerprint de conteúdo

**Fix:** `-bsf:v filter_units=remove_types=6` adicionado nos três pipelines de entrada de vídeo:
- `utils/videoSanitizer.ts` → `sanitizeAndHashBust` (salvar Inspiração na Biblioteca)
- `utils/videoSanitizer.ts` → `sanitizeDoublePass` (download local)
- `lib/ffmpeg-process.ts` → `downloadAndStripMetadata`

**Pipeline de limpeza completo por camada:**
```
-map 0:v:0 -map 0:a:0?          → descarta data streams, tracks extras
-bsf:v filter_units=remove_types=6  → remove SEI NAL type 6 do bitstream H.264
-map_metadata -1                 → remove metadados container MP4
-map_chapters -1                 → remove chapter markers
-f mp4                           → strict container, sem atoms não-padrão
```

**Nota:** Strip ocorre UMA VEZ quando o vídeo entra na Biblioteca. Pipeline de postagem não precisa repetir — vídeo já está limpo no Supabase.

Parâmetros diferentes + tamanhos diferentes (CRF variável) = fingerprint único por conta.

---

## Sessão 2026-06-22

### Diagnóstico — Loop LEXY sem postagens (pasta de mídia vazia)

**Problema:** Loop LEXY criado às 10:44 UTC. Após 5h: `last_posted_at=NULL`, `cycles_done=0`, zero containers em `pending_containers`.

**Root cause:** A pasta de mídia "LEXY" em `videos_library` tinha **0 vídeos**. O `process-loops` tenta `SELECT * FROM videos_library WHERE folder_id = loop.folder_id`, encontra array vazio, e executa `continue` silenciosamente para cada conta — sem criar container, sem log de erro, sem atualizar `last_posted_at`.

**Diagnóstico via SQL:**
```sql
SELECT lf.name, COUNT(vl.id) FROM library_folders lf
LEFT JOIN videos_library vl ON vl.folder_id = lf.id
GROUP BY lf.name;
-- LEXY: 0 | JENI: 320 | VICK: 175
```

**Solução:** Adicionar vídeos à pasta correta na Biblioteca ou redirecionar o loop para pasta existente.

**Lição:** Quando um loop tem `last_posted_at=NULL` e `cycles_done=0` após horas, verificar PRIMEIRO se a pasta de mídia tem vídeos. É a causa mais comum de loop "fantasma".

---

### Fix — Clone: scrape limitado retornando menos reels que o esperado (commit `881a1d2`)

**Problema:** Conta com 140 reels mostrava apenas 40 no painel de Clone.

**Root cause:** `handleSearch` em `clone/page.tsx` passava `limit: 100` hardcoded para a API, independente de qualquer configuração do usuário. O Apify com `resultsLimit: 100` e `maxRequestsPerCrawl: Math.max(200, 25) = 200` retornou 40 reels (o Apify/Instagram limitou a paginação).

**Fix:**
- Frontend: `limit: 100` → `limit: 300`
- API (search + poll): `maxRequestsPerCrawl: Math.max(500, limit*3)` → `Math.max(300, limit*2) = 600`
- A seleção "10/20/50/100/Todos" na UI continua controlando apenas quantos **agendar** — o scrape sempre tenta buscar o máximo

---

### Fix — Revisão completa aba Clonar Perfil (commit `a1b1634`)

10 bugs corrigidos em 6 arquivos após revisão sistemática:

#### Segurança
- **Auth ausente:** `POST /api/clone/search` e `GET /api/clone/search/poll` não verificavam autenticação. Qualquer pessoa podia disparar scrapes Apify e ler resultados (perfil, stats, URLs de vídeos de outros usuários).
- **Sem validação de ownership:** `clone/create` inseria posts com qualquer `account_id` sem verificar se pertence ao usuário. Fix: query via supabase client (RLS) antes de inserir.

#### Scraping
- **Filtro duplo excludente:** poll/route.ts tinha `.filter(item => item.type === "Video" || resolveVideoUrl(item))` ANTES do `.filter(r => r.videoUrl)` final. O primeiro filtro excluía reels com type diferente de "Video" mesmo que tivessem videoUrl válido. Removido; só o filtro final permanece.
- **Fallback usa token errado:** ao fazer fallback para URL principal do perfil, usava `client` do run original. Fix: usa o pool de tokens.
- **try/catch ausente em req.json():** body inválido causava HTTP 500 em vez de 400.

#### Publicação (maior impacto)
- **downloadAndHostForMeta com fetch global:** Next.js 15 patcha o `fetch` global e descarta o `dispatcher` (proxy) silenciosamente. Downloads do CDN do Instagram saíam pelo IP puro da Vercel. Migrado para `undiciFetch` da undici com proxy.
- **cloneFetchCount bloqueava múltiplos posts:** após 1 scrape Apify, todos os outros posts clone do mesmo batch eram adiados. Fix: cache em memória `cloneUrlCache` — reels com a mesma URL instagram.com (mesma conta, múltiplas contas postando mesmo reel) compartilham 1 scrape sem re-scraper.
- **Re-scrape em ciclos futuros:** quando Supabase URL era gerada, só o post atual era atualizado. Fix: batch-update atualiza TODOS os `scheduled_posts pending` com a mesma URL instagram.com original.
- **Stuck posts:** threshold de desbloqueio `publishing` reduzido de 10 min para 5 min.

#### Stagger
- **Stagger fixo de 5 min/conta ignorava o intervalo:** com 20 contas e 48 ppd (intervalo=30min), última conta recebia stagger de +100 min — mais de 3 ciclos de atraso. Fix: `perAccountStaggerMs = min(5min, interval / accounts / 2)`.

#### Frontend/Campanhas
- **Sort de campanhas por `created_at` inexistente:** campo `created_at` não é retornado pela RPC `get_campaign_summaries`. `new Date(undefined)` = NaN → ordem aleatória. Corrigido para `first_slot`.
- **loadCampaigns sem useCallback:** potencial para múltiplos `setInterval` em re-renders frequentes.
- **Payload excessivo:** selecionando "10 reels", o frontend enviava os 300 raspados ao backend e deixava o backend cortar. Agora pré-corta antes de serializar.
- **isCancelled impreciso:** não cobria cancelamentos parciais (alguns publicados + alguns cancelados).
- **pct=null quando total=0:** era retornado como 100 (barra cheia enganosa).

#### Arquitetura do cache de clone
```
Ciclo cron:
  Post A (instagram.com/reel/XYZ, conta 1):
    → Apify scrape → CDN URL
    → undiciFetch download (com proxy)
    → Supabase upload temp/clone_{id}.mp4
    → cloneUrlCache["instagram.com/reel/XYZ"] = "supabase.co/..."
    → UPDATE scheduled_posts SET video_url=supabase_url WHERE video_url="instagram.com/reel/XYZ"
    → Cria container Meta

  Post B (instagram.com/reel/XYZ, conta 2) [mesmo ciclo]:
    → cloneUrlCache.has("instagram.com/reel/XYZ") = TRUE
    → usa supabase URL direto → não precisa scraper
    → Cria container Meta

  Post C (instagram.com/reel/ABC, conta 1) [ciclo seguinte]:
    → video_url no banco já é supabase URL (batch-update do ciclo anterior)
    → isCloneUrl() = FALSE → não entra no bloco clone
    → Cria container Meta diretamente
```

---

### ✅ Fix Urgente — Clone: zero posts publicados após 2h (2026-06-23)
**Commit:** `fbd6534`

#### Problema
Campanha de clone criada às 11:37 local (14:37 UTC), 2 horas depois zero posts publicados. Diagnóstico via SQL direto no Supabase.

#### 3 causas em cascata

**1. Post bloqueante com [RETRY] na fila**
Um post de campanha anterior (`reel/DYFD7f8t9ba/`, 12:45 UTC) tinha `error_message: "[RETRY] Campo videoUrl ausente no item Apify."`. Como a query de elegíveis ordena por `scheduled_at ASC`, esse post era SEMPRE o primeiro do batch. A cada ciclo de 1 minuto ele consumia o único slot de scrape Apify (`cloneFetchCount=1`), e os outros 9 posts do batch eram pulados. Os 392 posts da nova campanha (14:50 UTC) nunca eram alcançados.

**Fix:** SQL imediato — `UPDATE scheduled_posts SET status='failed' WHERE error_message LIKE '%[RETRY]%videoUrl ausente%'`.

**2. Campo `playVideoUrl` faltando em `fetchFreshReelUrl`**
O Apify retorna o URL do vídeo de reels em campos variados dependendo do item. O `poll/route.ts` tinha `playVideoUrl` na resolução, mas o `publish-scheduled` não. Reels que usam esse campo falhavam com "videoUrl ausente".

**Fix:** Adicionado `(item.playVideoUrl as string | undefined)` ao resolver em `fetchFreshReelUrl`.

**3. Erro tratado como transitório → retry eterno**
A mensagem de erro anterior "Campo videoUrl ausente no item **Apify**." continha "apify", que está na lista `TRANSIENT_PATTERNS`. `isTransientError()` retornava `true` → post voltava para `pending` com prefixo `[RETRY]` → retry infinito em vez de falhar permanentemente.

**Fix:** Nova mensagem "Reel sem URL de vídeo — conteúdo indisponível ou post de foto." sem a palavra "apify" → `isTransientError()` retorna `false` → post marcado como `failed` permanente na primeira ocorrência.

#### Lição
O `cloneFetchCount >= 1` (limite de 1 scrape Apify por ciclo) é correto dada a restrição de 55s de budget. O problema foi que um post "tóxico" consumia esse slot todo ciclo sem nunca avançar. Qualquer erro de Apify que não seja de rede/timeout deve ser permanente, não transitório.

---

### ✅ Feat — Sincronizar Todas as Contas + Excluir Vídeos Pendentes (2026-07-05)

#### Contexto
Pedido do usuário: botão único (ícone de duas setas em círculo) na aba Contas para sincronizar todas as contas de uma vez, e um botão no menu ⋯ de cada conta para excluir vídeos pendentes na fila (inspirado num SaaS concorrente que o usuário usa como referência).

#### Sincronizar Todas as Contas — 3 bugs ao longo da implementação
1. **Endpoint sem timeout/orçamento:** `/api/accounts/sync-all` processa em lotes de 2 com 3s de delay (anti-cascata Meta). Com 59 contas (nenhuma sincronizada há mais de 5min), o processamento facilmente estourava os 60s de `maxDuration` da Vercel — a função era matada no meio sem responder, e o fetch do frontend ficava pendurado pra sempre (botão girando infinitamente). Fix: `AbortSignal.timeout(15s)` por chamada undici + `Promise.race` por lote contra um orçamento total de ~40-45s, garantindo resposta sempre a tempo.
2. **Stale closure no frontend:** `handleSyncAll` (`useCallback`) não tinha `accounts` no array de dependências — fechava sobre o array vazio (`[]`) do estado inicial pra sempre, travando a estimativa de total exibida (`0/0`) mesmo com 59 contas reais.
3. **Reprocessamento infinito:** o parâmetro `force=true` (pra ignorar o cache de 5min) fazia CADA chamada de continuação reprocessar as mesmas primeiras contas do array, nunca avançando pro resto — porque `force` bypassa o filtro de staleness inteiro, incluindo contas já sincronizadas nesta mesma sessão. Fix: endpoint aceita `excludeIds` no body; frontend acumula os IDs já processados entre chamadas.

Resultado final: botão com contador `X/Y` ao lado, atualizando em tempo real conforme o backend processa lotes, sempre se recuperando de erros de rede.

#### Excluir Vídeos Pendentes por conta
Antes de implementar, o usuário pediu para "excluir todos os vídeos" de uma conta — investigação revelou que a Meta Graph API só suporta `DELETE /{media-id}` para contas conectadas via **Facebook Login for Business** (`graph.facebook.com`), não via **Instagram Login API** (`graph.instagram.com`) que este projeto usa exclusivamente (0 de 59 contas têm `fb_page_id`). Não existe forma programática de apagar um post real do Instagram neste projeto. Escopo reduzido, com acordo do usuário, para limpar apenas a fila interna: `POST /api/accounts/[id]/clear-queue` remove `scheduled_posts` e `pending_containers` (pending/publishing/error) daquela conta específica.

#### Lição
Antes de prometer qualquer feature de "deletar/gerenciar mídia do Instagram" via API, verificar primeiro se o tipo de login/token da conta suporta a operação — Facebook Login e Instagram Login API têm superfícies de API bem diferentes apesar de ambos serem "Graph API".

---

### ✅ Feat — Reconstrução da aba Stories (2026-07-05)

#### Contexto
Usuário mostrou print da aba de Stories de outro SaaS e pediu pra reconstruir a equivalente aqui, com as funcionalidades realmente funcionando. A implementação anterior (`app/dashboard/stories/page.tsx`, 1109 linhas) era uma campanha de distribuição em massa por vários dias — nunca usada de verdade em produção (confirmado: zero linhas com `post_type='story'` em `scheduled_posts` antes da reconstrução), então a substituição não teve nenhum risco de migração de dados.

#### Descobertas técnicas que guiaram o design
- **Sticker de link automático não existe na API da Meta** para nenhum tipo de login — usuário confirmou que pode ignorar essa parte do print de referência.
- **A feature de Stories já em produção usa `scheduled_posts` + o cron `publish-scheduled`**, não a tabela `single_posts` (Fase 40) — que está órfã e, pior, depende de `publishViaMetaAPI` hardcoded para `mediaType="REELS"` (postaria Stories como Reel se reativada).

#### Implementação
- `POST /api/posts/stories/post-now`: insere 1 linha por conta em `scheduled_posts` com `scheduled_at = now+5s`, reaproveitando 100% do pipeline de publicação já testado (`publish-scheduled`).
- `GET/DELETE /api/posts/stories/history`: painel "Histórico" com contadores e delete por item/tudo — remove só o log interno, nunca o post real do Instagram (mesma limitação de API do tópico anterior).
- **Templates de Story**: `POST /api/stories/templates/import` busca o story ativo de uma conta via Graph API com `fields=id,media_type,media_url,timestamp` — as rotas existentes de contagem de stories (`accounts/stories`, `instagram/stories`) só pediam `id,timestamp`, nunca `media_url`. Baixa a mídia e re-hospeda no Supabase Storage (mesmo padrão de `downloadAndHost()` do `prefetch-clone-urls`) porque a URL do CDN da Meta é efêmera — não serve pra repostar dias depois. Novo cron `app/api/cron/story-templates` (a cada 30 min) replica o padrão de elegibilidade + claim atômico do `process-loops`, mas bem mais simples (1 mídia fixa, sem pool/shuffle).
- Modelo (pasta de contas) vira seleção única obrigatória na UI, renomeando o conceito de `account_folders` já existente — evita postar na conta errada.
- Novas tabelas: `story_templates` + `story_template_accounts` (RLS). Rota antiga `app/api/posts/stories/route.ts` deletada.

#### Bug descoberto durante o teste real: bucket Storage não aceitava imagem
Usuário testou subir uma foto (PNG, depois JPG de 922KB) e ambos falharam com 500. Investigação: `storage.buckets.allowed_mime_types` do bucket `videos-library` tinha só `video/mp4`, `video/quicktime`, `video/webm` — nunca incluiu tipos de imagem, apesar do código da rota de upload já validar/aceitar `image/jpeg`/`image/png` há tempos. A allowlist do bucket é uma camada independente da validação da rota, invisível sem checar direto no Postgres (`select allowed_mime_types from storage.buckets`). Corrigido via `UPDATE storage.buckets` direto no Supabase + `supabase/storage.sql` atualizado.

#### Lição
Ao dar suporte a um novo tipo de arquivo em qualquer rota de upload deste projeto, sempre conferir a allowlist do bucket no Supabase Storage — a validação client/route-level não é suficiente, o bucket tem sua própria allowlist que rejeita silenciosamente (500 sem detalhe) tudo fora dela.

---

### ✅ Fix Urgente — publish-scheduled: fila de campanha travada, zero publicações (2026-07-05)

#### Problema
Usuário reportou (com bastante frustração, "sempre trava") que a campanha ativa não estava postando nada. Análise de ~50 execuções recentes do cron `publish-scheduled` via Vercel MCP: 22 timeouts de fingerprint FFmpeg, 16 execuções com o lote inteiro (20 posts) adiado por falta de orçamento de tempo, `queue_eligible` travado em 21-23 sem nunca cair. **Zero publicações reais** em todas as execuções amostradas.

#### Causa raiz dupla
1. **Starvation:** quando o fingerprint FFmpeg falhava/estourava timeout (`catch (fxErr)`), o post voltava para `status='pending'` mantendo o MESMO `scheduled_at` antigo. Como a query de elegíveis ordena por `scheduled_at ASC`, esse mesmo post continuava sendo sempre o primeiro da fila — re-tentado e re-falhando no mesmo posto todo ciclo de 1 minuto, travando os 20+ posts atrás dele para sempre. **Este é exatamente o mesmo padrão de bug já documentado em "Fix Urgente — Clone: zero posts publicados após 2h" (2026-06-23)**, só que lá era o scrape Apify consumindo o slot, aqui é o fingerprint FFmpeg.
2. **Orçamento de tempo baixo demais:** `RUN_BUDGET_MS = 55_000` quando a função já tinha `maxDuration = 300` liberado pela Vercel. O timeout interno do FFmpeg (45s) sozinho quase esgotava todo o orçamento de 55s na primeira conta tentada, sobrando budget insuficiente para as outras 19 do lote (que eram adiadas sem sequer tentar).

#### Fix
- Ao falhar o fingerprint, empurra `scheduled_at` +3min antes de voltar para `pending` (nova constante `FINGERPRINT_RETRY_DELAY_MS`), dando chance a outros posts na próxima execução.
- `RUN_BUDGET_MS` 55s→250s — confirmado seguro porque o claim atômico por post (`status: pending→publishing` condicionado) já protege contra processamento duplicado mesmo com invocações do cron se sobrepondo (o cron roda a cada 1 min, mas cada post só é processado por quem vencer o UPDATE condicional).
- `FINGERPRINT_RESERVE_MS` 30s→100s, `STRIP_RESERVE_MS` 22s→30s.
- Timeout interno do FFmpeg (`lib/video-effects.ts`) 45s→90s, dando mais chance de terminar em vez de ser morto no meio.

Commit `cdcc0b8`. Resultado confirmado nos logs pós-deploy: múltiplas publicações reais com `media_id` retornado pela Meta em poucos minutos, fila (`pending`) caindo de forma mensurável pela primeira vez.

Junto com esse fix, `publish-scheduled` também passou a **priorizar posts de Stories** (`post_type='story'`) na frente de posts de campanha em massa (commit `3f1b55d`) — Stories esperam publicação quase imediata via "Postar agora", e antes competiam igualmente com uma fila de ~1.263 posts de campanha.

#### Lição
Todo catch-block que reseta um job de fila para retry DEVE avançar o timestamp de ordenação (nunca deixar como estava) — é o segundo incidente de starvation por esse exato padrão neste projeto (Apify em junho, FFmpeg em julho). Vale revisar outros crons (`process-loops`, `publish-pending`) em busca do mesmo anti-padrão antes que vire um terceiro incidente.

---

### ✅ Sessão 2026-07-07 — Stories: indicador de story ativo por conta + separação Automatizar × Postar

#### Feat — Indicador de story ativo ao selecionar pasta na aba Stories (commit `ced8fdb`)
Ao selecionar um modelo (pasta) em `/dashboard/stories`, a página agora dispara checagem ao vivo via `GET /api/accounts/stories` — rota que já existia (consulta `graph.instagram.com/{id}/stories` com proxy por conta) e não era usada pela UI de Stories. Resultado na seção Contas:
- Anel gradiente matrix→cyan no avatar (estilo Instagram) nas contas que já têm story ativo, com tooltip de contagem.
- Legenda "N com story ativo · M sem story" acima dos chips.
- Atalho **"Sem story"** ao lado de Todas/Limpar — seleciona de uma vez só as contas que ainda não postaram (caso de uso principal).
- Botão RefreshCw para recheck manual; fetch roda uma vez por visita (cache em memória da página) para não martelar a Meta a cada troca de pasta.
- Bônus: modal "Importar do IG" mostra o mesmo anel + badge verde "story ativo" na escolha da conta fonte — lá o usuário precisa escolher justamente uma conta COM story.

#### Fix — Campanhas de Automatizar/Clonar vazavam para "Campanhas Ativas" do Postar (commit `fedf4ee`)
O cron `process-automations` grava `scheduled_posts` com `campaign_id = automation.id`, e o `GET /api/campaigns` agrupa TODOS os `scheduled_posts` por `campaign_id` sem distinguir origem — automações (e clones) apareciam como campanha na aba Postar. Fix:
- API busca os ids da tabela `automations` do usuário e marca `is_automation` em cada summary.
- Aba Postar filtra `!is_automation && !is_clone` na lista de Campanhas Ativas — cada origem fica na sua aba.
- **Preservado de propósito:** a detecção de "contas sem campanha ativa" (borda vermelha + botão Novas) segue contando automações e clones — conta coberta por automação está recebendo posts. Monitor de Campanhas também segue agregado (é a função dele).

#### Lição
Compartilhar a fila `scheduled_posts` entre origens (Postar/Clonar/Automatizar/Stories) é a arquitetura certa — retry, proxy e fingerprint em um pipeline só. Mas toda UI que agrupa por `campaign_id` precisa saber a ORIGEM do id (tabela `automations`, flag `is_clone` via `clone_source_profile`, `post_type='story'`) antes de exibir, senão as abas vazam umas nas outras.

---

### ✅ Sessão 2026-07-08 — Fix urgente: views 0–200 no Automatizar (fingerprint) + preparação para 200 contas

#### Fix — Fingerprint automático removido de publish-scheduled e posts/create (commit `6ea2e02`)
Usuário reportou views péssimas nas contas do Automatizar (novas com 0, antigas caindo de 2k+ para 100–200), enquanto a melhor conta — que estava no Loop — fez 25k views com o mesmo tipo de conteúdo.

**Causa:** commit `3df0cb6` (30/06) reintroduziu `processVideoForAccount` INCONDICIONAL no `publish-scheduled` e `posts/create` — re-encode libx264 ultrafast CRF 22 + `maxrate 4M` (piorado em `36be7db`, 06/07) + noise + eq + pitch shift ±1% em TODO vídeo. Dupla compressão lossy → Meta re-transcodifica de fonte ruim → retenção baixa → alcance suprimido. O pitch shift ainda quebrava o reconhecimento de áudio em trending. **Mesma lição de 18/06 (`5b553eb`)**, que removeu o base fingerprint do Loop mas não foi replicada quando o publish-scheduled ganhou fingerprint depois.

**Fix:** chamada removida dos dois arquivos — URL original do Supabase vai direto à Meta, igual ao "modo direto" do `process-loops`. Strip de metadados/SEI mantido (stream copy, sem perda). REGRA PERMANENTE: nunca reintroduzir re-encode FFmpeg automático no caminho de postagem; FFmpeg só com efeito criativo ativado pelo usuário.

#### Perf — process-automations pronto para 200 contas × 12/dia (commit `56a3dae`)
Usuário planeja modelo com 200 contas, proxy fixo único por conta, apps Meta separados, intervalo de 2h (2.400 posts/dia). Motor de publicação já aguentava (capacidade ~28k/dia); dois pontos não escalavam:
1. **Histórico em janelas:** a query puxava TODO o histórico de todas as contas a cada minuto — estouraria o `.limit(100000)` em ~40 dias e truncaria em silêncio, quebrando o anti-repetição. Agora: anti-repetição busca só as contas que precisam de post no run (1–3/min em regime, janela 90d); balanceamento global com janela 7d; run sem conta precisando pula as queries.
2. **Stagger dinâmico:** `offset_seconds` fixo (5 min × 200 contas = última conta +16h40 no arranque) substituído por `intervalo ÷ nº de contas` com jitter ±30% — 2h/200 contas = 1 post a cada ~36s constante, sem rajadas. Campo `offset_seconds` permanece no banco/UI mas o cron não lê mais.

#### Recomendações registradas para a operação de 200 contas
- Subir em ondas de 30–50 contas, cada onda com seus proxies e seu App Meta (BYOC, ~40–50 contas/app).
- Rampa de volume: contas novas começam com 2–4 posts/dia; 12/dia só em conta aquecida (as quedas de ontem foram volume + vídeo degradado).
- Pool de mídia grande (500+ vídeos) para diluir duplicação entre contas.
- Custos: Supabase egress ~1,3 TB/mês (Meta baixa cada vídeo do Storage) ≈ US$ 100–120/mês + Vercel Pro. O vídeo NUNCA passa pela Vercel no fluxo normal — só orquestração HTTP.

#### Lição
Segunda vez que o mesmo mecanismo (re-encode automático "anti-fingerprint") derruba as views da operação inteira (18/06 e 30/06→08/07). O trade-off qualidade × unicidade de arquivo tem vencedor claro na prática: qualidade. A defesa contra duplicação é pool grande + balanceamento de seleção, não degradação do arquivo.

---

### ✅ Sessão 2026-07-09 — Fix: "Link inválido" ao conectar contas via magic link (proxy bootstrap morto)

**Commits:** `37627c1`, `c9df072`

#### Problema
Todas as tentativas de conectar contas novas via magic link falhavam no último passo (após aceitar no Instagram) com a tela "Link inválido". Gerar link novo não resolvia.

#### Causa raiz (via logs Vercel)
1. O callback OAuth escolhia um **proxy bootstrap fixo** (`.limit(1)` — sempre a mesma primeira conta com proxy) para a troca de token. Quando esse proxy estava morto, `exchangeCode` estourava `fetch failed` — o callback era o único ponto do pipeline SEM fallback de proxy.
2. A página `/add/error` mostrava o título "Link inválido" para **qualquer** erro do fluxo, mascarando o problema real.
3. Proxies mortos identificados: `45.38.101.192:6125` e `85.198.47.73:6341` (100% de falha), `50.114.84.103:7342` (instável) — verificar com gbproxies; também afetam postagens das contas que os usam como dedicado.

#### Fixes
- **`callMetaWithFallback`** no callback: erro de rede (`fetch failed`/timeout) com proxy ativo → retry sem proxy (IP Vercel) + desativa o proxy para as chamadas seguintes do request. Aplicado em `exchangeCode`, `getLongLivedToken`, `getIGProfile`.
- **Proxy bootstrap sorteado**: busca todas as contas com proxy e `health_status != error` e sorteia uma aleatória — distribui o onboarding entre os IPs em vez de concentrar num só.
- **`/add/error` com título/mensagem por reason** (cancelled, state_mismatch, rate_limit, personal_account, server_error…) — "Link inválido" só para link realmente inválido.
- **Cookie magic link lido antes das checagens iniciais**: `cancelled`/`state_mismatch` redirecionavam o cliente (sem sessão) para a tela de login em vez de `/add/error`.

#### Lição (importante)
A troca de token OAuth é chamada servidor-a-servidor autenticada pelo **App Meta**, não pela conta — IP compartilhado nessa etapa é comportamento padrão de SaaS (Buffer, Hootsuite) e não é vetor de linkagem entre contas. O que a Meta associa à conta é o login/aceite no navegador do cliente (IP/device dele) e as chamadas de **postagem** — onde o isolamento por proxy dedicado permanece intacto e sem fallback. Toda página de erro genérica com título fixo atrasa diagnóstico: sempre propagar o motivo real.

---

### ✅ Sessão 2026-07-10 — Fix: conta caída não ficava vermelha no sync automático (checkpoint tratado como infra)

**Commits:** `baa9b3f`, `f0a7d81`

#### Problema
Conta que caía não ficava vermelha automaticamente — ficava só com o "sincronizado Xh atrás" congelado em relação às outras. Só virava vermelha ao atualizar manualmente.

#### Causa raiz (confirmada via failover_logs)
Conta em checkpoint retorna `code=190 — "You cannot access the app till you log in to www.instagram.com..."`. Em 2026-06-13 essa mensagem foi adicionada a `META_INFRA_MESSAGES` no cron `sync-accounts` e no `sync-all` — tratada como infra transitória: nunca marcava `health_status='error'` e nunca atualizava `profile_refreshed_at` (sync congelado, todo minuto, para sempre). A rota manual `/api/accounts/refresh` tem lista de infra menor (só decrypt/parse) — por isso o botão manual marcava vermelho na hora. Todas as marcações recentes no `failover_logs` eram `[refresh]` com essa mensagem.

#### Fixes
- **Checkpoint = queda real**: mensagens movidas para `CHECKPOINT_MESSAGES` + `isCheckpointError()` no cron `sync-accounts` e no `sync-all` — marca `health_status='error'` direto (sem tentar `refreshMetaToken`, que não resolve checkpoint) + grava motivo em `failover_logs`. Infra genuína (failed to decrypt etc.) continua transitória.
- **Cascade com denominador correto** (hardening, commit `baa9b3f`): a detecção de cascata media erros contra o lote stale do run — como contas mortas nunca avançam `profile_refreshed_at`, o lote degenerava para "só as mortas" e a cascata dispararia falso positivo todo run. Agora o denominador é o total de contas ativas (cron: count exact no banco; sync-all: todas as contas não-error do usuário).
- `process-loops`/`publish-pending` mantêm checkpoint como skip/retry transitório — a conta sai dos ciclos sozinha ao ser marcada pelo sync (≤5 min).

#### Lição
Listas de "erros transitórios" compartilhadas entre rotas divergiram silenciosamente (cron ignorava checkpoint, refresh manual não) — o mesmo erro tinha dois comportamentos dependendo de quem sincronizava. Classificação de erro da Meta deveria viver num módulo único importado por todas as rotas.

---

### ✅ Sessão 2026-07-17 — Refatoração definitiva do sync + Estoque de Proxies (consumo único)

**Commits:** `4e5e861`, `7b30f5a`, `1b0ff56`, `33e6a44`, `3253a7a`, `85fe50a`

#### 1. Arquitetura definitiva de sync (`1b0ff56`)
O sync misturava dois trabalhos: detectar conta caída (precisa ser rápido) e atualizar métricas de painel (muda devagar). Para ter o primeiro, pingava a Meta a cada 5 min — o padrão que derrubava contas novas por checkpoint. Separação:
- **Saúde = passiva pelo pipeline de postagem.** Novo `lib/account-health.ts`: `isAccountDeadError()` (padrões estritos de checkpoint/token morto; erros de infra excluídos) + `markDeadAccounts()` (cascata ≥4 contas E ≥60% do run = outage, ninguém marcado; senão `health_status='error'` + `failover_logs` com motivo real). Integrado em `process-loops`, `publish-pending` e `publish-scheduled` — conta caída fica vermelha no minuto em que a postagem falha, com zero chamada extra. Resolve também a lição da sessão 2026-07-10 (classificação de erro num módulo único).
- **Métricas = raras.** `sync-all`: STALE 5min→6h; sync silencioso = 1 GET (último post só no manual); contas <7 dias só sync manual. Stories: rota exclui contas sem proxy (furava a política sem-proxy-sem-sync via IP Vercel) e busca ao vivo só no botão manual.
- Ponto cego aceito: conta ociosa caída só é detectada no sync de 6h/manual.

#### 2. Estoque de Proxies com atribuição automática (`33e6a44` + `3253a7a` + `85fe50a`)
Tabela `proxy_pool` (AES-256-GCM + hash SHA-256 p/ dedup, RLS, migrations aplicadas via MCP). Callback OAuth atribui proxy livre a cada conta nova via claim atômico (`UPDATE ... WHERE assigned_account_id IS NULL` — sem corrida). **Política: 1 proxy = 1 conta, PARA SEMPRE** — conta excluída → trigger DELETA a entrada; proxy trocado/removido manualmente (PATCH/CSV) → entrada deletada; zero redistribuição. `parseProxyLine` aceita formatos de fornecedor (`ip:porta:user:senha` e variantes). UI na página Proxies: contadores Total/Livres/Em uso + "Atribuir às contas sem proxy". Confirmado funcionando pelo usuário.

#### 3. UX de Contas (`4e5e861`, `7b30f5a`)
- Botão "Ativar (N)" no modo seleção — ativa contas em massa (complementa "conta nova entra inativa").
- Sync manual individual em paralelo: trava global trocada por Set de IDs — várias contas sincronizam ao mesmo tempo, cada card com spinner próprio.

#### Fluxo de operação resultante
Colar proxies no estoque → magic link → conta conecta já com proxy e inativa → descansa dias em silêncio total → ativar em massa → volume baixo no início. Se cair, o pipeline marca vermelho sozinho.

---

### ✅ Sessão 2026-07-22 — Feat: campanhas do Postar sincronizadas com pasta de contas

#### Pedido do usuário
Conta nova movida para uma pasta (ex: LAURA LINS) que já tem campanha ativa na aba Postar não entrava sozinha na fila — só Automatizar e Loop (modo pasta) faziam isso, porque recalculam contas da pasta a cada ciclo do cron. Postar/Clonar criam um snapshot fixo de `account_ids` no momento da criação.

#### Implementação
- Nova tabela `distribute_campaigns` (migration aplicada via MCP Supabase): guarda a config completa da campanha (pasta(s) de conta vigiadas, pasta de mídia, video_count, posts_per_day, captions, auto_caption, stagger, burst_mode) usando o mesmo `id` = `campaign_id` de `scheduled_posts`.
- `POST /api/posts/distribute` aceita `sync_folder_ids` opcional — grava a config quando o usuário ativa o toggle.
- Novo cron `GET /api/cron/sync-distribute-accounts` (`*/5 * * * *`): para cada campanha sincronizada, detecta contas da pasta que ainda não têm nenhum post naquele `campaign_id` e as matricula com a mesma lógica de sorteio/anti-repetição (fisher-yates + menor uso por conta) e cadência da campanha original.
- Frontend (`/dashboard/postar`): toggle "Sincronizar com a pasta" aparece só quando a seleção cobre 100% de uma ou mais pastas inteiras (evita ambiguidade de seleção parcial). Badge "Sincronizada" no card da campanha (`GET /api/campaigns` expõe `is_synced`/`synced_folder_names`).
- Cancelar ou excluir a campanha (`DELETE /api/campaigns`) apaga a linha de `distribute_campaigns` — sincronização para junto, sem deixar config órfã reativando contas indevidamente.

#### Escopo
Só afeta campanhas criadas pelo Postar. Clonar Perfil continua snapshot fixo (não usa `video_id`, conteúdo vem do perfil raspado) — fora do escopo desta sessão.
