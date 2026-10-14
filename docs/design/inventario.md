# Inventário de funcionalidades — o que cada tela faz hoje

Levantado do código em 13/10/2026 (commit `8e82f23` da `main`), tela por tela, para o redesign.

**Regra:** tudo o que está listado aqui continua existindo depois do redesign — mesmo dado, mesma ação, mesmo comportamento —, só que com o visual novo. As únicas exceções são as remoções intencionais e as melhorias de UX listadas no prompt (`docs/prompts/09-redesign-design-system.md`, seção 12, "Remoções e melhorias de UX autorizadas"). Rótulos atuais aparecem entre aspas; ao redesenhar, use o rótulo novo quando o prompt definir um e mantenha o sentido.

---

## 0. Moldura do painel (todas as rotas `/dashboard/*`)

**Acesso (em `app/dashboard/layout.tsx`)**
- Sem login → `/auth/login`. Não-admin pendente ou sem papel → `/pending`. Banido → `/auth/banned`. Admin sempre passa.
- Entre rotas aparece um spinner central (`app/dashboard/loading.tsx`).

**Banners no topo** (podem aparecer juntos, nesta ordem)
1. **Impersonação:** "Modo Admin — Vendo como {email} · Admin: {email admin}" + botão "Sair do modo Admin" (com spinner): encerra a impersonação, desloga e manda para o login. Não pode ser dispensado.
2. **Anúncio do sistema:** último anúncio ativo; oculto durante a impersonação. Megafone + mensagem em 1 linha + X (dispensa até recarregar).
3. **Queda em cascata** (4+ contas com erro na última hora): "Queda em cascata detectada", link "Configurações → Apps" (`/dashboard/apps`), texto "{N} contas caíram na mesma hora — provável problema no nível do App Meta… Considere distribuir contas em múltiplos Apps." X dispensa pela sessão do navegador.
4. **Contas com erro de publicação** (contas ativas em erro): "N conta(s) com erro de publicação", "Ver detalhes"/"Ocultar", link "Gerenciar" (`/dashboard/failover`). Recolhido: "@a, @b, @c e mais N…". Expandido: "@user — {motivo}" (motivos: "Conta pessoal — não suporta API de Reels", "Token inválido / conta não confirmada", "Erro desconhecido na Meta API") + nota "Essas contas foram pausadas automaticamente. Corrija o problema e clique em Restaurar na página de Failover." X dispensa pela sessão.

**Sidebar atual (desktop)** — 240px, recolhe para 72px (estado não salvo)
- "VISÃO GERAL": Dashboard, Contas · "PUBLICAÇÃO": Postar, Loop, Stories, Publicados · "CONTEÚDO": Inspirações, Contas Leitoras, Biblioteca, Proxies · "RELATÓRIOS": Monitor, Analytics · "CONFIGURAÇÕES": Meu App, Failover · "SISTEMA" (só admin): Painel Admin (`/admin`).
- Rodapé: avatar, nome (nome completo, senão e-mail) e "Minha Conta" → menu com avatar, nome, e-mail, "Configurações" (`/dashboard/settings`) e "Sair". Esc/clique fora fecha; recolhida, abre para a direita.
- **Fora do menu hoje:** Fila (`/dashboard/queue`), Clonar (`/dashboard/clone`), Agendamento em massa (`/dashboard/posts`), Agendamentos (`/dashboard/schedule`). Configurações só pelo menu do usuário.

**Celular:** hambúrguer "Abrir menu" + logo; gaveta com os mesmos grupos (e "Painel Admin" para admins); rodapé com link para o perfil e botão de sair só com ícone.

**Header (desktop):** título/subtítulo por um mapa fixo de rotas. Rotas sem entrada mostram "Dashboard" (Proxies, Failover, Inspirações, Clonar, Monitor, Stories, Fila, Publicados). Títulos não batem com o H1 de várias páginas. Sino com ponto aceso **sem ação**. Em `/dashboard/schedule`, botão "Nova postagem"/"Nova" **sem ação**.

**Fundo animado:** botão flutuante "Controle de fundo" → painel "Fundo Animado": "Terreno 3D" (padrão), "Partículas", "Feixes", "Desligado"; escolha salva no navegador.

---

## 1. Visão geral (`/dashboard`)

**Propósito:** resumo de vendas, views, publicações, saúde das contas e fila.

**Blocos, na ordem**
1. Botão "Atualizar" (vira "Atualizando…", ícone girando, desabilitado).
2. Saudação "Bem-Vindo, {nome}" (display_name → full_name → prefixo do e-mail; some sem nome).
3. **Vendas:** "Vendas Hoje" (R$); "Ontem: R$…"; "Este mês: R$… · Anterior: R$…". Vendas são globais (webhooks do dono do SaaS).
4. **"Views das Contas"** ("Contas ativas e conectadas"): pílulas "Hoje" | "Ontem" | "7 dias" | "30 dias" | "Este mês", cada uma com tooltip e o mesmo texto sob o número: "Dia atual — zera às 21h (Brasília)", "Dia anterior completo", "Últimos 7 dias, incluindo hoje", "Últimos 30 dias, incluindo hoje", "Desde o dia 1º — zera todo mês". Abre em "Hoje" se a Meta já liberou o dia; senão em "Ontem". "Hoje" sem dados: "A Meta libera as views do dia com algumas horas de atraso — o número aparece ao longo do dia." "Este mês" mostra "Mês anterior: N".
5. **Quatro cards:** "Visualizações Hoje" (compacto k/M, "Total: X") · "Vídeos Publicados" (valor principal = **total** publicado; embaixo "Hoje / Ontem: a / b") · "Contas Ativas Hoje" ("Com health OK: N total conectadas") · "Posts na Fila" ("Aguardando: publicação").
6. **"Contas Adicionadas":** destaque = novas em 7 dias ("novas em 7 dias"); colunas "Hoje", "Ontem", "7 dias".
7. **"Contas Caídas":** destaque = com erro agora ("com erro agora"); colunas "Hoje", "Ontem", "7 dias" (contas distintas com evento de failover).
8. **"Atividade Recente":** até 5 itens, ícone verde/vermelho, tempo relativo ("agora mesmo", "há N min", "há Nh", "há Nd"). Textos: "Reel baixado de @x", "Postagem agendada para @x", "Postagem publicada em @x", "Falha ao publicar em @x". Botão "Ver tudo" **sem ação**.
9. **"Próximas Postagens":** pílula "N na fila"; botão "Limpar" (só com itens): 1º clique "Confirmar?" (expira em 3,5 s), 2º apaga **toda** a fila pendente do usuário (posts agendados pendentes/publicando e containers pendentes/processando). Lista os 4 próximos: "@conta" + "Hoje às HH:MM" / "Amanhã às HH:MM" / "dd/mm às HH:MM". Linhas com hover, sem ação.
10. **"Ações Rápidas":** "Postar" ("Distribuição de conteúdo"), "Loop" ("Ciclo contínuo"), "Stories" ("Postar e importar").

**Estados:** skeletons em todos os cards na carga; vazios "Nenhuma atividade recente" e "Nenhuma agendada"; sem aviso de erro; atualização silenciosa a cada 60 s.

**Dados que a API já devolve e não aparecem:** posts de hoje (publicados/agendados/loop), contas sincronizadas para views, hora da última sincronização.

---

## 2. Contas (`/dashboard/accounts`)

**Propósito:** gerenciar as contas de postagem: conexão OAuth, saúde, token, proxy, pastas, etiquetas, perfil e fila.

**Blocos**
1. Notificação da página (verde/vermelha, várias linhas, X, não some sozinha).
2. **Cabeçalho:** "Contas do Instagram" + "N conectada(s) · M ativa(s)". Botões: sincronizar tudo (ícone, tooltip "Sincronizar todas as contas", contador "feitas/total"), "Proxies" (importação em massa), "Verificar" (Verificador de Perfis), "Conectar conta" (primário). Em modo seleção, viram as ações em massa.
3. **Abas de pastas:** "Sem Pasta (N)" (primeira e padrão), uma aba por pasta (nome + contador), "Nova Pasta". **Não existe "Todas".** Trocar de aba zera a ordenação. Abas arrastáveis (ordem salva no navegador). Aba ativa tem engrenagem: "Renomear Pasta" / "Excluir Pasta".
4. **Ordenar + seleção** (se a aba tem contas): "↓ Mais seguidores", "↑ Menos seguidores", "⏱ Story expirando" (liga/desliga; padrão: conectadas mais recentemente primeiro). "Selecionar" → modo seleção com "Selecionar todas"/"Desmarcar todas" (aba atual) e "Cancelar"; clicar no card marca; não selecionados ficam esmaecidos.
5. **Ações em massa:** "Sincronizar (N)" ("Sincronizando (x/N)"), "Ativar (N)" (não há desativar em massa), "Mover para pasta (N)" (modal), "Excluir selecionadas (N)" → "Confirmar exclusão (N)" → exclui.
6. **Grade de cards** (1–3 colunas).

**Card de conta**
- Avatar (foto ou gradiente); caída: cinza + selo de Wi-Fi cortado. "@username", "Instagram".
- Badges: "META API", chip de token ("Token expirado"; "Expira em Nd" — vermelho até 7 d, âmbar 8–15 d), "ATIVA"/"INATIVA". Caída: "DESCONECTADA" ou "BLOQUEADA" piscando (somem META API e token).
- Métricas (não caída): idade no SaaS ("hoje", "N dias", "N semanas", "N meses", "N anos"), "N seg.", "N posts", último post ("agora", "Nmin", "Nh atrás", "Nd atrás", data), "sync {tempo}"/"não sincronizado", stories (só Meta: "N story/stories · exp. Xh Ym", "expirando", "0 stories ativos", "stories desatualizados · sincronize"), "proxy ativo"/"sem proxy" (âmbar), nome do App Meta.
- Caída (substitui métricas): "Token inválido — sessão encerrada" ("A sessão desta conta expirou ou a senha foi alterada. Reconecte para voltar a publicar.") ou "Conta bloqueada pela Meta" ("…Acesse o Instagram e siga as instruções de recuperação."). Botão "Reconectar Instagram" ("Reconectando...") — na prática renova o token.
- **Etiquetas:** chips coloridos com X no hover (remove sem confirmação); "+ etiqueta"/"cancelar" abre "Nova etiqueta para @user": campo "Ex: Lote junho" (máx. 32), "OK", 8 cores (vermelho, laranja, amarelo, verde, ciano, azul [padrão], roxo, rosa); Enter salva, Esc fecha.
- **Menu "⋯"** (desabilitado com spinner enquanto ocupada): "Sincronizar" · "Editar Perfil Manual" · "Desativar conta"/"Ativar conta" · "Renovar Token" (só Meta) · "Mover para pasta..." · "Configurar Proxy"/"Editar Proxy" · "Excluir Vídeos Pendentes" (âmbar) · divisor · "Remover Conta" (vermelho, **sem confirmação**).

**Modais**
- **"Conectar Conta":** sem apps → "Nenhum App cadastrado" / "Você precisa cadastrar um App da Meta antes de adicionar uma conta." + "Configurar Meu Primeiro App" (`/dashboard/apps`). Com apps → "Escolha qual App Meta usar para autorizar a conta no Instagram:" + lista (nome + "ID: …"; clicar → OAuth) + "+ Cadastrar novo app".
- **"Nova Pasta":** "Ex: Cliente A, Marca XYZ..." (máx. 50, Enter cria), "Cancelar"/"Criar"; abre a aba nova.
- **"Renomear Pasta":** campo pré-preenchido (máx. 50), "Cancelar"/"Salvar".
- **Excluir pasta:** 'Excluir "{nome}"?' + "N conta(s) dentro desta pasta será(ão) excluída(s) permanentemente. Esta ação não pode ser desfeita." (vazia: "A pasta está vazia. Esta ação não pode ser desfeita.") + "Cancelar"/"Excluir". O servidor apaga as contas da pasta.
- **Excluir vídeos pendentes:** "Excluir vídeos pendentes de @user?" + texto sobre Loop/Postar/Clonar + "Cancelar"/"Excluir".
- **"Mover para pasta"** (individual, "@user"): "Sem pasta" + pastas, marcador "atual", check; sem pastas: "Nenhuma pasta criada. Crie pastas nas abas acima."; "Cancelar"/"Mover" (desabilitado se é a atual). **Em massa** ("N contas selecionadas"): "Cancelar"/"Mover (N)".
- **"Proxy Dedicado"** ("@user"): ajuda varia se já há proxy; campo "URL do Proxy" ("http://user:senha@host:porta", dica "Formatos aceitos: http://, https://, socks5://"); "Remover" (sem confirmação), "Cancelar", "Salvar".
- **"Importar Proxies em Massa":** instruções "Formato: username,http://user:pass@ip:porta" / "Uma conta por linha. Para remover proxy: username," / "Linhas com # são ignoradas."; textarea; resultado por conta ("✓ proxy salvo", "proxy removido", "conta não encontrada", erro); "Importar mais"/"Fechar".
- **"Verificador de Perfis":** "Cole @usuários do Instagram — um por linha ou separados por vírgula." (API Meta, depois consulta pública; "Até 60 por vez"); progresso "Verificando…"/"Concluído" "x/N" em lotes de 15; resultado por perfil (ativo/não encontrado/erro, verificado, privado, "N seguidores" ou mensagem); "Verificar mais"/"Fechar" (bloqueados durante a verificação).
- **"Editar perfil — @user"** (rascunho manual): "Foto sugerida" ("Enviar foto", "Baixar p/ celular"), "Bio sugerida" (contador "N/150", "Copiar bio"), "Link da bio" ("Copiar link"), "Marcado sincronizado em …"; rodapé "Salvar rascunho", "Abrir IG", "Marcar sincronizado".
- **MagicLinkModal:** montado, mas nenhum botão o abre (inacessível hoje).

**Estados:** 3 skeletons na 1ª carga. Vazios: "Nenhuma conta conectada" + "Conectar primeira conta"; "Pasta vazia" / "Mova contas para esta pasta usando o menu ⋯ em cada conta."; "Tudo organizado" / "Todas as contas estão dentro de uma pasta…". Automático: sincronização silenciosa em lotes ao abrir; renova tokens que vencem em até 14 dias ("N token(s) Meta renovado(s) automaticamente."); recarrega a cada 60 s. Mensagens do OAuth (URL): "N conta(s) conectada(s) com sucesso!", "Conexão cancelada. Nenhuma conta foi adicionada.", "Erro de segurança (state inválido)…", "Código de autorização ausente…", "Erro retornado pela Meta API: …", "Conta pessoal detectada. Converta para Comercial ou Criador…", "Limite de requisições da Meta API atingido…", "Ocorreu um erro ao conectar. Tente novamente." Mensagens de sincronizar tudo, proxy, fila, exclusão, ativação e movimentação (ver código).

---

## 3. Contas leitoras (`/dashboard/contas-leitoras`)

**Propósito:** contas só para raspagem (usuário, senha, 2FA, proxy), isoladas das de postagem.

- Cabeçalho "Contas Leitoras" + "Contas dedicadas à raspagem de conteúdo — isoladas das contas de postagem." + "Nova conta leitora" (abre/fecha formulário).
- Aviso: só leem conteúdo, nunca postam; precisam de proxy dedicado; perfis privados só se a leitora já os seguir.
- Banner de erro com ✕.
- **Formulário:** "Usuário" ("nome_da_conta_leitora"), "Senha", "Chave 2FA (TOTP) — opcional", "Proxy dedicado" ("user:pass@host:porta"); "Cancelar"/"Adicionar" ("Salvando..."); "Usuário e senha são obrigatórios."
- **Card:** ponto de cor + "@username" + status "Conectada"/"Erro"/"Não conectada"/"conectando…"; badges "proxy"/"sem proxy" (âmbar), "2FA", "N seg."; conectando: "Na fila: a conexão começa em até 5 minutos." ou "Falhou, nova tentativa às HH:MM (ou em breve): {erro}"; caixa de último erro (até 160 caracteres); "última raspagem: {tempo}". Ações: "Conectar"/"Revalidar" (desabilitado sem proxy, tooltip "Configure um proxy primeiro"); globo → modal de credenciais; lixeira → "Confirmar" por 3 s.
- **Modal "Atualizar credenciais":** "Deixe em branco o que não quiser alterar. Trocar a senha reinicia a sessão salva."; "Proxy — user:pass@host:porta", "Nova senha", "Nova chave 2FA (TOTP)"; "Cancelar"/"Salvar".
- Estados: 3 skeletons; vazio "Nenhuma conta leitora ainda" / "Adicione uma conta dedicada + proxy para raspar reels completos de qualquer perfil nas Inspirações."; polling a cada 8 s enquanto alguma conecta; 401 → login.

---

## 4. Proxies (`/dashboard/proxy-test`)

**Propósito:** estoque de proxies com atribuição automática e teste do IP real de cada conta.

- Título "Proxies" / "Estoque com atribuição automática e verificação do IP real de cada conta."
- **"Estoque de Proxies":** explicação do ciclo (atribuído na conexão, volta "livre", testado antes de reatribuir, descartado se morto); "Adicionar"/"Fechar"; contadores "Total", "Livres", "Em uso"; aviso inline (some em 6 s); textarea ("Um proxy por linha — ip:porta:usuario:senha / usuario:senha@ip:porta / http://usuario:senha@ip:porta / ip:porta") + "Adicionar ao estoque" → "N adicionado(s) · N duplicado(s) ignorado(s) · N inválido(s)."; ações "Atribuir às contas sem proxy" e "Trocar proxies com falha" (com resultados); lista rolável (ponto livre/em uso, proxy mascarado, "livre" ou "@conta", lixeira só nos livres, sem confirmação); "Carregando estoque..."; vazio "Estoque vazio — adicione proxies…".
- **"Verificar IPs":** cada conta ativa consulta api.ipify.org pelo próprio proxy; "Verificar IPs" → "Verificando contas..." → "Verificar novamente". Resumo "N IPs únicos — cada conta tem seu próprio proxy." ou alerta "N IP(s) único(s) entre M contas verificadas."; tabela "Conta" | "Session ID" | "IP detectado" (ponto verde/vermelho, badge de origem "dedicado"/"nenhum"); rodapé explicativo; vazio "Nenhuma conta ativa encontrada."

---

## 5. Failover (`/dashboard/failover`)

**Propósito:** ordem de prioridade para a troca automática, restaurar contas caídas, histórico e diagnóstico.

- Cabeçalho "Failover de Contas" / "Redundância automática — quando uma conta falha, a próxima assume." + "Atualizar".
- Abas "Failover" (padrão) | "Diagnóstico" (carrega na 1ª abertura). Banner de erro (inclui "Não foi possível salvar a nova ordem. Tente novamente.").
- **Aba Failover:** banner de limpeza "N conta(s) com erro ainda dentro dos loops" + "Remover dos loops" → "Confirmar remoção"/"Cancelar"; chips "N online", "N com erro", "N bloqueada", "Salvando ordem…"; **"Grupo de Failover"** (setas ↑/↓ salvam a cada clique; "PRINCIPAL"/"RESERVA N"; status "Online"/"Erro"/"Bloqueada"; "Restaurar" nas não online, sem confirmação); **"Histórico de Failover"** (últimos 50: "@caída → @reserva (assumiu)", "sem backup", "conta removida", motivo até 80 caracteres, tempo); caixa informativa. Vazios: "Nenhuma conta conectada."; "Nenhum evento de failover registrado." / "Isso é ótimo — significa que suas contas estão saudáveis."
- **Aba Diagnóstico:** cards "Quedas 7d", "Em erro", "Online", "Token expirando", "Pico/hora" (laranja em cascata); alerta "Queda em cascata detectada"; "Tipo de Erro (7 dias)" (categorias "Token Inválido/Expirado", "Conta Bloqueada/Restrita", "Rate Limit Meta", "Conta Pessoal (sem API)", "Erro Transitório", "Erro Desconhecido"; "N× (P%)" + barra); "Quedas por Hora (48h)" (36 barras, tooltip, laranja = 4+ na mesma hora, horário UTC); "Contas em Erro (N)"; "Mensagens de Erro Mais Frequentes" (top 5); "Tokens Expirando em Breve" (até 7 dias). Vazio: "Nenhum dado de diagnóstico disponível."

---

## 6. Seletores compartilhados (Postar, Loop, Clonar)

- **CaptionModeSelector:** "Original" ("Usa a legenda capturada junto do Reel.") · "Personalizada" ("Use sua própria legenda.", padrão no Postar/Loop) · "Sem legenda" ("Publica sem texto na descrição."). No Original: aviso âmbar (texto próprio por página) + "Ajustes na legenda original": "Remover hashtags" ("Tira #tags do texto. Funciona com acento e outros alfabetos (#ação, #日本語).") e "Remover @menções" ("Tira @perfis do texto — inclusive créditos ao criador original.") + nota "Desligados, a legenda vai exatamente como estava no Reel original."
- **ReelPlacementSelector:** "Escolha onde o Reel ficará visível no Instagram." · "Reels + grade" (selo "RECOM.", padrão: "Exibe o Reel na grade/feed do perfil e também na aba Reels.") · "Somente Reels" ("Exibe o conteúdo apenas na aba Reels do perfil.").
- **VideoProcessingSelector:** "Escolha como o arquivo será preparado antes da publicação." · "Sem limpeza" ("RECOM.", padrão: "Envia o vídeo original exatamente como está armazenado. Sem FFmpeg, remux ou alteração de qualidade.") · "Limpeza de metadados" ("Cria uma versão limpa do arquivo usando stream copy, sem reencodar vídeo ou áudio.").
- Biblioteca de legendas salvas compartilhada entre Postar e Loop.
- Limites de legenda (`lib/reel-captions.ts`): 2200 caracteres, 30 hashtags, 20 menções.

---

## 7. Postar (`/dashboard/postar`)

**Propósito:** distribuir os vídeos de uma pasta para várias contas (ordem aleatória por conta), agendado ao longo dos dias ou imediato ("Modo Ciclo"), e acompanhar as campanhas.

- H1 "Distribuição de Conteúdo" / "Distribua vídeos de uma pasta para múltiplas contas com ordem aleatória única por conta". Abas "Nova Distribuição" (padrão) | "Campanhas Ativas".

**Nova distribuição** — coluna esquerda: 1 Contas → 2 Pasta de Mídia → 3 Cadência → 4 Legenda → 5 Exibição do Reel → 6 Processamento → erro → envio. Coluna direita (fixa ao rolar): "Resumo" e "Como funciona".
1. **Contas:** "Todas" · "Nenhuma" · "Novas (N)" (vermelho; contas sem campanha em execução; só aparece se há dos dois tipos). Acordeão por pasta (fechado, alfabético, "Sem pasta" por último): nome, "(N)", "· N sel.", "selecionar"/"desmarcar", "todas as pastas". Chips "@usuario" com check; sem campanha rodando = borda/ponto vermelhos. Só contas ativas. "N conta(s) selecionada(s)". Toggle "Sincronizar com a pasta" ("Contas adicionadas depois em {pastas} entram na fila sozinhas"; só com pasta 100% selecionada). Vazios: "Carregando contas..." / "Nenhuma conta conectada. Conectar conta".
2. **Pasta de Mídia:** dropdown "Selecionar pasta..." ("{nome} · N vídeos"); vazio "Nenhuma pasta criada. Criar pasta". "Quantos vídeos postar": "10" | "20" (padrão) | "50" | "Todos" (maiores que a pasta desabilitadas) + dica "Todos os N vídeos da pasta serão usados"/"X de N vídeos serão usados". Em Modo Ciclo vira o aviso "Modo Ciclo ativo — quantidade definida na seção Cadência…".
3. **Cadência:** toggle "Modo Ciclo" ("Cada conta posta seu lote de vídeos de uma vez, uma conta após a outra"; ao ligar, "Todos" ou >50 vira 5). **Ligado:** "Quantos vídeos por conta" 1 | 3 | 5 | 10 | 20 + "Outro" (1–999); aviso "A pasta tem só N vídeos — cada conta receberá N."; "Ordem de distribuição": "Mais visualizados" (padrão: "Prioriza os Reels com mais views da origem e varia a atribuição entre contas."), "Menor uso" ("Distribui primeiro os vídeos menos usados historicamente (comportamento anterior)."), "Aleatório" ("Sorteia os vídeos sem considerar views nem histórico."); texto explicativo do ciclo. **Desligado:** "Posts por dia por conta" 1, 2 (padrão), 3, 4, 6, 8, 12, 24, 36, 48, 72 (cada botão mostra o intervalo, tooltip "Intervalo: ~X entre posts"); "Data e hora do primeiro post" (mínimo agora + 5 min). **Sempre:** "Intervalo entre contas" slider 0–300 s de 5 em 5 ("Auto" … "5 min"; valor "Automático" ou "{N}s"; textos auxiliares por caso). Frase-resumo "X vídeos × Y contas = Z posts ao longo de D dias…" (ou a versão do Ciclo).
4. **Legenda:** seletor de modo (aviso do Original: "Cada vídeo usará a legenda capturada junto do próprio Reel. Vídeos sem legenda original serão publicados sem legenda."). Só em Personalizada: toggle "Legendas Automáticas" ("Curiosidades únicas em PT-BR por post"; mostra "Exemplo (cada post recebe uma legenda diferente)"). Personalizada sem automática → editor: 2 caixas ("Legenda 1...", "Legenda 2...", etiqueta "#n"); contadores "n/2200", "n/30 #", "n/20 @" (amarelo >90%, vermelho acima; **não corta**); lixeira (com >1); "Salvar esta legenda para usar depois" → "Nome da legenda (opcional)...", "Salvar", X (Enter/Esc) → "Salva na biblioteca!" 2,5 s; "Adicionar Legenda"; "Usar Salva" (selo de contagem) → popover "Biblioteca de Legendas" ("Carregando...", vazio "Nenhuma legenda salva ainda.", item com título, 2 linhas, "Clique para usar", lixeira sem confirmação); "Legendas sorteadas aleatoriamente em cada post".
5–6. **Exibição do Reel** e **Processamento do vídeo** (seletores).
- **Envio:** "Criar Distribuição" (Ciclo: "Postar Tudo Agora") + "(N posts · N contas)"; "Criando distribuição..."/"Postando agora...". Erros: "Selecione ao menos 1 conta.", "Selecione uma pasta de mídia.", "A pasta selecionada está vazia.", "Defina a data e hora de início.", mensagem da API/"Erro ao criar distribuição.", "Erro de conexão. Tente novamente." Sucesso: vai para "Campanhas Ativas" + banner "N posts criados — X vídeos por conta em D dia(s) · Início: {data}".
- **Resumo:** vazio "Preencha os campos para ver o resumo"; "Vídeos/conta", "Contas", "Total de posts", "Duração", "Posts/dia", "Legendas", "Início", "Fim estimado", nota de ordem aleatória, "Horários por conta (Conta 1)" (até 6 + "+ N slots restantes..."). **Como funciona:** 3 frases (ordem aleatória por conta; posts distribuídos ao longo do dia; "Stagger automático entre contas — sem burst simultâneo" ou "{N}s de stagger entre contas").
- Após criar, zera contas, pasta, data, quantidade (20), posts/dia (2), legendas, intervalo, Modo Ciclo e sincronização; **mantém** modo de legenda, remoções, legenda automática, exibição, processamento e ordem. "Ordem de distribuição" é sempre enviada (padrão "Mais visualizados").

**Campanhas ativas:** topo "{N} executando" (ponto pulsando), "{N} campanha(s)", "Atualizar"/"Atualizando…". Só campanhas do Postar. Card: "#ID" (8 caracteres) e "Criada {data}"; selo "Sincronizada"; status "Concluída" | "Atrasada" | "Publicando" | "Na Fila"; lápis "Editar legendas e cadência" → modal; lixeira em 2 cliques (exclusão definitiva); progresso "X de Y posts publicados" + % + barra (vermelha se concluída com falhas); "Fila", "Falhas", "Cancelados"; "Engagement por conta" recolhível ("{N} views totais"; posição, avatar, @usuario, views, likes, comentários; "Sincronizando métricas…"); "Último publicado"; "Próximo" ("em Xs/min/h", "aguardando cron") ou "Encerrada em {data}"; aviso "Post atrasado — o cron publicará na próxima execução (≤1 min)"; último erro expansível; até 6 avatares + "+N". Vazio "Nenhuma campanha encontrada" / "Crie sua primeira distribuição" + "Nova Distribuição". Recarrega a cada 15 s com campanha running; tempos relativos a cada 10 s.

**Modal "Editar campanha":** "Carregando configuração atual..."; aviso de abrangência (sem pendentes vs "N posts pendentes"); "Posts por dia por conta" (botões + campo 1–1440); "Intervalo entre contas"; "Legendas Automáticas"; desligado: caixa "Uma legenda por linha... Sorteada aleatoriamente em cada post."; erros "Informe ao menos uma legenda.", "Posts por dia deve ser entre 1 e 1440.", "Erro ao salvar edição.", "Não foi possível carregar a configuração atual."; "Salvar edição"/"Cancelar".

---

## 8. Agendamento em massa (`/dashboard/posts`, hoje fora do menu)

- "Agendamento em Massa" / "Distribua vídeos para múltiplas contas em lotes automáticos e embaralhados". Passos com check quando completos:
  1. "Selecionar Vídeos" ("N selecionado(s)", "Todos", "Limpar"; grade 9:16 com gradiente, duração, "@dono"; vazio "Nenhum vídeo na biblioteca." + "Ir para a Biblioteca →").
  2. "Selecionar Contas" ("Todas", "Limpar"; avatar, "@usuario", "N seg."; vazio "Nenhuma conta ativa conectada." + "Conectar contas →").
  3. "Variações de Legenda" ("Legenda principal (obrigatória)..." / "Variação N..."; "n/2200"; X; "Adicionar Variação de Legenda" até 10).
  4. "Configurações de Lote": "Data e Hora de Início" (padrão próxima hora cheia), "Vídeos por Lote" (1–20, padrão 3), "Intervalo entre Lotes (h)" (passo 0,5, padrão 3); prévia "N posts no total", "N lote(s) por conta", "início em…", "último lote em…".
- Barra fixa: resumo ou "Selecione vídeos e contas para começar"; erro; "Agendar N Posts"/"Agendando...". Sucesso: "N posts agendados!", resumo, "Agendar Mais", "Ver Agendamentos".

## 9. Agendamentos (`/dashboard/schedule`, hoje fora do menu)

- "Agendamentos" + "{N} total · {N} pendente(s) · {N} publicado(s) · {N} com falha"; "Novo agendamento" (→ em massa).
- Abas com contagem (zeradas escondidas, menos "Todos"): "Todos", "Pendentes", "Publicando", "Publicados", "Com falha", "Cancelados".
- Linha: retângulo 9:16 colorido, "@usuario", legenda, status ("Pendente", "Publicando...", "Publicado", "Falha", "Cancelado"), data, "em X"/"em instantes"/"vencido", "publicado X atrás", "#{media_id}", caixa de erro.
- Ações (sem confirmação): Pendente → "Cancelar"; Falha → "Reagendar" e "Remover"; Cancelado/Publicado → "Remover".
- Vazios por aba; recarrega a cada 15 s enquanto há "Publicando". Lista inclui posts do Postar, em massa e Stories.

---

## 10. Loop (`/dashboard/loop`)

- H1 "Loop" + "Publique em ciclo automático a partir das suas pastas" ou "{N} ativo(s) · {M} loop(s) total"; "Novo Loop".
- **Card:** nome, pasta, "Ativo"/"Pausado"; alerta "Não está postando. {motivo}"; "Infinito"/"N ciclo(s)", intervalo, ícones de efeitos; contas (modo pasta: chip "{pasta}" + "AUTO" + "novas contas entram automaticamente"; modo específico: até 5 chips + "+N", vermelhos se erro/bloqueada com tooltip); ações "Pausar"/"Retomar" (otimista; falha → alerta), "Editar", "Analytics", lixeira (**sem confirmação**).
- **Painel Analytics:** "Progresso da Fila" ("X/Y posts", "(Nv × Nc)", barra verde/vermelha, "N publicado(s)", "N erro(s)", "N em fila", "N restante(s)"); "Views", "Curtidas", "Comentários" ou "Insights ainda sendo coletados…"; "Ranking do loop" com ordenação "Views" | "Média/vídeo" | "Curtidas" (coroa no 1º, "@usuario", "{N} seguidores · N vídeo(s) do loop", valor ou "sem posts"/"sincronizando…").
- **Modal "Novo Loop"/"Editar Loop":** 1 "Identificação" (nome, máx. 80) · 2 "Contas do Instagram" ("Pasta de contas" | "Contas específicas", com todos os textos e grupos por pasta) · 3 "Pasta da Biblioteca" · 4 "Quantidade de mídias por ciclo" ("Toda a pasta" | 5 | 10 | 20 | "Personalizado" 1–999) · 5 "Ciclos" ("Loop infinito" ou quantidade) · 6 "Intervalo entre postagens" (10 min–24 h, padrão 30 min) · 7 "Intervalo entre contas" (0–300 s) · 8 "Legendas Dinâmicas" (automáticas ou variações; corta em 2200; "Usar Salva") · 9 "Capa do Reel (opcional)" (JPG/PNG/WEBP; "Trocar"/"Remover") · 10 "Legenda" (modo) · 11 "Exibição do Reel" · 12 "Ordem de distribuição" · 13 "Processamento do vídeo" · 14 "Efeitos Criativos" ("Espelhar", "Inverter cores", "Zoom Sutil (+15%)", "Desfoque Leve", "Grão Digital", "Anti-IA" — único ligado por padrão). Rodapé "Cancelar" / "Criar Loop" / "Salvar alterações". Erros de validação.
- Estados: 3 skeletons; vazio "Nenhum loop configurado" + "Criar primeiro Loop". Clique no fundo do modal fecha e descarta.

## 11. Stories (`/dashboard/stories`)

- H1 "Postagem de Stories" + selo "STORIES" + "Suba uma foto ou vídeo e publique como Story agora — expira em 24h".
- Coluna esquerda: **Mídia** (upload por clique/arraste, "JPG, PNG, MP4 (máx. 60s)", prévia 9:16 com "MP4"/"IMG", duração, tamanho, "Enviando…", erro, check; erros de upload listados no código; sub-bloco "Biblioteca — mídias já enviadas antes" com seleção e lixeira sem confirmação) → **Modelo** (obrigatório: chips de pastas de contas + "Sem pasta"; aviso "Escolha um modelo. Só as contas dele podem postar…") → **Contas** ("Sem story", "Todas", "Limpar", recarregar "Verificar stories ativos agora"; "N com story ativo" / "N sem story"; anel nas contas com story) → **Link do Story** (opcional, http(s)) → nota "Stories não suportam legendas pela API…" → "Publicar Story"/"Publicando..."/"Aguardando upload..." → **Templates de Story** ("Importar do IG"; card com miniatura, "Ativo"/"Pausado", "De @{origem} → N conta(s)", "A cada {N}h · último {tempo}", erro, "Pausar"/"Retomar", lixeira sem confirmação).
- Modal "Importar Template de Story" (2 passos: escolher conta com story ativo → "Repostar para" + "Repostar a cada" 12h | 18h | 23h → "Criar Loop").
- Coluna direita: **Histórico** ("N ok", "N em fila", recarregar, "Limpar tudo" → "Confirmar" 3 s; item com tipo, "@usuario", status "Publicado" | "Na fila" | "Publicando" | "Falhou" | "Cancelado", tempo, "ID: …", erro, lixeira sem confirmação). Recarrega a cada 15 s com itens em fila.

## 12. Fila (`/dashboard/queue`, hoje fora do menu)

- "Status da Fila", ponto "ao vivo", "Atualizado às HH:MM:SS · auto em Ns" (15 s); "Atualizar", "Diagnóstico", "Forçar Processamento" (sem confirmação).
- Cards: "Total do batch" (1h), "Postados" (1h), "Na fila", "Processando", "Erros" (24h).
- Painel "Diagnóstico da Fila" (valores "Pending total", "Elegíveis agora", "Data futura", "Em publicação", "Containers pendentes", "Falhas acumuladas"; alertas; "Últimas falhas").
- Painel "Resultado do Processamento" ("Processando fila... aguarde até 55s"; blocos "Postagens agendadas", "Containers de loop", "Motor de loops").
- "Postados recentemente" (1h, máx. 25), "Contas fora da fila", "Gerenciamento por conta" (pendentes/postados/erros; botão "Cancelar fila" desabilitado "Funcionalidade em breve"). Vazio "Fila vazia".

## 13. Publicados (`/dashboard/publicados`)

- "Publicados" + "Histórico completo de todas as publicações realizadas"; "Atualizar".
- Filtros: conta (popover "Selecionar conta", recarrega do servidor), tipo "Todos" | "Stories" | "Reels", busca "Buscar por conta, legenda ou ID...", "Limpar filtros", "Mostrando N de M publicações".
- Tabela: "Publicado em", "Conta", "Tipo" ("STORY"/"REEL"), "Views", "Alcance", "Likes", "Comentários", "Compartilh.", "Legenda" (colunas aparecem conforme a largura). Rodapé com totais de views e alcance. Até 1000 itens, sem paginação, sem ações por linha.

---

## 14. Inspirações (`/dashboard/inspirations`)

**Propósito:** raspar Reels de perfis públicos (Apify ou conta leitora), manter histórico, salvar na Biblioteca (com legenda) ou baixar (sem legenda).

- Cabeçalho "Inspirações e Scraper" / "Encontre conteúdos virais para modelar e adicionar à sua biblioteca."
- **Busca:** "Buscar inspirações no Instagram"; fonte "Apify" (padrão) | "Conta dedicada" (sem leitoras: link "Cadastre uma conta leitora"; com leitoras: select "Escolha a conta leitora…" com sufixos "(sem proxy)", "(com erro)", "(não conectada)" — desabilitadas sem proxy/erro — e quantidade "Todos os reels" (padrão), "Até 120", "Até 300", "Até 600", "Até 1200"); campo "@" + "nome_do_perfil" (Enter busca); "Buscar Reels"/"Buscando...".
- **Modal de importação** (bloqueante): "Importando @x", "Buscando todos os vídeos via {fonte}...", barra "Progresso", passos "Buscando posts via {fonte}", "Processando dados dos vídeos", "Salvando no histórico" (Apify até 5 min, depois continua no servidor; conta dedicada até 15 min).
- **Buscas em segundo plano:** "Buscando @a, @b em segundo plano." + "Pode sair da página — o resultado é salvo no histórico sozinho…" (polling 15 s; 5 s durante a busca).
- **Buscas que falharam** (24h): "@x: {erro}" + "✕" ("Dispensar este aviso", gravado no servidor); "Dispensar todos ({n})".
- **Recuperar buscas** (só admin, modo Histórico): "Recuperar buscas perdidas"/"Recuperando…" + resultado.
- Toast de erro com ✕.
- **Modo Histórico:** "Histórico de pesquisas ({n})"; card com avatar, "@perfil", nome, "{n} reels", tempo, "Ver Reels", lixeira (sem confirmação). Vazio: faixa + "Preview — aguardando busca" com 6 cards fictícios.
- **Modo Grade:** "Voltar", "{n} Reels encontrados" / "de @x"; "Salvar em:" + select de pasta (âmbar vazio; única pasta é escolhida sozinha; sem pastas: "Crie uma pasta na Biblioteca"); "Salvar todos na Biblioteca" (progresso "Salvando X de Y...", "Renovando URLs X de Y..."); "Baixar todos" ("Baixando X de Y..."); "Ordenar": "Mais vistos" (padrão), "Mais curtidos", "Mais comentados", "Mais longos"; faixas de resultado; grade 2–6 colunas; vazio "Nenhum Reel encontrado para @x" + "Voltar e buscar outro perfil".
- **Card de Reel:** thumbnail, "@dono", "m:ss", play, legenda (2 linhas); hover: "Views", "Curtidas", "Comentários", legenda (3 linhas); sem URL: "URL não disponível" + "Re-buscar URL do vídeo"; botão principal "Escolha uma pasta" / "Salvar na Biblioteca" / "Salvando..." / "Na Biblioteca" / "Tentar de novo" (+ mensagem); secundário "Baixar no dispositivo" / "Baixando..." / "Download concluído!" / "Tentar novamente" / "Re-buscar URL do vídeo"; "Ver legenda"/"Ocultar legenda".

## 15. Clonar (`/dashboard/clone`, hoje fora do menu)

- "Clonar Perfil" / "Puxe Reels de um perfil e agende direto nas suas contas — sem passar pela Biblioteca."
- Busca "@username ou nome do perfil..." + "Pesquisar"/"Buscando…" ("Raspando Reels de @x…", até 500 reels, retomada ao recarregar; erros listados no código).
- "Perfis Salvos" (navegador, máx. 20; chip com "@x", seguidores, reels, "×").
- Esquerda: card do perfil (baixar foto no hover, nome, bio, "Salvar"/"Salvo"); métricas "Seguidores", "Reels", "Views (avg)", "Likes (avg)", "Engajamento"; carregando/vazio.
- Direita: "Quantidade de posts" (10 | 20 | 50 | 100 | Todos), "Posts por dia" (1, 2, 3 [padrão], 4, 6, 8, 12, 24, 48), "Data e hora de início", "Legendas Automáticas", "Legenda" (Original [padrão] | Personalizada | Sem legenda + ajustes), "Exibição do Reel", "Processamento do vídeo", "Contas de destino" (por pasta, só ativas sem erro), "Resumo", botão com estados ("Clonar Perfil ({n} posts)" etc.), conclusão "Agendamentos criados!" + "Ver Monitor"/"Fechar".
- "Histórico de Clones" (polling 30 s com pendentes): status "Ativo" | "Cancelado" | "Concluído", progresso, contas, números; "Cancelar" → "Confirmar cancelamento"; "Excluir" → "Tem certeza?" "Sim"/"Não".

## 16. Biblioteca (`/dashboard/library`)

- Barra: caminho "Biblioteca" › {pasta}; resultado de exclusão; "Limpar Registros Quebrados" (2 cliques; "Nada a limpar"/"{n} registro(s)"); "Nova Pasta".
- Raiz: "Pastas de mídia"; card com nome e "Vazia"/"{n} vídeo(s)"; hover: renomear, excluir. Vazio "Nenhuma pasta criada" + "Criar primeira pasta".
- Pasta: upload por arraste/clique ("Arraste vídeos aqui ou clique para selecionar"; MP4, MOV, WebM, AVI, MKV; vários); fila de upload ("Na fila", "%", "Concluído", "Erro", "Ignorado" — "Já existe na biblioteca. Ignorado."); "{n} vídeos carregados" (" (mais disponíveis)"), "Selecionar todos"; "Carregar mais"; vazio da pasta.
- Card de vídeo: prévia que toca no hover, seleção, chip "legenda" (abre o texto), "@dono", duração, legenda/nome, views, likes, tamanho; hover: "Postar agora", "Agendar" (→ `/dashboard/schedule?videoId=…`), "Mover", "Excluir" (**sem confirmação**).
- Modal "Postar agora": contas (Meta já marcadas; sem Meta: "Reconecte para postar"), legenda (Original/Personalizada/Sem legenda), "Postar agora" → resultado por conta.
- Modais "Nova Pasta", "Renomear Pasta", "Mover vídeo"/"Mover {n} vídeo(s)", "Excluir pasta e vídeos" (aviso de loops pausados e campanhas desligadas).
- Barra flutuante de seleção: "{n} vídeo(s) selecionado(s)", "Cancelar", "Mover {n}", "Excluir {n}" (**sem confirmação**).

## 17. Monitor (`/dashboard/monitor`)

- "Monitor de Postagens" / "Acompanhe loops e campanhas em tempo real". Abas "Loop" | "Campanhas". "Atualizado HH:MM:SS · auto em {n}s" + "Atualizar" (15 s).
- "Linha do Tempo" (6h atrás → agora → próximas 3h; "Publicado"/"Agendado") e "Próximas na fila" (até 12 + "+N mais").
- Loop: cards "Publicados" (24h), "Na fila", "Erros" (24h), "Próxima postagem", "Loops ativos"; filtros "Todas", "Publicado", "Aguardando", "Erro"; contas agrupadas por loop; card com status, último/próximo, erro expansível, "Tentativa #{n}".
- Campanhas: cards de operação e engajamento; filtros "Todas", "Na Fila", "Atrasadas", "Com Erros", "Concluídas"; card de conta com progresso e métricas. Somente leitura.

## 18. Analytics (`/dashboard/analytics`)

- "Analytics" / "Desempenho e crescimento das contas automatizadas" + "Sincronizar dados".
- Abas "Relatório do Chefe" | "Posts Publicados".
- Relatório: escopo ("Todas as contas (N)", pastas, contas); "Seguidores", "Crescimento", "Posts Automáticos", "Alcance Total"; "Crescimento de Seguidores" (área; "Coletando dados..." + "Iniciar coleta de dados"); "Posts Automáticos por Dia" (barras); "Top 3 Vídeos Mais Vistos"; "Seguidores por Conta".
- Posts: "{n} posts publicados" + "Atualizar todos"; 7 cards ("Publicados", "Curtidas", "Comentários", "Alcance", "Plays", "Shares", "Salvos"); aviso de permissão instagram_manage_insights; linha por post com 6 métricas e "Atualizar".

## 19. Meu App (`/dashboard/apps`)

- "Meus Apps Meta" + "Novo App". Abas "Meus Apps" | "Como configurar".
- Tabela "Nome do App", "IG App ID" (mascarado, revelar, "Copiar"), "App Secret" ("••••", "cifrado"), "Ações" (editar; excluir com "Confirmar"/"Cancelar"). Vazio "Nenhum app cadastrado".
- Modal "Cadastrar Novo App"/"Editar App": "URL de Callback" + "Copiar", "Nome do App *", "Instagram App ID *", "App Secret" ("(vazio = mantém atual)", olho).
- "Como configurar": passos 01–06 com link "Abrir Meta Developers" e URL de callback.

## 20. Configurações (`/dashboard/settings`)

- "Foto e Perfil" (avatar "Alterar foto", JPG/PNG/WebP até 5 MB; "Nome Completo", "Nome de Exibição", "Nome de Usuário", "Telefone", "E-mail (somente leitura)"; "Salvar Perfil").
- "Segurança" (2 etapas: nova senha com medidor → código de 6 dígitos por e-mail, "Reenviar em {n}s", "Confirmar Alteração").
- "Dispositivos e Sessões" (lista com navegador/SO, "ESTA SESSÃO", local, IP, datas; "Selecionar", "Deslogar selecionados", "Revogar todos os outros", "Deslogar de todos" com confirmações).
- "Notificações" (push: ativar/desativar, avisos de suporte/iPhone; "Alertas automáticos": "Queda de contas", "Notificações de vendas", "Lucro diário" (admin, horário), "Meta de views do dia" (número + horário)).
- "Integrações" (links de webhook ApexVips e SharkBot com "Copiar").

## 21. Admin (`/admin/*`)

- Moldura própria: sidebar fixa 240px **sem versão mobile**, "Scale Master / Admin Panel", itens "Visão Geral", "Usuários", "Contas Conectadas", "Notificações", "Logs", "Suporte" (nenhum destacado como ativo); rodapé "Voltar ao Dashboard" + e-mail.
- Visão Geral: indicadores de usuários (aprovados/pendentes/banidos), contas Meta, posts pendentes/publicados; "Crescimento de usuários"; "Vendas" (hoje/7d/30d/total + tabela); "Central de Avisos" ("Disparar Aviso", "Limpar" sem confirmação).
- Usuários: tabela com status, cargo, contas Meta (modal), mensagem do pendente; ações "Aprovar", "Reprovar", "Desbanir", "Admin", "Rebaixar", "Banir", "Pausar Acesso", "Acessar como" (2 cliques nas sensíveis).
- Contas Conectadas: alertas de token; sanfona por usuário; "Revogar" (2 cliques).
- Notificações: destinatário, título (100), mensagem (500), link; "Disparar"; histórico.
- Logs: últimos 100 eventos (rótulos listados no código). Suporte: provisório, "Em breve".

## 22. Login, cadastro e status

- **Login:** "Bem-vindo de volta"; "E-mail ou nome de usuário"; "Senha" (olho); "Esqueceu a senha?" → `/auth/forgot-password` (**rota não existe**); "Entrar"; "Continuar com Google"; "Criar gratuitamente"; erros "Usuário não encontrado…" e "E-mail/username ou senha incorretos."; logado → `/dashboard`.
- **Cadastro:** "Criar conta grátis" / "14 dias grátis. Sem cartão de crédito."; "Nome completo", "E-mail", "Senha" + checklist visual; "Termos de Serviço"/"Política de Privacidade" (apontam para "#"); "Entrar agora"; após cadastro → `/pending`.
- **Pendente:** "Conta em análise", "Aguardando aprovação", "Mensagem para o Admin (opcional)" (até 500) + "Enviar mensagem"/"Editar mensagem", "Verificar aprovação", "Sair da conta".
- **Banido:** carregamento, logout, volta para "/".
- **Conta conectada (`/add/success`):** "Conta conectada!" / "Sua conta do Instagram foi vinculada com sucesso. Você já pode fechar esta aba."

## 23. Landing atual (`/`)

- Nav: "Recursos", "Como funciona" (só desktop), "Entrar", "Começar". Hero: selo "Automação de Instagram em escala real", "Publique em dezenas de contas. Sem cair, sem repetir.", "Criar conta", "Ver recursos", mockup. Recursos (6 cards). "Três passos até o piloto automático". CTA final. Rodapé "Privacidade"/"Termos" ("#"). Sem preços. **Será substituída pela landing nova da referência.**

---

## Achados do levantamento (fora do escopo do redesign — listar no PR, não corrigir em silêncio)

- **Vendas e views da Visão geral são somas globais.** As vendas somam os registros de todos os usuários (sem filtro em `app/api/dashboard/stats/route.ts`), embora cada usuário tenha o próprio link de webhook em Configurações → Integrações. As views vêm de `get_account_views_summary`, cuja versão vigente (`supabase/account_views_periods.sql`) ignora o `p_user_id`. Se houver mais de um cliente, cada um vê os números de todos.
- **`npm test` falha na linha de base:** `scripts/test-reels-and-library.mjs` e `scripts/test-library-integrity.mjs` leem `vercel.json`, que não existe desde a migração para a VPS.
- As contas leitoras guardam senha e chave 2FA (cifradas) — relevante para qualquer texto de marketing do tipo "sem senha salva".
- Abrir a tela de Contas dispara escritas automáticas (renovação de tokens que vencem em até 14 dias e sincronização em lote).

- "Contas Ativas Hoje" conta `health_status = "ok"`, valor que nenhum código grava (o padrão é "online") — provavelmente mostra sempre 0.
- `/auth/forgot-password` não existe, mas o login aponta para ela.
- MagicLinkModal (Contas) está montado e é inacessível.
- `components/schedule/AccountSelector.tsx` e `components/search/*` não são usados.
- "Cancelar fila" (Fila) é placeholder; "Ver tudo" (Visão geral), sino e "Nova postagem" (Header) não fazem nada.
- "Agendar" na Biblioteca leva a `/dashboard/schedule?videoId=…`, que não lê o parâmetro.
- Clonar: "Personalizada" pode ser escolhida sem campo para digitar a legenda.
- Excluir pasta de contas: o servidor apaga as contas, mas a tela só as move para "Sem Pasta" até o refresh.
- Agendamento em massa: data padrão calculada em UTC (pode aparecer 3h adiantada).
- Ações destrutivas sem confirmação: "Remover Conta", remover proxy, excluir loop, excluir vídeo(s) da Biblioteca, itens de histórico (Stories, Inspirações), templates de Story, "Restaurar"/"Aprovar"/"Limpar aviso" no admin, legendas salvas.
