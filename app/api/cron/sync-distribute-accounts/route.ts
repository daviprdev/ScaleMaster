/**
 * /api/cron/sync-distribute-accounts
 *
 * Campanhas criadas na aba Postar com "Sincronizar com pasta de contas" ativo
 * ganham uma linha em distribute_campaigns. Este cron roda a cada 5 min e,
 * para cada uma delas, garante que toda conta atualmente na(s) pasta(s)
 * vigiada(s) tenha exatamente 1 post em voo por vez — igual ao modo pasta do
 * Loop (process-loops.ts): cada conta tem seu próprio relógio (isDue = agora
 * >= último post desta campanha + intervalo) e recebe UM post por ciclo, não
 * um lote inteiro pré-agendado.
 *
 * Refactor 2026-07-29: antes, contas novas detectadas na pasta recebiam de
 * uma vez um lote de `video_count` posts (todo o futuro já agendado). Esse
 * modelo de "matrícula em lote" causou 3 incidentes documentados em produção
 * (667k linhas em 26/06, 51k+ linhas em 27/07, campanha duplicada 8x em
 * 22/07) e, confirmado nos logs da Vercel, 102 timeouts de 60s + 52 falhas de
 * "schema cache" no cron em 30 dias. Contas do lote clássico (matriculadas na
 * criação da campanha, em app/api/posts/distribute/route.ts) continuam
 * intocadas — só o mecanismo de conta nova entrando DEPOIS muda.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAutoCaption, type AutoCaptionType } from "@/lib/auto-captions";
import { normalizeCaptionMode, resolveCaption } from "@/lib/reel-captions";
import { normalizeProcessingMode } from "@/lib/video-processing";
import { fetchVideoUsage, fetchAllRows } from "@/lib/video-history";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  assignVideos as priorityAssignVideos,
  normalizePriorityStrategy,
} from "@/lib/media-priority";

export const runtime = "nodejs";
export const maxDuration = 90;

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
  caption_mode: string | null;
  caption_strip_hashtags: boolean | null;
  caption_strip_mentions: boolean | null;
  account_stagger_seconds: number | null;
  burst_mode: boolean;
  video_processing_mode: string | null;
  share_to_feed: boolean | null;
}

interface AccountState {
  account_id: string;
  total_count: number;
  inflight_count: number;
  last_scheduled_at: string | null;
}

export async function GET(req: NextRequest) {
  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;

  const admin = getSupabaseAdmin();

  const { data: campaigns, error } = await admin
    .from("distribute_campaigns")
    .select("id, user_id, account_folder_ids, video_folder_id, video_count, posts_per_day, captions, auto_caption_enabled, auto_caption_type, caption_mode, caption_strip_hashtags, caption_strip_mentions, account_stagger_seconds, burst_mode, video_processing_mode, share_to_feed");

  if (error) {
    console.error("[sync-distribute-accounts] Erro ao buscar campanhas:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const watched = ((campaigns ?? []) as DistributeCampaignRow[]).filter(c => c.account_folder_ids?.length > 0 && !c.burst_mode);
  if (!watched.length) return NextResponse.json({ posts_created: 0, campaigns: 0 });

  let totalCreated = 0;

  for (const campaign of watched) {
    // Isolamento por campanha: uma exceção aqui NÃO deve impedir o
    // processamento das campanhas seguintes da lista neste ciclo (bug real do
    // modelo antigo — try/finally sem catch deixava o array inteiro parado).
    try {
      const created = await processCampaign(admin, campaign);
      totalCreated += created;
    } catch (e) {
      console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: exceção não tratada, pulando para a próxima:`, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ posts_created: totalCreated, campaigns: watched.length });
}

async function processCampaign(
  admin: ReturnType<typeof getSupabaseAdmin>,
  campaign: DistributeCampaignRow
): Promise<number> {
  // Contas atualmente nas pastas vigiadas por esta campanha — resolvida a
  // cada ciclo (dinâmico, sem matrícula): conta nova aparece aqui sozinha no
  // próximo ciclo, sem nenhuma etapa de "detecção".
  const { data: folderAccounts, error: accErr } = await admin
    .from("instagram_accounts")
    .select("id")
    .in("folder_id", campaign.account_folder_ids)
    .eq("user_id", campaign.user_id)
    .eq("is_active", true)
    .neq("health_status", "error");

  if (accErr) {
    console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: falha ao buscar contas da pasta, pulando ciclo: ${accErr.message}`);
    return 0;
  }
  if (!folderAccounts?.length) return 0;

  const accountIds = folderAccounts.map(a => a.id);

  // Paginado: `.limit(10000)` não bypassa o teto de 1000 linhas do PostgREST —
  // pastas grandes teriam o excedente ignorado em silêncio no pool.
  let allVideos: { id: string; public_url: string; caption: string | null; views: number }[];
  try {
    allVideos = await fetchAllRows<{ id: string; public_url: string; caption: string | null; views: number }>((from, to) =>
      admin
        .from("videos_library")
        .select("id, public_url, caption, views")
        .eq("folder_id", campaign.video_folder_id)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: falha ao buscar vídeos da pasta, pulando ciclo: ${(e as Error).message}`);
    return 0;
  }
  if (!allVideos.length) return 0;

  const maxVideos = campaign.video_count === -1
    ? allVideos.length
    : Math.min(campaign.video_count, allVideos.length);

  // Estado por conta em 1 única query agregada — substitui o scan de
  // histórico linha a linha (arriscado para contas do lote clássico, que
  // podem ter milhares de posts pré-agendados).
  const { data: states, error: statesErr } = await (admin as any)
    .rpc("get_distribute_account_states", { p_campaign_id: campaign.id, p_account_ids: accountIds });

  if (statesErr) {
    console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: falha ao buscar estado das contas, pulando ciclo: ${statesErr.message}`);
    return 0;
  }

  const stateByAccount = new Map<string, AccountState>();
  for (const s of (states ?? []) as AccountState[]) stateByAccount.set(s.account_id, s);

  const intervalMs = Math.max(1, Math.floor((24 * 60) / campaign.posts_per_day)) * 60_000;
  const now = Date.now();

  const dueAccountIds: string[] = [];
  for (const accountId of accountIds) {
    const state = stateByAccount.get(accountId);

    // Já tem post pendente/publicando para esta campanha — equivalente ao
    // containerAlreadyExists do Loop, nunca cria um segundo em cima.
    if (state && state.inflight_count > 0) continue;

    // Conta já atingiu o teto de vídeos desta campanha.
    if (state && state.total_count >= maxVideos) continue;

    const isDue = !state?.last_scheduled_at || (now - new Date(state.last_scheduled_at).getTime() >= intervalMs);
    if (isDue) dueAccountIds.push(accountId);
  }

  if (!dueAccountIds.length) return 0;

  // Anti-burst: se várias contas ficarem due no mesmo ciclo (ex.: pasta
  // grande sincronizada pela primeira vez), espalha o scheduled_at em vez de
  // criar tudo em `now` — mesmo princípio do Loop, evita "too many actions".
  const staggerPerAccountMs = dueAccountIds.length > 1
    ? Math.min(5 * 60_000, Math.floor((intervalMs * 0.9) / (dueAccountIds.length - 1)))
    : 0;

  const isAutoCaption = !!campaign.auto_caption_enabled && !!campaign.auto_caption_type;
  const captionMode = normalizeCaptionMode(campaign.caption_mode);
  const validCaptions = (campaign.captions ?? []).filter(c => c.trim());
  const autoType = (campaign.auto_caption_type ?? "curiosidades-gerais") as AutoCaptionType;

  // Histórico de vídeos só das contas due neste ciclo — nunca das contas do
  // lote clássico (que ficam de fora de dueAccountIds por já terem posts em
  // voo). Cada conta due tem no máximo maxVideos posts, então esta query é
  // sempre pequena, ao contrário de um scan pela campanha inteira.
  // Via RPC agregado (lib/video-history): imune ao teto de 1000 linhas do
  // PostgREST e — diferente do select por campaign_id que ficava aqui —
  // atravessa TODAS as origens (Loop, Postar, Clonar, Automatizar). Restrito à
  // campanha, a conta repetia na campanha nova o que já tinha postado por
  // outras abas.
  let usage: Awaited<ReturnType<typeof fetchVideoUsage>>;
  try {
    usage = await fetchVideoUsage(admin, dueAccountIds);
  } catch (e) {
    console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: ${(e as Error).message} — pulando ciclo.`);
    return 0;
  }

  // Atribuição centralizada via media-priority: lê priority_strategy da campanha
  // (default 'least_usage' para campanhas existentes). Seed determinística por
  // ciclo para que retries reproduzam a mesma atribuição.
  const campaignStrategy = normalizePriorityStrategy(
    (campaign as unknown as Record<string, unknown>).priority_strategy as string | undefined,
  );
  const cycleSeed = `${campaign.id}:${now}`;
  const priorityResults = priorityAssignVideos({
    candidates: allVideos.map((v) => ({
      id: v.id,
      views: v.views ?? 0,
      public_url: v.public_url,
      caption: v.caption,
    })),
    accountIds: dueAccountIds,
    usageByAccount: usage,
    windowClaims: new Set(),
    recentGlobalCooldown: new Set(),
    strategy: campaignStrategy,
    seed: cycleSeed,
  });

  const videoById = new Map(allVideos.map((v) => [v.id, v]));
  const rows: object[] = [];

  priorityResults.forEach((assigned, i) => {
    const video = videoById.get(assigned.video.id);
    if (!video) return; // segurança: candidato desapareceu entre fetch e atribuição

    const staggerMs = campaign.account_stagger_seconds != null
      ? i * campaign.account_stagger_seconds * 1_000
      : i * staggerPerAccountMs;
    const scheduledAt = new Date(now + staggerMs).toISOString();
    const customCaption = isAutoCaption
      ? getAutoCaption(autoType)
      : validCaptions.length > 0
        ? validCaptions[Math.floor(Math.random() * validCaptions.length)]
        : "";

    // Mesma resolução do distribute: o vídeo já está escolhido, então a
    // legenda sai do próprio vídeo quando o modo é "original". Legenda acima
    // do limite da Meta não é cortada — a conta apenas não é matriculada
    // neste ciclo, e o motivo fica no log.
    const resolucao = resolveCaption({
      mode: captionMode,
      originalCaption: video.caption,
      customCaption,
      stripHashtags: campaign.caption_strip_hashtags === true,
      stripMentions: campaign.caption_strip_mentions === true,
    });
    if (!resolucao.validation.valid) {
      console.error(
        "[sync-distribute] campanha " + campaign.id.slice(0, 8) +
        " conta " + assigned.accountId.slice(0, 8) + ": " + resolucao.validation.error?.code +
        " (chars=" + resolucao.length + " hashtags=" + resolucao.hashtags +
        " mentions=" + resolucao.mentions + ") — conta não matriculada."
      );
      return;
    }

    rows.push({
      user_id: campaign.user_id,
      account_id: assigned.accountId,
      video_id: video.id,
      video_url: video.public_url,
      caption: resolucao.caption,
      caption_mode: captionMode,
      scheduled_at: scheduledAt,
      status: "pending",
      campaign_id: campaign.id,
      // Conta nova matriculada herda a decisao da campanha (congelada por post).
      video_processing_mode: normalizeProcessingMode(campaign.video_processing_mode),
      share_to_feed: typeof campaign.share_to_feed === "boolean" ? campaign.share_to_feed : null,
    });
  });

  if (rows.length === 0) return 0;

  const { error: insErr } = await admin.from("scheduled_posts").insert(rows);
  if (insErr) {
    console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: falha ao inserir ${rows.length} post(s):`, insErr.message);
    return 0;
  }

  console.log(`[sync-distribute-accounts] Campanha ${campaign.id}: +${rows.length} post(s) criado(s) (1 por conta due).`);
  return rows.length;
}
