# Contexto do AutoScale para um novo chat no Claude

Você vai continuar o projeto AutoScale-IA. Leia este contexto e depois execute o prompt de implementação que vou enviar. Use os fatos abaixo como ponto de partida, conferindo o estado atual antes de editar. Não considere comentários antigos, memórias ou uma página que abre como prova de funcionamento completo.

## Objetivo do usuário

Tenho um SaaS de automação de conteúdo para Instagram. Quero:

1. Priorizar os Reels com mais visualizações ao criar filas a partir de uma pasta da Biblioteca, inclusive no fluxo Inspirações → Biblioteca → Postar/Loop e demais caminhos equivalentes.
2. Distribuir esses vídeos em ordem variada entre as contas, evitando publicar a mesma mídia em várias contas na mesma rodada/janela quando houver alternativas suficientes.
3. Quando houver menos mídias do que contas, aceitar a repetição inevitável, distribuindo-a de maneira equilibrada.
4. Migrar a aplicação da Vercel para uma VPS, mantendo o projeto atual do Supabase, seus dados, usuários, autenticação e arquivos.

Não quero transformar esse trabalho em uma correção geral do RPA. O erro conhecido do cadastro automático é uma frente separada. Quero respostas diretas, implementação concreta e validação, sem perguntas repetidas para decisões rotineiras.

## Repositório e estado observado em 03/10/2026

- Repositório: `https://github.com/daviprdev/AutoScale-IA`.
- Diretório local nesta sessão: `C:\Users\davip\OneDrive\Documentos\AutoScale-IA`.
- `main`: SaaS Next.js, publicado na Vercel.
- `master`: worker RPA Python standalone. Não confundir os dois projetos, apesar de estarem no mesmo repositório.
- A cópia de trabalho estava inicialmente em `fix/session-transfer` e, na última inspeção, estava em `main`, sem alterações listadas por `git status` antes da criação destes prompts.
- Último commit de `main` conferido, inclusive por `git ls-remote`: `cf9902d32e49b2cb0c9f95abd9b4f595a22e709b`, de 28/09/2026. Reconfirme antes de trabalhar.
- Os commits de 26–28/09 examinados alteravam principalmente RPA, documentação e habilitação de deploy por branch. Não alteravam as rotas principais de publicação nesse intervalo. Isso não equivale a uma auditoria completa de bugs.
- Existe a referência local `origin/feat/postar-selecao-ordem-midias`, observada no commit `698332a`, de 08/09/2026. Tem trabalho de seleção/ordem manual em Postar e testes. Não estava incorporada integralmente na `main` examinada. Verifique a referência remota atual antes de reaproveitá-la.
- Leia `AGENTS.md`, se existir, `CLAUDE.md`, `docs/MEMORIA.md`, `package.json`, o lockfile e as instruções locais aplicáveis. Confirme branch e alterações locais antes de qualquer checkout.
- Não faça reset destrutivo, não sobrescreva trabalho de outro chat e não integre uma branch antiga inteira sem revisar as diferenças.

## Arquitetura atual

Produção pública: `https://autoscale-ia.vercel.app`.

O SaaS usa Next.js App Router, TypeScript, React, Tailwind e Supabase. O `package.json` examinado declara Next `^15.3.2`, React `^18`, `@supabase/ssr`, `@supabase/supabase-js`, `undici`, `fluent-ffmpeg` e `@ffmpeg-installer/ffmpeg`. A versão efetivamente instalada deve vir do lockfile; não confie na menção antiga a Next 14 na documentação.

O Supabase fornece banco, autenticação e Storage. Publicações normais de Reels/Stories usam a Graph API da Meta pelo backend do SaaS, e não o worker de onboarding. Agendamentos e tarefas recorrentes são disparados pelos crons de `vercel.json`.

Inspirações importa metadados e baixa o vídeo original para o Storage. O bucket usado pela rota examinada é `videos-library`. A Biblioteca mantém o original; limpeza opcional de metadados gera uma variante separada. Preservar essa arquitetura.

Existe também `python_server/` na branch SaaS, utilizado por funcionalidades auxiliares. Não confundir esse código com o worker standalone nem supor que todas as dependências externas estejam na mesma VPS. Inventarie os usos de `PYTHON_SERVER_URL`, Apify e demais integrações antes da migração.

## Views e distribuição: o que já existe

### Origem dos dados

- `lib/scraped-reel.ts`: normalização do Reel; o código examinado lê `videoViewCount` para produzir `views`.
- `app/api/inspirations/save-to-library/route.ts`: recebe `reel.views` e persiste `views: toIntegerColumn(reel.views)` em `videos_library`.
- `lib/media-ingest.ts`: normalização de valores destinados a colunas inteiras.
- `supabase/schema.sql`: `videos_library.views` é `bigint`, com default `0`.

Portanto, views da origem já têm armazenamento. Ainda é necessário validar a propagação por todos os importadores e consultas usados na nova seleção. Não confundir views do Reel original com analytics das publicações feitas depois pelo SaaS.

### Publicação e filas

- `app/dashboard/postar/page.tsx`: UI de distribuição de conteúdo.
- `app/api/posts/distribute/route.ts`: distribui vídeos e grava posts concretos em `scheduled_posts`. Na main examinada, embaralha a pasta, considera uso histórico e usa uma rotação por conta/rodada. A consulta de vídeos não inclui views nesse caminho.
- `app/api/posts/schedule/route.ts`: outro caminho de agendamento; contém também `same_video_per_slot`, que exige cuidado porque conflita com a nova política quando ativada.
- `app/api/posts/publish/route.ts`: publicação imediata de vídeo selecionado pela Meta.
- `app/api/posts/create/route.ts`: rota separada com `single_posts` e `single_post_accounts`. Auditar se ainda possui chamadores reais antes de incluí-la como caminho principal ou alegar cobertura.
- `app/api/clone/create/route.ts`: criação de filas por clonagem.
- `app/api/cron/sync-distribute-accounts/route.ts`: inclusão posterior de contas nas campanhas; deve preservar a estratégia da campanha.
- `app/api/cron/publish-scheduled/route.ts`: consome `scheduled_posts`; atende também Stories.
- `app/api/cron/process-loops/route.ts`: seleção/atribuição dos vídeos do Loop, incluindo `assignVideosForLoop`.
- `app/api/cron/publish-pending/route.ts`: publica containers prontos.
- `app/api/posts/stories/post-now/route.ts`: grava Stories em `scheduled_posts` para o cron publicar.
- `lib/meta-publish.ts`: criação, consulta e publicação dos containers da Meta.
- `lib/video-processing.ts`: processamento opt-in, original versus variante limpa.
- `lib/loop-readiness.ts`: diagnóstico de loops sem mídia, sem contas ou sem disponibilidade.

### Histórico, concorrência e trabalho prévio

- `lib/video-history.ts` usa o RPC `get_account_video_usage` para agregar histórico de `scheduled_posts`, `pending_containers` e `video_processing_jobs`.
- A biblioteca também tem `fetchAllRows`, com paginação real para evitar o teto de 1.000 linhas do PostgREST. Não regredir para `.limit(100000)` como suposta solução.
- O Loop atual combina histórico por conta, menor uso global e restrições de recência. Algumas proteções são decisões em memória e consultas ao banco. Comentários que as chamam de “atômicas” não bastam para provar proteção entre processos concorrentes.
- A branch antiga de seleção de mídias inclui `lib/media-order.ts`, `scripts/test-media-order.mjs` e mudanças em Postar/API/Biblioteca/Loop.
- Nessa branch, `selected` respeita uma sequência igual entre contas e `random` usa rotação. O comportamento de `selected` conflita com a nova estratégia automática se for reaproveitado sem adaptação.
- Evitar coincidências é uma regra de distribuição solicitada pelo usuário. Não prometer aumento de alcance nem tratar comentários sobre supressão pela Meta como fatos comprovados.

## Migração de hospedagem

Manter o Supabase gerenciado atual. Não instalar uma segunda instância do Supabase, migrar dados, recriar usuários, alterar RLS ou substituir o Storage sem necessidade.

O SaaS ainda não tem uma configuração completa de hospedagem própria validada. `next.config.ts` possui `outputFileTracingRoot` e mantém os pacotes FFmpeg externos ao bundle. Preparar uma imagem Linux adequada e testar os binários nativos, uploads, temporários e permissões.

Há URLs da Vercel fixas no código, especialmente:

- `app/api/instagram/auth/route.ts`;
- `app/api/instagram/callback/route.ts`.

Outros locais usam fallback para a Vercel ou `NEXT_PUBLIC_APP_URL`. Fazer busca completa incluindo links gerenciados, OAuth, magic links, webhooks, URLs no painel e configuração do worker.

As 16 entradas observadas em `vercel.json` são:

| Endpoint | Expressão atual |
| --- | --- |
| `/api/cron/prefetch-clone-urls` | `*/5 * * * *` |
| `/api/cron/process-videos` | `*/5 * * * *` |
| `/api/cron/process-loops` | `*/5 * * * *` |
| `/api/cron/publish-pending` | `*/2 * * * *` |
| `/api/cron/publish-scheduled` | `* * * * *` |
| `/api/analytics/sync` | `0 2 * * *` |
| `/api/cron/refresh-tokens` | `0 */12 * * *` |
| `/api/cron/story-templates` | `*/30 * * * *` |
| `/api/cron/sync-distribute-accounts` | `*/10 * * * *` |
| `/api/cron/process-instagram-logins` | `*/10 * * * *` |
| `/api/cron/process-scrape-jobs` | `*/5 * * * *` |
| `/api/cron/sync-post-insights` | `*/5 * * * *` |
| `/api/cron/sync-account-views` | `*/15 * * * *` |
| `/api/cron/finalize-inspiration-scrapes` | `*/2 * * * *` |
| `/api/cron/daily-profit-notification` | `*/15 * * * *` |
| `/api/cron/check-health-alerts` | `*/10 * * * *` |

`lib/cron-auth.ts` exige `CRON_SECRET`; retorna 503 se faltar e 401 se o header estiver incorreto. O agendador substituto precisa conservar essa autenticação. Não enfraquecer o controle para “fazer funcionar”.

Preservar segredos existentes, principalmente os que criptografam dados já armazenados. Nunca imprimir valores, colocar em commits ou pedir que sejam colados no chat.

## VPS e RPA: informação útil, não novo escopo

- VPS conhecida: `2.25.244.181`.
- Acesso usado: `ssh -i ~/.ssh/id_ed25519 root@2.25.244.181`.
- Worker standalone em `/opt/worker-rpa/`, container `worker-rpa-rpa-worker-1`, API na porta 8080.
- O worker usa Python, FastAPI, SQLite, Instagrapi e Playwright com Xvfb.
- Em 03/10, o container respondeu saudável e estava ativo havia quatro dias.
- O histórico consultado tinha zero jobs concluídos e um com erro. Último erro: `AttributeError: 'InstagramRPA' object has no attribute 'stop'`, após seis tentativas. Essa exceção pode esconder o erro original do onboarding; não concluir causa-raiz além da evidência.
- Os oito proxies tinham esse mesmo erro registrado. Isso não prova que os proxies estejam quebrados.
- A capacidade real da VPS para hospedar também o SaaS não foi medida. Não afirmar que RAM/CPU/disco bastam sem conferir.

## O que foi e o que não foi validado

- O site respondeu HTTP 200.
- O usuário entrou no painel. A tela de Contas mostrou zero contas conectadas, e o dashboard mostrou fila vazia e nenhuma postagem no dia para aquela sessão.
- Não foi publicada mídia de teste, não foram validados tokens de contas e não foi confirmado um fluxo de publicação completo.
- Nenhuma migração foi executada e nenhuma alteração funcional foi feita nesta conversa. Estes dois documentos são prompts para continuidade.
- O usuário decidiu deixar a correção do onboarding/RPA fora desta frente.

## Forma de trabalhar

Implemente e valide de verdade. Separe achados comprovados, inferências e pendências. Não peça confirmação para cada leitura, edição local ou teste autorizado. Se faltar domínio, acesso ou uma decisão de produção indispensável, pergunte de forma objetiva e continue as partes independentes. Não faça publicações reais, envie mensagens, cancele assinaturas ou apague dados como consequência implícita de um teste.

Use o prompt de implementação seguinte como especificação dos resultados esperados.
