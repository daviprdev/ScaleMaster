import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetch as undiciFetch } from "undici";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AccountRow {
  id: string;
  username: string;
  ig_business_account_id: string;
  meta_access_token: string;
}

interface StoryItem {
  id: string;
  media_type?: string;
  media_url?: string;
  timestamp: string;
}

// Baixa a mídia do CDN da Meta e re-hospeda no Supabase Storage — o media_url
// que a Graph API devolve é uma URL assinada de curta duração, não serve para
// repostar dias depois. Mesmo padrão de downloadAndHost() em
// app/api/cron/prefetch-clone-urls/route.ts.
async function downloadAndHost(mediaUrl: string, mediaType: "image" | "video"): Promise<string> {
  const admin = getSupabaseAdmin();
  const res = await undiciFetch(mediaUrl, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`CDN respondeu HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`arquivo muito pequeno: ${buf.length} bytes`);

  const ext = mediaType === "image" ? "jpg" : "mp4";
  const contentType = mediaType === "image" ? "image/jpeg" : "video/mp4";
  const storagePath = `story_templates/${randomUUID()}.${ext}`;

  const { error } = await admin.storage
    .from("videos-library")
    .upload(storagePath, buf, { contentType, upsert: true });
  if (error) throw new Error(`upload Supabase: ${error.message}`);

  const { data } = admin.storage.from("videos-library").getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { account_id?: string };
  const { account_id } = body;
  if (!account_id) return NextResponse.json({ error: "Informe a conta de origem." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: account } = await admin
    .from("instagram_accounts")
    .select("id, username, ig_business_account_id, meta_access_token")
    .eq("id", account_id)
    .eq("user_id", user.id)
    .single();

  if (!account) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });

  const acc = account as unknown as AccountRow;
  if (!acc.ig_business_account_id || !acc.meta_access_token) {
    return NextResponse.json({ error: "Conta sem credenciais Meta. Reconecte em Contas." }, { status: 422 });
  }

  const url =
    `https://graph.instagram.com/v21.0/${acc.ig_business_account_id}/stories` +
    `?fields=id,media_type,media_url,timestamp` +
    `&access_token=${encodeURIComponent(acc.meta_access_token)}`;

  const res = await undiciFetch(url, { signal: AbortSignal.timeout(15_000) });
  const json = await res.json() as { data?: StoryItem[]; error?: { message: string } };

  if (!res.ok || json.error) {
    return NextResponse.json({ error: json.error?.message ?? "Falha ao buscar stories ativos." }, { status: 400 });
  }

  const stories = json.data ?? [];
  if (stories.length === 0) {
    return NextResponse.json({ error: `@${acc.username} não tem nenhum story ativo agora.` }, { status: 404 });
  }

  const newest = [...stories].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )[0];

  if (!newest.media_url) {
    return NextResponse.json({ error: "O story mais recente não retornou media_url." }, { status: 502 });
  }

  const mediaType: "image" | "video" = newest.media_type === "IMAGE" ? "image" : "video";

  try {
    const hostedUrl = await downloadAndHost(newest.media_url, mediaType);
    return NextResponse.json({
      media_url: hostedUrl,
      media_type: mediaType,
      source_account_id: acc.id,
      source_username: acc.username,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Falha ao importar mídia: ${msg}` }, { status: 500 });
  }
}
