import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Fisher-Yates in-place shuffle — cada conta recebe uma ordem aleatória diferente
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface ScheduleBody {
  video_ids: string[];
  account_ids: string[];
  captions: string[];
  start_datetime: string;   // ISO 8601
  videos_per_batch: number; // posts por janela de tempo
  interval_hours: number;   // horas entre lotes (pode ser decimal, ex: 0.5)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as ScheduleBody;
  const {
    video_ids,
    account_ids,
    captions,
    start_datetime,
    videos_per_batch,
    interval_hours,
  } = body;

  // ── Validações ──────────────────────────────────────────────
  if (!video_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 vídeo." }, { status: 400 });
  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta." }, { status: 400 });

  const validCaptions = (captions ?? []).map(c => c.trim()).filter(Boolean);
  if (!validCaptions.length)
    return NextResponse.json({ error: "Adicione ao menos 1 legenda." }, { status: 400 });

  if (!start_datetime)
    return NextResponse.json({ error: "Defina a data e hora de início." }, { status: 400 });

  const batchSize = Math.max(1, Math.floor(videos_per_batch ?? 1));
  const intervalMs = Math.max(0, (interval_hours ?? 0)) * 3_600_000;
  const startMs = new Date(start_datetime).getTime();

  if (isNaN(startMs))
    return NextResponse.json({ error: "Data de início inválida." }, { status: 400 });

  // ── Auth ────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  // ── Busca URLs dos vídeos selecionados ──────────────────────
  const admin = getSupabaseAdmin();
  const { data: videos, error: videosErr } = await admin
    .from("videos_library")
    .select("id, public_url")
    .eq("user_id", user.id)
    .in("id", video_ids);

  if (videosErr || !videos?.length)
    return NextResponse.json({ error: "Vídeos não encontrados ou sem permissão." }, { status: 404 });

  const videoMap = new Map(videos.map(v => [v.id as string, v.public_url as string]));

  // ── Algoritmo de distribuição inteligente ───────────────────
  //
  // Para cada conta:
  //   1. Embaralha os video_ids (shuffle independente por conta)
  //   2. Embaralha as captions (shuffle independente por conta)
  //   3. Divide em lotes de `batchSize`
  //   4. Lote 0 → scheduled_at = start
  //      Lote 1 → scheduled_at = start + 1×interval
  //      Lote N → scheduled_at = start + N×interval
  //   5. Legenda: round-robin sobre captions embaralhadas
  //
  const posts: Record<string, unknown>[] = [];

  for (const accountId of account_ids) {
    const shuffledIds = shuffle(video_ids);
    const shuffledCaptions = shuffle(validCaptions);

    for (let i = 0; i < shuffledIds.length; i++) {
      const batchIndex = Math.floor(i / batchSize);
      const scheduledAt = new Date(startMs + batchIndex * intervalMs).toISOString();
      const videoId = shuffledIds[i];

      posts.push({
        user_id: user.id,
        account_id: accountId,
        video_id: videoId,
        video_url: videoMap.get(videoId) ?? null,
        caption: shuffledCaptions[i % shuffledCaptions.length],
        scheduled_at: scheduledAt,
        status: "pending",
      });
    }
  }

  // ── Inserção em massa (único INSERT) ────────────────────────
  const { error: insertErr } = await admin.from("scheduled_posts").insert(posts);

  if (insertErr) {
    console.error("[posts/schedule] Insert error:", insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: posts.length });
}
