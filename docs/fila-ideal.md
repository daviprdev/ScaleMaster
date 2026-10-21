# Raio-X da fila — regras

Painel aberto pelo botão flutuante do canto inferior direito do dashboard. Para UMA fila (campanha do Postar ou Loop) mostra o resumo, o post fora da curva e a fila ideal (melhores vídeos × melhores contas). O botão "Montar essa fila" abre o Postar já preenchido; o dono revisa e confirma. **O painel só lê**: nada aqui muda a distribuição automática.

Contratos: `lib/queue-insights/types.ts` (dados) e `lib/queue-insights/handoff.ts` (passagem para o Postar).

**Quais filas:** o seletor mostra só as filas rodando agora — campanhas ativas do Postar (primeiro) e Loops ativos. Pausada ou terminada não aparece. Tudo que o painel mostra vem dos posts da fila escolhida; o resumo conta desde o começo dela (até 30 dias). Só o "normal da conta" olha os outros posts da própria conta.

## Constantes

| Nome | Valor | Uso |
|---|---|---|
| `MATURE_HOURS` | 4 | post maduro |
| `ANALYSIS_DAYS` | 14 | nota dos vídeos, contas, horário, melhor dia |
| `SUMMARY_DAYS` | 30 | resumo do topo |
| `NORMAL_MIN_POSTS` | 20 | amostra mínima do normal |
| `NORMAL_MIN_VIEWS` | 30 | conta só vota com normal ≥ 30 |
| `MIN_VOTING_ACCOUNTS` | 3 | vídeo precisa de 3 contas votantes |
| `MIN_SCORE` | 1.2 | vídeo precisa render 20% acima do normal |
| `GOOD_ACCOUNT_REF_RATIO` | 0.5 | conta boa ≥ metade da conta típica |
| `HOT_MIN_MULTIPLE` | 5 | post fora da curva |
| `HOT_PERCENTILE` | 0.9 | e entre os 10% com mais views da fila |
| `HOT_WINDOW_HOURS` | 48 | candidatos a "bombando agora" |
| `REPOST_MIN_PAIRS` | 30 | pares para medir o fator de repost |
| `MAX_POSTS_PER_DAY` | 48 | teto do ritmo da fila ideal |
| `LOAD_WARN` | 45 | aviso do freio de ~50 posts/24h |

Hora e dia sempre em BRT (offset fixo −3h, `lib/brt-time.ts`).

## 1. Quais posts entram

- Postar: `scheduled_posts` com `status='published'`, `post_type<>'story'`, `published_at` preenchido. Hora de publicação = `published_at`.
- Loop: `pending_containers` com `status='published'` e `media_id` preenchido. Hora = `published_at` (coluna nova) ou, sem ela, `GREATEST(created_at, COALESCE(retry_after, created_at))` (erro de ~3 min) — `publishedAtEstimated = true`.
- `views` = `insights_plays`. `viewsReadAt` = `insights_plays_at` (coluna nova, gravada só quando a leitura trouxe views) ou, sem ela, `insights_fetched_at`.
- **Post maduro**: `views` não nulo E `now − publishedAt ≥ 4h` E `viewsReadAt − publishedAt ≥ 4h`.
- Post com `videoId` nulo (vídeo apagado da Biblioteca) conta nos totais e no normal da conta, nunca na nota de vídeo nem na fila ideal.
- `videoKey` = shortcode normalizado do `videos_library.source_url` (`/reel/<code>/`, `/p/<code>/`, `/reels/<code>/`) quando existe, senão o `video_id` — junta o mesmo Reel importado duas vezes.
- Contas distintas contam por `igAccountKey` (`ig_business_account_id`, senão o `account_id`).

## 2. Normal da conta

Usa `accountPosts` (todas as origens, contas da fila, 17 dias).

- **Normal local** de um post publicado no dia BRT `d`: mediana das views dos posts maduros da conta nos dias `d−1..d+1`. Com menos de 20, `d−3..d+3`. Com menos de 20, toda a janela de 14 dias. Com menos de 20, não há normal (o post não vota).
- **Normal atual** da conta: mediana dos posts maduros publicados nos últimos 3 dias; com menos de 20, 7 dias; com menos de 20, 14 dias (`normalWindowDays = 14`, "dado antigo"); com menos de 20, `null` ("sem dados").
- Não existe fallback para a mediana da fila.

## 3. Nota do vídeo (só posts DESTA fila, 14 dias)

- Múltiplo do post = `views ÷ normal local`, só se o normal local existir e for ≥ 30.
- Para cada par (videoKey, conta): mediana dos múltiplos daquela conta — **uma conta, um voto**.
- `score` = **mediana** dos votos. `votingAccounts` = nº de contas que votaram. `accountsAboveNormal` = votos ≥ 1.
- Status:
  - `passes`: `votingAccounts ≥ 3` E `score ≥ 1.2` E há um `video_id` desse videoKey na pasta da fila.
  - `removed`: nenhum `video_id` existente (vídeo apagado).
  - `not_in_folder`: o vídeo existe mas não está mais na pasta da fila.
  - `few_accounts`: `votingAccounts < 3`.
  - `below_bar`: `votingAccounts ≥ 3` e `score < 1.2`.
- Ranking: `score` desc, depois `votingAccounts` desc, depois `matureViewsMedian` desc. `matureViewsMedian/Mean` são só informativos (todas as contas, maduros).
- O `videoId` exibido/enviado é o que está na pasta da fila (se houver mais de uma cópia, a que tem o post mais recente nesta fila; sem posts, a importada por último).
- Campanha criada pela fila ideal (`distribute_campaigns.video_ids`): a lista fixa faz o papel da pasta (cap, "impossível" e previsão).

## 4. Melhores contas

- Candidatas: contas da fila (`queue.accountIds`) com `is_active` e `health_status ≠ 'error'`. As demais aparecem como `inactive`.
- Sem normal atual → `no_data`.
- `ref` = mediana dos normais atuais das candidatas com normal ≥ 30.
- `good`: normal atual ≥ 30 E ≥ 0,5 × `ref`. Caso contrário `weak`.
- Ordem: `good` por normal atual desc, depois `weak`, `no_data`, `inactive`.
- Padrão de M = todas as `good`. O +/− do painel percorre essa ordem (contas fora de `good` entram com aviso).

## 5. Fila ideal (`buildIdealQueue`, puro, também roda no navegador)

- N padrão = `min(vídeos que passam, maxN)`; `maxN` = `queue.videoCountCap` (Postar: `video_count`, −1 = vídeos da pasta; Loop infinito: vídeos da pasta; Loop finito: `min(cycles, media_limit, vídeos da pasta)`). O +/− vai de 1 até o nº de vídeos que passam.
- Vídeos = os N primeiros que passam; contas = as M primeiras da ordem do item 4.
- Rodízio (feito pelo distribute): na rodada `k` a conta da posição `i` recebe `videoIds[(i+k) mod N]`. **Repost permitido** (a conta pode já ter postado o vídeo antes), nunca 2× no mesmo ciclo.
- `postsPerCycle = N × M`. `alreadyPostedPairs` = pares em que a conta já usou o vídeo.
- Intervalo herdado:
  - Postar normal: `floor(1440 / posts_per_day)` da campanha.
  - Postar em Modo Ciclo: `1440 / round(1440 / mediana dos intervalos reais entre publicações de cada conta)` — medido nos posts.
  - Loop: `interval_minutes`.
  - `postsPerDay = clamp(round(1440 / intervalo), 1, 48)` e o intervalo exibido passa a ser `floor(1440 / postsPerDay)`.
- `cycleMinutes = N × intervalo`.
- Stagger efetivo = `accountStaggerSeconds ?? min(300, floor(0.9 × intervalo × 60 / (M − 1)))` (M > 1). `sameVideoGapSeconds = N × stagger` quando `M > N`; senão `null`.
- **Previsão por post** = média da grade N×M de `normalAtual(conta) × score(vídeo) × (conta já usou o vídeo ? r : 1)`. Contas sem normal atual ficam fora da média.
- `videosFactor` = média dos scores dos N vídeos ÷ `currentMeanVideoScore`; `accountsFactor` = média dos normais das M contas ÷ `currentMeanAccountNormal`.
- **Fila de hoje na mesma régua** (`currentTypicalPerPost`): média, nos posts maduros da fila dos últimos 7 dias, de `normalAtual(conta) × (score(vídeo) ?? 1)` (contas sem normal ficam fora). `currentMeanVideoScore` e `currentMeanAccountNormal` são as médias desses mesmos posts. `currentObservedMedian` = mediana real das views maduras da fila (14 dias).
- **Fator de repost r**: para cada par (videoKey, conta) com 2+ posts maduros em `accountPosts` (múltiplo calculado com o normal local ≥ 30), razão = mediana dos múltiplos do 2º post em diante ÷ múltiplo do 1º. `r` = mediana das razões se houver ≥ 30 pares; senão 1. Se `r < 0.8`: aviso "repost tem rendido X% menos".
- Início: ver item 6. Avisos: fila curta (N < 5), repost.
- Texto (template): título "A sua fila ideal, montada com o que já funciona"; corpo no estilo "Cruzei os seus N melhores vídeos com as suas M melhores contas: P publicações por ciclo, uma a cada X min por conta — previsão de V views por publicação, contra T da fila de hoje (mediana real Y). O ganho vem Z× dos vídeos e W× das contas. Começa às HHh, onde ... Nenhuma conta repete o mesmo vídeo no ciclo."

## 6. Melhor horário e início

- Posts maduros da fila (14 dias) com múltiplo (normal local ≥ 30), agrupados pela hora BRT da publicação.
- Hora qualificada: ≥ 10 posts e ≥ 3 contas distintas. `hourScores[h]` = mediana dos múltiplos.
- Existe melhor horário se houver ≥ 3 horas qualificadas e a melhor tiver score ≥ 1,2 × a mediana dos scores das horas qualificadas. Senão `bestHour = null` ("o horário não fez diferença nesta fila").
- `typicalViews` = mediana das views brutas na hora das contas boas se tiverem ≥ 5 posts nela, senão da fila toda.
- Início da fila ideal:
  - Se `postsPerDay ≥ 12` (intervalo ≤ 2h) ou não há `bestHour`: `startAt` = agora + 10 min (arredondado para cima no múltiplo de 5 min), `startHour = null`.
  - Senão escolhe a fase `s` (0–23) que maximiza a média dos scores das horas `floor(s + k × intervalo/60) mod 24` para `k = 0 … min(N, postsPerDay) − 1` (hora sem score conta 1,0). `startAt` = a próxima `s:00` BRT que seja ≥ agora + 10 min; `startHour = s`.

## 7. Melhor dia (a "prova")

- Dias BRT completos da janela de 14 dias, anteriores a hoje, com ≥ 90% dos posts maduros, ≥ `max(20, 50% da mediana diária de posts da fila)` posts e ≥ 3 contas.
- Ranking pela mediana do múltiplo (posts com normal local ≥ 30). `meanViews`/`medianViews` só como texto.
- Padrão do dia (`DayPattern`): contas, posts, intervalo (para cada conta com ≥ 2 posts no dia nesta fila, mediana dos gaps; depois mediana entre contas; `null` em Modo Ciclo), faixa horária p10–p90, `repeatedSameDay` (mesma conta + videoKey 2× no dia), `repeatedFromBefore` (a conta já tinha usado o vídeo antes, qualquer origem dentro de `accountPosts`), `accountsAlsoInOtherQueues`.
- `today` = o mesmo padrão para hoje até agora (sem views).

## 8. Post bombando agora

- Candidatos: posts da fila publicados nas últimas 48h, maduros, com normal local (qualquer valor > 0).
- Destaque se `múltiplo ≥ 5` E `views ≥ p90` das views maduras da fila em 30 dias. Ordem por múltiplo; até 3 (o 1º em destaque).
- Sem destaque: `fallback` = o post maduro de mais views das 48h; texto "Nenhum post fora da curva nas últimas 48h".
- Selo "ainda subindo" (só com `snapshots`): leitura mais recente vs a leitura anterior a ≥ 3h dela; se o ganho for ≥ 20% e ≥ normal local → "+X views desde a leitura das HHh".
- `republishAccountIds`: contas da fila ativas, sem erro, cujo `usedVideoIdsByAccount` não tem o vídeo do 1º destaque (ou do fallback).
- Texto: "A publicação da @conta já passou de X visualizações — Y× o normal da conta, entre os 10% melhores da fila. Vale colocar esse vídeo nas outras contas." Post de Loop acrescenta "o próprio Loop já vai levar esse vídeo às outras contas; o botão antecipa".

## 9. Prontidão

- `coveredVideos` = videoKeys com ≥ 3 contas distintas com post maduro nesta fila (14 dias).
- `impossible` (só Postar): `M_fila × videoCountCap ÷ vídeos da pasta < 3` (Loop: menos de 3 contas). Mensagem: "Essa fila não repete vídeo em 3 contas — a régua não vai fechar".
- `collecting`: `coveredVideos < 3`. `etaHours ≈ 3 × V × I / M + 4 − horas desde a criação da fila` (I em horas; ≥ 0; `null` em Modo Ciclo). Mensagem: "Coletando dados: X vídeos já rodaram em 3+ contas com leitura de 4h (precisa de 3). Y vídeos estão em 1–2 contas e Z posts aguardam a leitura de 4h. Previsão: ~Hh."
- `no_accounts`: nenhuma conta `good`. "Nenhuma conta passou de 30 views por post ainda." — ou, quando nenhuma conta tem normal (menos de 20 posts lidos em 14 dias), "As contas ainda não têm 20 posts lidos nos últimos 14 dias para medir o normal."
- Sem previsão (`etaHours = null`) com a fila pausada/terminada ou quando o prazo já passou sem cobertura.
- `few_good`: `coveredVideos ≥ 3` mas menos de 3 vídeos passam. "Já dá para comparar X vídeos, mas só Y estão acima do normal das contas — a fila ideal precisa de 3."
- `ready`: 3+ vídeos passam e há contas boas. `ideal` só é calculado nesse estado.

## 10. Resumo (30 dias da fila)

- `posts` = reels publicados; `totalViews` = soma das views (inclui contas fora do ar, valor congelado); `viewsPerPost` = média dos maduros com views; `medianViews` = mediana dos maduros; `bestPost` = maior views (com múltiplo pelo normal local, quando houver).
- Frescor: `viewsReadUntil` = max(`viewsReadAt`); `awaitingMatureRead` = posts da fila das últimas 48h sem leitura madura; `frozenAccountPosts` = posts de contas inativas ou com erro.

## 11. Carga por conta (freio de ~50/24h)

`accountLoad24h[conta]` = publicados nas últimas 24h (Postar + Loop) + `scheduled_posts` pendentes nas próximas 24h de campanhas não pausadas + `round(1440 / interval_minutes)` de cada Loop ativo da conta. O painel soma o `postsPerDay` da fila ideal e avisa acima de 45. Nada é pausado sozinho.

## 12. Postar em modo fila ideal

- `/api/posts/distribute` aceita `video_ids` (1–50, sem repetir, na ordem do score). Com `video_ids`: `folder_id` opcional (a linha da campanha usa a pasta da fila de origem ou a do 1º vídeo), `video_count = N`, atribuição por rodízio (`assignRotation` em `lib/media-priority.ts`), idempotência inclui a lista. Recusa (400) `burst_mode` e `sync_folder_ids` não vazio junto com `video_ids`, e vídeos que não são do usuário. Sem `video_ids`, nada muda.
- `/dashboard/postar?ideal=<id>` lê o `localStorage` (`takeHandoff`) depois de carregar as contas, aplica uma vez e limpa a URL. A lista de vídeos substitui o seletor de pasta; Modo Ciclo e "Sincronizar com pasta" ficam escondidos.
- "Publicar nas outras contas" = handoff `kind: "republish"` com 1 vídeo, contas `republishAccountIds`, início agora + 5 min, stagger de 300 s, `postsPerDay = 1`.

## 13. SQL manual (`supabase/fila_ideal.sql`)

Colunas `insights_plays_at` (scheduled_posts, pending_containers), `pending_containers.published_at`, `distribute_campaigns.video_ids`; tabela `post_views_snapshots` gravada por trigger `BEFORE UPDATE OF insights_plays` (só reels, só leituras até 48h, nunca derruba o update); índices. Purga de 7 dias no cron horário `check-views-goal`. O código funciona sem o SQL e lista o que falta em `missingSql`.
