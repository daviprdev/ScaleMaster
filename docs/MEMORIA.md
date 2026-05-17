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
- Tokens expiram em ~60 dias — refresh automático pendente para Fase 29
