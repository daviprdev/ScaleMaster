# Prompt independente para um chat novo — API oficial da Meta e pendências do ScaleMaster

Você está começando um chat novo, sem histórico. Todo o contexto necessário está neste pedido. Trabalhe no projeto ScaleMaster para corrigir, configurar e validar a integração oficial da Meta/Instag 
ram e as pendências de produção descritas abaixo. Faça a implementação e os testes; não entregue apenas sugestões ou um plano.

## Contexto do projeto

O ScaleMaster, anteriormente chamado AutoScale, é um SaaS de gestão e publicação de conteúdo no Instagram. Tem frontend/backend Next.js com App Router, TypeScript e React, banco/autenticação/Storage no Supabase e processamento de mídia com FFmpeg. Algumas funções de scraping usam um serviço Python e outras usam Apify. A conexão e publicação oficial no Instagram usam Instagram Login e Graph API; não confunda esses fluxos com scraping, RPA ou login por senha.

- Repositório: `https://github.com/daviprdev/ScaleMaster.git`.
- Diretório local conhecido: `C:\Users\davip\OneDrive\Documentos\ScaleMaster`.
- Domínio de produção: `https://scalemaster.tech`.
- VPS: `2.25.244.181`, IPv6 `2a02:4780:75:828b::1`.
- SSH utilizado na auditoria: `root@2.25.244.181`, com chave já disponível naquele ambiente. Verifique seus acessos; não imprima nem peça a chave privada no chat.
- Código na VPS: `/opt/autoscale`.
- Container principal: `autoscale-app-1`, serviço Next.js na porta local 3000, atrás de Nginx com HTTPS.
- Supabase atualmente usado pela VPS: projeto `nulhkxjpsulkoygmralf`; confirme que é o projeto pretendido, sem criar outra base ou substituir dados.
- Hospedagem antiga: `https://autoscale-ia.vercel.app`.
- Worker RPA legado: `/opt/worker-rpa`, container `worker-rpa-rpa-worker-1`.

A arquitetura desejada é hospedagem e serviços próprios na VPS, mantendo o Supabase existente. Integrações necessárias com Meta, Apify, push e provedores de webhook continuam sendo serviços externos do produto. Não remova funcionalidades para poder afirmar que só existem dois fornecedores.

## Trabalho simultâneo e limites desta tarefa

Outro chat do Claude pode estar concluindo a migração Vercel → VPS. Esta tarefa concentra-se na API oficial da Meta, segurança do OAuth e pendências abaixo; não precisa repetir nem comandar o descomissionamento da Vercel.

Antes de editar, leia as instruções do repositório, inspecione alterações locais, histórico e o estado real da VPS. Há mudanças de interface/marca e infraestrutura feitas por outros trabalhos. Preserve-as e mantenha suas alterações identificáveis. Não faça reset, clean, checkout destrutivo ou deploy sobre código antigo.

Houve divergência entre GitHub e código implantado; não presuma qual cópia está mais atual nem aplique commits apenas pelo hash informado em algum documento. Compare as versões relevantes. Use uma branch/checkout apropriada e registre o commit base sem perder mudanças não commitadas. Não faça alterações concorrentes no mesmo arquivo sem primeiro identificar o estado atual.

Se outra implantação estiver ocorrendo, avance com leitura, correções isoladas e testes. Antes de modificar containers, variáveis, SQL ou timers compartilhados, confirme que não haverá disputa com o outro trabalho. Se isso não puder ser estabelecido, entregue a mudança pronta para integração e solicite apenas a coordenação necessária para a implantação. Não inicie dois deploys nem dois agendadores de produção.

Preserve o mesmo Supabase, contas, arquivos, chaves de criptografia, apps Meta existentes e estado de ativação das contas. Não exponha segredos em terminal, commits, relatórios ou mensagens. Faça consultas restritas, agregadas ou com campos mínimos; não exporte tabelas sensíveis. Não publique conteúdo, envie notificações ou fabrique vendas em contas reais para testar.

Execute autonomamente as correções reversíveis dentro deste escopo. Pergunte apenas por acesso ausente, conta de teste, decisão indispensável de produto ou coordenação real de implantação. Apresente mudanças concretas antes de pedir uma autorização que ainda seja necessária. Não exclua projeto Vercel, cancele assinatura, apague volumes/dados ou substitua o Supabase nesta tarefa.

O diagnóstico a seguir é um retrato de 09/10/2026 e pode ter mudado durante a migração. Revalide cada ponto; não reverta uma correção já aplicada nem trate evidência antiga como estado atual. Nenhum arquivo de prompt anterior é necessário para entender ou executar este pedido.

## 1. Diagnóstico confirmado

Verificação em 09/10/2026, aproximadamente 21h50–21h56, America/Sao_Paulo. VPS `2.25.244.181`, aplicação `/opt/autoscale`, container `autoscale-app-1`, Supabase `nulhkxjpsulkoygmralf`.

### Integração oficial existente

- O projeto implementa **Instagram API com Instagram Login**, usando `www.instagram.com/oauth/authorize`, `api.instagram.com/oauth/access_token`, `graph.instagram.com`, criação de containers de mídia e `media_publish`.
- OAuth global iniciado na VPS respondeu 307 para o Instagram, com App ID numérico e `redirect_uri=https://scalemaster.tech/api/instagram/callback`.
- Os scopes enviados eram `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments` e `instagram_business_manage_insights`.
- `NEXT_PUBLIC_META_CLIENT_ID` está preenchido com ID numérico. **`META_CLIENT_SECRET` está ausente/vazio no container**. O callback global precisa dele, portanto esse caminho está incompleto.
- A aplicação também suporta apps por usuário, na tabela `user_meta_apps`. Foram encontrados **3 apps**, com IDs numéricos e segredos criptografados que a chave atual da VPS consegue descriptografar: 3 sucessos, 0 falhas; os valores têm formato plausível de App Secret. Não foram mostrados segredos nem enviados à Meta. Isso não confirma validade/revogação, associação correta entre ID e segredo ou aprovação da Meta.
- O banco configurado na VPS retornou **0 contas em `instagram_accounts`**, inclusive 0 contas com token Meta. Não foi possível validar perfil, permissões ou publicação com um token existente.
- Não houve acesso autenticado ao Meta Developer Console. Redirect permitido, modo do app, permissões/aprovações, testers e propriedade dos apps permanecem sem confirmação.

Conclusão: a API oficial está implementada, mas seu funcionamento em produção ainda não foi comprovado. Não é necessário reescrever tudo, nem é correto afirmar que nenhum app está configurado.

### Pendências adicionais confirmadas

1. **Tokens nos logs:** `app/api/instagram/callback/route.ts`, aproximadamente linhas 146 e 191, registra `JSON.stringify(data)` da troca do código e do token de longa duração. Respostas bem-sucedidas contêm `access_token`, portanto o código pode gravá-lo em logs. O padrão também existe no checkout da VPS. A auditoria não extraiu tokens dos logs nem provou exposição histórica concreta.
2. **Contexto do magic link:** o callback aceita o destino `userId` do cookie `ig_oauth_magic_user_id`; a comparação de state é feita contra outro cookie. Não foi identificada assinatura desse contexto ou resolução server-side da transação OAuth no fluxo inspecionado. Trate como falha de integridade a corrigir e comprovar com testes isolados, sem explorar contas reais.
3. **Erro OAuth sem página:** rotas de magic link/callback redirecionam para `/add/error`, mas o endpoint retornou 404 e a página não existe no código inspecionado.
4. **Diagnósticos incorretos:** `/api/admin/meta-debug` verifica `NEXT_PUBLIC_INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`, enquanto o fluxo global usa `NEXT_PUBLIC_META_CLIENT_ID` e `META_CLIENT_SECRET`. `/api/debug-env` monta scopes de comentários/insights diferentes dos usados na rota real.
5. **Apify:** o conjunto efetivo `APIFY_API_TOKEN` + `APIFY_API_TOKENS` contém um único token, e ele é um placeholder de exemplo. Isso é uma configuração inválida; não houve execução de actor nem consumo de créditos para testar.
6. **Push:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` estão ausentes. `/api/push/vapid-public-key` respondeu HTTP 500.
7. **Webhooks globais:** `SHARKBOT_WEBHOOK_SECRET` e `APEXVIPS_WEBHOOK_SECRET` contêm placeholders. Além disso, as rotas globais continuam processando quando a variável está ausente: apenas registram aviso. As rotas por token de usuário são um fluxo diferente e não devem ser declaradas quebradas automaticamente.
8. **Healthcheck:** o container recriado em 09/10/2026 às 21h45 estava `unhealthy` às 21h55. O check usa `wget --spider -q http://localhost:3000/api/health` e registra `Connection refused`. A mesma rota retornou 200 pelo host; dentro do container, requisições feitas com Node para `localhost` e `127.0.0.1` também retornaram 200. Não se trata de prova de indisponibilidade total; alinhe a sonda ao runtime/rede reais, sem mascarar falhas.
9. **Scraper Python:** URL e segredo continuavam ausentes no ambiente consultado; configurar o servidor Python necessário ao scraping, conforme os requisitos operacionais abaixo.

Mudança observada desde o relatório anterior: a última execução de `publish-scheduled`, às 21h54 de 09/10, apresentou `Result=success` e saída 0. Não repita como estado atual que todas as execuções continuam falhando; confirme a correção e teste o comportamento com dados controlados. Não havia conta conectada para comprovar publicação real. `analytics-sync` ainda mostrava como último resultado a falha da execução anterior; isso não comprova se a configuração recém-editada já está corrigida.

## 2. Corrigir primeiro a segurança do OAuth

- Remova logs de corpos que contenham tokens, authorization codes, App Secrets, state ou cookies sensíveis. Use diagnóstico sanitizado com etapa, status HTTP, código de erro e identificador de correlação. Revise também URLs de erro e logs de proxy/acesso, sem imprimir seus segredos.
- Verifique exposição histórica de forma restrita, sem copiar tokens para relatórios. Se houver credenciais efetivamente expostas, proponha/execute a revogação e reconexão apropriadas conforme autorização e impacto. Não regenere `ENCRYPTION_SECRET`: isso pode inutilizar os apps já cadastrados.
- Vincule o contexto OAuth a uma transação server-side, com nonce, expiração e consumo atômico de uso único. Se usar contexto assinado, trate também replay e consumo. Não confie no `user_id` recebido em cookie sem validação de integridade e autorização.
- Associe a transação ao dono correto, app escolhido, fluxo normal/magic link e sessão aplicável. Resolva novamente a propriedade do app e a validade do magic link no servidor. Não mude a semântica de um link compartilhável de convite sem necessidade: a transação OAuth deve ter proteção própria contra replay.
- Proteja também o início do fluxo e impeça seleção de app de outro usuário. HttpOnly/Secure/SameSite e comparação entre cookies não substituem a integridade do contexto.
- Teste adulteração de dono/app/state, state expirado/reutilizado, cookie ausente, cancelamento, callback normal e magic link, concorrência e isolamento entre usuários com fixtures isoladas. Não execute ataques sobre dados reais.
- Restaure uma página pública de erro funcional ou direcione para uma existente. Mostre mensagem útil sem revelar credenciais, tokens ou detalhes sensíveis de infraestrutura.

## 3. Concluir configuração global e apps por usuário

Identifique como os usuários realmente conectam contas. Preserve os três apps cadastrados, suas associações e a criptografia.

- Se o produto oferecer um app global, configure o App Secret correto desse App ID usando um canal seguro e implante a variável no runtime. Não copie aleatoriamente o segredo de um dos apps por usuário para o ambiente global.
- Se o produto operar exclusivamente com apps por usuário, remova o fallback global incompleto da experiência e exija a seleção de um app configurado. Não apresente um botão que só falhará no callback.
- Resolva essa decisão pelo fluxo já existente e contexto do produto; pergunte apenas se for indispensável. Não crie um novo app Meta sem verificar os existentes.
- Centralize configuração, URL de callback, scopes e validação de credenciais para que rotas de OAuth e diagnósticos usem a mesma fonte.
- Corrija os endpoints de diagnóstico para distinguir configuração global e por usuário, sem expor secrets. Não informe “não configurado” apenas por consultar nomes antigos de variáveis.
- Confira o caminho de reconexão e fallback de upsert: deve atualizar a associação `meta_app_id` quando o app realmente mudar, preservando propriedade, estado de ativação e integridade dos tokens.

## 4. Conferir o painel Meta e comprovar integração

Use a documentação oficial atual e o painel do app correto. Não misture Instagram Login com Facebook Login ou com produtos antigos. O código usa majoritariamente Graph v21.0 e possui um caminho legado de refresh via Facebook v19.0; verifique suporte e adequação das versões e centralize-as quando fizer sentido. Não conclua que uma versão está desativada sem verificar a documentação vigente.

Para cada app utilizado:

- Confirme ID e segredo do produto correto, propriedade e conta profissional compatível.
- Cadastre/valide exatamente `https://scalemaster.tech/api/instagram/callback` nos redirects permitidos; confira domínio e URLs exigidas pelo caso de uso.
- Verifique modo de desenvolvimento/produção, papéis/testers e permissões/acesso necessários para contas de clientes. Permissões solicitadas na URL não provam permissões aprovadas ou concedidas.
- Verifique necessidade de App Review, Advanced Access, verificação da empresa e demais exigências aplicáveis ao caso real. Não invente aprovação nem prometa prazo da Meta. Testes internos que funcionam não comprovam acesso liberado a clientes.
- Verifique política de privacidade, termos, exclusão de dados e desautorização quando exigidos. Não apresente páginas vazias como atendimento dos requisitos.
- Mantenha permissões mínimas suficientes para as funções efetivas: perfil, publicação, comentários e insights conforme o produto. Não amplie para ads/messaging sem necessidade.

Como o banco está sem contas Instagram, confirme que a VPS usa o projeto Supabase de produção pretendido e obtenha uma conta profissional de teste autorizada para o fluxo. Não interprete zero registros como prova de perda de dados nem importe/duplique bases automaticamente.

Com uma conta de teste:

1. Complete OAuth no domínio novo e comprove troca por token de longa duração, perfil e associação ao usuário/app corretos.
2. Confirme permissões concedidas, expiração e comportamento de revogação/reconexão.
3. Faça primeiro chamadas de leitura restritas para validar perfil e acesso.
4. Valide criação/publicação e métricas com conteúdo e conta de teste autorizados. Um GET bem-sucedido de perfil não demonstra permissão de publicar. Nunca publique nas contas de clientes só para testar.
5. Valide a renovação conforme as regras aplicáveis da Meta, sem tentar forçar refresh de token que ainda não atende aos requisitos.

Se depender de login, 2FA, conta de teste ou aprovação humana da Meta, deixe o sistema preparado e liste exatamente o passo pendente. Continue as outras correções e não declare a integração aprovada antes da evidência.

## 5. Resolver as demais configurações de produção

- **Apify:** recupere/configure uma credencial real autorizada se a funcionalidade continuar no produto. Valide com consulta mínima que não inicie actor nem gere cobrança desnecessária. Bloqueie placeholders e informe corretamente indisponibilidade; não transforme falha de credencial em falso rate limit.
- **Push:** preserve as chaves VAPID existentes, se houver, e configure subject válido. Se não existirem, gere/configure novas chaves de forma segura e trate inscrições antigas/reinscrição quando necessário. Não envie notificações de teste para clientes; use inscrição de teste.
- **Webhooks:** rejeite processamento quando o segredo obrigatório estiver ausente ou for placeholder. Prefira verificação de autenticidade compatível com o provedor; use comparação apropriada e proteção contra duplicação. Audite separadamente as rotas globais e por token. Atualize o segredo do provedor coordenadamente para não interromper eventos reais. Não registre segredos em query strings/logs nem envie vendas falsas para testar.
- **Healthcheck:** corrija a sonda com um mecanismo que funcione na imagem implantada, verificando resposta e status; Node já conseguiu acessar o endpoint dentro desse container. Confirme múltiplos checks bem-sucedidos e `healthy` após a correção, sem retornar sucesso incondicional.
- **Scraper e timers:** verifique primeiro o que o chat de migração já resolveu. Se ainda faltar, configure o serviço `python_server` na VPS com `PYTHON_SERVER_URL` alcançável a partir do container Next.js, `PYTHON_SERVER_SECRET`, autenticação, restart e healthcheck. Prefira comunicação privada entre containers; localhost de um container não representa outro serviço. Preserve o scraper de contas leitoras sem reativar automaticamente o RPA obsoleto. Não crie um segundo agendador. Revalide os resultados depois do deploy, separando sucesso sem trabalho, tarefa pulada e execução funcional.
- Adicione validação de configuração por funcionalidade para detectar valores de template, segredos ausentes e combinações inconsistentes antes de anunciar que o serviço está pronto.

### Verificação das pendências de infraestrutura que afetam estes fluxos

O inventário da auditoria inicial identificou 15 timers systemd chamando a aplicação em `http://127.0.0.1:3000`. Confira as unidades e as alterações em andamento, em vez de reinstalá-las indiscriminadamente.

- `analytics-sync` precisa enviar POST, pois `/api/analytics/sync` não aceita GET. Uma falha antiga registrada pode permanecer até a próxima execução; valide configuração e resultado atual.
- `publish-scheduled` chegou a falhar por relacionamento entre `scheduled_posts` e `distribute_campaigns`. A última amostra já apresentou sucesso. Confirme que o problema foi resolvido e que os casos com campanhas/stories/reels continuam corretos; não acrescente FKs ou altere consultas sem examinar schema, migrações e dados mínimos necessários.
- O timeout antigo de publicação era 55 segundos, embora o handler previsse até 250 segundos. Confira a configuração atual, orçamento, cancelamento e idempotência; matar curl não garante cancelamento no Node.
- O worker RPA legado tinha `SAAS_BASE_URL` apontando para a Vercel e gerava links `/add/{token}`, rota já removida. Informe essa dependência ao responsável pela migração se ainda existir. Não troque somente o domínio nem apague o worker com jobs/dados sem verificar seu uso.
- Revise Supabase Auth Site URL/Redirect URLs, callbacks Meta e URLs de webhooks para o domínio novo. Preserve segredos e serviços vinculados, sem assumir que alterar o frontend muda os endereços cadastrados nos provedores.

Essas verificações não autorizam competir com o deploy de outro chat. Quando um item já tiver responsável e correção em andamento, registre a situação e integre sua mudança na ordem apropriada.

## 6. Entrega e critérios de aceite

Versione e implante as alterações necessárias sem destruir o trabalho de interface ou migração que já esteja em andamento. Faça testes relevantes de OAuth, autorização, isolamento, sanitização e falha de configuração; não dependa apenas de testes que procuram strings no código.

Entregue um relatório curto com:

- Arquivos/commits e versão efetivamente implantada.
- Status separado do app global e dos apps por usuário.
- Configuração local, situação no painel Meta e integração real: cada uma com evidência ou pendência explícita.
- Ausência de tokens/segredos nos novos logs e proteção comprovada do contexto OAuth.
- Resultado dos fluxos normal e magic link, incluindo erros, reconexão e seleção de app.
- Estado final de Apify, push, webhooks, Python, healthcheck e agendamentos.
- Ações mínimas que dependem de acesso, aprovação Meta ou conta de teste, sem expor credenciais.

Não afirme “API Meta 100% configurada” apenas porque existe um App ID, uma URL de OAuth, três segredos descriptografáveis ou um container saudável. A conclusão exige fluxo autorizado e testes compatíveis com as funcionalidades utilizadas.

## Referências para verificação

- Código: `app/api/instagram/auth/route.ts`, `app/api/instagram/callback/route.ts`, `app/add/oauth/[token]/route.ts`, `app/api/apps/route.ts`, `lib/meta-publish.ts`, `lib/meta-refresh.ts`, `lib/meta-insights.ts`, `lib/encrypt.ts`.
- Instagram API com Instagram Login: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
- Business Login: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/
- Coleção mantida pela Meta no Postman: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- Versões Graph API: https://developers.facebook.com/docs/graph-api/changelog/versions

Na auditoria, parte da documentação Meta retornou login obrigatório ou HTTP 429. Verifique os detalhes vigentes em acesso autorizado; não trate a lista de scopes do código como comprovação documental de compatibilidade atual.

