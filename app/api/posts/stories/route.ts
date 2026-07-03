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

interface MediaItem {
  url: string;
  media_type: "image" | "video";
  storage_path?: string;
}

interface StoriesBody {
  account_ids: string[];
  media_items: MediaItem[];  // arquivos já upados
  posts_per_day: number;     // 1–1440
  start_at: string;          // ISO datetime
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

  const { account_ids, media_items, posts_per_day, start_at, account_stagger_seconds } = body;

  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta." }, { status: 400 });
  if (!media_items?.length)
    return NextResponse.json({ error: "Adicione ao menos 1 mídia." }, { status: 400 });
  if (!posts_per_day || posts_per_day < 1 || posts_per_day > 1440)
    return NextResponse.json({ error: "Posts por dia deve ser entre 1 e 1440." }, { status: 400 });
  if (!start_at)
    return NextResponse.json({ error: "Informe a data e hora de início." }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Valida ownership das contas
  const { data: ownedAccounts } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", user.id)
    .in("id", account_ids);
  const validAccountIds = (ownedAccounts ?? []).map((a: { id: string }) => a.id);
  if (!validAccountIds.length)
    return NextResponse.json({ error: "Nenhuma conta válida encontrada." }, { status: 400 });

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
    const shuffledItems = fisherYates(media_items);

    for (let vi = 0; vi < shuffledItems.length; vi++) {
      const item = shuffledItems[vi];
      const slotMs = vi * intervalMinutes * 60_000;
      const scheduledAt = new Date(startTime + slotMs + staggerMs).toISOString();

      rows.push({
        user_id: user.id,
        account_id: accountId,
        video_id: null,
        video_url: item.url,
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
    items_per_account: media_items.length,
    days: Math.ceil(media_items.length / posts_per_day),
    first_slot: times[0],
    last_slot: times[times.length - 1],
  });
}
