import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

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
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId    = searchParams.get("runId");
  const username = searchParams.get("username");
  const fallback = searchParams.get("fallback") === "true";
  const limit    = parseInt(searchParams.get("limit") ?? "300", 10);

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
        const tokens = resolveApifyTokens();
        const fallbackClient = new ApifyClient({ token: tokens[0] });
        const fallbackRun = await fallbackClient.actor("apify/instagram-scraper").start({
          directUrls: [`https://www.instagram.com/${username}/`],
          resultsType: "posts",
          resultsLimit: limit,
          maxRequestsPerCrawl: Math.ceil(limit / 8) + 40,
          proxyConfiguration: { useApifyProxy: true },
        });
        return NextResponse.json({ status: "running", runId: fallbackRun.id, username, limit, fallback: true });
      } catch (err) {
        return NextResponse.json({ error: `Nenhum Reel encontrado e o fallback falhou: ${err instanceof Error ? err.message : err}` }, { status: 500 });
      }
    }

    if (list.length === 0 && fallback) {
      return NextResponse.json({ error: `Nenhum conteúdo encontrado para @${username}. O perfil pode ser privado.` }, { status: 404 });
    }

    // Extrai reels com video URL (filtra só no .filter final — mais inclusivo)
    const reels = (list as Record<string, unknown>[])
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
      .filter(r => r.videoUrl && r.shortCode); // precisa de ambos para funcionar

    if (!reels.length) {
      return NextResponse.json({ error: `Nenhum Reel com URL de vídeo encontrado para @${username}.` }, { status: 404 });
    }

    // Extrai info do perfil do primeiro item
    const first = list[0] as Record<string, unknown>;
    const ownerObj = (first.owner ?? {}) as Record<string, unknown>;
    const rawPicUrl: string | null =
      (first.ownerProfilePicUrl as string | null) ||
      (first.profilePicUrl as string | null) ||
      (ownerObj.profilePicUrl as string | null) || null;

    const rawFullName: string =
      (first.ownerFullName as string | null) ||
      (ownerObj.fullName as string | null) ||
      (first.ownerUsername as string | null) ||
      (ownerObj.username as string | null) ||
      username;
    const fullName = rawFullName === rawFullName.toLowerCase()
      ? rawFullName.replace(/(?:^|\s)\S/g, ch => ch.toUpperCase())
      : rawFullName;

    // Persiste a foto de perfil no Supabase Storage para URL permanente (não expira)
    let profilePicUrl: string | null = null;
    if (rawPicUrl) {
      try {
        const picRes = await fetch(rawPicUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Referer": "https://www.instagram.com/",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (picRes.ok) {
          const buffer = await picRes.arrayBuffer();
          const contentType = picRes.headers.get("content-type") ?? "image/jpeg";
          const admin = getSupabaseAdmin();
          const safeName = username.toLowerCase().replace(/[^a-z0-9_]/g, "_");
          const storagePath = `profile_pics/${safeName}.jpg`;
          const { error: uploadErr } = await admin.storage
            .from("videos-library")
            .upload(storagePath, buffer, { contentType, upsert: true });
          if (!uploadErr) {
            const { data: urlData } = admin.storage
              .from("videos-library")
              .getPublicUrl(storagePath);
            profilePicUrl = urlData.publicUrl;
          }
        }
      } catch (e) {
        console.warn("[clone/poll] profile pic upload falhou:", e instanceof Error ? e.message : e);
      }
      // fallback: proxy se upload falhou
      if (!profilePicUrl) {
        profilePicUrl = `/api/proxy-image?url=${encodeURIComponent(rawPicUrl)}`;
      }
    }

    const profile = {
      username,
      fullName,
      profilePicUrl,
      bio:            (first.biography as string | null) ||
                      (first.ownerBio as string | null) || null,
      followersCount: Number(
        first.followersCount ??
        first.ownerFollowersCount ??
        ownerObj.followersCount ??
        0
      ),
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
