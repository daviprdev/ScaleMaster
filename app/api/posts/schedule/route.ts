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

  // ── Algoritmo de distribuição anti-spam ───────────────────────────────────
  //
  // batch_size = vídeos por CONTA por slot (disparo).
  // Regra crítica: no mesmo slot, cada conta recebe um vídeo diferente do pool
  // — nunca o mesmo vídeo vai para duas contas.
  //
  // Implementação:
  //   1. Fisher-Yates shuffle no pool inteiro (uma vez)
  //   2. Embaralha as contas (ordem aleatória fixa para a campanha)
  //   3. Para cada slot: itera TODAS as contas em sequência
  //      → cada conta recebe effectiveBatch vídeos únicos do pool
  //      → o slot compartilha o mesmo scheduled_at para todas as contas
  //   4. Legenda aleatória independente por post
  //   5. O tempo só avança APÓS todas as contas serem servidas no slot
  //   6. Para quando o pool esgota (slot pode ser parcial no final)

  const campaignId = randomUUID();
  const effectiveBatch = Math.max(1, Math.floor(batch_size ?? 1));
  const shuffledVideos = shuffle(videos);
  const shuffledAccounts = shuffle([...account_ids]);
  const posts: Record<string, unknown>[] = [];
  let ptr = 0;
  let slotIndex = 0;

  while (ptr < shuffledVideos.length) {
    const slotTime = new Date(startMs + slotIndex * intervalMs).toISOString();

    // Serve todas as contas neste slot antes de avançar o tempo
    outer: for (const accountId of shuffledAccounts) {
      for (let b = 0; b < effectiveBatch; b++) {
        if (ptr >= shuffledVideos.length) break outer;
        const video = shuffledVideos[ptr++];
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

    // Tempo só avança depois que todas as contas do slot foram atendidas
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
