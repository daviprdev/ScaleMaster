# Progresso do Redesign — Scale Master

## Status Geral
- **Branch:** `redesign/design-system`
- **PR:** (rascunho a ser criado ao fim da Fase 0)
- **Fase atual:** 0 — Fundação

## Fases

### Fase 0 — Fundação
| Item | Status | Commit | Notas |
|------|--------|--------|-------|
| Branch criada | ✅ | - | A partir de `origin/docs/redesign-design-system` |
| Tokens em `globals.css` | 🔄 | - | Substituindo `:root` atual |
| Tailwind remapeado | ⏳ | - | Cores, borderRadius, boxShadow, fontFamily |
| Fontes Geist + Instrument Serif | ⏳ | - | Trocar Inter/SpaceGrotesk/JetBrainsMono |
| `data-theme` + script anti-piscada | ⏳ | - | Em `layout.tsx` |
| Fundos animados removidos | ⏳ | - | BackgroundContext, Controller, Particles, Beams, Wireframe, Topography |
| Classes legadas reescritas | ⏳ | - | glass, glass-card, gradient-text, grid-bg, etc. |
| CLAUDE.md atualizado | ⏳ | - | Linha do design system |
| PR em rascunho aberto | ⏳ | - | Ao fim da fase |

### Fase 1 — Componentes
| Item | Status | Commit | Notas |
|------|--------|--------|-------|
| Componentes UI (`components/ui/`) | ✅ | d521bd5 | 28 componentes primitivos |
| `/dashboard/design-system` | ⏳ | - | Página de QA visual (Fase 3+) |

### Fase 2 — Casca
| Item | Status | Commit | Notas |
|------|--------|--------|-------|
| AppShell | ✅ | f6b24b9 | Sidebar + Topbar + main |
| CommandPalette (⌘K) | ✅ | f6b24b9 | Navegação + ações + tema |
| Sheet celular | ✅ | f6b24b9 | Sidebar mobile overlay |
| Banners | ⏳ | - | Banner global no layout |
| Popover sino | ✅ | e23c6f6 | NotificationPopover integrado |
| Loading entre rotas | ✅ | f6b24b9 | Skeleton em /dashboard/loading.tsx |
| Casca admin | ⏳ | - | Layout admin separado |

### Fase 3 — Telas principais
| Item | Status | Commit | Notas |
|------|--------|--------|-------|
| Visão geral (+ views.daily) | ⏳ | - | |
| Contas | ⏳ | - | |
| Postar (abas + redirecionamentos) | ⏳ | - | |
| Inspirações | ⏳ | - | |

### Fase 4 — Demais telas do painel
| Item | Status | Commit | Notas |
|------|--------|--------|-------|
| Loop, Stories, Fila, Publicados | ⏳ | - | |
| Clonar, Biblioteca, Monitor, Analytics | ⏳ | - | |
| Contas leitoras, Proxies, Failover | ⏳ | - | |
| Meu App, Configurações (Aparência) | ⏳ | - | |

### Fase 5 — Público e admin
| Item | Status | Commit | Notas |
|------|--------|--------|-------|
| Landing | ⏳ | - | |
| Login, Cadastro, Pendente, Banido | ⏳ | - | |
| Ícones e manifest | ⏳ | - | |
| Telas admin | ⏳ | - | |

### Fase 6 — Varredura
| Item | Status | Commit | Notas |
|------|--------|--------|-------|
| Verificação completa (seção 13) | ⏳ | - | |
| Classes legadas removidas | ⏳ | - | Sem uso restante |
| framer-motion fora de Dialog/Sheet/Toast | ⏳ | - | |

## Pendências Bruce
- Preço da landing (`SHOW_PRICING = false` até lá)
- Rota `/auth/forgot-password` (existe?)
- Logo em SVG

## Achados do Levantamento
(a preencher durante o trabalho)