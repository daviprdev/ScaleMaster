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
 *  - next_scheduled_at = max(now, last_scheduled_at + interval) + account_stagger
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
    .select("id, user_id, name, posts_per_day, offset_seconds, captions, active, auto_caption_enabled, auto_caption_type")
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
    const { data: videos } = await admin
      .from("videos_library")
      .select("id, public_url")
      .in("folder_id", videoFolderIds)
      .eq("user_id", automation.user_id)
      .not("public_url", "is", null);

    if (!videos?.length) continue;

    // Para cada conta, verifica quantos posts estão na janela das próximas 24h
    const { data: existingPosts } = await admin
      .from("scheduled_posts")
      .select("account_id, scheduled_at")
      .eq("campaign_id", automation.id)
      .in("status", ["pending", "publishing", "published"])
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", windowEnd);

    const countByAccount: Record<string, number> = {};
    const lastByAccount: Record<string, Date>   = {};
    for (const p of (existingPosts ?? [])) {
      countByAccount[p.account_id] = (countByAccount[p.account_id] ?? 0) + 1;
      const t = new Date(p.scheduled_at);
      if (!lastByAccount[p.account_id] || t > lastByAccount[p.account_id]) {
        lastByAccount[p.account_id] = t;
      }
    }

    // Captions disponíveis
    const captionPool = automation.captions?.filter((c: string) => c.trim()) ?? [];

    // Cria posts necessários para cada conta
    const inserts: Record<string, unknown>[] = [];
    accounts.forEach((account, accountIdx) => {
      const currentCount = countByAccount[account.id] ?? 0;
      if (currentCount >= automation.posts_per_day) return;

      const accountStaggerMs = accountIdx * automation.offset_seconds * 1000;
      const lastAt = lastByAccount[account.id];

      // Próximo scheduled_at
      let nextAt: Date;
      if (lastAt) {
        nextAt = new Date(lastAt.getTime() + intervalMin * 60 * 1000);
        if (nextAt < now) nextAt = new Date(now.getTime() + accountStaggerMs);
      } else {
        nextAt = new Date(now.getTime() + accountStaggerMs + 60_000); // +1min mínimo
      }

      // Vídeo aleatório
      const video = videos[Math.floor(Math.random() * videos.length)];

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
