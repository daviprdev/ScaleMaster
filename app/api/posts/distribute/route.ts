import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAutoCaption, getUniqueCaptions, type AutoCaptionType } from "@/lib/auto-captions";
import {
  normalizeCaptionMode, resolveCaption, captionRejectionMessage,
} from "@/lib/reel-captions";
import { fetchVideoUsage, fetchAllRows } from "@/lib/video-history";
import { normalizeProcessingMode } from "@/lib/video-processing";
import {
  assignVideos,
  normalizePriorityStrategy,
  type PriorityStrategy,
} from "@/lib/media-priority";

export const runtime = "nodejs";

/**
 * P1 CORREÇÃO: Idempotência de campanha com identidade estável.
 *
 * PROBLEMA ANTERIOR: O hash incluía `start_at`, mas o formulário gera
 * `new Date().toISOString()` a cada envio no modo Ciclo/burst. Dois envios
 * da mesma intenção geravam chaves diferentes, criando duplicatas.
 *
 * SOLUÇÃO: Separar identidade de operação (estável durante retry) de
 * fingerprint de conteúdo (detecta reutilização incompatível).
 *
 * - `operationId`: gerado no cliente no início da intenção do usuário,
 *   persistido durante retries. Nova campanha intencional = novo operationId.
 * - `contentFingerprint`: hash normalizado dos parâmetros que afetam o
 *   resultado (exclui timestamps voláteis como start_at em burst mode).
 *
 * Conflito de unicidade por concorrência: consultar estado da operação
 * vencedora. Não transformar qualquer erro de banco em sucesso idempotente.
 */
function computeContentFingerprint(body: DistributeBody, userId: string): string {
  // Normaliza campos que afetam o resultado da distribuição.
  // EXCLUI start_at em burst_mode (volátil, não afeta atribuição).
  // INCLUI campos omitidos anteriormente: caption_strip_hashtags,
  // caption_strip_mentions, account_stagger_seconds.
  const normalized = {
    userId,
    accountIds: [...body.account_ids].sort(),
    folderId: body.folder_id,
    videoCount: body.video_count,
    postsPerDay: body.burst_mode ? null : body.posts_per_day,
    startAt: body.burst_mode ? null : body.start_at,
    captions: body.captions ?? [],
    autoCaptionType: body.auto_caption_type ?? null,
    captionMode: body.caption_mode ?? "custom",
    captionStripHashtags: body.caption_strip_hashtags ?? false,
    captionStripMentions: body.caption_strip_mentions ?? false,
    accountStaggerSeconds: body.account_stagger_seconds ?? null,
    burstMode: !!body.burst_mode,
    syncFolderIds: [...(body.sync_folder_ids ?? [])].sort(),
    processingMode: body.video_processing_mode ?? "original",
    shareToFeed: body.share_to_feed ?? null,
    priorityStrategy: body.priority_strategy ?? "views",
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function computeOperationId(body: DistributeBody, userId: string): string {
  // P1: Identidade de operação estável durante retry.
  // Se o cliente enviar `operation_id` explícito, usa ele (gerado no início
  // da intenção do usuário). Caso contrário, deriva do conteúdo normalizado
  // para compatibilidade com clientes antigos.
  const explicitOpId = (body as unknown as Record<string, unknown>).operation_id as string | undefined;
  if (explicitOpId && typeof explicitOpId === "string" && explicitOpId.length > 0) {
    return explicitOpId;
  }
  // Fallback: hash do conteúdo (comportamento anterior, mas agora estável
  // porque exclui campos voláteis em burst mode).
  return computeContentFingerprint(body, userId);
}

interface DistributeBody {
  account_ids: string[];
  folder_id: string;
  video_count: number;            // -1 = todos, ou 10/20/50
  posts_per_day: number;          // 1–1440 (ignorado em burst_mode)
  start_at: string;               // ISO datetime (ignorado em burst_mode)
  captions: string[];
  auto_caption_type?: string;     // se presente, ignora captions e gera automaticamente
  caption_mode?: string;          // original | custom | none (ausente = custom)
  caption_strip_hashtags?: boolean;
  caption_strip_mentions?: boolean;
  account_stagger_seconds?: number | null; // null = cálculo automático
  burst_mode?: boolean;           // Modo Ciclo: todos os vídeos agendados para agora
  sync_folder_ids?: string[];     // pastas de contas cujas contas novas devem entrar sozinhas na campanha
  video_processing_mode?: string; // "original" (padrao) | "clean_metadata"
  share_to_feed?: boolean;        // true = Reels + grade | false = somente Reels
  priority_strategy?: string;     // "views" | "least_usage" | "random" (default: "views")
  use_proxy_pool?: boolean;       // true = usar proxy do estoque na publicação (opt-in)
}

export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, total_posts: 0, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as DistributeBody;
  const { account_ids, folder_id, video_count, posts_per_day, start_at, captions, auto_caption_type, account_stagger_seconds, burst_mode, sync_folder_ids } = body;
  // Decisao de processamento congelada no momento do agendamento: mudar a
  // preferencia depois nao altera retroativamente posts ja criados.
  const processingMode = normalizeProcessingMode(body.video_processing_mode);
  // Só persiste quando veio um booleano de verdade — undefined mantém o
  // comportamento anterior (parâmetro não enviado à Meta).
  const shareToFeed = typeof body.share_to_feed === "boolean" ? body.share_to_feed : null;

  if (!account_ids?.length)
    return NextResponse.json({ error: "Selecione ao menos 1 conta." }, { status: 400 });
  if (!folder_id)
    return NextResponse.json({ error: "Selecione uma pasta de mídia." }, { status: 400 });
  if (!burst_mode && (!posts_per_day || posts_per_day < 1 || posts_per_day > 1440))
    return NextResponse.json({ error: "Posts por dia deve ser entre 1 e 1440." }, { status: 400 });
  if (!burst_mode && !start_at)
    return NextResponse.json({ error: "Informe a data e hora de início." }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Valida ownership de TODAS as contas antes de agendar qualquer post — impede
  // agendar/publicar em conta de outro usuário via account_id vazado/adivinhado.
  const { data: ownedAccountRows } = await admin
    .from("instagram_accounts")
    .select("id")
    .in("id", account_ids)
    .eq("user_id", user.id);
  const ownedAccountIds = new Set((ownedAccountRows ?? []).map((a: { id: string }) => a.id));
  const notOwnedAccounts = account_ids.filter((id) => !ownedAccountIds.has(id));
  if (notOwnedAccounts.length > 0) {
    return NextResponse.json(
      { error: "Uma ou mais contas não pertencem a este usuário." },
      { status: 403 }
    );
  }

  // Modo de legenda. Ausente = "custom" = comportamento histórico desta aba
  // (pool digitado ou legenda automática) — nenhuma campanha existente muda.
  const captionMode = normalizeCaptionMode(body.caption_mode);
  const stripHashtags = body.caption_strip_hashtags === true;
  const stripMentions = body.caption_strip_mentions === true;

  const isAutoCaption = !!auto_caption_type;
  const validCaptions = isAutoCaption ? [] : (captions ?? []).map(c => c.trim()).filter(Boolean);

  // Pré-gera legendas automáticas únicas se necessário (1 por post total)
  const autoType = (auto_caption_type ?? "curiosidades-gerais") as AutoCaptionType;

  // Estratégia de prioridade: "views" (default para novas campanhas), "least_usage"
  // (compatível com campanhas existentes) ou "random". Persistida na campanha para
  // que sync-distribute-accounts e retries usem a mesma política.
  const priorityStrategy = normalizePriorityStrategy(
    (body as unknown as Record<string, unknown>).priority_strategy as string | undefined,
  );

  // Paginado: `.limit(10000)` não bypassa o teto de 1000 linhas do PostgREST —
  // uma pasta com mais de 1000 vídeos teria o excedente ignorado em silêncio.
  // `views` incluído para ranking por prioridade.
  let allVideos: { id: string; public_url: string; caption: string | null; views: number }[];
  try {
    allVideos = await fetchAllRows<{ id: string; public_url: string; caption: string | null; views: number }>((from, to) =>
      admin
        .from("videos_library")
        .select("id, public_url, caption, views")
        .eq("folder_id", folder_id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    console.error(`[distribute] ${(e as Error).message}`);
    return NextResponse.json({ error: "Falha ao ler a pasta de mídia." }, { status: 503 });
  }

  if (!allVideos.length)
    return NextResponse.json({ error: "Nenhum vídeo encontrado na pasta." }, { status: 400 });

  const maxVideos = video_count === -1
    ? allVideos.length
    : Math.min(video_count, allVideos.length);

  // Histórico por conta atravessando TODAS as origens (Postar/Clonar/Automatizar
  // via scheduled_posts + Loop via pending_containers). Antes, o subconjunto era
  // slice(0, N) fixo por created_at — toda campanha nova começava SEMPRE pelos
  // mesmos N vídeos mais antigos da pasta, repetindo o que a conta já postou.
  //
  // Lido pelo RPC agregado, NÃO por selects diretos: o PostgREST corta toda
  // resposta em 1000 linhas e o `.limit(100000)` que ficava aqui não bypassava
  // esse teto — com dezenas de milhares de linhas de histórico, a maior parte
  // (inclusive a mais recente) ficava invisível e o pool oferecia vídeos que a
  // conta já tinha postado.
  //
  // account_id → (video_id → vezes postado)
  let postedCount: Map<string, Map<string, number>>;
  try {
    postedCount = await fetchVideoUsage(admin, account_ids);
  } catch (e) {
    console.error(`[distribute] ${(e as Error).message}`);
    return NextResponse.json(
      { error: "Falha ao ler o histórico de vídeos das contas. Tente novamente." },
      { status: 503 }
    );
  }

  // P1 CORREÇÃO: Idempotência com identidade estável durante retry.
  // Usa operation_id explícito do cliente (se fornecido) ou deriva do
  // conteúdo normalizado (exclui campos voláteis em burst mode).
  const idempotencyKey = computeOperationId(body, user.id);

  // Verifica se já existe uma campanha com esta chave (retry/duplo clique)
  const { data: existingCampaign } = await admin
    .from("distribute_campaigns")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingCampaign) {
    // Campanha já existe — retorna sucesso idempotente sem recriar posts
    const { count: existingPosts } = await admin
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", existingCampaign.id);

    return NextResponse.json({
      success: true,
      total_posts: existingPosts ?? 0,
      campaign_id: existingCampaign.id,
      idempotent: true,
      message: "Campanha já criada com estes parâmetros.",
    });
  }

  const campaignId = randomUUID();
  // Seed determinística baseada na chave idempotente (não em Date.now())
  // para que retries reproduzam exatamente a mesma atribuição.
  const distributionSeed = idempotencyKey;
  // Distribui uniformemente ao longo de 24h (ignorado em burst_mode)
  const intervalMinutes = burst_mode ? 0 : Math.floor((24 * 60) / posts_per_day);
  // Modo Ciclo: tudo agendado para agora — o cron publish-scheduled drena a fila
  // no ritmo máximo do pipeline (lotes por minuto, retry/backoff da Meta intactos).
  const startTime = burst_mode ? Date.now() : new Date(start_at).getTime();

  const rows: object[] = [];
  // Vídeos que o modo "original" encontrou sem legenda — publicam SEM legenda
  // (sem fallback) e o total volta na resposta para a UI poder avisar.
  const semLegendaOriginal = new Set<string>();

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

  // Atribuição centralizada via media-priority: views DESC + diversidade entre
  // contas na mesma rodada + balanceamento em escassez. Seed persistida na
  // campanha para que retries e sync-distribute-accounts reproduzam a mesma
  // atribuição. Sem windowClaims/recentGlobalCooldown aqui porque a distribuição
  // cria scheduled_posts futuros (não containers imediatos como o Loop).
  const assignments = assignVideos({
    candidates: allVideos.map((v) => ({
      id: v.id,
      views: v.views ?? 0,
      public_url: v.public_url,
      caption: v.caption,
    })),
    accountIds: account_ids,
    usageByAccount: postedCount,
    windowClaims: new Set(),
    recentGlobalCooldown: new Set(),
    strategy: priorityStrategy,
    seed: distributionSeed,
    videosPerAccount: maxVideos,
  });

  // Mapa rápido de vídeo por ID para resolver legenda/url durante a geração de linhas
  const videoById = new Map(allVideos.map((v) => [v.id, v]));

  // Agrupa atribuições por conta preservando a ordem devolvida pelo módulo
  const assignmentsByAccount = new Map<string, typeof assignments>();
  for (const a of assignments) {
    let list = assignmentsByAccount.get(a.accountId);
    if (!list) {
      list = [];
      assignmentsByAccount.set(a.accountId, list);
    }
    list.push(a);
  }

  for (let ai = 0; ai < account_ids.length; ai++) {
    const accountId = account_ids[ai];
    const accountAssignments = assignmentsByAccount.get(accountId) ?? [];
    const staggerMs = burst_mode
      ? ai * burstBlockMs
      : account_stagger_seconds
        ? ai * account_stagger_seconds * 1_000
        : ai * autoStaggerPerAccountMs;

    for (let vi = 0; vi < accountAssignments.length; vi++) {
      const assigned = accountAssignments[vi];
      const video = videoById.get(assigned.video.id);
      if (!video) continue; // segurança: candidato desapareceu entre fetch e atribuição

      // Burst: 2s entre vídeos só para ordenação estável na fila (scheduled_at ASC)
      const slotMs = burst_mode ? vi * 2_000 : vi * intervalMinutes * 60_000;
      const scheduledAt = new Date(startTime + slotMs + staggerMs).toISOString();
      // Legenda do mecanismo histórico (pool ou automática). Só é usada
      // quando o modo é "custom".
      const customCaption = isAutoCaption
        ? getAutoCaption(autoType)
        : validCaptions.length > 0
          ? validCaptions[Math.floor(Math.random() * validCaptions.length)]
          : "";

      // SNAPSHOT: a legenda é resolvida AQUI, com o vídeo concreto já
      // escolhido, e o texto final vai para a linha. Vídeo A recebe a legenda
      // de A porque `video` é o vídeo daquela iteração. Editar o vídeo na
      // Biblioteca depois não muda este post.
      const resolucao = resolveCaption({
        mode: captionMode,
        originalCaption: video.caption,
        customCaption,
        stripHashtags,
        stripMentions,
      });

      // Erro ANTES de agendar — comprimento, hashtags e menções. Nada é
      // truncado nem removido em silêncio.
      if (!resolucao.validation.valid) {
        return NextResponse.json(
          {
            error: captionRejectionMessage(resolucao.validation, `vídeo ${video.id.slice(0, 8)}`),
            code: resolucao.validation.error?.code,
          },
          { status: 400 }
        );
      }
      if (resolucao.missingOriginal) semLegendaOriginal.add(video.id);

      rows.push({
        user_id: user.id,
        account_id: accountId,
        video_id: video.id,
        video_url: video.public_url,
        caption: resolucao.caption,
        caption_mode: captionMode,
        scheduled_at: scheduledAt,
        status: "pending",
        campaign_id: campaignId,
        video_processing_mode: processingMode,
        share_to_feed: shareToFeed,
        use_proxy_pool: body.use_proxy_pool === true,
      });
    }
  }

  // Atomicidade: insere campanha ANTES dos posts. Se a inserção da campanha
  // falhar, nenhum post é criado. Se os posts falharem, a campanha fica sem
  // posts mas não gera trabalho duplicado — retries usam o mesmo campaignId.
  // A sincronização também faz parte da transação lógica: sem ela, contas novas
  // não seriam matriculadas automaticamente pelo cron sync-distribute-accounts.
  // P1: Atomicidade com estado de preparação. A campanha é inserida como
  // "preparing" antes dos posts. Só após todos os inserts bem-sucedidos ela
  // é ativada ("active"). Isso impede que workers consumam campanhas parciais.
  // A chave idempotente garante que retries não criem duplicatas.
  // P1 CORREÇÃO: Schema exige uuid[] NOT NULL DEFAULT '{}'.
  // O código anterior enviava null quando não havia pastas de sincronização,
  // causando falha de constraint no banco. Enviar array vazio explicitamente.
  const { error: campaignInsertErr } = await admin.from("distribute_campaigns").insert({
    id: campaignId,
    user_id: user.id,
    idempotency_key: idempotencyKey,
    status: "preparing", // Estado inicial: ainda montando posts
    account_folder_ids: Array.isArray(sync_folder_ids) && sync_folder_ids.length > 0 ? sync_folder_ids : [],
    video_folder_id: folder_id,
    video_count,
    posts_per_day: burst_mode ? 1 : posts_per_day,
    captions: isAutoCaption ? [] : validCaptions,
    auto_caption_enabled: isAutoCaption,
    auto_caption_type: isAutoCaption ? autoType : null,
    caption_mode: captionMode,
    caption_strip_hashtags: stripHashtags,
    caption_strip_mentions: stripMentions,
    account_stagger_seconds: account_stagger_seconds ?? null,
    burst_mode: !!burst_mode,
    video_processing_mode: processingMode,
    share_to_feed: shareToFeed,
    priority_strategy: priorityStrategy,
    distribution_seed: distributionSeed,
    use_proxy_pool: body.use_proxy_pool === true,
  });
  if (campaignInsertErr) {
    return NextResponse.json(
      { error: `Falha ao criar campanha: ${campaignInsertErr.message}` },
      { status: 500 },
    );
  }

  // Insert em lotes de 500 — após confirmação da campanha em estado "preparing"
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("scheduled_posts").insert(rows.slice(i, i + 500));
    if (error) {
      // Posts parcialmente inseridos: campanha fica em "preparing" para sempre.
      // Workers não consomem campanhas nesse estado. O usuário pode recriar
      // com os mesmos parâmetros (idempotência) ou limpar manualmente.
      // O usuário pode recriar com o mesmo seed para reproduzir a atribuição.
      return NextResponse.json(
        {
          error: `Falha ao inserir posts agendados (lote ${Math.floor(i / 500) + 1}): ${error.message}`,
          campaign_id: campaignId,
          partial: true,
        },
        { status: 500 },
      );
    }
  }

  // P1 CORREÇÃO: Ativação atômica com verificação de integridade.
  // PROBLEMA ANTERIOR: Falha de ativação era apenas logada e a resposta
  // continuava sendo sucesso, deixando campanha "preparing" com posts
  // pendentes que workers não consumiriam (bloqueio silencioso).
  //
  // SOLUÇÃO: Verificar contagem de posts inseridos antes de ativar.
  // Se contagem não bater, marcar como "failed" e retornar erro explícito.
  // Retry com mesmo operation_id encontrará campanha "failed" e poderá
  // limpar/recriar, ou o usuário pode intervir manualmente.
  const { count: insertedCount, error: countErr } = await admin
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);

  if (countErr || insertedCount !== rows.length) {
    // Integridade comprometida: marcar como failed e retornar erro.
    await admin
      .from("distribute_campaigns")
      .update({ status: "failed" })
      .eq("id", campaignId)
      .eq("status", "preparing");
    console.error(
      `[distribute] Falha de integridade: esperados ${rows.length} posts, ` +
      `encontrados ${insertedCount ?? 0}. Campanha marcada como failed.`
    );
    return NextResponse.json(
      {
        error: `Falha de integridade: esperados ${rows.length} posts, encontrados ${insertedCount ?? 0}.`,
        campaign_id: campaignId,
        status: "failed",
      },
      { status: 500 },
    );
  }

  const { error: activateErr, data: activated } = await admin
    .from("distribute_campaigns")
    .update({ status: "active" })
    .eq("id", campaignId)
    .eq("status", "preparing")
    .select("id");

  if (activateErr || !activated?.length) {
    // Falha de ativação: campanha pode já ter sido ativada por concorrência
    // ou estar em estado inesperado. Verificar estado atual.
    const { data: current } = await admin
      .from("distribute_campaigns")
      .select("status")
      .eq("id", campaignId)
      .single();
    const currentStatus = (current as { status?: string } | null)?.status ?? "unknown";
    if (currentStatus !== "active") {
      console.error(
        `[distribute] Falha ao ativar campanha ${campaignId}: status atual=${currentStatus}, erro=${activateErr?.message}`
      );
      return NextResponse.json(
        {
          error: `Falha ao ativar campanha. Status atual: ${currentStatus}.`,
          campaign_id: campaignId,
          status: currentStatus,
        },
        { status: 500 },
      );
    }
    // Já estava active (concorrência venceu) — trata como sucesso.
  }

  const times = rows.map((r) => (r as { scheduled_at: string }).scheduled_at).sort();

  return NextResponse.json({
    success: true,
    campaign_id: campaignId,
    status: "active",
    total_posts: rows.length,
    accounts: account_ids.length,
    videos_per_account: maxVideos,
    days: burst_mode ? 1 : Math.ceil(maxVideos / posts_per_day),
    first_slot: times[0],
    last_slot: times[times.length - 1],
    caption_mode: captionMode,
    videos_sem_legenda_original: semLegendaOriginal.size,
  });
}
