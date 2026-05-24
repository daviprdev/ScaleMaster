import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

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

function resolveVideoUrl(item: Record<string, unknown>): string {
  return (
    (item.videoUrl as string | undefined) ||
    (item.video_url as string | undefined) ||
    (item.videoPlayUrl as string | undefined) ||
    (item.playVideoUrl as string | undefined) ||
    ""
  );
}

async function scrapeWithToken(
  token: string,
  username: string,
  limit: number
): Promise<{ reels: object[]; fullName: string; profilePicUrl: string | null }> {
  const client = new ApifyClient({ token });

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
    .filter((item) => item.type === "Video" || resolveVideoUrl(item as Record<string, unknown>))
    .map((item, i) => {
      const raw = item as Record<string, unknown>;
      const videoUrl = resolveVideoUrl(raw);
      if (i === 0) {
        console.log(
          `[inspirations/scrape] @${username} first videoUrl: ${
            videoUrl ? `${videoUrl.slice(0, 70)}…` : "(empty)"
          }`
        );
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
    .catch(() => {});

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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) return;

    const admin = getSupabaseAdmin();

    let finalProfilePicUrl = profilePicUrl;
    if (profilePicUrl) {
      const stored = await uploadProfilePicToStorage(admin, user.id, username, profilePicUrl);
      if (stored) finalProfilePicUrl = stored;
    }

    const { error } = await admin.from("scraped_profiles").upsert(
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
    );

    if (error) {
      console.error(`[scraped_profiles] Upsert falhou: ${error.message}`);
      if (error.code === "42P01") {
        console.error("[scraped_profiles] Tabela não existe. Execute o SQL da Fase 22.");
      }
    }
  } catch (err) {
    console.error("[scraped_profiles] Exceção:", err);
  }
}

// ── Handler ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, limit = 300 } = body as { username: string; limit?: number };

  if (!username) {
    return NextResponse.json({ error: "O campo 'username' é obrigatório." }, { status: 400 });
  }

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
          "APIFY_API_TOKEN não configurado. Adicione a variável de ambiente e faça um novo deploy.",
      },
      { status: 503 }
    );
  }

  let lastError = "Erro desconhecido";

  for (const token of uniqueTokens) {
    try {
      const { reels, fullName, profilePicUrl } = await scrapeWithToken(token, username, limit);
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

  return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
}
