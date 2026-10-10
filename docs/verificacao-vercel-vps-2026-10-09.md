# Verificação da migração Vercel → VPS

Verificado em 09/10/2026, aproximadamente 21h20–21h25 (America/Sao_Paulo).

## Conclusão

A aplicação principal está hospedada na VPS, mas a desvinculação completa da Vercel e o funcionamento integral da migração não estão confirmados. **Não recomendo excluir o projeto Vercel neste estado.** Existem falhas operacionais confirmadas na VPS e um worker ativo ainda configurado para usar a Vercel.

Esta auditoria consultou código, DNS, HTTPS, configuração dos containers e logs via SSH. Não alterou serviços, banco, DNS ou Vercel e não disparou tarefas de publicação. O único arquivo criado foi este relatório.

## Confirmado em produção

- `scalemaster.tech` resolve para `2.25.244.181` e `2a02:4780:75:828b::1`. Ambos os endereços pertencem à VPS inspecionada.
- Os nameservers são `aster.dns-parking.com` e `helios.dns-parking.com`.
- `https://scalemaster.tech/api/health` respondeu HTTP 200 com `{"status":"ok"}`, servido por Nginx. A página de login também respondeu HTTP 200, com HTTPS validado.
- O container `autoscale-app-1` estava ativo e saudável há cinco dias, publicado em `127.0.0.1:3000`.
- `NEXT_PUBLIC_APP_URL=https://scalemaster.tech` está no ambiente da aplicação e o domínio aparece nos arquivos JavaScript compilados do frontend. Não foram encontradas referências a `autoscale-ia.vercel.app` nesses arquivos do frontend.
- As variáveis essenciais de Supabase, criptografia e autenticação dos crons estão presentes. O segredo dos timers corresponde ao da aplicação, sem exposição dos valores.
- Os 15 timers estão habilitados e ativos, chamando `http://127.0.0.1:3000`. Dois apresentaram falhas; outro termina com sucesso HTTP, mas pula o trabalho. Sucesso de processo nos demais não demonstra execução funcional com dados reais.
- Banco, autenticação e armazenamento continuam baseados em Supabase gerenciado, conforme a arquitetura planejada. A migração de hospedagem não significa mover esses serviços para a VPS.

## Impedimentos e pendências

### 1. Publicação agendada falhando

`autoscale-publish-scheduled.service` registrou **1.440 falhas e nenhuma conclusão bem-sucedida nas 24 horas consultadas**, com saída 22 do curl. Os logs da aplicação repetem:

> Could not find a relationship between 'scheduled_posts' and 'distribute_campaigns' in the schema cache

A rota implantada retorna HTTP 500 ao receber esse erro na consulta de stories. É preciso corrigir a consulta ou o relacionamento do banco e validar o processamento. Esta auditoria não determinou se a causa específica é uma constraint ausente ou outro problema de schema/cache. Os logs amostrados mostram filas vazias; não houve comprovação de publicação real.

### 2. Sincronização diária de métricas usa o método errado

`autoscale-analytics-sync.service` falhou na execução diária consultada. O serviço usa curl sem `-X POST`, portanto envia GET. A rota `/api/analytics/sync` exporta apenas POST; uma consulta GET local confirmou **HTTP 405**.

O gerador local reproduz esse problema: `scripts/generate-systemd-timers.sh:40` e `:63`. O método aceito consta em `app/api/analytics/sync/route.ts:48`.

### 3. Scraping por contas leitoras não está configurado

`PYTHON_SERVER_URL` e `PYTHON_SERVER_SECRET` não estão preenchidos no ambiente em execução. Os logs do timer registram **288 execuções puladas** nas últimas 24 horas com o motivo `PYTHON_SERVER_URL não configurado.`

Isso afeta o scraping por servidor Python/contas leitoras; não demonstra falha do fluxo separado da Apify. É preciso configurar o serviço se essa funcionalidade ainda fizer parte do produto.

### 4. Worker antigo mantém dependência da Vercel

O container `worker-rpa-rpa-worker-1` continua ativo, com:

`SAAS_BASE_URL=https://autoscale-ia.vercel.app`

O código `/opt/worker-rpa/worker.py:129` usa essa variável para montar links `/add/{token}`. Isso é uma referência funcional, não apenas documentação. O RPA foi removido do repositório atual, mas o container antigo permanece. É necessário confirmar que está sem uso e desativá-lo, ou migrar o fluxo ainda utilizado. Trocar apenas o domínio pode não bastar, pois a rota antiga foi removida do SaaS atual.

### 5. Estado da Vercel e integrações externas ainda não validado

- `https://autoscale-ia.vercel.app` e sua página de login continuam retornando HTTP 200 com `Server: Vercel`.
- O repositório mantém `vercel.json`, com deploy de `main` habilitado e 15 entradas de cron. Isso comprova configuração no código, mas **não comprova que o Git ou os crons estejam atualmente ativos no painel**.
- Não foi possível consultar o painel autenticado da Vercel, as URLs de Auth do Supabase, os redirects da Meta ou as configurações externas de Sharkbot/ApexVips. As integrações Vercel e Supabase foram sugeridas, mas não estavam conectadas durante a auditoria.
- É necessário confirmar que callbacks, webhooks e links divulgados não dependem de `autoscale-ia.vercel.app`, além de evitar dois agendadores consumindo as mesmas filas.

### 6. GitHub e VPS não estão sincronizados

- `main` no GitHub informado e o checkout local: `b1adcf7`.
- Checkout da VPS em `/opt/autoscale`: `906fda2`, contendo quatro commits posteriores na sequência observada.
- O checkout da VPS também tem alteração local em `next.config.ts`.

Um novo deploy baseado apenas no `main` atual pode perder correções existentes na VPS. É necessário revisar e preservar essas diferenças antes de padronizar o deploy.

## Resíduos adicionais

- `NEXT_PUBLIC_REDIRECT_BASE_URL` ainda contém `https://your-domain.com`. Não encontrei consumo dessa variável no código atual local ou no checkout da VPS, portanto não é uma quebra funcional demonstrada.
- `app/api/profile/sessions/route.ts:59–60` ainda lê cabeçalhos de geolocalização `x-vercel-*`, com fallback para `null`. A localização das sessões pode ficar ausente na VPS; isso não bloqueia o funcionamento principal.
- O timer de publicação tem timeout de 55 segundos, enquanto o código prevê orçamento de até 250 segundos. As falhas atuais ocorrem antes desse limite, mas o tempo precisa ser revisto para cargas reais.

## Condições para liberar a exclusão

1. Corrigir e validar publicação agendada e sincronização diária; decidir/configurar o scraping por Python.
2. Resolver o worker antigo e qualquer referência externa ao domínio da Vercel.
3. Conferir no painel Vercel os crons, domínios, integração Git, serviços vinculados e variáveis que precisem ser preservadas.
4. Validar login, OAuth, webhooks e processamento na VPS, mantendo um único agendador de produção.
5. Preservar as correções da VPS no repositório e garantir um deploy reproduzível.

A documentação oficial informa que excluir o projeto remove também seus deployments, domínios associados ao projeto, variáveis de ambiente e configurações: https://vercel.com/docs/projects/managing-projects . Por isso, a exclusão deve ocorrer após essas verificações.

## Limite de acesso aplicado

Uma tentativa de consulta ampla autenticada ao Supabase foi rejeitada pela revisão automática por risco de acesso além do necessário. Ela não foi executada. A auditoria prosseguiu com logs filtrados e leitura das configurações, suficientes para demonstrar os impedimentos acima; não houve leitura ampla de registros do banco.
