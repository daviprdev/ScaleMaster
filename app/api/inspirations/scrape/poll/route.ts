import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeScrapedReel, resolveVideoUrl } from "@/lib/scraped-reel";

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

function processItems(items: unknown[], username: string, offset = 0) {
  return (items as Record<string, unknown>[])
    .filter((item) => item.type === "Video" || resolveVideoUrl(item))
    .map((item, i) => {
      const videoUrl = resolveVideoUrl(item);
      if (i === 0) {
        console.log(`[poll] @${username} first videoUrl: ${videoUrl ? `${videoUrl.slice(0, 70)}…` : "(empty)"}`);
      }
      // Normalização central (lib/scraped-reel.ts) — um único lugar interpreta
      // o payload do Apify. A legenda vai INTEIRA: o `.slice(0, 120)` que
      // existia aqui era truncagem para exibição, mas destruía o texto antes
      // de ele chegar à Biblioteca. Quem corta para caber no card é o CSS.
      const reel = normalizeScrapedReel(item, username, i);
      return {
        id: reel.id,
        shortCode: reel.shortCode,
        thumbnailUrl: reel.thumbnailUrl,
        videoUrl,
        // null (não capturada) vira "" só na fronteira com a UI; o valor cru
        // segue em originalCaption para o save-to-library distinguir os casos.
        caption: reel.originalCaption ?? "",
        originalCaption: reel.originalCaption,
        sourceUrl: reel.sourceUrl,
        views: reel.views,
        likes: reel.likes,
        comments: reel.comments,
        duration: reel.duration,
        owner: reel.sourceUsername ?? username,
        gradient: GRADIENTS[(i + offset) % GRADIENTS.length],
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

async function checkRun(runId: string, tokens: string[]): Promise<{
  status: string;
  items: unknown[];
  datasetId: string;
  client: ApifyClient;
} | null> {
  for (const token of tokens) {
    try {
      const client = new ApifyClient({ token });
      const run = await client.run(runId).get() as Record<string, unknown> | undefined;
      if (run) {
        return {
          status: run.status as string,
          items: [],
          datasetId: run.defaultDatasetId as string,
          client,
        };
      }
    } catch {
      // wrong token — try next
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const username = searchParams.get("username") ?? "";
  const limit    = parseInt(searchParams.get("limit") ?? "500", 10);

  // Support both multi-run (runIds) and legacy single-run (runId)
  const runIdsParam = searchParams.get("runIds") ?? searchParams.get("runId") ?? "";
  const fallbackStarted = new Set((searchParams.get("fallbackStarted") ?? "").split(",").filter(Boolean));

  const runIds = runIdsParam.split(",").filter(Boolean);
  if (runIds.length === 0 || !username) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  const tokens = resolveApifyTokens();
  const pendingRunIds: string[] = [];
  const newFallbackStarted: string[] = [...fallbackStarted];
  const allItems: unknown[] = [];
  const seenShortCodes = new Set<string>();

  for (const runId of runIds) {
    const found = await checkRun(runId, tokens);

    if (!found) {
      console.warn(`[poll] runId ${runId} não encontrado em nenhum token — ignorando`);
      continue;
    }

    const { status, datasetId, client } = found;

    if (status === "RUNNING" || status === "READY") {
      pendingRunIds.push(runId);
      continue;
    }

    if (status === "SUCCEEDED") {
      const { items } = await client.dataset(datasetId).listItems();
      const list = Array.isArray(items) ? items : [];

      if (list.length === 0 && !fallbackStarted.has(runId)) {
        // Start fallback with main profile URL (same token)
        console.log(`[poll] run ${runId} retornou 0 — iniciando fallback @${username}`);
        try {
          const fallbackRun = await client.actor("apify/instagram-scraper").start({
            directUrls: [`https://www.instagram.com/${username}/`],
            resultsType: "posts",
            resultsLimit: limit,
            maxRequestsPerCrawl: Math.max(600, limit * 2),
            proxyConfiguration: { useApifyProxy: true },
          });
          pendingRunIds.push(fallbackRun.id);
          newFallbackStarted.push(fallbackRun.id);
        } catch (err) {
          console.warn(`[poll] fallback falhou: ${err}`);
        }
        continue;
      }

      // Deduplicate across runs by shortCode
      for (const item of list) {
        const sc = String((item as Record<string, unknown>).shortCode ?? "");
        if (!sc || !seenShortCodes.has(sc)) {
          if (sc) seenShortCodes.add(sc);
          allItems.push(item);
        }
      }
      continue;
    }

    // FAILED / ABORTED / TIMED-OUT — skip silently
    console.warn(`[poll] run ${runId} terminou com status ${status}`);
  }

  // Still waiting for some runs
  if (pendingRunIds.length > 0) {
    return NextResponse.json({
      status: "running",
      runIds: pendingRunIds.join(","),
      fallbackStarted: newFallbackStarted.join(","),
    });
  }

  // All runs finished — no results
  if (allItems.length === 0) {
    return NextResponse.json({
      error: `Nenhum conteúdo encontrado para @${username}. O perfil pode ser privado ou inexistente.`,
    }, { status: 404 });
  }

  const reels = processItems(allItems, username);
  console.log(`[poll] @${username} — ${reels.length} reels únicos de ${runIds.length} runs`);

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch { /* auth opcional */ }

  if (userId) saveToHistory(userId, username, reels, allItems).catch(console.error);
  return NextResponse.json({ status: "done", reels });
}
