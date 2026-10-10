# Prompt complementar — API oficial da Meta e pendências de produção

Continue o trabalho de migração descrito em `docs/prompts/05-migracao-completa-vps-sem-vercel.md` e incorpore este diagnóstico. Não inicie uma segunda implantação concorrente nem sobrescreva alterações que já estejam em andamento. Revalide o estado antes de corrigir: houve recriação do container durante a auditoria.

Objetivo: concluir a configuração e comprovar o funcionamento da API oficial da Meta/Instagram no ScaleMaster hospedado em `https://scalemaster.tech`, preservando Supabase, dados e apps cadastrados. Corrija também as pendências confirmadas abaixo. Não confunda integração implementada no código, configuração local válida e autorização real concedida pela Meta.

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
9. **Scraper Python:** URL e segredo continuavam ausentes no ambiente consultado; resolver conforme o prompt de migração.

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
- **Scraper e timers:** integre às correções do prompt 05, sem gerar um segundo agendador. Revalide os resultados depois do deploy, separando “success sem trabalho”, “skipped” e execução funcional.
- Adicione validação de configuração por funcionalidade para detectar valores de template, segredos ausentes e combinações inconsistentes antes de anunciar que o serviço está pronto.

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
