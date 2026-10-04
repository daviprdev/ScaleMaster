# Implementar prioridade por views e migrar o AutoScale para VPS + Supabase

Use este pedido junto do contexto do AutoScale fornecido anteriormente. Execute o trabalho no repositório real, com alterações verificáveis, testes e documentação. Não entregue somente sugestões ou pseudocódigo.

## Resultado desejado e ordem do trabalho

Quero duas entregas separadas, na mesma frente de trabalho:

1. Uma estratégia de publicação que priorize os Reels com mais views da origem e distribua as mídias entre as contas com variedade e controle de coincidências.
2. A migração do SaaS de Vercel + Supabase para VPS + o mesmo Supabase gerenciado.

Primeiro implemente e valide a estratégia; depois prepare e execute a migração de forma controlada. Separe os commits para poder revisar ou reverter cada entrega. A correção geral do worker RPA não faz parte deste pedido.

Antes de editar, confira branch, alterações locais, instruções do repositório e referências remotas. O SaaS está em `main`; o worker standalone fica em `master`. Examine a branch `feat/postar-selecao-ordem-midias` e reaproveite somente o que for compatível, sem substituir a main por uma branch antiga.

## 1. Significado de “mais views primeiro, com ordem aleatória”

Meu fluxo é: importar Reels em Inspirações, salvar numa pasta da Biblioteca e usar essa pasta para criar filas em Postar, Loop ou outra função equivalente.

Quero priorizar os melhores vídeos disponíveis pelo número de views do Reel original. A aleatoriedade serve para variar a atribuição e a sequência entre as contas, e não para colocar toda a pasta num sorteio que ignore views.

Não é possível todas as contas começarem pelo vídeo número 1 e, ao mesmo tempo, cada uma receber uma mídia diferente. A regra correta é:

- Selecionar o conjunto de vídeos de maior prioridade que pode atender aquela rodada, respeitando disponibilidade e histórico.
- Variar de forma reproduzível a atribuição desse conjunto às contas.
- Nas rodadas seguintes, continuar dando preferência aos vídeos mais bem classificados ainda não usados por cada conta no ciclo.
- Não exigir ordem estritamente decrescente de views dentro de cada conta quando isso conflitar com diversidade. A prioridade é do conjunto escolhido; a distribuição entre contas é variada.
- Não permitir que uma conta fique recebendo os vídeos de menor prioridade por sempre aparecer no fim da lista de contas.

Exemplo inicial: dez contas e cem vídeos elegíveis, todos inéditos para elas. A primeira rodada deve distribuir os dez vídeos de maior view, um diferente para cada conta, em atribuição aleatória. Não deve usar dez cópias do mais visto nem sortear dez vídeos quaisquer entre os cem. Depois, cada conta continua recebendo preferencialmente os melhores vídeos que ainda não publicou, respeitando os controles abaixo.

## 2. Regras obrigatórias de distribuição

### 2.1 Escopo e identidade da mídia

- Aplicar a política às filas automáticas baseadas em pasta/seleção, incluindo Postar, Loop, sincronização de novas contas em campanhas e demais criadores/consumidores de fila realmente usados.
- Mapear os chamadores de `posts/distribute`, `posts/schedule`, `clone/create`, `posts/create` e as rotas de Stories antes de afirmar cobertura.
- Publicação manual de uma única mídia não tem ranking a escolher; preserve sua intenção, mas faça-a respeitar as reservas de publicação concorrente aplicáveis.
- Tratar Stories sem views e uploads manuais como mídias sem métrica, com distribuição estável e equilibrada. Não inventar views.
- Considerar a mesma mídia importada duas vezes: quando existir uma identidade confiável da origem, como shortcode/permalink normalizado do mesmo Reel, ela deve compartilhar a regra de não coincidência. Usar fallback documentado quando não houver identidade da origem. Não baixar todos os arquivos novamente só para deduplicar.
- Isolar por usuário/proprietário. Não usar dados de outros clientes para decidir ou expor a fila deste usuário.

### 2.2 Views, ranking e persistência

- Aproveitar `videos_library.views`; validar o caminho da origem até o banco e incluir a métrica nas consultas necessárias.
- Usar as views capturadas na importação, ou posteriormente atualizadas por um fluxo legítimo já existente. Não consultar a Meta/Apify a cada escolha nem introduzir gasto recorrente só para recalcular o ranking.
- Normalizar valores ausentes/inválidos com segurança, preservar valores válidos de `bigint` sem perda silenciosa de precisão e definir desempate estável com aleatoriedade semeada.
- Mídias com views positivas vêm antes das sem métrica entre candidatas igualmente elegíveis. Não excluir mídias sem views permanentemente.
- Persistir a estratégia, sua versão e a semente/estado necessário na campanha/loop. Filas concretas devem salvar a atribuição escolhida; retry, reload ou reinício não podem sortear tudo outra vez.
- As views não devem mudar uma fila já materializada. No Loop, defina quando o ranking pode ser atualizado, preferencialmente na abertura de um novo ciclo; reservas e publicações em andamento permanecem intactas.
- Para novas filas automáticas, usar a estratégia de prioridade por views com diversidade como padrão e mostrar um rótulo claro na UI.
- Preservar as filas já existentes e sua ordem. Não reordenar silenciosamente campanhas em produção nem repopular filas apagadas.
- Seleção explícita limita o conjunto de candidatos. No novo modo, respeitar esse conjunto e aplicar a nova estratégia. Campos legados como `same_video_per_slot` ou “mesma sequência em todas as contas” não podem anular silenciosamente a proteção. Validar conflitos de modo na API e na UI.

### 2.3 Uma mídia diferente por conta, quando possível

- Definir “ao mesmo tempo” operacionalmente. Usar como ponto inicial uma janela móvel de cinco minutos, configurável internamente, além da identificação da rodada. Documentar a escolha e testá-la nas bordas; não depender apenas de `floor(timestamp / janela)` porque horários em lados opostos da borda podem estar separados por segundos.
- A proteção deve atravessar Postar, Loop e outros fluxos simultâneos do mesmo usuário que compartilhem mídias. Não basta um Set dentro de uma chamada ou um bloqueio por `loop_id`.
- Considerar tanto horários planejados quanto a execução real: processamento atrasado e retries podem aproximar publicações originalmente distantes.
- Com `M` mídias distintas elegíveis para `N` contas, se existir uma atribuição válida sem duplicatas, produzir essa atribuição.
- Não confundir “há M arquivos na pasta” com “há uma combinação válida depois de histórico, reservas e cooldown”. Evitar um algoritmo guloso que bloqueie a última conta quando outra combinação sem colisão era possível.
- Havendo restrição temporária por reserva/cooldown, reagendar a conta afetada para o primeiro instante elegível com um motivo visível. Não usar essa restrição como desculpa para liberar duplicatas indevidas.
- Preservar os horários e intervalos escolhidos tanto quanto possível. Qualquer adiamento obrigatório precisa ser explícito na fila, com limite e motivo, sem ficar parado indefinidamente.

### 2.4 Menos mídias do que contas

- Quando o conjunto real disponível para a rodada tem menos mídias do que contas, repetir é permitido e esperado. Não travar a fila só por isso.
- Distribuir as contas pelos vídeos da maneira mais equilibrada possível. Com todos os candidatos igualmente elegíveis, a diferença entre o vídeo mais e o menos atribuído na rodada deve ser no máximo um.
- Exemplo: dez contas e três vídeos devem resultar em uma distribuição 4/3/3; oito contas e dois vídeos, 4/4. Nunca mandar todas para o mesmo vídeo enquanto outros estiverem disponíveis.
- Variar quais contas recebem cada vídeo e quem fica com a repetição extra nas rodadas seguintes. Usar views para prioridade sem abandonar o balanceamento exigido na escassez.
- Levar o histórico por conta em consideração. Quando as restrições de elegibilidade impedirem uma divisão exata, minimizar o desequilíbrio e registrar o motivo real, sem afirmar uma garantia impossível.
- Um único vídeo pode circular pelas várias contas. Evitar sua repetição consecutiva na mesma conta quando existirem outras opções; não prometer isso quando só existe uma mídia.
- Pasta vazia ou nenhuma conta apta: apresentar um motivo claro e não gerar trabalho inválido.

### 2.5 Histórico, ciclos e equidade

- Preservar a visão de histórico compartilhada entre filas existente em `lib/video-history.ts`.
- Não repetir um vídeo para a mesma conta enquanto houver candidatos inéditos elegíveis naquele ciclo. Reservas em andamento também contam para evitar duplicação; tentativas definitivamente canceladas/falhas não devem consumir o vídeo para sempre.
- Distinguir esgotamento do ciclo de indisponibilidade temporária. Uma reserva concorrente não autoriza zerar o histórico e reiniciar o ciclo.
- Respeitar loops finitos e infinitos. Não transformar limite de ciclos em repetição infinita por fallback.
- Fazer os vídeos menos vistos também circularem ao longo do ciclo, sem o ranking prender todas as contas para sempre nos primeiros colocados.
- Contas adicionadas posteriormente recebem o estado da campanha e uma atribuição compatível com as reservas existentes, sem reembaralhar as demais contas.
- Mídias adicionadas ou removidas: definir o efeito sobre próximos ciclos e preservar referências de trabalhos já iniciados.

## 3. Implementação técnica e concorrência

- Centralizar a política em um módulo compartilhado testável. Não copiar algoritmos diferentes para Postar, Loop e sincronização.
- Separe seleção/ranking, atribuição por conta e execução da publicação. A ordem deve operar sobre o objeto da mídia, preservando legenda, processamento, origem e demais metadados.
- Reaproveitar a paginação real e o RPC de histórico; testar pastas/históricos acima de mil registros.
- Criar ou adaptar reservas duráveis no Supabase com transação, locks/constraints e idempotência adequados. A decisão e a reserva precisam ser protegidas contra dois processos que leem o mesmo estado simultaneamente.
- Uma chamada síncrona em JavaScript sem `await` no meio não constitui proteção entre duas requisições, containers ou crons diferentes.
- As reservas devem carregar usuário, identidade da mídia, conta, origem do job, janela/horário, estado, chave idempotente e validade suficiente para recuperação. Defina liberação, heartbeat/renovação se necessária e recuperação após crash.
- Antes de criar/publicar o container na Meta, reconciliar atrasos e reservas. Em timeout com resultado externo desconhecido, consultar/reconciliar o container antes de reenviar; não prometer “exactly once” só com um lock local.
- Não introduzir bloqueio global desnecessário entre usuários nem uma serialização que inviabilize a cadência existente.
- Criar migrações incrementais com índices, permissões/RLS e possibilidade de execução repetida. Não apagar histórico para simplificar o algoritmo.
- Não registrar tokens, senhas, cookies, URLs de proxy com credenciais ou outros segredos.
- Preservar a validação das legendas, o vínculo da legenda original com seu vídeo, a opção `share_to_feed` e o comportamento original/limpeza de metadados. Não reencodar arquivos como parte desta funcionalidade.
- Mensagens e opções na UI devem explicar escolhas do usuário. Não colocar detalhes de locks, seeds ou infraestrutura no fluxo normal de criação.

## 4. Testes e critérios de aceite da estratégia

Crie testes com relógio controlado e aleatoriedade semeada, verificando comportamento e invariantes. Inclua:

1. Views preservadas de Inspirações para Biblioteca e realmente usadas na seleção.
2. Dez contas e cem vídeos inéditos: primeira rodada usa os dez mais vistos, sem repetição.
3. Mesma semente/mesmo estado produzem a mesma atribuição; retry conserva a mídia original. Sementes diferentes permitem outras atribuições válidas.
4. Mídias e contas em quantidades iguais: todos recebem mídia diferente na rodada.
5. Dez contas/três mídias → 4/3/3; oito contas/duas mídias → 4/4, variando os grupos depois.
6. Nenhuma mídia, uma mídia, nenhuma conta apta, views ausentes/zero/empatadas e valores grandes.
7. Histórico desigual por conta: não perder uma solução válida por decisão gulosa; não resetar ciclo só por bloqueio temporário.
8. Não repetir prematuramente na mesma conta e respeitar fim de ciclo finito/infinito.
9. Duas execuções simultâneas de Loop e Postar, inclusive em processos distintos: reservas e idempotência impedem coincidências indevidas.
10. Horários em lados opostos da borda da janela; atraso de processamento; timeout da Meta após possível sucesso; reinício do scheduler.
11. Mais de mil mídias/registros: nenhuma truncagem silenciosa.
12. Contas adicionadas, mídias removidas, duplicatas do mesmo Reel em pastas diferentes e isolamento entre usuários.
13. Legenda continua vinculada à mídia correta, e opções de processamento/exibição permanecem preservadas.
14. Filas existentes mantêm sua ordem e estado; seleção explícita não vaza mídias de fora da seleção.

Mostre uma simulação legível de pelo menos três rodadas para 5 contas/10 vídeos e 10 contas/3 vídeos, com views, atribuições e contagem de coincidências permitidas/evitadas. Faça testes de concorrência reais no banco de teste para a parte transacional; mocks sozinhos não provam locks.

Rode os testes pertinentes existentes, `npm run typecheck` e `npm run build`, conforme o ambiente permitir. Se algum check não puder rodar, declare o motivo concreto. Não publique nas contas reais para fazer teste sem autorização específica de conta e mídia.

## 5. Migrar Vercel → VPS mantendo Supabase

### 5.1 Inventário e configuração

- Verificar capacidade e serviços da VPS conhecida (`2.25.244.181`) antes de decidir compartilhar recursos com o RPA. Medir RAM, CPU, disco e portas; não derrubar nem reiniciar o RPA como efeito colateral.
- Inventariar integrações, variáveis de ambiente, tarefas e endpoints usados de verdade. Não assumir que `python_server/`, Apify e serviços auxiliares estejam hospedados na VPS conhecida.
- Manter exatamente o projeto Supabase atual, usuários, banco, Storage e URLs públicas das mídias. Preservar os segredos de criptografia existentes.
- Preparar execução Linux com Docker/Compose e build reproduzível a partir do lockfile. Usar Node compatível com as dependências e confirmar suporte às bibliotecas/binários FFmpeg.
- Configurar proxy reverso com HTTPS, reinício automático, health checks, limites de recursos, rotação de logs, temporários e limpeza de arquivos de processamento.
- Configurar timeouts e limites de upload de acordo com os endpoints reais. `maxDuration` da Vercel não substitui controle de orçamento/cancelamento na VPS.
- Manter segredos fora da imagem e do Git. Variáveis públicas de Next usadas no build precisam ter o valor correto na imagem de produção.
- Definir domínio de produção próprio. Se ainda não foi informado, perguntar somente essa decisão quando necessária e continuar o trabalho local independente.

### 5.2 Substituir todos os crons

- Ler `vercel.json` atual como fonte e migrar todas as entradas; o contexto registra 16, incluindo `/api/analytics/sync` fora do prefixo `/api/cron`.
- Preservar frequências, autenticação por `CRON_SECRET` e semântica de timezone. Conferir a interpretação UTC da origem e manter separadas as regras de horário de Brasília da aplicação.
- Usar um agendador persistente adequado ao projeto, com limites de concorrência por tarefa, timeouts, logs de última execução/sucesso/falha e recuperação após reboot.
- Evitar que uma tarefa lenta bloqueie todas as demais. Definir a política de execuções sobrepostas e retries sem duplicar publicações.
- Não deixar dois agendadores de produção, Vercel e VPS, disparando a mesma fila durante a virada. Preparar uma chave/controle de ativação e sequência verificável de desligar um e ligar o outro.
- Preparar homologação com agendador desligado para não consumir a fila real por acidente.

### 5.3 URLs e integrações

- Substituir URLs fixas da Vercel por configuração central da URL pública canônica.
- Atualizar callbacks do Instagram/Meta, URLs permitidas do Supabase Auth, magic links, webhooks, links gerenciados e `SAAS_BASE_URL` do worker quando aplicável.
- Procurar também URLs persistidas e links já divulgados. Manter estratégia de compatibilidade/redirecionamento quando necessária, sem presumir que basta mudar DNS de um endereço `vercel.app`.
- Validar cookies seguros, domínio, HTTPS e headers de proxy. Não enfraquecer autenticação, RLS ou validação de URLs como atalho.

### 5.4 Validação e virada

- Entregar primeiro uma instância paralela verificável e documentação de deploy/rollback.
- Validar login, leitura do Supabase, Biblioteca, importação, criação de fila, execução do scheduler em teste e recuperação após reinício. Uma resposta HTTP 200 sozinha não prova publicação.
- Separar testes que publicam na Meta ou enviam notificações daqueles que só leem dados; usar ambiente de teste ou autorização específica para efeitos reais.
- Fazer a virada apenas depois dos checks pertinentes, com domínio/acessos definidos e o plano de retorno pronto. Não interromper o site atual para descobrir se a nova instalação funciona.
- Não excluir o projeto Vercel nem cancelar assinaturas automaticamente. Identificar quando o plano pago deixa de ser necessário após a validação; o cancelamento financeiro é uma ação separada.
- Preservar um único agendador ativo também no rollback, evitando duplicação quando retornar para a Vercel.

## 6. Entrega final esperada

- Implementação, migrações e testes da estratégia compartilhada.
- Explicação curta e exemplos da prioridade por views, aleatoriedade e tratamento de escassez.
- Configuração de Docker/Compose, proxy, agendador, variáveis documentadas sem valores secretos e instruções operacionais.
- Resultado dos testes e distinção entre revisão de código, simulação, homologação e execução real.
- Lista de mudanças externas necessárias em domínio, Meta, Supabase e Vercel, com estado do que foi aplicado ou ainda depende de acesso/decisão.
- Plano de rollback e indicação precisa de quais componentes estão em produção.

Não declare a migração concluída se só preparou arquivos, nem a publicação funcionando se só abriu o painel. Avance autonomamente nas partes autorizadas e peça informação somente quando houver um bloqueio real.
