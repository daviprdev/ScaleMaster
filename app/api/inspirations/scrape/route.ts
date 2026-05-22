import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

const ACTOR_ID = "apify/instagram-scraper";

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

async function scrapeWithToken(token: string, username: string, limit: number) {
  const client = new ApifyClient({ token });

  const run = await client.actor(ACTOR_ID).call({
    directUrls: [`https://www.instagram.com/${username}/reels/`],
    resultsType: "posts",
    maxRequestsPerCrawl: Math.min(limit, 30),
  });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Falha no Apify. Status: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  if (!Array.isArray(items) || items.length === 0) {
    return { reels: [], fullName: username, profilePicUrl: null as string | null };
  }

  const first = items[0] as Record<string, unknown>;
  const fullName = String(first.ownerFullName ?? first.ownerUsername ?? username);

  // Try multiple field paths — different Apify actor versions use different names
  const ownerObj = (first.owner ?? {}) as Record<string, unknown>;
  const profilePicUrl: string | null =
    (first.ownerProfilePicUrl as string | null | undefined) ||
    (first.profilePicUrl as string | null | undefined) ||
    (ownerObj.profilePicUrl as string | null | undefined) ||
    (ownerObj.profile_pic_url as string | null | undefined) ||
    null;

  // Resolve the direct video URL — try every field name the Apify actor has used
  // across different versions so we never silently fall through to an empty string.
  const resolveVideoUrl = (item: Record<string, unknown>): string => {
    const raw =
      (item.videoUrl as string | undefined) ||
      (item.video_url as string | undefined) ||
      (item.videoPlayUrl as string | undefined) ||
      (item.playVideoUrl as string | undefined) ||
      "";
    return raw;
  };

  const reels = items
    .filter((item) => item.type === "Video" || resolveVideoUrl(item as Record<string, unknown>))
    .map((item, i) => {
      const videoUrl = resolveVideoUrl(item as Record<string, unknown>);
      // Log the first reel's URL shape so devs can verify the CDN domain in server logs
      if (i === 0) {
        const preview = videoUrl
          ? `${videoUrl.slice(0, 70)}…`
          : "(empty — reel may be expired or private)";
        console.log(`[scrape] @${username} first reel videoUrl: ${preview}`);
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

  return { reels, fullName, profilePicUrl };
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

// ── Persistir foto de perfil no Storage (evita expiração do CDN) ──
async function uploadProfilePicToStorage(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  username: string,
  cdnUrl: string
): Promise<string | null> {
  // Ensure bucket exists (no-op if already there)
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
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = `profile-pics/${userId}/${username}.${ext}`;

    const { error } = await admin.storage
      .from("avatars")
      .upload(path, buffer, { contentType, upsert: true });

    if (error) return null;

    const { data: { publicUrl } } = admin.storage.from("avatars").getPublicUrl(path);
    return publicUrl;
  } catch {
    return null;
  }
}

// ── Salvar no histórico ───────────────────────────────────────────
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

    console.log(`[scraped_profiles] Salvando @${username} para user ${user.id} (${reels.length} reels)`);

    const admin = getSupabaseAdmin();

    // Persist profile pic to Supabase Storage so the URL never expires
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
        `[scraped_profiles] Upsert falhou — code: ${error.code}, message: ${error.message}, hint: ${error.hint ?? "—"}, details: ${error.details ?? "—"}`
      );
      if (error.code === "42P01") {
        console.error(
          "[scraped_profiles] TABELA NÃO EXISTE. Execute o SQL da Fase 22 no Supabase Dashboard → SQL Editor."
        );
      }
    } else {
      console.log(`[scraped_profiles] Upsert OK — id: ${data?.id}`);
    }
  } catch (err) {
    console.error("[scraped_profiles] Exceção inesperada:", err);
  }
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

  const tokens = [
    ...process.env.APIFY_API_TOKENS?.split(",") ?? [],
    ...process.env.APIFY_API_TOKEN?.split(",") ?? [],
  ]
    .map((t) => t.trim())
    .filter(Boolean);

  const uniqueTokens = [...new Set(tokens)];

  if (uniqueTokens.length === 0) {
    return NextResponse.json(
      { error: "APIFY_API_TOKEN não configurado. Adicione a variável de ambiente e faça um novo deploy." },
      { status: 503 }
    );
  }

  let lastError = "Erro desconhecido";

  for (const token of uniqueTokens) {
    try {
      const { reels, fullName, profilePicUrl } = await scrapeWithToken(token, username, limit);

      // Salvar no histórico — não bloqueia a resposta em caso de falha
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

  return NextResponse.json(
    {
      error: `Todas as ${uniqueTokens.length} chaves Apify estão esgotadas ou inválidas. Último erro: ${lastError}`,
    },
    { status: 503 }
  );
}

