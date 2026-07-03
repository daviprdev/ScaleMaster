import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface StoriesBody {
  account_ids: string[];
  folder_id: string;
  video_count: number;          // -1 = todos, ou 10/20/50
  posts_per_day: number;        // 1–1440
  start_at: string;             // ISO datetime
  account_stagger_seconds?: number | null;
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, total_posts: 0, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: StoriesBody;
  try {
    body = await req.json() as StoriesBody;
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { account_ids, folder_id, video_count, posts_per_day, start_at, account_stagger_seconds } = body;

  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta." }, { status: 400 });
  if (!folder_id)
    return NextResponse.json({ error: "Selecione uma pasta de mídia." }, { status: 400 });
  if (!posts_per_day || posts_per_day < 1 || posts_per_day > 1440)
    return NextResponse.json({ error: "Posts por dia deve ser entre 1 e 1440." }, { status: 400 });
  if (!start_at)
    return NextResponse.json({ error: "Informe a data e hora de início." }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Valida ownership das contas selecionadas
  const { data: ownedAccounts } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", user.id)
    .in("id", account_ids);
  const validAccountIds = (ownedAccounts ?? []).map(a => a.id);
  if (!validAccountIds.length)
    return NextResponse.json({ error: "Nenhuma conta válida encontrada." }, { status: 400 });

  const { data: allVideos, error: vErr } = await admin
    .from("videos_library")
    .select("id, public_url")
    .eq("folder_id", folder_id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (vErr || !allVideos?.length)
    return NextResponse.json({ error: "Nenhum vídeo encontrado na pasta." }, { status: 400 });

  const maxVideos = video_count === -1
    ? allVideos.length
    : Math.min(video_count, allVideos.length);

  const baseVideos = allVideos.slice(0, maxVideos);

  const campaignId = randomUUID();
  const intervalMinutes = Math.floor((24 * 60) / posts_per_day);
  const startTime = new Date(start_at).getTime();

  const autoStaggerPerAccountMs = validAccountIds.length > 1
    ? Math.min(5 * 60_000, Math.floor((intervalMinutes * 60_000 * 0.9) / (validAccountIds.length - 1)))
    : 0;

  const rows: object[] = [];

  for (let ai = 0; ai < validAccountIds.length; ai++) {
    const accountId = validAccountIds[ai];
    const staggerMs = account_stagger_seconds
      ? ai * account_stagger_seconds * 1_000
      : ai * autoStaggerPerAccountMs;
    const accountVideos = fisherYates(baseVideos);

    for (let vi = 0; vi < accountVideos.length; vi++) {
      const video = accountVideos[vi];
      const slotMs = vi * intervalMinutes * 60_000;
      const scheduledAt = new Date(startTime + slotMs + staggerMs).toISOString();

      rows.push({
        user_id: user.id,
        account_id: accountId,
        video_id: video.id,
        video_url: video.public_url,
        caption: "",
        scheduled_at: scheduledAt,
        status: "pending",
        campaign_id: campaignId,
        post_type: "story",
      });
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("scheduled_posts").insert(rows.slice(i, i + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const times = rows.map((r) => (r as { scheduled_at: string }).scheduled_at).sort();

  return NextResponse.json({
    success: true,
    campaign_id: campaignId,
    total_posts: rows.length,
    accounts: validAccountIds.length,
    videos_per_account: baseVideos.length,
    days: Math.ceil(baseVideos.length / posts_per_day),
    first_slot: times[0],
    last_slot: times[times.length - 1],
  });
}
