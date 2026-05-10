import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const APIFY_TOKEN = process.env.APIFY_API_TOKEN ?? "";
const ACTOR_ID = "apify~instagram-reel-scraper";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, limit = 20 } = body as { username: string; limit?: number };

  if (!username) {
    return NextResponse.json(
      { error: "O campo 'username' é obrigatório." },
      { status: 400 }
    );
  }

  if (!APIFY_TOKEN) {
    return NextResponse.json({ reels: getMockReels(username) });
  }

  try {
    // Dispara o Actor com waitForFinish — elimina polling manual
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}&waitForFinish=55`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: [`https://www.instagram.com/${username}/reels/`],
          resultsLimit: Math.min(limit, 30),
        }),
      }
    );

    if (!runRes.ok) {
      const errBody = await runRes.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(
        errBody?.error?.message ?? `Apify respondeu com status ${runRes.status}`
      );
    }

    const runData = await runRes.json() as {
      data: { status: string; defaultDatasetId: string };
    };
    const { status, defaultDatasetId } = runData.data;

    if (status !== "SUCCEEDED") {
      throw new Error(`O Actor encerrou com status inesperado: ${status}`);
    }

    // Busca os itens do dataset pelo ID retornado no run
    const datasetRes = await fetch(
      `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_TOKEN}&clean=true`
    );

    if (!datasetRes.ok) {
      throw new Error("Erro ao buscar os resultados do dataset Apify.");
    }

    const items = await datasetRes.json() as Record<string, unknown>[];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ reels: [] });
    }

    const reels = items
      .filter((item) => item.videoUrl)
      .map((item) => ({
        id: (item.id ?? item.shortCode) as string,
        shortCode: item.shortCode as string,
        thumbnailUrl: (item.displayUrl ?? item.thumbnailUrl ?? null) as string | null,
        videoUrl: item.videoUrl as string,
        caption: ((item.caption as string) ?? "").slice(0, 120),
        views: (item.videoViewCount as number) ?? 0,
        likes: (item.likesCount as number) ?? 0,
        comments: (item.commentsCount as number) ?? 0,
        duration: (item.videoDuration as number) ?? 0,
        owner: (item.ownerUsername as string) ?? username,
      }));

    return NextResponse.json({ reels });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getMockReels(username: string) {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `mock_${i}`,
    shortCode: `ABC${i}XYZ`,
    thumbnailUrl: null,
    videoUrl: `https://example.com/video_${i}.mp4`,
    caption: `Reel incrível número ${i + 1} do perfil @${username} — confira!`,
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
