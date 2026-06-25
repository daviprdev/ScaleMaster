import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

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

function resolveVideoUrl(item: Record<string, unknown>): string {
  return (
    (item.videoUrl as string | undefined) ||
    (item.video_url as string | undefined) ||
    (item.videoPlayUrl as string | undefined) ||
    (item.playVideoUrl as string | undefined) ||
    ""
  );
}

function processItems(items: unknown[], username: string) {
  return (items as Record<string, unknown>[])
    .filter((item) => item.type === "Video" || resolveVideoUrl(item))
    .map((item, i) => {
      const videoUrl = resolveVideoUrl(item);
      if (i === 0) {
        console.log(`[poll] @${username} first videoUrl: ${videoUrl ? `${videoUrl.slice(0, 70)}…` : "(empty)"}`);
      }
      return {
        id: String(item.id ?? item.shortCode ?? i),
        shortCode: String(item.shortCode ?? ""),
        thumbnailUrl: ((item.displayUrl ?? item.thumbnailUrl) as string) ?? null,
        videoUrl,
        caption: String(item.caption ?? "").slice(0, 120),
        views: Number(item.videoViewCount ?? 0),
        likes: Number(item.likesCount ?? 0),
        comments: Number(item.commentsCount ?? 0),
        duration: Number(item.videoDuration ?? 0),
        owner: String(item.ownerUsername ?? username),
        gradient: GRADIENTS[i % GRADIENTS.length],
      };
    });
}

async function saveToHistory(userId: string, username: string, reels: object[], items: unknown[]) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    const first = (items[0] ?? {}) as Record<string, unknown>;
    const fullName = String(first.ownerFullName ?? first.ownerUsername ?? username);
    const ownerObj = (first.owner ?? {}) as Record<string, unknown>;
    const profilePicUrl: string | null =
      (first.ownerProfilePicUrl as string | null | undefined) ||
      (first.profilePicUrl as string | null | undefined) ||
      (ownerObj.profilePicUrl as string | null | undefined) ||
      null;

    const admin = getSupabaseAdmin();
    await admin.from("scraped_profiles").upsert(
      {
        user_id: userId,
        username,
        full_name: fullName,
        profile_pic_url: profilePicUrl,
        videos_data: reels,
        video_count: reels.length,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: "user_id,username", ignoreDuplicates: false }
    );
  } catch (err) {
    console.error("[poll/history]", err);
  }
}

async function findRunClient(runId: string): Promise<{ client: ApifyClient; run: NonNullable<unknown> } | null> {
  // resolveApifyTokens shuffles on every call, so tokenIdx is unreliable across
  // requests. Try every available token until one can access this run.
  const tokens = resolveApifyTokens();
  for (const token of tokens) {
    try {
      const client = new ApifyClient({ token });
      const run = await client.run(runId).get();
      if (run) return { client, run };
    } catch {
      // wrong token for this run — try next
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const runId    = searchParams.get("runId");
  const username = searchParams.get("username");
  const fallback = searchParams.get("fallback") === "true";
  const limit    = parseInt(searchParams.get("limit") ?? "500", 10);

  if (!runId || !username) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  const found = await findRunClient(runId);
  if (!found) {
    return NextResponse.json({ error: "Run não encontrado ou token sem acesso." }, { status: 404 });
  }

  const { client } = found as { client: ApifyClient };
  const run = found.run as Record<string, unknown>;

  if (!run) {
    return NextResponse.json({ error: "Run não encontrado." }, { status: 404 });
  }

  if (run.status === "RUNNING" || run.status === "READY") {
    return NextResponse.json({ status: "running" });
  }

  if (run.status === "SUCCEEDED") {
    const { items } = await client.dataset(run.defaultDatasetId as string).listItems();
    const list = Array.isArray(items) ? items : [];

    // /reels/ returned nothing → start fallback with main profile URL
    if (list.length === 0 && !fallback) {
      console.log(`[poll] @${username} /reels/ succeeded with 0 — starting fallback`);
      try {
        const fallbackRun = await client.actor("apify/instagram-scraper").start({
          directUrls: [`https://www.instagram.com/${username}/`],
          resultsType: "posts",
          resultsLimit: limit,
          maxRequestsPerCrawl: Math.max(600, limit * 2),
          proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
        });
        return NextResponse.json({
          status: "running",
          runId: fallbackRun.id,
          username,
          limit,
          fallback: true,
        });
      } catch (err) {
        return NextResponse.json({
          error: `Nenhum Reel encontrado para @${username} e o fallback falhou: ${err instanceof Error ? err.message : err}`,
        }, { status: 500 });
      }
    }

    if (list.length === 0 && fallback) {
      return NextResponse.json({
        error: `Nenhum conteúdo encontrado para @${username}. O perfil pode ser privado ou inexistente.`,
      }, { status: 404 });
    }

    const reels = processItems(list, username);

    // Resolve user_id while still in request context (cookies() is request-scoped in Next.js 15)
    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* auth opcional — não bloqueia a resposta */ }

    if (userId) saveToHistory(userId, username, reels, list).catch(console.error);
    return NextResponse.json({ status: "done", reels });
  }

  return NextResponse.json({
    error: `Busca encerrada com status ${run.status}. Tente novamente.`,
  }, { status: 500 });
}
