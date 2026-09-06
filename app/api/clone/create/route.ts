import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAutoCaption, type AutoCaptionType } from "@/lib/auto-captions";
import { normalizeProcessingMode } from "@/lib/video-processing";

export const runtime = "nodejs";

interface ReelItem {
  shortCode: string;
  caption:   string;
}

interface CloneBody {
  account_ids:        string[];
  reels:              ReelItem[];
  reel_count:         number;   // -1 = all
  posts_per_day:      number;
  start_at:           string;   // ISO datetime
  auto_caption_type?: string;
  profile_username?:  string;
  video_processing_mode?: string; // "original" (padrao) | "clean_metadata"
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, total_posts: 0, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: CloneBody;
  try {
    body = await req.json() as CloneBody;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { account_ids, reels, reel_count, posts_per_day, start_at, auto_caption_type, profile_username } = body;
  // Congelado por post: o Clone re-hospeda o reel do CDN sem alterar bytes; a
  // limpeza opcional gera uma variante separada dessa copia re-hospedada.
  const processingMode = normalizeProcessingMode(body.video_processing_mode);
  const isAutoCaption = !!auto_caption_type;
  const autoType = (auto_caption_type ?? "curiosidades-gerais") as AutoCaptionType;

  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta de destino." }, { status: 400 });
  if (!reels?.length)
    return NextResponse.json({ error: "Nenhum Reel disponível para clonar." }, { status: 400 });
  if (!posts_per_day || posts_per_day < 1 || posts_per_day > 1440)
    return NextResponse.json({ error: "Posts por dia inválido (1–1440)." }, { status: 400 });
  if (!start_at)
    return NextResponse.json({ error: "Informe a data e hora de início." }, { status: 400 });

  // Valida que todas as contas pertencem ao usuário autenticado (via RLS)
  const { data: ownedAccounts } = await supabase
    .from("instagram_accounts")
    .select("id")
    .in("id", account_ids);

  if ((ownedAccounts?.length ?? 0) !== account_ids.length) {
    return NextResponse.json({ error: "Uma ou mais contas não pertencem ao seu usuário." }, { status: 403 });
  }

  // Seleciona quantidade de reels (frontend já pré-cortou, mas garantimos aqui)
  const maxReels  = reel_count === -1 ? reels.length : Math.min(reel_count, reels.length);
  const baseReels = reels.slice(0, maxReels).filter(r => r.shortCode);

  if (!baseReels.length)
    return NextResponse.json({ error: "Nenhum Reel com shortCode válido." }, { status: 400 });

  const admin      = getSupabaseAdmin();
  const campaignId = randomUUID();
  const intervalMs = Math.floor((24 * 60) / posts_per_day) * 60_000;
  const startTime  = new Date(start_at).getTime();

  // Stagger proporcional ao intervalo: evita que muitas contas ultrapassem um ciclo
  const maxStaggerMs = Math.max(0, Math.floor(intervalMs / Math.max(account_ids.length, 1)) / 2);
  const perAccountStaggerMs = Math.min(5 * 60_000, maxStaggerMs);

  const rows: object[] = [];

  // Pool compartilhado ÚNICO (não por conta) — atribuição em "quadrado latino":
  // na rodada r, a conta de índice `ai` recebe sharedPool[(ai + r) % poolSize].
  // Garante que, na MESMA rodada (mesmo horário relativo entre as contas),
  // nenhuma conta posta o mesmo Reel raspado que outra ao mesmo tempo — mesmo
  // bug e mesmo fix já aplicados em posts/distribute (2026-07-28), que faltava
  // aqui: cada conta sorteava sua própria sequência independente e o mesmo Reel
  // saía em várias contas quase junto, sinal de conteúdo duplicado pra Meta.
  const sharedPool = fisherYates(baseReels);
  const poolSize    = sharedPool.length;

  for (let ai = 0; ai < account_ids.length; ai++) {
    const accountId = account_ids[ai];
    const staggerMs = ai * perAccountStaggerMs;

    for (let ri = 0; ri < poolSize; ri++) {
      const reel        = sharedPool[(ai + ri) % poolSize];
      const scheduledAt = new Date(startTime + ri * intervalMs + staggerMs).toISOString();

      rows.push({
        user_id:              user.id,
        account_id:           accountId,
        video_id:             null,
        video_url:            `https://www.instagram.com/reel/${reel.shortCode}/`,
        caption:              isAutoCaption ? getAutoCaption(autoType) : reel.caption,
        scheduled_at:         scheduledAt,
        status:               "pending",
        campaign_id:          campaignId,
        clone_source_profile: profile_username ?? null,
        video_processing_mode: processingMode,
      });
    }
  }

  // Insere em lotes de 500
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("scheduled_posts").insert(rows.slice(i, i + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const times = rows
    .map(r => (r as { scheduled_at: string }).scheduled_at)
    .sort();

  return NextResponse.json({
    success:           true,
    campaign_id:       campaignId,
    total_posts:       rows.length,
    accounts:          account_ids.length,
    reels_per_account: baseReels.length,
    days:              Math.ceil(baseReels.length / posts_per_day),
    first_slot:        times[0],
    last_slot:         times[times.length - 1],
  });
}
