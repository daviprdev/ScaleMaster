/**
 * Histórico de vídeos por conta — leitura à prova do teto de linhas do PostgREST.
 *
 * O PostgREST corta TODA resposta em 1000 linhas e o `.limit()` do cliente não
 * bypassa esse teto (`Content-Range: 0-999/26943`). As queries de anti-repetição
 * pediam `.limit(100000)` sobre dezenas de milhares de linhas e recebiam 1000
 * silenciosamente — o histórico recente da conta ficava invisível e o pool
 * "disponível" incluía vídeos que ela já tinha postado. Resultado observado em
 * produção: o mesmo vídeo saindo 6-7× para a mesma conta em poucas horas, com
 * pasta de 330 vídeos.
 *
 * O RPC `get_account_video_usage` agrega tudo em UM registro jsonb, então o
 * teto de linhas não se aplica. Fontes cobertas: `pending_containers` (Loop),
 * `scheduled_posts` (Postar/Clonar/Automatizar) e `video_processing_jobs`
 * (vídeos reservados no modo efeitos).
 */

/** account_id → (video_id → nº de vezes que a conta usou o vídeo). */
export type VideoUsageByAccount = Map<string, Map<string, number>>;

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

/**
 * Busca o histórico completo (sem truncamento) das contas informadas.
 *
 * Lança em caso de erro: postar repetido é pior que pular o ciclo — o cron
 * tenta de novo no minuto seguinte.
 */
export async function fetchVideoUsage(
  admin: unknown,
  accountIds: string[],
  sinceIso?: string | null
): Promise<VideoUsageByAccount> {
  const usage: VideoUsageByAccount = new Map();
  if (!accountIds.length) return usage;

  const { data, error } = await (admin as RpcClient).rpc("get_account_video_usage", {
    p_account_ids: accountIds,
    p_since: sinceIso ?? null,
  });

  if (error) {
    throw new Error(`[video-history] get_account_video_usage falhou: ${error.message}`);
  }

  const raw = (data ?? {}) as Record<string, Record<string, number>>;
  for (const [accountId, videos] of Object.entries(raw)) {
    const perVideo = new Map<string, number>();
    for (const [videoId, uses] of Object.entries(videos ?? {})) {
      perVideo.set(videoId, Number(uses) || 0);
    }
    usage.set(accountId, perVideo);
  }
  return usage;
}

/** Conjunto de vídeos que a conta já usou (chaves do mapa de uso). */
export function postedSet(usage: VideoUsageByAccount, accountId: string): Set<string> {
  return new Set(usage.get(accountId)?.keys() ?? []);
}

/**
 * Uso global por vídeo contado 1× por par conta+vídeo.
 *
 * Contar ocorrências brutas dobraria o peso de um vídeo que passou por job E
 * container (o job consumido vira container), distorcendo o balanceamento.
 */
export function globalUsageByVideo(usage: VideoUsageByAccount): Map<string, number> {
  const counts = new Map<string, number>();
  for (const perVideo of usage.values()) {
    for (const videoId of perVideo.keys()) {
      counts.set(videoId, (counts.get(videoId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Lê TODAS as linhas de uma query paginando com `.range()`.
 *
 * Mesmo motivo do RPC acima: o `.limit(10000)` espalhado pelo projeto não
 * bypassa o teto de 1000 do PostgREST. Uma pasta de mídia com mais de 1000
 * vídeos teria o excedente silenciosamente ignorado no pool de seleção.
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw new Error(`[video-history] paginação falhou: ${error.message}`);
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}
