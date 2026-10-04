# Revisão do relatório de migração e prompt de correções para o Claude

Data: 04/10/2026. Referência: checkout em `b1adcf7`, com alterações locais ainda não commitadas. Documento revisado integralmente: `docs/relatorio-migracao-vps-completo.md` (998 linhas na revisão). As linhas abaixo se referem a esse estado e podem mudar.

## Conclusão e limites da revisão

A arquitetura VPS + Docker + Nginx + Certbot + Supabase gerenciado é adequada como ponto de partida. O código contém melhorias reais: os crons agora carregam estratégia/seed, a validação do caminho da Biblioteca precede o INSERT, o uploader inclui o usuário, o Dockerfile usa Node 22 e a recuperação de posts consulta o início da publicação.

Ainda não há evidência suficiente para concluir que todas as P1 foram resolvidas ou que a aplicação está pronta para 200+ contas. Há defeitos reproduzíveis e divergências entre repositório, configurações descritas e conclusões do relatório.

Validação executada nesta revisão:

- `node node_modules/vitest/vitest.mjs run __tests__/media-priority.test.ts __tests__/media-priority-cases-ab.test.ts`: 18/18 passaram.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passou.
- Execução do módulo real de prioridade e de handlers reais com dependências simuladas, sem acessar banco/Meta/VPS: reproduções descritas abaixo.
- Não foi repetido o build nem executada a suíte completa de scripts de `npm test` nesta revisão.
- Não houve acesso SSH, inspeção do banco de produção, disparo de crons reais, postagem, migração, commit ou push. A tentativa de consulta pública pelo navegador de pesquisa não retornou conteúdo utilizável; isso não demonstra indisponibilidade da VPS.
- Nenhum arquivo da aplicação foi alterado nesta revisão. Este documento é o artefato para o Claude implementar as correções.

## Instrução ao Claude

Confira o estado atual, preserve trabalho posterior e corrija os problemas a seguir. Mantenha a publicação pela API oficial, sem rotação de proxies. Não reintroduza funcionalidades removidas. Faça as alterações locais e os testes de regressão necessários. Para operações de produção, siga a autorização vigente do usuário; este texto não é autorização para publicar posts, executar SQL em produção, mudar DNS, desligar serviços, cancelar planos ou fazer push.

Não copie segredos para respostas, relatórios, patches ou logs. Entregue um resultado comprovado por comportamento, sem marcar uma correção como concluída apenas por passar typecheck.

## P1 — Segredo exposto e exclusão Docker incorreta

Evidências:

- O relatório contém o valor de `CRON_SECRET` nas linhas 791 e 975. Ele não está reproduzido aqui.
- `.dockerignore:36` contém `docs/review-*.env.cron`: as duas regras foram concatenadas sem quebra de linha. Não existe uma regra independente excluindo `.env.cron`.
- `Dockerfile:31` usa `COPY . .` no estágio de build. Um `.env.cron` presente no contexto pode entrar no builder/cache; esta inspeção não comprova sua presença na imagem final.
- `app/api/cron/force-run/route.ts:20` aceita o segredo por query string e por header. O Nginx mostrado no relatório deixa essa rota acessível externamente. Logo, a restrição das demais rotas a localhost não elimina o impacto da exposição.

Correção:

- Remover valores reais do documento, usar placeholders e preparar rotação coordenada do segredo, se o valor estiver em uso, no aplicativo e nos chamadores autorizados. Não gerar o novo valor em uma resposta pública.
- Corrigir as regras de ignore e cobrir outros arquivos temporários de ambiente, preservando templates públicos.
- Verificar se o segredo foi commitado/compartilhado; não afirmar que houve vazamento público sem evidência.
- Preferir autenticação por header/sessão administrativa, evitando segredos em URLs.

## P1 — A limpeza da Biblioteca apaga registros de uploads válidos

Evidências:

- `app/dashboard/library/page.tsx:248` produz caminhos `<user_id>/videos/upload_....mp4`.
- `app/api/library/broken-records/route.ts:75` extrai somente o primeiro segmento e lista esse nível do Storage; em `:94`, monta caminhos sem percorrer a subpasta `videos`.
- A rotina compara esse inventário incompleto com o caminho completo e exclui o registro em `:107`.

Reprodução isolada: um registro `user-a/videos/upload_123.mp4`, com Storage simulado contendo a subpasta `videos`, recebeu resposta `deleted: 1`; a linha válida desapareceu. O arquivo físico não foi removido pelo handler.

Correção: inventariar os diretórios completos relevantes, percorrer a hierarquia corretamente ou consultar existência por caminho exato. Paginar e distinguir erro de consulta de ausência comprovada. Preservar caminhos antigos e novos. Testar upload seguido de limpeza, arquivos realmente ausentes, listagem indisponível e múltiplas subpastas.

Pendências relacionadas: `library/record:129` ignora erro da consulta de referências e trata `count = null` como zero; `library/bulk:75` remove objetos sem consultar referências restantes. Corrigir para não apagar objetos ainda usados por outras linhas, inclusive registros legados, e nunca compensar exclusão quando a existência das referências é desconhecida.

## P1 — O estado preparing ainda não bloqueia os workers

Evidências:

- `app/api/posts/distribute/route.ts:328` cria posts com `status: pending` enquanto a campanha está em `preparing`.
- `app/api/cron/publish-scheduled/route.ts:180` e `:198` consultam posts pendentes sem verificar o estado da campanha; o claim em `:294` também não verifica esse estado.
- `app/api/cron/sync-distribute-accounts/route.ts:73` não filtra `status: active`.
- A nova migração só adiciona coluna/índices; não cria transação, trigger ou RPC que imponha esse bloqueio.

Reprodução isolada: o publicador consumiu um post de campanha `preparing`, chegando à validação da conta e mudando o post para `failed`. Nenhuma chamada à Meta foi feita. Isso comprova que a campanha em preparação não é ignorada.

Correção: implementar ativação realmente atômica ou estado de staging não consumível, aplicado em todos os produtores/consumidores e no claim. Preservar posts legítimos de outros fluxos sem campanha. O sincronizador não pode inscrever contas em uma campanha ainda incompleta.

Teste obrigatório: interromper após o primeiro lote e executar os workers; nenhum post dessa campanha pode ser claimado, publicado ou alterado como trabalho ativo. Só liberar após ativação confirmada.

## P1 — Retry devolve sucesso para campanha incompleta; chave instável no modo Ciclo

Evidências:

- `distribute/route.ts:189` retorna sucesso para campanha existente independentemente de estar `preparing`.
- Falha de ativação em `:402` é apenas logada; a resposta final continua sendo sucesso.
- `computeIdempotencyKey` inclui `start_at`, mas o formulário em `app/dashboard/postar/page.tsx:1391` gera uma data nova em cada envio no modo Ciclo/burst.
- A chave não inclui `account_stagger_seconds`, `caption_strip_hashtags` ou `caption_strip_mentions`, apesar de alterarem o resultado.

Reprodução com 501 vídeos, uma conta e uma pasta de sincronização: falha simulada no segundo lote deixou 500 posts `pending` e a campanha `preparing`. Repetir exatamente o pedido retornou HTTP 200, `success: true`, `idempotent: true`, com os mesmos 500 posts, sem concluir o lote restante.

Reprodução da função real de hash: alterar somente `start_at` em um segundo produziu outra chave; alterar `caption_strip_hashtags` não mudou a chave.

Correção: usar uma identidade de operação estável gerada no início da intenção do usuário e reutilizada em retries. Nova campanha intencional recebe identidade nova. Associar fingerprint normalizado completo para detectar reutilização incompatível. Tratar conflito de unicidade por concorrência, estado incompleto, retomada/compensação e falha de ativação explicitamente. Não retornar sucesso de conclusão para trabalho incompleto.

## P1 — Campanha sem sincronização conflita com o schema versionado

- `distribute/route.ts:350` insere `account_folder_ids: null` quando nenhuma pasta de contas foi escolhida.
- `supabase/distribute_campaigns.sql:15` define `account_folder_ids uuid[] NOT NULL DEFAULT '{}'`.
- A nova migração não remove essa restrição. DEFAULT não substitui NULL explícito.

Com o schema do repositório, criar uma campanha normal sem sincronização falha antes de salvar os posts. Enviar array vazio quando não há pastas e testar contra um banco com as constraints reais. Conferir o schema de produção separadamente, sem presumir que é idêntico ou que a migração já resolveu a incompatibilidade.

## P1 — A busca de distribuição pode bloquear o processo Node

- `lib/media-priority.ts:230` usa backtracking sobre combinações.
- Em `:366`, tenta encontrar uma atribuição perfeita mesmo quando já sabe que há menos vídeos que contas.
- O comentário de complexidade O(N*M) em `:365` não descreve esse algoritmo.

Reprodução com módulo real, candidatos inéditos para todas as contas, views distintas, seed `bounded-review`, uma rodada:

| Contas | Vídeos | Resultado local |
|---|---|---|
| 3 | 2 | Concluiu em aproximadamente 1 ms |
| 11 | 10 | Interrompido pelo limite de 1.500 ms da VM |
| 200 | 10 | Interrompido pelo limite de 1.500 ms da VM |

Esses tempos não são benchmark da VPS. Demonstram que até um caso pequeno dispara busca excessiva. Como a função é síncrona dentro do processo da aplicação, pode atrasar outras requisições.

Correção: usar matching com complexidade limitada por caminhos aumentantes, sem enumerar combinações, e tratar escassez diretamente. Retornar/usar matching parcial quando aplicável. Preservar ranking por views, aleatoriedade determinística e equilíbrio condicionado à elegibilidade. Testar também grafos sem matching perfeito mesmo quando o total de vídeos é suficiente.

## P1/P2 — Histórico e isolamento entre filas ainda não estão garantidos

O teste B novo (`__tests__/media-priority-cases-ab.test.ts:74`) exige apenas que pelo menos uma conta receba um vídeo inédito. Isso não comprova que cada conta respeita seu histórico.

Reprodução atual: três contas A/B/C; todas já usaram v1 (900 views), nenhuma usou v2 (800); seed `scarcity-review`. Resultado: B=v2, A=v1 com reset, C=v2. A repetiu antes de esgotar seu conjunto elegível. Se a política aceita relaxar histórico em escassez para balancear, isso precisa ser explicitado e refletido no teste/relatório; não declarar que ambas as garantias são absolutas quando entram em conflito. A política solicitada anteriormente priorizava a elegibilidade individual nesse caso.

Também:

- `getLastPostedVideo` continua aproximando recência pela maior contagem de uso, sem timestamp.
- O estado de ciclo local não é realmente reiniciado ao marcar `isCycleReset`; testar várias voltas completas, não só uma rodada.
- Postar e sincronização passam conjuntos vazios para reservas globais (`distribute:249`, `sync-distribute-accounts:228`). O Loop consulta reservas do próprio loop com janela iniciada no instante da execução (`process-loops:396` e `:739`).
- Seed e Sets em memória não garantem exclusão concorrente entre diferentes filas/campanhas.

Definir a precedência das regras e implementar reserva durável por janela de publicação quando necessária. Validar duas execuções concorrentes, histórico desigual, escassez, várias rodadas, janelas sobrepostas entre Postar/Loop/sincronização e indisponibilidade das consultas. Não prometer ausência global de coincidências com uma propriedade apenas local de uma rodada.

## P1/P2 — Cutover, timeouts e recuperação de publicação

- O relatório marca 15 timers VPS ativos e deixa desligar os crons da Vercel para depois de 24–48h (`:716`, `:852`). Se ambos realmente executam, há sobreposição de agendadores.
- A sequência deve garantir um único agendador ativo. Pode manter a hospedagem anterior disponível para rollback sem manter os dois conjuntos de crons executando.
- No gerador, `publish-scheduled` tem timeout de 55 s (`scripts/generate-systemd-timers.sh:26`) enquanto o handler trabalha com orçamento de 250 s. `publish-pending` tem 110 s e espera 8 s entre publicações; 19 intervalos já somam 152 s antes da rede.
- Matar o curl não é uma garantia de cancelamento do processamento no servidor. Alinhar timeout do cliente/systemd, tempo do job, periodicidade e exclusão entre execuções.
- `publishing_started_at` corrige a comparação com horário agendado, mas não é um lease completo com dono/renovação. Jobs antigos `publishing` com timestamp NULL ficam fora do filtro de recuperação. Uma publicação aceita pela Meta e não confirmada no banco exige reconciliação antes de reenviar.

Testar interrupção, retomada, timeout, status externo incerto, registros legados e transição entre ambientes. Não publicar posts reais para esses testes locais.

## P2 — Configuração de produção diverge do repositório

- O Compose versionado ainda tem `build: .` e não os `build.args` mostrados no relatório.
- O Nginx versionado ainda tem domínio/caminhos de certificado antigos e bloqueio amplo de `/api/cron/`; o anexo do relatório mostra outra configuração.
- O relatório relata correção manual de `next.config.ts` na VPS e também do procedimento de habilitação dos timers. O script ainda imprime o comando com glob que o próprio relatório diz ter falhado.
- Não há workflow `.github/workflows` neste checkout.

Consolidar no repositório o estado pretendido, sem segredos, e produzir deploy reproduzível a partir de checkout limpo. Usar explicitamente `docker compose --env-file .env.production ...` para interpolar build args e validar variáveis essenciais. Preferir imagem identificada por commit, build fora da VPS, verificação após deploy e rollback conhecido. Não confundir rollback da aplicação com reversão automática das migrações de banco.

## P2 — Healthcheck, scraping e declaração de conclusão

- O próprio relatório mostra container `unhealthy` (`:761`) e trata a causa como uma suposição sobre `wget --spider` (`:784`). Diagnosticar a saída real do healthcheck dentro do container: endereço IPv4/IPv6, método, timeout e status. Não apenas trocar para curl sem garantir que ele existe na imagem.
- `/api/health` verifica duas variáveis, sem consultar Supabase, permissões ou schema. Separar vivacidade de prontidão e medir as dependências com timeout; manter respostas sem segredos. Um status HTTP 200 dessa rota não valida a publicação.
- O relatório admite `process-scrape-jobs` retornando `skipped` por falta de `PYTHON_SERVER_URL` (`:731`). Marcar esse fluxo como indisponível até configurar/testar a dependência, se ele for necessário. Não chamar todos os crons de funcionais apenas porque seus timers estão ativos ou retornam 200.
- Atualizar as URLs de Meta/Supabase e validar conexão/renovação de conta e redirecionamentos no domínio novo. Login com uma sessão já existente não prova todos esses fluxos.
- Corrigir os exemplos do relatório para refletirem código/testes reais. A afirmação de que `outputFileTracingIncludes` não existe no Next.js 15 confunde a posição da opção: os tipos instalados a declaram no nível principal de configuração, não em `experimental`.
- Capacidade de 200–300 contas continua pendente. A fila deve sustentar 400–600 publicações por hora com atraso controlado, além dos outros serviços presentes na VPS. Testes unitários não medem isso.

## Entrega e critérios de aceite

1. Corrigir primeiro exposição de segredo, exclusão indevida de registros, campanhas incompletas, conflito NULL/NOT NULL e busca combinatória.
2. Acrescentar testes de comportamento dos handlers, constraints/transações e concorrência. Não enfraquecer a expectativa do teste para aprovar o resultado atual.
3. Comprovar os casos de regressão descritos, incluindo 501 posts com falha no segundo lote, retry burst, upload em subpasta seguido de limpeza, campanha sem sincronização e distribuição 11/10 e 200/10.
4. Executar a suíte padrão completa, typecheck e build; validar a imagem Docker com configuração equivalente à produção quando o ambiente permitir. Distinguir testes executados dos planejados.
5. Entregar migrações aditivas e procedimento de rollout com um agendador ativo. Informar tudo que ainda depende de aplicação/verificação em produção.
6. Consolidar Compose/Nginx/timers e fornecer procedimento de deploy/rollback reproduzível. Preservar a possibilidade de usar GitHub Actions sem exigir instalação de um novo painel de hospedagem.
7. Reescrever a conclusão do relatório conforme a evidência: infraestrutura acessível, publicação validada, scraping disponível e capacidade de escala são verificações diferentes.

## Referências técnicas consultadas

- [Docker: exclusões do contexto de build](https://docs.docker.com/build/concepts/context/): regras de `.dockerignore` precisam corresponder aos arquivos que serão excluídos antes do envio ao builder.
- [Docker: interpolação e --env-file](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation): `env_file` de um serviço não substitui a configuração de interpolação do Compose.
- [Supabase: listagem do Storage](https://supabase.com/docs/reference/javascript/storage-from-list): listagem por pasta; a limpeza precisa considerar a hierarquia utilizada pelos uploads.
- [Next.js: Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route): conferir comportamento de métodos e diagnosticar o erro do healthcheck antes de atribuir uma causa.
