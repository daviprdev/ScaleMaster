import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAutoCaption, getUniqueCaptions, type AutoCaptionType } from "@/lib/auto-captions";

export const runtime = "nodejs";

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface DistributeBody {
  account_ids: string[];
  folder_id: string;
  video_count: number;            // -1 = todos, ou 10/20/50
  posts_per_day: number;          // 1–1440 (ignorado em burst_mode)
  start_at: string;               // ISO datetime (ignorado em burst_mode)
  captions: string[];
  auto_caption_type?: string;     // se presente, ignora captions e gera automaticamente
  account_stagger_seconds?: number | null; // null = cálculo automático
  burst_mode?: boolean;           // Modo Ciclo: todos os vídeos agendados para agora
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, total_posts: 0, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as DistributeBody;
  const { account_ids, folder_id, video_count, posts_per_day, start_at, captions, auto_caption_type, account_stagger_seconds, burst_mode } = body;

  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta." }, { status: 400 });
  if (!folder_id)
    return NextResponse.json({ error: "Selecione uma pasta de mídia." }, { status: 400 });
  if (!burst_mode && (!posts_per_day || posts_per_day < 1 || posts_per_day > 1440))
    return NextResponse.json({ error: "Posts por dia deve ser entre 1 e 1440." }, { status: 400 });
  if (!burst_mode && !start_at)
    return NextResponse.json({ error: "Informe a data e hora de início." }, { status: 400 });

  const isAutoCaption = !!auto_caption_type;
  const validCaptions = isAutoCaption ? [] : (captions ?? []).map(c => c.trim()).filter(Boolean);

  // Pré-gera legendas automáticas únicas se necessário (1 por post total)
  const autoType = (auto_caption_type ?? "curiosidades-gerais") as AutoCaptionType;

  const admin = getSupabaseAdmin();

  const { data: allVideos, error: vErr } = await admin
    .from("videos_library")
    .select("id, public_url")
    .eq("folder_id", folder_id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(10000);

  if (vErr || !allVideos?.length)
    return NextResponse.json({ error: "Nenhum vídeo encontrado na pasta." }, { status: 400 });

  const maxVideos = video_count === -1
    ? allVideos.length
    : Math.min(video_count, allVideos.length);

  // Histórico por conta atravessando TODAS as origens (Postar/Clonar/Automatizar
  // via scheduled_posts + Loop via pending_containers). Antes, o subconjunto era
  // slice(0, N) fixo por created_at — toda campanha nova começava SEMPRE pelos
  // mesmos N vídeos mais antigos da pasta, repetindo o que a conta já postou.
  const [{ data: spHist }, { data: pcHist }] = await Promise.all([
    admin
      .from("scheduled_posts")
      .select("account_id, video_id")
      .in("account_id", account_ids)
      .not("video_id", "is", null)
      .in("status", ["pending", "publishing", "published"])
      .limit(100000),
    admin
      .from("pending_containers")
      .select("account_id, video_id")
      .in("account_id", account_ids)
      .not("video_id", "is", null)
      .neq("status", "error")
      .limit(100000),
  ]);

  // account_id → (video_id → vezes postado)
  const postedCount = new Map<string, Map<string, number>>();
  for (const row of [...(spHist ?? []), ...(pcHist ?? [])]) {
    let m = postedCount.get(row.account_id);
    if (!m) { m = new Map(); postedCount.set(row.account_id, m); }
    m.set(row.video_id, (m.get(row.video_id) ?? 0) + 1);
  }

  const campaignId = randomUUID();
  // Distribui uniformemente ao longo de 24h (ignorado em burst_mode)
  const intervalMinutes = burst_mode ? 0 : Math.floor((24 * 60) / posts_per_day);
  // Modo Ciclo: tudo agendado para agora — o cron publish-scheduled drena a fila
  // no ritmo máximo do pipeline (lotes por minuto, retry/backoff da Meta intactos).
  const startTime = burst_mode ? Date.now() : new Date(start_at).getTime();

  const rows: object[] = [];

  // Stagger entre contas: customizável ou proporcional ao intervalo (máx. 5 min).
  // Custom: exato, sem jitter — conta[i] posta em i × stagger_s segundos.
  // Auto: proporcional ao intervalo garantindo que todas as contas postem dentro da 1ª janela.
  const autoStaggerPerAccountMs = !burst_mode && account_ids.length > 1
    ? Math.min(5 * 60_000, Math.floor((intervalMinutes * 60_000 * 0.9) / (account_ids.length - 1)))
    : 0;

  // Burst: blocos SEQUENCIAIS por conta — conta[0] posta seu lote inteiro, depois
  // conta[1], depois conta[2]... O bloco dura maxVideos × 2s; stagger custom vira
  // o espaçamento mínimo entre o início de cada conta (nunca menor que o bloco,
  // para os lotes não se intercalarem na fila).
  const burstBlockMs = burst_mode
    ? Math.max((account_stagger_seconds ?? 0) * 1_000, maxVideos * 2_000)
    : 0;

  // Burst: uso em memória neste request — vídeos já sorteados para contas
  // anteriores ficam no fim da preferência, então cada conta recebe um lote
  // DIFERENTE até a pasta esgotar (depois recomeça balanceado).
  const inRunUse = new Map<string, number>();

  for (let ai = 0; ai < account_ids.length; ai++) {
    const accountId = account_ids[ai];
    const staggerMs = burst_mode
      ? ai * burstBlockMs
      : account_stagger_seconds
        ? ai * account_stagger_seconds * 1_000
        : ai * autoStaggerPerAccountMs;
    // Embaralha e depois ordena (sort estável) pelo nº de vezes que ESTA conta
    // já postou cada vídeo: vídeos nunca postados vêm primeiro em ordem
    // aleatória; só reutiliza os já postados se a quantidade pedida exigir.
    const counts = postedCount.get(accountId);
    const accountVideos = fisherYates(allVideos)
      .map((v) => ({ v, uses: (counts?.get(v.id) ?? 0) + (inRunUse.get(v.id) ?? 0) }))
      .sort((a, b) => a.uses - b.uses)
      .slice(0, maxVideos)
      .map((x) => x.v);
    if (burst_mode) {
      for (const v of accountVideos) inRunUse.set(v.id, (inRunUse.get(v.id) ?? 0) + 1);
    }

    for (let vi = 0; vi < accountVideos.length; vi++) {
      const video = accountVideos[vi];
      // Burst: 2s entre vídeos só para ordenação estável na fila (scheduled_at ASC)
      const slotMs = burst_mode ? vi * 2_000 : vi * intervalMinutes * 60_000;
      const scheduledAt = new Date(startTime + slotMs + staggerMs).toISOString();
      const caption = isAutoCaption
        ? getAutoCaption(autoType)
        : validCaptions.length > 0
          ? validCaptions[Math.floor(Math.random() * validCaptions.length)]
          : "";

      rows.push({
        user_id: user.id,
        account_id: accountId,
        video_id: video.id,
        video_url: video.public_url,
        caption,
        scheduled_at: scheduledAt,
        status: "pending",
        campaign_id: campaignId,
      });
    }
  }

  // Insert em lotes de 500
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("scheduled_posts").insert(rows.slice(i, i + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const times = rows.map((r) => (r as { scheduled_at: string }).scheduled_at).sort();

  return NextResponse.json({
    success: true,
    campaign_id: campaignId,
    total_posts: rows.length,
    accounts: account_ids.length,
    videos_per_account: maxVideos,
    days: burst_mode ? 1 : Math.ceil(maxVideos / posts_per_day),
    first_slot: times[0],
    last_slot: times[times.length - 1],
  });
}
