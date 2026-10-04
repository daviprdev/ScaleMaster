# Contexto para o Claude — AutoScale-IA após a revisão de 04/10/2026

Estou retomando o AutoScale-IA para usar e melhorar o SaaS que já tenho. Quero que você trabalhe no repositório real, sem reconstruir o produto do zero.

## Projeto e objetivo

- Repositório: https://github.com/daviprdev/AutoScale-IA
- Diretório local: `C:\Users\davip\OneDrive\Documentos\AutoScale-IA`
- Stack observada: Next.js 15, React 18, TypeScript, Supabase gerenciado, integrações Meta/Instagram, Apify e processamento de vídeo com FFmpeg.
- A intenção é substituir a hospedagem Vercel por uma VPS, mantendo o MESMO Supabase gerenciado.
- O fluxo principal é: Inspirações → importar Reels para uma pasta da Biblioteca → distribuir publicações entre contas por Postar, Loop e sincronização de campanhas.
- Quero priorizar os vídeos com mais views da origem, variar aleatoriamente quais contas recebem cada vídeo e evitar publicar o mesmo vídeo entre contas na mesma janela quando houver alternativas. Quando houver menos mídias elegíveis do que contas, distribuir as repetições da forma mais equilibrada possível.

## Estado de referência do código

A revisão foi feita na `main`, commit `294a242`, depois de:

1. `de62b6a`: módulo de prioridade por views e integração inicial.
2. `ddb824a`: preparação de Docker, nginx e timers para VPS.
3. `294a242`: remoção de funcionalidades obsoletas.

Confirme o HEAD e o estado de trabalho antes de editar. Pode haver alterações posteriores; preserve o trabalho existente e valide se cada defeito ainda existe.

O usuário aprovou anteriormente a remoção de RPA, Links Gerenciados, Logins e Horário Humano. Não reintroduza esses módulos. A limpeza deixou algumas referências e rotas residuais, que precisam ser avaliadas antes de remover dependências compartilhadas. `lib/python-server.ts` continua sendo usado pelo cron de scrape; scraper Python e RPA não são a mesma dependência funcional.

## O relatório anterior não é prova de funcionamento

Foi entregue um relatório dizendo que prioridade, diversidade e infraestrutura estavam concluídas. Uma revisão posterior encontrou regressões que os testes existentes não detectam.

Constatações locais em `294a242`:

- `npm run typecheck`: passou.
- `node node_modules/vitest/vitest.mjs run __tests__/media-priority.test.ts`: 15 testes passaram.
- `npm test`: as primeiras três suítes passaram, mas o comando falhou porque ainda chama `scripts/test-hardening.mjs`, que foi removido. Também continua referenciando `scripts/test-managed-links.mjs`, removido.
- As suítes remanescentes de integridade da Biblioteca, legendas e Clone foram executadas separadamente e não reportaram falhas.
- Não houve build Docker, implantação na VPS ou publicação real nesta revisão. Passar typecheck e testes unitários não comprovou o fluxo completo de agendamento.

Nove comportamentos defeituosos foram reproduzidos executando módulos/handlers reais com autenticação, banco e rede simulados. As reproduções não acessaram Supabase, Instagram, Storage ou VPS de produção:

1. **Postar cria só um vídeo por conta.** Pedido de 10 vídeos para 2 contas gera 2 linhas em `scheduled_posts`, embora a resposta informe `videos_per_account: 10`.
2. **Há colisão evitável no algoritmo.** Com três vídeos ordenados `v1 > v2 > v3`, duas contas e apenas a primeira tendo usado `v1`, ambas recebem `v2`. Poderiam receber vídeos diferentes.
3. **Loop descarta a estratégia escolhida.** POST e PATCH com `priority_strategy: "views"` retornam sucesso, mas não persistem a configuração. O SELECT do cron também não busca essa coluna.
4. **Sincronização ignora a estratégia salva.** Uma campanha gravada como `views` chega ao algoritmo como `least_usage`, porque o SELECT omite `priority_strategy`.
5. **Excluir Loop pode cancelar publicações de outro usuário.** A rota muda os containers para `error` antes de verificar ownership do Loop. Conhecer seu ID basta para provocar esse efeito com uma sessão de outro usuário.
6. **Registro e exclusão da Biblioteca permitem remover arquivo alheio.** O usuário registra em sua pasta um `storagePath` de outro arquivo; ao apagar seu próprio registro, a rota manda remover esse arquivo, mesmo havendo outra referência legítima.
7. **Recuperação de posts pode liberar trabalho em execução.** Um post agendado há 30 minutos, mas em processamento há apenas 10 segundos, volta para `pending` porque o critério usa `scheduled_at`.
8. **Template de criptografia está errado.** Preencher `ENCRYPTION_KEY` como no `.env.production.example` não configura o app: `lib/encrypt.ts` exige `ENCRYPTION_SECRET`.
9. **Campanha pode ficar parcialmente ativa após erro.** Falha no segundo lote de inserção devolve erro, mas deixa os primeiros 500 posts pendentes. Nova tentativa pode duplicar trabalho.

Outros problemas foram confirmados por leitura do código/configuração, sem executar a VPS:

- Timer de `publish-scheduled` usa `*-*-* *:01:00`: dispara no minuto 01 de cada hora. O cron anterior era a cada minuto.
- O timer dá 55 segundos ao curl, enquanto o handler tem orçamento de execução maior. Interromper o cliente HTTP não garante que o trabalho do servidor foi interrompido.
- Docker Compose verifica `/api/health`, mas essa rota não existe no commit revisado.
- Docker usa Node 20; o lockfile contém `undici@8.10.2` com engine `>=22.19.0` e `vitest@5.0.3` com engine que não inclui Node 20. Compatibilidade precisa ser corrigida e validada dentro da imagem.
- Não há `.dockerignore`. `.gitignore` não protege `.env.production` nem `.env.cron`.
- O template removeu `PYTHON_SERVER_URL`/`PYTHON_SERVER_SECRET`, mas o cron preservado de scrape depende deles. Sem a URL ele pula o processamento.
- Nginx bloqueia todo `/api/cron/`, incluindo `/api/cron/force-run`, que também atende ações autenticadas do painel.
- Não há reserva transacional global comprovada para garantir diversidade entre processos/fluxos concorrentes. Sets em memória e consultas anteriores ao INSERT não equivalem a essa garantia.
- As seeds de execução incluem `Date.now()`/o instante da chamada; não garantem repetição da mesma decisão entre retries do mesmo trabalho.

## O que está e o que não está confirmado sobre produção

O relatório recebido afirma que a VPS foi reconhecida, mas que a instalação/migração foi interrompida. Ele menciona Ubuntu, Docker e portas 80/443 livres. Essas condições não foram revalidadas nesta revisão; trate-as como histórico, não como estado atual garantido.

O domínio final não foi informado nesta conversa. Não invente domínio, credenciais ou URLs de produção.

O relatório atribuiu uma falha da Vercel a `output: "standalone"`. Não houve inspeção dos logs desse deploy nesta revisão. Não repita essa causa como confirmada; investigue os logs se isso entrar no escopo.

O relatório também chamou a migração SQL de prioridade de “opcional”. Defaults só existem após criar as colunas. O código que passa a ler/escrever essas colunas exige a migração correspondente, ou uma estratégia explícita de compatibilidade durante o rollout.

## Minha preferência de trabalho

Neste chat, o Codex deve apenas preparar prompts. Você, Claude, será responsável por editar o projeto conforme o prompt de implementação que vou colar em seguida.

Faça correções locais completas, com testes que exercitem os comportamentos descritos. Não apresente apenas um plano. Preserve dados, segredos e mudanças de terceiros. Não publique posts de teste nem altere infraestrutura/produção como parte de uma revisão local.

Quero primeiro corrigir as regressões e garantir postagem previsível; depois concluir a preparação da VPS; então avaliar novas melhorias. Não reescreva o SaaS e não acrescente funcionalidades sem relação com esses objetivos.
