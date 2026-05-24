import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

// ── Constants ─────────────────────────────────────────────────
const RATE_LIMIT_MESSAGE =
  "Nosso sistema de buscas está sobrecarregado no momento. Aguarde 5 minutos e tente novamente.";

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

// ── Types ─────────────────────────────────────────────────────
interface ScrapedReel {
  id: string;
  shortCode: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string;
  gradient: string;
}

interface ScrapeResult {
  reels: ScrapedReel[];
  fullName: string;
  profilePicUrl: string | null;
}

// ── Error helpers ──────────────────────────────────────────────
function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("sobrecarregado")
  );
}

function isQuotaError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("limit exceeded") ||
    m.includes("usage") ||
    m.includes("quota") ||
    m.includes("rate limit") ||
    m.includes("429") ||
    m.includes("401") ||
    m.includes("403") ||
    m.includes("unauthorized") ||
    m.includes("authentication") ||
    m.includes("forbidden") ||
    m.includes("not found or authentication")
  );
}

// ── Strategy 1: RapidAPI with pagination ──────────────────────
// Default: instagram-scraper-api2.p.rapidapi.com (lamboiss, 500 free req/month)
// Override via RAPIDAPI_INSTAGRAM_HOST env var
// Paginates with next_max_id until `limit` reels are collected or no more pages
async function scrapeViaRapidAPI(username: string, limit: number): Promise<ScrapeResult> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("RAPIDAPI_KEY not configured");

  const host =
    process.env.RAPIDAPI_INSTAGRAM_HOST ?? "instagram-scraper-api2.p.rapidapi.com";

  const allItems: Record<string, unknown>[] = [];
  let nextMaxId: string | null = null;
  let firstPageData: Record<string, unknown> | null = null;
  // Pages scale with limit: ~12 reels/page + small buffer to absorb non-video posts
  const maxPages = Math.ceil(limit / 10) + 2;

  for (let page = 0; page < maxPages && allItems.length < limit; page++) {
    const params = new URLSearchParams({ username_or_id_or_url: username });
    if (nextMaxId) params.set("next_max_id", nextMaxId);

    const res = await fetch(`https://${host}/v1/posts?${params}`, {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": host,
      },
    });

    if (res.status === 429) throw new Error(RATE_LIMIT_MESSAGE);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `RapidAPI retornou ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const pageData = (data?.data as Record<string, unknown>) ?? data;
    const pageItems = (pageData?.items as unknown[]) ?? [];

    if (!Array.isArray(pageItems) || pageItems.length === 0) break;

    if (page === 0) firstPageData = pageData;

    const videoItems = (pageItems as Record<string, unknown>[]).filter(
      (item) => item.media_type === 2 || item.video_url || item.videoUrl
    );
    allItems.push(...videoItems);

    console.log(
      `[rapidapi] @${username} page ${page + 1}: ${videoItems.length} reels (total ${allItems.length})`
    );

    const moreAvailable = pageData?.more_available as boolean | undefined;
    nextMaxId = (pageData?.next_max_id as string | null | undefined) ?? null;
    if (!moreAvailable || !nextMaxId) break;
  }

  if (allItems.length === 0) {
    throw new Error(
      `Nenhum Reel encontrado para @${username}. O perfil pode ser privado, inexistente ou não ter Reels.`
    );
  }

  // Extract user metadata from first item
  const firstItem = allItems[0];
  const userObj = firstItem.user as Record<string, unknown> | null | undefined;
  const fullName = String(userObj?.full_name ?? userObj?.username ?? username);
  const profilePicUrl =
    (userObj?.profile_pic_url as string | null | undefined) ??
    (firstItem.profile_pic_url as string | null | undefined) ??
    ((firstPageData as Record<string, unknown> | null)?.user as Record<string, unknown> | null)?.profile_pic_url as string | null ?? null;

  const reels = allItems.slice(0, limit).map((item, i) => {
    const captionObj = item.caption as Record<string, unknown> | string | null | undefined;
    const captionText =
      typeof captionObj === "string"
        ? captionObj
        : ((captionObj as Record<string, unknown> | null)?.text as string | undefined) ?? "";

    const imgVersions = item.image_versions2 as Record<string, unknown> | null | undefined;
    const candidates = imgVersions?.candidates as Array<Record<string, unknown>> | undefined;

    if (i === 0) {
      const videoUrl = String(item.video_url ?? item.videoUrl ?? "");
      console.log(`[rapidapi] @${username} first videoUrl: ${videoUrl.slice(0, 70) || "(empty)"}…`);
    }

    return {
      id: String(item.pk ?? item.id ?? i),
      shortCode: String(item.code ?? item.shortcode ?? ""),
      thumbnailUrl:
        (item.thumbnail_url as string | null | undefined) ??
        (candidates?.[0]?.url as string | null | undefined) ??
        null,
      videoUrl: String(item.video_url ?? item.videoUrl ?? ""),
      caption: String(captionText).slice(0, 120),
      views: Number(item.view_count ?? item.play_count ?? 0),
      likes: Number(item.like_count ?? 0),
      comments: Number(item.comment_count ?? 0),
      duration: Number(item.video_duration ?? 0),
      owner: String((item.user as Record<string, unknown> | null)?.username ?? username),
      gradient: GRADIENTS[i % GRADIENTS.length],
    };
  });

  return { reels, fullName, profilePicUrl };
}

// ── Strategy 2: Apify (reel-specific actor) ────────────────────
async function scrapeViaApify(
  token: string,
  username: string,
  limit: number
): Promise<ScrapeResult> {
  const client = new ApifyClient({ token });

  // apify~instagram-reel-scraper: targeted for reels, less prone to IG blocks
  const run = await client.actor("apify~instagram-reel-scraper").call({
    username: [username],
    resultsLimit: Math.min(limit, 300),
  });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Falha no Apify. Status: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      `Nenhum Reel encontrado para @${username}. ` +
        `O perfil pode ser privado, inexistente, não ter Reels ou ` +
        `o Instagram está bloqueando temporariamente a coleta. ` +
        `Tente novamente em alguns minutos.`
    );
  }

  const first = items[0] as Record<string, unknown>;
  const fullName = String(first.ownerFullName ?? first.ownerUsername ?? username);

  const ownerObj = (first.owner ?? {}) as Record<string, unknown>;
  const profilePicUrl: string | null =
    (first.ownerProfilePicUrl as string | null | undefined) ||
    (first.profilePicUrl as string | null | undefined) ||
    (ownerObj.profilePicUrl as string | null | undefined) ||
    (ownerObj.profile_pic_url as string | null | undefined) ||
    null;

  const reels = items
    .filter(
      (item) =>
        item.type === "Video" ||
        item.videoUrl ||
        item.video_url ||
        item.videoPlayUrl
    )
    .map((item, i) => {
      const raw = item as Record<string, unknown>;
      const videoUrl =
        (raw.videoUrl as string | undefined) ||
        (raw.video_url as string | undefined) ||
        (raw.videoPlayUrl as string | undefined) ||
        "";
      if (i === 0) {
        const preview = videoUrl
          ? `${videoUrl.slice(0, 70)}…`
          : "(empty — reel may be expired or private)";
        console.log(`[apify] @${username} first reel videoUrl: ${preview}`);
      }
      return {
        id: String(raw.id ?? raw.shortCode ?? i),
        shortCode: String(raw.shortCode ?? ""),
        thumbnailUrl: ((raw.displayUrl ?? raw.thumbnailUrl) as string) ?? null,
        videoUrl,
        caption: String(raw.caption ?? "").slice(0, 120),
        views: Number(raw.videoViewCount ?? 0),
        likes: Number(raw.likesCount ?? 0),
        comments: Number(raw.commentsCount ?? 0),
        duration: Number(raw.videoDuration ?? 0),
        owner: String(raw.ownerUsername ?? username),
        gradient: GRADIENTS[i % GRADIENTS.length],
      };
    });

  return { reels, fullName, profilePicUrl };
}

// ── Persistir foto de perfil no Storage ───────────────────────
async function uploadProfilePicToStorage(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  username: string,
  cdnUrl: string
): Promise<string | null> {
  await admin.storage
    .createBucket("avatars", { public: true, fileSizeLimit: 1_048_576 })
    .catch(() => {/* already exists */});

  try {
    const imgRes = await fetch(cdnUrl, {
      headers: {
        Referer: "https://www.instagram.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!imgRes.ok) return null;

    const buffer = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
      ? "webp"
      : "jpg";
    const path = `profile-pics/${userId}/${username}.${ext}`;

    const { error } = await admin.storage
      .from("avatars")
      .upload(path, buffer, { contentType, upsert: true });

    if (error) return null;

    const {
      data: { publicUrl },
    } = admin.storage.from("avatars").getPublicUrl(path);
    return publicUrl;
  } catch {
    return null;
  }
}

// ── Salvar no histórico ───────────────────────────────────────
async function saveToHistory(
  username: string,
  reels: object[],
  fullName: string,
  profilePicUrl: string | null
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.log("[scraped_profiles] Supabase não configurado, pulando save.");
    return;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error("[scraped_profiles] Erro de autenticação:", authError.message);
      return;
    }

    if (!user) {
      console.warn("[scraped_profiles] Usuário não autenticado — upsert ignorado.");
      return;
    }

    console.log(
      `[scraped_profiles] Salvando @${username} para user ${user.id} (${reels.length} reels)`
    );

    const admin = getSupabaseAdmin();

    let finalProfilePicUrl = profilePicUrl;
    if (profilePicUrl) {
      const stored = await uploadProfilePicToStorage(admin, user.id, username, profilePicUrl);
      if (stored) {
        finalProfilePicUrl = stored;
        console.log(`[scraped_profiles] Foto de perfil salva no Storage: ${stored}`);
      }
    }

    const { data, error } = await admin
      .from("scraped_profiles")
      .upsert(
        {
          user_id: user.id,
          username,
          full_name: fullName,
          profile_pic_url: finalProfilePicUrl,
          videos_data: reels,
          video_count: reels.length,
          scraped_at: new Date().toISOString(),
        },
        { onConflict: "user_id,username", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    if (error) {
      console.error(
        `[scraped_profiles] Upsert falhou — code: ${error.code}, message: ${error.message}`
      );
      if (error.code === "42P01") {
        console.error(
          "[scraped_profiles] TABELA NÃO EXISTE. Execute o SQL da Fase 22 no Supabase Dashboard."
        );
      }
    } else {
      console.log(`[scraped_profiles] Upsert OK — id: ${data?.id}`);
    }
  } catch (err) {
    console.error("[scraped_profiles] Exceção inesperada:", err);
  }
}

// ── Handler ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, limit = 300 } = body as { username: string; limit?: number };

  if (!username) {
    return NextResponse.json(
      { error: "O campo 'username' é obrigatório." },
      { status: 400 }
    );
  }

  // ── Strategy 1: RapidAPI — distributed proxies, no cold start ──
  if (process.env.RAPIDAPI_KEY) {
    try {
      const { reels, fullName, profilePicUrl } = await scrapeViaRapidAPI(username, limit);
      await saveToHistory(username, reels, fullName, profilePicUrl);
      return NextResponse.json({ reels });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitError(msg)) {
        return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
      }
      console.warn(
        `[inspirations/scrape] RapidAPI falhou para @${username}: ${msg}. Tentando Apify…`
      );
    }
  }

  // ── Strategy 2: Apify fallback ──────────────────────────────
  const tokens = [
    ...(process.env.APIFY_API_TOKENS?.split(",") ?? []),
    ...(process.env.APIFY_API_TOKEN?.split(",") ?? []),
  ]
    .map((t) => t.trim())
    .filter(Boolean);

  const uniqueTokens = [...new Set(tokens)];

  if (uniqueTokens.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum provedor de scraping configurado. Configure RAPIDAPI_KEY ou APIFY_API_TOKEN.",
      },
      { status: 503 }
    );
  }

  let lastError = "Erro desconhecido";

  for (const token of uniqueTokens) {
    try {
      const { reels, fullName, profilePicUrl } = await scrapeViaApify(token, username, limit);
      await saveToHistory(username, reels, fullName, profilePicUrl);
      return NextResponse.json({ reels });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isQuotaError(msg)) {
        console.warn(`[Apify] Token ...${token.slice(-6)} esgotado: ${msg}. Tentando próximo.`);
        lastError = msg;
        continue;
      }

      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // All providers exhausted → surface as rate limit
  return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
}
