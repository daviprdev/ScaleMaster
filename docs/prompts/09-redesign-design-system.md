# Redesign completo da interface — Design System "Scale Master"

> **Como usar este arquivo.** A Parte 1 é o plano, para você ler e decidir. A Parte 2 é o prompt: abra um chat novo do Claude Code na pasta do projeto e cole tudo a partir de "## Parte 2". Ele é autossuficiente — não depende desta conversa.
>
> Referência visual viva (privada, na sua conta): o artifact **Design System "Scale Master"**, com tokens, 12 componentes, a tela-modelo do painel (AppShell) e da landing.

---

## Parte 1 — Plano (para você)

### Diagnóstico do que existe hoje

| Problema | Evidência no repositório |
|---|---|
| Cores fixas espalhadas | ~1.000 cores hex escritas à mão em `app/` e `components/` (`#00498D` aparece 494 vezes, `#85B9E9` 387) e 330 `style={{…}}` inline |
| Nenhum componente base | Não existe `components/ui/`. Botões, cards e inputs são classes soltas (`btn-primary`, `glass-card`) misturadas com Tailwind e inline |
| Páginas gigantes | `accounts` 3.319 linhas, `postar` 2.228, `loop` 2.167, `inspirations` 1.432, `clone` 1.423 — layout, estado e regras no mesmo arquivo |
| Efeitos pesados e fora do tom | 6 fundos animados (`BeamsBackground`, `ParticlesBackground`, `TopographyBackground`, `WireframeTerrain`, `ParticleBackground`, `BackgroundController`) + framer-motion em 37 arquivos |
| Paleta legada misturada | `tailwind.config.ts` ainda mapeia `matrix`, `electric`, `obsidian`, `brand.purple`, `brand.cyan` para tons de azul; `CLAUDE.md` ainda descreve "Cyber-Military Elite, verde neon" |
| Navegação inchada | 5 grupos, 14 itens, e rotas reais fora do menu (`clone`, `queue`, `posts`, `schedule`) |

### Direção

**Direto, discreto, moderno.** Escuro quase preto com um toque de navy (como as referências GhostCLI/SharkBot/FlexionPay), o azul da logo só onde há ação, o prata do "M" assinando a marca. Tipografia Geist + Geist Mono, uma palavra em Instrument Serif itálico nos títulos da landing (a "ênfase" que a FlexionPay usa). Um único efeito: o brilho "horizonte" navy → azul no topo da landing e do login. Sem neon, glass ou partículas.

Das referências foi aproveitado **só o vocabulário visual**: fundo quase preto, eyebrow em pílula, título grande com palavra destacada, frame do produto, faixa de fatos, seções numeradas 01–04, card de preço único com checklist. Nenhuma funcionalidade delas.

### Arquitetura de UI proposta

```
app/globals.css            → só tokens (CSS vars dos 2 temas) + reset + utilitários mínimos
tailwind.config.ts         → cores/raios/sombras apontando para var(--token); legado removido
components/ui/             → primitivos: Button, Badge, Input, Textarea, Select, Checkbox, Switch,
                             Card, Stat, Segmented, Tabs, DataTable, EmptyState, PageHeader,
                             Dialog, Sheet (drawer), DropdownMenu, Tooltip, Toast, Skeleton, Kbd
components/shell/          → AppShell, Sidebar, Topbar, CommandPalette (⌘K), UserMenu
components/marketing/      → Nav, Hero, ProductFrame, FactStrip, Steps, Pricing, FAQ, Footer
app/dashboard/<rota>/
  page.tsx                 → só composição (PageHeader + seções), < 250 linhas
  _components/*.tsx        → pedaços da tela (tabela, filtros, modais)
  _hooks/*.ts              → busca de dados/estado (o que hoje está no topo do page.tsx)
```

Navegação nova (5 grupos, ~14 itens):

- **Início:** Visão geral
- **Contas:** Contas · Contas leitoras · Proxies · Failover
- **Publicar:** Postar · Loop · Stories · Fila · Publicados
- **Conteúdo:** Inspirações · Clonar · Biblioteca
- **Dados:** Monitor · Analytics
- Menu do usuário (rodapé da sidebar): Configurações · Meu App · Admin (se admin) · Sair
- Busca ⌘K abre qualquer tela e ações rápidas ("Postar agora", "Conectar conta").

### Fases

| Fase | Entrega | Risco |
|---|---|---|
| 0 | Branch, tokens no `globals.css`, Tailwind remapeado, fontes trocadas, `CLAUDE.md` atualizado | Baixo — visual muda de uma vez, lógica não |
| 1 | `components/ui/` completo + página interna `/dashboard/design-system` mostrando todos | Baixo |
| 2 | Nova casca: Sidebar, Topbar, ⌘K, drawer mobile; remover os 6 fundos animados | Médio — toca layout de todas as telas |
| 3 | Telas de maior uso: Visão geral, Contas, Postar, Loop | Médio — páginas grandes, quebrar em `_components` |
| 4 | Demais telas do painel + Admin | Médio |
| 5 | Landing, login, cadastro, pending, banned, add/success | Baixo |
| 6 | Varredura final: zero hex fora de `globals.css`, a11y, mobile/PWA, testes, deploy | — |

Cada fase vira um PR separado, com prints antes/depois. Nada de regra de negócio, rota de API, SQL ou cron muda.

### Decisões que são suas

1. **`/dashboard/posts` (Agendamento em massa) e `/dashboard/schedule` (Agendamentos)** estão fora do menu hoje. O prompt os coloca como abas dentro de **Postar** ("Agora · Em massa · Agendados"). Se não usa mais, diga ao agente para mantê-los ocultos.
2. **Tema claro**: o sistema tem os dois temas; o prompt entrega escuro como padrão e o claro por um toggle em Configurações. Se não quer o claro agora, peça para pular.
3. **Logo vetorial**: só existe o JPG 200×200. Vale pedir um SVG ao designer antes da Fase 5 (favicon, og:image e landing ficam melhores).

---

## Parte 2 — Prompt (cole no Claude Code)

Você está começando sem histórico. Todo o contexto está aqui. Faça a implementação e os testes no repositório ScaleMaster; não entregue só sugestões.

### Contexto

ScaleMaster é um SaaS de gestão e publicação de conteúdo no Instagram (API oficial da Meta). Next.js 15 App Router, React 18, TypeScript, Tailwind 3.4, Supabase, lucide-react, framer-motion, recharts. Produção em VPS própria (`/opt/autoscale`, Docker Compose, Nginx) — leia `CLAUDE.md` para deploy. O objetivo desta tarefa é **recriar toda a interface** sobre um design system novo, sem alterar comportamento.

### Regras invioláveis

- **Não altere lógica:** rotas de API, chamadas ao Supabase, SQL, crons/timers, OAuth, webhooks, regras de fila e de mídia ficam idênticas. Se um componente mistura UI e lógica, mova a lógica intacta para um hook em `_hooks/` — sem reescrevê-la.
- **Não remova funcionalidade nem campo de formulário.** Toda ação que existe hoje continua alcançável.
- Trabalhe na branch `redesign/design-system`, um commit por etapa, um PR por fase (0–6). Não faça deploy sem eu pedir.
- Antes de editar uma página grande, rode o app e tire um print do estado atual (Playwright) para comparar depois.
- `npm run typecheck`, `npm run lint` e `npm test` precisam passar ao fim de cada fase.

### Direção visual

Direto, discreto, moderno. Escuro quase preto com um toque de navy é o tema principal. O azul da logo aparece só onde há ação; o prata da marca (`#BEB8BC`) assina o wordmark. Profundidade vem de um degrau de superfície + borda de 1px, não de sombra. Proibido: neon, glassmorphism/`backdrop-blur` em cards, fundos animados, texto em degradê, degradê em botão, borda colorida na lateral de card, emoji na UI, pesos de fonte acima de 600.

O único efeito permitido é o **horizonte**: um `radial-gradient(closest-side, var(--brand-blue), var(--brand-navy) 55%, transparent)` de ~1100×640px centrado acima do topo, opacidade .55 no escuro e .14 no claro — só no hero da landing, no CTA final e nas telas de auth.

### Tokens (cole no topo de `app/globals.css`, substituindo o `:root` atual)

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
  --shadow-none: none;
  --shadow-pop: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04);
  --shadow-frame: 0 40px 120px rgba(0, 18, 68, 0.55);
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
  --brand-navy: #001244;
  --brand-blue: #00498d;
  --brand-silver: #beb8bc;
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
  --shadow-none: none;
  --shadow-pop: 0 16px 40px rgba(10, 18, 32, 0.12), 0 0 0 1px rgba(10, 18, 32, 0.04);
  --shadow-frame: 0 40px 120px rgba(0, 73, 141, 0.16);
  color-scheme: light;
}
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-24: 96px;
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
  --control-height: 36px;
}
```

Regras de uso:

- Página `bg`; cards, sidebar e tabelas em `surface`; menus/modais em `surface-raised`; hover e item ativo em `surface-hover`.
- Texto: `ink` (títulos, valores, corpo), `ink-2` (descrições, rótulos), `ink-3` (timestamps, hints, placeholders, eyebrows). Todos passam 4.5:1 nos dois temas.
- `primary` é o único preenchimento colorido (botão principal, toggle ligado, progresso, série principal de gráfico); texto sobre ele em `on-primary`.
- `accent`: links, ícone do item ativo da sidebar, linha de gráfico, palavra em serifa da landing.
- `line` para cards e divisores; `line-control` para bordas de input/select/checkbox/botão secondary.
- Status (`success`/`warning`/`danger`) sempre acompanhado de texto ou ícone; fundo de badge/banner com o `*-soft` correspondente; info = `accent` + `info-soft`.
- Foco: `outline: 2px solid var(--focus); outline-offset: 2px` em todo elemento interativo.
- Tema: `<html data-theme="dark">` por padrão (troque o `className="dark"` e o `style={{background:"#000000"}}` atuais do `app/layout.tsx`). Toggle em Configurações grava `localStorage` + cookie e aplica `data-theme` antes da hidratação (script inline no `<head>`) para não piscar. `themeColor` do viewport: `#05070c`.

### Tailwind

Em `tailwind.config.ts`, apague `colors` inteiro (incluindo os aliases legados `matrix`, `electric`, `obsidian`, `brand.purple/cyan…`), `backgroundImage`, `animation`, `keyframes` e `backdropBlur`, e defina:

```ts
colors: {
  bg: "var(--bg)", surface: { DEFAULT: "var(--surface)", raised: "var(--surface-raised)", hover: "var(--surface-hover)" },
  line: { DEFAULT: "var(--line)", control: "var(--line-control)" },
  ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)" },
  primary: { DEFAULT: "var(--primary)", hover: "var(--primary-hover)", fg: "var(--on-primary)" },
  accent: "var(--accent)", focus: "var(--focus)",
  brand: { navy: "var(--brand-navy)", blue: "var(--brand-blue)", silver: "var(--brand-silver)" },
  success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
  warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
  danger:  { DEFAULT: "var(--danger)",  soft: "var(--danger-soft)" },
  info: { soft: "var(--info-soft)" }, overlay: "var(--overlay)",
  transparent: "transparent", current: "currentColor", white: "#fff", black: "#000",
},
borderRadius: { none: "0", sm: "var(--radius-sm)", DEFAULT: "var(--radius-md)", md: "var(--radius-md)", lg: "var(--radius-lg)", xl: "var(--radius-xl)", full: "var(--radius-full)" },
boxShadow: { none: "none", pop: "var(--shadow-pop)", frame: "var(--shadow-frame)" },
fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"], mono: ["var(--font-mono)", "ui-monospace", "monospace"], serif: ["var(--font-serif)", "Georgia", "serif"] },
```

Como `colors` é substituído (não `extend`), classes como `bg-gray-800`, `text-white/60`, `border-white/10` deixam de existir — isso é intencional: o build/lint vai apontar cada uso antigo para você migrar.

### Tipografia

Em `app/layout.tsx`, troque Inter/Space Grotesk/JetBrains Mono por `next/font/google`: `Geist` (`--font-sans`, pesos 400/500/600), `Geist_Mono` (`--font-mono`, 400/500), `Instrument_Serif` (`--font-serif`, `style: "italic"`, peso 400).

| Estilo | Uso | Especificação |
|---|---|---|
| display-xl | H1 da landing | 60/62, 600, -0.035em (40/44 no mobile) |
| display | H2 da landing, título de auth | 40/44, 600, -0.03em |
| accent-serif | 1 palavra de ênfase num display | Instrument Serif itálico 400, cor `accent` |
| body-lg | Subtítulo/texto da landing | 17/28, 400, `ink-2` |
| title | Título da página do app | 22/28, 600, -0.02em |
| heading | Título de card/seção | 15/22, 600, -0.01em |
| body | Texto padrão do app | 14/22, 400 |
| label | Rótulos, botões, nav | 13/18, 500 |
| caption | Metadados, hints | 12/16, 400, `ink-3` |
| eyebrow | Grupo da sidebar, cabeçalho de tabela | mono 11/16, 500, 0.12em, MAIÚSCULAS, `ink-3` |
| metric | Valor de Stat | mono 28/32, 500, -0.02em, tabular-nums |

Todo número que muda usa `tabular-nums`. Números e moeda sempre em pt-BR (`toLocaleString("pt-BR")`).

### Espaço, cantos, movimento

- Grade de 4px. Padding de card 20px; gap entre cards 16–24px; PageHeader → conteúdo 32px; seções da landing 96px (64 no mobile).
- Raios: controles 8px, cards/modais 12px, card de preço e frame do produto 16px, badges/avatares pílula.
- Sombra só no que flutua (`shadow-pop`); cards sem sombra.
- Transições 150ms `ease` em cor/borda; modais/menus 200ms fade + 4px. Sem `translateY` no hover, sem nada em loop. Respeite `prefers-reduced-motion`. Use framer-motion só em Dialog/Sheet/Toast; remova-o do resto.
- Ícones: lucide-react com `strokeWidth={1.75}`; 16px em botões/tabelas, 17px na sidebar, 20px em estados vazios; cor por `currentColor`.

### Fase 0 — Fundação

1. Crie a branch. Substitua o `:root` de `globals.css` pelos tokens acima; remova `.glass`, `.glass-card`, `.gradient-text`, `.brand-border`, `.grid-bg`, keyframes de partícula/aurora. Mantenha temporariamente `.btn-primary`, `.btn-ghost`, `.input-glass`, `.page-title`, `.page-subtitle`, `.metric-value`, reescritas com os tokens novos (para as telas ainda não migradas não quebrarem); elas são removidas na Fase 6.
2. Atualize `tailwind.config.ts` e `app/layout.tsx` (fontes, `data-theme`, `themeColor`, remover `BackgroundProvider`).
3. No `CLAUDE.md`, troque a linha "Design System: Cyber-Military Elite…" por: "Design System: Scale Master — escuro quase preto + azul da logo (#001244/#00498D) + prata (#BEB8BC); tokens em `app/globals.css`, primitivos em `components/ui/`, guia em `docs/design-system.md`."
4. Crie `docs/design-system.md` com as seções "Direção visual", "Tokens/regras de uso", "Tipografia", "Espaço, cantos, movimento" e "Voz" deste prompt.

### Fase 1 — Primitivos em `components/ui/`

Um arquivo por componente, `forwardRef` onde fizer sentido, `cn()` de `lib/utils`, variantes via props (sem lib nova). Contrato mínimo:

- `Button` — `variant: primary | secondary | ghost | danger`, `size: sm(32) | md(36) | lg(44)`, `icon`, `iconRight`, `loading` (spinner + `disabled` + `aria-busy`), `asChild` opcional para `<Link>`. Um `primary` por área visível.
- `Badge` — `tone: neutral | info | success | warning | danger`, `dot`. Pílula 22px.
- `Input`, `Textarea`, `Select`, `Checkbox`, `Switch` — `label`, `hint`, `error` ligados por `aria-describedby`; borda `line-control`; altura 36 (44 no mobile).
- `Card` — `title`, `description`, `actions`, `flush` (corpo sem padding, para tabelas). Não aninhar cards.
- `Stat` — `label`, `value` (já formatado), `delta` com sinal (define a seta), `tone: positive | negative | neutral` (define a cor; quando subir é ruim, ex. "Contas caídas", use `negative`), `hint`, `icon`, `spark` (número[] → polyline 96×28 em `accent`).
- `Segmented` (2–5 opções exclusivas), `Tabs` (sublinhado 2px em `accent` na aba ativa).
- `DataTable` — `columns` (`key`, `label`, `align`, `numeric`, `render`), `rows`, `empty`, `loading` (skeleton de 5 linhas). Cabeçalho em estilo eyebrow; números mono à direita; no mobile (<640px) cada linha vira bloco empilhado.
- `EmptyState` — ícone em quadrado 40px `surface-hover`, `title`, `description`, uma `action`. Borda tracejada `line`.
- `PageHeader` — `eyebrow` (nome do grupo da sidebar), `title`, `description`, `actions` (máx. 2).
- `Dialog`, `Sheet` (drawer lateral/mobile), `DropdownMenu`, `Tooltip`, `Toast` (canto inferior direito, `shadow-pop`), `Skeleton`, `Kbd`, `Banner` (`tone` + texto + ação, para os avisos de saúde de conta, anúncio e impersonação).
- Crie `app/dashboard/design-system/page.tsx` (só para admin; não use pasta com `_`, que o App Router não roteia) renderizando todos os componentes em todos os estados, nos dois temas. É a página de QA visual.

### Fase 2 — Casca do app

- `components/shell/AppShell.tsx` substitui `DashboardShell`. Grid: sidebar 240px (recolhe para 64px, estado salvo em `localStorage`) + coluna com Topbar 56px + `<main>` com conteúdo até 1200px, padding 32px (16px no mobile).
- **Sidebar** (`surface`, borda direita `line`): logo `public/brand/scale-master-logo.jpg` 26px com raio 7px + wordmark "Scale Master" Geist 600 em `brand-silver` (escuro) / `ink` (claro); grupos com rótulo eyebrow; itens 34px de altura, ícone 17px; ativo = `surface-hover` + ícone `accent` + traço de 2px à esquerda; contador mono à direita para Fila (pendentes) e Contas. Rodapé: avatar + nome + plano, abrindo o menu do usuário (Configurações, Meu App, Admin se admin, Sair). Use exatamente a navegação:
  - Início: Visão geral `/dashboard`
  - Contas: Contas `/dashboard/accounts` · Contas leitoras `/dashboard/contas-leitoras` · Proxies `/dashboard/proxy-test` · Failover `/dashboard/failover`
  - Publicar: Postar `/dashboard/postar` · Loop `/dashboard/loop` · Stories `/dashboard/stories` · Fila `/dashboard/queue` · Publicados `/dashboard/publicados`
  - Conteúdo: Inspirações `/dashboard/inspirations` · Clonar `/dashboard/clone` · Biblioteca `/dashboard/library`
  - Dados: Monitor `/dashboard/monitor` · Analytics `/dashboard/analytics`
- **Topbar**: breadcrumb (grupo / página) à esquerda; à direita campo de busca 320px com `Kbd` ⌘K (Ctrl K fora do Mac), botão de notificações (popover com os mesmos avisos dos banners de saúde/anúncio; a inscrição em push continua em Configurações, no `PushNotificationManager`), nada de logo repetida.
- **CommandPalette** (⌘K/Ctrl K): lista todas as telas acima + ações ("Postar agora", "Conectar conta", "Nova pasta na biblioteca", "Abrir configurações"), filtro por texto, navegação por setas, Enter abre, Esc fecha. `surface-raised` + `shadow-pop`, 560px.
- **Mobile (<1024px)**: sidebar vira `Sheet` sobre `overlay`; Topbar ganha botão de menu; respeite `pt-safe/pb-safe` (PWA).
- Banners do `app/dashboard/layout.tsx` (impersonação, anúncio, saúde de contas, cascade) passam a usar `Banner`, empilhados entre a Topbar e o conteúdo. A lógica de busca desses dados no layout não muda.
- Apague `BackgroundContext`, `BackgroundController`, `BeamsBackground`, `ParticlesBackground`, `TopographyBackground`, `WireframeTerrain`, `components/dashboard/ParticleBackground.tsx` e o `BrandLogo` com `gradient-text` (crie `components/shell/Logo.tsx` simples).
- Atualize o mapa de títulos em `components/dashboard/Header.tsx` (ou o equivalente novo) para os nomes da navegação.

### Fases 3 e 4 — Telas

Para cada tela: (a) print do estado atual; (b) mova estado e efeitos de dados do `page.tsx` para `_hooks/use<Coisa>.ts` sem mudar a lógica; (c) quebre a UI em `_components/`; (d) monte com `PageHeader` → `Banner`s → `Stat`s (se houver métricas) → `Card`s/`DataTable`; (e) troque toda cor hex/rgba/`text-white/…` por tokens; (f) print depois e compare se nenhuma ação sumiu. Meta: `page.tsx` com menos de 250 linhas.

Ordem e notas:

1. **Visão geral** (`/dashboard`): PageHeader com data por extenso e "sincronizado há X"; `Segmented` Hoje/7d/30d e botão primary "Postar". Linha de 4 Stats: Views hoje, Vendas hoje, Publicados hoje (hint "N na fila"), Contas ativas (hint com a conta caída). Grid 2/3 + 1/3: card "Views" (recharts `AreaChart`, linha `accent` 1.75px, área `accent` 10%, grade `line`, eixos mono 11px `ink-3`, sem legenda quando há uma série) e card "Saúde das contas" (barra de tokens válidos em `primary` + linhas com Badge). Depois "Próximas publicações" (`DataTable` em `Card flush`) e "Atividade recente".
2. **Contas** (3.319 linhas — maior refatoração): PageHeader "Contas" com contagem e "N precisam de atenção"; ações "Importar" (secondary) e "Conectar conta" (primary). Toolbar: busca, filtro por pasta (`Select`), status (`Segmented`: Todas/Ativas/Com erro), alternar grade/lista. Lista em `DataTable` (avatar 28px, @usuário, pasta, proxy, status `Badge`, views 24h mono, ações ghost). Pastas como sidebar secundária de 220px dentro da página no desktop, `Select` no mobile. Modais (magic link, proxy em massa, editar) viram `Dialog`.
3. **Postar** (2.228): abas `Tabs` "Agora · Em massa · Agendados" — "Em massa" renderiza o conteúdo atual de `/dashboard/posts`, "Agendados" o de `/dashboard/schedule` (as rotas antigas redirecionam para `/dashboard/postar?tab=…`). Layout em duas colunas no desktop: esquerda = mídia + legenda + opções (CaptionModeSelector, ReelPlacementSelector, VideoProcessingSelector reestilizados como `Card`s com `Segmented`/`Switch`), direita = seleção de contas (`AccountSelector`) e resumo fixo com o botão primary "Publicar em N contas".
4. **Loop** (2.167), **Stories** (1.256), **Inspirações** (1.432), **Clonar** (1.423), **Biblioteca** (1.217): grades de mídia com thumbnails 9:16, raio 12px, overlay `overlay` no hover com ações; filtros na toolbar do PageHeader; `EmptyState` em toda lista vazia.
5. **Fila**, **Publicados**, **Monitor**, **Analytics**, **Contas leitoras**, **Proxies**, **Failover**, **Meu App**, **Configurações** (aqui entra o toggle de tema e as preferências de notificação), e **Admin** (`app/admin/*`: mesma casca, sidebar própria com Visão geral, Usuários, Contas conectadas, Notificações, Logs, Suporte, e um aviso fixo "Modo admin" em `warning-soft`).

### Fase 5 — Páginas públicas

`app/page.tsx` (landing), na ordem:

1. **Nav** 64px: logo + wordmark, links (Recursos, Como funciona, Preço, FAQ) em `ink-2`, à direita "Entrar" (ghost) e "Criar conta" (primary). Fica fixa com `bg` 80% + borda `line` após rolar.
2. **Hero** com horizonte, centralizado: pílula `surface` + borda `line` com ponto `success` e "API oficial da Meta · Reels, Stories e Feed"; H1 "Dezenas de perfis.<br/><em>Um</em> só painel." (`em` em accent-serif); subtítulo "Conecte suas contas do Instagram, encontre conteúdo que performa e publique no automático — com métricas de cada perfil em tempo real." (máx. 600px); botões lg "Começar agora →" (primary) e "Ver como funciona" (secondary).
3. **ProductFrame**: janela `surface`, raio 16px, `shadow-frame`, barra com 3 pontos e `scalemaster.tech/dashboard` em mono, contendo componentes reais (`Stat`s e um gráfico) com dados de exemplo — nunca um print.
4. **FactStrip**: 4 colunas separadas por `line` — "API oficial / Login pela Meta, sem senha salva", "Reels, Stories e Feed / Agendados ou em loop", "Failover automático / Conta caiu, outra assume", "Instala como app / PWA com notificações push". Nada de números inventados.
5. **Como funciona**: eyebrow + H2 "Do perfil novo ao post publicado em <em>quatro</em> passos." + 4 cards numerados 01 Conecte · 02 Encontre · 03 Publique · 04 Acompanhe.
6. **Recursos**: blocos alternados texto/mockup para Inspirações, Loop, Stories e Monitor, cada mockup feito com os componentes reais.
7. **Preço**: um card `surface-raised`, raio 16px, preço grande em mono, checklist com ícone `check` em `success`, botão primary largura total. A landing atual não tem planos/valores: deixe o card com `TODO` visível no PR e me pergunte os valores antes do merge.
8. **FAQ** em acordeão; **CTA final** com horizonte; **Footer** com links e "© Scale Master".

Auth (`/auth/login`, `/auth/register`, `/auth/banned`, `/pending`, `/add/success`): fundo `bg` com horizonte, card central 400px `surface` + borda `line` + raio 12px, logo 40px acima, título em `display` reduzido (28/34), campos `Input`, botão primary lg largura total, links em `accent`.

Atualize `app/icon.tsx`, `app/apple-icon.tsx`, `icon-192`, `icon-512` e `manifest.ts` para fundo `#05070c` e `theme_color` `#05070c`.

### Fase 6 — Varredura e verificação

- `grep -rnE "#[0-9A-Fa-f]{3,8}\b|rgba?\(" app components` deve retornar **apenas** `app/globals.css`, os ícones gerados (`app/icon*.tsx`) e cores de marcas de terceiros inevitáveis (ex.: logo do Google no login) — liste essas exceções no PR.
- Nenhum `style={{` com cor, sombra ou fonte; `style` só para valores dinâmicos (largura de barra, posição).
- Remova as classes legadas temporárias (`btn-primary`, `input-glass`, etc.) e os imports de framer-motion fora de Dialog/Sheet/Toast.
- Acessibilidade: navegação completa por teclado na casca, ⌘K, diálogos (foco preso e devolvido) e formulários; contraste conferido nos dois temas; `aria-label` em todo botão só com ícone.
- Mobile: teste 375×812 e 768×1024 com Playwright em Visão geral, Contas, Postar, Biblioteca, landing e login; sem scroll horizontal.
- Rode `npm run typecheck && npm run lint && npm test && npm run build`.
- Entregue no último PR: lista de telas migradas, prints antes/depois de cada uma (escuro e claro), exceções do grep e qualquer coisa que não conseguiu migrar com o motivo.

### Voz da interface

Português do Brasil, "você", frases curtas, sentence case (MAIÚSCULAS só no eyebrow). Botões são verbos ("Postar agora", "Conectar conta", "Remover conta"). Tempo relativo como já existe ("agora mesmo", "há 5 min"). Erros dizem o que fazer ("Token da Meta expirou. Reconecte a conta para voltar a publicar."). Sem emoji na UI e sem exclamação em mensagens do sistema.
