/**
 * scraped-reel.ts — o ÚNICO lugar que interpreta o retorno do Apify.
 *
 * Antes desta lib, cada rota de scrape lia `item.caption`, `item.shortCode`,
 * `item.videoUrl`… por conta própria, com regras levemente diferentes (a de
 * Inspirações truncava a legenda em 120 chars; a de Clone não). Espalhar
 * `item.caption || item.text || item.description` por cinco arquivos é como se
 * perde legenda em silêncio.
 *
 * ACTOR REAL EM USO: `apify/instagram-scraper` (com `directUrls` +
 * `resultsType: "posts"`). Não é o `apify~instagram-reel-scraper` citado no
 * histórico antigo do CLAUDE.md — a troca já estava feita no código.
 *
 * NOMES DE CAMPO CONFIRMADOS na referência oficial do actor (apify.com,
 * consultada em 2026-09-07) e batendo com o que o código de produção já lia:
 *
 *   caption        legenda da publicação
 *   ownerUsername  @ do autor
 *   url            permalink (https://www.instagram.com/p/XXXX/)
 *   shortCode      código curto do post
 *   videoUrl       URL do arquivo de vídeo no CDN
 *   type           "Video" | "Image" | "Sidecar"
 *
 * Nenhum campo alternativo (`text`, `description`) é lido: não há evidência de
 * que o actor os produza, e chutar nome de campo é como se acaba gravando
 * legenda errada — ou nenhuma.
 */

/** Reel normalizado. É este o formato que circula no AutoScale. */
export interface ScrapedReel {
  id: string;
  shortCode: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  /**
   * Legenda ORIGINAL, exatamente como veio — sem truncar, traduzir, resumir
   * ou reescrever. Emojis, acentos, quebras de linha, hashtags e @menções
   * ficam intactos.
   *
   * Três estados, e a diferença importa:
   *   string não vazia → o Reel tem legenda
   *   ""               → o campo veio no payload, mas vazio (Reel sem legenda)
   *   null             → o campo NÃO veio no payload (não capturado/indisponível)
   */
  originalCaption: string | null;
  /** @ do autor original. */
  sourceUsername: string | null;
  /** Permalink da publicação no Instagram. */
  sourceUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  duration: number;
}

type RawItem = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * URL do arquivo de vídeo. Os quatro nomes abaixo já eram tentados nas rotas
 * originais — mantidos porque são comprovados em produção (o `playVideoUrl`
 * entrou depois de reels que só devolviam esse campo falharem, fix de
 * 2026-06-23).
 */
export function resolveVideoUrl(item: RawItem): string {
  return (
    str(item.videoUrl) ??
    str(item.video_url) ??
    str(item.videoPlayUrl) ??
    str(item.playVideoUrl) ??
    ""
  );
}

/**
 * Legenda original.
 *
 * `typeof === "string"` em vez de `?? ""`: é o que preserva a diferença entre
 * "veio vazio" e "não veio". `String(item.caption ?? "")` — como o código
 * antigo fazia — apagava essa distinção, transformando os dois casos em `""`.
 *
 * RESSALVA HONESTA: não foi possível observar um payload real de Reel SEM
 * legenda (o token Apify local está inválido), então não está confirmado se o
 * actor devolve `caption: ""` ou omite o campo nesse caso. Os dois são
 * tratados, mas só um deles é o que o actor realmente faz — ver relatório.
 */
export function extractOriginalCaption(item: RawItem): string | null {
  return typeof item.caption === "string" ? item.caption : null;
}

/** Permalink da publicação. */
export function extractSourceUrl(item: RawItem): string | null {
  const direto = str(item.url);
  if (direto) return direto;
  // Reconstrói a partir do shortCode quando o actor não mandou a URL pronta.
  const sc = str(item.shortCode);
  return sc ? `https://www.instagram.com/p/${sc}/` : null;
}

/**
 * Converte um item cru do dataset do Apify no formato do AutoScale.
 *
 * `fallbackUsername` só é usado quando o item não traz `ownerUsername` — é o
 * perfil que o usuário pesquisou, e não um chute.
 */
export function normalizeScrapedReel(
  raw: unknown,
  fallbackUsername?: string,
  index = 0
): ScrapedReel {
  const item = (raw ?? {}) as RawItem;

  return {
    id: String(item.id ?? item.shortCode ?? index),
    shortCode: str(item.shortCode) ?? "",
    thumbnailUrl: str(item.displayUrl) ?? str(item.thumbnailUrl),
    videoUrl: resolveVideoUrl(item),
    originalCaption: extractOriginalCaption(item),
    sourceUsername: str(item.ownerUsername) ?? fallbackUsername ?? null,
    sourceUrl: extractSourceUrl(item),
    views: num(item.videoViewCount),
    likes: num(item.likesCount),
    comments: num(item.commentsCount),
    duration: num(item.videoDuration),
  };
}

/** Só o que tem vídeo aproveitável. */
export function isUsableReel(reel: ScrapedReel): boolean {
  return reel.videoUrl !== "" && reel.videoUrl !== "undefined";
}

/** Normaliza uma lista inteira do dataset. */
export function normalizeScrapedReels(
  items: unknown[],
  fallbackUsername?: string,
  offset = 0
): ScrapedReel[] {
  return items.map((item, i) => normalizeScrapedReel(item, fallbackUsername, i + offset));
}
