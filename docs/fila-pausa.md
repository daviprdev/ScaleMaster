# Aba Fila — vídeos da fila, um por um

Menu PUBLICAÇÃO → **Fila** (`/dashboard/fila`). Escolhe uma pasta da Biblioteca que tem fila rodando e vê cada vídeo dela com posts, média por post e views, e um liga/desliga que tira o vídeo da fila. Serve para não deixar vídeo ruim queimar a fila.

Desenho = o print de referência que o dono mandou (SaaS de um amigo): por linha, capa, "↻ POSTS", "↗ MÉDIA/POST", "👁 VIEWS", Ativo/Pausado e play. Nada além disso na tela — ideia extra vira pergunta antes.

Código: `lib/fila` (dados e pausa), `app/api/fila` (rotas), `app/dashboard/fila` + `components/dashboard/fila` (tela).

## Pastas

- Só pastas com fila rodando: campanha ativa do Postar ou Loop ativo — o mesmo seletor do Raio-X (`loadQueueList`), agrupado pela pasta de vídeos da fila.
- Abre na pasta da fila com mais posts nas últimas 24h; a tela lembra a última pasta escolhida.

## Números de cada vídeo

| Campo | Regra |
|---|---|
| Posts | reels publicados com o vídeo pelas filas rodando da pasta (Postar: `scheduled_posts.campaign_id`; Loop: `pending_containers.loop_id`), desde o começo de cada fila, até 30 dias (mesma janela do Raio-X) |
| Views | soma da leitura mais recente de cada post (post sem leitura conta 0) |
| Média/post | views ÷ posts — conta simples, como no print de referência |

Ordem: menos views primeiro (como no print). Vídeo sem post fica no fim. A rota também devolve o resumo da fila (`summary`: posts, views e média views ÷ posts de todas as filas da pasta), que a tela não mostra.

## Pausar

`videos_library.queue_paused_at` (nulo = ativo), gravado por `PATCH /api/fila/videos`. SQL manual: `supabase/fila_pausa_videos.sql`.

Pausado = fora da fila até ser reativado:

- **Postar, campanha nova** (`posts/distribute`): o vídeo não é sorteado. A fila ideal do Raio-X (lista explícita) fica como veio.
- **Postar, conta que entra pela pasta sincronizada** (`sync-distribute-accounts`): o vídeo não é sorteado; o teto por conta continua o da pasta inteira, então a conta segue no ritmo com os vídeos ativos.
- **Loop** (`process-loops`): o vídeo sai do sorteio. Com todos pausados, o card do loop mostra o motivo.
- **Post já agendado** (`publish-scheduled` → `deferPausedPosts`): quando vence, troca vídeo, link e legenda com um post pendente posterior da mesma conta na campanha — o mais distante que não esteja saindo em outra conta na mesma hora. A conta mantém o ritmo e o vídeo pausado vai para o fim da fila dela. Sem post para trocar, é cancelado ("Vídeo pausado na aba Fila — post não enviado."). Só campanhas ativas do Postar; Agendar/Clone/Automatizar e campanha pausada não são tocados.
- Container do Loop já criado publica normalmente (sai em minutos).

Reativar devolve o vídeo ao sorteio; o post que foi para o fim da fila sai no horário dele.

Tudo fail-open: sem a coluna (SQL pendente) ou com erro de leitura, nada é pausado e a publicação segue como antes. A tela mostra os números e avisa que o botão depende do SQL.

## Contas em fila (verde nos seletores)

No Postar (Nova Distribuição) e no Loop (Contas específicas), a conta que já está numa fila aparece em verde; passar o mouse mostra qual ("na fila: Postar · pasta VITORIAOFZ"). O botão "Novas (N)" do Postar seleciona só as que não estão em verde. Rota `GET /api/accounts/queues`, regra em `lib/fila/account-queues.ts`.

Em fila = a conta posta (ou vai postar) por uma campanha do Postar ou Loop ativa ou pausada:

- **Matriculada** (já posta pela fila): no Postar, tem post pendente/publicando na campanha, ou a campanha é sincronizada com a pasta dela, a conta está ativa e sem erro, já postou nela e não chegou ao teto de vídeos; no Loop, foi escolhida (contas específicas) ou, em modo pasta, postou por ele nos últimos 2 dias.
- **A caminho**: a fila ainda não postou na conta, mas vai puxá-la pela pasta (conta ativa e sem erro na pasta sincronizada/do Loop). Só conta se a conta não estiver matriculada em outra fila.
- Editando um Loop, as contas dele não contam.

Conta recém-conectada entra inativa: fica livre (sem verde) até ser ativada.

## Fila por pasta não puxa conta de outra fila

A campanha sincronizada do Postar (`sync-distribute-accounts`) e o Loop em modo pasta (`process-loops`) puxam sozinhos as contas ativas da pasta. Desde 22/10, conta **nova nessa fila** (ainda sem post nela) que já está **matriculada em outra fila** não é puxada — no log: "N conta(s) nova(s) da pasta já em outra fila — não puxada(s)". Conta que já posta pela fila segue normalmente, mesmo que esteja em outra também (sem isso, duas filas sincronizadas com a mesma conta travariam uma à outra). A regra é a mesma do verde (`findAccountsBusyElsewhere` → `loadAccountQueues`); erro de leitura não barra ninguém.

Caso que motivou: pastas de contas separadas por modelo. Contas novas na pasta VITORIAOFZ ganham uma fila nova sem que a campanha antiga, sincronizada com a mesma pasta, puxe as mesmas contas quando elas forem ativadas.
