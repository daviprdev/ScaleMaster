/**
 * media-order.ts — seleção explícita de vídeos + ordem de publicação na aba
 * Postar.
 *
 * REGRA PERMANENTE: este módulo NÃO toca em bytes de vídeo, Storage, FFmpeg,
 * legenda nem processamento. Ele só decide QUAIS vídeos entram na campanha e em
 * QUE ORDEM cada conta os recebe. A legenda continua vinculada ao vídeo pelo
 * próprio objeto do vídeo (ver resolveCaption em lib/reel-captions.ts) — a
 * mudança de ordem nunca separa vídeo e legenda porque a ordem opera sobre os
 * objetos inteiros, não sobre ids soltos.
 *
 * DOIS MUNDOS, SEM AMBIGUIDADE:
 *   - SEM seleção explícita (selected_video_ids ausente/vazio): comportamento
 *     LEGADO — o pool é a pasta inteira, embaralhada e ordenada por menor uso
 *     global (mantido no route, não aqui). `[]` significa "nenhuma seleção" =
 *     legado; NUNCA "todos" e "nenhum" ao mesmo tempo.
 *   - COM seleção explícita: o pool é EXATAMENTE os vídeos escolhidos, na ordem
 *     de clique (modo "selected") ou embaralhados uma única vez (modo "random").
 *     Nenhum vídeo fora da seleção entra.
 */

export type MediaOrder = "selected" | "random";

export const MEDIA_ORDERS = ["selected", "random"] as const;

/**
 * Ordem padrão quando há seleção mas o campo não veio: "selected".
 * A UI sempre envia, mas o default protege chamadas legadas/malformadas —
 * honrar a ordem de clique é o comportamento menos surpreendente.
 */
export function normalizeMediaOrder(value: unknown): MediaOrder {
  return value === "random" ? "random" : "selected";
}

/**
 * Só é "seleção explícita" quando há um array com pelo menos 1 id. Array vazio
 * ou ausente = sem seleção = caminho legado. É este predicado — e só ele — que
 * separa os dois mundos; não usar `.length` cru espalhado pelo código.
 */
export function hasExplicitSelection(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0;
}

/**
 * Valida e ordena a seleção conforme os cliques do usuário.
 *
 * `byId` deve conter APENAS vídeos já validados como do dono e da pasta (o
 * route monta esse mapa a partir de uma query filtrada por user_id + folder_id).
 * Assim, um id que não está no mapa é vídeo de outra pasta, de outro usuário ou
 * inexistente — e a função rejeita, devolvendo o id ofensor para a mensagem de
 * erro. Isso concentra as três checagens (dono / pasta / existência) num único
 * ponto e nunca confia no id cru do browser.
 *
 * Dedup preservando a PRIMEIRA ocorrência: se o mesmo id vier repetido, a
 * posição dele é a do primeiro clique (a numeração 1,2,3… bate com o que o
 * usuário vê).
 */
export function resolveSelectedVideos<T extends { id: string }>(
  selectedIds: string[],
  byId: Map<string, T>
): { ok: true; videos: T[] } | { ok: false; invalidId: string } {
  const seen = new Set<string>();
  const videos: T[] = [];
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    const v = byId.get(id);
    if (!v) return { ok: false, invalidId: id };
    seen.add(id);
    videos.push(v);
  }
  return { ok: true, videos };
}

/**
 * Pool final a partir da seleção já validada e ordenada.
 *   - "selected": ordem EXATA de clique (cópia, sem reordenar por id/data/nome).
 *   - "random":   embaralhado UMA vez. O shuffle é injetado para o teste poder
 *     torná-lo determinístico; em produção é Fisher-Yates.
 *
 * O congelamento pós-agendamento não acontece aqui e sim no snapshot: o route
 * grava video_id/video_url/caption concretos em scheduled_posts, e o
 * publish-scheduled só relê a linha. Retry nunca reembaralha porque nunca mais
 * passa por esta função.
 */
export function buildSelectedPool<T>(
  selected: T[],
  order: MediaOrder,
  shuffle: (arr: T[]) => T[]
): T[] {
  return order === "random" ? shuffle(selected) : [...selected];
}

/**
 * Sequência LITERAL: `pool[round % poolSize]`, IGUAL para todas as contas.
 *
 * É o modo "Na ordem que escolhi". A ordem do pool é a ordem de clique do
 * usuário e ela é respeitada ao pé da letra: toda conta consome C → A → F → C →
 * A → F… começando em C. Sem offset por conta, sem rotação. Quando há mais
 * posts que vídeos selecionados, cicla. A intenção explícita do usuário tem
 * prioridade sobre qualquer estratégia de diversidade.
 */
export function videoForSequence<T>(pool: T[], round: number): T {
  return pool[round % pool.length];
}

/**
 * Quadrado latino: `pool[(accountIndex + round) % poolSize]`. Usado no modo
 * ALEATÓRIA e no caminho LEGADO (pasta inteira) — NÃO no "Na ordem que escolhi".
 *
 * Conta 0 percorre o pool na ordem dele; as seguintes percorrem a mesma ordem
 * cíclica, defasadas de 1. O efeito colateral é que, na mesma rodada, contas
 * diferentes tendem a receber vídeos diferentes.
 *
 * NOTA (não é regra oficial da Meta): evitar que várias contas publiquem o mesmo
 * vídeo na mesma janela é uma ESTRATÉGIA INTERNA de diversidade do AutoScale —
 * hipótese operacional acumulada em produção, não um comportamento documentado
 * pela Meta. Por isso ela NÃO se aplica ao modo explícito "Na ordem que escolhi",
 * onde o usuário decidiu a sequência de propósito.
 */
export function videoForRound<T>(pool: T[], accountIndex: number, round: number): T {
  return pool[(accountIndex + round) % pool.length];
}
