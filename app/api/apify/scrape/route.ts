import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────
// TODO: Insira sua chave de API do Apify aqui,
// ou defina a variável de ambiente APIFY_API_TOKEN
// no arquivo .env.local:
//   APIFY_API_TOKEN=apify_api_xxxxxxxxxxxxxxxxxxxx
//
// Actor utilizado: apify/instagram-reel-scraper
// Documentação: https://apify.com/apify/instagram-reel-scraper
// ─────────────────────────────────────────────
const APIFY_TOKEN = process.env.APIFY_API_TOKEN ?? "";
const ACTOR_ID = "apify~instagram-reel-scraper";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username } = body as { username: string };

  if (!username) {
    return NextResponse.json(
      { error: "O campo 'username' é obrigatório." },
      { status: 400 }
    );
  }

  // ── Modo de desenvolvimento: retorna dados mockados ──
  if (!APIFY_TOKEN) {
    return NextResponse.json({ reels: getMockReels(username) });
  }

  // ── Produção: chama o Apify Actor ────────────────────
  try {
    // 1. Dispara o run do Actor
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: [`https://www.instagram.com/${username}/reels/`],
          resultsLimit: 20,
        }),
      }
    );

    if (!runRes.ok) {
      throw new Error(`Apify run error: ${runRes.status}`);
    }

    const runData = await runRes.json();
    const runId: string = runData.data.id;

    // 2. Aguarda conclusão (polling simples)
    let status = "RUNNING";
    while (status === "RUNNING" || status === "READY") {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`
      );
      const statusData = await statusRes.json();
      status = statusData.data.status;
    }

    if (status !== "SUCCEEDED") {
      throw new Error(`Actor terminou com status: ${status}`);
    }

    // 3. Busca o dataset
    const datasetRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}`
    );
    const items = await datasetRes.json();

    // 4. Normaliza para o formato do frontend
    const reels = items.map((item: Record<string, unknown>) => ({
      id: item.id ?? item.shortCode,
      shortCode: item.shortCode,
      thumbnailUrl: item.displayUrl ?? item.thumbnailUrl,
      videoUrl: item.videoUrl,
      caption: (item.caption as string)?.slice(0, 120) ?? "",
      views: item.videoViewCount ?? 0,
      likes: item.likesCount ?? 0,
      comments: item.commentsCount ?? 0,
      duration: item.videoDuration ?? 0,
      owner: username,
    }));

    return NextResponse.json({ reels });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Dados mockados para desenvolvimento sem chave Apify ──
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
