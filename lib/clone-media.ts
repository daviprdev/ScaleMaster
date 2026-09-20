/**
 * lib/clone-media.ts — decisões puras do prefetch do "Clonar Perfil".
 *
 * Ficam aqui (e não dentro da rota) as duas regras que quebraram o Clone em
 * produção, para que possam ser testadas de verdade em vez de conferidas por
 * leitura:
 *
 *   • `dedupeQueueByUrl` — a fila é lida ORDENADA por scheduled_at e só
 *     depois deduplicada por Reel. Deduplicar depois de um `limit` sem ordem
 *     fazia N contas do mesmo Reel ocuparem as N primeiras linhas: o cron
 *     resolvia 1 Reel por ciclo achando que resolvia 8.
 *
 *   • `selectPruneTargets` — arquivo de clone só é apagado quando NENHUM post
 *     pendente aponta para ele. Idade sozinha nunca basta: a mídia de uma
 *     campanha de dias é "velha" no segundo dia e continua sendo necessária.
 *     A limpeza por idade de temp/ (2h) foi exatamente o que apagou a mídia no
 *     meio das campanhas.
 */

export const CLONE_PREFIX = "clone";

/** Extrai o shortCode de um permalink do Instagram (reel, reels ou p). */
export function shortCodeFromUrl(url: string): string | null {
  const m = String(url ?? "").match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

/** Caminho no Storage. Chaveado pelo Reel — não pelo post — para que o mesmo
 *  Reel sirva todas as contas e campanhas com um único download. */
export function storagePathFor(shortCode: string): string {
  return `${CLONE_PREFIX}/${shortCode}.mp4`;
}

/** Nome do arquivo dentro de clone/ a partir da URL pública. */
export function fileNameFromHostedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const part = url.split(`/${CLONE_PREFIX}/`)[1];
  if (!part) return null;
  try {
    return decodeURIComponent(part.split("?")[0]);
  } catch {
    return part.split("?")[0];
  }
}

/**
 * URLs distintas na ordem em que serão publicadas. A entrada DEVE vir
 * ordenada por scheduled_at — a ordem de saída é a de urgência.
 */
export function dedupeQueueByUrl(rows: { video_url: string | null }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const url = row?.video_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Arquivos de clone/ que podem ser apagados: fora do período de graça E sem
 * nenhum post pendente/publicando apontando para eles.
 */
export function selectPruneTargets(
  files: { name: string; created_at: string | null }[],
  referencedUrls: (string | null | undefined)[],
  cutoffMs: number
): string[] {
  const referenced = new Set<string>();
  for (const url of referencedUrls) {
    const name = fileNameFromHostedUrl(url);
    if (name) referenced.add(name);
  }

  return files
    .filter((f) => {
      if (!f.created_at) return false; // sem data conhecida: não arrisca
      if (new Date(f.created_at).getTime() >= cutoffMs) return false;
      return !referenced.has(f.name);
    })
    .map((f) => `${CLONE_PREFIX}/${f.name}`);
}
