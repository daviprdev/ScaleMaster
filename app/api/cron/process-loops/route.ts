import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createMediaContainerOnly } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { getAutoCaption } from "@/lib/auto-captions";
import {
  normalizeCaptionMode, resolveCaption, captionRejectionMessage,
  type CaptionMode,
} from "@/lib/reel-captions";
import { markDeadAccounts } from "@/lib/account-health";
import { fetchVideoUsage, postedSet, globalUsageByVideo, fetchAllRows } from "@/lib/video-history";
import {
  normalizeProcessingMode,
  resolveMediaUrlForMode,
  type VideoProcessingMode,
} from "@/lib/video-processing";
import { requireCronAuth } from "@/lib/cron-auth";
import { LOOP_SKIP_REASONS } from "@/lib/loop-readiness";
import {
  assignVideos as priorityAssignVideos,
  normalizePriorityStrategy,
} from "@/lib/media-priority";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  username: string;
  is_active: boolean;
  meta_access_token: string | null;
  ig_business_account_id: string | null;
  token_expires_at: string | null;
  fb_page_id: string | null;
  health_status?: string;
  failover_priority?: number;
  proxy_url?: string | null;
}

interface LoopAccountRow {
  account_id: string;
  instagram_accounts: AccountRow | null;
}

interface LoopRow {
  id: string;
  user_id: string;
  name: string;
  folder_id: string | null;
  is_infinite: boolean;
  cycles: number;
  cycles_done: number;
  current_cycle: number;
  interval_minutes: number;
  media_limit: number | null;
  captions: unknown; // raw from DB — pode ser string[], null ou JSON string
  effect_mirror: boolean;
  effect_invert: boolean;
  effect_zoom: boolean;
  effect_blur: boolean;
  effect_noise: boolean;
  effect_anti_ai: boolean;
  account_folder_id: string | null;
  account_stagger_seconds: number | null;
  last_posted_at: string | null;
  last_skip_reason?: string | null;
  library_folders?: { name: string } | null;
  loop_accounts: LoopAccountRow[];
  auto_caption_enabled?: boolean;
  auto_caption_type?: string | null;
  video_processing_mode?: string | null;
  share_to_feed?: boolean | null;
  caption_mode?: string | null;
  caption_strip_hashtags?: boolean | null;
  caption_strip_mentions?: boolean | null;
}

interface VideoRow {
  id: string;
  public_url: string;
  filename: string;
  file_size: number | null;
  /**
   * Legenda ORIGINAL do Reel de onde este vídeo veio (videos_library.caption).
   * null = não capturada (upload manual ou ingestão antiga); "" = o Reel não
   * tinha legenda. Só é lida quando o Loop está em caption_mode="original".
   */
  caption: string | null;
}

// Resultado da fase de atribuição atômica: vídeo reservado + flag de ciclo reset.
interface VideoAssignment {
  video: VideoRow;
  isCycleReset: boolean;
}

// ---------------------------------------------------------------------------
// Dynamic Caption Selection (Spintax) — loops.captions DB column
// ---------------------------------------------------------------------------

/**
 * Seleção dinâmica de legenda a partir das variações configuradas no Loop.
 *
 * FONTE ÚNICA: loops.captions (text[] — preenchido pelo usuário no painel).
 * NUNCA lê videos_library.caption (sempre NULL para reels raspados).
 */
function selectDynamicCaption(rawCaptions: string[]): string {
  const pool = rawCaptions
    .map(c => (typeof c === "string" ? c : String(c ?? "")).trim())
    .filter(Boolean);

  if (pool.length === 0) return "";

  const idx = Math.floor(Math.random() * pool.length);
  const selected = pool[idx];

  console.log(
    `[dynamic-caption] ${pool.length} variação(ões) | ` +
    `selecionada [${idx + 1}/${pool.length}]: ` +
    `"${selected.slice(0, 100)}${selected.length > 100 ? "…" : ""}"`
  );

  return selected;
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Idempotency — evita dupla submissão enquanto há container em voo.
// Verifica apenas status in-flight (pending/publishing) — sem janela de tempo.
//
// Razão: windowStartIso = now (adotado em eca649c) tornava esta query sempre
// false (nenhum container pode ser criado no "futuro"), causando spam de
// containers por conta por ciclo. A Meta detecta isso como ação abusiva (#368)
// e bloqueia todas as contas. Agora só bloqueamos re-criação quando há um
// container genuinamente em processamento. Containers "published" não bloqueiam
// (queremos postar novamente depois que o anterior foi publicado).
// ---------------------------------------------------------------------------

async function containerAlreadyExists(
  admin: ReturnType<typeof getSupabaseAdmin>,
  loopId: string,
  accountId: string,
  cycleNumber: number
): Promise<boolean> {
  const { data } = await (admin as any)
    .from("pending_containers")
    .select("id")
    .eq("loop_id", loopId)
    .eq("account_id", accountId)
    // in-flight (qualquer ciclo) OU já publicado NESTE ciclo — permite retry
    // seguro do mesmo ciclo (ver AUTO-HEALING de conclusão parcial) sem
    // duplicar post de uma conta que já foi atendida.
    .or(`status.in.(pending,publishing),and(status.eq.published,cycle_number.eq.${cycleNumber})`)
    .limit(1)
    .maybeSingle();
  return data !== null;
}

// ---------------------------------------------------------------------------
// Cria container e persiste em pending_containers (commit parcial).
// ---------------------------------------------------------------------------

async function createContainerForAccount(
  admin: ReturnType<typeof getSupabaseAdmin>,
  account: AccountRow,
  loop: LoopRow,
  videoUrl: string,
  caption: string,
  tokenToUse: string,
  videoId: string,
  cycleNumber: number,
  // Atraso inicial antes da primeira tentativa de publicação.
  // Usado para escalonar containers criados no mesmo ciclo e evitar
  // o burst simultâneo que dispara "User is performing too many actions".
  initialDelayMinutes = 0
): Promise<void> {
  // share_to_feed sai da configuração do loop e é registrado no container —
  // alterar o loop depois não muda o que já foi enviado à Meta.
  const shareToFeed = typeof loop.share_to_feed === "boolean" ? loop.share_to_feed : null;

  const creationId = await createMediaContainerOnly(
    account.ig_business_account_id!,
    videoUrl,
    caption,
    tokenToUse,
    "REELS",
    shareToFeed
  );
  const insertData: Record<string, unknown> = {
    user_id: loop.user_id,
    loop_id: loop.id,
    account_id: account.id,
    ig_business_account_id: account.ig_business_account_id,
    creation_id: creationId,
    caption,
    video_id: videoId,
    cycle_number: cycleNumber,
    video_processing_mode: normalizeProcessingMode(loop.video_processing_mode),
    share_to_feed: shareToFeed,
    // Auditoria: qual modo produziu o texto acima. A publicação usa `caption`
    // e nunca recalcula a partir daqui.
    caption_mode: normalizeCaptionMode(loop.caption_mode),
  };
  if (initialDelayMinutes > 0) {
    insertData.retry_after = new Date(Date.now() + initialDelayMinutes * 60_000).toISOString();
  }
  const { error } = await (admin as any).from("pending_containers").insert(insertData);
  if (error) throw new Error(`Falha ao salvar container: ${error.message}`);
  console.log(
    `[loop-cron] ✓ @${account.username} → container ${creationId} persistido` +
    (initialDelayMinutes > 0 ? ` (publicar em +${initialDelayMinutes}min)` : "") + "."
  );
}

// ---------------------------------------------------------------------------
// Registra erro em pending_containers para rastreabilidade.
// ---------------------------------------------------------------------------

async function recordContainerError(
  admin: ReturnType<typeof getSupabaseAdmin>,
  account: AccountRow,
  loop: LoopRow,
  caption: string,
  errorMsg: string,
  videoId: string,
  cycleNumber: number
): Promise<void> {
  // NUNCA usar .catch() diretamente no builder do Supabase — o builder não é uma
  // Promise completa e não possui .catch(). Sempre usar try/catch com await.
  try {
    const { error } = await (admin as any).from("pending_containers").insert({
      user_id: loop.user_id,
      loop_id: loop.id,
      account_id: account.id,
      ig_business_account_id: account.ig_business_account_id ?? "",
      creation_id: "",
      caption,
      status: "error",
      error_message: errorMsg.slice(0, 500),
      video_id: videoId || null,
      cycle_number: cycleNumber,
    });
    if (error) {
      console.warn(`[loop-cron] recordContainerError: falha ao persistir erro para @${account.username}: ${error.message}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[loop-cron] recordContainerError: exceção ao persistir erro para @${account.username}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Failover
// ---------------------------------------------------------------------------

// Erros de rate limit temporário — a conta será pulada neste ciclo e tentará no próximo.
// NÃO gravar container de erro para esses casos: o acúmulo polui o monitor e
// desperdiça chamadas à Meta API enquanto a janela de throttle ainda está ativa.
function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("too many actions") ||
    lower.includes("performing too many") ||
    lower.includes("retry your request later") ||
    lower.includes("please retry") ||
    lower.includes("service temporarily unavailable") ||
    // Erros de infraestrutura da Meta: servidor deles falhou ao processar o token —
    // token válido, problema transitório. Trata como skip silencioso igual rate-limit.
    lower.includes("failed to decrypt") ||
    lower.includes("cannot parse access token") ||
    lower.includes("malformed access token")
    // Checkpoint REMOVIDO daqui (2026-07-17): checkpoint é conta caída de verdade —
    // agora flui para isCriticalMetaError e marca a conta como error (com guarda
    // de cascata). Detecção passiva pelo pipeline substitui o ping do sync.
  );
}

function isCriticalMetaError(msg: string): boolean {
  const lower = msg.toLowerCase();
  const patterns = [
    // Tokens genuinamente mortos — mensagens inequívocas da Meta Graph API:
    "invalid_token",
    "token has expired",
    "session has been invalidated",
    "invalid oauth access token",   // "The access token is invalid."
    // Restrições permanentes de conta:
    "account has been restricted",
    "this action is blocked",       // específico de ação bloqueada permanentemente
    "has been blocked from",        // "your account has been blocked from"
    "your account has been disabled",
    "checkpoint",
    // Checkpoint do Instagram (mensagem literal da Meta, não contém a palavra
    // "checkpoint"): conta exige login manual via browser. Movido do skip
    // silencioso (isRateLimitError) para cá em 2026-07-17 — o pipeline é quem
    // marca a conta vermelha agora, com a guarda de cascata abaixo.
    "you cannot access the app till you log in",
    "log in to www.instagram.com and follow the instructions",
    // Códigos de erro explicitamente na mensagem legível (ex: "#190 Error..."):
    "error code 190",
    "error code 102",
    "error code 104",
    // Conta pessoal sem suporte a API de Reels:
    "unsupported request - method type: post",
    // Token de conta não confirmada / sessão inválida:
    "not a confirmed user",
    "sessions for the user are not allowed",
  ];
  // Padrões REMOVIDOS intencionalmente:
  //  - "oauthexception": campo type, não message — raro na mensagem e genérico demais
  //  - "cannot parse access token": erro de INFRAESTRUTURA da Meta (transitório),
  //    não token morto — já coberto por isRateLimitError() como skip silencioso
  //  - "blocked": genérico demais — "Connection blocked by proxy",
  //    "endpoint temporarily blocked" etc. marcavam contas saudáveis como error
  return patterns.some(p => lower.includes(p));
}

// Failover cross-conta REMOVIDO (2026-07-16). Antes, quando uma conta falhava,
// o vídeo+legenda dela era repostado através de OUTRA conta do usuário (backup por
// failover_priority, sem respeitar a pasta) — misturando conteúdo entre
// clientes/personas. Agora as contas são independentes: erro crítico marca a conta
// como health_status='error' e para; nenhuma outra conta assume o post.

// ---------------------------------------------------------------------------
// FASE 1 — Atribuição atômica de vídeos (pre-assignment)
//
// Todas as decisões de qual vídeo vai para qual conta são tomadas ANTES de
// qualquer chamada à Meta API ou escrita no banco. Isso elimina o race
// condition TOCTOU onde duas invocações concorrentes do cron (ex: */15 e
// */5 disparando no mesmo minuto) liam o mesmo estado do banco e escolhiam
// o mesmo vídeo para contas diferentes — a raiz do erro 368 em burst.
//
// Estratégia:
//  1. Busca o histórico de TODAS as contas em 2 queries batch — atravessando
//     todas as origens (Loop + Postar/Clonar/Automatizar), sem escopo por loop_id
//  2. Busca vídeos já reivindicados por QUALQUER conta nesta janela (guard inter-run)
//  3. Atribui vídeos em passagem síncrona única — sem async entre decisões.
//     Prioriza vídeos de menor uso global entre as contas do loop.
// ---------------------------------------------------------------------------

async function assignVideosForLoop(
  admin: ReturnType<typeof getSupabaseAdmin>,
  loop: LoopRow,
  allVideos: VideoRow[],
  allLoopAccounts: AccountRow[],
  accountsToAssign: AccountRow[],
  windowStartIso: string
): Promise<Map<string, VideoAssignment>> {
  // Busca paralela: histórico por conta + vídeos já tomados nesta janela.
  // Histórico atravessa TODAS as origens (Loop via pending_containers +
  // Postar/Clonar/Automatizar via scheduled_posts), sem escopo por loop_id:
  // histórico por loop fazia cada loop novo repostar tudo que a conta já
  // postou por outros loops/abas — mesmo vídeo chegou a sair 9× na mesma conta.
  //
  // IMPORTANTE: accountIds usa allLoopAccounts (TODAS as contas do loop, não só
  // as devidas nesta rodada). Antes usava só as contas devidas — como cada tick
  // do cron normalmente só tem 1-3 contas devidas de um loop com 40+ contas, o
  // "menor uso GLOBAL" virava "menor uso entre essas 1-3 contas", uma amostra
  // minúscula e instável a cada tick. Resultado observado em produção: um mesmo
  // vídeo saindo 11× para a mesma conta e repetido em várias contas diferentes
  // do mesmo loop em poucas horas, mesmo com pasta de 330 vídeos. Fix: histórico
  // e usageByVideo sempre olham o loop inteiro; só a ATRIBUIÇÃO (loop abaixo)
  // fica restrita às contas devidas.
  //
  // O histórico vem do RPC agregado `get_account_video_usage` (lib/video-history),
  // NÃO de selects diretos: o PostgREST corta toda resposta em 1000 linhas e o
  // `.limit(100000)` que ficava aqui não bypassava esse teto. Com 16.063 linhas
  // de histórico neste loop, 94% ficavam invisíveis — inclusive as mais
  // recentes — e o pool "disponível" voltava a oferecer vídeos que a conta
  // acabara de postar. Era a causa do mesmo vídeo sair 6-7× seguidas na mesma
  // conta mesmo com 330 vídeos na pasta.
  const accountIds = allLoopAccounts.map(a => a.id);
  const [usage, windowClaimsRes, recentRes, globalRecentRes] = await Promise.all([
    // Cobre pending_containers (Loop) + scheduled_posts (Postar/Clonar/
    // Automatizar) + video_processing_jobs (vídeos reservados no modo efeitos:
    // o container vem do job enfileirado no ciclo anterior, não da atribuição
    // atual — sem contá-los como reserva, o vídeo do job repete no ciclo
    // seguinte e vaza para várias contas).
    fetchVideoUsage(admin, accountIds),
    // Guard inter-run: vídeos reivindicados por QUALQUER conta nesta janela.
    // Impede que duas invocações concorrentes do cron escolham o mesmo vídeo
    // para contas diferentes, mesmo que cada processo tenha sua própria memória.
    (admin as any)
      .from("pending_containers")
      .select("video_id")
      .eq("loop_id", loop.id)
      .neq("status", "error")
      .gte("created_at", windowStartIso)
      .not("video_id", "is", null),
    // Recência por conta devida: os últimos vídeos que ela postou. Serve de
    // cooldown — na virada de ciclo (quando o histórico da conta é reiniciado)
    // o pool volta a conter tudo, inclusive o vídeo do post anterior, e o
    // sorteio podia devolvê-lo em seguida. Ordenado DESC de propósito: se o
    // teto de 1000 linhas do PostgREST cortar, o que sobra são as linhas
    // recentes, que é justamente o que este guard precisa.
    (admin as any)
      .from("pending_containers")
      .select("account_id, video_id, created_at")
      .in("account_id", accountsToAssign.map(a => a.id))
      .neq("status", "error")
      .not("video_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000),
    // Recência GLOBAL do loop: últimos vídeos usados por QUALQUER conta.
    // Base do guard anti-duplicata entre contas (ver `recentlyUsedGlobally`).
    (admin as any)
      .from("pending_containers")
      .select("video_id")
      .in("account_id", accountIds)
      .neq("status", "error")
      .not("video_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  // Uso global por vídeo entre as contas do loop: base do balanceamento que
  // impede o mesmo vídeo de sair em várias contas enquanto outros ficam parados.
  // Contado 1× por par conta+vídeo: um job consumido também vira container, e
  // contar as duas fontes dobraria o peso do vídeo no balanceamento.
  const usageByVideo = globalUsageByVideo(usage);

  const globallyTaken = new Set<string>(
    ((windowClaimsRes as { data?: { video_id: string }[] }).data ?? [])
      .map(r => r.video_id)
      .filter(Boolean)
  );

  // Cooldown de recência: os últimos RECENT_COOLDOWN vídeos de cada conta ficam
  // fora do sorteio. O usuário aceita que um vídeo repita ao longo do tempo,
  // mas nunca em sequência — este guard cobre o caso em que o histórico da
  // conta é reiniciado (virada de ciclo) e o pool volta a conter o vídeo do
  // post imediatamente anterior.
  const RECENT_COOLDOWN = 12;
  const recentByAccount = new Map<string, string[]>();
  for (const row of (((recentRes as { data?: { account_id: string; video_id: string }[] }).data) ?? [])) {
    const list = recentByAccount.get(row.account_id) ?? [];
    if (list.length < RECENT_COOLDOWN && !list.includes(row.video_id)) {
      list.push(row.video_id);
      recentByAccount.set(row.account_id, list);
    }
  }

  // Guard anti-duplicata ENTRE contas: os vídeos usados mais recentemente por
  // qualquer conta do loop saem do sorteio até metade da pasta ter circulado.
  //
  // Sem ele, o mesmo vídeo saía em 16 contas diferentes dentro de 2h (medido em
  // produção) — conteúdo idêntico publicado em massa na mesma janela é o padrão
  // que a Meta suprime no alcance, e era a causa direta das views baixas. O
  // balanceamento por `usageByVideo` sozinho não resolve: ele compara o uso
  // ACUMULADO, então vídeos empatados no mínimo continuam podendo sair juntos.
  //
  // Metade do pool: garante que sempre reste a outra metade disponível, então o
  // guard nunca esvazia o sorteio.
  const globalCooldownSize = Math.floor(allVideos.length / 2);
  const recentlyUsedGlobally = new Set<string>();
  for (const row of (((globalRecentRes as { data?: { video_id: string }[] }).data) ?? [])) {
    if (recentlyUsedGlobally.size >= globalCooldownSize) break;
    recentlyUsedGlobally.add(row.video_id);
  }

  console.log(
    `[assign-phase] "${loop.name}": ${globallyTaken.size} vídeo(s) já tomados nesta janela (guard inter-run).`
  );

  // Estratégia de prioridade: lê da coluna do loop (default 'least_usage' para
  // loops existentes, preservando comportamento atual). Seed determinística por
  // janela para que retries/reloads reproduzam a mesma atribuição.
  const loopStrategy = normalizePriorityStrategy(
    (loop as unknown as Record<string, unknown>).priority_strategy as string | undefined,
  );
  const loopSeed = `${loop.id}:${windowStartIso}`;

  // Converte usageByVideo (Map) para o formato esperado pelo media-priority
  // (Map<accountId, Map<videoId, count>>). O `usage` já está nesse formato.
  const priorityResults = priorityAssignVideos({
    candidates: allVideos.map((v) => ({
      id: v.id,
      views: (v as unknown as Record<string, unknown>).views as number ?? 0,
      public_url: v.public_url,
      caption: v.caption ?? null,
    })),
    accountIds: accountsToAssign.map((a) => a.id),
    usageByAccount: usage,
    windowClaims: globallyTaken,
    recentGlobalCooldown: recentlyUsedGlobally,
    strategy: loopStrategy,
    seed: loopSeed,
  });

  // Converte os resultados do media-priority de volta para o formato esperado
  // pelo resto do process-loops (Map<accountId, VideoAssignment>).
  const assignments = new Map<string, VideoAssignment>();
  const videoById = new Map(allVideos.map((v) => [v.id, v]));
  for (const result of priorityResults) {
    const videoRow = videoById.get(result.video.id);
    if (!videoRow) continue; // segurança: candidato desapareceu entre fetch e atribuição
    assignments.set(result.accountId, { video: videoRow, isCycleReset: result.isCycleReset });
    // Atualiza contadores em memória para compatibilidade com logs/guards posteriores
    usageByVideo.set(result.video.id, (usageByVideo.get(result.video.id) ?? 0) + 1);
    recentlyUsedGlobally.add(result.video.id);
  }

  const summary = [...assignments.entries()]
    .map(([, a]) => `${a.video.filename.slice(0, 20)}${a.isCycleReset ? "*" : ""}`)
    .join(", ");
  console.log(
    `[assign-phase] "${loop.name}": ${assignments.size}/${accountsToAssign.length} conta(s) com vídeo atribuído (histórico por conta em todas as origens + menor uso global entre ${allLoopAccounts.length} conta(s) do loop). ` +
    `[${summary}]`
  );

  return assignments;
}

// ---------------------------------------------------------------------------
// Processa um único loop elegível. Retorna o resultado para o resumo final.
// ---------------------------------------------------------------------------

type LoopOutcome = "processed" | "skipped" | "error";

/**
 * Grava por que o loop não postou neste ciclo. Até 2026-09-21 esse motivo só
 * existia como console.warn nos logs da Vercel: o loop ficava "Ativo" na tela,
 * sem postar nada, e não havia nenhum sintoma visível para o usuário. Agora o
 * card do Loop mostra o texto e diz o que fazer.
 */
async function noteSkip(
  admin: ReturnType<typeof getSupabaseAdmin>,
  loop: { id: string; name: string },
  reason: string
): Promise<LoopOutcome> {
  console.warn(`[loop-cron] "${loop.name}": ${reason}`);
  try {
    await (admin as any)
      .from("loops")
      .update({ last_skip_reason: reason, last_skip_at: new Date().toISOString() })
      .eq("id", loop.id);
  } catch (e) {
    // Best-effort: não é motivo para derrubar o ciclo dos outros loops.
    console.warn(`[loop-cron] falha ao registrar o motivo do skip: ${String(e)}`);
  }
  return "skipped";
}

/** Loop voltou a funcionar: apaga o aviso do card. */
async function clearSkipNote(
  admin: ReturnType<typeof getSupabaseAdmin>,
  loopId: string
): Promise<void> {
  try {
    await (admin as any)
      .from("loops")
      .update({ last_skip_reason: null, last_skip_at: null })
      .eq("id", loopId)
      .not("last_skip_reason", "is", null);
  } catch {
    /* best-effort */
  }
}

async function processOneLoop(
  loop: LoopRow,
  admin: ReturnType<typeof getSupabaseAdmin>,
  now: Date
): Promise<LoopOutcome> {

  // ── Contas válidas ─────────────────────────────────────────────────────────
  // Exclui contas marcadas como 'error' — evita ciclos infinitos de falha que
  // causam rate-limit na Meta e poluem a fila de pending_containers.
  // Quando account_folder_id está configurado, busca dinamicamente as contas
  // saudáveis da pasta — novas contas adicionadas entram automaticamente.
  let validAccounts: AccountRow[];
  if (loop.account_folder_id) {
    const { data: folderAccounts } = await (admin as any)
      .from("instagram_accounts")
      .select("id, username, is_active, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id, health_status, failover_priority")
      .eq("folder_id", loop.account_folder_id)
      .eq("user_id", loop.user_id)
      .eq("is_active", true)
      .neq("health_status", "error");
    validAccounts = (folderAccounts ?? []) as AccountRow[];
    console.log(`[loop-cron] "${loop.name}" modo pasta — ${validAccounts.length} conta(s) ativa(s) na pasta.`);
  } else {
    validAccounts = loop.loop_accounts
      .map(la => la.instagram_accounts)
      .filter((acc): acc is AccountRow =>
        acc !== null &&
        acc.is_active === true &&
        (acc.health_status ?? "online") !== "error"
      );
  }

  if (validAccounts.length === 0) {
    return noteSkip(
      admin,
      loop,
      loop.account_folder_id
        ? LOOP_SKIP_REASONS.noAccountsInFolder(null)
        : LOOP_SKIP_REASONS.allAccountsDown()
    );
  }

  if (!loop.folder_id) {
    return noteSkip(admin, loop, LOOP_SKIP_REASONS.noMediaFolder());
  }

  // ── Busca todos os vídeos da pasta (pool global do loop) ───────────────────
  // Paginado: sem `.range()` o PostgREST devolveria no máximo 1000 vídeos e o
  // excedente da pasta ficaria fora do pool sem nenhum aviso.
  let allVideoRows: VideoRow[];
  try {
    allVideoRows = await fetchAllRows<VideoRow>((from, to) =>
      (admin as any)
        .from("videos_library")
        .select("id, public_url, filename, file_size, caption, views")
        .eq("folder_id", loop.folder_id)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    console.error(`[loop-cron] "${loop.name}": falha ao ler a pasta de vídeos — pulando. ${(e as Error).message}`);
    return "skipped";
  }

  if (!allVideoRows.length) {
    return noteSkip(admin, loop, LOOP_SKIP_REASONS.emptyMediaFolder(loop.library_folders?.name ?? null));
  }

  const allVideos = allVideoRows;

  const isAutoCaption = loop.auto_caption_enabled === true && !!loop.auto_caption_type;

  let containersCreated = 0;
  // Contas que efetivamente avançaram de ciclo nesta run — usado só para
  // atualizar o cycles_done/last_posted_at informativos de `loops` no finally
  // (exibição na UI; não gate mais nada).
  const succeededAccountIds = new Set<string>();
  // Hoisted (precisam ser acessíveis no finally, fora do escopo do try):
  let accountLastContainer = new Map<string, { createdAt: number; cycleNumber: number }>();
  let nextCycleByAccount = new Map<string, number>();

  try {
    console.log(
      `[loop-cron] RAW SUPABASE DATA loop.captions:`,
      JSON.stringify(loop.captions),
      `| type: ${typeof loop.captions}`,
      `| isArray: ${Array.isArray(loop.captions)}`
    );

    // ── Escalonamento POR CONTA: cada conta tem seu próprio relógio ───────────
    // Antes, o loop inteiro avançava em "ciclos" travados por um CLAIM global
    // (last_posted_at/cycles_done em `loops`) — só avançava pro ciclo seguinte
    // quando TODAS as contas do lote já tivessem postado. Com pipeline de FFmpeg
    // (efeito ativo) ou qualquer conta lenta/com erro, isso travava o LOTE
    // INTEIRO por horas: quem postou cedo esperava o resto terminar antes do
    // ciclo seguinte sequer começar a contar o `interval_minutes` (bug do CLAIM
    // corrigido em 347bb23 — mas o modelo de lote continuava garantindo só
    // ~1 post por ciclo completo, não 1 post por `interval_minutes` por conta,
    // que é o comportamento que o usuário configura e espera).
    //
    // Agora cada conta decide sozinha se está devida: due = agora >= último
    // container não-erro desta conta + interval_minutes. Sem CLAIM, sem
    // reversão, sem estado mutável compartilhado — a verdade é sempre
    // `pending_containers`, nunca um contador em `loops`.
    const { data: lastContainerRows } = await (admin as any)
      .from("pending_containers")
      .select("account_id, created_at, cycle_number")
      .eq("loop_id", loop.id)
      .in("account_id", validAccounts.map(a => a.id))
      .in("status", ["published", "pending", "publishing"])
      .order("created_at", { ascending: false });

    // Uma linha por conta (a mais recente — primeira vista graças ao ORDER BY DESC).
    for (const row of (lastContainerRows ?? []) as { account_id: string; created_at: string; cycle_number: number | null }[]) {
      if (!accountLastContainer.has(row.account_id)) {
        accountLastContainer.set(row.account_id, {
          createdAt: new Date(row.created_at).getTime(),
          cycleNumber: row.cycle_number ?? 0,
        });
      }
    }

    // Teto de ciclos/mídia (loops não-infinitos) — agora POR CONTA: cada uma
    // para de postar quando atinge o próprio limite, em vez de travar o lote
    // inteiro esperando as demais atingirem o mesmo limite ao mesmo tempo.
    const cap = loop.is_infinite
      ? Infinity
      : Math.min(loop.cycles ?? Infinity, loop.media_limit ?? Infinity);

    const intervalMs = loop.interval_minutes * 60_000;
    const dueAccounts: AccountRow[] = [];
    let cappedCount = 0;

    for (const account of validAccounts) {
      const last = accountLastContainer.get(account.id);
      const lastCycleNumber = last?.cycleNumber ?? 0;
      if (lastCycleNumber >= cap) {
        cappedCount++;
        continue;
      }
      const isDue = !last || (now.getTime() - last.createdAt >= intervalMs);
      if (isDue) {
        dueAccounts.push(account);
        nextCycleByAccount.set(account.id, lastCycleNumber + 1);
      }
    }

    if (!loop.is_infinite && validAccounts.length > 0 && cappedCount === validAccounts.length) {
      console.log(`[loop-cron] "${loop.name}": todas as contas atingiram o limite de ciclos/mídia → completed.`);
      await (admin as any).from("loops").update({ status: "completed" }).eq("id", loop.id);
      return "skipped";
    }

    if (dueAccounts.length === 0) {
      console.log(
        `[loop-cron] "${loop.name}": nenhuma conta devida ainda ` +
        `(intervalo de ${loop.interval_minutes}min por conta, ${cappedCount} no teto) — pulando.`
      );
      return "skipped";
    }

    console.log(
      `[loop-cron] "${loop.name}": ${dueAccounts.length}/${validAccounts.length} conta(s) devida(s) agora ` +
      `(${cappedCount} no teto de ciclos).`
    );

    const windowStartIso = now.toISOString();

    // ── FASE 1: Atribuição atômica de vídeos (só para quem está devido) ──────
    const videoAssignments = await assignVideosForLoop(
      admin, loop, allVideos, validAccounts, dueAccounts, windowStartIso
    );

    if (videoAssignments.size === 0) {
      return noteSkip(admin, loop, LOOP_SKIP_REASONS.noVideoAvailable());
    }

    // ── FASE 2: Dois sub-estágios ─────────────────────────────────────────────
    //
    // PRÉ-2a) FILA DE PROCESSAMENTO — O FFmpeg NÃO roda aqui.
    //   Cada conta tem um job em video_processing_jobs processado pelo cron
    //   process-videos (separado). Este cron apenas verifica se o job está pronto
    //   (status='done') e usa a URL processada. Se não está pronto, enfileira o
    //   job e pula a conta neste ciclo.
    //
    // 2a) PARALELO — idempotency + caption para contas com job done.
    // 2b) SEQUENCIAL — token refresh + criação de container Meta com jitter.

    // ── PRÉ-FASE 2a: Check da fila de processamento ──────────────────────────
    // Busca jobs existentes (queued/processing/done) apenas para as contas
    // devidas neste run — contas que já postaram recentemente (fora de
    // `dueAccounts`) não entram mais aqui, então não desperdiçam FFmpeg nem
    // ficam contando como "aguardando".
    const { data: existingJobRows } = await (admin as any)
      .from("video_processing_jobs")
      .select("id, account_id, status, output_url, video_id")
      .eq("loop_id", loop.id)
      .in("account_id", dueAccounts.map(a => a.id))
      .in("status", ["queued", "processing", "done"])
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    // Um job por conta (o mais recente)
    const existingJobsMap = new Map<string, { id: string; status: string; output_url: string | null; video_id: string }>();
    for (const job of (existingJobRows ?? [])) {
      if (!existingJobsMap.has(job.account_id)) {
        existingJobsMap.set(job.account_id, job);
      }
    }

    // Expiry do job: max(2h, interval + 90min) — garante que o job sobrevive até o próximo ciclo.
    // process-videos NÃO sobrescreve expires_at para não reduzir esse valor.
    const jobExpiresMs = Math.max(2 * 60 * 60_000, (loop.interval_minutes + 90) * 60_000);

    // Determina quais contas têm job done e quais precisam de novo job
    const processedVideoUrls = new Map<string, string>(); // accountId → URL processada
    const doneJobVideoIds    = new Map<string, string>(); // accountId → video_id do job done
    const jobsToInsert: Record<string, unknown>[] = [];
    let firstTimeInserts = 0;
    let pipelineInserts  = 0;
    let waitingAccounts  = 0; // contas com job queued/processing — aguardando process-videos

    const effectsPayload = {
      mirror: loop.effect_mirror,
      invert: loop.effect_invert,
      zoom:   loop.effect_zoom,
      blur:   loop.effect_blur,
      noise:  loop.effect_noise,
      antiAi: loop.effect_anti_ai,
    };

    // Se nenhum efeito criativo está ativo, pula o pipeline FFmpeg completamente:
    // usa a URL original de cada vídeo diretamente, sem passar pelo process-videos.
    // Isso evita dependência da tabela video_processing_jobs e do FFmpeg para o
    // caso padrão (sem efeitos), eliminando o travamento silencioso que impedia
    // todos os posts quando a tabela não existe ou o FFmpeg falha.
    const hasActiveEffects =
      loop.effect_mirror || loop.effect_invert || loop.effect_zoom ||
      loop.effect_blur   || loop.effect_noise  || loop.effect_anti_ai;

    if (!hasActiveEffects) {
      // Caminho direto: sem efeito criativo ativo, nao existe re-encode.
      //
      // O que roda aqui depende EXCLUSIVAMENTE da escolha do usuario no loop:
      //   original       -> a public_url do arquivo ORIGINAL vai direto pra Meta.
      //                     Zero FFmpeg, zero download, zero escrita no Storage.
      //   clean_metadata -> usa a VARIANTE (stream copy) preparada pelo cron
      //                     process-videos. Enquanto ela nao existe, a conta
      //                     apenas espera o proximo ciclo. Se o preparo falhar
      //                     em definitivo, a conta NAO publica - o video
      //                     original nunca entra no lugar da versao limpa.
      //
      // O original NUNCA e sobrescrito: videos_library.public_url permanece
      // apontando para o arquivo como ele entrou no AutoScale.
      const loopMode: VideoProcessingMode = normalizeProcessingMode(loop.video_processing_mode);
      let waitingVariants = 0;
      let failedVariants  = 0;

      for (const account of dueAccounts) {
        const assignment = videoAssignments.get(account.id);
        if (!assignment) continue;
        const video = assignment.video;

        const resolution = await resolveMediaUrlForMode(admin, {
          mode: loopMode,
          sourceUrl: video.public_url,
          sourceVideoId: video.id,
          userId: loop.user_id,
          scope: `loop-cron "${loop.name}" @${account.username}`,
        });

        if (resolution.status === "pending") {
          waitingVariants++;
          continue;
        }

        if (resolution.status === "error") {
          // Falha terminal do preparo: a conta fica sem postar neste ciclo e o
          // ORIGINAL nao e usado como substituto. Registra o motivo uma unica
          // vez por ciclo para aparecer no Monitor sem inundar a tabela.
          failedVariants++;
          const cycleNumber = nextCycleByAccount.get(account.id) ?? 1;
          const errorMsg = `[LIMPEZA DE METADADOS] ${resolution.reason}. Post nao enviado - o video original nao substitui a versao limpa.`;
          try {
            const { data: alreadyLogged } = await (admin as any)
              .from("pending_containers")
              .select("id")
              .eq("loop_id", loop.id)
              .eq("account_id", account.id)
              .eq("cycle_number", cycleNumber)
              .eq("status", "error")
              .ilike("error_message", "[LIMPEZA DE METADADOS]%")
              .limit(1);
            if (!alreadyLogged?.length) {
              await recordContainerError(admin, account, loop, "", errorMsg, video.id, cycleNumber);
            }
          } catch (logErr) {
            console.warn(`[loop-cron] "${loop.name}": falha ao registrar erro de variante: ${String(logErr)}`);
          }
          console.error(`[loop-cron] "${loop.name}" @${account.username}: ${errorMsg}`);
          continue;
        }

        processedVideoUrls.set(account.id, resolution.url);
      }

      console.log(
        `[loop-cron] "${loop.name}": modo ${loopMode} - ${processedVideoUrls.size} URL(s) pronta(s)` +
        (waitingVariants > 0 ? `, ${waitingVariants} aguardando variante` : "") +
        (failedVariants > 0 ? `, ${failedVariants} com falha de limpeza` : "") + "."
      );
    } else {
      // Caminho FFmpeg: usa a fila video_processing_jobs (requer tabela no banco).
      for (const account of dueAccounts) {
        const assignment  = videoAssignments.get(account.id);
        if (!assignment) continue;

        const existingJob = existingJobsMap.get(account.id);

        if (existingJob?.status === "done" && existingJob.output_url) {
          processedVideoUrls.set(account.id, existingJob.output_url);
          doneJobVideoIds.set(account.id, existingJob.video_id);
          jobsToInsert.push({
            user_id:    loop.user_id,
            loop_id:    loop.id,
            account_id: account.id,
            video_id:   assignment.video.id,
            source_url: assignment.video.public_url,
            effects:    effectsPayload,
            expires_at: new Date(Date.now() + jobExpiresMs).toISOString(),
          });
          pipelineInserts++;

        } else if (!existingJob) {
          jobsToInsert.push({
            user_id:    loop.user_id,
            loop_id:    loop.id,
            account_id: account.id,
            video_id:   assignment.video.id,
            source_url: assignment.video.public_url,
            effects:    effectsPayload,
            expires_at: new Date(Date.now() + jobExpiresMs).toISOString(),
          });
          firstTimeInserts++;

        } else {
          waitingAccounts++;
        }
      }

      if (jobsToInsert.length > 0) {
        const { error: insertErr } = await (admin as any)
          .from("video_processing_jobs")
          .insert(jobsToInsert);
        if (insertErr) {
          console.warn(`[loop-cron] Falha ao enfileirar jobs de vídeo: ${insertErr.message}`);
        } else {
          if (firstTimeInserts > 0) {
            console.log(`[loop-cron] "${loop.name}": ${firstTimeInserts} job(s) novos enfileirados para process-videos.`);
          }
          if (pipelineInserts > 0) {
            console.log(`[loop-cron] "${loop.name}": ${pipelineInserts} job(s) pipeline (próximo ciclo) enfileirados.`);
          }
        }
      }

    }

    const doneCount = processedVideoUrls.size;
    console.log(
      `[loop-cron] "${loop.name}" — ${doneCount} conta(s) com URL pronta. ` +
      (hasActiveEffects
        ? `fila: ${firstTimeInserts} novo(s), ${waitingAccounts} aguardando.`
        : `modo direto (sem efeitos).`)
    );

    type AccountPrep =
      | { kind: "skip";       account: AccountRow; reason: string }
      | { kind: "already_done"; account: AccountRow }
      | { kind: "ready";      account: AccountRow; assignment: VideoAssignment; caption: string; videoUrl: string };

    const t2aStart = Date.now();

    console.log(
      `[loop-cron] "${loop.name}" — ${dueAccounts.length} conta(s) devida(s), ` +
      `${videoAssignments.size} atribuição(ões). Iniciando FASE 2a (paralelo).`
    );

    // ── FASE 2a: paralelo ─────────────────────────────────────────────────────
    const prepSettled = await Promise.allSettled(
      dueAccounts.map(async (account): Promise<AccountPrep> => {
        if (!account.meta_access_token || !account.ig_business_account_id) {
          return { kind: "skip", account, reason: "sem credenciais Meta" };
        }

        const assignment = videoAssignments.get(account.id);
        if (!assignment) {
          return { kind: "skip", account, reason: "sem vídeo pré-atribuído" };
        }

        const accountCycleNumber = nextCycleByAccount.get(account.id) ?? 1;
        const alreadyDone = await containerAlreadyExists(admin, loop.id, account.id, accountCycleNumber);
        if (alreadyDone) return { kind: "already_done", account };

        // Parse captions (isolado por conta — sem estado compartilhado)
        const rawCaptions = loop.captions;
        let loopCaptionsRaw: string[];
        if (Array.isArray(rawCaptions)) {
          loopCaptionsRaw = (rawCaptions as unknown[]).map(c => String(c ?? "").trim()).filter(Boolean);
        } else if (typeof rawCaptions === "string") {
          const trimmed = (rawCaptions as string).trim();
          if (trimmed.startsWith("[")) {
            try {
              const parsed = JSON.parse(trimmed);
              loopCaptionsRaw = Array.isArray(parsed)
                ? (parsed as unknown[]).map(c => String(c ?? "").trim()).filter(Boolean)
                : [trimmed];
            } catch {
              loopCaptionsRaw = trimmed ? [trimmed] : [];
            }
          } else {
            loopCaptionsRaw = trimmed ? [trimmed] : [];
          }
        } else if (rawCaptions !== null && rawCaptions !== undefined) {
          loopCaptionsRaw = [String(rawCaptions).trim()].filter(Boolean);
        } else {
          loopCaptionsRaw = [];
        }
        Object.freeze(loopCaptionsRaw);

        const fileSizeMB = assignment.video.file_size
          ? (assignment.video.file_size / 1_048_576).toFixed(1) + " MB"
          : "desconhecido";

        if (assignment.video.file_size && assignment.video.file_size < 2_000_000) {
          console.warn(
            `[loop-cron] ⚠️ QUALIDADE BAIXA @${account.username}: ` +
            `"${assignment.video.filename}" tem apenas ${fileSizeMB}.`
          );
        }

        console.log(
          `[loop-cron] @${account.username} | pool: ${loopCaptionsRaw.length} variação(ões) | ` +
          `vídeo: "${assignment.video.filename}" (${fileSizeMB}) | cicloReset: ${assignment.isCycleReset}`
        );

        // ── Legenda ─────────────────────────────────────────────────────
        // O modo decide a FONTE do texto; a resolução acontece aqui, com o
        // vídeo já escolhido, e o resultado é gravado no container (snapshot).
        // Mudar o Loop ou a legenda do vídeo depois não altera o que já saiu.
        const captionMode: CaptionMode = normalizeCaptionMode(loop.caption_mode);

        // "custom" é o comportamento histórico: pool digitado no painel ou
        // legenda automática. Preservado exatamente como era.
        let customCaption = "";
        if (captionMode === "custom") {
          if (isAutoCaption) {
            customCaption = getAutoCaption(
              (loop.auto_caption_type ?? "curiosidades-gerais") as import("@/lib/auto-captions").AutoCaptionType
            );
            console.log(
              `[auto-caption] @${account.username} | tipo: ${loop.auto_caption_type} | ` +
              `"${customCaption.slice(0, 80)}${customCaption.length > 80 ? "…" : ""}"`
            );
          } else {
            customCaption = selectDynamicCaption(loopCaptionsRaw);
            const xStatus = customCaption
              ? `"${customCaption.slice(0, 80)}${customCaption.length > 80 ? "…" : ""}"`
              : "VAZIA!!!";
            console.log(
              `[RAIO-X] @${account.username} | Pool: ${loopCaptionsRaw.length} variação(ões) | ` +
              `Sorteada: ${xStatus} | CicloReset: ${assignment.isCycleReset}`
            );
          }
        }

        const resolucao = resolveCaption({
          mode: captionMode,
          originalCaption: assignment.video.caption,
          customCaption,
          stripHashtags: loop.caption_strip_hashtags === true,
          stripMentions: loop.caption_strip_mentions === true,
        });

        // Legenda fora dos limites do Instagram (tamanho, hashtags ou menções)
        // NÃO é cortada nem podada em silêncio: a conta é pulada e o motivo
        // fica registrado como erro de container, visível na aba Loop do
        // Monitor. A validação é do TEXTO FINAL — depois do strip, se ligado.
        if (!resolucao.validation.valid) {
          const motivo = captionRejectionMessage(resolucao.validation, assignment.video.filename);
          console.error(
            `[caption] @${account.username} | ${resolucao.validation.error?.code} | ` +
            `chars=${resolucao.length} hashtags=${resolucao.hashtags} mentions=${resolucao.mentions}`
          );
          await recordContainerError(
            admin, account, loop, "", motivo, assignment.video.id, accountCycleNumber
          );
          return { kind: "skip", account, reason: "legenda fora dos limites do Instagram" };
        }

        if (resolucao.missingOriginal) {
          // SEM FALLBACK: publica sem legenda. Nunca troca por custom/automática.
          console.log(
            `[caption] @${account.username} | modo=original | vídeo "${assignment.video.filename}" ` +
            `sem legenda original → publicando SEM legenda (sem fallback)`
          );
        } else {
          console.log(
            `[caption] @${account.username} | modo=${captionMode} | ${resolucao.length} chars` +
            (captionMode === "original"
              ? ` | fonte: legenda do próprio vídeo (${assignment.video.filename})`
              : "")
          );
        }

        const caption = resolucao.caption;

        // URL processada pelo process-videos (fingerprint único por conta).
        // Se não está pronta, a conta foi pulada antes — este ponto nunca é atingido sem URL.
        const videoUrl = processedVideoUrls.get(account.id);
        if (!videoUrl) {
          return { kind: "skip", account, reason: "vídeo em processamento (aguardando fila)" };
        }

        return { kind: "ready", account, assignment, caption, videoUrl };
      })
    );

    console.log(
      `[loop-cron] "${loop.name}" — FASE 2a concluída em ${Date.now() - t2aStart}ms ` +
      `(${prepSettled.length} conta(s) em paralelo). Iniciando FASE 2b (Meta API sequencial).`
    );

    // ── FASE 2b: sequencial + jitter 1–3s ─────────────────────────────────────
    // containersCreated NÃO é redeclarado aqui — usa a variável hoisted do escopo
    // da função (linha ~612), que o `finally` também lê. Redeclarar com `let`
    // sombreava a externa: os incrementos abaixo ficavam presos neste bloco `try`
    // e a externa nunca saía de 0, travando last_posted_at/cycles_done pra sempre.
    // Stagger dinâmico com jitter aleatório: distribui os containers dentro do
    // intervalo configurado + ruído aleatório de ±30% por conta para que a Meta
    // não detecte um padrão periódico fixo no timing de postagem.
    // Ex: 48 contas × 15 min → base 18.75s ± ~5s de jitter por conta.
    const autoStaggerSec = Math.max(
      5,
      (loop.interval_minutes * 60) / Math.max(validAccounts.length, 1)
    );
    const staggerBaseSec = loop.account_stagger_seconds ?? autoStaggerSec;
    let newContainerIdx = 0;
    // Contador separado para o sleep anti-burst: DEVE ser incrementado por conta
    // tentada, não por container criado com sucesso. Sem isso, quando todos os
    // containers falham (ex: proxy down), containersCreated fica 0 → nenhum sleep
    // → 28 chamadas em burst com 150ms entre elas → proxy rejeita tudo em cascata.
    let phase2bAttempts = 0;

    // Fila de erros críticos — aplicados DEPOIS do loop para detecção de cascata.
    // Guarda de cascata (≥4 contas E ≥60% do loop) e marcação centralizadas em
    // lib/account-health.ts (markDeadAccounts).
    const criticalErrorQueue: Array<{
      account: AccountRow;
      errorMsg: string;
      videoUrl: string;
      caption: string;
      videoId: string;
    }> = [];

    for (let i = 0; i < prepSettled.length; i++) {
      const settled = prepSettled[i];

      if (settled.status === "rejected") {
        const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        const acct = dueAccounts[i];
        console.error(`[loop-cron] ✗ Erro na FASE 2a @${acct?.username ?? "?"}: ${msg}`);
        if (acct) {
          await recordContainerError(
            admin, acct, loop, "", msg,
            videoAssignments.get(acct.id)?.video.id ?? "", nextCycleByAccount.get(acct.id) ?? 1
          );
        }
        continue;
      }

      const prep = settled.value;

      if (prep.kind === "skip") {
        console.warn(`[loop-cron] @${prep.account.username}: pulando (${prep.reason}).`);
        continue;
      }

      if (prep.kind === "already_done") {
        console.log(`[loop-cron] ⚡ @${prep.account.username}: container já existe — idempotente.`);
        containersCreated++;
        succeededAccountIds.add(prep.account.id);
        continue;
      }

      const { account, assignment, caption, videoUrl } = prep;
      const accountCycleNumber = nextCycleByAccount.get(account.id) ?? 1;

      // Jitter 1–3s anti-burst a partir da segunda conta TENTADA (independe de sucesso).
      // Bug anterior: condicionava em containersCreated > 0 — quando todos falham
      // o contador nunca sobe e nenhum sleep ocorre → burst de 28 chamadas em 3s.
      if (phase2bAttempts > 0) {
        const jitterMs = Math.floor(Math.random() * 2_000) + 1_000;
        console.log(`[loop-cron] @${account.username}: jitter ${(jitterMs / 1000).toFixed(1)}s…`);
        await sleep(jitterMs);
      }
      phase2bAttempts++;

      try {
        console.log(
          `[RAIO-X-FINAL] @${account.username} | caption_final (${caption.length}c): ` +
          `"${caption.slice(0, 100)}${caption.length > 100 ? "…" : ""}"`
        );

        // meta_access_token é garantidamente non-null aqui: a FASE 2a só retorna
        // kind="ready" após checar `!account.meta_access_token` e pular a conta.
        let tokenToUse: string = account.meta_access_token!;
        if (isTokenExpiringSoon(account.token_expires_at, 7)) {
          try {
            const { token, expiresAt } = await refreshMetaToken(account.meta_access_token!, account.fb_page_id);
            await (admin as any)
              .from("instagram_accounts")
              .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
              .eq("id", account.id);
            tokenToUse = token;
            console.log(`[loop-cron] Token renovado para @${account.username}.`);
          } catch {
            console.warn(`[loop-cron] Falha ao renovar token @${account.username} — usando atual.`);
          }
        }

        let initialDelayMinutes: number;
        if (loop.account_stagger_seconds) {
          // Stagger customizado: distribuição exata sem jitter.
          // Cap em (interval - 1 min) para garantir que o último container
          // seja publicado antes do próximo ciclo de process-loops.
          const rawDelaySec = newContainerIdx * staggerBaseSec;
          const maxDelaySec = Math.max(0, (loop.interval_minutes - 1) * 60);
          initialDelayMinutes = Math.min(rawDelaySec, maxDelaySec) / 60;
        } else {
          // Auto: jitter ±30% + cap em 50% do interval
          const jitter = staggerBaseSec * 0.3 * (Math.random() * 2 - 1);
          const rawDelayMinutes = Math.max(0, (newContainerIdx * staggerBaseSec + jitter)) / 60;
          initialDelayMinutes = Math.min(rawDelayMinutes, Math.max(0, Math.floor(loop.interval_minutes * 0.5)));
        }

        // Usa o video_id do job done (pode ser diferente da atribuição aleatória atual)
        const videoIdToUse = doneJobVideoIds.get(account.id) ?? assignment.video.id;

        try {
          await createContainerForAccount(
            admin, account, loop, videoUrl, caption, tokenToUse,
            videoIdToUse, accountCycleNumber,
            initialDelayMinutes
          );
        } catch (createErr) {
          const createMsg = createErr instanceof Error ? createErr.message : String(createErr);
          // Falha de rede com a Meta (não é resposta de erro dela): pula a conta
          // neste ciclo sem gravar container de erro — tenta no próximo intervalo.
          if (createMsg.toLowerCase() === "fetch failed") {
            console.error(`[loop-cron] @${account.username}: rede falhou ao criar container — conta pulada neste ciclo.`);
            continue;
          }
          throw createErr;
        }

        newContainerIdx++;
        containersCreated++;
        succeededAccountIds.add(account.id);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // Rate limit temporário da Meta — pula silenciosamente sem gravar erro.
        // O próximo ciclo (interval_minutes) tentará de novo automaticamente.
        // Gravar container de erro aqui causaria acúmulo infinito de erros no monitor
        // e chamadas desnecessárias à Meta API enquanto a conta está throttled.
        if (isRateLimitError(msg)) {
          console.warn(
            `[loop-cron] ⏸ @${account.username}: rate limit Meta ("${msg.slice(0, 80)}") — ` +
            `pulando este ciclo sem erro. Tentará de novo em ${loop.interval_minutes} min.`
          );
          continue;
        }

        console.error(`[loop-cron] ✗ @${account.username}: ${msg}`);

        // Usa o video_id do job done (vídeo realmente tentado), não o da atribuição atual.
        const errorVideoId = doneJobVideoIds.get(account.id) ?? assignment.video.id;

        await recordContainerError(
          admin, account, loop, caption, msg,
          errorVideoId, accountCycleNumber
        );

        if (isCriticalMetaError(msg)) {
          // Adia a marcação de error — processada em lote após o loop de contas.
          // Permite detecção de cascata: se ≥30% das contas errarem criticamente
          // no mesmo ciclo, trata como outage da Meta e não marca nenhuma.
          criticalErrorQueue.push({
            account,
            errorMsg: msg,
            videoUrl,
            caption,
            videoId: errorVideoId,
          });
          console.warn(
            `[loop-cron] ⏳ @${account.username}: erro crítico enfileirado para avaliação de cascata ` +
            `(${criticalErrorQueue.length}/${dueAccounts.length} até agora).`
          );
        }
      }
    }

    // ── Processa fila de erros críticos com detecção de cascata ──────────────
    // Threshold: CASCADE_MIN_COUNT=4 contas E CASCADE_RATIO≥60% do loop erraram
    // criticamente = outage da Meta (lib/account-health.ts).
    if (criticalErrorQueue.length > 0) {
      // Marcação centralizada em lib/account-health.ts: guarda de cascata
      // (≥4 contas E ≥60% do loop = outage da Meta, ninguém é marcado) + update
      // health_status + failover_logs com o motivo real (AccountHealthBanner
      // deixa de mostrar "Erro Desconhecido" para quedas detectadas pelo loop).
      // Failover cross-conta segue DESATIVADO: conta com erro apenas para;
      // nenhuma outra conta assume o post dela.
      await markDeadAccounts(
        admin,
        "loop-cron",
        criticalErrorQueue.map(item => ({
          accountId: item.account.id,
          username: item.account.username,
          userId: loop.user_id,
          reason: item.errorMsg,
        })),
        dueAccounts.length
      );
    }

    console.log(
      `[loop-cron] "${loop.name}": ${containersCreated}/${dueAccounts.length} container(s) neste run.`
    );
    // Voltou a criar container = o aviso do card não vale mais.
    if (containersCreated > 0 && loop.last_skip_reason) {
      await clearSkipNote(admin, loop.id);
    }
    return containersCreated > 0 ? "processed" : "skipped";

  } catch (loopErr) {
    const loopErrMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);
    console.error(`[loop-cron] ✗ Erro inesperado no loop "${loop.name}": ${loopErrMsg}`);
    return "error";
  } finally {
    // Sem CLAIM, não há nada pra reverter — atualiza `last_posted_at`/`cycles_done`
    // apenas de forma informativa (exibição no card do loop e no analytics),
    // best-effort, sem gate de concorrência: a verdade sobre due/not-due de cada
    // conta vem sempre de `pending_containers`, nunca destes dois campos.
    if (containersCreated > 0) {
      try {
        const cyclesPerAccount = validAccounts.map(a => {
          const pre = accountLastContainer.get(a.id)?.cycleNumber ?? 0;
          return succeededAccountIds.has(a.id)
            ? Math.max(pre, nextCycleByAccount.get(a.id) ?? pre)
            : pre;
        });
        const cyclesDoneDisplay = cyclesPerAccount.length > 0 ? Math.min(...cyclesPerAccount) : loop.cycles_done;
        await (admin as any)
          .from("loops")
          .update({ last_posted_at: now.toISOString(), cycles_done: cyclesDoneDisplay })
          .eq("id", loop.id);
      } catch (displayErr) {
        console.warn(`[loop-cron] Falha ao atualizar last_posted_at/cycles_done informativos: ${String(displayErr)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();

  // ── CLEANUP: Arquivos temporários (temp/vfx_*, vpf_*, strip_*, clone_*) ────
  // A fila de efeitos criativos sobe arquivos para temp/ mas nunca deleta
  // após o uso (strip_* e clone_* são legado: o auto-strip saiu em 2026-09-06
  // e o prefetch do Clone parou de usar temp/ em 2026-09-20). Limpamos
  // arquivos com mais de 2h a cada run.
  //
  // ATENÇÃO: esta limpeza é por IDADE, então só serve para arquivo de vida
  // curta — usado minutos depois de criado. A mídia do Clone ficava aqui e
  // morria em 2h no meio de campanhas de dias; hoje ela vive em clone/ e é
  // podada por REFERÊNCIA no prefetch-clone-urls. Nada com vida longa pode
  // voltar para temp/.
  // IMPORTANTE: cada prefixo é listado (e portanto apagado) SEPARADAMENTE via
  // `search`. Um list() único sobre toda a pasta temp/, ordenado por
  // created_at asc, ficava starved para sempre assim que um prefixo sem
  // limpeza própria (ex: strip_*) acumulava >100 arquivos antigos — eles
  // dominavam o topo da lista e nenhum outro prefixo era sequer avaliado.
  {
    const cleanupCutoff = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();
    const TEMP_PREFIXES = ["vfx_", "vpf_", "strip_", "clone_"];
    for (const prefix of TEMP_PREFIXES) {
      try {
        const { data: tempFiles } = await admin.storage
          .from("videos-library")
          .list("temp", { limit: 500, search: prefix, sortBy: { column: "created_at", order: "asc" } });

        const toDelete = (tempFiles ?? [])
          .filter(f => f.name.startsWith(prefix) && f.created_at && f.created_at < cleanupCutoff)
          .map(f => `temp/${f.name}`);

        if (toDelete.length > 0) {
          await admin.storage.from("videos-library").remove(toDelete);
          console.log(`[cleanup] ${toDelete.length} arquivo(s) temp/${prefix}* removidos (>2h).`);
        }
      } catch (cleanupErr) {
        // Best-effort — não deve travar o cron
        console.warn(`[cleanup] Falha ao limpar temp/${prefix}*:`, String(cleanupErr));
      }
    }
  }

  // ── AUTO-HEALING: Desbloquear pending_containers fantasmas ────────────────
  // Exclui containers em backoff intencional (retry_after > now) — esses estão
  // aguardando recuperação do rate-limit da Meta e NÃO devem ser mortos.
  {
    const healCutoff = new Date(now.getTime() - 90 * 60_000).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("pending_containers")
      .update({
        status: "error",
        error_message:
          "[AUTO-HEALING] Container preso >90 min em pending/publishing — desbloqueado pelo process-loops.",
      })
      .in("status", ["pending", "publishing"])
      .lt("created_at", healCutoff)
      .or(`retry_after.is.null,retry_after.lte.${now.toISOString()}`)
      .select("id");

    if (healErr) {
      console.warn("[AUTO-HEALING] Falha ao desbloquear containers fantasmas:", healErr.message);
    } else {
      const healedCount = healed?.length ?? 0;
      if (healedCount > 0) {
        console.log(`[AUTO-HEALING] Destravando ${healedCount} container(s) presos.`);
      } else {
        console.log("[AUTO-HEALING] Fila saudável — nenhum container fantasma detectado.");
      }
    }
  }

  // ── Busca todos os loops ativos com suas contas ──────────────────────────
  const { data: loopRows, error: fetchErr } = await (admin as any)
    .from("loops")
    .select(`
      id, user_id, name, folder_id, account_folder_id, is_infinite, cycles, cycles_done, current_cycle,
      interval_minutes, account_stagger_seconds, media_limit, captions, effect_mirror, effect_invert,
      effect_zoom, effect_blur, effect_noise, effect_anti_ai, video_processing_mode, share_to_feed,
      auto_caption_enabled, auto_caption_type,
      caption_mode, caption_strip_hashtags, caption_strip_mentions,
      last_posted_at, last_skip_reason,
      library_folders ( name ),
      loop_accounts (
        account_id,
        instagram_accounts (
          id, username, is_active, meta_access_token,
          ig_business_account_id, token_expires_at, fb_page_id,
          health_status, failover_priority
        )
      )
    `)
    .eq("status", "active");

  if (fetchErr) {
    console.error("[loop-cron] Erro ao buscar loops:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const loops = (loopRows ?? []) as LoopRow[];

  // Todos os loops ativos são processados a cada run — não há mais um gate
  // por `loop.last_posted_at` no nível do loop inteiro (esse campo agora é só
  // informativo). Quem decide se HÁ trabalho a fazer é o due-check POR CONTA
  // dentro de processOneLoop; loops sem nenhuma conta devida retornam "skipped"
  // rapidamente (uma query barata), sem chamar a Meta API.
  const eligible = loops;

  console.log(`[loop-cron] ${loops.length} loop(s) ativo(s) — processando todos (due-check por conta).`);

  // ── Processa todos os loops elegíveis em PARALELO ─────────────────────────
  // Loops são completamente independentes (pastas, contas e claims distintos),
  // portanto podem rodar simultaneamente sem risco de conflito. Com 2+ loops,
  // o tempo total = max(tempo de um loop), não a soma — elimina o gargalo
  // sequencial que causava atraso em cascata quando múltiplos loops estavam elegíveis.
  const loopResults = await Promise.allSettled(
    eligible.map(loop => processOneLoop(loop, admin, now))
  );

  const summary = loopResults.reduce(
    (acc, r) => {
      if (r.status === "fulfilled") {
        if (r.value === "processed") acc.processed++;
        else if (r.value === "skipped") acc.skipped++;
        else acc.errors++;
      } else {
        acc.errors++;
      }
      return acc;
    },
    { total: eligible.length, processed: 0, skipped: 0, errors: 0 }
  );

  console.log("[loop-cron] ■ Resumo final:", summary);
  return NextResponse.json({ ok: true, ...summary });
}

