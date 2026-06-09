import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Fisher-Yates in-place shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface VideoRecord {
  id: string;
  public_url: string;
}

interface ScheduleBody {
  account_ids: string[];
  video_ids?: string[];
  folder_id?: string;
  captions: string[];
  start_datetime: string;
  interval_minutes: number;
  batch_size?: number;
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, count: 0, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as ScheduleBody;
  const { account_ids, video_ids, folder_id, captions, start_datetime, interval_minutes, batch_size } = body;

  // ── Validações ────────────────────────────────────────────────────────────
  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta." }, { status: 400 });

  if (!video_ids?.length && !folder_id)
    return NextResponse.json({ error: "Selecione vídeos ou uma pasta." }, { status: 400 });

  const validCaptions = (captions ?? []).map(c => c.trim()).filter(Boolean);
  if (!validCaptions.length)
    return NextResponse.json({ error: "Adicione ao menos 1 legenda." }, { status: 400 });

  if (!start_datetime)
    return NextResponse.json({ error: "Defina a data e hora de início." }, { status: 400 });

  const startMs = new Date(start_datetime).getTime();
  if (isNaN(startMs))
    return NextResponse.json({ error: "Data de início inválida." }, { status: 400 });

  const intervalMs = Math.max(0, Number(interval_minutes) || 0) * 60_000;

  // ── Busca vídeos ──────────────────────────────────────────────────────────
  const admin = getSupabaseAdmin() as any;
  let videos: VideoRecord[] = [];

  if (folder_id) {
    const { data, error } = await admin
      .from("videos_library")
      .select("id, public_url")
      .eq("folder_id", folder_id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error || !data?.length)
      return NextResponse.json({ error: "Pasta vazia ou sem permissão." }, { status: 404 });
    videos = data as VideoRecord[];
  } else {
    const { data, error } = await admin
      .from("videos_library")
      .select("id, public_url")
      .eq("user_id", user.id)
      .in("id", video_ids!);

    if (error || !data?.length)
      return NextResponse.json({ error: "Vídeos não encontrados ou sem permissão." }, { status: 404 });
    videos = data as VideoRecord[];
  }

  // ── Algoritmo de distribuição ─────────────────────────────────────────────
  //
  // batch_size = vídeos por slot (disparo).
  // Cada slot pega `effectiveBatch` vídeos do pool e distribui os MESMOS
  // vídeos para TODAS as contas selecionadas. O intervalo avança por vídeo,
  // não por conta — resultado: 1 vídeo a cada N min por conta.
  //
  // Implementação:
  //   1. Fisher-Yates shuffle no pool inteiro (uma vez)
  //   2. Para cada slot: coleta effectiveBatch vídeos → envia para todas as contas
  //   3. Legenda aleatória independente por post
  //   4. O tempo avança após cada lote de vídeos (não por conta)
  //   5. Para quando o pool esgota

  const campaignId = randomUUID();
  const effectiveBatch = Math.max(1, Math.floor(batch_size ?? 1));
  const shuffledVideos = shuffle(videos);
  const posts: Record<string, unknown>[] = [];
  let ptr = 0;
  let slotIndex = 0;

  while (ptr < shuffledVideos.length) {
    const slotTime = new Date(startMs + slotIndex * intervalMs).toISOString();

    // Coleta os vídeos deste slot (mesmo pool para todas as contas)
    const slotVideos: VideoRecord[] = [];
    for (let b = 0; b < effectiveBatch && ptr < shuffledVideos.length; b++) {
      slotVideos.push(shuffledVideos[ptr++]);
    }

    // Todas as contas recebem os mesmos vídeos neste disparo
    for (const accountId of account_ids) {
      for (const video of slotVideos) {
        const caption = validCaptions[Math.floor(Math.random() * validCaptions.length)];
        posts.push({
          user_id: user.id,
          account_id: accountId,
          video_id: video.id,
          video_url: video.public_url,
          caption,
          scheduled_at: slotTime,
          status: "pending",
          campaign_id: campaignId,
        });
      }
    }

    slotIndex++;
  }

  // ── Inserção em massa ─────────────────────────────────────────────────────
  const { error: insertErr } = await admin.from("scheduled_posts").insert(posts);

  const firstSlotTime = new Date(startMs).toISOString();
  const lastSlotTime = slotIndex > 0
    ? new Date(startMs + (slotIndex - 1) * intervalMs).toISOString()
    : firstSlotTime;

  if (insertErr) {
    // If campaign_id column not yet created, retry without it (graceful fallback)
    if (insertErr.code === "42703" || insertErr.message?.includes("campaign_id")) {
      const postsNoCampaign = posts.map(({ campaign_id: _, ...rest }) => rest);
      const { error: err2 } = await admin.from("scheduled_posts").insert(postsNoCampaign);
      if (err2) {
        console.error("[posts/schedule] Insert error:", err2);
        return NextResponse.json({ error: err2.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, count: posts.length, slots: slotIndex, first_slot: firstSlotTime, last_slot: lastSlotTime });
    }
    console.error("[posts/schedule] Insert error:", insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    count: posts.length,
    slots: slotIndex,
    first_slot: firstSlotTime,
    last_slot: lastSlotTime,
    campaign_id: campaignId,
  });
}
