# Motor "browser" (Playwright) — plano das Fases 4 e 5

Estado em 2026-09-16: Fases 1–3 implementadas (Docker + Playwright, módulo de
sessão `python_server/browser_engine.py`, persistência
`python_server/session_store.py`, tabela `ig_browser_sessions`, endpoint
`POST /test-browser-login`). O motor instagrapi e o cron
`process-onboarding-jobs` não foram alterados.

Fatos medidos na implementação (não suposições):

- A tela `instagram.com/accounts/login/` hoje usa `input[name="email"]` e
  `input[name="pass"]` (não mais `username`/`password`).
- O login web é uma mutation GraphQL `caa_login_web` em `/api/graphql`. A
  resposta traz `ig_authenticated`, `two_factor_result`, `redirect_uri`,
  `recaptcha_needed`, `error_code/error_message` — o motor captura e usa isso.
- Senha errada: `ig_authenticated=false` + texto "As informações de login que
  você inseriu estão incorretas". Classificado em ~22s.
- Chromium no headless novo (`channel="chromium"`): `navigator.webdriver=false`,
  client hints sem "HeadlessChrome".

---

## Fase 4 — Worker de onboarding com o motor browser (paralelo)

### Seleção do motor
- Migration: `onboarding_jobs.engine text NOT NULL DEFAULT 'instagrapi'
  CHECK (engine IN ('instagrapi','browser'))`. Jobs existentes seguem no
  instagrapi sem nenhuma mudança.
- Cron atual `process-onboarding-jobs` ganha `.eq("engine","instagrapi")` no
  SELECT (única linha tocada).
- Cron novo `process-onboarding-browser-jobs` (`*/2`), mesmo esqueleto (claim
  atômico, auto-healing, `stage_status`, backoff), filtrando `engine='browser'`.
  O frontend não muda: mesmas colunas, mesmas etapas.
- Import CSV/manual ganha um seletor de motor (default instagrapi).

### Execução no python_server
- Endpoint único `POST /browser/onboarding/step` `{stage, username, password,
  proxy, totp_secret, user_id, photo_url, app_id}` → abre o contexto com a
  sessão salva (login só se expirou), executa a etapa, salva o storage_state,
  devolve `{status, stage_result, message, screenshot}`.
- Uma etapa por chamada, pausa de 30–90s entre etapas (igual hoje), job
  inteiro ≤ 10 min de navegador acumulado (contador em `stage_status`).

### Etapas via UI web
| Etapa | Estratégia |
|---|---|
| invite | `instagram.com/accounts/manage_access/` → aba "Convites de testador" → botão Aceitar do app (match por `app_id`/nome). Sem convite listado = `pending` (poll), não erro. |
| photo | `accounts/edit/` → "Alterar foto" → `page.set_input_files` no `input[type=file]` com a imagem baixada (mesma validação de 10 MB/JPEG do `onboarding.py`). |
| professional | `accounts/convert_to_professional_account/` → Criador → categoria padrão → concluir. |
| verify_professional | Ler `account_type` via `fetch('/api/v1/accounts/current_user/?edit=true')` dentro da página (reusa cookies, sem chamada externa). |
| magic_link | Mesmo contexto logado abre o link mágico e clica "Permitir" no OAuth — resolve a fase 2/3 que hoje só detecta. |

Os seletores de cada tela serão levantados com uma conta de teste antes de
codar (a tela de login já mostrou que os nomes antigos mudaram).

### Rotação (limite 6 tentativas)
- Contador `browser_attempts` no job (novo campo), separado de `retry_count`.
- `wrong_password` → erro permanente imediato (não consome tentativas).
- `checkpoint` → `needs_manual` com `checkpoint.type` + screenshot salvo em
  Storage `onboarding-evidence/{job}/{n}.jpg` (fora do `error_message`, que é
  texto).
- `ip_error` / `unknown_error` → descarta o contexto, pega proxy alternativa:
  entrada LIVRE do `proxy_pool` com claim atômico (`claimProxyForAccount`
  adaptado para job), tenta de novo. Se funcionar, essa proxy vira a fixa da
  conta (grava em `proxy_url_enc`); a anterior volta ao estoque.
- Sem proxy livre → espera 15 min (não conta tentativa).
- 6ª falha → `status='error'` com o resumo das 6 tentativas (exit IP, status,
  tempo) no `error_message`.

### Observabilidade
Cada tentativa grava em `stage_status[stage].attempts[]`:
`{n, exit_ip, status, elapsed_ms, message}` — visível no log expansível da
página `/dashboard/onboarding` sem mudar o componente (ele já mostra `reason`).

### Estimativa
| Item | Esforço |
|---|---|
| Migration + filtro no cron atual + cron novo | 0,5 dia |
| Endpoint de etapa + login/sessão reusados | 0,5 dia |
| invite (tela menos previsível) | 1 dia |
| photo + professional + verify | 1 dia |
| magic_link via navegador | 0,5 dia |
| Rotação de proxy + evidências no Storage | 0,5 dia |
| Teste com 3–5 contas reais + ajustes de seletor | 1 dia |
| **Total** | **~5 dias** |

---

## Fase 5 — Story com link + destaque (somente desenho)

Premissa: sessão salva em `ig_browser_sessions`; tudo roda no contexto já
logado, mesma proxy fixa.

### Postar story com link
1. **Viewport mobile.** O instagram.com só oferece criação de Story na
   experiência mobile web. Contexto com `is_mobile=True`, `has_touch=True`,
   viewport 390×844 e UA de Chrome Android coerente. Isso muda o fingerprint —
   por isso o fingerprint mobile também fica salvo na sessão (campo
   `fingerprint.mobile`) e é sempre o mesmo para a conta.
2. **Upload.** Abrir `instagram.com/`, tocar no "+" / "Story"; o site cria um
   `input[type=file]` (accept image/video). Usar `page.expect_file_chooser()` +
   `set_files` com a mídia baixada do Supabase. Validar antes: 9:16, ≤ 15s por
   segmento para vídeo; imagem JPEG.
3. **Link sticker.** Ícone de sticker → "Link" → preencher URL (a URL pública
   `/r/{slug}` do Links Gerenciáveis) + texto opcional → Concluir → arrastar o
   sticker para a posição (coordenadas fixas relativas ao canvas).
   **Risco principal:** a mobile web historicamente NÃO expõe o sticker de
   link (só o app). Primeira tarefa da fase é confirmar na UI atual; se não
   existir, a alternativa é emular o app via instagrapi
   (`photo_upload_to_story(links=[StoryLink])`) com a sessão web convertida,
   ou manter link só em conta com a opção disponível.
4. **Publicar.** "Seu story" / "Compartilhar" → aguardar a mutation de
   configure (resposta com `media.id`, capturada igual ao `caa_login_web`) →
   gravar `media_id` em `scheduled_posts`.

### Criar/gerenciar destaque
1. Abrir o próprio perfil → "Novo" (círculo +) → modal lista stories dos
   últimos dias → selecionar pelo `media_id`/miniatura mais recente → nome →
   capa → Concluir.
2. Adicionar a destaque existente: no story publicado, "Destacar" → escolher o
   destaque pelo nome.
3. Conferência: `fetch('/api/v1/highlights/{ig_user_id}/highlights_tray/')`
   dentro da página para confirmar que o `media_id` entrou.

### Estimativa (após confirmar a disponibilidade do link sticker)
Story sem link ~1,5 dia · link sticker +1 dia (ou pivot) · destaque ~1 dia ·
testes ~1 dia → **~4,5 dias**.
