import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";

export const maxDuration = 60;

const ACTOR_ID = "apify/instagram-scraper";

// ── Token pool ────────────────────────────────────────────────────
// Lê APIFY_API_TOKENS e APIFY_API_TOKEN, ambos aceitam vírgulas, sem duplicatas
function getTokens(): string[] {
  const fromMulti = (process.env.APIFY_API_TOKENS ?? "")
    .split(",").map((t) => t.trim()).filter(Boolean);
  const fromSingle = (process.env.APIFY_API_TOKEN ?? "")
    .split(",").map((t) => t.trim()).filter(Boolean);
  return [...new Set([...fromMulti, ...fromSingle])];
}

// Erros que indicam token inválido/expirado/bloqueado → tenta o próximo
function isTokenError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("unauthorized") ||
    m.includes("authentication") ||
    m.includes("forbidden") ||
    m.includes("rate limit") ||
    m.includes("quota") ||
    m.includes("429") ||
    m.includes("403") ||
    m.includes("401")
  );
}

async function scrapeWithToken(
  token: string,
  username: string,
  limit: number
) {
  const client = new ApifyClient({ token });

  const run = await client.actor(ACTOR_ID).call(
    {
      directUrls: [`https://www.instagram.com/${username}/reels/`],
      resultsType: "posts",
      maxRequestsPerCrawl: Math.min(limit, 30),
    },
    { waitSecs: 55 }
  );

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Actor encerrou com status inesperado: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  if (!Array.isArray(items) || items.length === 0) return [];

  return items
    .filter((item) => item.type === "Video" || item.videoUrl)
    .map((item, i) => ({
      id: String(item.id ?? item.shortCode ?? i),
      shortCode: String(item.shortCode ?? ""),
      thumbnailUrl: ((item.displayUrl ?? item.thumbnailUrl) as string) ?? null,
      videoUrl: String(item.videoUrl ?? ""),
      caption: String(item.caption ?? "").slice(0, 120),
      views: Number(item.videoViewCount ?? 0),
      likes: Number(item.likesCount ?? 0),
      comments: Number(item.commentsCount ?? 0),
      duration: Number(item.videoDuration ?? 0),
      owner: String(item.ownerUsername ?? username),
      gradient: GRADIENTS[i % GRADIENTS.length],
    }));
}

// ── Handler ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, limit = 20 } = body as { username: string; limit?: number };

  if (!username) {
    return NextResponse.json(
      { error: "O campo 'username' é obrigatório." },
      { status: 400 }
    );
  }

  const tokens = getTokens();

  if (tokens.length === 0) {
    return NextResponse.json({ reels: getMockReels(username) });
  }

  let lastError = "Erro desconhecido";

  for (let i = 0; i < tokens.length; i++) {
    try {
      const reels = await scrapeWithToken(tokens[i], username, limit);
      return NextResponse.json({ reels });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTokenError(msg)) {
        lastError = msg;
        continue; // token inválido/bloqueado → tenta o próximo
      }
      // Erro não relacionado ao token (actor falhou, perfil privado, etc.)
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return NextResponse.json(
    {
      error: `Todos os ${tokens.length} tokens Apify estão indisponíveis. Verifique as contas no painel do Apify. Último erro: ${lastError}`,
    },
    { status: 503 }
  );
}

// ── Mock ──────────────────────────────────────────────────────────
function getMockReels(username: string) {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `mock_${i}`,
    shortCode: `INS${i}PIR`,
    thumbnailUrl: null,
    videoUrl: `https://example.com/reel_${i}.mp4`,
    caption: `Reel incrível #${i + 1} de @${username} — confira esse conteúdo!`,
    views: Math.floor(Math.random() * 900_000) + 10_000,
    likes: Math.floor(Math.random() * 50_000) + 500,
    comments: Math.floor(Math.random() * 2_000) + 20,
    duration: Math.floor(Math.random() * 55) + 5,
    owner: username,
    gradient: GRADIENTS[i % GRADIENTS.length],
  }));
}

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
