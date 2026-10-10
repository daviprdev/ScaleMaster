# Prompt para o Claude — concluir a migração do ScaleMaster e retirar a Vercel

Execute o trabalho abaixo no projeto ScaleMaster. Quero concluir a migração da hospedagem para minha VPS, mantendo o mesmo Supabase gerenciado, e eliminar toda dependência operacional da Vercel. Faça as correções, sincronize o código, implante, valide o funcionamento e conduza o descomissionamento. Não entregue apenas um plano ou alterações locais como se a migração estivesse concluída.

## 1. Objetivo e escopo

Arquitetura final:

- VPS: aplicação Next.js, backend, processamento de vídeo/FFmpeg, servidor Python necessário ao produto, agendamentos e proxy reverso com HTTPS.
- Supabase existente: PostgreSQL, Auth e Storage. Preserve usuários, dados, arquivos, políticas e identificadores atuais.
- GitHub: fonte de verdade do código e do procedimento reproduzível de implantação.
- Vercel: nenhuma dependência de hospedagem, funções, agendamentos, deploy, URLs, callbacks ou serviços vinculados necessários ao funcionamento.

“Apenas VPS e Supabase” refere-se à infraestrutura de hospedagem e persistência do sistema. Integrações funcionais com Instagram/Meta, provedores de proxy, webhooks, push e Apify devem ser inventariadas e preservadas. Não remova funcionalidades nem reescreva uma integração funcional apenas para eliminar menções a terceiros. Identifique expressamente qualquer serviço externo que ainda execute trabalho, como Apify, sem afirmar que absolutamente todo processamento ocorre na VPS. Se houver uma dependência adicional de hospedagem própria, por exemplo um backend em Railway, inclua sua migração para a VPS.

Execute autonomamente as correções e a implantação necessárias dentro deste escopo. Pergunte apenas por acesso ausente, decisões de produto indispensáveis ou ações irreversíveis. Prepare o resultado concreto antes de pedir autorização final para excluir o projeto Vercel, cancelar assinatura ou apagar dados/volumes. Uma autorização para uma dessas ações não autoriza automaticamente as demais.

## 2. Contexto e evidências já levantadas

- Repositório: `https://github.com/daviprdev/ScaleMaster.git`.
- Diretório local: `C:\Users\davip\OneDrive\Documentos\ScaleMaster`.
- Produção: `https://scalemaster.tech`.
- VPS: `2.25.244.181`, IPv6 `2a02:4780:75:828b::1`.
- SSH usado na auditoria: `root@2.25.244.181`, com a chave local já disponível. Não imprima nem copie a chave privada.
- Aplicação na VPS: `/opt/autoscale`, container `autoscale-app-1`, porta `127.0.0.1:3000`.
- Worker legado: `/opt/worker-rpa`, container `worker-rpa-rpa-worker-1`.
- Supabase em uso na VPS: projeto `nulhkxjpsulkoygmralf`. Confirme que é o projeto correto e preserve-o.
- Endereço antigo: `https://autoscale-ia.vercel.app`.
- Relatório: `docs/verificacao-vercel-vps-2026-10-09.md`.

Leia esse relatório primeiro. As evidências foram coletadas em 09/10/2026, aproximadamente 21h20–21h25 no fuso America/Sao_Paulo. Revalide o estado atual; os números e commits abaixo são um retrato daquele momento.

Confirmado naquela auditoria:

1. DNS A e AAAA apontavam para a VPS. HTTPS, login e `/api/health` respondiam 200; container saudável havia cinco dias. Isso não demonstrou funcionamento integral dos fluxos.
2. Os 15 timers systemd estavam habilitados e ativos, acessando a aplicação localmente. Dois falhavam e um pulava o trabalho.
3. `publish-scheduled`: 1.440 falhas em 24 horas, com mensagem `Could not find a relationship between 'scheduled_posts' and 'distribute_campaigns' in the schema cache`.
4. `analytics-sync`: timer enviando GET para `/api/analytics/sync`, que exporta apenas POST. HTTP 405 confirmado.
5. `process-scrape-jobs`: 288 execuções puladas porque `PYTHON_SERVER_URL` não estava configurado. `PYTHON_SERVER_SECRET` também estava ausente/vazio.
6. Worker legado ativo com `SAAS_BASE_URL=https://autoscale-ia.vercel.app`; `/opt/worker-rpa/worker.py:129` usa a variável para gerar links `/add/{token}`. Essa rota antiga foi removida do SaaS atual.
7. `main` no GitHub e HEAD local: `b1adcf7`. Checkout da VPS: `906fda2`, com quatro commits posteriores na sequência observada e alteração local em `next.config.ts`.
8. `NEXT_PUBLIC_APP_URL=https://scalemaster.tech` estava correto. `NEXT_PUBLIC_REDIRECT_BASE_URL` ainda continha `https://your-domain.com`, sem consumo identificado no código inspecionado.
9. A URL antiga da Vercel continuava respondendo. `vercel.json` ainda tinha deploy de `main` habilitado e 15 crons. Não foi confirmado se a integração Git ou os crons estavam ativos no painel.
10. Não foram auditados os painéis autenticados de Vercel/Supabase, redirects da Meta nem configurações externas de webhooks.

## 3. Preservar o trabalho existente e reconciliar GitHub/VPS

Antes de qualquer pull, checkout, build ou deploy:

- Leia as instruções aplicáveis do repositório e inspecione status, branches, remotes e histórico local e da VPS.
- Existem alterações locais de interface, marca e outros arquivos feitas pelo usuário. Preserve-as. Não use reset/clean ou sobrescrita indiscriminada.
- Examine os commits presentes somente na VPS e o diff de `next.config.ts`. Traga as correções necessárias para uma branch de trabalho sem perder mudanças locais. Verifique ancestralidade, não apenas mensagens dos commits.
- Registre a imagem/container atual e prepare backup protegido das configurações necessárias e dos dados locais relevantes. Não inclua segredos em commits, relatórios ou artefatos públicos.
- Verifique backup recuperável do Supabase antes de mudanças de schema. Faça consultas específicas de estrutura e contagens; não despeje tabelas de usuários ou credenciais para diagnosticar uma FK.
- Ao final, publique as mudanças no repositório correto, conforme a política de branches, e identifique o commit realmente implantado. Não considere um commit existente apenas no disco da VPS como código sincronizado.

## 4. Corrigir publicação agendada na causa

Inspecione a versão realmente implantada de `app/api/cron/publish-scheduled/route.ts`, a consulta de stories/posts, as tabelas `scheduled_posts` e `distribute_campaigns`, suas migrações, chaves, constraints e regras de acesso.

Determine se o problema é FK ausente/incorreta, relacionamento ambíguo, schema/cache, migração faltante ou consulta incompatível. Não presuma que remover `!inner` resolve: uma alteração com essa intenção já estava no histórico da VPS e o erro persistia.

Implemente a correção mínima consistente com o modelo de dados. Se for necessária migração SQL, versione-a, verifique dados órfãos com consultas restritas e aplique na ordem segura. Se consultas separadas forem mais adequadas, preserve filtros, escopo por usuário, associação de campanha, desempenho e comportamento de posts sem campanha. Não esconda o erro retornando sucesso vazio.

Preserve claims atômicos, idempotência, tentativas limitadas e estados de publicação. Valide stories e reels agendados, com e sem campanha, fila vazia e prevenção de processamento duplicado. Separe testes com mocks dos testes de integração. Não publique em contas reais de clientes para testar; use conta de teste explicitamente indicada/autorizada quando for necessário comprovar a integração real.

## 5. Corrigir todos os agendamentos

Use `vercel.json`, o gerador e as unidades instaladas para montar um inventário com: nome, endpoint, método HTTP, frequência, fuso, timeout, última execução, resultado e finalidade.

Crie uma fonte de verdade dos agendamentos independente de `vercel.json`. Migre as 15 entradas existentes, incluindo `/api/analytics/sync`, e atualize o gerador e os testes que dependem do arquivo antigo antes de removê-lo.

- Corrija `analytics-sync` para enviar POST com autenticação. Não torne a rota pública para contornar o erro.
- Preserve a frequência de um minuto de `publish-scheduled` e as demais frequências funcionais. Declare o fuso das agendas; diferencie horário operacional de regras de negócio em Brasília.
- Valide os próximos disparos com `systemd-analyze calendar` e as unidades com as ferramentas disponíveis no servidor.
- Revise o timeout de 55 segundos de `publish-scheduled` frente ao orçamento de até 250 segundos do handler. Parar curl não garante cancelamento do trabalho no Node. Considere sobreposição com disparos manuais e assegure exclusividade/idempotência no banco.
- Faça os serviços registrarem status HTTP, duração e erro sanitizado suficiente para diagnóstico, sem imprimir tokens ou dados pessoais.
- Distinga sucesso, erro e tarefa pulada; configuração obrigatória ausente não pode ser reportada como migração funcional.
- Compare o inventário do painel Vercel com o da VPS e mantenha um único agendador de produção. Nunca teste a fila disparando ambos ao mesmo tempo.

## 6. Servidor Python e worker legado

O scraper de contas leitoras e o RPA antigo são componentes distintos. Remover RPA não autoriza quebrar scraping.

Inspecione `python_server`, `lib/python-server.ts`, contas leitoras e `process-scrape-jobs`. Implante na VPS o serviço Python exigido pelas funcionalidades preservadas, com dependências, autenticação, healthcheck, reinício e limites adequados.

Configure `PYTHON_SERVER_URL` para um endereço alcançável a partir do container Next.js, preferencialmente pela rede privada do Compose. `127.0.0.1` dentro de um container aponta para ele próprio; não use esse endereço para outro container sem justificar a topologia. Configure o segredo sem expô-lo ao frontend e evite abrir a API interna publicamente.

Valide scraping com um caso controlado, tratamento de indisponibilidade, timeout e recuperação de jobs. Diferencie esse fluxo da Apify.

Para o worker legado:

- Verifique consumidores, jobs pendentes/em execução, persistência e necessidade atual com dados mínimos.
- Se estiver obsoleto, desative seu processamento e reinício após preservar os dados e confirmar que não interrompe trabalho necessário. Não apague volumes ou históricos automaticamente.
- Se ainda houver uso necessário, migre o fluxo de forma compatível. Trocar somente `SAAS_BASE_URL` não resolve a ausência da rota `/add/{token}`.
- Ao concluir, nenhum processo ativo pode depender de um endpoint da Vercel.

## 7. Configuração, build e operação da VPS

Revise `Dockerfile`, Compose, Nginx, scripts e templates com base no estado efetivo do servidor.

- Preserve exatamente `ENCRYPTION_SECRET` e as chaves necessárias aos dados atuais. Não regenere chaves para resolver erro de configuração. Preserve também credenciais VAPID e demais segredos funcionais.
- Compare variáveis usadas pelo código com as fornecidas no build/runtime. Remova ou corrija placeholders e variáveis obsoletas, incluindo `NEXT_PUBLIC_REDIRECT_BASE_URL` se não tiver função.
- Configure variáveis públicas de build do Next.js explicitamente e segredos somente onde forem necessários. Não exponha service role, chaves privadas ou segredos em bundles, argumentos públicos, logs ou imagens compartilhadas.
- Proteja `.env.production`, `.env.cron`, backups e arquivos locais no Git e no contexto Docker. Templates devem conter somente exemplos.
- Verifique compatibilidade entre Node, lockfile e dependências. Evite upgrades amplos sem relação com a migração; resolva/documente conflitos existentes.
- Valide FFmpeg, diretórios temporários, permissões, limpeza, limites de CPU/memória, disco e rotação de logs.
- Separe processo vivo de prontidão real quando necessário. O healthcheck atual verifica presença de configuração e não prova acesso funcional ao banco. Faça uma checagem restrita e apropriada sem expor estado interno ao público.
- Revise Nginx, certificado de `scalemaster.tech`, renovação TLS, IPv4/IPv6, upload e timeouts. Não substitua uma configuração válida por um template com domínio fictício.
- Verifique se a restrição de `/api/cron/` bloqueia `/api/cron/force-run`, usado pelo painel. Preserve as ações autenticadas necessárias sem abrir os crons internos ao público.
- Configure confiança em cabeçalhos do proxy corretamente. Remova a dependência de `x-vercel-ip-country/city` ou trate geolocalização como indisponível; não aceite cabeçalhos públicos arbitrários como informação confiável.
- Entregue procedimento de deploy e rollback reproduzível na VPS, sem reinstalar dependência da Vercel.

## 8. Domínios, login, OAuth, webhooks e serviços vinculados

Audite código fonte, artefatos compilados, ambientes dos processos, banco em campos específicos de URLs e configurações dos provedores. Procure dependências funcionais de `vercel.app`, `VERCEL_*`, SDKs Vercel, Blob/KV/Redis/Storage, deploy hooks e callbacks.

Confira e atualize onde necessário:

1. Supabase Auth: Site URL, Redirect URLs, confirmação de cadastro, recuperação de senha e links de autenticação para `https://scalemaster.tech`.
2. Meta/Instagram: apps efetivamente usados, domínio, redirect OAuth, callback e eventuais URLs obrigatórias. Considere configurações por usuário/app, além das globais.
3. Sharkbot, ApexVips e outros webhooks: endereço registrado no provedor, autenticação, recebimento, processamento idempotente e resposta. Não basta atualizar a URL exibida no frontend.
4. Links gerados e já divulgados, magic links, páginas de sucesso/erro, service worker, PWA e notificações push. Considere a mudança de origem para sessões e inscrições push.
5. DNS: A, AAAA, CNAME, subdomínios, nameservers e eventual registro/renovação de domínio na Vercel. Preserve registros de e-mail e serviços não relacionados.
6. Serviços criados ou cobrados por integração/Marketplace da Vercel: determine se são independentes e como preservar dados e acesso, sobretudo Supabase. Não exclua o banco ou seus recursos como parte da retirada da hospedagem.

Não há controle próprio do DNS de `autoscale-ia.vercel.app`. Links antigos não continuarão funcionando automaticamente após a exclusão. Identifique consumidores, atualize-os e estabeleça a substituição antes de retirar o projeto. Um redirecionamento temporário na Vercel não satisfaz a arquitetura final sem Vercel.

Use integrações existentes ou painéis autenticados quando disponíveis. Se faltar acesso, indique exatamente qual ajuste ficou pendente e continue o restante; não declare essa etapa concluída por inferência a partir do código.

## 9. Implantação, validação e transição

Faça a implantação a partir do código reconciliado, com backup, validação prévia e caminho de reversão. Evite instâncias de teste consumindo filas de produção. Se pausar timers para a troca, preserve o estado anterior, retome de forma controlada e evite rajada de execuções acumuladas.

Verificações mínimas:

- Instalação/build, typecheck e testes relevantes aos comportamentos alterados.
- Subida dos containers e conectividade privada entre Next.js, Python e Supabase.
- Site, login, recuperação de senha e OAuth no domínio novo, com validação real quando houver conta de teste disponível.
- Biblioteca/upload/download/Storage, FFmpeg e criação/processamento de jobs necessários ao produto.
- Publicação agendada e fluxos de stories/reels com idempotência e falhas tratadas, sem produzir conteúdo em contas não autorizadas para testes.
- Sincronização de métricas por POST, renovação de tokens, filas, scraping e notificações.
- Webhooks com payload de teste controlado, sem fabricar transações reais nem notificar clientes involuntariamente.
- Reconstrução/recriação segura dos serviços para validar persistência e reinício automático, sem reboot desnecessário da VPS.

Observe as execuções naturais após as correções, inclusive tarefas de frequência diária, ou valide-as de forma controlada quando for apropriado. Registre uma janela de observação suficiente, preferencialmente 24 horas para cobrir o ciclo diário. Se essa janela ainda não terminou, entregue o estado como observação pendente e um meio concreto de monitoramento; não fabrique evidência nem prometa continuar depois sem mecanismo disponível.

Teste HTTP 200, fila vazia e container saudável não equivalem a teste funcional completo. Diferencie claramente testes automatizados, verificações de configuração, logs naturais e integrações reais.

## 10. Retirar a Vercel na ordem correta

Depois de verificar o substituto de cada função:

1. Preserve de forma protegida as configurações e segredos que ainda forem necessários. Nunca cole seus valores no relatório.
2. Garanta apenas um agendador ativo. Desative os crons da Vercel quando os equivalentes da VPS estiverem prontos; confirme no painel. Remover `vercel.json` localmente não desativa por si só o deployment já publicado.
3. Desconecte deploy automático, deploy hooks e integrações exclusivas do projeto antigo, sem afetar outros projetos da conta.
4. Remova `vercel.json` e dependências funcionais restantes após transferir o inventário para a configuração da VPS. Atualize testes e documentação; registros históricos podem permanecer identificados como históricos.
5. Com as validações e observação concluídas, apresente um resumo das evidências e peça a confirmação final para excluir o projeto Vercel identificado. Não exclua outro projeto, a conta/time, o Supabase nem recursos compartilhados.
6. Após a confirmação e exclusão, verifique novamente a operação pela VPS, os serviços e os agendamentos. Valide que a URL antiga deixou de ser um recurso necessário.
7. Confira cobrança/plano separadamente. Exclusão de projeto não deve ser tratada como prova de cancelamento da assinatura. Só cancele serviços pagos com autorização específica e sem afetar outros usos.

Se não tiver acesso para uma ação externa, entregue os passos exatos e o status “pendente de execução”. Não conclua “migração 100%” enquanto houver dependência funcional, verificação crítica ou descomissionamento necessário pendente.

## 11. Critérios de conclusão e entrega

O trabalho estará concluído quando:

- O código implantado estiver preservado e sincronizado com o repositório, incluindo as correções antes exclusivas da VPS.
- A hospedagem da aplicação e os serviços próprios necessários rodarem na VPS com HTTPS, restart, logs e deploy reproduzível.
- O Supabase original e seus dados/usuários/arquivos estiverem preservados e os fluxos validados.
- Todas as tarefas necessárias estiverem migradas e verificadas, sem os erros e skips indevidos identificados nesta auditoria.
- O worker legado tiver destino resolvido e não houver consumidor funcional do domínio Vercel.
- URLs externas, OAuth, Auth, webhooks e eventuais recursos vinculados estiverem conferidos e atualizados.
- Houver apenas um agendador de produção e nenhuma dependência operacional da Vercel.
- O descomissionamento autorizado tiver sido executado e a validação posterior tiver passado. Informe separadamente o estado de assinatura/cobrança.

Entregue no repositório um relatório final com: mudanças, commits, migrations, versão implantada, matriz dos agendamentos antes/depois, testes e evidências com horários, serviços finais, instruções de deploy/rollback e pendências reais. Não inclua segredos ou dados pessoais.

Na resposta final, informe objetivamente: o que foi corrigido, o que foi implantado, o que foi comprovado, o que ainda depende de acesso/autorização e se a Vercel está pronta para exclusão ou já foi efetivamente excluída. Nunca confunda “preparado”, “implantado”, “testado” e “desativado”.
