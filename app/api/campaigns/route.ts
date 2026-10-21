import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAutoCaption, AUTO_CAPTION_TYPES, type AutoCaptionType } from "@/lib/auto-captions";
import { fetchAllRows } from "@/lib/video-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cache curto do engagement por conta: o Postar faz polling a cada 15 s e as
// views só mudam a cada rodada do sync (5 min). Sem ele, cada poll relia todos
// os posts publicados das campanhas, em páginas de 1000.
const ENGAGEMENT_CACHE_MS = 60_000;
const engagementCache = new Map<string, { at: number; rows: any[] }>();

interface RpcRow {
  campaign_id: string;
  total: number;
  published: number;
  pending: number;
  failed: number;
  cancelled: number;
  first_slot: string;
  last_slot: string;
  next_pending: string | null;
  last_published_at: string | null;
  last_error_message: string | null;
  created_at: string;
  account_ids: string[];
  clone_source_profile: string | null;
  is_clone: boolean;
}

interface AccountEngagement {
  account_id: string;
  username: string;
  avatar_url: string | null;
  total_plays: number;
  total_likes: number;
  total_comments: number;
  total_reach: number;
  published_count: number;
  /** Posts com pelo menos uma leitura de insights (≠ views 0). */
  synced_posts: number;
  /** Leitura mais recente entre os posts da conta (null = nenhum lido ainda). */
  last_read_at: string | null;
  /** Posts cuja última leitura veio < 30 min após publicar (números de primeiros minutos). */
  early_only: number;
}

interface CampaignSummary extends RpcRow {
  campaign_status: "running" | "paused" | "completed";
  paused_at: string | null;
  is_automation: boolean;
  is_synced: boolean;
  synced_folder_names: string[];
  account_engagement?: AccountEngagement[];
  total_plays?: number;
  total_likes?: number;
  total_comments?: number;
  total_reach?: number;
}

export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ campaigns: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const postTypeFilter = searchParams.get("post_type"); // "reel" | "story" | null (todos)

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  // Usa RPC para agregar server-side — evita o hard cap de 1000 linhas do PostgREST
  const { data, error } = await (admin as any)
    .rpc("get_campaign_summaries", { p_user_id: user.id });

  if (error) {
    if (error.code === "42703" || error.message?.includes("campaign_id") ||
        error.code === "42883" || error.message?.includes("get_campaign_summaries")) {
      return NextResponse.json({ campaigns: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Automatizar usa campaign_id = automation.id — marca essas linhas para que
  // a lista de Campanhas Ativas (aba Postar) possa exibi-las separadas ou ocultá-las
  const automationIds = new Set<string>();
  {
    const { data: autoRows } = await (admin as any)
      .from("automations")
      .select("id")
      .eq("user_id", user.id);
    for (const r of (autoRows ?? []) as { id: string }[]) automationIds.add(r.id);
  }

  // Campanhas do Postar sincronizadas com pasta(s) de contas — contas novas
  // entram sozinhas via cron sync-distribute-accounts. Toda campanha do Postar
  // tem linha em distribute_campaigns (desde a atomicidade), mas só as com
  // pasta(s) em account_folder_ids são de fato sincronizadas.
  // A mesma leitura traz as campanhas pausadas pelo usuário.
  const syncedFolderNames = new Map<string, string[]>();
  const pausedAt = new Map<string, string | null>();
  {
    const { data: distRows } = await (admin as any)
      .from("distribute_campaigns")
      .select("id, account_folder_ids, status, paused_at")
      .eq("user_id", user.id);
    type DistRow = { id: string; account_folder_ids: string[] | null; status: string | null; paused_at: string | null };
    for (const r of (distRows ?? []) as DistRow[]) {
      if (r.status === "paused") pausedAt.set(r.id, r.paused_at);
    }
    const syncRows = ((distRows ?? []) as DistRow[]).filter(r => (r.account_folder_ids ?? []).length > 0);
    if (syncRows.length) {
      const allFolderIds = Array.from(new Set(syncRows.flatMap(r => r.account_folder_ids ?? [])));
      let folderNameById = new Map<string, string>();
      if (allFolderIds.length) {
        const { data: folderRows } = await (admin as any)
          .from("account_folders")
          .select("id, name")
          .in("id", allFolderIds);
        folderNameById = new Map((folderRows ?? []).map((f: { id: string; name: string }) => [f.id, f.name]));
      }
      for (const r of syncRows) {
        syncedFolderNames.set(r.id, (r.account_folder_ids ?? []).map(fid => folderNameById.get(fid) ?? "?"));
      }
    }
  }

  // Ordem na lista: executando → pausadas → concluídas.
  const STATUS_ORDER = { running: 0, paused: 1, completed: 2 } as const;

  let campaigns: CampaignSummary[] = ((data as RpcRow[]) ?? []).map(row => ({
    ...row,
    total: Number(row.total),
    published: Number(row.published),
    pending: Number(row.pending),
    failed: Number(row.failed),
    cancelled: Number(row.cancelled),
    account_ids: row.account_ids ?? [],
    // Pausa é escolha explícita do usuário: vale mesmo sem posts pendentes
    // (numa campanha sincronizada ela também segura a matrícula de contas novas).
    campaign_status: (
      pausedAt.has(row.campaign_id) ? "paused" : Number(row.pending) > 0 ? "running" : "completed"
    ) as CampaignSummary["campaign_status"],
    paused_at: pausedAt.get(row.campaign_id) ?? null,
    is_automation: automationIds.has(row.campaign_id),
    is_synced: syncedFolderNames.has(row.campaign_id),
    synced_folder_names: syncedFolderNames.get(row.campaign_id) ?? [],
  })).sort((a, b) => {
    if (a.campaign_status !== b.campaign_status) {
      return STATUS_ORDER[a.campaign_status] - STATUS_ORDER[b.campaign_status];
    }
    return new Date(b.first_slot ?? b.last_slot ?? 0).getTime() - new Date(a.first_slot ?? a.last_slot ?? 0).getTime();
  });

  // Filtra por post_type se solicitado — consulta quais campaign_ids têm o tipo indicado
  if (postTypeFilter && campaigns.length > 0) {
    const campaignIds = campaigns.map(c => c.campaign_id);
    const { data: typedRows } = await (admin as any)
      .from("scheduled_posts")
      .select("campaign_id")
      .eq("user_id", user.id)
      .eq("post_type", postTypeFilter)
      .in("campaign_id", campaignIds)
      .limit(campaignIds.length * 2);
    const storyIds = new Set<string>((typedRows ?? []).map((r: { campaign_id: string }) => r.campaign_id));
    campaigns = campaigns.filter(c => storyIds.has(c.campaign_id));
  }

  // Métricas de engagement por conta para cada campanha (views, likes, comments, reach)
  if (campaigns.length > 0) {
    const campaignIds = campaigns.map(c => c.campaign_id);
    // Paginado: sem `.range()` o PostgREST devolve só 1000 posts publicados e
    // campanhas grandes apareciam com views/likes subcontados, em silêncio.
    // Falha aqui não derruba a lista — as campanhas só saem sem engagement.
    let engRows: any[] = [];
    const cacheKey = `${user.id}:${[...campaignIds].sort().join(",")}`;
    const cached = engagementCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ENGAGEMENT_CACHE_MS) engRows = cached.rows;
    else try {
      engRows = await fetchAllRows((from, to) =>
        (admin as any)
          .from("scheduled_posts")
          .select(`
            campaign_id,
            account_id,
            insights_plays,
            insights_likes,
            insights_comments,
            insights_reach,
            insights_fetched_at,
            published_at,
            status,
            instagram_accounts!inner(id, username, avatar_url)
          `)
          .eq("user_id", user.id)
          .in("campaign_id", campaignIds)
          .eq("status", "published")
          .order("id", { ascending: true })
          .range(from, to)
      );
      for (const [key, entry] of engagementCache) {
        if (Date.now() - entry.at >= ENGAGEMENT_CACHE_MS) engagementCache.delete(key);
      }
      engagementCache.set(cacheKey, { at: Date.now(), rows: engRows });
    } catch (e) {
      console.error("[campaigns] engagement por conta falhou:", (e as Error).message);
    }

    // Leitura feita até 30 min após publicar = número de primeiros minutos
    // (o Reel ainda está subindo); conta separado para a UI avisar.
    const EARLY_READ_MS = 30 * 60_000;

    // Agrupa por campanha → conta
    const engMap = new Map<string, Map<string, AccountEngagement>>();
    for (const row of engRows) {
      const cid = row.campaign_id as string;
      const aid = row.account_id as string;
      if (!engMap.has(cid)) engMap.set(cid, new Map());
      const accMap = engMap.get(cid)!;
      if (!accMap.has(aid)) {
        const acc = row.instagram_accounts as { id: string; username: string; avatar_url: string | null };
        accMap.set(aid, {
          account_id: aid,
          username: acc?.username ?? "?",
          avatar_url: acc?.avatar_url ?? null,
          total_plays: 0, total_likes: 0, total_comments: 0, total_reach: 0,
          published_count: 0, synced_posts: 0,
          last_read_at: null, early_only: 0,
        });
      }
      const e = accMap.get(aid)!;
      e.published_count++;
      e.total_plays += row.insights_plays ?? 0;
      e.total_likes += row.insights_likes ?? 0;
      e.total_comments += row.insights_comments ?? 0;
      e.total_reach += row.insights_reach ?? 0;
      if (row.insights_fetched_at) {
        e.synced_posts++;
        const readMs = new Date(row.insights_fetched_at).getTime();
        if (!e.last_read_at || readMs > new Date(e.last_read_at).getTime()) {
          e.last_read_at = row.insights_fetched_at;
        }
        if (row.published_at && readMs - new Date(row.published_at).getTime() < EARLY_READ_MS) {
          e.early_only++;
        }
      }
    }

    // Injeta nas campanhas e calcula totais globais da campanha
    for (const camp of campaigns) {
      const accEng = engMap.get(camp.campaign_id);
      if (accEng && accEng.size > 0) {
        const list = Array.from(accEng.values()).sort((a, b) => b.total_plays - a.total_plays);
        camp.account_engagement = list;
        camp.total_plays = list.reduce((s, e) => s + e.total_plays, 0);
        camp.total_likes = list.reduce((s, e) => s + e.total_likes, 0);
        camp.total_comments = list.reduce((s, e) => s + e.total_comments, 0);
        camp.total_reach = list.reduce((s, e) => s + e.total_reach, 0);
      }
    }
  }

  return NextResponse.json({ campaigns });
}

export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("id");
  const hardDelete = searchParams.get("hard") === "true";

  if (!campaignId) {
    return NextResponse.json({ error: "Parâmetro id obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  if (hardDelete) {
    // Remove todas as linhas da campanha do banco (excluir histórico)
    const { error } = await (admin as any)
      .from("scheduled_posts")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // Apenas cancela os posts pendentes (cancelar campanha ativa)
    const { error } = await (admin as any)
      .from("scheduled_posts")
      .update({ status: "cancelled" })
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .in("status", ["pending", "publishing"]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Cancelar ou excluir a campanha encerra a sincronização com pasta — contas
  // novas adicionadas depois não devem mais ser matriculadas automaticamente.
  await (admin as any)
    .from("distribute_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}

interface EditCampaignBody {
  campaign_id?: string;
  /**
   * ATENÇÃO — nome colidente, conceito diferente: aqui `caption_mode` é o
   * seletor ANTIGO desta edição de campanha ("manual" = pool digitado,
   * "auto" = legenda gerada). Não confundir com a coluna
   * `distribute_campaigns.caption_mode` ("original" | "custom" | "none"),
   * que decide a FONTE do texto. Este campo só existe no corpo desta
   * requisição e nunca é gravado em coluna alguma.
   */
  caption_mode?: "manual" | "auto";
  captions?: string[];
  auto_caption_type?: string;
  posts_per_day?: number;
  account_stagger_seconds?: number | null;
}

const AUTO_CAPTION_TYPE_IDS = new Set(AUTO_CAPTION_TYPES.map(t => t.id as string));

// Edita uma campanha criada na aba Postar (distribuição em massa): troca o
// modo/pool de legendas e a cadência de postagem. Só se aplica a posts ainda
// 'pending' — posts 'publishing' (em voo no cron), 'published', 'failed' e
// 'cancelled' são histórico e não são tocados. A ordem relativa vídeo/conta
// de cada post pendente é preservada; só a legenda e o horário são
// recalculados a partir de agora com a nova cadência.
export async function PATCH(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => null) as EditCampaignBody | null;
  const campaignId = body?.campaign_id;
  if (!campaignId) return NextResponse.json({ error: "campaign_id é obrigatório." }, { status: 400 });

  if (body.caption_mode !== "manual" && body.caption_mode !== "auto") {
    return NextResponse.json({ error: "caption_mode deve ser 'manual' ou 'auto'." }, { status: 400 });
  }
  const isAutoCaption = body.caption_mode === "auto";

  const validCaptions = isAutoCaption ? [] : (body.captions ?? []).map(c => c.trim()).filter(Boolean);
  if (!isAutoCaption && validCaptions.length === 0) {
    return NextResponse.json({ error: "Informe ao menos uma legenda." }, { status: 400 });
  }
  if (isAutoCaption && !AUTO_CAPTION_TYPE_IDS.has(body.auto_caption_type ?? "")) {
    return NextResponse.json({ error: "Tipo de legenda automática inválido." }, { status: 400 });
  }

  const postsPerDay = body.posts_per_day;
  if (!postsPerDay || postsPerDay < 1 || postsPerDay > 1440) {
    return NextResponse.json({ error: "Posts por dia deve ser entre 1 e 1440." }, { status: 400 });
  }
  const staggerSeconds = body.account_stagger_seconds;
  if (staggerSeconds != null && (staggerSeconds < 0 || staggerSeconds > 3600)) {
    return NextResponse.json({ error: "Intervalo entre contas deve ser entre 0 e 3600s." }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  // Campanhas herdadas do módulo Automatizar (removido em 2026-09-06): o motor
  // delas não existe mais, então reagendar aqui não teria efeito. Continuam
  // legíveis no histórico, mas bloqueadas para edição.
  const { data: autoRow } = await (admin as any)
    .from("automations")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (autoRow) {
    return NextResponse.json({ error: "Campanhas de Automatizar não podem ser editadas aqui." }, { status: 400 });
  }

  // Paginado: o PostgREST corta QUALQUER resposta em 1000 linhas e `.limit()`
  // do cliente não bypassa esse teto — uma campanha com mais de 1000 posts
  // pendentes teria só os 1000 primeiros reagendados, em silêncio.
  let pendingRows: { id: string; account_id: string; scheduled_at: string; clone_source_profile: string | null }[];
  try {
    pendingRows = await fetchAllRows((from, to) =>
      (admin as any)
        .from("scheduled_posts")
        .select("id, account_id, scheduled_at, clone_source_profile")
        .eq("campaign_id", campaignId)
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("scheduled_at", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  if ((pendingRows ?? []).some((r: { clone_source_profile: string | null }) => r.clone_source_profile)) {
    return NextResponse.json({ error: "Campanhas de Clonar Perfil não podem ser editadas aqui." }, { status: 400 });
  }

  const rows = (pendingRows ?? []) as { id: string; account_id: string; scheduled_at: string }[];

  if (rows.length > 0) {
    // Agrupa por conta preservando a ordem atual (= ordem de vídeos na sequência
    // de cada conta); só a legenda e o horário mudam, o par conta/vídeo é mantido.
    const byAccount = new Map<string, typeof rows>();
    for (const row of rows) {
      const arr = byAccount.get(row.account_id) ?? [];
      arr.push(row);
      byAccount.set(row.account_id, arr);
    }
    const accountIds = [...byAccount.keys()];

    const intervalMinutes = Math.max(1, Math.floor((24 * 60) / postsPerDay));
    const autoStaggerMs = accountIds.length > 1
      ? Math.min(5 * 60_000, Math.floor((intervalMinutes * 60_000 * 0.9) / (accountIds.length - 1)))
      : 0;
    // Pequena folga a partir de agora — o cron publish-scheduled pega no próximo run.
    const startTime = Date.now() + 30_000;
    const autoType = (body.auto_caption_type ?? "curiosidades-gerais") as AutoCaptionType;

    // Campanha que publica a legenda ORIGINAL de cada vídeo (ou nenhuma) não
    // pode ter o texto reescrito aqui: o snapshot de cada post carrega a
    // legenda do vídeo dele. Nesse caso a edição só reagenda — a legenda
    // fica intacta, em vez de ser substituída pelo pool sem o usuário pedir.
    const { data: distRow } = await (admin as any)
      .from("distribute_campaigns")
      .select("caption_mode")
      .eq("id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();
    const modoDaCampanha = (distRow as { caption_mode?: string | null } | null)?.caption_mode ?? "custom";
    const reescreveLegenda = modoDaCampanha === "custom";

    const updates: { id: string; user_id: string; caption?: string; scheduled_at: string }[] = [];
    accountIds.forEach((accId, ai) => {
      const staggerMs = staggerSeconds != null ? ai * staggerSeconds * 1_000 : ai * autoStaggerMs;
      const accRows = byAccount.get(accId)!;
      accRows.forEach((row, vi) => {
        const scheduledAt = new Date(startTime + vi * intervalMinutes * 60_000 + staggerMs).toISOString();
        const caption = isAutoCaption
          ? getAutoCaption(autoType)
          : validCaptions[Math.floor(Math.random() * validCaptions.length)];
        // user_id é NOT NULL sem default na tabela — mesmo resolvendo por
        // ON CONFLICT DO UPDATE, o Postgres valida a linha do INSERT contra
        // as constraints da tabela antes de decidir o conflito, então
        // omitir uma coluna NOT NULL derruba o upsert inteiro (já vimos
        // "null value in column user_id violates not-null constraint" em
        // produção). O valor é sempre o mesmo já existente na linha (as
        // pendingRows já vieram filtradas por user_id = user.id acima).
        updates.push(
          reescreveLegenda
            ? { id: row.id, user_id: user.id, caption, scheduled_at: scheduledAt }
            : { id: row.id, user_id: user.id, scheduled_at: scheduledAt }
        );
      });
    });

    for (let i = 0; i < updates.length; i += 500) {
      const { error } = await admin.from("scheduled_posts").upsert(updates.slice(i, i + 500));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Se a campanha estiver sincronizada com pasta(s) de contas, atualiza a config
  // persistida para que contas novas matriculadas pelo cron sync-distribute-accounts
  // usem as mesmas legendas/cadência recém-editadas. burst_mode é desligado — a
  // edição sempre resulta numa cadência espaçada normal.
  await (admin as any)
    .from("distribute_campaigns")
    .update({
      posts_per_day: postsPerDay,
      captions: isAutoCaption ? [] : validCaptions,
      auto_caption_enabled: isAutoCaption,
      auto_caption_type: isAutoCaption ? (body.auto_caption_type ?? null) : null,
      account_stagger_seconds: staggerSeconds ?? null,
      burst_mode: false,
    })
    .eq("id", campaignId)
    .eq("user_id", user.id);

  // Campanha pausada: os horários acabaram de ser recalculados a partir de
  // agora, então a pausa passa a contar daqui. Sem isso, ao retomar, o
  // deslocamento (now - paused_at) somaria também o tempo em pausa anterior
  // à edição e empurraria a fila além do necessário.
  if (rows.length > 0) {
    await (admin as any)
      .from("distribute_campaigns")
      .update({ paused_at: new Date().toISOString() })
      .eq("id", campaignId)
      .eq("user_id", user.id)
      .eq("status", "paused");
  }

  return NextResponse.json({ success: true, updated: rows.length });
}
