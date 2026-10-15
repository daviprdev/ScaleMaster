# Prompt para Claude — Substituir Apify por coleta histórica de Reels

Você é o engenheiro responsável por implementar esta mudança neste repositório. Trabalhe diretamente no código: investigue a arquitetura real, implemente, teste e entregue a mudança concluída.

Não responda somente com plano, sugestões ou pseudocódigo. Execute o desenvolvimento completo dentro do projeto.

---

## 1. Objetivo do produto

Existe uma aba chamada **Inspirações** que importa Reels de perfis públicos do Instagram para uma biblioteca, permitindo salvar seus dados e, quando o fluxo atual permitir, baixar o vídeo.

Hoje essa aba usa Apify para a coleta. Essa integração atual deve ser **substituída** por uma integração com a API da **ScrapeCreators**, para que o sistema percorra o histórico de Reels disponível em um perfil público, página por página, e não pare silenciosamente em uma quantidade fixa de resultados.

O resultado esperado para o usuário é simples:

1. Ele informa um perfil público do Instagram na aba Inspirações.
2. O sistema busca todo o histórico de Reels que a fonte disponibilizar naquela execução.
3. Os Reels entram na biblioteca existente sem duplicação.
4. O sistema deixa claro se a coleta terminou, ficou parcial ou falhou.
5. Depois da primeira importação, o usuário pode atualizar o perfil para trazer somente Reels ainda não existentes na biblioteca.

O trabalho inclui a remoção da integração Apify que for exclusiva desse fluxo. Não deixe o Apify como fallback, fonte oculta, opção de interface, job legado, dependência sem uso ou configuração morta dentro da funcionalidade Inspirações.

---

## 2. Fonte nova: ScrapeCreators

A fonte candidata é a API documentada da ScrapeCreators para Reels públicos de um perfil:

- documentação inicial: <https://docs.scrapecreators.com/v1/instagram/user/reels/>;
- rota inicial esperada: `GET /v1/instagram/user/reels`;
- consulta por `handle` ou `user_id`;
- continuação com `max_id` devolvido pela página anterior;
- fim indicado por `paging_info.more_available`;
- próximo cursor em `paging_info.max_id`;
- URL de vídeo disponível, quando retornada, em campo como `items[].media.video_versions[].url`;
- identificadores e permalink do Reel retornados na resposta.

Antes de programar, consulte a documentação atual e a especificação OpenAPI do provedor. Confirme os campos, limites, custos, paginação e as rotas disponíveis. Não invente endpoints, parâmetros, cabeçalhos ou formatos de resposta.

### Limitações conhecidas que precisam ser tratadas

A documentação da rota de Reels informa que:

- Reels fixados podem não ser retornados nessa rota;
- a legenda pode não estar disponível na listagem;
- métricas podem variar conforme o Instagram expõe os dados;
- URLs de mídia podem ser temporárias.

Investigue se o próprio provedor oferece uma rota documentada para complementar os itens fixados e os detalhes de cada Reel. Use-a somente se for documentada e adequada ao caso.

Se não houver forma documentada de recuperar ou verificar alguma categoria de conteúdo, trate essa execução como **parcial** e explique o motivo na interface. Nunca marque como concluída uma coleta que sabe ser incompleta.

Não use endpoints privados, engenharia reversa, login automatizado, cookies do Instagram, rotação de contas, bypass de CAPTCHA ou outros mecanismos para contornar uma limitação.

---

## 3. Regra de substituição do Apify

O objetivo é substituir a fonte **Apify da aba Inspirações** pela ScrapeCreators.

### Você deve remover

Após mapear o código, remova tudo que for exclusivo da coleta Apify em Inspirações:

- cliente, adaptador, serviço, worker, job ou função de coleta Apify;
- chamadas à API, webhooks, polling e handlers de resultado associados à importação de Reels;
- opção de fonte, botão, texto, seletor, feature flag ou fallback que mencione Apify;
- variáveis de ambiente exclusivas do Apify, inclusive do arquivo de exemplo;
- documentação exclusiva dessa integração;
- mocks, fixtures e testes exclusivamente voltados ao fluxo removido;
- dependências de pacote que só existam para a integração removida;
- agendamentos internos, filas pendentes ou configurações de job exclusivas da coleta Apify;
- tipos, tabelas ou colunas que existam exclusivamente para armazenar estado específico do Apify, desde que possam ser removidos sem apagar conteúdo da biblioteca.

### Você não deve remover por suposição

Faça uma busca completa no repositório antes de excluir qualquer dependência ou variável.

- Se Apify for usado por outra funcionalidade fora de Inspirações, preserve esse uso compartilhado.
- Se um tipo, tabela, componente ou pacote for compartilhado, remova somente a parte exclusiva da integração Inspirações.
- Não apague registros existentes da biblioteca, vídeos baixados ou metadados importados anteriormente pelo Apify.
- Não cancele, exclua ou altere recursos externos da conta Apify, como Actors, datasets, tasks, schedules, webhooks ou créditos, pois isso está fora do repositório e exige uma ação explícita do responsável pela conta.

### Migração de estado

Se o banco guardar origem, cursor, identificador de job ou outro estado com nomenclatura Apify:

1. preserve os itens já importados na biblioteca;
2. migre o estado que ainda fizer sentido para um modelo genérico de coleta ou para ScrapeCreators;
3. remova campos específicos de Apify apenas por uma migration reversível e segura, quando o projeto usar migrations;
4. mantenha compatibilidade para que itens históricos continuem abrindo e baixando normalmente;
5. não deixe dados antigos impedirem uma atualização nova do mesmo perfil.

Se não houver necessidade de migration, não crie uma apenas para renomear detalhes internos sem impacto funcional.

---

## 4. Antes de alterar o código

Siga esta sequência e depois continue automaticamente para a implementação:

1. Leia `AGENTS.md`, `README`, documentação do projeto, arquivos de ambiente de exemplo e configurações relevantes.
2. Identifique stack, framework, banco, sistema de filas, storage e comandos de teste, lint, typecheck e build.
3. Localize e compreenda:
   - a página e os componentes da aba Inspirações;
   - os endpoints, actions ou controllers que iniciam uma coleta;
   - a integração atual do Apify;
   - os workers, jobs e agendamentos envolvidos;
   - o modelo de dados da biblioteca e de um Reel;
   - o download e o armazenamento persistente de vídeo;
   - o mecanismo de progresso, status, tratamento de erro e cancelamento;
   - todas as referências a Apify no repositório.
4. Consulte a documentação atual da ScrapeCreators.
5. Escreva um plano curto baseado no que encontrou e prossiga para codificar. Não pare aguardando confirmação.

Use os padrões reais do projeto. Não crie nomes, arquivos, tabelas, rotas ou arquitetura imaginários quando já houver convenções estabelecidas.

---

## 5. Arquitetura esperada

Integre a ScrapeCreators como uma fonte de dados de backend para a aba Inspirações.

- A chave de API deve ficar somente no servidor.
- O navegador nunca deve receber a chave, nem direta nem indiretamente.
- Separe a integração do provedor da interface e da lógica de persistência, usando os padrões já existentes no projeto.
- O restante do produto deve lidar com um modelo interno normalizado, sem depender de campos brutos do provedor.
- Reutilize o fluxo de biblioteca, download e exibição já existente sempre que possível.
- Se a aplicação já possuir filas ou jobs em segundo plano, a importação histórica deve rodar por eles. Uma requisição da interface não pode permanecer aberta enquanto centenas de Reels são processados.
- Garanta que coletas simultâneas do mesmo perfil não avancem em paralelo, evitando cursores conflitantes e duplicações.

### Modelo interno mínimo

Adapte para o modelo existente. Caso não haja um modelo equivalente, ele precisa suportar pelo menos:

- perfil consultado;
- proprietário original do Reel, quando diferente;
- identificador estável de mídia;
- shortcode, se existir;
- permalink canônico;
- data de publicação;
- legenda, quando disponível;
- thumbnail, quando disponível;
- métricas já suportadas pelo produto;
- URL temporária de mídia, quando devolvida;
- localização persistente do arquivo baixado, quando houver download;
- origem da coleta como `scrapecreators`;
- estado de download;
- data da coleta.

Não armazene uma cópia integral do payload bruto caso o projeto não tenha necessidade para isso. Evite guardar tokens, URLs assinadas de longa extensão ou dados irrelevantes.

---

## 6. Segurança e configuração

### Variável de ambiente

Use uma variável seguindo o padrão do projeto. Se não houver convenção, use:

```env
SCRAPECREATORS_API_KEY=
```

Inclua-a no arquivo de ambiente de exemplo com uma descrição curta. Nunca adicione uma chave real ao repositório.

### Segurança obrigatória

- Não exponha a chave em componentes client-side, bundles, mensagens de erro, logs, responses ou documentação renderizada.
- Não registre URLs assinadas completas de vídeo. Caso seja necessário identificar uma mídia em log, use ID, shortcode ou permalink sem query string.
- Valide a entrada do perfil. Aceite somente handle válido e, se a tela aceitar URL, aceite somente URL do domínio do Instagram normalizada para um perfil.
- Não permita que uma URL livre do usuário vire destino de requisição no servidor.
- Não armazene senhas, cookies ou sessões de Instagram.
- Não chame a integração diretamente do frontend.
- Siga limites, custos e termos documentados do provedor.

---

## 7. Busca histórica: paginação completa e retomável

Implemente uma busca histórica que percorra todas as páginas oferecidas pelo provedor.

### Fluxo obrigatório

1. Crie ou reutilize um registro de execução de coleta no modelo já existente.
2. Marque o job como `aguardando` ou `em_andamento`.
3. Faça a primeira chamada sem `max_id`.
4. Valide a estrutura da resposta antes de processar os itens.
5. Normalize e persista os itens daquela página de forma idempotente.
6. Atualize os contadores e persista o cursor seguinte somente depois de a página ter sido registrada com sucesso.
7. Se `more_available` for verdadeiro, repita a chamada com o `max_id` retornado.
8. Quando `more_available` for falso, execute a reconciliação documentada para itens fixados e detalhes complementares, se disponível.
9. Finalize como `concluida` somente se todas as páginas e etapas aplicáveis foram concluídas sem lacunas conhecidas.

### Proteções contra falhas

Não implemente um limite oculto de Reels, páginas ou tempo.

Caso exista um limite de proteção por custo, duração ou prevenção de loop, ele deve ser configurável e visível. Ao ser atingido, finalize como `parcial`, com uma mensagem que indique que o histórico não foi concluído.

Interrompa e registre um estado claro caso ocorra qualquer uma destas condições:

- o mesmo cursor seja devolvido novamente;
- uma página já processada seja devolvida repetidamente;
- o provedor indique que existem mais páginas, mas não entregue cursor utilizável;
- uma página venha vazia enquanto `more_available` indicar continuidade;
- o payload esteja inválido;
- o perfil não seja público, não exista ou não esteja disponível ao provedor;
- seja atingido um limite configurado;
- exista erro permanente de autenticação, entrada inválida ou resposta não recuperável.

Para falhas temporárias, como timeout, indisponibilidade momentânea ou rate limit, faça número limitado de retentativas com espera progressiva. Respeite os headers ou instruções de espera do provedor quando existirem.

### Retomada

Salve o estado necessário para retomar uma execução interrompida:

- cursor pendente;
- última página persistida;
- contadores;
- motivo de pausa ou falha;
- estado de downloads pendentes, se aplicável.

Uma retomada não pode duplicar itens nem rebaixar o estado de uma execução concluída.

Caso o cursor deixe de ser válido, reinicie a varredura de forma idempotente e classifique o resultado como parcial se não for possível provar que a página anterior foi retomada com segurança.

---

## 8. Deduplicação e integridade

Use, por ordem de preferência, uma chave estável:

1. identificador de mídia do provedor;
2. shortcode;
3. permalink canônico do Reel, normalizado sem parâmetros temporários.

A deduplicação precisa funcionar:

- na mesma página;
- entre páginas da mesma execução;
- entre uma busca histórica e uma atualização futura;
- entre execuções diferentes do mesmo perfil;
- quando a reconciliação de fixados reencontrar um Reel já recebido;
- para Reel colaborativo que apareça em mais de um perfil.

Mantenha o perfil consultado e o proprietário original se forem diferentes. Não crie cópias de mídia apenas porque o Reel apareceu em mais de uma origem.

Reimportar um perfil deve atualizar metadados que possam mudar, conforme o modelo existente, sem criar um novo item de biblioteca nem apagar arquivo de mídia já salvo.

---

## 9. Reels fixados, legendas e dados complementares

Faça uma verificação concreta da documentação atual da ScrapeCreators.

### Reels fixados

Se existir endpoint documentado que permita identificar Reels fixados ou listar mídia do perfil de forma adequada:

1. execute a consulta complementar;
2. filtre somente itens que sejam Reels;
3. una os resultados pela chave estável;
4. registre que o item era fixado, se o modelo tiver campo para isso;
5. não conte o mesmo item duas vezes.

Se não houver rota documentada ou se a rota não permitir uma verificação confiável, finalize como `parcial` com explicação clara de que a fonte não permite verificar Reels fixados.

### Legendas e detalhes

Quando a listagem não retornar legenda ou metadados necessários, consulte uma rota documentada de detalhe por permalink/ID, se houver e se o custo for aceitável dentro da configuração do projeto.

Faça consultas de detalhe apenas para itens que precisarem delas. Não repita chamadas para itens já completos e atualizados, salvo em uma atualização explicitamente solicitada.

Se um dado continuar indisponível, armazene como ausente. Não invente texto, data, métrica, thumbnail ou URL.

---

## 10. Download e biblioteca

Preserve o comportamento esperado da biblioteca existente.

### Se a biblioteca armazena o arquivo de vídeo

- Baixe a mídia durante ou logo após a coleta, porque links retornados pelo Instagram podem expirar.
- Use o storage persistente já adotado pelo projeto.
- Valide resposta HTTP, tipo de conteúdo, tamanho e arquivo antes de marcar um download como concluído.
- Associe o arquivo persistido ao item certo da biblioteca.
- Um download que falhar não pode apagar os metadados do Reel nem fazer uma nova coleta criar duplicata.
- Guarde estado de download como pendente, concluído ou falho.
- Permita retentar somente os downloads falhos, sem repetir toda a busca histórica.
- Não substitua um arquivo já persistido por uma URL temporária.

### Se a biblioteca salva somente o link

- Mantenha o formato e comportamento atual.
- Registre que o item foi salvo como referência, sem indicar falsamente que o vídeo foi baixado.

### Mídia indisponível

Se a fonte não trouxer URL baixável, se a URL já tiver expirado ou se o download for negado, registre o item e exiba estado de download falho ou indisponível. Não o remova do resultado nem esconda a falha.

---

## 11. Interface na aba Inspirações

Substitua qualquer elemento visual de Apify pelo novo fluxo da ScrapeCreators. Não deixe referência a Apify para o usuário nessa aba.

Use os componentes e padrões existentes. A tela deve permitir, conforme a arquitetura atual:

- iniciar busca histórica de um perfil público;
- atualizar um perfil já importado;
- acompanhar execução em andamento;
- retomar execução interrompida quando aplicável;
- tentar novamente downloads falhos;
- consultar erros e limitações compreensíveis.

Mostre os seguintes estados:

- `aguardando`;
- `em andamento`;
- `concluída`;
- `parcial`;
- `falhou`;
- `cancelada`, caso o projeto já tenha ou passe a ter cancelamento consistente.

Mostre contadores reais:

- páginas processadas;
- Reels encontrados;
- Reels adicionados;
- Reels já existentes;
- downloads concluídos;
- downloads pendentes;
- downloads com falha.

Não mostre porcentagem de conclusão se o número total de páginas ou de Reels não for conhecido. Use progresso absoluto, como “12 páginas processadas, 168 Reels encontrados”.

Exemplos de mensagens aceitáveis:

- “Coleta concluída: 124 Reels processados, 120 adicionados, 4 já existentes.”
- “Coleta parcial: a fonte não permite verificar Reels fixados deste perfil.”
- “Coleta pausada após erro temporário. Você pode retomar a partir da última página salva.”
- “Importação concluída, mas 3 vídeos não puderam ser baixados. Tentar novamente.”

Não exponha detalhes internos, segredo, stack trace ou URL assinada na interface.

---

## 12. Atualização de Reels novos

Após a primeira busca histórica, forneça a atualização incremental usando a mesma fonte nova.

- Consulte os itens recentes do perfil;
- processe páginas adicionais quando forem necessárias para assegurar que não há itens novos escondidos depois da primeira página;
- pare de forma segura quando entrar em uma região de itens já conhecidos e os critérios de ordenação/documentação permitirem isso;
- se a segurança desse atalho não puder ser garantida, mantenha a paginação até o ponto seguro e registre a decisão;
- nunca crie duplicatas;
- preserve dados e arquivos de Reels já salvos;
- mantenha agendamentos existentes apenas se eles forem do fluxo de Inspirações e forem atualizados para ScrapeCreators.

Não crie um cron externo novo sem necessidade. Siga o mecanismo de agendamento já existente no projeto.

---

## 13. Observabilidade, custos e operação

Use o mecanismo de logs e métricas existente, sem vazar segredos.

Registre pelo menos:

- ID da execução;
- perfil consultado;
- fonte `scrapecreators`;
- páginas processadas;
- quantidades encontradas, inseridas, existentes e falhas;
- contagem de retentativas;
- motivo de conclusão, parcialidade, cancelamento ou falha;
- duração;
- código/status de erro do provedor quando for seguro registrar.

Não registre chave de API, cabeçalho de autorização, payloads sensíveis ou URL de vídeo assinada completa.

Verifique o modelo de cobrança atual da API. Se o projeto possuir limites de custo, orçamento ou rate limit, integre-se a eles. Se não tiver, não invente uma tela de cobrança, mas trate respostas de limite do provedor com mensagem clara e estado parcial/falha correto.

---

## 14. Banco, migrations e dados existentes

Antes de qualquer mudança de banco, inspecione o schema e as migrations existentes.

- Não exclua itens históricos importados por Apify.
- Não exclua arquivos já guardados pela biblioteca.
- Se houver colunas exclusivas de Apify que precisam sair, use a estratégia de migration adotada pelo projeto e faça a mudança de forma reversível quando esse for o padrão.
- Prefira generalizar “fonte de coleta” para `scrapecreators` se isso for necessário para a nova integração, sem migrar ou reescrever registros históricos sem motivo.
- Preserve vínculos e chaves usadas por telas existentes.
- Não execute comandos destrutivos de banco nem limpe tabelas para “recomeçar”.

Caso a remoção de dados específicos de Apify envolva risco de perder histórico, mantenha esses dados inativos ou faça migration segura; explique a decisão no relatório final.

---

## 15. Testes obrigatórios

Siga a estrutura de testes do repositório. Use mocks, fixtures ou servidor simulado. Não faça chamadas reais pagas à ScrapeCreators nos testes automatizados e não raspe contas reais.

Adicione ou atualize testes para cobrir pelo menos:

1. importação de várias páginas e fim normal quando `more_available` for falso;
2. envio correto de `max_id` para a página seguinte;
3. cursor repetido sem loop infinito;
4. página vazia inesperada enquanto o provedor informa que há mais conteúdo;
5. resposta inválida do provedor;
6. timeout, rate limit e falha temporária com retentativa limitada;
7. falha permanente de autenticação, perfil inexistente e perfil não público;
8. persistência do cursor e retomada após interrupção;
9. cursor inválido com reinício idempotente;
10. deduplicação dentro da mesma página, entre páginas e entre execuções;
11. atualização incremental sem recriar Reels existentes;
12. ausência de legenda e de campos opcionais;
13. reconciliação de Reels fixados quando suportada;
14. estado parcial quando fixados não puderem ser verificados;
15. download concluído;
16. falha de download preservando metadados;
17. retentativa de download falho sem nova coleta;
18. URL de mídia expirada ou resposta de arquivo inválido;
19. estados, mensagens e contadores da interface;
20. chave de API não enviada ao frontend e não exposta em logs;
21. validação do handle/URL recebido;
22. remoção do fluxo Apify da aba Inspirações;
23. preservação de usos de Apify que sejam compartilhados por outras funcionalidades, se existirem;
24. compatibilidade com registros históricos já existentes na biblioteca.

Execute os comandos reais de lint, typecheck, testes e build definidos pelo projeto. Descubra-os em `package.json`, arquivos de configuração ou documentação. Não invente comandos.

---

## 16. Checklist de remoção do Apify

Antes de considerar o trabalho pronto, faça buscas no repositório por termos como:

- `apify`;
- `APIFY_`;
- nome do Actor usado hoje;
- IDs de Actor, dataset, task ou webhook;
- classes, funções e componentes da integração antiga.

Para cada referência, classifique:

| Referência | Ação esperada |
| --- | --- |
| Exclusiva da aba Inspirações | Remover ou substituir por ScrapeCreators |
| Configuração exclusiva da coleta Apify | Remover do código e dos exemplos de ambiente |
| Teste ou fixture da integração antiga | Remover ou substituir por fixture ScrapeCreators |
| Uso compartilhado por outra função do produto | Preservar e não quebrar |
| Dado histórico já salvo na biblioteca | Preservar |
| Recurso externo da conta Apify | Não alterar sem autorização externa explícita |

Não entregue código com imports mortos, dependência não usada, feature flag obsoleta ou interface mencionando Apify dentro de Inspirações.

---

## 17. Critérios de aceite

Considere a tarefa concluída somente quando todos os pontos abaixo forem verdadeiros:

- A aba Inspirações inicia a nova coleta por ScrapeCreators.
- A integração Apify exclusiva de Inspirações foi removida de código, interface, configuração e testes.
- Usos compartilhados de Apify, caso existam, continuam funcionando.
- A chave ScrapeCreators fica exclusivamente no backend.
- A busca histórica percorre todas as páginas disponibilizadas pelo provedor, sem limite fixo oculto.
- A coleta é idempotente e pode ser retomada sem duplicar a biblioteca.
- Os Reels encontrados são convertidos e salvos no fluxo de biblioteca existente.
- Vídeos são persistidos quando esse é o comportamento atual da biblioteca.
- Falhas de download permanecem visíveis e podem ser retentadas sem nova varredura inteira.
- Reels fixados e campos ausentes são reconciliados por fonte documentada ou tornam a execução explicitamente parcial.
- O usuário consegue distinguir claramente uma execução concluída de uma parcial.
- Registros históricos já existentes continuam acessíveis.
- Testes, lint, typecheck e build relevantes passam.

Não declare “100% correto” ou “todos os Reels” quando a fonte não permitir verificar isso. Use a formulação precisa: “todos os Reels disponibilizados pela fonte durante esta execução”, e informe qualquer lacuna conhecida.

---

## 18. Entrega final obrigatória

Ao terminar, responda em português com:

1. resumo objetivo da solução implementada;
2. como o Apify foi removido da aba Inspirações;
3. lista dos arquivos e módulos principais alterados;
4. variável de ambiente necessária, sem segredos;
5. como iniciar uma busca histórica, acompanhar o progresso, atualizar o perfil e retentar downloads;
6. migrations executadas ou necessárias, se houver;
7. testes, lint, typecheck e build que você executou, com os resultados;
8. limitações reais da fonte, incluindo Reels fixados, legendas, disponibilidade de vídeo e cobertura;
9. qualquer passo manual que dependa de credencial, configuração externa ou deploy.

Se algo não puder ser concluído por uma limitação comprovada da API ou do código do projeto, implemente o que for possível, mantenha o sistema em estado seguro e explique a limitação com evidência. Não esconda pendências e não apresente coleta parcial como concluída.
