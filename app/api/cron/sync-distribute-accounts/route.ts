/**
 * /api/cron/sync-distribute-accounts
 *
 * Campanhas criadas na aba Postar com "Sincronizar com pasta de contas" ativo
 * ganham uma linha em distribute_campaigns. Este cron roda a cada 5 min e,
 * para cada uma delas, detecta contas adicionadas às pastas vigiadas DEPOIS
 * da criação da campanha e as matricula com o mesmo lote/cadência das demais.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAutoCaption, type AutoCaptionType } from "@/lib/auto-captions";

export const runtime = "nodejs";
export const maxDuration = 60;

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface DistributeCampaignRow {
  id: string;
  user_id: string;
  account_folder_ids: string[];
  video_folder_id: string;
  video_count: number;
  posts_per_day: number;
  captions: string[];
  auto_caption_enabled: boolean;
  auto_caption_type: string | null;
  account_stagger_seconds: number | null;
  burst_mode: boolean;
}

// TTL do lock: se uma execução travar (erro, timeout da função), o lock se
// libera sozinho depois desse tempo em vez de bloquear a campanha para sempre.
const LOCK_TTL_MINUTES = 10;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[sync-distribute-accounts] AVISO: CRON_SECRET não configurado.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: campaigns, error } = await admin
    .from("distribute_campaigns")
    .select("id, user_id, account_folder_ids, video_folder_id, video_count, posts_per_day, captions, auto_caption_enabled, auto_caption_type, account_stagger_seconds, burst_mode");

  if (error) {
    console.error("[sync-distribute-accounts] Erro ao buscar campanhas:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const watched = ((campaigns ?? []) as DistributeCampaignRow[]).filter(c => c.account_folder_ids?.length > 0);
  if (!watched.length) return NextResponse.json({ enrolled: 0, campaigns: 0 });

  let totalEnrolled = 0;

  for (const campaign of watched) {
    // Lock atômico: se execuções do cron se sobrepuserem (inserir milhares de
    // linhas pode levar mais que o intervalo entre disparos), a segunda
    // invocação NÃO pode reprocessar a mesma campanha antes da primeira
    // terminar de comitar — foi exatamente isso que causou a campanha
    // duplicada 8x em 2026-07-22. Claim via UPDATE condicional: só uma
    // invocação consegue marcar syncing_at, as demais pulam a campanha.
    const cutoffIso = new Date(Date.now() - LOCK_TTL_MINUTES * 60_000).toISOString();
    const { data: claimed } = await admin
      .from("distribute_campaigns")
      .update({ syncing_at: new Date().toISOString() })
      .eq("id", campaign.id)
      .or(`syncing_at.is.null,syncing_at.lt.${cutoffIso}`)
      .select("id");

    if (!claimed?.length) continue; // outra invocação já está processando esta campanha

    try {
      // Contas atualmente nas pastas vigiadas por esta campanha
      const { data: folderAccounts } = await admin
        .from("instagram_accounts")
        .select("id")
        .in("folder_id", campaign.account_folder_ids)
        .eq("is_active", true)
        .neq("health_status", "error");

      if (!folderAccounts?.length) continue;

      // Contas já matriculadas nesta campanha (qualquer post já criado para ela)
      const { data: enrolledRows } = await admin
        .from("scheduled_posts")
        .select("account_id")
        .eq("campaign_id", campaign.id)
        .limit(100000);

      const enrolledIds = new Set((enrolledRows ?? []).map((r: { account_id: string }) => r.account_id));
      const newAccountIds = folderAccounts.map(a => a.id).filter(id => !enrolledIds.has(id));
      if (!newAccountIds.length) continue;

      await processNewAccounts(admin, campaign, newAccountIds);
      totalEnrolled += newAccountIds.length;
    } finally {
      // Libera o lock assim que termina (sucesso ou erro). O TTL acima cobre
      // o caso da função ser encerrada à força pela Vercel antes do finally rodar.
      await admin.from("distribute_campaigns").update({ syncing_at: null }).eq("id", campaign.id);
    }
  }

  return NextResponse.json({ enrolled: totalEnrolled, campaigns: watched.length });
}

async function processNewAccounts(
  admin: ReturnType<typeof getSupabaseAdmin>,
  campaign: DistributeCampaignRow,
  newAccountIds: string[]
) {
  const { data: allVideos } = await admin
    .from("videos_library")
    .select("id, public_url")
    .eq("folder_id", campaign.video_folder_id)
    .order("created_at", { ascending: true })
    .limit(10000);

  if (!allVideos?.length) return;

    const maxVideos = campaign.video_count === -1
      ? allVideos.length
      : Math.min(campaign.video_count, allVideos.length);

    // Histórico por conta (mesma lógica anti-repetição do distribute)
    const [{ data: spHist }, { data: pcHist }] = await Promise.all([
      admin.from("scheduled_posts").select("account_id, video_id")
        .in("account_id", newAccountIds).not("video_id", "is", null)
        .in("status", ["pending", "publishing", "published"]).limit(100000),
      admin.from("pending_containers").select("account_id, video_id")
        .in("account_id", newAccountIds).not("video_id", "is", null)
        .neq("status", "error").limit(100000),
    ]);

    const postedCount = new Map<string, Map<string, number>>();
    for (const row of [...(spHist ?? []), ...(pcHist ?? [])]) {
      let m = postedCount.get(row.account_id);
      if (!m) { m = new Map(); postedCount.set(row.account_id, m); }
      m.set(row.video_id, (m.get(row.video_id) ?? 0) + 1);
    }

    const isAutoCaption = !!campaign.auto_caption_enabled && !!campaign.auto_caption_type;
    const validCaptions = (campaign.captions ?? []).filter(c => c.trim());
    const autoType = (campaign.auto_caption_type ?? "curiosidades-gerais") as AutoCaptionType;

    const intervalMinutes = campaign.burst_mode ? 0 : Math.max(1, Math.floor((24 * 60) / campaign.posts_per_day));
    const startTime = Date.now() + 60_000; // +1min de folga

    const autoStaggerPerAccountMs = !campaign.burst_mode && newAccountIds.length > 1
      ? Math.min(5 * 60_000, Math.floor((intervalMinutes * 60_000 * 0.9) / (newAccountIds.length - 1)))
      : 0;
    const burstBlockMs = campaign.burst_mode
      ? Math.max((campaign.account_stagger_seconds ?? 0) * 1_000, maxVideos * 2_000)
      : 0;

    const inRunUse = new Map<string, number>();
    const rows: object[] = [];

    newAccountIds.forEach((accountId, ai) => {
      const staggerMs = campaign.burst_mode
        ? ai * burstBlockMs
        : campaign.account_stagger_seconds
          ? ai * campaign.account_stagger_seconds * 1_000
          : ai * autoStaggerPerAccountMs;

      const counts = postedCount.get(accountId);
      const accountVideos = fisherYates(allVideos)
        .map((v) => ({ v, uses: (counts?.get(v.id) ?? 0) + (inRunUse.get(v.id) ?? 0) }))
        .sort((a, b) => a.uses - b.uses)
        .slice(0, maxVideos)
        .map((x) => x.v);
      if (campaign.burst_mode) {
        for (const v of accountVideos) inRunUse.set(v.id, (inRunUse.get(v.id) ?? 0) + 1);
      }

      accountVideos.forEach((video, vi) => {
        const slotMs = campaign.burst_mode ? vi * 2_000 : vi * intervalMinutes * 60_000;
        const scheduledAt = new Date(startTime + slotMs + staggerMs).toISOString();
        const caption = isAutoCaption
          ? getAutoCaption(autoType)
          : validCaptions.length > 0
            ? validCaptions[Math.floor(Math.random() * validCaptions.length)]
            : "";

        rows.push({
          user_id: campaign.user_id,
          account_id: accountId,
          video_id: video.id,
          video_url: video.public_url,
          caption,
          scheduled_at: scheduledAt,
          status: "pending",
          campaign_id: campaign.id,
        });
      });
    });

    for (let i = 0; i < rows.length; i += 500) {
      const { error: insErr } = await admin.from("scheduled_posts").insert(rows.slice(i, i + 500));
      if (insErr) console.error(`[sync-distribute-accounts] Erro ao inserir posts para campanha ${campaign.id}:`, insErr.message);
    }

  console.log(`[sync-distribute-accounts] +${newAccountIds.length} conta(s) matriculada(s) na campanha ${campaign.id}`);
}
