# Prompt completo — validar, corrigir e estabilizar o AutoScale-IA

Quero que você trabalhe no código do AutoScale-IA para validar os problemas abaixo, corrigir os que ainda existirem e implementar as melhorias necessárias de confiabilidade e deploy. Não quero apenas outro relatório ou plano: implemente, teste e entregue evidências do resultado.

O projeto está migrando da Vercel para uma VPS, mantendo o Supabase gerenciado. Um relatório anterior declarou todas as P1 concluídas, mas uma revisão do código encontrou falhas reproduzíveis mesmo com 18 testes unitários e typecheck passando. Trate o relatório como histórico, não como comprovação de que a implementação está correta.

## 1. Contexto e escopo

- Aplicação Next.js/TypeScript com Supabase Auth, banco e Storage.
- Publicação pela API oficial da Meta. Não implementar rotação de proxies para publicar e não prometer aumento de alcance por mudanças de IP. Preserve proxies usados separadamente no scraping, se existentes.
- Hospedagem pretendida: Docker na VPS, Nginx como proxy reverso e Certbot para HTTPS.
- VPS informada: 2 vCPU, 8 GB RAM, 100 GB de disco. Há outros serviços nessa máquina, então não suponha que todos os recursos estão disponíveis para o SaaS.
- Domínio da migração: `scalemaster.tech`. Confirme as configurações atuais antes de alterar referências.
- Meta futura: mais de 200 contas postando a cada 30 minutos. São 400 posts/hora com 200 contas, ou 600/hora com 300 contas. Essa capacidade ainda não foi comprovada.
- Preservar Postar, Loops, Biblioteca, Inspirações, legendas, processamento de mídia, horários, histórico, permissões e integrações ativas.
- Não reintroduzir funcionalidades removidas nem parar/remover serviços externos de RPA já existentes por inferência deste prompt.

Você pode editar o código local, testes, migrações ainda não aplicadas, configurações versionadas, documentação e scripts de deploy. Preserve alterações existentes e avance sem pedir confirmação para escolhas rotineiras de implementação.

Para ações externas, respeite as autorizações já dadas nesta conversa. Este prompt, isoladamente, não autoriza publicação real, alteração de dados em produção, execução de migrações no Supabase de produção, mudança de DNS, rotação efetiva de credenciais, desligamento de serviços, cancelamento de planos ou commit/push. Prepare o trabalho completo e revisável para essas etapas; não paralise as correções locais por depender delas.

Se houver acesso autorizado ao ambiente, faça verificações de leitura para distinguir o estado da VPS do código local. Nunca interprete uma resposta HTTP 200 de uma rota que executa publicações como uma simples consulta: não dispare crons reais para testar conectividade.

## 2. Primeiro, confira o estado atual

Leia integralmente:

- `docs/relatorio-migracao-vps-completo.md`;
- `docs/prompts/06-revisao-relatorio-vps-completo.md`;
- os arquivos citados nos problemas abaixo e seus chamadores;
- instruções do repositório e configurações reais de testes/build/deploy.

O documento 06 contém evidências da revisão sobre `b1adcf7` com mudanças locais. Confirme se houve commits/correções posteriores. Não reverta melhorias já implementadas e não force uma correção para um problema que já tenha sido resolvido: nesse caso, acrescente ou identifique o teste que comprova a solução.

Registre o commit/estado inicial, os comandos usados e um inventário sucinto dos problemas: confirmado, corrigido anteriormente ou ainda dependente de inspeção do ambiente.

IMPORTANTE: o relatório antigo contém um valor real de `CRON_SECRET`. Não imprima seu conteúdo bruto no terminal, em respostas ou em novos documentos. Faça leituras com valores sensíveis mascarados e remova o segredo do arquivo local como parte da correção.

## 3. Segredos, autorização e contexto Docker

Problemas encontrados:

- `CRON_SECRET` exposto no relatório, inclusive na seção de segurança e no anexo de `.env.cron`.
- `.dockerignore` termina com `docs/review-*.env.cron`, resultado da concatenação de duas linhas. Isso não exclui `.env.cron` da raiz.
- `Dockerfile` usa `COPY . .` no estágio de build.
- `/api/cron/force-run` aceita segredo por query string ou header e permanece acessível no Nginx descrito no relatório. Restringir outras rotas a localhost não elimina o impacto do segredo exposto.

Implemente:

1. Remoção de valores reais da documentação, usando placeholders.
2. Regras corretas de `.gitignore` e `.dockerignore` para arquivos privados de ambiente, preservando exemplos sem segredos.
3. Verificação do histórico e dos arquivos que seriam commitados, sem divulgar valores encontrados. Não alegue exposição pública sem evidência.
4. Procedimento de rotação coordenada do segredo no aplicativo e nos chamadores autorizados. Não altere o `ENCRYPTION_SECRET` indiscriminadamente: isso é outro segredo e pode afetar dados criptografados.
5. Preferência por header ou sessão administrativa para `force-run`, migrando eventuais chamadores de query string de forma compatível.
6. Teste de autenticação negando acesso sem credencial, com credencial inválida e para usuário comum em endpoints administrativos; preservar acesso administrativo legítimo.

Verifique o contexto do build para provar que arquivos sensíveis são excluídos. Diferencie conteúdo enviado ao builder/cache de conteúdo presente na imagem final.

## 4. Biblioteca: corrigir a regressão de caminhos e exclusões

Problema principal:

- O uploader agora gera `<user_id>/videos/upload_....mp4`.
- `app/api/library/broken-records/route.ts` extrai só o primeiro segmento, lista apenas esse nível e monta um inventário que não inclui os arquivos dentro de `videos`.
- Um upload válido pode ser considerado ausente e seu registro excluído.

Reprodução da revisão: registro `user-a/videos/upload_123.mp4`; a listagem de `user-a` retorna a subpasta `videos`. A limpeza retorna `deleted: 1`, apesar de o arquivo existir na subpasta. A exclusão é do registro da Biblioteca, não do objeto físico nessa rota.

Corrija a verificação usando diretórios completos, listagem corretamente recursiva/paginada ou consulta segura por caminho exato. Não use uma falha de listagem, timeout ou permissão como prova de inexistência. Preserve compatibilidade com caminhos antigos e novos.

Revise também:

- `library/record`: a consulta de referências ignora erro e trata `count = null` como zero antes de apagar um objeto na compensação.
- `library/bulk` e exclusão individual: não apagar fisicamente um arquivo se outro registro ainda o referencia.
- Registros legados e arquivos compartilhados entre registros/pastas, sem exigir que todo caminho antigo passe pelo novo formato.
- Validação de ownership antes de operações e tratamento consistente de tipos/JSON inválidos.

Testes obrigatórios:

- Upload válido no novo caminho continua visível após a limpeza.
- Arquivo antigo válido também é preservado.
- Somente registro comprovadamente sem arquivo é removido pela limpeza.
- Falha de inventário não remove registros nem objetos.
- Exclusão de uma referência preserva o arquivo enquanto existir outra.
- Caminho pertencente a outro usuário é rejeitado antes de gravar ou excluir.

## 5. Campanhas: atomicidade e retomada reais

Problemas encontrados em `app/api/posts/distribute/route.ts` e nos crons:

- Campanha nasce como `preparing`, mas seus posts já são `pending`.
- `publish-scheduled` busca/claima esses posts sem exigir campanha ativa.
- `sync-distribute-accounts` também não filtra campanhas ativas.
- Falha de ativação é apenas logada e pode terminar em resposta de sucesso.
- Retry encontra uma campanha incompleta e responde sucesso sem completar os lotes restantes.

Reprodução: 501 vídeos, uma conta, falha no segundo lote. Restam 500 posts pendentes e campanha `preparing`; retry retorna HTTP 200 com `success: true` e os mesmos 500 posts, sem resolver a falha.

Escolha uma implementação robusta com as ferramentas já presentes, preferindo transação/RPC no Postgres ou staging persistente com ativação protegida. Não introduza Redis/Kubernetes/outro serviço apenas para contornar uma transação que o banco existente pode garantir.

Requisitos:

1. Nenhum worker deve consumir uma campanha incompleta, incluindo o sincronizador e o claim de publicação.
2. A ativação deve confirmar integridade e quantidade esperada antes de tornar o trabalho consumível.
3. Falha parcial precisa ter estado explícito, retomada idempotente ou compensação segura.
4. Respostas devem distinguir conclusão, preparação em andamento e falha; atualizar a UI de acordo.
5. Posts legítimos de outras origens, sem campanha, devem continuar funcionando.
6. Corrigir também o que já ficou incompleto, mediante um procedimento de diagnóstico/recuperação. Não ativar em massa campanhas parciais de produção.

Inclua testes de falha após primeiro lote, falha de ativação, execução concorrente de worker, retry após reinício e duas requisições simultâneas. Use banco isolado com constraints/transações reais para provar as garantias que mocks não conseguem provar.

## 6. Identidade idempotente e schema de campanhas

Problemas encontrados:

- O hash inclui `start_at`, mas o formulário gera `new Date().toISOString()` a cada envio no modo Ciclo/burst. Dois envios da mesma intenção podem gerar chaves diferentes.
- O hash omite campos que alteram o resultado, como espaçamento entre contas e remoção de hashtags/menções.
- Um hash permanente do conteúdo não distingue retry de uma nova campanha intencionalmente igual.
- Para campanha sem pasta de sincronização, o código envia `account_folder_ids: null`; o schema versionado define `uuid[] NOT NULL DEFAULT '{}'`.

Implemente uma identidade de operação estável durante a mesma tentativa/retry e nova para uma nova campanha intencional. Pode ser uma chave de idempotência gerada no cliente e persistida durante essa operação, com escopo por usuário e unicidade no banco. Associe um fingerprint normalizado dos parâmetros relevantes para rejeitar reutilização incompatível.

Trate conflito de unicidade causado por concorrência consultando o estado da operação vencedora. Não transforme indiscriminadamente qualquer erro de banco em sucesso idempotente.

Quando não houver pastas de sincronização, grave array vazio, conforme o schema. Não remova constraints úteis apenas para permitir um payload incorreto.

Testes obrigatórios:

- Duplo envio/retry do modo Ciclo cria uma única campanha completa.
- Nova campanha intencional com os mesmos parâmetros é permitida com nova identidade.
- Mesmo identificador com parâmetros incompatíveis é rejeitado claramente.
- Mudanças de legenda, espaçamento, mídia, estratégia e destino são consideradas no fingerprint.
- Campanha sem sincronização funciona contra o schema real de teste.

## 7. Distribuição: desempenho, views, histórico e diversidade

Problema de desempenho:

`lib/media-priority.ts` tenta matching perfeito por backtracking de combinações inclusive quando há menos vídeos do que contas. Na revisão, 11 contas/10 vídeos e 200 contas/10 vídeos ultrapassaram 1.500 ms e foram interrompidos pela VM de teste. A função é síncrona, podendo bloquear outras requisições no processo Node. Esses tempos são reprodução local, não medição da VPS.

Substitua a busca combinatória por algoritmo de matching com complexidade controlada, usando caminhos aumentantes ou equivalente apropriado. Trate escassez diretamente e preserve o melhor matching parcial quando não houver solução perfeita. Não resolva apenas aumentando timeout ou memória.

Regras funcionais a preservar/explicitar:

1. Estratégia `views`: priorizar vídeos com mais views dentro das restrições válidas.
2. Embaralhar a ordem das contas com seed persistida, evitando favorecer sempre a primeira.
3. Mesma operação, seed e estado devem produzir o mesmo resultado em retry. Use identidade de ciclo/janela estável quando necessário, sem usar um novo timestamp como identidade a cada tentativa.
4. Não repetir vídeo na mesma conta antes de esgotar o conjunto elegível de seu ciclo.
5. Quando houver atribuição válida sem coincidências entre contas na janela, encontrá-la.
6. Na escassez, distribuir repetições da forma mais equilibrada possível. Exemplo com elegibilidade igual: 10 contas/3 vídeos deve resultar em 4/3/3.
7. Quando histórico individual e equilíbrio ideal entrarem em conflito, priorizar os vídeos inéditos para a conta e minimizar coincidências dentro dessa elegibilidade. Documentar essa precedência; não prometer duas garantias incompatíveis.
8. Vídeo temporariamente reservado/indisponível não significa que o ciclo pessoal foi esgotado. Adiar quando necessário em vez de reiniciar indevidamente.
9. Após esgotamento real, reiniciar o ciclo corretamente e evitar repetir imediatamente o último vídeo quando houver alternativa. Usar recência real, não maior contagem como aproximação de último post.
10. Aplicar as mesmas regras em Postar, Loops e sincronização, preservando as estratégias alternativas existentes.

Reproduções mínimas:

- Caso A: v1=900, v2=800, v3=700; A usou v3, B usou v2/v3, C usou v1/v2; seed `review-0`. Deve atribuir A=v2, B=v1, C=v3 sem resets.
- Caso B: A/B/C já usaram v1=900 e nenhuma usou v2=800; seed `scarcity-review`. Todas têm v2 como único inédito. Não aprovar um teste que só exige que uma delas receba v2.
- 11 contas/10 vídeos, 200/10, 300/10, 300/300, 300/1.000, com históricos vazios e desiguais.
- Quantidade de vídeos suficiente, mas restrições individuais sem matching perfeito.
- Várias rodadas e pelo menos dois ciclos completos, não apenas a primeira distribuição.

Meça tempo e uso de recursos dos casos maiores com execução limitada e isolamento para testes que possam travar. Demonstre melhoria do algoritmo sem afirmar capacidade de produção apenas por microbenchmark.

## 8. Reservas entre filas e recuperação de publicações

Seed e Sets em memória não impedem duas requisições concorrentes de escolher o mesmo vídeo para a mesma janela. Postar e sincronização passavam reservas globais vazias; o Loop consultava uma janela iniciada no instante da execução e limitada ao próprio fluxo.

Implemente reserva persistente/atômica compatível com as regras de escassez e horários reais. Considere duas campanhas/Loops concorrentes do mesmo usuário e diferentes origens de fila. Não imponha unicidade absoluta que torne impossível a escassez deliberadamente permitida. Defina o escopo de isolamento entre usuários sem compartilhar informações de suas bibliotecas.

Para a fila de publicação:

- `publishing_started_at` é uma melhoria, mas não substitui controle de posse, validade e recuperação de uma execução.
- Adote claim atômico e, quando necessário, lease com identificador de dono, expiração e renovação.
- Só o dono atual deve finalizar/alterar o resultado daquela tentativa.
- Defina recuperação de registros legados `publishing` com timestamp NULL.
- Persista identificadores da Meta e reconcilie resultado incerto antes de reenviar após timeout ou falha ao salvar o sucesso no banco.
- Evite prometer exactly-once entre banco e API externa sem uma garantia real do provedor.
- Faça o deploy respeitar trabalhos em andamento: encerrar com segurança, aguardar/concluir ou recuperar sem perder nem duplicar a publicação.

Teste concorrência, reinício após claim, lease expirado, resposta lenta, sucesso externo seguido de falha no banco e execução antiga tentando finalizar após perder a posse.

## 9. VPS: uma configuração versionada e reproduzível

Consolide no repositório o que deve existir na VPS. Na revisão, havia diferenças em Compose, Nginx e configuração do Next.js, além de correções manuais de timers não incorporadas aos scripts.

Requisitos:

- Node em versão compatível com as dependências; lockfile respeitado e versão da imagem base controlada.
- Variáveis públicas necessárias passadas no build. Segredos privados somente no runtime ou mecanismos próprios de secrets, nunca embutidos em código cliente.
- Compose com `build.args` corretos e comando documentado com `--env-file .env.production`; tornar obrigatórias as variáveis essenciais. Não obrigar IDs de integrações que não sejam utilizadas.
- Aplicação exposta em `127.0.0.1:3000`; acesso externo via Nginx.
- Nginx com domínio/certificados reais, encaminhamento consistente dos headers e tratamento adequado das rotas administrativas e internas.
- Conferir o fluxo de `force-run`: uma chamada interna não pode acabar bloqueada pelo próprio proxy ao usar o domínio público. Preserve autenticação; não abra todos os crons como solução.
- Sequência de bootstrap HTTPS que funcione antes da existência dos certificados, com teste de renovação.
- Timers instaláveis com comandos válidos, incorporando a correção do glob que falhou no relatório.
- Alinhar duração máxima dos jobs, timeout de curl/systemd, periodicidade e impedimento de sobreposição. `publish-scheduled` tinha 55 s no timer contra orçamento de 250 s; `publish-pending` tinha 110 s contra esperas sequenciais que podiam ultrapassá-lo.
- Configurações de runtime e build coerentes em um deploy a partir de checkout limpo.

Não exponha saída completa de comandos que expandam ambientes com segredos. Use validação silenciosa ou apresente somente nomes/status de presença.

## 10. Healthcheck e disponibilidade funcional

O relatório mostra container `unhealthy` e atribui a causa a `wget --spider` sem diagnóstico suficiente. Também afirma todos os crons operacionais, mas registra scraping como `skipped` por falta de `PYTHON_SERVER_URL`.

Faça:

1. Diagnosticar o healthcheck no próprio ambiente do container: comando disponível, endereço, IPv4/IPv6, método HTTP, timeout e saída real. Não trocar para curl sem incluí-lo na imagem, se necessário. Pode usar o Node já instalado para uma consulta GET limitada por timeout.
2. Separar vivacidade da aplicação de prontidão para atender. Verificar dependências essenciais de forma limitada e sem expor segredos. Não reiniciar compulsivamente a aplicação porque o Supabase teve uma falha transitória.
3. Provar que configuração inválida ou banco indisponível não aparece como pronto para publicar.
4. Tratar job `skipped` por dependência ausente como indisponibilidade daquele recurso, não como execução bem-sucedida.
5. Preservar o fluxo de scraping necessário ao produto e documentar sua dependência Python, sem confundi-la com a publicação oficial pela Meta.
6. Validar as URLs do domínio novo para login, recuperação de senha, OAuth Meta e reconexão/renovação de contas, conforme as integrações usadas.

## 11. Melhorias de deploy e operação

Prepare automação com GitHub Actions, aproveitando o repositório existente, sem exigir um novo painel ou serviço de hospedagem:

- CI para testes/typecheck/build nas mudanças relevantes.
- Build da imagem fora da VPS para não competir com as publicações pelos 2 vCPU.
- Imagens identificadas pelo commit, sem depender apenas de `latest`.
- Deploy restrito à branch/ambiente de produção, com apenas um deploy por vez, credenciais por secrets e verificação do servidor remoto.
- Entrypoint manual de deploy e possibilidade de automatizar após push/merge na branch de produção, conforme a preferência/autorização já definida pelo usuário.
- Verificação de prontidão após subir a versão e procedimento de retorno à imagem anterior.
- Não confiar que apenas `restart: unless-stopped` ou marcar um container como unhealthy implementa rollback automático.
- Não usar `docker compose down` como passo obrigatório de toda atualização quando não é necessário.
- Tratar jobs em andamento e compatibilidade de migrações. Rollback de imagem não desfaz automaticamente mudanças de banco.
- Não prometer atualização sem interrupção com um único container. Se adotar troca entre dois containers, validar recursos e impedir dois conjuntos de workers/agendadores ativos.

O objetivo é deixar arquivos e procedimento prontos e verificáveis. Não publique imagem, configure secrets externos ou efetue o deploy automaticamente apenas por ter criado o workflow.

Melhore a observabilidade usando a estrutura existente: identificadores de campanha/job/tentativa, contagens de sucesso/falha/adiamento, idade da fila, atraso de agendamento, tempo de execução e motivo de indisponibilidade. Não registrar tokens, headers de autorização ou URLs assinadas completas.

## 12. Cutover e capacidade

Corrija a sequência do relatório: não esperar 24–48 horas com os crons de Vercel e VPS potencialmente ativos ao mesmo tempo. Deve haver um único agendador responsável. A hospedagem anterior pode permanecer disponível para rollback com seus crons desativados. O plano de retorno também deve evitar sobreposição.

Prepare teste de carga simulado para 200 e 300 contas postando a cada 30 minutos, incluindo filas sincronizadas, latências variáveis, processamento de mídia, respostas transitórias, limitação de API e reinício de worker. Não faça publicações reais nem tente contornar limites da Meta.

Medir:

- Publicações concluídas por hora, não apenas itens consultados.
- Crescimento/idade da fila e atraso de publicação.
- Tentativas duplicadas, coincidências evitáveis entre vídeos e respeito às contas.
- CPU, memória e tempo bloqueando o processo de aplicação.
- Comportamento durante deploy/reinício.

Se a capacidade não for demonstrada no ambiente disponível, entregue o benchmark reproduzível e a limitação. Ajuste concorrência de forma controlada e explique os gargalos. Não declare que a VPS suporta o volume com base apenas em build/typecheck/testes unitários.

## 13. Validação e ordem de trabalho

Execute em etapas, mantendo o trabalho funcional:

1. Confirmar achados e preservar o estado existente.
2. Remover exposição local de segredo e corrigir as exclusões Docker/Git.
3. Corrigir perda de registros da Biblioteca e integridade de exclusão.
4. Corrigir campanhas, idempotência, schema e claims.
5. Corrigir distribuição, ciclos e reservas concorrentes.
6. Consolidar infraestrutura, healthcheck e procedimentos de operação.
7. Preparar CI/deploy e validar capacidade em simulação.
8. Reexecutar checks adequados e atualizar a documentação conforme o resultado real.

Use testes que falhem antes e passem depois das correções. Não enfraqueça expectativas para aceitar bugs. Combine testes unitários, handlers com serviços simulados e integração com banco isolado para constraints, transações e concorrência.

Execute o comando padrão de testes do projeto, typecheck e build. Valide a imagem Docker quando possível. Se faltarem Docker, credenciais de teste ou acesso à VPS, informe exatamente o que não foi executado e continue o restante. Nunca use o banco de produção como substituto do banco isolado dos testes.

## 14. Entrega final exigida

Entregue:

1. Correções implementadas e explicação do efeito para o usuário.
2. Lista objetiva de arquivos alterados e migrações novas, com ordem de aplicação.
3. Matriz com problema, mecanismo corrigido, teste executado, resultado e pendências externas.
4. Evidência de cada caso crítico, especialmente limpeza de upload válido, campanha 501 com falha de lote, retry Ciclo, campanha sem sincronização, distribuição 11/10 e concorrência de publicação.
5. Configuração de deploy reproduzível e procedimento de rollback/cutover com um agendador ativo.
6. Plano de rotação do segredo exposto sem divulgar o novo valor.
7. Métricas de carga obtidas e limites da conclusão sobre 200–300 contas.
8. Relatório final revisado, sem credenciais e sem confundir ambiente acessível com fluxo de publicação validado.

Não declare “tudo corrigido”, “pronto para produção” ou “aguenta 300 contas” se houver um requisito importante apenas planejado, um teste não executado ou uma dependência essencial indisponível. Distinga claramente: implementado localmente, validado localmente, aplicado na VPS e validado em produção.
