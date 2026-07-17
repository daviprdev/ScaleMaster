import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createMediaContainerOnly } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";
import { getProxyForAccount, recordProxyFailure } from "@/lib/proxy";
import { getAutoCaption } from "@/lib/auto-captions";
import { markDeadAccounts } from "@/lib/account-health";
import type { ProxyAgent } from "undici";

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
  loop_accounts: LoopAccountRow[];
  auto_caption_enabled?: boolean;
  auto_caption_type?: string | null;
}

interface HumanScheduleRow {
  user_id: string;
  is_active: boolean;
  start_time: string;
  end_time: string;
  timezone: string;
}

interface VideoRow {
  id: string;
  public_url: string;
  filename: string;
  file_size: number | null;
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
// Human schedule helper
// ---------------------------------------------------------------------------

function isWithinHumanSchedule(
  now: Date,
  timezone: string,
  startTime: string,
  endTime: string
): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const h = Number(parts.find(p => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
    const cur = h * 60 + m;
    const toMin = (t: string) => {
      const [th, tm] = t.split(":").map(Number);
      return th * 60 + (tm ?? 0);
    };
    const start = toMin(startTime);
    const end   = toMin(endTime);
    // Janela normal (ex: 09:00–17:00): start < end
    // Janela noturna crossing midnight (ex: 21:00–09:00): start > end
    return start <= end
      ? cur >= start && cur < end
      : cur >= start || cur < end;
  } catch {
    return true;
  }
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
  _windowStartIso: string // mantido na assinatura para compatibilidade, mas não usado
): Promise<boolean> {
  const { data } = await (admin as any)
    .from("pending_containers")
    .select("id")
    .eq("loop_id", loopId)
    .eq("account_id", accountId)
    .in("status", ["pending", "publishing"])
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
  initialDelayMinutes = 0,
  proxy: ProxyAgent | null = null
): Promise<void> {
  const creationId = await createMediaContainerOnly(
    account.ig_business_account_id!,
    videoUrl,
    caption,
    tokenToUse,
    proxy
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
// Remove conta de todos os loop_accounts após erro crítico irrecuperável.
// Contas mortas (banidas, não-confirmadas, pessoais sem API) não devem
// continuar consumindo ciclos do cron nem rate-limit da Meta.
// ---------------------------------------------------------------------------

async function removeFromAllLoops(
  admin: ReturnType<typeof getSupabaseAdmin>,
  accountId: string,
  username: string
): Promise<void> {
  try {
    const { error } = await (admin as any)
      .from("loop_accounts")
      .delete()
      .eq("account_id", accountId);
    if (error) {
      console.warn(`[loop-cron] Falha ao remover @${username} dos loops: ${error.message}`);
    } else {
      console.log(`[loop-cron] 🗑️ @${username} removida de todos os loops (conta morta/inválida).`);
    }
  } catch (e) {
    console.warn(`[loop-cron] Exceção ao remover @${username} dos loops: ${String(e)}`);
  }
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
  validAccounts: AccountRow[],
  windowStartIso: string
): Promise<Map<string, VideoAssignment>> {
  // Busca paralela: histórico por conta + vídeos já tomados nesta janela.
  // Histórico atravessa TODAS as origens (Loop via pending_containers +
  // Postar/Clonar/Automatizar via scheduled_posts), sem escopo por loop_id:
  // histórico por loop fazia cada loop novo repostar tudo que a conta já
  // postou por outros loops/abas — mesmo vídeo chegou a sair 9× na mesma conta.
  const accountIds = validAccounts.map(a => a.id);
  const [containersHistRes, scheduledHistRes, jobsHistRes, windowClaimsRes] = await Promise.all([
    (admin as any)
      .from("pending_containers")
      .select("account_id, video_id")
      .in("account_id", accountIds)
      .neq("status", "error")
      .not("video_id", "is", null)
      .limit(100000),
    (admin as any)
      .from("scheduled_posts")
      .select("account_id, video_id")
      .in("account_id", accountIds)
      .in("status", ["pending", "publishing", "published"])
      .not("video_id", "is", null)
      .limit(100000),
    // Vídeos RESERVADOS em jobs de processamento (modo efeitos): o vídeo do
    // container vem do job enfileirado no ciclo ANTERIOR (doneJobVideoIds), não
    // da atribuição atual. Sem contar os jobs como reserva, a atribuição repete
    // o vídeo do job da própria conta no ciclo seguinte e distribui o mesmo
    // vídeo para várias contas (49 jobs / 24 vídeos distintos em produção).
    (admin as any)
      .from("video_processing_jobs")
      .select("account_id, video_id")
      .in("account_id", accountIds)
      .in("status", ["queued", "processing", "done"])
      .not("video_id", "is", null)
      .limit(100000),
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
  ]);

  const historyRows = [
    ...(((containersHistRes as { data?: { account_id: string; video_id: string }[] }).data) ?? []),
    ...(((scheduledHistRes as { data?: { account_id: string; video_id: string }[] }).data) ?? []),
    ...(((jobsHistRes as { data?: { account_id: string; video_id: string }[] }).data) ?? []),
  ];
  const postedByAccountMap = new Map<string, Set<string>>();
  // Uso global por vídeo entre as contas do loop: base do balanceamento que
  // impede o mesmo vídeo de sair em várias contas enquanto outros ficam parados.
  // Uso contado 1× por par conta+vídeo: um job consumido também vira container,
  // e contar as duas fontes dobraria o peso do vídeo no balanceamento.
  const usageByVideo = new Map<string, number>();
  for (const row of historyRows) {
    let set = postedByAccountMap.get(row.account_id);
    if (!set) { set = new Set(); postedByAccountMap.set(row.account_id, set); }
    if (!set.has(row.video_id)) {
      set.add(row.video_id);
      usageByVideo.set(row.video_id, (usageByVideo.get(row.video_id) ?? 0) + 1);
    }
  }

  const globallyTaken = new Set<string>(
    ((windowClaimsRes as { data?: { video_id: string }[] }).data ?? [])
      .map(r => r.video_id)
      .filter(Boolean)
  );

  console.log(
    `[assign-phase] "${loop.name}": ${globallyTaken.size} vídeo(s) já tomados nesta janela (guard inter-run).`
  );

  // Passagem síncrona: sem await entre as decisões — sem TOCTOU intra-run.
  // Cada conta tem pool INDEPENDENTE de todos os vídeos da pasta, mas o
  // desempate entre os disponíveis prioriza os vídeos de MENOR uso global —
  // evita o mesmo vídeo sair em várias contas quase ao mesmo tempo.
  const assignments = new Map<string, VideoAssignment>();

  for (let i = 0; i < validAccounts.length; i++) {
    const account = validAccounts[i];
    const postedByAccount = postedByAccountMap.get(account.id) ?? new Set<string>();

    // Pool individual: exclui apenas o que ESTA conta já postou.
    // globallyTaken serve de guard para invocações concorrentes (raramente populado
    // graças ao CLAIM atômico, mas mantido por segurança).
    let available = allVideos.filter(v => !postedByAccount.has(v.id) && !globallyTaken.has(v.id));

    let isCycleReset = false;
    if (available.length === 0 && loop.is_infinite) {
      // Ciclo completo para esta conta: reinicia o histórico dela.
      available = allVideos.filter(v => !globallyTaken.has(v.id));
      isCycleReset = available.length > 0;
      if (isCycleReset) {
        console.log(
          `[assign-phase] @${account.username}: ciclo completo (${postedByAccount.size} postados) ` +
          `→ reiniciando histórico.`
        );
      }
    }

    if (available.length === 0) {
      if (allVideos.length > 0) {
        // Loop não-infinito que esgotou todos os vídeos: wrap-around pelo índice.
        const fallbackIdx = i % allVideos.length;
        const fallbackVideo = allVideos[fallbackIdx];
        console.log(
          `[assign-phase] @${account.username}: wrap-around (esgotou ${allVideos.length} vídeo(s)) ` +
          `→ vídeo[${fallbackIdx}] "${fallbackVideo.filename.slice(0, 24)}".`
        );
        assignments.set(account.id, { video: fallbackVideo, isCycleReset: true });
      } else {
        console.warn(
          `[assign-phase] @${account.username}: sem vídeos na pasta (global=${globallyTaken.size}).`
        );
      }
      continue;
    }

    // Sorteia apenas entre os de menor uso global e incrementa em memória para
    // que as próximas contas DESTE run já enxerguem o vídeo como usado.
    const minUse = Math.min(...available.map(v => usageByVideo.get(v.id) ?? 0));
    const leastUsed = available.filter(v => (usageByVideo.get(v.id) ?? 0) === minUse);
    const video = leastUsed[Math.floor(Math.random() * leastUsed.length)];
    usageByVideo.set(video.id, (usageByVideo.get(video.id) ?? 0) + 1);
    assignments.set(account.id, { video, isCycleReset });
  }

  const summary = [...assignments.entries()]
    .map(([, a]) => `${a.video.filename.slice(0, 20)}${a.isCycleReset ? "*" : ""}`)
    .join(", ");
  console.log(
    `[assign-phase] "${loop.name}": ${assignments.size}/${validAccounts.length} conta(s) com vídeo atribuído (histórico por conta em todas as origens + menor uso global). ` +
    `[${summary}]`
  );

  return assignments;
}

// ---------------------------------------------------------------------------
// Processa um único loop elegível. Retorna o resultado para o resumo final.
// ---------------------------------------------------------------------------

type LoopOutcome = "processed" | "skipped" | "error";

async function processOneLoop(
  loop: LoopRow,
  admin: ReturnType<typeof getSupabaseAdmin>,
  now: Date,
  scheduleMap: Map<string, HumanScheduleRow>
): Promise<LoopOutcome> {

  // ── Horário Humano ─────────────────────────────────────────────────────────
  const schedule = scheduleMap.get(loop.user_id);
  if (schedule?.is_active) {
    const allowed = isWithinHumanSchedule(
      now, schedule.timezone, schedule.start_time, schedule.end_time
    );
    if (!allowed) {
      console.log(
        `[loop-cron] "${loop.name}" bloqueado pelo Horário Humano ` +
        `(fora de ${schedule.start_time}–${schedule.end_time} ${schedule.timezone}).`
      );
      return "skipped";
    }
  }

  // ── Contas válidas ─────────────────────────────────────────────────────────
  // Exclui contas marcadas como 'error' — evita ciclos infinitos de falha que
  // causam rate-limit na Meta e poluem a fila de pending_containers.
  // Quando account_folder_id está configurado, busca dinamicamente as contas
  // saudáveis da pasta — novas contas adicionadas entram automaticamente.
  let validAccounts: AccountRow[];
  if (loop.account_folder_id) {
    const { data: folderAccounts } = await (admin as any)
      .from("instagram_accounts")
      .select("id, username, is_active, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id, health_status, failover_priority, proxy_url")
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
    console.warn(`[loop-cron] "${loop.name}" sem contas ativas — pulando.`);
    return "skipped";
  }

  if (!loop.folder_id) {
    console.warn(`[loop-cron] "${loop.name}" sem pasta configurada — pulando.`);
    return "skipped";
  }

  // ── Busca todos os vídeos da pasta (pool global do loop) ───────────────────
  const { data: allVideoRows, error: videoErr } = await (admin as any)
    .from("videos_library")
    .select("id, public_url, filename, file_size")
    .eq("folder_id", loop.folder_id)
    .order("created_at", { ascending: true });

  if (videoErr || !allVideoRows?.length) {
    console.warn(`[loop-cron] "${loop.name}" sem vídeos na pasta — pulando.`);
    return "skipped";
  }

  const allVideos = allVideoRows as VideoRow[];

  const isAutoCaption = loop.auto_caption_enabled === true && !!loop.auto_caption_type;

  let loopClaimMade = false;
  let loopContainersCreated = 0;
  // Hoisted: newCyclesDone e isComplete precisam ser acessíveis no finally para revert do CLAIM.
  let newCyclesDone = loop.cycles_done + 1;
  let isComplete = false;
  // Pipeline ativo: jobs enfileirados ou aguardando process-videos.
  // Se true, NÃO reverter o CLAIM mesmo com 0 containers —
  // os containers serão criados no próximo ciclo quando os jobs ficarem 'done'.
  let loopPipelineActive = false;

  try {
    console.log(
      `[loop-cron] RAW SUPABASE DATA loop.captions:`,
      JSON.stringify(loop.captions),
      `| type: ${typeof loop.captions}`,
      `| isArray: ${Array.isArray(loop.captions)}`
    );

    // ── CLAIM: avança o estado do loop ANTES de processar contas ──────────────
    const cyclesExhausted = !loop.is_infinite && newCyclesDone >= loop.cycles;
    const mediaLimitReached =
      !loop.is_infinite &&
      loop.media_limit !== null &&
      loop.media_limit !== undefined &&
      newCyclesDone >= loop.media_limit;
    isComplete = cyclesExhausted || mediaLimitReached;

    // Claim verdadeiramente atômico: condiciona no last_posted_at que vimos no
    // fetch. Se outra invocação concorrente do cron já atualizou o loop (mudou
    // last_posted_at), o UPDATE afeta 0 rows — esta invocação aborta sem criar
    // containers duplicados.
    //
    // Sem esta condição, duas invocações simultâneas (crons sobrepostos) ambas
    // ganhariam o CLAIM e criariam containers duplicados → spam Meta API (#368).
    let claimQuery = (admin as any)
      .from("loops")
      .update({
        last_posted_at: now.toISOString(),
        cycles_done: newCyclesDone,
        ...(isComplete ? { status: "completed" } : {}),
      })
      .eq("id", loop.id);

    // Filtra pelo valor exato que vimos no fetch para garantir exclusão mútua.
    if (loop.last_posted_at === null || loop.last_posted_at === undefined) {
      claimQuery = claimQuery.is("last_posted_at", null);
    } else {
      claimQuery = claimQuery.eq("last_posted_at", loop.last_posted_at);
    }

    const { data: claimResult, error: claimErr } = await claimQuery.select("id");

    if (claimErr) throw new Error(`Falha no CLAIM: ${claimErr.message}`);
    if (!claimResult?.length) {
      console.warn(`[loop-cron] "${loop.name}": CLAIM retornou 0 rows — outra invocação concorrente já reivindicou. Pulando.`);
      return "skipped";
    }
    loopClaimMade = true;

    if (isComplete) {
      console.log(
        `[loop-cron] "${loop.name}" atingiu limite de execuções ` +
        `(${newCyclesDone}/${loop.is_infinite ? "∞" : loop.cycles}) → completed.`
      );
    }

    // Janela de idempotência: usa o momento do CLAIM (now) como fronteira.
    // Containers desta execução são criados APÓS now → ficam dentro da janela.
    // Containers da execução anterior foram criados antes do now anterior → fora da janela.
    // NUNCA usar interval_minutes aqui: isso incluiria os containers da execução anterior,
    // fazendo containerAlreadyExists() retornar true e pulando a postagem sem criar nada.
    const windowStartIso = now.toISOString();

    // ── FASE 1: Atribuição atômica de vídeos ──────────────────────────────────
    const videoAssignments = await assignVideosForLoop(
      admin, loop, allVideos, validAccounts, windowStartIso
    );

    if (videoAssignments.size === 0) {
      console.warn(`[loop-cron] "${loop.name}": sem vídeos disponíveis — pulando.`);
      return "skipped";
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
    // Busca jobs existentes (queued/processing/done) para todas as contas do loop.
    const { data: existingJobRows } = await (admin as any)
      .from("video_processing_jobs")
      .select("id, account_id, status, output_url, video_id")
      .eq("loop_id", loop.id)
      .in("account_id", validAccounts.map(a => a.id))
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
      // Caminho direto: sem FFmpeg, sem fila, sem espera de ciclo extra.
      for (const account of validAccounts) {
        const assignment = videoAssignments.get(account.id);
        if (assignment) processedVideoUrls.set(account.id, assignment.video.public_url);
      }
      console.log(
        `[loop-cron] "${loop.name}": sem efeitos ativos — ${processedVideoUrls.size} URL(s) originais usadas diretamente.`
      );
    } else {
      // Caminho FFmpeg: usa a fila video_processing_jobs (requer tabela no banco).
      for (const account of validAccounts) {
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

      loopPipelineActive = firstTimeInserts > 0 || waitingAccounts > 0;
    }

    const doneCount = processedVideoUrls.size;
    console.log(
      `[loop-cron] "${loop.name}" — ${doneCount} conta(s) com URL pronta. ` +
      (hasActiveEffects
        ? `fila: ${firstTimeInserts} novo(s), ${waitingAccounts} aguardando. pipelineActive=${loopPipelineActive}`
        : `modo direto (sem efeitos).`)
    );

    type AccountPrep =
      | { kind: "skip";       account: AccountRow; reason: string }
      | { kind: "already_done"; account: AccountRow }
      | { kind: "ready";      account: AccountRow; assignment: VideoAssignment; caption: string; videoUrl: string };

    const t2aStart = Date.now();

    console.log(
      `[loop-cron] "${loop.name}" — ${validAccounts.length} conta(s), ` +
      `${videoAssignments.size} atribuição(ões). Iniciando FASE 2a (paralelo).`
    );

    // ── FASE 2a: paralelo ─────────────────────────────────────────────────────
    const prepSettled = await Promise.allSettled(
      validAccounts.map(async (account): Promise<AccountPrep> => {
        if (!account.meta_access_token || !account.ig_business_account_id) {
          return { kind: "skip", account, reason: "sem credenciais Meta" };
        }

        const assignment = videoAssignments.get(account.id);
        if (!assignment) {
          return { kind: "skip", account, reason: "sem vídeo pré-atribuído" };
        }

        const alreadyDone = await containerAlreadyExists(admin, loop.id, account.id, windowStartIso);
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

        let caption: string;
        if (isAutoCaption) {
          caption = getAutoCaption(
            (loop.auto_caption_type ?? "curiosidades-gerais") as import("@/lib/auto-captions").AutoCaptionType
          );
          console.log(
            `[auto-caption] @${account.username} | tipo: ${loop.auto_caption_type} | ` +
            `"${caption.slice(0, 80)}${caption.length > 80 ? "…" : ""}"`
          );
        } else {
          caption = selectDynamicCaption(loopCaptionsRaw);
          const xStatus = caption
            ? `"${caption.slice(0, 80)}${caption.length > 80 ? "…" : ""}"`
            : "VAZIA!!!";
          console.log(
            `[RAIO-X] @${account.username} | Pool: ${loopCaptionsRaw.length} variação(ões) | ` +
            `Sorteada: ${xStatus} | CicloReset: ${assignment.isCycleReset}`
          );
        }

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
    let containersCreated = 0;
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
        const acct = validAccounts[i];
        console.error(`[loop-cron] ✗ Erro na FASE 2a @${acct?.username ?? "?"}: ${msg}`);
        if (acct) {
          await recordContainerError(
            admin, acct, loop, "", msg,
            videoAssignments.get(acct.id)?.video.id ?? "", newCyclesDone
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
        continue;
      }

      const { account, assignment, caption, videoUrl } = prep;

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
        const proxy = getProxyForAccount(account.id, account.proxy_url);
        let tokenToUse: string = account.meta_access_token!;
        if (isTokenExpiringSoon(account.token_expires_at, 7)) {
          try {
            const { token, expiresAt } = await refreshMetaToken(
              account.meta_access_token!,
              account.fb_page_id,
              proxy
            );
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
            videoIdToUse, newCyclesDone,
            initialDelayMinutes,
            proxy
          );
        } catch (proxyErr) {
          const proxyMsg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
          if (proxyMsg.toLowerCase() === "fetch failed" && proxy !== null) {
            // Proxy dedicado falhou → pula esta conta neste ciclo sem gravar container de erro.
            // Tentará novamente no próximo interval_minutes.
            console.error(
              `[loop-cron] ⛔ @${account.username}: proxy falhou (fetch failed) — ` +
              `conta pulada neste ciclo.`
            );
            await recordProxyFailure(admin, account.id, "loop", proxyMsg);
            continue;
          } else {
            throw proxyErr;
          }
        }

        newContainerIdx++;
        containersCreated++;

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
          errorVideoId, newCyclesDone
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
            `(${criticalErrorQueue.length}/${validAccounts.length} até agora).`
          );
        }
      }
    }

    // ── Processa fila de erros críticos com detecção de cascata ──────────────
    // Threshold: 2+ contas E ≥30% do loop erraram criticamente = outage da Meta.
    // Mínimo de 2 para não disparar com 1 conta em loop de conta única.
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
        validAccounts.length
      );
    }

    loopContainersCreated = containersCreated;
    return containersCreated > 0 ? "processed" : loopPipelineActive ? "skipped" : "error";

  } catch (loopErr) {
    const loopErrMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);
    console.error(`[loop-cron] ✗ Erro inesperado no loop "${loop.name}": ${loopErrMsg}`);
    return "error";
  } finally {
    if (loopClaimMade && loopContainersCreated === 0) {
      // Nenhum container criado — reverte o CLAIM para que o loop seja elegível
      // novamente no próximo minuto.
      // - Se pipelineActive=true (jobs FFmpeg enfileirados): verifica a cada minuto
      //   se process-videos terminou, em vez de esperar o intervalo inteiro (bug anterior).
      // - Se pipelineActive=false (sem jobs ativos): mantém o comportamento original
      //   de retry imediato.
      const reason = loopPipelineActive ? "aguardando process-videos" : "pipeline inativo";
      console.warn(
        `[AUTO-HEALING] Loop "${loop.name}" (${loop.id}): CLAIM revertido — 0 containers (${reason}).`
      );
      try {
        const revertPayload: Record<string, unknown> = {
          last_posted_at: loop.last_posted_at,
          cycles_done:    loop.cycles_done,
        };
        if (isComplete) revertPayload.status = "active";
        await (admin as any).from("loops").update(revertPayload).eq("id", loop.id);
        console.log(`[AUTO-HEALING] last_posted_at/cycles_done revertidos para "${loop.name}".`);
      } catch (revertErr) {
        const revertMsg = revertErr instanceof Error ? revertErr.message : String(revertErr);
        console.error(`[AUTO-HEALING] Falha ao reverter CLAIM de "${loop.name}": ${revertMsg}`);
      }
    } else if (loopClaimMade) {
      const pipelineNote = loopPipelineActive ? ` | pipeline ativo (aguardando process-videos)` : "";
      console.log(
        `[loop-cron] [FINALLY] "${loop.name}": ${loopContainersCreated} container(s)${pipelineNote} — OK.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[cron] AVISO: CRON_SECRET nao configurado.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();

  // ── CLEANUP: Arquivos temporários de efeitos de vídeo (temp/vfx_*) ─────────
  // video-effects.ts faz upload para temp/ mas não deleta após o publish.
  // Limpamos arquivos com mais de 2h a cada run do process-loops (a cada 15min).
  {
    const cleanupCutoff = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();
    try {
      const { data: tempFiles } = await admin.storage
        .from("videos-library")
        .list("temp", { limit: 100, sortBy: { column: "created_at", order: "asc" } });

      const toDelete = (tempFiles ?? [])
        .filter(f => (f.name.startsWith("vfx_") || f.name.startsWith("vpf_")) && f.created_at && f.created_at < cleanupCutoff)
        .map(f => `temp/${f.name}`);

      if (toDelete.length > 0) {
        await admin.storage.from("videos-library").remove(toDelete);
        console.log(`[cleanup] ${toDelete.length} arquivo(s) temp/vfx_* removidos (>2h).`);
      }
    } catch (cleanupErr) {
      // Best-effort — não deve travar o cron
      console.warn("[cleanup] Falha ao limpar arquivos temp:", String(cleanupErr));
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
      effect_zoom, effect_blur, effect_noise, effect_anti_ai,
      auto_caption_enabled, auto_caption_type,
      last_posted_at,
      loop_accounts (
        account_id,
        instagram_accounts (
          id, username, is_active, meta_access_token,
          ig_business_account_id, token_expires_at, fb_page_id,
          health_status, failover_priority, proxy_url
        )
      )
    `)
    .eq("status", "active");

  if (fetchErr) {
    console.error("[loop-cron] Erro ao buscar loops:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const loops = (loopRows ?? []) as LoopRow[];

  // ── Carrega configurações de horário humano (uma query para todos os users) ─
  const distinctUserIds = [...new Set(loops.map(l => l.user_id))];
  let scheduleMap = new Map<string, HumanScheduleRow>();

  if (distinctUserIds.length > 0) {
    const { data: scheduleRows } = await (admin as any)
      .from("human_schedule_settings")
      .select("user_id, is_active, start_time, end_time, timezone")
      .in("user_id", distinctUserIds);

    scheduleMap = new Map(
      ((scheduleRows ?? []) as HumanScheduleRow[]).map(r => [r.user_id, r])
    );
  }

  // ── Filtra loops que já passaram do intervalo mínimo ──────────────────────
  const eligible = loops.filter((loop) => {
    if (!loop.last_posted_at) return true;
    const nextRun = new Date(loop.last_posted_at).getTime() + loop.interval_minutes * 60_000;
    return now.getTime() >= nextRun;
  });

  console.log(`[loop-cron] ${loops.length} loop(s) ativo(s), ${eligible.length} elegível(eis) agora.`);

  // ── Processa todos os loops elegíveis em PARALELO ─────────────────────────
  // Loops são completamente independentes (pastas, contas e claims distintos),
  // portanto podem rodar simultaneamente sem risco de conflito. Com 2+ loops,
  // o tempo total = max(tempo de um loop), não a soma — elimina o gargalo
  // sequencial que causava atraso em cascata quando múltiplos loops estavam elegíveis.
  const loopResults = await Promise.allSettled(
    eligible.map(loop => processOneLoop(loop, admin, now, scheduleMap))
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

