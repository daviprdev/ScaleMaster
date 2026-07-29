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

export const runtime = "nodejs";
export const maxDuration = 90;

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

interface AccountState {
  account_id: string;
  total_count: number;
  inflight_count: number;
  last_scheduled_at: string | null;
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

  const { data: allVideos, error: vidErr } = await admin
    .from("videos_library")
    .select("id, public_url")
    .eq("folder_id", campaign.video_folder_id)
    .order("created_at", { ascending: true })
    .limit(10000);

  if (vidErr) {
    console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: falha ao buscar vídeos da pasta, pulando ciclo: ${vidErr.message}`);
    return 0;
  }
  if (!allVideos?.length) return 0;

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
  const validCaptions = (campaign.captions ?? []).filter(c => c.trim());
  const autoType = (campaign.auto_caption_type ?? "curiosidades-gerais") as AutoCaptionType;

  // Histórico de vídeos só das contas due neste ciclo — nunca das contas do
  // lote clássico (que ficam de fora de dueAccountIds por já terem posts em
  // voo). Cada conta due tem no máximo maxVideos posts, então esta query é
  // sempre pequena, ao contrário de um scan pela campanha inteira.
  const { data: historyRows, error: histErr } = await admin
    .from("scheduled_posts")
    .select("account_id, video_id")
    .eq("campaign_id", campaign.id)
    .in("account_id", dueAccountIds)
    .not("video_id", "is", null)
    .in("status", ["pending", "publishing", "published"]);

  if (histErr) {
    console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: falha ao buscar histórico de vídeos, pulando ciclo: ${histErr.message}`);
    return 0;
  }

  // Mesmo critério de seleção do modo pasta do Loop (assignVideosForLoop):
  // pool individual por conta (exclui só o que ELA já postou) + desempate
  // pelo vídeo de menor uso GLOBAL entre as contas due agora — evita que duas
  // contas due no mesmo ciclo recebam o mesmo vídeo.
  const postedByAccount = new Map<string, Set<string>>();
  const usageByVideo = new Map<string, number>();
  for (const row of (historyRows ?? []) as { account_id: string; video_id: string }[]) {
    let set = postedByAccount.get(row.account_id);
    if (!set) { set = new Set(); postedByAccount.set(row.account_id, set); }
    if (!set.has(row.video_id)) {
      set.add(row.video_id);
      usageByVideo.set(row.video_id, (usageByVideo.get(row.video_id) ?? 0) + 1);
    }
  }

  const shuffledVideos = fisherYates(allVideos);
  const rows: object[] = [];

  dueAccountIds.forEach((accountId, i) => {
    const posted = postedByAccount.get(accountId) ?? new Set<string>();
    const available = shuffledVideos.filter(v => !posted.has(v.id));
    if (available.length === 0) return; // esgotou o pool sem atingir maxVideos — defensivo, não deveria ocorrer

    const minUse = Math.min(...available.map(v => usageByVideo.get(v.id) ?? 0));
    const leastUsed = available.filter(v => (usageByVideo.get(v.id) ?? 0) === minUse);
    const video = leastUsed[Math.floor(Math.random() * leastUsed.length)];
    usageByVideo.set(video.id, (usageByVideo.get(video.id) ?? 0) + 1);

    const staggerMs = campaign.account_stagger_seconds != null
      ? i * campaign.account_stagger_seconds * 1_000
      : i * staggerPerAccountMs;
    const scheduledAt = new Date(now + staggerMs).toISOString();
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

  if (rows.length === 0) return 0;

  const { error: insErr } = await admin.from("scheduled_posts").insert(rows);
  if (insErr) {
    console.error(`[sync-distribute-accounts] Campanha ${campaign.id}: falha ao inserir ${rows.length} post(s):`, insErr.message);
    return 0;
  }

  console.log(`[sync-distribute-accounts] Campanha ${campaign.id}: +${rows.length} post(s) criado(s) (1 por conta due).`);
  return rows.length;
}
