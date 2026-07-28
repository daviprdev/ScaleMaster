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
export const maxDuration = 90;

// Limite de contas novas matriculadas por execução, por campanha. Sem isso,
// N contas ficando "novas" de uma vez (ex: primeira sincronização de uma
// pasta com 62 contas, video_count=-1 = todos os vídeos) gera um insert
// gigante numa função com budget curto — sob banco lento o insert não
// termina a tempo, o lock expira, e a próxima execução reprocessa as MESMAS
// contas do zero (foi exatamente essa cascata que gerou 667k linhas em
// 2026-07-26). Limitando o lote, cada execução termina rápido e sobra
// sempre para o próximo ciclo de 5 min continuar de onde parou.
const MAX_NEW_ACCOUNTS_PER_RUN = 5;

// TTL do lock DEVE ter margem folgada acima do schedule do cron (10 min).
// Causa raiz da recaída de 2026-07-27 (campanha afeffe3a, 51k+ linhas): TTL
// era exatamente igual ao intervalo do cron. Quando uma execução demorava
// mais que 10 min (comum: enrolledRows escaneava TODA a campanha, que só
// cresce), a invocação seguinte via o lock como "expirado" e reprocessava a
// MESMA campanha em paralelo com a execução anterior ainda rodando — as duas
// liam o mesmo estado "não matriculado" e inseriam o mesmo lote duas vezes,
// ciclo que se auto-alimenta (campanha maior → scan mais lento → mais overlap).
const LOCK_TTL_MINUTES = 30;

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

      const folderAccountIds = folderAccounts.map(a => a.id);

      // Contas já matriculadas nesta campanha (qualquer post já criado para ela).
      // Escopado com .in(account_id, folderAccountIds) em vez de escanear TODA a
      // campanha por campaign_id: a campanha só cresce (chega a dezenas de
      // milhares de linhas), então um scan completo a cada execução ficava cada
      // vez mais lento — a raiz do bug de 2026-07-27 (ver LOCK_TTL_MINUTES acima).
      // Escopar pelas contas da pasta mantém a query com tamanho fixo e pequeno.
      const { data: enrolledRows, error: enrolledErr } = await admin
        .from("scheduled_posts")
        .select("account_id")
        .eq("campaign_id", campaign.id)
        .in("account_id", folderAccountIds);

      if (enrolledErr) {
        // NUNCA tratar erro de query como "ninguém matriculado ainda" — isso
        // reinsere contas que já têm posts. Pula a campanha neste ciclo e
        // tenta de novo no próximo (o lock já foi liberado no finally).
        console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: falha ao checar contas matriculadas, pulando ciclo: ${enrolledErr.message}`);
        continue;
      }

      const enrolledIds = new Set((enrolledRows ?? []).map((r: { account_id: string }) => r.account_id));
      const allNewAccountIds = folderAccountIds.filter(id => !enrolledIds.has(id));
      if (!allNewAccountIds.length) continue;

      // Só uma fatia por execução — o restante fica para o próximo ciclo.
      const newAccountIds = allNewAccountIds.slice(0, MAX_NEW_ACCOUNTS_PER_RUN);

      await processNewAccounts(admin, campaign, newAccountIds);
      totalEnrolled += newAccountIds.length;
      if (allNewAccountIds.length > newAccountIds.length) {
        console.log(`[sync-distribute-accounts] Campanha ${campaign.id}: +${newAccountIds.length} agora, ${allNewAccountIds.length - newAccountIds.length} restante(s) para o próximo ciclo.`);
      }
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

    // Pool compartilhado (mesmo esquema "quadrado latino" do distribute/route.ts):
    // garante que, na mesma rodada, as contas novas não repitam vídeo entre si.
    const globalUsage = (videoId: string) => {
      let total = 0;
      for (const accountId of newAccountIds) total += postedCount.get(accountId)?.get(videoId) ?? 0;
      return total;
    };
    const sharedPool = fisherYates(allVideos).sort((a, b) => globalUsage(a.id) - globalUsage(b.id));
    const poolSize = sharedPool.length;

    const rows: object[] = [];

    newAccountIds.forEach((accountId, ai) => {
      const staggerMs = campaign.burst_mode
        ? ai * burstBlockMs
        : campaign.account_stagger_seconds
          ? ai * campaign.account_stagger_seconds * 1_000
          : ai * autoStaggerPerAccountMs;

      const accountVideos = Array.from({ length: maxVideos }, (_, vi) => sharedPool[(ai + vi) % poolSize]);

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
