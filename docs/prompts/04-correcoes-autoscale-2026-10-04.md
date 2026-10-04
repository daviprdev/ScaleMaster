# Prompt de implementação para o Claude — corrigir distribuição, segurança e preparação VPS

Trabalhe no repositório AutoScale-IA. Implemente as correções abaixo no código local, em etapas revisáveis, com validação apropriada. Não se limite a explicar uma solução.

A revisão de referência foi feita na `main`, commit `294a242`. Primeiro confira o estado atual, as instruções do repositório e os arquivos envolvidos. Se algum defeito já estiver resolvido, valide e preserve a solução. Não descarte mudanças existentes.

O escopo é corrigir o SaaS e preparar uma implantação confiável mantendo o Supabase atual. Não executar publicações reais, aplicar SQL em produção, instalar pacotes na VPS, alterar DNS, cancelar serviços ou desligar a Vercel neste trabalho local. Quando a preparação estiver concluída, entregue o procedimento concreto de implantação e os dados ainda necessários.

## 1. Corrigir quantidade e ordem na aba Postar

Arquivos centrais: `app/api/posts/distribute/route.ts`, `lib/media-priority.ts`, UI de Postar e testes.

Defeito confirmado: `assignVideos()` retorna uma atribuição por conta; o endpoint chama a função uma única vez e usa esse resultado como se fosse a lista inteira de vídeos de cada conta. `maxVideos` continua aparecendo na resposta e no cálculo de duração, mas não controla a geração das linhas.

Implemente a geração de todas as rodadas/slots necessários, respeitando quantidade solicitada, tamanho da pasta, histórico por conta e as regras de novo ciclo. Uma configuração de 10 vídeos por conta, 2 contas e uma pasta elegível com pelo menos 10 vídeos deve gerar 20 posts, não 2. `video_count: -1` deve preservar o significado de usar todos os vídeos disponíveis conforme a política vigente.

Preserve legendas por vídeo, `share_to_feed`, processamento de mídia, horários, stagger, modo Ciclo/burst e sincronização de pastas. Os números devolvidos à UI devem refletir as linhas efetivamente criadas. Não anuncie uma quantidade ou duração que não foi agendada.

Teste o handler completo com banco simulado: quantidade total e por conta, horários de vários slots, quantidade limitada, todos os vídeos, burst e legendas correspondentes ao vídeo correto.

## 2. Fazer a diversidade funcionar com históricos diferentes

Arquivo central: `lib/media-priority.ts`; consumidores: Postar, Loop e sincronização de campanhas.

Defeito confirmado: escolher `ranked[ai % ranked.length]` não garante diversidade, pois cada conta tem um pool diferente. Recalcular ranking/embaralhamento por conta também muda o significado do índice.

Reprodução obrigatória:

- Vídeos: `v1=1000 views`, `v2=800`, `v3=600`.
- Contas: A e B.
- Histórico: A já usou `v1`; B não usou nenhum.
- Hoje A e B recebem `v2`, embora exista solução sem colisão.

Implemente a atribuição considerando a rodada inteira:

- Em `views`, priorize os vídeos elegíveis com maior contagem de views da origem. Não ordene por views dos posts já publicados nas contas de destino.
- Distribua o conjunto prioritário entre as contas com aleatoriedade reproduzível, evitando privilegiar sempre a primeira conta da lista. A seed precisa alterar a atribuição mesmo quando os valores de views são distintos.
- Se houver atribuição sem repetir mídia na janela, encontre uma. Históricos diferentes exigem considerar elegibilidade por conta; não basta comparar o número bruto de vídeos com o número de contas.
- Quando a repetição for inevitável, minimize as colisões e equilibre a distribuição dentro das restrições. Com 10 contas sem histórico e 3 vídeos igualmente elegíveis, os totais devem ser 4/3/3. Varie as contas de cada grupo por seed/ciclo.
- Se históricos ou cooldowns tornarem o equilíbrio perfeito impossível, respeite as restrições e registre o motivo. Não prometa zero colisões quando não há solução.
- Preserve o comportamento pretendido de `least_usage` e `random`, mantendo as proteções de histórico e diversidade.
- Trate views ausentes/nulas como zero; valide contagens inválidas. Desempate de forma estável e reproduzível.
- Evite repetir imediatamente a última mídia da mesma conta quando houver alternativa. “Maior contagem de uso” não identifica a última postagem: use recência real.
- Defina claramente início/fim de um ciclo e qual histórico representa mídias já usadas/reservadas. Evite resetar o ciclo só porque exclusões temporárias esvaziaram o pool momentaneamente.

Teste views distintas, empates, views zero/nulas, estratégias diferentes, históricos diferentes, exaustão de ciclo, escassez, cooldown, múltiplas rodadas e seeds iguais/diferentes. Use propriedades úteis: nenhuma colisão quando há solução elegível, equilíbrio quando possível e reprodutibilidade. Não crie testes que apenas repitam a implementação.

## 3. Conectar estratégia e seed de ponta a ponta

Arquivos: `app/api/loops/route.ts`, `app/api/loops/[id]/route.ts`, `app/api/cron/process-loops/route.ts`, `app/api/cron/sync-distribute-accounts/route.ts`, `app/api/posts/distribute/route.ts`, interfaces e telas relacionadas.

Problemas confirmados:

- UI do Loop envia `priority_strategy`, mas POST/PATCH não persistem o campo.
- GET de Loops e SELECT do cron não buscam a estratégia.
- SELECT de `distribute_campaigns` no cron de sincronização omite `priority_strategy` e `distribution_seed`.
- Seeds construídas com o instante atual mudam em retries. A simples existência de uma coluna `distribution_seed` não resolve isso se ninguém a lê.
- A configuração de campanha só é persistida em determinados caminhos; identifique como campanhas sem sincronização preservam a decisão.

Valide e persista estratégia/seed, leia-as nos consumidores e represente-as com tipos corretos, sem casts para esconder campos faltantes. Loops/campanhas antigos devem preservar o comportamento anterior; novos podem usar `views` como padrão explícito. Reabrir a edição deve mostrar o valor salvo.

Defina uma identidade estável de campanha, rodada/slot e tentativa. Retry do mesmo trabalho deve preservar mídia, conta e horário já decididos; não gerar nova seed e nova campanha silenciosamente.

Atualize a migração SQL de modo aditivo e idempotente. Documente sua ordem de aplicação antes do código que depende das novas colunas. Inclua validação dos valores aceitos e preserve registros existentes.

Teste criar → ler → editar → executar Loop e campanha sincronizada. Um registro salvo como `views` deve chegar ao algoritmo como `views`, inclusive para contas adicionadas depois.

## 4. Garantir exclusividade entre execuções e recuperar filas corretamente

Arquivos: crons de publicação, processamento de Loop, sincronização, banco e funções compartilhadas.

### Recuperação incorreta de scheduled_posts

`publish-scheduled` libera `publishing` com base em `scheduled_at <= agora - 5 minutos`. Isso libera trabalho recém-iniciado quando o agendamento está atrasado.

Use instante de claim, lease/prazo de processamento e identidade da execução. Faça claim atômico, renovação quando necessária e finalização condicionada ao proprietário atual. Só recupere trabalho cuja execução realmente expirou.

Teste um post agendado há 30 minutos, iniciado há 10 segundos: outra execução não pode retomá-lo. Teste também uma execução realmente abandonada.

### Reservas entre fluxos

Sets em memória e SELECT antes de INSERT não garantem exclusividade entre processos. O Loop consulta `created_at >= windowStartIso`, em que a janela começa no instante da chamada; isso não representa uma janela compartilhada de colisão. Postar e sincronização passam conjuntos de reservas vazios.

Defina uma janela de publicação baseada no horário planejado, com configuração/documentação clara, e uma reserva durável e atômica no banco. Seu escopo deve cobrir os fluxos que publicam para as contas do mesmo usuário, sem misturar dados de usuários distintos. Use identidade canônica da mídia quando a mesma origem puder gerar mais de um registro na Biblioteca.

Faça a reserva antes de efeitos externos e integre sua liberação/finalização às falhas, cancelamentos e retries. Considere exclusividade da conta/slot e política de escassez: quando repetir for necessário, a reserva precisa representar essa decisão explícita, sem simplesmente desativar a proteção.

Avalie também `containerAlreadyExists` seguido de criação de container: dois workers podem passar pela consulta antes de qualquer gravação. Resolva a corrida com uma garantia do banco, não apenas um segundo SELECT.

Uma resposta HTTP ambígua da Meta não prova que nada foi publicado. Preserve o identificador remoto e reconcilie o resultado antes de tentar publicar de novo. Não prometa exactly-once externo sem suporte real.

Teste concorrência entre duas execuções, entre Loop e Postar, retry após timeout, lease expirado e execução antiga tentando finalizar após perder a reserva. Use banco de teste explicitamente configurado para testes de transação; nunca use produção por detectar variáveis de ambiente.

## 5. Corrigir falhas de isolamento entre usuários

### Exclusão de Loop

Em `app/api/loops/[id]/route.ts`, DELETE atualiza `pending_containers` antes de confirmar que o Loop pertence ao usuário. A exclusão posterior usa `user_id`, mas o dano anterior já ocorreu.

Valide ownership antes de qualquer mutação e mantenha o escopo autorizado durante a operação, de preferência em uma transação/função que associe os containers ao Loop do usuário. Usuário A não pode alterar containers de um Loop de B, mesmo conhecendo seu UUID.

Teste usuário não autenticado, Loop inexistente, Loop próprio e Loop de outro usuário. Na negativa, nenhuma linha pode mudar.

### Propriedade física de arquivos na Biblioteca

Em `app/api/library/record/route.ts`, o cliente fornece `storagePath`. A rota verifica a pasta, mas não comprova propriedade do arquivo. Ao registrar o path de outro usuário e apagar o novo registro por `app/api/library/bulk/route.ts`, a operação usa privilégios de serviço para remover o arquivo original.

Vincule o registro a um upload autorizado e a um caminho controlado pelo servidor, com identificação verificável do proprietário. Não confie apenas na string enviada pelo cliente. Preserve a compatibilidade necessária com arquivos existentes sem autorizar paths arbitrários.

Revise também exclusão individual, exclusão de pasta e compensação de upload. Antes de apagar fisicamente, proteja referências legítimas, incluindo compartilhamentos internos e posts já agendados, de acordo com o contrato de exclusão do produto. Falha na consulta de referências não equivale a “zero referências”.

Teste registrar path alheio, duplicar referências, excluir uma referência própria, erro ao verificar referências e upload legítimo. Não use um teste que verifica apenas ownership da linha, pois esse filtro já existe e não resolve a cadeia.

## 6. Impedir campanhas parcialmente ativas e retries duplicados

`app/api/posts/distribute/route.ts` insere lotes de 500 diretamente como `pending`; uma falha posterior retorna erro e deixa os primeiros lotes prontos para publicação. A próxima requisição gera outro campaignId. Erro ao salvar a configuração de sincronização também é apenas logado.

Implemente atomicidade de criação/ativação, ou um estado de preparação que não possa ser consumido até a campanha estar completa. Use chave de idempotência que permita retomar a mesma intenção sem duplicar posts. Inclua a configuração necessária de sincronização na confirmação de sucesso.

Não tente resolver apenas apagando os primeiros lotes depois da falha: um worker pode já tê-los consumido.

Teste falha no segundo lote, falha ao persistir a configuração, repetição da mesma requisição, duplo clique e timeout de resposta após commit. A UI precisa informar o estado real.

## 7. Corrigir a preparação da VPS

Revise `Dockerfile`, `docker-compose.yml`, `nginx/nginx.conf`, `scripts/generate-systemd-timers.sh`, `.env.production.example`, arquivos de ignore e helpers de URL.

Correções necessárias:

1. **Criptografia:** o código lê `ENCRYPTION_SECRET`, mas o template oferece `ENCRYPTION_KEY`. Use o nome correto e preserve exatamente o segredo existente. Não gere uma chave nova para dados já criptografados. Valide configuração antes de aceitar tráfego.
2. **Scraper preservado:** documente `PYTHON_SERVER_URL` e `PYTHON_SERVER_SECRET` se o fluxo de scrape continuar dependendo deles. Sem URL, `process-scrape-jobs` é pulado. Não trate a remoção do RPA como autorização para quebrar o scraper.
3. **Demais variáveis:** compare template e código; por exemplo, o push lê `VAPID_SUBJECT`, não `VAPID_EMAIL`. Diferencie obrigatórias, opcionais e dependentes de funcionalidade.
4. **Runtime compatível:** os estágios Docker usam Node 20, mas o lockfile contém dependências que exigem Node 22 ou superior. Escolha uma versão suportada por todo o conjunto e valide instalação/build/runtime reais. Não use `--legacy-peer-deps` como solução permanente sem resolver/documentar o conflito.
5. **Healthcheck real:** crie uma rota de saúde adequada ou aponte o check para uma rota existente apropriada. `/api/health` não existe na revisão. Separe processo vivo de dependências prontas quando útil; não exponha segredos e não simule prontidão só porque o servidor responde.
6. **Timers corretos:** `publish-scheduled|...|*-*-* *:01:00|55` roda uma vez por hora. Preserve a frequência original de cada minuto. Valide todas as 15 agendas contra `vercel.json`, incluindo timezone explícito quando necessário. Verifique os próximos disparos com `systemd-analyze calendar` em ambiente Linux apropriado.
7. **Timeouts e sobreposição:** alinhe timeout de curl/systemd, orçamento do handler e comportamento do servidor. Cancelar curl não é cancelar o processamento. As garantias contra duplicidade precisam estar no banco, incluindo disparos manuais.
8. **Segredos e contexto Docker:** adicione proteção apropriada para `.env.production` e `.env.cron` no Git e no contexto de build. Preserve templates sem segredos. Exclua `.git`, `node_modules`, `.next` e arquivos locais desnecessários do contexto Docker. Não coloque segredos em argumentos públicos, logs, imagens publicadas ou bundles do browser.
9. **Build versus runtime:** variáveis `NEXT_PUBLIC_*` são incorporadas no build do Next.js. Defina como valores públicos necessários chegam ao build e como segredos chegam apenas ao runtime. O atual `COPY . .` pode incluir `.env.production`; não use isso como contrato acidental. Depois de adicionar `.dockerignore`, não deixe o frontend sem URL/chave pública do Supabase. Confira se placeholders de `getAppUrl()` não ficaram incorporados no resultado final.
10. **Nginx e painel:** a regra que nega todo `/api/cron/` também bloqueia `/api/cron/force-run`, usado pelo painel. Diferencie endpoints de execução interna de endpoints autenticados do produto. Preserve autorização no servidor; não exponha todos os crons para contornar a regra.
11. **TLS/domínio:** remova a dependência de um domínio inventado nos caminhos de certificado. Documente a sequência que permite emitir o certificado antes de ativar uma configuração que exige os arquivos. Domínio final ainda precisa ser fornecido.
12. **Transição:** prepare a verificação antes da virada, mantendo a mesma base Supabase. Defina apenas um agendador ativo durante a troca, rollback claro e validação de OAuth, Auth URLs, storage, webhooks e processamento de vídeo. Não desligue a Vercel antes de comprovar o substituto.

Não atribua o erro de deploy da Vercel a `output: "standalone"` sem o log real que demonstra a causa. O relato de “falhou em 0 ms” não prova esse diagnóstico.

Não trate `supabase/media_priority_strategy.sql` como opcional quando o código usa suas colunas. Defaults não criam colunas ausentes. Entregue a ordem segura do rollout e a checagem de schema correspondente.

Referências primárias úteis: [variáveis do Next.js](https://nextjs.org/docs/app/guides/environment-variables), [saída standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) e [especificação de calendário do systemd](https://github.com/systemd/systemd/blob/main/man/systemd.time.xml).

## 8. Concluir limpeza e tornar os testes confiáveis

- Atualize `package.json`: `npm test` ainda chama `test-hardening.mjs` e `test-managed-links.mjs`, já removidos. Preserve cobertura pertinente às partes mantidas antes de excluir referências.
- Inclua os testes novos de prioridade e integração no comando padrão/CI. Hoje rodar `npm test` não executa automaticamente a suíte Vitest adicionada.
- Há rotas `app/api/logins/route.ts`, `app/api/logins/bulk/route.ts` e `app/api/logins/auto-connect/route.ts` na versão revisada. Confirme dependentes, então complete a remoção aprovada ou documente a dependência que exige preservá-las. Não diga “zero referências” sem conferir.
- Confira migrações e RPCs necessários aos fluxos ativos. Remover um arquivo SQL não remove objetos do banco já existente; não execute DROP indiscriminadamente. Uma reconstrução limpa de teste deve ter todos os objetos necessários.
- Para testes de integração, exija uma base de teste explícita. Não use automaticamente credenciais de produção encontradas no ambiente.
- Execute typecheck, suíte padrão corrigida, testes de integração pertinentes e build. Quando Docker estiver disponível, valide a imagem e o healthcheck. Se algo não puder ser executado, registre precisamente a limitação; não marque como aprovado.

## Critérios para considerar concluído

- Postar cria a quantidade correta, com ordem e horários verificáveis.
- Prioridade é salva e aplicada por Postar, Loop e sincronização.
- Diversidade funciona nos casos com solução; escassez é equilibrada dentro das restrições.
- Retry e concorrência não criam trabalho duplicado nem retomam execução viva.
- Usuários não alteram Loops ou arquivos alheios.
- Campanha incompleta não fica ativa por acidente.
- Configuração VPS é coerente com código, dependências, domínio pendente e frequência dos crons.
- O comando de testes executa a cobertura relevante e não aponta para arquivos removidos.

Entregue um resumo objetivo das alterações, testes executados e resultados, migrações necessárias, limitações verificáveis e roteiro de implantação/rollback. Separe fatos testados de hipóteses. Atualize a documentação para refletir o comportamento final.

Depois dessas correções, liste como sugestões futuras, sem implementá-las automaticamente: prévia da fila por conta antes de confirmar, painel de saúde com último cron e motivo de bloqueio, e retry seletivo de falhas sem duplicar sucessos. Verifique o que já existe antes de propor componentes novos.
