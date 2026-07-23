import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { matchAutoCaptionType, type AutoCaptionType } from "@/lib/auto-captions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DistributeCampaignRow {
  posts_per_day: number;
  captions: string[];
  auto_caption_enabled: boolean;
  auto_caption_type: string | null;
  account_stagger_seconds: number | null;
}

interface PostRow {
  account_id: string;
  scheduled_at: string;
  caption: string | null;
}

// Melhor estimativa da cadência atual (posts/dia por conta) a partir do
// espaçamento real entre os posts pendentes de cada conta — usada quando a
// campanha não tem config persistida (distribute_campaigns só existe para
// campanhas com "Sincronizar com pasta" ativado na criação).
function inferPostsPerDay(rows: PostRow[]): number {
  const byAccount = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byAccount.get(r.account_id) ?? [];
    arr.push(new Date(r.scheduled_at).getTime());
    byAccount.set(r.account_id, arr);
  }
  const gapsMinutes: number[] = [];
  for (const times of byAccount.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const gapMin = (times[i] - times[i - 1]) / 60_000;
      if (gapMin >= 1) gapsMinutes.push(gapMin);
    }
  }
  if (gapsMinutes.length === 0) return 4;
  gapsMinutes.sort((a, b) => a - b);
  const medianGap = gapsMinutes[Math.floor(gapsMinutes.length / 2)];
  const perDay = Math.round((24 * 60) / medianGap);
  return Math.min(1440, Math.max(1, perDay));
}

export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({
      caption_mode: "manual", captions: [], auto_caption_type: null,
      posts_per_day: 4, account_stagger_seconds: null,
    });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  if (!campaignId) return NextResponse.json({ error: "campaign_id obrigatório." }, { status: 400 });

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  // Fonte autoritativa: se a campanha foi criada com "Sincronizar com pasta",
  // a config exata usada na criação está salva aqui — usar sempre que existir.
  const { data: synced } = await (admin as any)
    .from("distribute_campaigns")
    .select("posts_per_day, captions, auto_caption_enabled, auto_caption_type, account_stagger_seconds")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (synced) {
    const s = synced as DistributeCampaignRow;
    return NextResponse.json({
      caption_mode: s.auto_caption_enabled ? "auto" : "manual",
      captions: s.captions ?? [],
      auto_caption_type: s.auto_caption_type ?? "curiosidades-gerais",
      posts_per_day: s.posts_per_day,
      account_stagger_seconds: s.account_stagger_seconds,
      source: "synced_config",
    });
  }

  // Sem config persistida: reconstrói a partir dos posts já criados.
  const { data: rows } = await (admin as any)
    .from("scheduled_posts")
    .select("account_id, scheduled_at, caption")
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .in("status", ["pending", "publishing", "published"])
    .order("scheduled_at", { ascending: true })
    .limit(500);

  const postRows = (rows ?? []) as PostRow[];
  if (postRows.length === 0) {
    return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  }

  const distinctCaptions = Array.from(
    new Set(postRows.map(r => (r.caption ?? "").trim()).filter(Boolean))
  ).slice(0, 30);

  // Se toda legenda distinta bate exatamente com um dos pools automáticos (e
  // há mais de uma amostra), a campanha quase certamente usava legenda
  // automática — infere o tipo pelo pool com mais matches.
  let inferredAutoType: AutoCaptionType | null = null;
  if (distinctCaptions.length >= 2) {
    const votes = new Map<AutoCaptionType, number>();
    let allMatched = true;
    for (const cap of distinctCaptions) {
      const type = matchAutoCaptionType(cap);
      if (!type) { allMatched = false; break; }
      votes.set(type, (votes.get(type) ?? 0) + 1);
    }
    if (allMatched && votes.size > 1) {
      // Legendas batem com mais de um pool automático — a campanha estava
      // sorteando entre tipos (modo "variado"), não usando um tipo fixo.
      inferredAutoType = "variado";
    } else if (allMatched && votes.size === 1) {
      inferredAutoType = [...votes.entries()][0][0];
    }
  }

  return NextResponse.json({
    caption_mode: inferredAutoType ? "auto" : "manual",
    captions: inferredAutoType ? [] : distinctCaptions,
    auto_caption_type: inferredAutoType ?? "curiosidades-gerais",
    posts_per_day: inferPostsPerDay(postRows),
    account_stagger_seconds: null,
    source: "inferred",
  });
}
