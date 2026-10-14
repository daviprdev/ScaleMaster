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
  // true  → mesmo vídeo para todas as contas por disparo (1 vídeo a cada N min por conta)
  // false → vídeo diferente por conta em cada disparo (anti-spam)
  same_video_per_slot?: boolean;
  use_proxy_pool?: boolean; // true = usar proxy do estoque na publicação (opt-in)
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, count: 0, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as ScheduleBody;
  const {
    account_ids, video_ids, folder_id, captions,
    start_datetime, interval_minutes, batch_size,
    same_video_per_slot = true,
  } = body;

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

  // Valida ownership de TODAS as contas antes de agendar qualquer post — impede
  // agendar/publicar em conta de outro usuário via account_id vazado/adivinhado.
  const { data: ownedAccountRows } = await admin
    .from("instagram_accounts")
    .select("id")
    .in("id", account_ids)
    .eq("user_id", user.id);
  const ownedAccountIds = new Set((ownedAccountRows ?? []).map((a: { id: string }) => a.id));
  const notOwnedAccounts = account_ids.filter((id) => !ownedAccountIds.has(id));
  if (notOwnedAccounts.length > 0) {
    return NextResponse.json(
      { error: "Uma ou mais contas não pertencem a este usuário." },
      { status: 403 }
    );
  }

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

  const campaignId = randomUUID();
  const effectiveBatch = Math.max(1, Math.floor(batch_size ?? 1));
  const shuffledVideos = shuffle(videos);
  const posts: Record<string, unknown>[] = [];
  let ptr = 0;
  let slotIndex = 0;

  if (same_video_per_slot) {
    // ── Modo: mesmo vídeo para todas as contas ────────────────────────────
    // Cada slot pega effectiveBatch vídeos e distribui para TODAS as contas.
    // O intervalo avança por vídeo → 1 vídeo a cada N min por conta.
    while (ptr < shuffledVideos.length) {
      const slotTime = new Date(startMs + slotIndex * intervalMs).toISOString();

      const slotVideos: VideoRecord[] = [];
      for (let b = 0; b < effectiveBatch && ptr < shuffledVideos.length; b++) {
        slotVideos.push(shuffledVideos[ptr++]);
      }

      for (const accountId of account_ids) {
        for (const video of slotVideos) {
          const caption = validCaptions[Math.floor(Math.random() * validCaptions.length)];
          posts.push({
            user_id: user.id, account_id: accountId,
            video_id: video.id, video_url: video.public_url,
            caption, scheduled_at: slotTime, status: "pending", campaign_id: campaignId,
            use_proxy_pool: body.use_proxy_pool === true,
          });
        }
      }

      slotIndex++;
    }
  } else {
    // ── Modo: vídeo diferente por conta (anti-spam) ───────────────────────
    // Cada slot distribui effectiveBatch vídeos ÚNICOS por conta antes de
    // avançar o tempo — cada conta recebe vídeos distintos no mesmo slot.
    const shuffledAccounts = shuffle([...account_ids]);

    outer: while (ptr < shuffledVideos.length) {
      const slotTime = new Date(startMs + slotIndex * intervalMs).toISOString();

      for (const accountId of shuffledAccounts) {
        for (let b = 0; b < effectiveBatch; b++) {
          if (ptr >= shuffledVideos.length) break outer;
          const video = shuffledVideos[ptr++];
          const caption = validCaptions[Math.floor(Math.random() * validCaptions.length)];
          posts.push({
            user_id: user.id, account_id: accountId,
            video_id: video.id, video_url: video.public_url,
            caption, scheduled_at: slotTime, status: "pending", campaign_id: campaignId,
            use_proxy_pool: body.use_proxy_pool === true,
          });
        }
      }

      slotIndex++;
    }
  }

  // ── Inserção em massa ─────────────────────────────────────────────────────
  const { error: insertErr } = await admin.from("scheduled_posts").insert(posts);

  const firstSlotTime = new Date(startMs).toISOString();
  const lastSlotTime = slotIndex > 0
    ? new Date(startMs + (slotIndex - 1) * intervalMs).toISOString()
    : firstSlotTime;

  if (insertErr) {
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
