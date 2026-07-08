/**
 * /api/cron/process-automations
 *
 * Motor de automação: roda a cada minuto e enfileira posts em scheduled_posts
 * para cada automação ativa. Cada automação usa campaign_id = automation.id
 * para rastrear os posts gerados.
 *
 * Lógica por conta:
 *  - Intervalo entre posts = floor(1440 / posts_per_day) minutos
 *  - Janela de look-ahead = próximas 24h
 *  - Se count de posts na janela < posts_per_day → cria o próximo post
 *  - next_scheduled_at = max(now, last_scheduled_at + interval) + stagger dinâmico
 *    (intervalo ÷ nº de contas, com jitter ±30% — offset_seconds não é mais usado)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAutoCaption } from "@/lib/auto-captions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[process-automations] AVISO: CRON_SECRET não configurado.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();

  // Busca automações ativas com suas relações
  const { data: automations, error } = await admin
    .from("automations")
    .select("id, user_id, name, posts_per_day, captions, active, auto_caption_enabled, auto_caption_type")
    .eq("active", true);

  if (error) {
    console.error("[process-automations] Erro ao buscar automações:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!automations || automations.length === 0) {
    return NextResponse.json({ skipped: true, reason: "Nenhuma automação ativa." });
  }

  let totalCreated = 0;
  const RUN_BUDGET_MS = 50_000;
  const runStart = Date.now();

  for (const automation of automations) {
    if (Date.now() - runStart > RUN_BUDGET_MS) break;

    const intervalMin = Math.max(1, Math.floor(1440 / automation.posts_per_day));
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // Busca pastas de contas desta automação
    const { data: aFolders } = await admin
      .from("automation_account_folders")
      .select("folder_id")
      .eq("automation_id", automation.id);

    // Busca pastas de vídeos desta automação
    const { data: vFolders } = await admin
      .from("automation_video_folders")
      .select("folder_id")
      .eq("automation_id", automation.id);

    if (!aFolders?.length || !vFolders?.length) continue;

    const accountFolderIds = aFolders.map((f) => f.folder_id);
    const videoFolderIds   = vFolders.map((f) => f.folder_id);

    // Busca contas das pastas selecionadas (health_status != error)
    const { data: accounts } = await admin
      .from("instagram_accounts")
      .select("id, username, meta_access_token, ig_business_account_id")
      .in("folder_id", accountFolderIds)
      .neq("health_status", "error")
      .not("meta_access_token", "is", null);

    if (!accounts?.length) continue;

    // Busca vídeos das pastas de vídeos
    // (.limit explícito — o padrão do Supabase corta em 1000 linhas e pastas
    //  grandes teriam parte dos vídeos silenciosamente ignorada)
    const { data: videos } = await admin
      .from("videos_library")
      .select("id, public_url")
      .in("folder_id", videoFolderIds)
      .eq("user_id", automation.user_id)
      .not("public_url", "is", null)
      .limit(10000);

    if (!videos?.length) continue;

    // Para cada conta, verifica quantos posts estão na janela das próximas 24h
    const { data: existingPosts } = await admin
      .from("scheduled_posts")
      .select("account_id, scheduled_at")
      .eq("campaign_id", automation.id)
      .in("status", ["pending", "publishing", "published"])
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", windowEnd)
      .limit(100000);

    const countByAccount: Record<string, number> = {};
    const lastByAccount: Record<string, Date>   = {};
    for (const p of (existingPosts ?? [])) {
      countByAccount[p.account_id] = (countByAccount[p.account_id] ?? 0) + 1;
      const t = new Date(p.scheduled_at);
      if (!lastByAccount[p.account_id] || t > lastByAccount[p.account_id]) {
        lastByAccount[p.account_id] = t;
      }
    }

    // Só busca histórico para contas que realmente precisam de post neste run.
    // Em regime, isso é 1–3 contas por minuto — sem esse filtro, o histórico
    // COMPLETO de todas as contas (200 contas × 12/dia = 100k linhas em ~40
    // dias, teto do .limit) trafegava a cada minuto e truncava silenciosamente,
    // quebrando o anti-repetição sem aviso.
    const needyIds = accounts
      .filter((a) => (countByAccount[a.id] ?? 0) < automation.posts_per_day)
      .map((a) => a.id);
    if (!needyIds.length) continue;

    // Histórico por conta atravessando TODAS as origens: Postar/Clonar/
    // Automatizar (scheduled_posts) + Loop (pending_containers).
    // Janela de 90 dias: cobre mais de um ciclo completo da pasta (pool de 500
    // vídeos a 12/dia = ~42 dias/ciclo); além disso o pool já reinicia sozinho.
    const accountIds = accounts.map((a) => a.id);
    const repeatCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    // Uso global: só o passado recente importa — o balanceamento existe para o
    // mesmo vídeo não sair em várias contas QUASE AO MESMO TEMPO. 7 dias mantém
    // a query pequena mesmo com 200 contas (16k linhas vs 100k+ sem janela).
    const usageCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: spRepeat }, { data: pcRepeat },
      { data: spUsage },  { data: pcUsage },
    ] = await Promise.all([
      admin
        .from("scheduled_posts")
        .select("account_id, video_id")
        .in("account_id", needyIds)
        .not("video_id", "is", null)
        .in("status", ["pending", "publishing", "published"])
        .gte("created_at", repeatCutoff)
        .limit(100000),
      admin
        .from("pending_containers")
        .select("account_id, video_id")
        .in("account_id", needyIds)
        .not("video_id", "is", null)
        .neq("status", "error")
        .gte("created_at", repeatCutoff)
        .limit(100000),
      admin
        .from("scheduled_posts")
        .select("account_id, video_id")
        .in("account_id", accountIds)
        .not("video_id", "is", null)
        .in("status", ["pending", "publishing", "published"])
        .gte("created_at", usageCutoff)
        .limit(100000),
      admin
        .from("pending_containers")
        .select("account_id, video_id")
        .in("account_id", accountIds)
        .not("video_id", "is", null)
        .neq("status", "error")
        .gte("created_at", usageCutoff)
        .limit(100000),
    ]);

    // Anti-repetição por conta (só contas precisando de post, janela 90d)
    const postedByAccount: Record<string, Set<string>> = {};
    for (const p of [...(spRepeat ?? []), ...(pcRepeat ?? [])]) {
      if (!postedByAccount[p.account_id]) postedByAccount[p.account_id] = new Set();
      postedByAccount[p.account_id].add(p.video_id);
    }

    // Uso global por vídeo (todas as contas, janela 7d): base do balanceamento
    // que impede o mesmo vídeo de aparecer em várias contas enquanto outros
    // ficam parados.
    const usageByVideo: Record<string, number> = {};
    for (const p of [...(spUsage ?? []), ...(pcUsage ?? [])]) {
      usageByVideo[p.video_id] = (usageByVideo[p.video_id] ?? 0) + 1;
    }

    // Captions disponíveis
    const captionPool = automation.captions?.filter((c: string) => c.trim()) ?? [];

    // Stagger dinâmico: distribui as contas uniformemente dentro de UM ciclo
    // do intervalo (intervalo ÷ nº de contas), em vez do offset_seconds fixo.
    // Offset fixo de 5 min com 200 contas jogava a última pra +16h40 no
    // arranque; offset pequeno criava rajada de 200 posts a cada ciclo.
    // Ex.: 2h com 200 contas → 1 post a cada ~36s, constante, sem rajadas.
    // Jitter ±30% de um passo quebra a periodicidade perfeita (anti-bot).
    // Mesma lógica do process-loops desde 2026-06.
    const staggerBaseMs = Math.max(5, (intervalMin * 60) / accounts.length) * 1000;

    // Cria posts necessários para cada conta
    const inserts: Record<string, unknown>[] = [];
    accounts.forEach((account, accountIdx) => {
      const currentCount = countByAccount[account.id] ?? 0;
      if (currentCount >= automation.posts_per_day) return;

      const jitterMs = (Math.random() * 0.6 - 0.3) * staggerBaseMs;
      const accountStaggerMs = Math.max(0, accountIdx * staggerBaseMs + jitterMs);
      const lastAt = lastByAccount[account.id];

      // Próximo scheduled_at
      let nextAt: Date;
      if (lastAt) {
        nextAt = new Date(lastAt.getTime() + intervalMin * 60 * 1000);
        if (nextAt < now) nextAt = new Date(now.getTime() + accountStaggerMs);
      } else {
        nextAt = new Date(now.getTime() + accountStaggerMs + 60_000); // +1min mínimo
      }

      // Seleção em duas camadas:
      //  1. Exclui o histórico da própria conta (nunca repete vídeo na mesma
      //     conta até esgotar a pasta — aí o ciclo reinicia).
      //  2. Entre os disponíveis, escolhe aleatoriamente entre os de MENOR uso
      //     global na automação. Sem isso, sorteio independente por conta faz o
      //     mesmo vídeo sair em várias contas quase ao mesmo tempo enquanto
      //     outros da pasta ficam dias sem uso.
      const posted = postedByAccount[account.id] ?? new Set<string>();
      const available = videos.filter((v) => !posted.has(v.id));
      const pool = available.length > 0 ? available : videos;
      const minUse = Math.min(...pool.map((v) => usageByVideo[v.id] ?? 0));
      const leastUsed = pool.filter((v) => (usageByVideo[v.id] ?? 0) === minUse);
      const video = leastUsed[Math.floor(Math.random() * leastUsed.length)];
      // Incrementa em memória para que as próximas contas DESTE run já vejam o
      // vídeo como usado (sem isso, todas sorteariam do mesmo grupo min-use).
      usageByVideo[video.id] = (usageByVideo[video.id] ?? 0) + 1;
      posted.add(video.id);
      postedByAccount[account.id] = posted;

      // Caption: automática ou do pool manual
      const caption = automation.auto_caption_enabled && automation.auto_caption_type
        ? getAutoCaption(automation.auto_caption_type as "curiosidades-gerais" | "curiosidades-tops" | "fatos-complexos")
        : captionPool.length
          ? captionPool[Math.floor(Math.random() * captionPool.length)]
          : "";

      inserts.push({
        user_id:      automation.user_id,
        video_id:     video.id,
        video_url:    video.public_url,
        account_id:   account.id,
        caption,
        scheduled_at: nextAt.toISOString(),
        status:       "pending",
        campaign_id:  automation.id,
        post_type:    "reel",
      });
    });

    if (inserts.length) {
      const { error: insertErr } = await admin.from("scheduled_posts").insert(inserts);
      if (insertErr) {
        console.error(`[process-automations] Erro ao inserir posts para automação ${automation.name}:`, insertErr.message);
      } else {
        totalCreated += inserts.length;
        console.log(`[process-automations] ✓ ${inserts.length} posts criados para "${automation.name}"`);
      }
    }
  }

  return NextResponse.json({ created: totalCreated, automations: automations.length });
}
