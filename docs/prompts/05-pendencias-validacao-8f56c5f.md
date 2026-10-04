# Prompt complementar para o Claude — concluir correções após 8f56c5f

Revise e corrija o AutoScale-IA a partir do estado atual do repositório. O commit de referência desta revisão é `8f56c5f416786f0f74be0e26473ebeec17a500c6`, de 04/10/2026. Confira se há trabalho posterior e preserve as mudanças existentes.

O relatório anterior afirma que todas as correções foram concluídas. A revisão posterior confirmou avanços, mas encontrou pendências reproduzíveis que impedem essa conclusão. Não repita o relatório sem verificar cada critério abaixo.

Implemente as correções locais e os testes necessários. Este prompt não autoriza publicar posts reais, aplicar SQL em produção, instalar serviços na VPS, mudar DNS ou desligar a Vercel. Não faça commit/push automaticamente por causa do relato anterior; siga a autorização vigente do usuário para essas ações.

## Escopo e decisões mantidas

- Usar API oficial da Meta para publicar, diretamente pelo servidor. Não implementar rotação de proxies para postagem. Proxies dos fluxos de scraping permanecem separados.
- Manter o Supabase gerenciado e preparar hospedagem do aplicativo na VPS.
- Preservar a prioridade por views, legendas, horários, processamento de mídia, share_to_feed e funcionalidades ativas.
- Não reintroduzir RPA, Links Gerenciados, Logins e Horário Humano.
- O usuário informou que executou a migração de prioridade. Isso não comprova que outras tabelas, funções ou constraints necessárias existam em produção. Faça migrações aditivas e documente a ordem de aplicação.
- O objetivo futuro é mais de 200 contas com um vídeo a cada 30 minutos. A capacidade ainda não foi validada e não pode ser deduzida de typecheck/build/testes unitários.

## O que já avançou

- `assignVideos()` aceita `videosPerAccount`, e Postar passa `maxVideos`. Um teste local do módulo com 10 candidatos, 1 conta e quantidade 10 devolveu 10 atribuições.
- POST/GET/PATCH de Loops passaram a persistir/expor estratégia, e DELETE verifica ownership antes de mudar containers.
- A frequência de `publish-scheduled` no gerador de timers foi corrigida para cada minuto.
- O template de ambiente corrigiu nomes de variáveis.
- Há uma rota `/api/health`, `.dockerignore`, integração de Vitest no script padrão e remoção das rotas antigas de Logins.

Preserve essas melhorias. Elas não resolvem automaticamente os problemas restantes.

## P1 — Os crons continuam ignorando a estratégia salva

Arquivos:

- `app/api/cron/sync-distribute-accounts/route.ts`: o SELECT inicial de `distribute_campaigns` ainda termina em `share_to_feed` e não busca `priority_strategy` nem `distribution_seed`.
- `app/api/cron/process-loops/route.ts`: o SELECT dos loops ativos também não inclui esses campos.

Depois, ambos tentam ler `priority_strategy` de um objeto que não recebeu essa coluna e caem em `least_usage`. As mudanças desses dois arquivos no commit de referência foram apenas linhas em branco, não a integração descrita no resumo.

Além disso, a sincronização ainda constrói a seed com `${campaign.id}:${now}` e o Loop com `${loop.id}:${windowStartIso}`. Eles não usam efetivamente a seed persistida como identidade estável de trabalho.

Corrija SELECTs, interfaces, propagação e a identidade estável de ciclo/slot. Retry do mesmo trabalho não deve gerar outra decisão aleatória. Crie testes que projetem somente as colunas pedidas no SELECT; mocks que retornam a linha inteira escondem essa falha. Teste uma campanha e um Loop realmente gravados como `views` chegando ao algoritmo como `views`.

## P1 — A Biblioteca continua aceitando caminhos alheios no cadastro bem-sucedido

Arquivos: `app/api/library/record/route.ts`, `app/api/library/bulk/route.ts`, exclusões individual/de pasta, fluxo de upload e políticas relacionadas.

A validação `isOwnedPath` foi colocada dentro de `if (error)`, depois do INSERT. Ela só altera a compensação quando o INSERT falha. O cadastro bem-sucedido continua aceitando um `storagePath` arbitrário, e a exclusão do novo registro próprio manda apagar esse arquivo com privilégios de serviço.

Reprodução local confirmada com handlers reais e banco/Storage simulados:

1. Existe um registro de B com `storage_path = videos/victim.mp4`.
2. A cadastra esse mesmo path na sua própria pasta: HTTP 200.
3. A exclui o registro que acabou de criar: HTTP 200.
4. O código solicita remoção física de `videos/victim.mp4`; o registro legítimo de B continua existindo.

Comprove a propriedade do upload ANTES de registrar o arquivo, por mecanismo verificável do servidor. Não basta confiar em um prefixo enviado pelo cliente. Revise permissões de upload, identificação do objeto e referências compartilhadas.

Integre a mudança ao uploader real: `app/dashboard/library/page.tsx` ainda gera `videos/upload_<timestamp>_<nome>`, que não começa com `<user_id>/`. Mover a validação de prefixo sem ajustar o upload quebraria uploads legítimos. Preserve compatibilidade segura com arquivos existentes.

Na exclusão física e compensação, erro ao consultar referências não significa zero referências. Teste a cadeia inteira cadastro → exclusão, além de upload legítimo e falha de cadastro.

## P1 — Campanhas ainda não são atômicas nem idempotentes

Arquivo: `app/api/posts/distribute/route.ts`.

Salvar a configuração antes dos posts e devolver `partial: true` melhora a mensagem, mas não garante atomicidade. Os posts continuam entrando diretamente como `pending`, em lotes independentes de 500, e ficam publicáveis mesmo se a operação falhar depois. A configuração só é inserida quando há pastas sincronizadas.

Cada nova requisição continua executando `randomUUID()` e gerando a seed com `Date.now()`. Portanto o comentário de que retries usam o mesmo campaignId não corresponde ao código.

Reprodução confirmada com handler real e dependências simuladas:

- Pedido de 501 vídeos para 1 conta, sem sincronização.
- Falha simulada no segundo INSERT: HTTP 500 com `partial: true`; 500 posts ficam pendentes.
- Repetição do mesmo pedido: HTTP 200; o banco termina com 1.001 posts e dois campaignIds.

Implemente transação de criação ou estado de preparação não consumível pelos workers, com ativação somente após todos os dados necessários estarem completos. Use idempotência persistida para duplo clique, retry e timeout após commit. Não dependa de apagar lotes depois da falha: eles podem já ter sido consumidos.

Inclua configuração de sincronização na ativação. O cron de sincronização não deve consumir uma campanha que ainda está sendo montada. Teste com e sem pastas sincronizadas.

## P1 — Recuperação de fila e reservas concorrentes continuam pendentes

`app/api/cron/publish-scheduled/route.ts` ainda libera `publishing` usando `scheduled_at <= agora - 5 minutos`.

Reprodução local: post agendado há 30 minutos, iniciado há apenas 10 segundos, volta a `pending` durante outra execução. O horário agendado não informa quando o processamento começou.

Use claim/lease baseado no início da execução, proprietário, expiração e finalização condicionada ao proprietário atual. Recupere trabalhos realmente abandonados. Reconcilie estados remotos quando houver timeout com resultado ambíguo; não publique novamente só porque a resposta HTTP não chegou.

`roundClaims` é um Set em memória: ele não coordena duas requisições, dois workers ou Postar e Loop. O guard do Loop ainda compara `created_at >=` o instante da chamada. Postar e sincronização ainda passam reservas vazias ao algoritmo.

Implemente a reserva persistente/atômica exigida no prompt anterior, com identidade de mídia e janela de publicação bem definidas, isolamento por usuário e política explícita para escassez. Faça testes de concorrência em banco de teste explicitamente configurado. Nunca use produção automaticamente por encontrar credenciais no ambiente.

## P1 — A seleção ainda viola histórico quando existe uma alternativa válida

Arquivo: `lib/media-priority.ts`.

Os 15 testes existentes passam, mas não cobrem os casos abaixo, reproduzidos em memória usando o módulo real. Nenhum arquivo de aplicação foi alterado para a revisão.

### Caso A: existe atribuição sem repetição, mas a seleção gulosa reinicia ciclos

Configuração:

- `strategy: "views"`, `seed: "review-0"`, `videosPerAccount: 1`.
- Ordem de entrada das contas: `A, B, C`.
- Candidatos: `v1=900 views`, `v2=800`, `v3=700`.
- Histórico A: `v3` usado uma vez.
- Histórico B, nessa ordem: `v2` e `v3`, uma vez cada.
- Histórico C, nessa ordem: `v1` e `v2`, uma vez cada.

Existe solução válida: **A→v2, B→v1, C→v3**.

O resultado observado foi **A→v1, B→v3, C→v2**, com `isCycleReset=true` para B e C. A primeira escolha toma a única mídia inédita de B e o algoritmo resolve a disputa repetindo mídia já usada, em vez de remanejar as atribuições.

Considere elegibilidade de todas as contas e remanejamento/matching quando necessário. Uma exclusão temporária por `roundClaims` não prova que a conta esgotou o ciclo pessoal.

### Caso B: escassez ignora o histórico individual

- 3 contas A/B/C, 2 vídeos: `v1=900`, `v2=800`.
- Todas as contas já usaram v1; nenhuma usou v2.
- `strategy: "views"`, `seed: "scarcity-review"`, uma rodada.

Resultado observado: B→v1, A→v2, C→v1. A distribuição modular equilibra números, mas repete v1 para contas que ainda têm v2 inédito. O bloco de escassez não filtra elegibilidade por conta.

Equilíbrio 4/3/3 só deve ser exigido quando os candidatos forem igualmente elegíveis. Quando o histórico restringir a escolha, respeite o contrato de histórico/ciclo e minimize repetições dentro dessas restrições.

### Recência e ciclos

`getLastPostedVideo()` ainda usa maior contagem acumulada como aproximação do último vídeo, sem timestamp. Isso não comprova recência. Confira também o reinício do conjunto de mídias usadas ao terminar um ciclo; não deixe vídeos menos vistos permanentemente excluídos nos ciclos seguintes.

Teste esses dois casos, várias rodadas, reinício real de ciclo, quantidade por conta e reprodutibilidade. Acrescente testes do endpoint Postar e consumidores dos crons; apenas aumentar testes de funções puras não cobre a integração.

## P1 — A imagem Docker não foi validada pelo build local

Arquivos: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, configuração Next.js.

1. Os três estágios ainda usam `node:20-alpine`. O lockfile tem `undici@8.10.2` com engine `>=22.19.0` e `vitest@5.0.3` com engine que não inclui Node 20. Escolha runtime suportado por todo o conjunto e valide a imagem real. O Node local da revisão era 24.14.1.
2. O `.dockerignore` agora exclui `.env.production`, mas o Dockerfile não recebe os `NEXT_PUBLIC_*` necessários ao build. O `env_file` do Compose vale para o container em execução; não configura automaticamente o estágio de build. Defina um contrato explícito de configuração pública no build e segredos no runtime.
3. Não volte a copiar segredos para resolver o item anterior. Preserve `.dockerignore` e forneça somente os valores públicos necessários por um mecanismo adequado.
4. `.env.cron` ainda não é excluído pelo `.dockerignore`. `.gitignore` continua sem proteger `.env.production` e `.env.cron`. Corrija essas lacunas mantendo os templates versionáveis.

Valide instalação limpa, build Docker e funcionamento real de login/cliente Supabase na imagem construída, não apenas a resposta do healthcheck.

Referência: [variáveis públicas são incorporadas no build do Next.js](https://nextjs.org/docs/app/guides/environment-variables).

## P2 — Healthcheck e timers ainda não comprovam prontidão

- `/api/health` só verifica se `NEXT_PUBLIC_SUPABASE_URL` e `ENCRYPTION_SECRET` são strings não vazias. Não conecta ao Supabase nem verifica suas chaves/schema. Documente-o como liveness/configuração ou crie uma verificação de readiness com timeout curto e informação não sensível.
- O timer `publish-scheduled` agora é por minuto, mas mantém timeout de 55 segundos frente ao orçamento do handler de 250 segundos. `publish-pending` mantém 110 segundos, apesar de 19 esperas de 8 segundos já consumirem 152 segundos num lote de 20 publicações prontas, antes das chamadas externas.
- Alinhe os orçamentos e o comportamento após encerramento do cliente HTTP. Interromper curl não garante cancelamento do trabalho no servidor. Impeça duplicidade no banco.
- O Nginx continua negando todo `/api/cron/`, incluindo `/api/cron/force-run`, usado por ações autenticadas do painel.
- O certificado ainda aponta para um domínio fixo que não foi confirmado. Prepare a sequência de emissão/ativação para o domínio real.
- No cutover, apenas um agendador deve executar as filas. Vercel como fallback não significa manter os crons dos dois ambientes ativos.

## P2 — Capacidade para 200+ contas ainda precisa de validação própria

200 contas publicando a cada 30 minutos por 24 horas representam 400 posts/hora e 9.600/dia. Com 300 contas, são 600/hora e 14.400/dia.

O publicador do Loop ainda busca 20 itens por execução de 2 minutos e publica sequencialmente com espera. Itens consultados não equivalem a posts concluídos: processamento pendente e retries consomem capacidade. A criação de containers por Loop também mantém esperas sequenciais.

Faça um teste de carga simulado representativo de 300 contas, incluindo latência variável, processamento demorado, erros transitórios e limites das APIs. Meça vazão de posts concluídos, atraso de agendamento, idade/tamanho da fila, duplicidades, CPU e memória. Use paralelismo limitado, distribuição de horários e controle de limites por conta/app conforme a API; não crie rajadas indiscriminadas.

O resultado deve informar se a fila permanece estável ou cresce e quais configurações sustentam o volume. Não prometa capacidade de produção apenas porque os testes unitários passaram.

## Entrega exigida

1. Corrigir os itens acima sem regressão nas melhorias já implementadas.
2. Acrescentar testes que falhem no comportamento atual e passem com a correção, incluindo handlers e concorrência/transação quando necessário.
3. Executar o comando padrão de testes, typecheck e build; validar Docker quando disponível. Registrar o que não pôde ser executado.
4. Entregar migrações completas e ordem de rollout, sem aplicá-las em produção neste escopo.
5. Apresentar uma matriz simples: requisito, arquivo/mecanismo implementado, teste que o comprova e resultado.
6. Distinguir validação local de validação do ambiente VPS e das APIs reais. Não declarar “todas as correções concluídas” enquanto algum requisito obrigatório estiver apenas descrito em comentário, erro de UI ou plano futuro.
