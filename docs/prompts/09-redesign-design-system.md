# Prompt — implementação do redesign "Scale Master" (v2, aprovado)

> **Como usar (Bruce)**
> 1. Garanta que a pasta `docs/design/` exista no seu projeto. Ela está na branch `docs/redesign-design-system` — faça o merge do PR dessa branch na `main`, ou deixe o próprio agente criar a branch de trabalho a partir dela (o prompt já ensina).
> 2. Abra o Claude Code na pasta do projeto, num chat novo.
> 3. Copie e cole tudo a partir da linha **"## Prompt"** até o fim deste arquivo.
> 4. O trabalho é grande: o agente vai em fases, com commits pequenos, um PR em rascunho e o progresso anotado em `docs/design/progresso.md`. Se o chat ficar longo ou cair, abra outro e diga: **"Continue o redesign do Scale Master a partir de docs/design/progresso.md e docs/prompts/09-redesign-design-system.md."**
> 5. O agente **não** abre o painel logado (ele grava dados de produção ao abrir certas telas). A conferência visual das telas logadas é sua: a cada fase ele deixa no PR uma lista do que olhar. Ele também não faz deploy — quando você aprovar, faça o merge e o deploy normal da VPS (`CLAUDE.md`).
>
> Referências que acompanham este prompt: `docs/design/referencia/` (as 8 telas aprovadas, em HTML e PNG) e `docs/design/inventario.md` (tudo o que cada tela faz hoje).

---

## Prompt

Você está começando sem histórico. Todo o contexto está aqui e nos arquivos citados. Sua tarefa é **implementar de verdade, no código, o redesign completo da interface do Scale Master** — todas as telas — seguindo a amostra visual aprovada. Faça a implementação e os testes; não entregue só um plano.

### 1. Contexto

- Scale Master (antigo AutoScale): SaaS de gestão e publicação de conteúdo no Instagram pela API oficial da Meta.
- Stack: Next.js 15.5 (App Router), React 18, TypeScript, Tailwind 3.4, Supabase, lucide-react, framer-motion, recharts.
- Produção numa VPS própria (Docker Compose + Nginx); deploy manual a partir da `main`. Leia o `CLAUDE.md` do repositório antes de começar.
- Diretório local conhecido do Bruce: `C:\Users\davip\OneDrive\Documentos\ScaleMaster`.

### 2. Onde está a referência (leia antes de qualquer código)

1. **`docs/design/referencia/` — a verdade VISUAL.** Telas aprovadas: `landing`, `login`, `visao-geral`, `visao-geral-claro`, `contas`, `postar`, `inspiracoes`, `celular` — cada uma em `.html` (leia o código: medidas, espaçamentos, cores e hierarquia estão nos estilos inline) e `.png` (como deve ficar). `theme.css` tem as variáveis dos dois temas. Copie a linguagem visual com fidelidade: tamanhos de fonte, pesos, raios, bordas, paddings, gaps, ícones, estados.
2. **`docs/design/inventario.md` — a verdade FUNCIONAL.** Tudo o que cada tela mostra e faz hoje (ações, modais, campos, filtros, estados, mensagens, atualizações automáticas). Nada dele pode sumir.
3. **Precedência em caso de conflito:** (1) as decisões escritas na seção 11 deste prompt; (2) o inventário e o código, para conteúdo, ordem dos campos e comportamento; (3) a referência, para o visual. A amostra usa números e @contas de exemplo e simplifica algumas telas (ex.: uma coluna "Origem" ou uma barra de "tokens válidos" que a API não fornece; 4 métricas onde a tela real tem 5). **Mostre só dados que existem** e não "corrija" uma decisão da seção 11 para ficar igual ao PNG. Onde a referência não cobre uma tela, aplique os mesmos padrões.

Se `docs/design/` não existir na `main`, crie a branch de trabalho a partir da branch que a contém:

```bash
git fetch origin
git checkout -b redesign/design-system origin/docs/redesign-design-system
```

### 3. Regras invioláveis

- **Não altere lógica de negócio:** rotas de API, consultas ao Supabase, SQL/migrations, crons/timers, OAuth, webhooks, regras de fila, de mídia e de publicação ficam idênticas. Ao mover código de um arquivo para outro, mova-o **intacto** (inclusive refs de "execução única" e guardas de corrida, como `_autoRefreshDone`, `_autoSyncDone` e `_fetchIdRef` em Contas) e revise o diff.
- **Única exceção de backend:** o campo de leitura `views.daily` para o gráfico da Visão geral (seção 11.1). Aditivo, somente leitura, sem mudar campos existentes.
- **Não remova funcionalidade, campo, filtro nem mensagem** do inventário. As únicas remoções e mudanças de comportamento autorizadas estão na seção 12.
- **Não faça deploy** e não crie nem altere `.env*`, `docker-compose.yml`, `Dockerfile`, `nginx/`, `supabase/`, `python_server/` ou os scripts operacionais de `scripts/`. Em `scripts/test-*.mjs`, só o ajuste descrito na seção 4.3.
- **Não abra o painel autenticado contra o banco de produção** (seção 4.1).
- Trabalhe na branch `redesign/design-system`. Commits pequenos (um por componente ou tela). Abra um **PR em rascunho** no fim da Fase 0 e atualize-o a cada fase. Nunca faça push na `main`.
- Mantenha `docs/design/progresso.md` atualizado a cada commit (fase, tela, status, commit, pendências), para outro chat conseguir continuar.
- Não invente dados, métricas, depoimentos nem preços.

### 4. Segurança: produção e testes

#### 4.1 O banco é o de produção

O Supabase é um só, o de produção, e o `.env.local` do Bruce aponta para ele. Algumas telas **gravam dados só por serem abertas** — por exemplo, Contas renova tokens que vencem em até 14 dias (`POST /api/meta/refresh-token`) e sincroniza contas em lote (`POST /api/accounts/sync-all`), o que grava tokens e `health_status`. Por isso:

- **Não faça login nem abra `/dashboard/*` ou `/admin/*` no navegador**, nem com Playwright.
- Você pode rodar `npm run dev` **só se o `.env.local` já existir** (não crie nem edite) e abrir apenas as páginas públicas: `/` (landing), `/auth/login`, `/auth/register` e a página de QA da seção 9.
- A página de QA fica em `app/dev/design-system/page.tsx`: fora da área autenticada (o `middleware.ts` só protege `/dashboard`, `/admin` e `/api`), com `notFound()` quando `process.env.NODE_ENV === "production"`, sem nenhuma chamada ao Supabase e só com dados fictícios. Nela você monta os componentes e versões estáticas das telas (com dados de exemplo) para conferir o visual.
- Para capturas, use `npx playwright@1.47.2` sem adicioná-lo ao `package.json` (`npx playwright@1.47.2 install chromium` na primeira vez).
- A conferência das telas logadas é do Bruce: no fim de cada fase, escreva no PR uma lista "O que conferir", tela por tela, com o que mudou e o que testar.

#### 4.2 Linha de base dos testes

Antes de mudar qualquer coisa, rode e anote no `progresso.md` o resultado de cada parte do `npm test` separadamente: `npx vitest run` e cada `node scripts/test-*.mjs`. **Hoje o `npm test` já falha:** `scripts/test-reels-and-library.mjs` e `scripts/test-library-integrity.mjs` leem um `vercel.json` que não existe desde a migração para a VPS, e como o script encadeia com `&&`, os seguintes nem rodam. Não crie `vercel.json` para "consertar". A regra é: **nenhuma falha nova**. Rode as partes separadamente a cada fase e compare com a linha de base; registre as falhas antigas no PR.

#### 4.3 Testes que conferem o texto dos arquivos de tela

Alguns testes leem o código-fonte de arquivos de UI e procuram textos exatos. Ao redesenhar essas telas, **preserve esses textos nesses arquivos**. Se mover o trecho para outro arquivo, atualize no teste só o caminho ou a regex para o novo local, com a mesma intenção; nunca apague nem afrouxe uma asserção, e liste cada ajuste no PR.

| Teste | Arquivo | O que precisa continuar valendo |
|---|---|---|
| `test-reels-and-library.mjs` | `app/dashboard/postar/page.tsx`, `loop/page.tsx`, `clone/page.tsx` | contêm `ReelPlacementSelector` |
| | `components/dashboard/Sidebar.tsx`, `components/dashboard/Header.tsx`, `app/dashboard/page.tsx` | existem e não contêm `/dashboard/automatizar` (por isso a nova sidebar e a nova topbar ficam **nesses mesmos arquivos**) |
| | `app/dashboard/automatizar/page.tsx` | mantém `redirect("/dashboard/postar")` |
| `test-library-integrity.mjs` | `app/dashboard/library/page.tsx` | contém `Limpar Registros Quebrados`, `cujo arquivo já não existe no armazenamento`, `confirmCleanup`, `"Confirmar?"` (confirmação em 2 cliques) e `Todos os vídeos desta pasta serão apagados`; não contém `Limpar Órfãos` |
| `test-reel-captions.mjs` | `components/dashboard/CaptionModeSelector.tsx`, `components/library/VideoCard.tsx`, `components/inspirations/InspirationCard.tsx`, `components/library/PostModal.tsx` | continuam nesses caminhos, sem `dangerouslySetInnerHTML`; o CaptionModeSelector contém `{caption}` e `whitespace-pre-wrap`; o VideoCard contém `{video.caption}` |
| | `app/dashboard/postar/page.tsx` | sem o literal `2200` e sem `next[i] = val.slice` — importe os limites de `lib/reel-captions.ts` e nunca corte o texto |
| `test-clone.mjs` | `app/dashboard/clone/page.tsx` | contém `a.health_status !== "error" && a.is_active`, `PENDING_SEARCH_KEY` com `localStorage.setItem(PENDING_SEARCH_KEY`, `SEARCH_TIMEOUT_MS` e `originalCaption: r.originalCaption` |

Por causa disso, os seletores compartilhados (`CaptionModeSelector`, `ReelPlacementSelector`, `VideoProcessingSelector`), o `VideoCard`, o `InspirationCard` e o `PostModal` são **reestilizados no mesmo arquivo**, usando os componentes novos por dentro.

### 5. Direção visual

Direto, discreto, moderno. Tema principal escuro: fundo quase preto com um toque de navy. O azul da logo aparece só onde há ação; o prata da marca (`#BEB8BC`) assina o wordmark. Profundidade vem de um degrau de superfície + borda de 1px, não de sombra. Precisão no acabamento: grade de 4px, números em mono tabular, cantos de 8/12px, transições de 150ms.

**Proibido:** neon, glassmorphism/`backdrop-blur` em cards, fundos animados, partículas, texto em degradê, degradê em botão, borda colorida na lateral de card, emoji na UI, ícone dentro de quadrado colorido em card de métrica, peso de fonte acima de 600, cor escrita à mão fora dos tokens (exceções na seção 14).

**Único efeito permitido — "horizonte":** `radial-gradient(closest-side, var(--brand-blue), var(--brand-navy) 55%, transparent)`, num elemento absoluto de ~1100×680px centrado acima do topo, opacidade `var(--horizon-opacity)`. Só no hero e no CTA final da landing e nas telas de login, cadastro e pendente. Em nenhum outro lugar.

### 6. Tokens — `app/globals.css`

Substitua o `:root` atual por este bloco (o mesmo de `docs/design/referencia/theme.css`, sem as famílias de fonte, que vêm do `next/font`):

```css
:root,
[data-theme="dark"] {
  --bg: #05070c;
  --surface: #0a0e17;
  --surface-raised: #0f1521;
  --surface-hover: #151c2b;
  --line: #1b2333;
  --line-control: #56627d;
  --ink: #edf0f5;
  --ink-2: #a7b0c0;
  --ink-3: #7d879c;
  --brand-navy: #001244;
  --brand-blue: #00498d;
  --brand-silver: #beb8bc;
  --wordmark: #beb8bc;
  --primary: #1b64b5;
  --primary-hover: #2a72c4;
  --on-primary: #ffffff;
  --accent: #7fb2e8;
  --focus: #7fb2e8;
  --success: #4cc79a;
  --success-soft: rgba(76, 199, 154, 0.12);
  --warning: #e6b450;
  --warning-soft: rgba(230, 180, 80, 0.12);
  --danger: #f07178;
  --danger-soft: rgba(240, 113, 120, 0.12);
  --info-soft: rgba(127, 178, 232, 0.12);
  --overlay: rgba(2, 4, 8, 0.72);
  --chart-fill: rgba(127, 178, 232, 0.10);
  --shadow-pop: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04);
  --shadow-frame: 0 40px 120px rgba(0, 18, 68, 0.55);
  --horizon-opacity: 0.55;
  color-scheme: dark;
}

[data-theme="light"] {
  --bg: #f5f6f8;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --surface-hover: #eef1f5;
  --line: #e3e7ed;
  --line-control: #7f889c;
  --ink: #0a1220;
  --ink-2: #475166;
  --ink-3: #5f6b80;
  --wordmark: #0a1220;
  --primary: #00498d;
  --primary-hover: #003b73;
  --on-primary: #ffffff;
  --accent: #00498d;
  --focus: #1b64b5;
  --success: #12704c;
  --success-soft: rgba(18, 112, 76, 0.08);
  --warning: #8a5a00;
  --warning-soft: rgba(138, 90, 0, 0.08);
  --danger: #b42332;
  --danger-soft: rgba(180, 35, 50, 0.08);
  --info-soft: rgba(0, 73, 141, 0.08);
  --overlay: rgba(10, 18, 32, 0.40);
  --chart-fill: rgba(0, 73, 141, 0.08);
  --shadow-pop: 0 16px 40px rgba(10, 18, 32, 0.12), 0 0 0 1px rgba(10, 18, 32, 0.04);
  --shadow-frame: 0 40px 120px rgba(0, 73, 141, 0.16);
  --horizon-opacity: 0.14;
  color-scheme: light;
}

:root {
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 999px;
  --sidebar-width: 240px;
  --sidebar-collapsed: 64px;
  --topbar-height: 56px;
  --content-max: 1200px;
  --landing-max: 1120px;
}
```

**Aliases temporários (só até a Fase 6).** As telas não migradas usam variáveis antigas — `--background`, `--surface-elevated`, `--border`, `--border-hover`, `--text-primary`, `--text-secondary`, `--text-muted`, `--primary-hover`, `--focus`, `--brand-gradient` — e há 158 usos de `var(--matrix)` e `var(--electric)` em 14 arquivos, que hoje nem existem. Declare, num bloco marcado `/* legado — remover na Fase 6 */`: `--background: var(--bg)`, `--surface-elevated: var(--surface-raised)`, `--border: var(--line)`, `--border-hover: var(--line-control)`, `--text-primary: var(--ink)`, `--text-secondary: var(--ink-2)`, `--text-muted: var(--ink-3)`, `--matrix: var(--primary)`, `--electric: var(--accent)` e `--brand-gradient: var(--primary)`. Na Fase 6 elas saem, e o grep da seção 14 tem de voltar vazio.

**Regras de uso**
- Página em `bg`; cards, sidebar e tabelas em `surface`; menus, modais e o card de resumo em `surface-raised`; hover e item ativo em `surface-hover`.
- Texto: `ink` (títulos, valores, corpo), `ink-2` (descrições, rótulos), `ink-3` (timestamps, hints, placeholders, eyebrows). Todos passam 4.5:1 nos dois temas.
- `primary` é o único preenchimento colorido: botão principal, switch ligado, barra de progresso, série principal de gráfico. Texto sobre ele em `on-primary`.
- `accent`: links, ícone do item ativo da sidebar, linha de gráfico, palavra em serifa da landing, seleção (borda do radio card escolhido).
- `line` para cards e divisores; `line-control` para bordas de input, select, checkbox e botão secondary.
- Status: `success` / `warning` / `danger` sempre com texto ou ícone junto; fundo de badge e banner com o `*-soft` correspondente; informação neutra = `accent` + `info-soft`.
- Foco: `outline: 2px solid var(--focus); outline-offset: 2px` em todo elemento interativo.
- Wordmark "Scale Master": Geist 600, `color: var(--wordmark)` (prata no escuro, `ink` no claro).

**Tema em `app/layout.tsx`**
- `<html lang="pt-BR" data-theme="dark" suppressHydrationWarning>`. Remova o `className="dark"`, o `style={{ background: "#000000" }}`, o `text-white` e o `style` do `<body>` e a `<div style={{ position: "relative", zIndex: 1 }}>` que envolvia o fundo animado.
- Um script inline no `<head>` aplica o tema salvo antes da hidratação (sem piscar). Preferência em `localStorage` (`sm-theme` = `dark` | `light` | `system`).
- `viewport.themeColor`: `#05070c`.
- **O controle de tema só aparece para o usuário na Fase 6**, quando nenhuma tela antiga sobrar (antes disso, telas não migradas ficariam com texto branco sobre branco). Até lá, o tema claro só é usado na página de QA.

### 7. Tailwind — `tailwind.config.ts`

**Fases 0 a 5 — aditivo.** Para não quebrar as telas ainda não migradas (o Tailwind ignora em silêncio classes que deixam de existir, e há mais de mil usos da paleta padrão em 37 arquivos), **não apague nada ainda**. Em `theme.extend`:

```ts
colors: {
  // tokens novos
  bg: "var(--bg)",
  surface: { DEFAULT: "var(--surface)", raised: "var(--surface-raised)", hover: "var(--surface-hover)" },
  line: { DEFAULT: "var(--line)", control: "var(--line-control)" },
  ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)" },
  primary: { DEFAULT: "var(--primary)", hover: "var(--primary-hover)", fg: "var(--on-primary)" },
  accent: "var(--accent)",
  focus: "var(--focus)",
  wordmark: "var(--wordmark)",
  success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
  warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
  danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
  info: { soft: "var(--info-soft)" },
  overlay: "var(--overlay)",
  // brand: some as chaves novas navy/blue/silver às legadas existentes (purple, cyan…) até a Fase 6
},
boxShadow: { pop: "var(--shadow-pop)", frame: "var(--shadow-frame)" },
fontFamily: {
  sans: ["var(--font-sans)", "system-ui", "sans-serif"],
  mono: ["var(--font-mono)", "ui-monospace", "monospace"],
  serif: ["var(--font-serif)", "Georgia", "serif"],
  display: ["var(--font-sans)", "system-ui", "sans-serif"], // legado: era Space Grotesk
},
fontSize: {
  "display-xl": ["clamp(40px, 4.6vw, 60px)", { lineHeight: "1.04", letterSpacing: "-0.035em", fontWeight: "600" }],
  display: ["40px", { lineHeight: "44px", letterSpacing: "-0.03em", fontWeight: "600" }],
  "auth-title": ["28px", { lineHeight: "34px", letterSpacing: "-0.03em", fontWeight: "600" }],
  "body-lg": ["17px", { lineHeight: "28px" }],
  title: ["22px", { lineHeight: "28px", letterSpacing: "-0.02em", fontWeight: "600" }],
  heading: ["15px", { lineHeight: "22px", letterSpacing: "-0.01em", fontWeight: "600" }],
  body: ["14px", { lineHeight: "22px" }],
  label: ["13px", { lineHeight: "18px", fontWeight: "500" }],
  caption: ["12px", { lineHeight: "16px" }],
  eyebrow: ["11px", { lineHeight: "16px", letterSpacing: "0.12em", fontWeight: "500" }],
  metric: ["28px", { lineHeight: "32px", letterSpacing: "-0.02em", fontWeight: "500" }],
},
```

**Raios:** não mexa em `borderRadius`. Use as classes padrão que já batem com os tokens: `rounded-md` = 6px (radius-sm), `rounded-lg` = 8px (radius-md, controles), `rounded-xl` = 12px (radius-lg, cards e modais), `rounded-2xl` = 16px (radius-xl), `rounded-full`.

**Opacidade:** como os tokens são `var(--x)` com hex, modificadores como `bg-primary/80` ou `border-accent/40` **não funcionam** no Tailwind 3. Não os use em tokens: use os tokens prontos (`*-soft`, `overlay`) ou `bg-[color-mix(in_srgb,var(--bg)_80%,transparent)]` quando for indispensável.

**Fase 6 — estrito.** Depois que nenhuma tela antiga sobrar: mova as cores para `theme.colors` (substituindo a paleta padrão) só com os tokens + `transparent`, `current`, `white` e `black`; remova `backgroundImage`, `animation`, `keyframes`, `backdropBlur`, o `display` legado e as chaves legadas de `brand` (`matrix`, `electric`, `obsidian`, `purple`, `cyan`…). Antes, o grep da seção 14 tem de estar limpo.

### 8. Tipografia e acabamento

Em `app/layout.tsx`, troque Inter / Space Grotesk / JetBrains Mono por `next/font/google` (o build atual já baixa fontes do Google): `Geist` (`variable: "--font-sans"`, pesos 400/500/600), `Geist_Mono` (`--font-mono`, 400/500) e `Instrument_Serif` (`--font-serif`, `style: "italic"`, peso 400).

| Estilo (classe) | Uso |
|---|---|
| `text-display-xl` | H1 da landing |
| `text-display` | H2 da landing |
| `text-auth-title` | título das telas de autenticação |
| `font-serif italic` | **uma** palavra de ênfase num título da landing, 1.1em, cor `accent` |
| `text-body-lg` | subtítulo e texto da landing, `ink-2` |
| `text-title` | título da página do app (um por tela) |
| `text-heading` | título de card ou seção |
| `text-body` | texto padrão do app |
| `text-label` | rótulos, botões, itens de menu |
| `text-caption` | metadados e hints, `ink-3` |
| `text-eyebrow font-mono uppercase` | grupo da sidebar, cabeçalho de tabela, eyebrow da página, `ink-3` |
| `text-metric font-mono tabular-nums` | valor de métrica |

- Todo número que muda usa `tabular-nums`. Números e moeda em pt-BR: `toLocaleString("pt-BR")`, `R$ 1.240,00`, `12,4%`; números compactos com `Intl.NumberFormat("pt-BR", { notation: "compact" })` ("1,2 mi", "860 mil").
- Grade de 4px. Padding de card 20px; gap entre cards 16px; cabeçalho da página → conteúdo 24px; conteúdo com padding 28px 32px (16px no celular); seções da landing 96px (64px no celular).
- Sombra só no que flutua (`shadow-pop`: menus, modais, toasts, ⌘K, barra de seleção). Cards sem sombra.
- Transições de 150ms `ease` em cor e borda; modais e menus com 200ms de fade + 4px. Nada em loop além de spinners. Respeite `prefers-reduced-motion`. framer-motion só em Dialog, Sheet e Toast; remova do resto.
- Ícones: lucide-react com `strokeWidth={1.75}`; 16px em botões e tabelas, 17px na sidebar, 20px em estados vazios; cor por `currentColor`.

### 9. Componentes — `components/ui/`

Um arquivo por componente, `forwardRef` onde fizer sentido, `cn()` de `lib/utils`, variantes por props (sem biblioteca nova de UI). Copie o visual da referência.

- **Button** — `variant`: primary | secondary | ghost | danger (contorno `line-control`, texto `danger`, hover `danger-soft`); `size`: sm (32px) | md (36px) | lg (44px); `icon`, `iconRight`, `loading` (spinner + `disabled` + `aria-busy`), `asChild` para `<Link>`. Um `primary` por área visível.
- **IconButton** — só ícone, 32/36px, `aria-label` obrigatório, tooltip.
- **Badge** — `tone`: neutral | info | success | warning | danger; `dot`. Pílula de 22px.
- **Input, Textarea, Select, Combobox, Checkbox, Switch, Slider** — `label`, `hint`, `error` ligados por `aria-describedby`; borda `line-control`; altura 36px (44px no celular). Contadores de legenda (`n/limite`, amarelo acima de 90%, vermelho acima do limite) recebem o limite por prop, importado de `lib/reel-captions.ts`.
- **Segmented** — 2 a 6 opções exclusivas.
- **RadioCard / RadioCardGroup** — o card de opção da referência Postar: círculo de seleção, título, descrição, selo opcional ("Recomendado"); escolhido = borda `accent` + fundo `info-soft`.
- **ChipToggle** — chip selecionável com check (pastas, contas, filtros).
- **Tabs** — sublinhado de 2px em `accent` na aba ativa; contador mono opcional.
- **Card** — `title`, `description`, `actions`, `flush` (corpo sem padding, para tabelas). Não aninhe cards.
- **StepCard** — card de seção numerada ("01 Contas"), número em mono `accent`.
- **StatTile** — `label`, `value` (já formatado), `delta` com sinal (define a seta) e `tone` positive | negative | neutral (define a cor) — use só onde o dado de variação já existe —, `hint`, `icon`, `spark` (número[] → polyline 96×28 em `accent`), `children` para uma linha extra.
- **DataTable** — `columns` (`key`, `label`, `align`, `numeric`, `render`, `hideBelow`: "sm" | "md" | "lg" | "xl"), `rows`, `empty`, `loading` (skeleton de 5 linhas), seleção opcional. Cabeçalho em eyebrow, números mono à direita. Abaixo de 640px cada linha vira um bloco empilhado.
- **EmptyState** — ícone em quadrado de 40px `surface-hover`, título, descrição, uma ação; borda tracejada `line`.
- **PageHeader** — `eyebrow`, `title`, `description`, `actions` (até 2 botões + IconButtons).
- **Banner** — `tone` + ícone + texto + ação + fechar opcional.
- **Dialog** (com **ConfirmDialog** para ações destrutivas: título, consequência, botão `danger`), **Sheet** (gaveta lateral), **DropdownMenu**, **Popover**, **Tooltip**, **Toast** (canto inferior direito), **Skeleton**, **Kbd**, **Avatar** (foto ou iniciais), **ProgressBar** (inclusive segmentada sucesso/erro), **Dropzone**, **SelectionBar** (barra flutuante "N selecionados" + ações).
- **Gráficos:** wrapper de recharts com o estilo da referência — linha `accent` 1.75px, área `chart-fill`, grade `line`, eixos mono 11px `ink-3`, sem legenda quando há uma série, tooltip `surface-raised` + `shadow-pop`.

A página de QA `app/dev/design-system/page.tsx` (seção 4.1) mostra todos os componentes em todos os estados, nos dois temas, e as versões estáticas das telas com dados de exemplo.

### 10. Casca do app

- `components/shell/AppShell.tsx` substitui `DashboardShell`: sidebar (`--sidebar-width`, recolhe para `--sidebar-collapsed`, estado salvo em `localStorage`) + coluna com topbar (`--topbar-height`) + `<main>` com conteúdo até `--content-max`, padding 28px 32px. Layout da referência `visao-geral`.
- **Sidebar** — reescrita **em `components/dashboard/Sidebar.tsx`** (o teste lê esse caminho). `surface`, borda direita `line`; logo `public/brand/scale-master-logo.jpg` 26px com raio 7px + wordmark; grupos com rótulo eyebrow; itens de 34px, ícone 17px; ativo = `surface-hover` + ícone `accent` + traço de 2px à esquerda. Sem contadores (exigiriam consultas novas). Rodapé: avatar + nome + "Configurações e conta", que abre o menu do usuário. Navegação exata:
  - **Início:** Visão geral `/dashboard`
  - **Contas:** Contas `/dashboard/accounts` · Contas leitoras `/dashboard/contas-leitoras` · Proxies `/dashboard/proxy-test` · Failover `/dashboard/failover`
  - **Publicar:** Postar `/dashboard/postar` · Loop `/dashboard/loop` · Stories `/dashboard/stories` · Fila `/dashboard/queue` · Publicados `/dashboard/publicados`
  - **Conteúdo:** Inspirações `/dashboard/inspirations` · Clonar `/dashboard/clone` · Biblioteca `/dashboard/library`
  - **Dados:** Monitor `/dashboard/monitor` · Analytics `/dashboard/analytics`
  - **Menu do usuário:** nome + e-mail, Configurações `/dashboard/settings`, Meu App `/dashboard/apps`, Painel Admin `/admin` (só admin), Sair. Esc e clique fora fecham.
- **Topbar** — reescrita **em `components/dashboard/Header.tsx`**. Breadcrumb "Grupo / Página" gerado da mesma config da navegação (substitui o mapa de títulos, que hoje deixa várias rotas como "Dashboard"); campo de 320px "Buscar telas e ações…" com `Kbd` ⌘K (Ctrl K fora do Mac), que abre a CommandPalette; sino com Popover que lista os mesmos alertas dos banners (cascata, contas com erro, anúncio) e ponto `accent` só quando há alerta. Sem logo repetida e sem o botão "Nova postagem".
- **CommandPalette** (⌘K / Ctrl K): todas as telas acima + ações que **só navegam** — "Nova distribuição" → `/dashboard/postar`, "Novo loop" → `/dashboard/loop?acao=novo`, "Conectar conta" → `/dashboard/accounts?acao=conectar`, "Nova pasta na biblioteca" → `/dashboard/library?acao=nova-pasta`, "Configurações". As páginas abrem o modal correspondente ao ler `?acao=` (só UI). Filtro por texto, setas, Enter abre, Esc fecha. `surface-raised` + `shadow-pop`, 560px.
- **Celular (<1024px):** sidebar vira `Sheet` sobre `overlay`; topbar com botão de menu, logo, wordmark e sino (referência `celular`); respeite `pt-safe`/`pb-safe` (PWA). Em telas com uma ação principal, ela vai para uma barra fixa no rodapé.
- **Banners** de `app/dashboard/layout.tsx` (impersonação, anúncio, cascata, saúde das contas) passam a usar `Banner`, empilhados entre a topbar e o conteúdo, com os mesmos textos, links e regras de dispensa do inventário (§0). A busca desses dados no layout não muda.
- **Carregamento entre rotas** (`app/dashboard/loading.tsx`): skeleton do cabeçalho + cards no lugar do spinner central.
- **Remover:** `BackgroundContext`, `BackgroundController`, `BeamsBackground`, `ParticlesBackground`, `TopographyBackground`, `WireframeTerrain`, `components/dashboard/ParticleBackground.tsx` e o `BrandLogo` com `gradient-text` (crie `components/shell/Logo.tsx`).
- **Admin** (`app/admin/*`): mesma `AppShell` com navegação própria — Visão geral, Usuários, Contas conectadas, Notificações, Logs, Suporte, "Voltar ao painel" —, item ativo destacado, versão celular e `Badge` "Modo admin" (`warning`) na topbar.

### 11. Tela a tela

Para cada tela: (a) leia a seção do inventário; (b) reestilize com os componentes novos, tela por tela, preservando a lógica; (c) quebrar o `page.tsx` em `_components/` e `_hooks/` é **opcional** — faça só quando ajudar, de forma mecânica, revisando o diff, e respeitando a tabela da seção 4.3; (d) troque toda cor fixa, `rgba()`, `text-white/…`, `bg-black/…` e `style` de cor por tokens; (e) marque, no `progresso.md`, cada item do inventário como presente.

#### 11.1 Visão geral — referência `visao-geral.png` (+ `visao-geral-claro.png`)

- **PageHeader:** eyebrow "Início", título "Visão geral", descrição "Bem-vindo, {nome} · {terça, 13 de outubro}" (a saudação atual; sem nome, só a data). Ações: IconButton "Atualizar" (gira enquanto atualiza; mantém a atualização silenciosa a cada 60 s) e Button primary "Postar" → `/dashboard/postar`.
- **Linha de StatTiles** (`repeat(auto-fit, minmax(200px, 1fr))`):
  1. "Vendas hoje" — R$; hint "ontem R$ X"; linha extra "Este mês R$ X · anterior R$ Y". **Sem delta** (não existe essa métrica hoje).
  2. "Visualizações hoje" — compacto; hint "Total: X" (ou a mensagem de "Meta ainda não liberou o dia" quando `today_has_data` for falso); `spark` com os dias disponíveis de `views.daily` (sem o de hoje quando for `null`).
  3. "Vídeos publicados" — **valor principal = total** (`videos_published.total`, como hoje); hint "hoje N · ontem N".
  4. "Contas ativas hoje" — hint "N conectadas".
  5. "Posts na fila" — hint "aguardando publicação".
- **Linha 2** (flex-wrap, 2:1):
  - Card **"Views das contas"** ("Contas ativas e conectadas"): `Segmented` em `actions` com "Hoje / Ontem / 7 dias / 30 dias / Este mês" (mesma regra de abrir em "Ontem" quando a Meta ainda não liberou o dia); número grande do período em `text-metric`; abaixo, o texto do período ("Dia atual — zera às 21h (Brasília)" etc.), "Mês anterior: N" em "Este mês" e a mensagem de "Hoje" sem dados. Embaixo, o **gráfico de área de 14 dias**, alimentado por `views.daily`; o ponto de hoje fica tracejado (parcial) e some quando for `null`. Rótulos de data formatados com `timeZone: "UTC"` (os dias da tabela são dias UTC).
  - Card **"Saúde das contas"**: dois blocos separados por `line` — "Contas caídas" (destaque = com erro agora; depois Hoje / Ontem / 7 dias) e "Contas adicionadas" (destaque = novas em 7 dias; depois Hoje / Ontem / 7 dias) — e os links "Ver contas" e "Failover".
- **Linha 3** (flex-wrap, 3:2):
  - Card **"Próximas postagens"**: `Badge` "N na fila"; Button `danger` sm "Limpar fila", **só quando há itens** → `ConfirmDialog` ("Limpar toda a fila pendente?" + "Remove os posts agendados e os containers pendentes de todas as suas contas. Posts já publicados não são afetados.") → mesma chamada de hoje. Lista dos 4 próximos: Conta · Quando ("Hoje às 14:30", "Amanhã às…", "dd/mm às…").
  - Card **"Atividade recente"**: os 5 itens com ícone de sucesso/erro e tempo relativo; ação "Ver monitor" → `/dashboard/monitor` (no lugar do "Ver tudo" sem ação).
- **"Ações rápidas":** os 3 atalhos atuais (Postar — "Distribuição de conteúdo", Loop — "Ciclo contínuo", Stories — "Postar e importar") numa faixa de 3 cards compactos no fim da página.
- **Backend (única exceção) — `views.daily`.** Em `app/api/dashboard/stats/route.ts`, acrescente ao objeto `views` o campo `daily: { day: string; views: number | null }[]`, com 14 posições (de 13 dias atrás até hoje, em dias UTC). Ele precisa usar **o mesmo critério do resumo atual**: a versão vigente de `get_account_views_summary` está em `supabase/account_views_periods.sql` e é **global** — soma as views de todas as contas com `is_active` e `health_status <> 'error'`, ignorando o `p_user_id` (as vendas também são globais). Use o client `admin` que a rota já tem e pagine, porque o PostgREST devolve no máximo 1000 linhas:

  ```ts
  const daily = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("account_views_daily")
      .select("day, views, instagram_accounts!inner(is_active, health_status)")
      .gte("day", startDay) // "YYYY-MM-DD" de 13 dias atrás, em UTC
      .eq("instagram_accounts.is_active", true)
      .neq("instagram_accounts.health_status", "error")
      .order("day", { ascending: true })
      .range(from, from + 999);
    if (error) { console.error("[dashboard/stats] views.daily falhou:", error.message); break; }
    for (const r of data ?? []) daily.set(r.day, (daily.get(r.day) ?? 0) + Number(r.views ?? 0));
    if (!data || data.length < 1000) break;
  }
  // monte as 14 posições: dia sem linha = 0; o dia de hoje = null quando today_has_data for falso
  ```

  Não mexa nos campos existentes. Se a consulta falhar ou ficar inviável, devolva `daily: []` e mostre o card sem o gráfico. Registre no PR que as views e as vendas da Visão geral são somas globais (comportamento herdado, não deste trabalho).

#### 11.2 Contas — referência `contas.png`

- **PageHeader:** eyebrow "Contas", título "Contas", descrição "N conectadas · M ativas" (+ " · K precisam de atenção", contando no cliente as caídas e os tokens que vencem em até 7 dias). Ações: secondary "Sincronizar todas" (com o contador "x/N" enquanto roda) e primary "Conectar conta".
- **Banners:** a notificação da página vira `Banner` (success/danger, fecha no X, aceita várias linhas). Com tokens vencendo em até 7 dias: `Banner` warning "N contas com token expirando em até 7 dias. Renove para não interromper as publicações." com a ação "Revisar tokens", que aplica o filtro "Com problema".
- **Visões e pastas.** Painel "Pastas" à esquerda (~210px a partir de 1280px; abaixo disso, um `Select` acima da barra): "Todas as contas" (nova visão, filtro só no cliente, e passa a ser a padrão), "Sem pasta" e uma linha por pasta com contador; "+" para nova pasta; "⋯" por pasta com "Renomear" e "Excluir" (`ConfirmDialog` com o texto atual: as contas da pasta são excluídas). Mantenha a reordenação das pastas por arrastar (ordem salva no navegador, como hoje).
- **Barra da lista:** busca "Buscar por @usuário" (filtro no cliente); `Segmented` "Todas / Ativas / Com problema" (filtro no cliente); `Select` de ordenação "Mais recentes" (padrão atual) / "Mais seguidores" / "Menos seguidores" / "Story expirando"; ghost "Proxies em massa" e ghost "Verificar perfis".
- **Tabela** (`DataTable` em `Card flush`) com checkbox de seleção (substitui o "modo seleção"; o do cabeçalho seleciona as linhas visíveis):
  - **Conta** (sempre): avatar (cinza + selo de desconectada quando caída), "@usuario", `Badge` neutral "Meta" nas contas Meta e uma linha `caption` com "App {nome} · sync há X · {idade} no SaaS"; etiquetas como chips pequenos logo abaixo, com "+ etiqueta" (formulário inline atual: até 32 caracteres, as 8 cores, Enter/Esc).
  - **Status** (sempre), um único `Badge` por precedência: caída ("Desconectada" ou "Bloqueada pela Meta", danger, sem piscar) > "Inativa" (neutral) > "Token expirado" (danger) > "Token expira em Nd" (só até 15 dias: danger até 7, warning de 8 a 15 — o comportamento atual) > "Ativa" (success). Contas caídas mostram também o motivo atual ("Token inválido — sessão encerrada" / "Conta bloqueada pela Meta") e o botão "Reconectar".
  - **Seguidores** (mono, sempre) · **Pasta** (some abaixo de 1280px) · **Proxy** ("Dedicado" / "Sem proxy" em `warning`; some abaixo de 1280px) · **Último post** (some abaixo de 1440px) · **Posts** (mono; some abaixo de 1440px) · **Stories** (contas Meta: "N ativos · exp. Xh", "expirando", "0 stories ativos", "desatualizados · sincronize"; some abaixo de 1440px). O que some vai para a linha `caption` da conta.
  - **"⋯"** com os **8 itens atuais** (7 sem Meta), na mesma ordem: Sincronizar · Editar perfil manual · Desativar/Ativar conta · Renovar token (só Meta) · Mover para pasta… · Configurar/Editar proxy · Excluir vídeos pendentes · Remover conta (esta passa a abrir `ConfirmDialog`).
- **Seleção segura:** limpe a seleção sempre que mudar a pasta, a visão, o filtro, a busca, a ordenação ou a página. O `ConfirmDialog` de exclusão em massa lista as @contas (até 10 + "e mais N").
- **SelectionBar** (com 1 ou mais selecionadas): "N selecionadas" + "Sincronizar (N)", "Ativar (N)", "Mover para pasta (N)", "Excluir (N)" (`ConfirmDialog`) e "Limpar seleção".
- **Celular:** cada conta vira um card empilhado com avatar, @, status, 3 métricas, etiquetas, "Reconectar" quando caída e "⋯".
- Sem paginação até 50 contas na visão; acima disso, paginação no cliente de 25 por página.
- Todos os modais do inventário (§2) viram `Dialog`, com os mesmos campos, textos, validações e resultados: Conectar conta, Nova pasta, Renomear pasta, Excluir pasta, Excluir vídeos pendentes, Mover para pasta (individual e em massa), Proxy dedicado, Importar proxies em massa, Verificador de perfis, Editar perfil.
- Preserve os automáticos (sincronização silenciosa ao abrir, renovação de tokens, recarga a cada 60 s) e as mensagens de retorno do OAuth. Trate `?acao=conectar` (abre "Conectar conta").
- **As 8 cores das etiquetas são dados** (gravadas em `instagram_accounts.labels`): mantenha os valores exatos de `LABEL_COLORS`.

#### 11.3 Postar — referência `postar.png`

- **PageHeader:** eyebrow "Publicar", título "Postar", descrição "Distribua os vídeos de uma pasta entre várias contas, com ordem aleatória única por conta."
- **Tabs:** "Nova distribuição" · "Campanhas ativas {N}" · "Em massa" · "Agendados".
  - "Em massa" é o conteúdo atual de `/dashboard/posts` e "Agendados" o de `/dashboard/schedule` (mesmas chamadas). As rotas antigas redirecionam para `/dashboard/postar?tab=massa` e `?tab=agendados`. O "Novo agendamento" de Agendados troca para "Em massa"; o "Ver Agendamentos" do sucesso de Em massa troca para "Agendados".
  - **Em massa** com o visual novo: StepCards 01 Vídeos (grade 9:16 selecionável, com duração, @dono e check), 02 Contas (`ChipToggle` com avatar e seguidores), 03 Variações de legenda (Textareas com contador, "Adicionar variação", máximo 10), 04 Lote (início, vídeos por lote, intervalo e a prévia) e a barra fixa no rodapé com o resumo e o primary "Agendar N posts".
  - **Agendados:** `Tabs` de status com contagem (Todos, Pendentes, Publicando, Publicados, Com falha, Cancelados — os zerados escondidos) e lista em `DataTable` (conta, legenda, `Badge` de status, horário, "em X"/"vencido", media_id, erro) com as ações atuais por linha (Cancelar, Reagendar, Remover — Remover com `ConfirmDialog`).
- **Nova distribuição** — duas colunas (form `flex: 999 1 560px`; lateral `flex: 1 1 320px`, fixa ao rolar no desktop). Seções em `StepCard`, **na ordem real**:
  - **01 Contas** — atalhos "Todas" · "Nenhuma" · "Novas (N)"; acordeão por pasta com `ChipToggle` de contas (borda `danger` + ponto nas contas sem campanha rodando); contador; `Switch` "Sincronizar com a pasta" e suas regras.
  - **02 Pasta de mídia** — `Select` de pasta ("{nome} · N vídeos") e "Quantos vídeos postar" em `Segmented` 10 / 20 / 50 / Todos, com a dica de uso.
  - **03 Cadência** — `Switch` "Modo Ciclo". Ligado: "Quantos vídeos por conta" (1 / 3 / 5 / 10 / 20 / Outro) e "Ordem de distribuição" em `RadioCard`. Desligado: "Posts por dia por conta" em grade de chips (1, 2, 3, 4, 6, 8, 12, 24, 36, 48, 72), cada um com o intervalo resultante embaixo, e "Data e hora do primeiro post". Sempre: `Slider` "Intervalo entre contas" e a frase-resumo.
  - **04 Legenda** — o `CaptionModeSelector` reestilizado (RadioCards Original / Personalizada / Sem legenda, ajustes de hashtags e menções no Original); em Personalizada, `Switch` "Legendas automáticas" com o exemplo, ou o editor de legendas com contadores, "Salvar esta legenda", "Adicionar legenda" e "Usar salva" (Popover "Biblioteca de legendas"; excluir legenda salva com `ConfirmDialog`).
  - **05 Vídeo** — `ReelPlacementSelector` e `VideoProcessingSelector` reestilizados, lado a lado, com selo "Recomendado".
- **Lateral:** card "Resumo" (`surface-raised`) com todos os campos atuais (vídeos/conta, contas, total de posts, duração, posts/dia, legendas, início, fim estimado, horários da conta 1) e o botão principal "Criar distribuição" ("Postar tudo agora" no Modo Ciclo, com "(N posts · N contas)"); os erros de validação aparecem logo acima dele. Abaixo, o card "Como funciona". No celular, o botão vai para a barra fixa do rodapé.
- **Campanhas ativas:** um card por campanha com tudo do inventário (§7): `Badge` de status, `ProgressBar`, Fila/Falhas/Cancelados, "Engagement por conta" recolhível, último/próximo, aviso de atraso, erro expansível, avatares; editar → `Dialog` "Editar campanha"; excluir → `ConfirmDialog`. Mantenha a recarga a cada 15 s e os tempos relativos a cada 10 s.

#### 11.4 Inspirações — referência `inspiracoes.png`

- **PageHeader:** eyebrow "Conteúdo", título "Inspirações", descrição "Encontre conteúdos virais para modelar e adicionar à sua biblioteca."
- **Card de busca:** "Perfil" com prefixo @ (Enter busca); `Segmented` "Fonte": Apify / Conta leitora (o atual "Conta dedicada"). Com Conta leitora: sem leitoras cadastradas, o link "Cadastre uma conta leitora" (`/dashboard/contas-leitoras`); com leitoras, `Select` da conta (sufixos e desabilitadas como hoje) e "Quantos reels" (Todos os reels / Até 120 / 300 / 600 / 1200). Primary "Buscar Reels".
- **Banners:** buscas em segundo plano (info), buscas que falharam (danger, "Dispensar" e "Dispensar todos") e o toast de erro.
- **Histórico** (quando não há grade aberta): "Histórico de pesquisas (N)" em linhas com avatar, @, nome, "N reels", tempo, "Ver Reels" e excluir (`ConfirmDialog`); botão admin "Recuperar buscas perdidas" no cabeçalho. Vazio: o preview atual com cards de exemplo.
- **Grade:** cabeçalho com "Voltar", "@perfil" e "N reels"; `Segmented` "Mais vistos / Mais curtidos / Mais comentados / Mais longos"; `Select` "Salvar em:" (borda `warning` enquanto vazio); secondary "Baixar todos" e secondary "Salvar todos na Biblioteca" (como na referência; progresso no próprio botão). Grade `repeat(auto-fill, minmax(160px, 1fr))`.
- **Card de Reel** (`InspirationCard` reestilizado): thumbnail real 9:16 com duração (topo direito), views (base esquerda) e `Badge` "Na Biblioteca"; curtidas e comentários **sempre visíveis**; legenda em 2 linhas + "Ver legenda"; botão de estado ("Escolha uma pasta" / "Salvar na Biblioteca" / "Salvando…" / "Na Biblioteca" / "Tentar de novo" + mensagem) e IconButton de download (com os estados e o "Re-buscar URL do vídeo").
- **Modal de importação:** `Dialog` que não fecha enquanto roda, com `ProgressBar` e os 3 passos. Preserve todos os pollings e tempos-limite.

#### 11.5 Celular — referência `celular.png`

Toda tela funciona a partir de 375px: topbar de 56px (menu, logo, wordmark, sino), conteúdo com padding 16px, métricas em 2 colunas, tabelas viram blocos empilhados, barras de ferramenta quebram linha, a ação principal vai para a barra fixa do rodapé e alvos de toque têm no mínimo 44px.

#### 11.6 Landing (`app/page.tsx`) — referência `landing.html` / `landing.png`

Implemente a landing da referência, nesta ordem: nav (âncoras Recursos, Como funciona, FAQ e — só com preço ativo — Preço; "Entrar" → `/auth/login`; "Criar conta" → `/auth/register`; fixa no topo com fundo `bg` sólido e borda `line` ao rolar) → hero com horizonte (pílula "API oficial da Meta · Reels, Stories e Feed"; H1 "Dezenas de perfis. / *Um* só painel."; subtítulo; "Começar agora" → `/auth/register` e "Ver como funciona" → `#como-funciona`) → frame do produto montado com os componentes reais e dados de exemplo (nunca um print) → faixa de 4 fatos → "Como funciona" (01–04) → "Recursos" (Inspirações, Distribuição, Monitor e failover, com os mini-mockups) → "Preço" → FAQ em acordeão (`<details>`) → CTA final com horizonte → rodapé.

**Correções de texto em relação à referência** (a referência tem frases que não batem com o produto):
- Fato 1: "API oficial — contas conectadas pelo login da Meta" (no lugar de "sem senha salva": as contas leitoras guardam senha).
- FAQ "Preciso passar a senha do Instagram?": "Para publicar, não: as contas de postagem são conectadas pelo login oficial da Meta. Senha só é pedida nas contas leitoras, opcionais, usadas para buscar Reels."
- FAQ "O que acontece se uma conta cair?": "O Scale Master marca a conta como caída, avisa no celular e o failover passa a usar a próxima conta da ordem de prioridade."
- Mini-mockup de Monitor: "@casa.decor parou de publicar. O failover passou a usar a próxima conta."
- **Remova o FAQ "Consigo acompanhar minhas vendas?"** até o Bruce confirmar: hoje as vendas da Visão geral são uma soma global de todos os usuários, embora cada usuário tenha o próprio link de webhook. Registre no PR.

**Preço:** não há valor definido. Coloque `const SHOW_PRICING = false` no topo da página; com `false`, somem a seção e os links "Preço" da nav e do rodapé. Registre no PR que o Bruce precisa informar o preço. Nunca publique "[SEU PREÇO]".

Atualize os metadados (título e descrição), `app/icon.tsx`, `app/apple-icon.tsx`, `app/icon-192/route.tsx`, `app/icon-512/route.tsx` e `app/manifest.ts` para fundo e `theme_color` `#05070c`.

#### 11.7 Autenticação — referência `login.png`

- **Login, Cadastro e Pendente:** fundo `bg` com horizonte; header com logo + wordmark (link para `/`); card central de 400px (`surface`, borda `line`, raio 12px, padding 32px) com logo de 40px, `text-auth-title` e subtítulo `ink-2`; campos de 44px; botão primary lg de largura total; links em `accent`; rodapé discreto "API oficial da Meta · scalemaster.tech".
- **Login:** "Bem-vindo de volta" / "Entre na sua conta para continuar."; "E-mail ou nome de usuário"; "Senha" (com o botão de mostrar); "Entrar"; divisor "ou"; secondary "Continuar com Google" com o ícone do Google que já existe no código (não redesenhe a marca); "Não tem conta? Criar conta" → `/auth/register`. "Esqueceu a senha?": mostre só se a rota `/auth/forgot-password` existir; senão esconda e registre no PR.
- **Cadastro e Pendente:** campos, textos e ações do inventário (§22).
- **Banido e `/add/success`:** o mesmo card, **sem** horizonte.

#### 11.8 Demais telas do painel (mesmos padrões; conteúdo completo no inventário)

- **Loop (§10):** grade de cards (nome + `Badge` Ativo/Pausado, linha meta com ciclos, intervalo e ícones dos efeitos, chips de contas, ações Pausar/Retomar, Editar, Analytics, Excluir → `ConfirmDialog`); painel Analytics expansível (`ProgressBar` segmentada, 3 métricas, ranking com `Segmented` Views/Média por vídeo/Curtidas). "Novo/Editar loop" vira `Sheet` lateral de 640px com as seções Identificação, Contas, Conteúdo (pasta, quantidade, ciclos), Ritmo (intervalos), Legenda (dinâmicas + modo), Vídeo (capa, exibição, ordem, processamento, efeitos) — os 14 grupos de campos do inventário, sem perder nenhum. Trate `?acao=novo`.
- **Stories (§11):** duas colunas como hoje; esquerda com StepCards Mídia (`Dropzone` + biblioteca de mídias), Modelo (`ChipToggle` de pastas — os emojis de pasta viram ícones), Contas (chips com anel de story ativo, "Sem story", "Todas", "Limpar", recarregar), Link; botão "Publicar story"; card "Templates de story"; direita com o card "Histórico" fixo ao rolar. Importar template em `Dialog` de 2 passos.
- **Fila (§12):** PageHeader com indicador "ao vivo · auto em Ns" e as ações Atualizar / Diagnóstico / Forçar processamento; 5 StatTiles; painéis Diagnóstico e Resultado como Cards recolhíveis com grades de chave-valor e `Banner`s de alerta; "Postados recentemente" em `DataTable`; "Contas fora da fila" em chips; "Gerenciamento por conta" em cards (mantenha "Cancelar fila" desabilitado com tooltip).
- **Publicados (§13):** barra de filtros (Combobox de conta, `Segmented` Todos/Stories/Reels, busca, "Limpar filtros") + `DataTable` com as colunas responsivas atuais + rodapé com totais.
- **Clonar (§15):** layout da referência Postar — esquerda: busca, "Perfis salvos" (chips), card do perfil com StatTiles; direita: StepCards de configuração (Quantidade, Posts por dia, Início, Legenda, Vídeo, Contas de destino), Resumo e botão principal com os mesmos estados; "Histórico de clones" abaixo (Cancelar e Excluir via `ConfirmDialog`). Respeite a tabela da seção 4.3.
- **Biblioteca (§16):** PageHeader com o caminho "Biblioteca / {pasta}" e as ações primary "Nova pasta" e ghost "Limpar Registros Quebrados" (mantenha o rótulo e a confirmação em 2 cliques "Confirmar?" — seção 4.3); raiz em grade de cards de pasta com "⋯"; dentro da pasta, `Dropzone`, fila de upload com `ProgressBar`, barra de contagem/seleção, grade de vídeos 9:16 (`VideoCard` reestilizado; prévia ao passar o mouse; no toque, ações no "⋯"), "Carregar mais" e `SelectionBar` (Mover / Excluir → `ConfirmDialog`). "Postar agora" (`PostModal` reestilizado), pastas e mover em `Dialog`. O "Agendar" de cada vídeo passa a levar a `/dashboard/postar?tab=massa`. Trate `?acao=nova-pasta`.
- **Monitor (§17):** PageHeader com "Atualizado HH:MM:SS · auto em Ns" + Atualizar; `Tabs` Loop/Campanhas; card "Linha do tempo" (eixo −6h → agora → +3h; publicados em `success`, agendados em `accent`); "Próximas na fila" em chips; StatTiles; filtros `Segmented`; grade de cards por conta. Somente leitura.
- **Analytics (§18):** `Tabs` "Relatório" (o atual "Relatório do Chefe") / "Posts publicados"; Combobox de escopo (Todas / Pastas / Contas); StatTiles; gráficos com o wrapper de recharts; Top 3 vídeos; seguidores por conta; na aba de posts, 7 StatTiles e linhas com miniatura e métricas **com rótulo ou tooltip** (hoje são só ícones) + "Atualizar".
- **Contas leitoras (§3):** PageHeader + `Banner` informativo + formulário em Card recolhível + grade de cards (status, metadados, Conectar/Revalidar, credenciais em `Dialog`, excluir com `ConfirmDialog`).
- **Proxies (§4):** dois Cards — "Estoque de proxies" (3 mini-métricas, formulário de adição, ações em massa, lista) e "Verificar IPs" (botão, `Banner` de resumo, `DataTable`).
- **Failover (§5):** `Tabs` Failover / Diagnóstico; `Banner` de limpeza; chips de resumo; "Grupo de failover" com IconButtons ↑/↓ (`aria-label`), `Badge` PRINCIPAL/RESERVA N, status e "Restaurar"; histórico; Diagnóstico com StatTiles, `Banner` de cascata, barras com tokens e listas.
- **Meu App (§19):** `Tabs` "Meus apps" / "Como configurar"; `DataTable`; formulário em `Dialog`; passos 01–06 em StepCards.
- **Configurações (§20):** seções em Cards (Perfil, Segurança, Dispositivos e sessões, Notificações, Integrações) + **Aparência** (nova, ligada só na Fase 6: `Segmented` Escuro / Claro / Sistema, gravando `sm-theme`).
- **Admin (§21):** mesma casca (seção 10); tabelas e formulários com os componentes; ações sensíveis com `ConfirmDialog`.

### 12. Remoções e melhorias de UX autorizadas

Fora desta lista, o comportamento fica igual ao de hoje.

- **Remover** o fundo animado e o seletor "Fundo animado" (decisão de design aprovada).
- **Confirmação antes de destruir:** `ConfirmDialog` em "Remover conta", remover proxy, excluir loop, excluir vídeo(s) da Biblioteca, itens de histórico (Stories, Inspirações), templates de Story, legendas salvas, "Remover" em Agendados e nas confirmações que hoje são de 2 cliques — **exceto** "Limpar Registros Quebrados", que mantém os 2 cliques (seção 4.3). Depois de confirmar, a mesma chamada de hoje.
- **Ações que só aparecem no hover** ganham alternativa no toque e no teclado ("⋯" sempre visível no celular; `focus-within` no desktop).
- **Navegação:** Fila e Clonar entram no menu; "Em massa" e "Agendados" viram abas de Postar (com redirecionamento das rotas antigas); Meu App vai para o menu do usuário e para o ⌘K; parâmetros `?acao=` só de UI para o ⌘K.
- **Botões sem ação:** o sino ganha o Popover de alertas; "Ver tudo" vira "Ver monitor"; "Nova postagem" do header sai; "Esqueceu a senha?" fica escondido se a rota não existir; o "Agendar" da Biblioteca aponta para a aba Em massa.
- **Contas:** visão "Todas as contas" como padrão; busca por @; `Segmented` de status; filtro "Revisar tokens"; paginação no cliente acima de 50; seleção por checkbox, limpa a cada mudança de visão; status num único `Badge` com a precedência da seção 11.2.
- **Rótulos padronizados** com a navegação (ex.: "Visão geral", "Conta leitora", "Meu App", "Relatório") e em sentence case, desde que o sentido seja o mesmo — **exceto** os textos protegidos pela seção 4.3.

### 13. Fases

Uma branch, um PR em rascunho, commits por tela. Ao fim de cada fase: verificação (seção 14), push, `progresso.md`, a checklist do PR e a lista "O que conferir" para o Bruce.

| Fase | Entrega |
|---|---|
| 0 — Fundação | Branch; linha de base dos testes (4.2); tokens + aliases legados no `globals.css`; Tailwind aditivo (seção 7); fontes; `data-theme` + script anti-piscada + ajustes do `layout.tsx`; fundos animados removidos; classes legadas que ainda estão em uso — `glass` (16 arquivos de UI), `glass-card` (27), `gradient-text` (5), `grid-bg` (5), `btn-primary`, `btn-ghost`, `input-glass`, `page-title`, `page-subtitle`, `metric-value`, `range-slider` — reescritas com os tokens, sem blur nem degradê (`glass`/`glass-card` = `surface` + borda `line`; `gradient-text` = cor `ink`; `grid-bg` = nada); utilitários `no-scrollbar`, `custom-scrollbar` e `pt-safe`/`pb-safe`/`pl-safe`/`pr-safe` mantidos; a linha "Design System" do `CLAUDE.md` trocada por "Design System: Scale Master — escuro quase preto + azul da logo (#001244/#00498D) + prata (#BEB8BC); tokens em `app/globals.css`, primitivos em `components/ui/`, referência em `docs/design/`."; `docs/design/progresso.md` criado; PR em rascunho aberto. |
| 1 — Componentes | Tudo da seção 9 + a página de QA `app/dev/design-system`. |
| 2 — Casca | AppShell, Sidebar e Header (nos mesmos arquivos), ⌘K, Sheet do celular, banners, Popover do sino, loading, casca do admin. |
| 3 — Telas principais | Visão geral (com `views.daily`), Contas, Postar (com as abas e os redirecionamentos), Inspirações. |
| 4 — Demais telas do painel | Loop, Stories, Fila, Publicados, Clonar, Biblioteca, Monitor, Analytics, Contas leitoras, Proxies, Failover, Meu App, Configurações. |
| 5 — Público e admin | Landing, login, cadastro, pendente, banido, `/add/success`, ícones e manifest; telas do admin. |
| 6 — Varredura | Seção 14 completa; Tailwind estrito (seção 7); aliases e classes legadas removidos; framer-motion só em Dialog/Sheet/Toast; controle de tema ligado (Aparência + "Alternar tema" no ⌘K). |

### 14. Verificação

- **Testes:** compare cada parte do `npm test` com a linha de base (4.2) — nenhuma falha nova. `npm run typecheck`, `npm run lint` e `npm run build` passando.
- **Cores fixas:** `grep -rnE "#[0-9A-Fa-f]{3,8}\b|rgba?\(" app components --include=*.tsx --include=*.ts --include=*.css | grep -v "^app/api/"` deve sobrar **só** em: `app/globals.css`; `app/layout.tsx` (`themeColor`); `app/manifest.ts`; `app/icon.tsx`, `app/apple-icon.tsx`, `app/icon-192/route.tsx`, `app/icon-512/route.tsx`; o ícone do Google no login; `LABEL_COLORS` em Contas (dados das etiquetas). Código morto com cores (`components/search/*`, `components/schedule/AccountSelector.tsx`) pode ser apagado depois de confirmar com grep que não é importado. Liste as exceções no PR.
- **Classes e variáveis legadas** (na Fase 6 têm de voltar vazios na UI): `grep -rnE "\b(text|bg|border|ring|divide|from|via|to|fill|stroke|placeholder|outline|shadow|decoration)-(white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|matrix|electric|obsidian|brand-purple|brand-cyan)\b" app components` e `grep -rnE "var\(--(matrix|electric|background|surface-elevated|border|border-hover|text-primary|text-secondary|text-muted|brand-gradient)\)" app components`. Exceção justificada: texto sobre mídia (thumbnails) pode usar `text-white`.
- Nenhum `style={{` com cor, sombra ou fonte; `style` só para valores dinâmicos (largura de barra, posição, cor de etiqueta).
- **Comparação visual:** capture com Playwright a página de QA e as páginas públicas (landing, login, cadastro) a 1440px e a 390px, nos dois temas, e compare com `docs/design/referencia/*.png`. Corrija diferenças que não venham de dados reais nem das decisões da seção 11.
- **Checklist funcional:** para cada tela, percorra a seção do inventário e marque no `progresso.md` cada ação, modal, filtro, estado e atualização automática como presente.
- **Acessibilidade:** navegação completa por teclado na casca, no ⌘K, nos diálogos (foco preso e devolvido) e nos formulários; `aria-label` em todo botão só com ícone; contraste conferido nos dois temas; alvos de toque ≥44px no celular.
- Sem rolagem horizontal a 375px.

### 15. Voz da interface

Português do Brasil, "você", frases curtas, sentence case (MAIÚSCULAS só no eyebrow; exceções da seção 4.3). Botões são verbos ("Criar distribuição", "Conectar conta", "Remover conta"). Tempo relativo como já existe ("agora mesmo", "há 5 min"). Erros dizem o que fazer ("Token da Meta expirou. Reconecte a conta para voltar a publicar."). Sem emoji na UI (os emojis de pasta viram ícones) e sem exclamação em mensagens do sistema.

### 16. Entrega final

No PR (descrição) e no `progresso.md`:
- telas migradas e o que mudou em cada uma, com a lista "O que conferir" para o Bruce;
- capturas finais da página de QA e das páginas públicas em `docs/design/capturas/`, comprimidas;
- linha de base e resultado final dos testes, e os ajustes feitos em `scripts/test-*.mjs` (só caminhos/regex, seção 4.3);
- exceções do grep;
- os "Achados do levantamento" do fim do `inventario.md` que continuam valendo, mais os que você encontrar — **liste, não corrija** o que for lógica;
- pendências que dependem do Bruce: preço da landing, FAQ de vendas, rota de recuperação de senha, logo em SVG.
