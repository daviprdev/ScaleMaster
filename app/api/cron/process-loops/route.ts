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
}

// ---------------------------------------------------------------------------
// Dynamic Caption Selection (Spintax) — loops.captions DB column
// ---------------------------------------------------------------------------

/**
 * Seleção dinâmica de legenda a partir das variações configuradas no Loop.
 *
 * FONTE ÚNICA: loops.captions (text[] — preenchido pelo usuário no painel).
 * NUNCA lê videos_library.caption (sempre NULL para reels raspados).
 *
 * Estratégia (Spintax / rotação aleatória):
 *   Pool não-vazio → sorteia aleatoriamente entre as variações válidas.
 *   Pool vazio     → retorna "" (usuário não configurou legendas — comportamento esperado).
 *
 * Garante que undefined/null nunca chegue à Meta API como string literal.
 */
function selectDynamicCaption(rawCaptions: string[]): string {
  // Normaliza: trim + descarta entradas em branco (mesma lógica do filtro da UI)
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
// Rate-limit helper — espaça chamadas à Meta API para evitar throttling silencioso
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Video effects stub
// ---------------------------------------------------------------------------

async function processVideoEffects(
  videoUrl: string,
  effectMirror: boolean,
  effectInvert: boolean
): Promise<string> {
  if (!effectMirror && !effectInvert) return videoUrl;
  console.warn(
    `[loop-cron] Efeitos (mirror=${effectMirror}, invert=${effectInvert}) — ` +
    `worker de vídeo não configurado, passthrough.`
  );
  return videoUrl;
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
  await (admin as any).from("pending_containers").insert({
    user_id: loop.user_id,
    loop_id: loop.id,
    account_id: account.id,
    ig_business_account_id: account.ig_business_account_id ?? "",
    creation_id: "",
    caption,
    status: "error",
    error_message: errorMsg.slice(0, 500),
    video_id: videoId || null, // null quando não houve seleção de vídeo (erro prematuro)
    cycle_number: cycleNumber,
  }).catch(() => {/* best-effort — não bloqueia o restante */});
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

  await (admin as any).from("failover_logs").insert({
    user_id: loop.user_id,
    failed_account_id: failedAccount.id,
    backup_account_id: backup?.id ?? null,
    error_reason: errorMsg.slice(0, 500),
  }).catch(() => {});

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
// Cron handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // Bloqueia apenas quando CRON_SECRET está configurado E não bate
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();

  // ── Busca todos os loops ativos com suas contas ──────────────────────────
  const { data: loopRows, error: fetchErr } = await (admin as any)
    .from("loops")
    .select(`
      id, user_id, name, folder_id, is_infinite, cycles, cycles_done, current_cycle,
      interval_minutes, media_limit, captions, effect_mirror, effect_invert,
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

  const summary = { total: eligible.length, processed: 0, skipped: 0, errors: 0 };

  // ── Processa cada loop elegível ───────────────────────────────────────────
  for (const loop of eligible) {

    // ── Horário Humano ───────────────────────────────────────────────────────
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
        summary.skipped++;
        continue;
      }
    }

    // ── Contas válidas ───────────────────────────────────────────────────────
    const validAccounts = loop.loop_accounts
      .map(la => la.instagram_accounts)
      .filter((acc): acc is AccountRow => acc !== null && acc.is_active === true);

    if (validAccounts.length === 0) {
      console.warn(`[loop-cron] "${loop.name}" sem contas ativas — pulando.`);
      summary.skipped++;
      continue;
    }

    if (!loop.folder_id) {
      console.warn(`[loop-cron] "${loop.name}" sem pasta configurada — pulando.`);
      summary.skipped++;
      continue;
    }

    // ── Busca todos os vídeos da pasta (pool global do loop) ─────────────────
    const { data: allVideoRows, error: videoErr } = await (admin as any)
      .from("videos_library")
      .select("id, public_url, filename")
      .eq("folder_id", loop.folder_id)
      .order("created_at", { ascending: true });

    if (videoErr || !allVideoRows?.length) {
      console.warn(`[loop-cron] "${loop.name}" sem vídeos na pasta — pulando.`);
      summary.skipped++;
      continue;
    }

    const allVideos = allVideoRows as VideoRow[];

    // ── Core do loop — envolvido em try/catch para que um erro inesperado ──────
    // (ex: falha Supabase, remux, etc.) não interrompa o processamento dos demais loops.
    try {

    // ── RAW SUPABASE LOG — diagnóstico de regressão de legenda ──────────────
    console.log(
      `[loop-cron] RAW SUPABASE DATA loop.captions:`,
      JSON.stringify(loop.captions),
      `| type: ${typeof loop.captions}`,
      `| isArray: ${Array.isArray(loop.captions)}`
    );

    // ── CLAIM: avança o estado do loop ANTES de processar contas ─────────────
    // Garante que dois crons concorrentes não avancem o mesmo loop duas vezes.
    const newCyclesDone = loop.cycles_done + 1;
    const cyclesExhausted = !loop.is_infinite && newCyclesDone >= loop.cycles;
    const mediaLimitReached =
      !loop.is_infinite &&
      loop.media_limit !== null &&
      loop.media_limit !== undefined &&
      newCyclesDone >= loop.media_limit;
    const isComplete = cyclesExhausted || mediaLimitReached;

    await (admin as any).from("loops").update({
      last_posted_at: now.toISOString(),
      cycles_done: newCyclesDone,
      ...(isComplete ? { status: "completed" } : {}),
    }).eq("id", loop.id);

    if (isComplete) {
      console.log(
        `[loop-cron] "${loop.name}" atingiu limite de execuções ` +
        `(${newCyclesDone}/${loop.is_infinite ? "∞" : loop.cycles}) → completed.`
      );
    }

    const windowStartIso = new Date(
      now.getTime() - loop.interval_minutes * 60_000
    ).toISOString();

    // ── Set em memória: vídeos já atribuídos NESTE disparo ───────────────────
    const assignedThisRun = new Set<string>();

    let containersCreated = 0;

    console.log(
      `[loop-cron] "${loop.name}" — ${validAccounts.length} conta(s) para processar, ` +
      `${allVideos.length} vídeo(s) na pasta. Execução estritamente sequencial, 3s de throttle entre contas.`
    );

    // ── LOOP POR CONTA — execução estritamente sequencial, sem Promise.all ───
    //
    // Por conta:
    //   1. Parse de legendas recriado do ZERO (bloco isolado com {}) — sem reuso de estado
    //   2. Seleção de vídeo e legenda independentes desta iteração
    //   3. Submissão única para a Meta API
    //   4. Throttle de 3000ms APÓS a submissão, antes da próxima conta
    //
    // O throttle após (não antes) garante que o container foi aceito pela Meta
    // antes de iniciarmos a próxima requisição — evita burst e rate-limit silencioso.
    let accountIdx = 0;
    for (const account of validAccounts) {
      accountIdx++;

      if (!account.meta_access_token || !account.ig_business_account_id) {
        console.warn(`[loop-cron] @${account.username} sem credenciais Meta — pulando.`);
        continue;
      }

      // ── Estado local desta conta — zerado a cada iteração ────────────────
      let selectedVideo: VideoRow | null = null;
      let caption = "";
      let videoUrl = "";

      // ── Parse de legendas ISOLADO — recriado do zero neste bloco ─────────
      // Bloco {} garante que loopCaptionsRaw não vaza para a próxima iteração.
      // FONTE EXCLUSIVA: loops.captions. Nunca reutiliza resultado anterior.
      let loopCaptionsRaw: string[];
      {
        const rawCaptions = loop.captions;
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
          const asStr = String(rawCaptions).trim();
          loopCaptionsRaw = asStr ? [asStr] : [];
        } else {
          loopCaptionsRaw = [];
        }
      }

      console.log(
        `[loop-cron] @${account.username} [${accountIdx}/${validAccounts.length}] | ` +
        `pool de legendas isolado: ${loopCaptionsRaw.length} variação(ões)`
      );

      try {
        // ── Idempotência por janela de tempo ────────────────────────────────
        const alreadyDone = await containerAlreadyExists(
          admin, loop.id, account.id, windowStartIso
        );
        if (alreadyDone) {
          console.log(`[loop-cron] ⚡ @${account.username}: container já existe neste intervalo — pulando.`);
          containersCreated++;
          continue;
        }

        // ── Histórico POR CONTA ──────────────────────────────────────────────
        const { data: accountPostedRows } = await (admin as any)
          .from("pending_containers")
          .select("video_id")
          .eq("loop_id", loop.id)
          .eq("account_id", account.id)
          .neq("status", "error")
          .not("video_id", "is", null);

        const postedByAccount = new Set<string>(
          (accountPostedRows ?? []).map((r: { video_id: string }) => r.video_id)
        );

        // ── Seleção do vídeo ─────────────────────────────────────────────────
        let available = allVideos.filter(
          v => !postedByAccount.has(v.id) && !assignedThisRun.has(v.id)
        );

        let isNewCycleForAccount = false;

        if (available.length === 0) {
          if (loop.is_infinite) {
            available = allVideos.filter(v => !assignedThisRun.has(v.id));
            isNewCycleForAccount = true;
            console.log(
              `[loop-cron] @${account.username}: ciclo completo ` +
              `(${postedByAccount.size} vídeos postados) → reiniciando histórico para esta conta.`
            );
          } else {
            console.log(`[loop-cron] @${account.username}: todos os vídeos postados (loop finito) — pulando.`);
            continue;
          }
        }

        if (available.length === 0) {
          console.warn(
            `[loop-cron] @${account.username}: nenhum vídeo disponível — ` +
            `${assignedThisRun.size} vídeo(s) já atribuídos neste disparo.`
          );
          continue;
        }

        selectedVideo = available[0];
        assignedThisRun.add(selectedVideo.id);

        // ── Legenda — selecionada do pool isolado desta iteração ─────────────
        caption = selectDynamicCaption(loopCaptionsRaw);

        if (!caption) {
          caption = '🔥 [TESTE DE SISTEMA] Legenda de emergência.';
          console.warn(
            `[loop-cron] FALLBACK EMERGÊNCIA | @${account.username} | loop="${loop.name}" — pool vazio.`
          );
        }

        console.log(
          `[loop-cron] AUDIT | "${loop.name}" | @${account.username} → ` +
          `Vídeo: "${selectedVideo.filename}" | ` +
          `Legenda (${caption.length}c): "${caption.slice(0, 80)}${caption.length > 80 ? "…" : ""}" | ` +
          `NovoCiclo: ${isNewCycleForAccount}`
        );

        // ── Efeitos de vídeo ─────────────────────────────────────────────────
        videoUrl = await processVideoEffects(
          selectedVideo.public_url,
          loop.effect_mirror,
          loop.effect_invert
        );
        if (!videoUrl) videoUrl = selectedVideo.public_url;

        // ── Token refresh preventivo ─────────────────────────────────────────
        let tokenToUse = account.meta_access_token;
        if (isTokenExpiringSoon(account.token_expires_at, 7)) {
          try {
            const { token, expiresAt } = await refreshMetaToken(
              account.meta_access_token,
              account.fb_page_id
            );
            await (admin as any)
              .from("instagram_accounts")
              .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
              .eq("id", account.id);
            tokenToUse = token;
            console.log(`[loop-cron] Token renovado para @${account.username}.`);
          } catch {
            console.warn(`[loop-cron] Falha ao renovar token de @${account.username} — usando atual.`);
          }
        }

        await createContainerForAccount(
          admin, account, loop, videoUrl, caption, tokenToUse,
          selectedVideo.id, loop.current_cycle
        );
        containersCreated++;

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[loop-cron] ✗ @${account.username}: ${msg}`);

        await recordContainerError(
          admin, account, loop,
          caption,
          msg,
          selectedVideo?.id ?? "",
          loop.current_cycle
        ).catch(() => {/* best-effort */});

        if (isCriticalMetaError(msg) && videoUrl) {
          const failoverOk = await attemptFailover(
            admin, account, loop, videoUrl, caption, msg, windowStartIso,
            selectedVideo?.id ?? "", loop.current_cycle
          );
          if (failoverOk) containersCreated++;
        }
      }

      // ── Throttle estratégico — 3s após cada conta exceto a última ────────
      // Posicionado APÓS o try/catch: o container foi aceito (ou falhou) antes
      // de aguardar — dá tempo à Meta API processar o payload antes do próximo.
      if (accountIdx < validAccounts.length) {
        console.log(
          `[loop-cron] Post ${accountIdx}/${validAccounts.length} enviado. Aguardando 3s...`
        );
        await sleep(3_000);
      } else {
        console.log(
          `[loop-cron] Post ${accountIdx}/${validAccounts.length} enviado. Último do lote — sem espera.`
        );
      }
    } // fim for account

    if (containersCreated > 0) summary.processed++;
    else summary.errors++;

    } catch (loopErr) {
      const loopErrMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);
      console.error(`[loop-cron] Erro inesperado no loop "${loop.name}": ${loopErrMsg}`);
      summary.errors++;
    }

  } // fim for loop

  console.log("[loop-cron] ■ Resumo final:", summary);
  return NextResponse.json({ ok: true, ...summary });
}
