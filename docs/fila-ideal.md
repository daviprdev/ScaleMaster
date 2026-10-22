# Raio-X da fila — regras (v2, igual ao Hotler)

Botão no canto inferior direito do dashboard → janela central "Raio-X da fila". Lê UMA fila rodando (campanha ativa do Postar; Loop ativo também entra) e mostra três blocos, no layout do print do Hotler que o dono mandou:

1. **Números do topo** — publicações da fila, visualizações, views por publicação, seu melhor post.
2. **"Um post seu está indo muito bem agora"** — o post de mais views + botão **Publicar nas outras contas**.
3. **"A sua fila ideal, montada com o que já funciona"** — melhores vídeos × melhores contas + botão **Montar essa fila**, que abre o Postar com esses vídeos (e contas) já selecionados. O card mostra só os vídeos; a lista de contas saiu a pedido do dono (22/10), mas as contas continuam indo marcadas para o Postar.

O painel só lê. Nada muda a distribuição automática: a fila ideal só vira campanha quando o dono confirma no Postar.

Contratos: `lib/queue-insights/types.ts` (dados) e `lib/queue-insights/handoff.ts` (passagem para o Postar).

## Quais filas

O seletor mostra só filas rodando — campanhas ativas do Postar primeiro, depois Loops ativos. Pausada ou terminada não aparece. Abre na campanha com mais posts nas últimas 24h. Com uma fila só, não mostra seletor.

## Posts que entram

- Só os reels publicados DESTA fila (campanha: `scheduled_posts.campaign_id`; Loop: `pending_containers.loop_id`), desde o começo dela (até 30 dias).
- **Post contado** = tem views lidas (`insights_plays` não nulo) e foi publicado há **1h ou mais**. Posts mais novos entram só no total de publicações (o número ainda está subindo).
- Views = a leitura mais recente (o sync relê a cada 30 min nas primeiras 2h, de hora em hora até 6h).
- Mesmo Reel importado duas vezes na Biblioteca conta como um vídeo só (`videoKey`).

## 1. Números do topo

| Campo | Regra |
|---|---|
| publicações da fila | reels publicados da fila |
| visualizações | soma das views |
| views por publicação | média das views dos posts contados |
| seu melhor post | maior views de um post da fila |

## 2. Post indo muito bem agora

- O post contado de **mais views publicado nas últimas 48h** (sem nenhum, o de mais views da fila). Só aparece se tiver views > 0.
- Sobrelinha: "X views em dd/mm às HHh" (hora da publicação, BRT).
- Texto: "A publicação da @conta já passou de X visualizações. Esse vídeo já rende bem em geral: Y visualizações na publicação típica dele. Vale colocar esse vídeo nas outras contas ainda hoje — o assunto está quente." (Y = mediana das views desse vídeo na fila.) Se Y ficar abaixo da média da fila: "Esse post saiu da curva: na publicação típica o vídeo faz Y visualizações. Vale testar ele nas outras contas ainda hoje."
- Botão **Publicar nas outras contas**: abre o Postar com esse vídeo e as contas da fila (ativas, sem erro) que não postaram ele nas últimas 24h; início em 5 min, 5 min entre contas. (Não usa o histórico completo nem os agendados: numa campanha que roda a pasta inteira toda conta já tem todo vídeo agendado.)
- Se nenhum post das últimas 48h tiver views, o card mostra o post de mais views da fila.

## 3. Fila ideal

- **A** = views por publicação da fila (média dos posts contados).
- **Vídeo elegível**: posts contados em **3 contas ou mais** e ainda na pasta da fila. Média = média das views dos posts dele.
- **Vídeos escolhidos**: elegíveis com média ≥ A, do maior para o menor, no máximo 10. Se menos de 3 passarem de A, pega os 3 melhores elegíveis.
- **Contas escolhidas**: contas da fila ativas e sem erro, com 3+ posts contados e média ≥ A, da maior para a menor. Se menos de 3, as 3 melhores.
- **Publicações por ciclo** = vídeos × contas (cada conta posta cada vídeo uma vez, em rodízio — nenhuma conta repete vídeo no ciclo).
- **Ritmo** = o mesmo da fila: intervalo por conta (Postar: 1440 ÷ posts_per_day; Modo Ciclo: medido nos posts; Loop: interval_minutes), com teto de 48 posts/dia.
- **Views esperadas por publicação** = média das views dos posts em que um vídeo escolhido saiu numa conta escolhida (precisa de 5+ posts assim); senão, média das médias dos vídeos escolhidos. Sobrelinha: "~X views por publicação".
- **Material mediano** = mediana das views dos posts contados da fila.
- **Melhor horário** = hora BRT de publicação em que as contas escolhidas tiveram a maior média (hora com 5+ posts contados). Vira o início sugerido no Postar (próxima HH:00, pelo menos 10 min à frente); sem horário, ou com ritmo de 12+ posts/dia (a fila passa pelo dia todo), agora + 10 min.
- **Padrão do dia**: o dia da fila (BRT, 20+ posts contados) com a maior média por post; se nele nenhuma conta postou o mesmo vídeo duas vezes, o texto cita a data.
- Texto: "Cruzei os seus N melhores vídeos com as suas M melhores contas: P publicações por ciclo, uma a cada X min. — são V visualizações por publicação, contra Y do seu material mediano. E o melhor horário para elas é HHh, onde você tem tido Z visualizações. Nenhuma conta repete o mesmo vídeo — que foi o padrão do dia dd/mm." (as frases de horário e de dia somem quando não há dado).
- Rodapé: "Refeita toda vez que você abre o Raio-X, com os números mais recentes. Dá para mudar tudo antes de publicar."
- Sem nenhum vídeo elegível: o bloco diz por quê ("Ainda nenhum vídeo tem posts com 1h+ em 3 contas — a fila ideal aparece assim que tiver"; fila com menos de 3 contas: "Essa fila tem menos de 3 contas — a fila ideal precisa de vídeos rodando em 3 contas").
- Ritmo do Postar normal: o `posts_per_day` da própria campanha (sem ida e volta pelo intervalo, que arredondaria 47/dia para 48).

## Montar essa fila → Postar

`saveHandoff({ kind: "ideal", videoIds, accountIds, postsPerDay, startAt, defaults })` e abre `/dashboard/postar?ideal=<id>`. O Postar mostra os vídeos da fila ideal no lugar da pasta, com as contas marcadas, o ritmo e o início preenchidos; o dono ajusta o resto e confirma. O distribute recebe `video_ids` e faz o rodízio.

## SQL

`supabase/fila_ideal.sql` (aplicado em 21/10/2026): `insights_plays_at`, `pending_containers.published_at`, `distribute_campaigns.video_ids`, histórico `post_views_snapshots`.
