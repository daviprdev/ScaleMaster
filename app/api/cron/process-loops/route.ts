import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createMediaContainerOnly } from "@/lib/meta-publish";
import { refreshMetaToken, isTokenExpiringSoon } from "@/lib/meta-refresh";

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
  last_posted_at: string | null;
  loop_accounts: LoopAccountRow[];
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
    return cur >= toMin(startTime) && cur < toMin(endTime);
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Video effects — delegado ao Railway (FastAPI + FFmpeg)
//
// O re-encode libx264 é pesado demais para a Vercel (timeout 300s).
// O worker Railway não tem limite de duração e tem FFmpeg nativo via Docker.
// PYTHON_SERVER_URL deve apontar para o serviço Railway (ex: https://xxx.railway.app).
// ---------------------------------------------------------------------------

interface VideoEffectOptions {
  mirror: boolean;
  invert: boolean;
  zoom: boolean;
  blur: boolean;
  noise: boolean;
  antiAi: boolean;
  accountId?: string;
}

async function applyVideoEffectsRemote(
  videoUrl: string,
  opts: VideoEffectOptions
): Promise<string> {
  const { mirror, invert, zoom, blur, noise, antiAi, accountId = "" } = opts;

  console.log(
    `[video-effects] opts: mirror=${mirror} invert=${invert} zoom=${zoom} ` +
    `blur=${blur} noise=${noise} antiAi=${antiAi} | RAILWAY_URL_SET=${!!process.env.PYTHON_SERVER_URL}`
  );

  if (!mirror && !invert && !zoom && !blur && !noise && !antiAi) {
    console.log("[video-effects] nenhum efeito ativo — retornando URL original.");
    return videoUrl;
  }

  const rawUrl = process.env.PYTHON_SERVER_URL;
  const railwaySecret = process.env.PYTHON_SERVER_SECRET;

  if (!rawUrl) {
    console.warn("[video-effects] PYTHON_SERVER_URL não configurado — pulando efeitos.");
    return videoUrl;
  }

  // Strip trailing slash para evitar barra dupla quando a env var vem com "/"
  const railwayUrl = rawUrl.replace(/\/+$/, "");

  const res = await fetch(`${railwayUrl}/video/effects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(railwaySecret ? { Authorization: `Bearer ${railwaySecret}` } : {}),
    },
    body: JSON.stringify({
      video_url: videoUrl,
      account_id: accountId,
      mirror,
      invert,
      zoom,
      blur,
      noise,
      anti_ai: antiAi,
    }),
    // 4.5 min — bem dentro do maxDuration 300s do cron; Railway não tem limite
    signal: AbortSignal.timeout(270_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Railway /video/effects: HTTP ${res.status} — ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("Railway /video/effects: resposta sem campo `url`.");

  console.log(`[video-effects] ✓ Railway processou efeitos → ${json.url.slice(-60)}`);
  return json.url;
}

// ---------------------------------------------------------------------------
// Idempotency — evita dupla submissão em re-tentativas do cron dentro da
// mesma janela de intervalo. Verifica por (loop, conta, janela de tempo).
// ---------------------------------------------------------------------------

async function containerAlreadyExists(
  admin: ReturnType<typeof getSupabaseAdmin>,
  loopId: string,
  accountId: string,
  windowStartIso: string
): Promise<boolean> {
  const { data } = await (admin as any)
    .from("pending_containers")
    .select("id")
    .eq("loop_id", loopId)
    .eq("account_id", accountId)
    .neq("status", "error")
    .gte("created_at", windowStartIso)
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
  cycleNumber: number
): Promise<void> {
  const creationId = await createMediaContainerOnly(
    account.ig_business_account_id!,
    videoUrl,
    caption,
    tokenToUse
  );
  const { error } = await (admin as any).from("pending_containers").insert({
    user_id: loop.user_id,
    loop_id: loop.id,
    account_id: account.id,
    ig_business_account_id: account.ig_business_account_id,
    creation_id: creationId,
    caption,
    video_id: videoId,
    cycle_number: cycleNumber,
  });
  if (error) throw new Error(`Falha ao salvar container: ${error.message}`);
  console.log(`[loop-cron] ✓ @${account.username} → container ${creationId} persistido.`);
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

function isCriticalMetaError(msg: string): boolean {
  const lower = msg.toLowerCase();
  const patterns = [
    "oauthexception", "invalid_token", "token has expired",
    "access token", "session has been invalidated",
    "account has been restricted", "blocked", "checkpoint",
    "error_code\":190", "error_code\":200",
    "error code 190", "error code 200",
  ];
  return patterns.some(p => lower.includes(p));
}

async function attemptFailover(
  admin: ReturnType<typeof getSupabaseAdmin>,
  failedAccount: AccountRow,
  loop: LoopRow,
  videoUrl: string,
  caption: string,
  errorMsg: string,
  windowStartIso: string,
  videoId: string,
  cycleNumber: number
): Promise<boolean> {
  await (admin as any)
    .from("instagram_accounts")
    .update({ health_status: "error" })
    .eq("id", failedAccount.id);

  const { data: backups } = await (admin as any)
    .from("instagram_accounts")
    .select("id, username, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id, is_active")
    .eq("user_id", loop.user_id)
    .eq("is_active", true)
    .eq("health_status", "online")
    .neq("id", failedAccount.id)
    .order("failover_priority", { ascending: true })
    .limit(1);

  const backup = backups?.[0] ?? null;

  // NUNCA usar .catch() no builder Supabase — usar try/catch com await.
  try {
    await (admin as any).from("failover_logs").insert({
      user_id: loop.user_id,
      failed_account_id: failedAccount.id,
      backup_account_id: backup?.id ?? null,
      error_reason: errorMsg.slice(0, 500),
    });
  } catch (logErr) {
    const logMsg = logErr instanceof Error ? logErr.message : String(logErr);
    console.warn(`[loop-cron] failover_logs: falha ao registrar evento (best-effort): ${logMsg}`);
  }

  if (!backup?.meta_access_token || !backup?.ig_business_account_id) {
    console.warn(`[loop-cron] Sem conta de backup disponível para "${loop.name}".`);
    return false;
  }

  const backupExists = await containerAlreadyExists(admin, loop.id, backup.id, windowStartIso);
  if (backupExists) {
    console.log(`[loop-cron] ⚡ @${backup.username} (backup): container já existe — idempotente.`);
    return true;
  }

  console.log(`[loop-cron] Failover: @${failedAccount.username} → @${backup.username}`);
  try {
    await createContainerForAccount(
      admin,
      { ...backup, is_active: true },
      loop,
      videoUrl,
      caption,
      backup.meta_access_token,
      videoId,
      cycleNumber
    );
    return true;
  } catch (backupErr) {
    const msg = backupErr instanceof Error ? backupErr.message : String(backupErr);
    console.error(`[loop-cron] ✗ @${backup.username} (failover):`, msg);
    await recordContainerError(admin, backup, loop, caption, msg, videoId, cycleNumber);
    return false;
  }
}

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
//  1. Busca o histórico de TODAS as contas em paralelo (Promise.allSettled)
//  2. Busca vídeos já reivindicados por QUALQUER conta nesta janela (guard inter-run)
//  3. Atribui vídeos em passagem síncrona única — sem async entre decisões.
//     Conta[0] → Vídeo A, Conta[1] → Vídeo B, etc. Nenhum vídeo repetido.
// ---------------------------------------------------------------------------

async function assignVideosForLoop(
  admin: ReturnType<typeof getSupabaseAdmin>,
  loop: LoopRow,
  allVideos: VideoRow[],
  validAccounts: AccountRow[],
  windowStartIso: string
): Promise<Map<string, VideoAssignment>> {
  // Busca paralela: histórico por conta + vídeos já tomados nesta janela
  const [historySettled, windowClaimsRes] = await Promise.all([
    Promise.allSettled(
      validAccounts.map(account =>
        (admin as any)
          .from("pending_containers")
          .select("video_id")
          .eq("loop_id", loop.id)
          .eq("account_id", account.id)
          .neq("status", "error")
          .not("video_id", "is", null)
      )
    ),
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

  const globallyTaken = new Set<string>(
    ((windowClaimsRes as { data?: { video_id: string }[] }).data ?? [])
      .map(r => r.video_id)
      .filter(Boolean)
  );

  console.log(
    `[assign-phase] "${loop.name}": ${globallyTaken.size} vídeo(s) já tomados nesta janela (guard inter-run).`
  );

  // Passagem síncrona: sem await entre as decisões — sem TOCTOU intra-run.
  const assignments = new Map<string, VideoAssignment>();
  const locallyAssigned = new Set<string>(); // reserva imediata para próximas contas desta passagem

  for (let i = 0; i < validAccounts.length; i++) {
    const account = validAccounts[i];
    const settled = historySettled[i];

    const postedByAccount = new Set<string>(
      settled.status === "fulfilled"
        ? ((settled.value as { data?: { video_id: string }[] }).data ?? []).map(r => r.video_id)
        : [] // falha no histórico → trata como vazio (best-effort)
    );

    if (settled.status === "rejected") {
      console.warn(
        `[assign-phase] @${account.username}: falha ao buscar histórico — tratando como vazio. ` +
        `Reason: ${String((settled as PromiseRejectedResult).reason)}`
      );
    }

    // Exclusão combinada: postados por esta conta + tomados globalmente + atribuídos localmente
    const alreadyUsed = new Set([...globallyTaken, ...locallyAssigned]);
    let available = allVideos.filter(v => !postedByAccount.has(v.id) && !alreadyUsed.has(v.id));

    let isCycleReset = false;
    if (available.length === 0 && loop.is_infinite) {
      // Ciclo completo para esta conta: limpa o histórico dela mas respeita o
      // lock global — outros vídeos já atribuídos nesta rodada permanecem exclusos.
      available = allVideos.filter(v => !alreadyUsed.has(v.id));
      isCycleReset = available.length > 0;
      if (isCycleReset) {
        console.log(
          `[assign-phase] @${account.username}: ciclo completo (${postedByAccount.size} postados) ` +
          `→ reiniciando histórico.`
        );
      }
    }

    if (available.length === 0) {
      console.warn(
        `[assign-phase] @${account.username}: nenhum vídeo disponível ` +
        `(pasta=${allVideos.length}, global=${globallyTaken.size}, local=${locallyAssigned.size}).`
      );
      continue;
    }

    const video = available[0];
    assignments.set(account.id, { video, isCycleReset });
    locallyAssigned.add(video.id); // reserva imediata: próximas contas não verão este vídeo
  }

  const summary = [...assignments.entries()]
    .map(([, a]) => `${a.video.filename.slice(0, 20)}${a.isCycleReset ? "*" : ""}`)
    .join(", ");
  console.log(
    `[assign-phase] "${loop.name}": ${assignments.size}/${validAccounts.length} conta(s) com vídeo único atribuído. ` +
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
  const validAccounts = loop.loop_accounts
    .map(la => la.instagram_accounts)
    .filter((acc): acc is AccountRow => acc !== null && acc.is_active === true);

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

  // ── Pré-flight: verificar legendas ANTES do CLAIM ─────────────────────────
  // Se não há legendas, pular sem avançar last_posted_at — o loop não perde
  // o intervalo e tenta novamente no próximo ciclo do cron.
  const hasConfiguredCaptions = Array.isArray(loop.captions)
    ? (loop.captions as unknown[]).some(c => typeof c === "string" && (c as string).trim().length > 0)
    : typeof loop.captions === "string" && (loop.captions as string).trim().length > 0;

  if (!hasConfiguredCaptions) {
    console.warn(
      `[loop-cron] "${loop.name}" sem legendas configuradas — pulando sem avançar last_posted_at. ` +
      `Configure legendas no painel para ativar as postagens.`
    );
    return "skipped";
  }

  let loopClaimMade = false;
  let loopContainersCreated = 0;
  // Hoisted: newCyclesDone e isComplete precisam ser acessíveis no finally para revert do CLAIM.
  let newCyclesDone = loop.cycles_done + 1;
  let isComplete = false;

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

    await (admin as any).from("loops").update({
      last_posted_at: now.toISOString(),
      cycles_done: newCyclesDone,
      ...(isComplete ? { status: "completed" } : {}),
    }).eq("id", loop.id);
    loopClaimMade = true;

    if (isComplete) {
      console.log(
        `[loop-cron] "${loop.name}" atingiu limite de execuções ` +
        `(${newCyclesDone}/${loop.is_infinite ? "∞" : loop.cycles}) → completed.`
      );
    }

    const windowStartIso = new Date(
      now.getTime() - loop.interval_minutes * 60_000
    ).toISOString();

    // ── FASE 1: Atribuição atômica de vídeos ──────────────────────────────────
    const videoAssignments = await assignVideosForLoop(
      admin, loop, allVideos, validAccounts, windowStartIso
    );

    if (videoAssignments.size === 0) {
      console.warn(`[loop-cron] "${loop.name}": sem vídeos disponíveis — pulando.`);
      return "skipped";
    }

    // ── FASE 2: Dois sub-estágios para eliminar gargalo sequencial ───────────────
    //
    // 2a) PARALELO — idempotency + caption + Railway FFmpeg para TODAS as contas
    //     simultaneamente. Tempo total = max(1 vídeo), não N × (1 vídeo).
    //     Sem chamadas à Meta API aqui.
    //
    // 2b) SEQUENCIAL — token refresh + criação de container na Meta com jitter 1–3s.
    //     Meta API é rate-sensitive: serialização mínima mantida.
    //
    // Speedup: 5 contas × 30s FFmpeg sequencial → 30s FFmpeg paralelo (invariante em N).

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

        let caption = selectDynamicCaption(loopCaptionsRaw);

        {
          const xStatus = caption
            ? `"${caption.slice(0, 80)}${caption.length > 80 ? "…" : ""}"`
            : "VAZIA!!!";
          console.log(
            `[RAIO-X] @${account.username} | Pool: ${loopCaptionsRaw.length} variação(ões) | ` +
            `Sorteada: ${xStatus} | CicloReset: ${assignment.isCycleReset}`
          );
        }

        if (!caption) {
          // Não deve acontecer após o pré-flight check, mas é uma segunda linha de defesa.
          console.warn(`[loop-cron] SEM LEGENDA | @${account.username} | loop="${loop.name}" — pulando conta`);
          return { kind: "skip", account, reason: "sem legendas no loop" };
        }

        // Railway FFmpeg — dispara em paralelo; fallback para URL original se falhar
        let videoUrl = assignment.video.public_url;
        try {
          const processed = await applyVideoEffectsRemote(assignment.video.public_url, {
            mirror:    loop.effect_mirror,
            invert:    loop.effect_invert,
            zoom:      loop.effect_zoom,
            blur:      loop.effect_blur,
            noise:     loop.effect_noise,
            antiAi:    loop.effect_anti_ai,
            accountId: account.id,
          });
          if (processed) videoUrl = processed;
        } catch (fxErr) {
          const fxMsg = fxErr instanceof Error ? fxErr.message : String(fxErr);
          console.error(
            `[video-effects] ✗ @${account.username}: Railway falhou, postando sem efeito. ` +
            `Erro: ${fxMsg.slice(0, 200)}`
          );
          // videoUrl já está com a URL original — continua normalmente
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

      try {
        console.log(
          `[RAIO-X-FINAL] @${account.username} | caption_final (${caption.length}c): ` +
          `"${caption.slice(0, 100)}${caption.length > 100 ? "…" : ""}"`
        );

        // Jitter 1–3s anti-burst (somente a partir da segunda conta)
        if (containersCreated > 0) {
          const jitterMs = Math.floor(Math.random() * 2_000) + 1_000;
          console.log(`[loop-cron] @${account.username}: jitter ${(jitterMs / 1000).toFixed(1)}s…`);
          await sleep(jitterMs);
        }

        // meta_access_token é garantidamente non-null aqui: a FASE 2a só retorna
        // kind="ready" após checar `!account.meta_access_token` e pular a conta.
        let tokenToUse: string = account.meta_access_token!;
        if (isTokenExpiringSoon(account.token_expires_at, 7)) {
          try {
            const { token, expiresAt } = await refreshMetaToken(
              account.meta_access_token!,
              account.fb_page_id
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

        await createContainerForAccount(
          admin, account, loop, videoUrl, caption, tokenToUse,
          assignment.video.id, newCyclesDone
        );
        containersCreated++;

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[loop-cron] ✗ @${account.username}: ${msg}`);

        await recordContainerError(
          admin, account, loop, caption, msg,
          assignment.video.id, newCyclesDone
        );

        if (isCriticalMetaError(msg) && videoUrl) {
          try {
            const failoverOk = await attemptFailover(
              admin, account, loop, videoUrl, caption, msg, windowStartIso,
              assignment.video.id, newCyclesDone
            );
            if (failoverOk) containersCreated++;
          } catch (failoverErr) {
            const failoverMsg = failoverErr instanceof Error ? failoverErr.message : String(failoverErr);
            console.error(`[loop-cron] ✗ Failover falhou @${account.username}: ${failoverMsg}`);
          }
        }
      }
    }

    loopContainersCreated = containersCreated;
    return containersCreated > 0 ? "processed" : "error";

  } catch (loopErr) {
    const loopErrMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);
    console.error(`[loop-cron] ✗ Erro inesperado no loop "${loop.name}": ${loopErrMsg}`);
    return "error";
  } finally {
    if (loopClaimMade && loopContainersCreated === 0) {
      // Nenhum container foi criado com sucesso — reverter o CLAIM para que o
      // intervalo não seja consumido em vão. O loop será elegível novamente no
      // próximo ciclo do cron (em vez de só após interval_minutes desde o CLAIM).
      console.warn(
        `[AUTO-HEALING] Loop "${loop.name}" (${loop.id}): CLAIM revertido — 0 containers criados.`
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
      console.log(
        `[loop-cron] [FINALLY] "${loop.name}": ${loopContainersCreated} container(s) — OK.`
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
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();

  // ── AUTO-HEALING: Desbloquear pending_containers fantasmas ────────────────
  {
    const healCutoff = new Date(now.getTime() - 30 * 60_000).toISOString();
    const { data: healed, error: healErr } = await (admin as any)
      .from("pending_containers")
      .update({
        status: "error",
        error_message:
          "[AUTO-HEALING] Container preso >30 min em pending/publishing — desbloqueado pelo process-loops.",
      })
      .in("status", ["pending", "publishing"])
      .lt("created_at", healCutoff)
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
      id, user_id, name, folder_id, is_infinite, cycles, cycles_done, current_cycle,
      interval_minutes, media_limit, captions, effect_mirror, effect_invert,
      effect_zoom, effect_blur, effect_noise, effect_anti_ai,
      last_posted_at,
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
