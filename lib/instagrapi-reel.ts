/**
 * instagrapi-reel.ts — o ÚNICO lugar que interpreta o payload de reels vindo
 * do python_server (/instagram/scrape-profile), espelhando a filosofia de
 * lib/scraped-reel.ts (que faz o mesmo para a Apify).
 *
 * O python (instagram_scraper._media_to_reel) já entrega campos limpos e
 * explícitos — nomes DIFERENTES dos da Apify, por isso um normalizador
 * separado em vez de reusar normalizeScrapedReel. A saída é IDÊNTICA à do
 * poll da Apify (processItems), para plugar sem mudança no grid das
 * Inspirações e no contrato de save-to-library (ReelPayload).
 *
 * Três estados da legenda preservados:
 *   texto  → o reel tem legenda
 *   ""     → reel sem legenda (campo veio vazio)
 *   null   → não capturada (campo ausente no payload)
 */

/** Reel cru como o python devolve. */
export interface RawInstagrapiReel {
  pk: string;
  code: string;
  video_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string | null;
  source_url: string | null;
}

/** Reel no formato que a UI das Inspirações consome (igual ao poll da Apify). */
export interface InstagrapiUiReel {
  id: string;
  shortCode: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  /** null (não capturada) vira "" na fronteira com a UI; o cru segue em originalCaption. */
  caption: string;
  originalCaption: string | null;
  sourceUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string;
  gradient: string;
}

// Mesma paleta usada no poll da Apify — mantém os cards visualmente idênticos
// independente da fonte.
const GRADIENTS = [
  "from-violet-600 to-purple-800",
  "from-cyan-500 to-blue-700",
  "from-pink-500 to-rose-700",
  "from-emerald-500 to-teal-700",
  "from-amber-500 to-orange-700",
  "from-indigo-500 to-violet-700",
  "from-red-500 to-pink-700",
  "from-teal-500 to-cyan-700",
  "from-fuchsia-500 to-purple-700",
  "from-lime-500 to-green-700",
  "from-sky-500 to-indigo-700",
  "from-orange-500 to-amber-700",
];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Só o que tem vídeo aproveitável. */
export function isUsableInstagrapiReel(r: RawInstagrapiReel): boolean {
  return typeof r.video_url === "string" && r.video_url !== "" && r.video_url !== "undefined";
}

export function normalizeInstagrapiReel(
  raw: RawInstagrapiReel,
  fallbackUsername: string,
  index = 0
): InstagrapiUiReel {
  const shortCode = typeof raw.code === "string" ? raw.code : "";
  const originalCaption = typeof raw.caption === "string" ? raw.caption : null;
  const owner = (typeof raw.owner === "string" && raw.owner.trim() !== "" ? raw.owner : fallbackUsername);

  return {
    id: String(raw.pk || shortCode || index),
    shortCode,
    thumbnailUrl: typeof raw.thumbnail_url === "string" && raw.thumbnail_url !== "" ? raw.thumbnail_url : null,
    videoUrl: typeof raw.video_url === "string" ? raw.video_url : "",
    caption: originalCaption ?? "",
    originalCaption,
    sourceUrl:
      typeof raw.source_url === "string" && raw.source_url !== ""
        ? raw.source_url
        : shortCode
        ? `https://www.instagram.com/reel/${shortCode}/`
        : null,
    views: num(raw.views),
    likes: num(raw.likes),
    comments: num(raw.comments),
    duration: num(raw.duration),
    owner,
    gradient: GRADIENTS[index % GRADIENTS.length],
  };
}

export function normalizeInstagrapiReels(
  raws: RawInstagrapiReel[],
  fallbackUsername: string
): InstagrapiUiReel[] {
  return raws
    .filter(isUsableInstagrapiReel)
    .map((r, i) => normalizeInstagrapiReel(r, fallbackUsername, i));
}
