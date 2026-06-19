import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { resolveApifyTokens } from "@/lib/apify-token-pool";

export const runtime = "nodejs";
export const maxDuration = 30;

async function findRunClient(runId: string) {
  for (const token of resolveApifyTokens()) {
    try {
      const client = new ApifyClient({ token });
      const run = await client.run(runId).get();
      if (run) return { client, run };
    } catch { /* wrong token */ }
  }
  return null;
}

function resolveVideoUrl(item: Record<string, unknown>): string {
  return (
    (item.videoUrl as string | undefined) ||
    (item.video_url as string | undefined) ||
    (item.videoPlayUrl as string | undefined) ||
    (item.playVideoUrl as string | undefined) ||
    ""
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const runId    = searchParams.get("runId");
  const username = searchParams.get("username");
  const fallback = searchParams.get("fallback") === "true";
  const limit    = parseInt(searchParams.get("limit") ?? "100", 10);

  if (!runId || !username) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  const found = await findRunClient(runId);
  if (!found) return NextResponse.json({ error: "Run não encontrado." }, { status: 404 });

  const { client, run } = found as unknown as { client: ApifyClient; run: Record<string, unknown> };

  if (run.status === "RUNNING" || run.status === "READY") {
    return NextResponse.json({ status: "running" });
  }

  if (run.status === "SUCCEEDED") {
    const { items } = await client.dataset(run.defaultDatasetId as string).listItems();
    const list = Array.isArray(items) ? items : [];

    // /reels/ returned nothing → fallback to main profile URL
    if (list.length === 0 && !fallback) {
      try {
        const fallbackRun = await client.actor("apify/instagram-scraper").start({
          directUrls: [`https://www.instagram.com/${username}/`],
          resultsType: "posts",
          resultsLimit: limit,
          maxRequestsPerCrawl: Math.max(200, Math.ceil(limit / 4)),
          proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
        });
        return NextResponse.json({ status: "running", runId: fallbackRun.id, username, limit, fallback: true });
      } catch (err) {
        return NextResponse.json({ error: `Nenhum Reel encontrado e o fallback falhou: ${err instanceof Error ? err.message : err}` }, { status: 500 });
      }
    }

    if (list.length === 0 && fallback) {
      return NextResponse.json({ error: `Nenhum conteúdo encontrado para @${username}. O perfil pode ser privado.` }, { status: 404 });
    }

    // Extrai reels com video URL
    const reels = (list as Record<string, unknown>[])
      .filter(item => item.type === "Video" || resolveVideoUrl(item))
      .map((item, i) => ({
        id:           String(item.id ?? item.shortCode ?? i),
        shortCode:    String(item.shortCode ?? ""),
        thumbnailUrl: ((item.displayUrl ?? item.thumbnailUrl) as string) ?? null,
        videoUrl:     resolveVideoUrl(item),
        caption:      String(item.caption ?? ""),
        views:        Number(item.videoViewCount ?? 0),
        likes:        Number(item.likesCount ?? 0),
        comments:     Number(item.commentsCount ?? 0),
        duration:     Number(item.videoDuration ?? 0),
      }))
      .filter(r => r.videoUrl);

    if (!reels.length) {
      return NextResponse.json({ error: `Nenhum Reel com URL de vídeo encontrado para @${username}.` }, { status: 404 });
    }

    // Extrai info do perfil do primeiro item
    const first = list[0] as Record<string, unknown>;
    const ownerObj = (first.owner ?? {}) as Record<string, unknown>;
    const profile = {
      username,
      fullName:       String(first.ownerFullName ?? first.ownerUsername ?? username),
      profilePicUrl:  (first.ownerProfilePicUrl as string | null) ||
                      (first.profilePicUrl as string | null) ||
                      (ownerObj.profilePicUrl as string | null) || null,
      bio:            (first.biography as string | null) ||
                      (first.biography as string | null) || null,
      followersCount: Number(first.followersCount ?? ownerObj.followersCount ?? 0),
    };

    // Estatísticas agregadas
    const totalViews    = reels.reduce((s, r) => s + r.views, 0);
    const totalLikes    = reels.reduce((s, r) => s + r.likes, 0);
    const totalComments = reels.reduce((s, r) => s + r.comments, 0);
    const count         = reels.length;
    const avgViews      = Math.round(totalViews / count);
    const avgLikes      = Math.round(totalLikes / count);
    const avgComments   = Math.round(totalComments / count);
    const engagementRate = profile.followersCount > 0
      ? +((avgLikes + avgComments) / profile.followersCount * 100).toFixed(2)
      : 0;

    const stats = { reelCount: count, avgViews, avgLikes, avgComments, engagementRate };

    return NextResponse.json({ status: "done", profile, stats, reels });
  }

  return NextResponse.json({ error: `Busca encerrada com status ${run.status}. Tente novamente.` }, { status: 500 });
}
