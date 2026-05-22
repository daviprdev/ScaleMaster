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
  interval_minutes: number;
  media_limit: number | null;
  captions: string[];
  effect_mirror: boolean;
  effect_invert: boolean;
  last_posted_at: string | null;
  last_media_index: number;
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
// Failover helpers
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
// Video effects stub
// ---------------------------------------------------------------------------

async function processVideoEffects(
  videoUrl: string,
  effectMirror: boolean,
  effectInvert: boolean
): Promise<string> {
  if (!effectMirror && !effectInvert) return videoUrl;
  console.warn(
    `[loop-cron] Efeitos solicitados (mirror=${effectMirror}, invert=${effectInvert}) — ` +
    `worker de vídeo não configurado, usando URL original como passthrough.`
  );
  return videoUrl;
}

// ---------------------------------------------------------------------------
// Idempotency check — verifica se já existe container válido para esta
// conta neste ciclo (janela = interval_minutes, ignora status=error).
// Protege contra re-tentativas que resultariam em posts duplicados.
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
    .neq("status", "error")          // erros não bloqueiam retry
    .gte("created_at", windowStartIso)
    .limit(1)
    .maybeSingle();
  return data !== null;
}

// ---------------------------------------------------------------------------
// Cria container para uma conta, persiste em pending_containers e retorna.
// Commit parcial: INSERT acontece ANTES de avançar para a próxima conta —
// garante que um timeout não apague o progresso já feito.
// ---------------------------------------------------------------------------

async function createContainerForAccount(
  admin: ReturnType<typeof getSupabaseAdmin>,
  account: AccountRow,
  loop: LoopRow,
  videoUrl: string,
  caption: string,
  tokenToUse: string
): Promise<void> {
  const creationId = await createMediaContainerOnly(
    account.ig_business_account_id!,
    videoUrl,
    caption,
    tokenToUse
  );
  // Persiste IMEDIATAMENTE — não aguarda outras contas
  const { error } = await (admin as any).from("pending_containers").insert({
    user_id: loop.user_id,
    loop_id: loop.id,
    account_id: account.id,
    ig_business_account_id: account.ig_business_account_id,
    creation_id: creationId,
    caption,
  });
  if (error) throw new Error(`Falha ao salvar container no banco: ${error.message}`);
  console.log(`[loop-cron] ✓ @${account.username} → container ${creationId} persistido.`);
}

// ---------------------------------------------------------------------------
// Registra container de erro em pending_containers para rastreabilidade.
// creation_id vazio é sentinel — o publish-pending ignora status=error.
// ---------------------------------------------------------------------------

async function recordContainerError(
  admin: ReturnType<typeof getSupabaseAdmin>,
  account: AccountRow,
  loop: LoopRow,
  caption: string,
  errorMsg: string
): Promise<void> {
  await (admin as any).from("pending_containers").insert({
    user_id: loop.user_id,
    loop_id: loop.id,
    account_id: account.id,
    ig_business_account_id: account.ig_business_account_id ?? "",
    creation_id: "",     // sentinel — erro antes de chegar na Meta
    caption,
    status: "error",
    error_message: errorMsg.slice(0, 500),
  }).catch(() => {/* best-effort */});
}

// ---------------------------------------------------------------------------
// Tenta failover para conta de backup quando a principal tem token inválido.
// Registra evento em failover_logs.
// ---------------------------------------------------------------------------

async function attemptFailover(
  admin: ReturnType<typeof getSupabaseAdmin>,
  failedAccount: AccountRow,
  loop: LoopRow,
  videoUrl: string,
  caption: string,
  errorMsg: string,
  windowStartIso: string
): Promise<boolean> {
  // Marca conta principal como erro
  await (admin as any)
    .from("instagram_accounts")
    .update({ health_status: "error" })
    .eq("id", failedAccount.id);

  // Busca melhor conta de backup (online, maior prioridade)
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
  }).catch(() => {/* best-effort */});

  if (!backup?.meta_access_token || !backup?.ig_business_account_id) {
    console.warn(`[loop-cron] Sem conta de backup para "${loop.name}".`);
    return false;
  }

  // Checa idempotência também para o backup
  const backupExists = await containerAlreadyExists(
    admin, loop.id, backup.id, windowStartIso
  );
  if (backupExists) {
    console.log(`[loop-cron] ⚡ @${backup.username} (backup): container já existe — idempotente.`);
    return true;
  }

  console.log(`[loop-cron] Failover → @${backup.username}.`);
  try {
    await createContainerForAccount(
      admin,
      { ...backup, is_active: true },
      loop,
      videoUrl,
      caption,
      backup.meta_access_token
    );
    return true;
  } catch (backupErr) {
    const msg = backupErr instanceof Error ? backupErr.message : String(backupErr);
    console.error(`[loop-cron] ✗ @${backup.username} (failover):`, msg);
    await recordContainerError(admin, backup, loop, caption, msg);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin();
  const now = new Date();

  const { data: loopRows, error: fetchErr } = await (admin as any)
    .from("loops")
    .select(`
      id, user_id, name, folder_id, is_infinite, cycles, cycles_done,
      interval_minutes, media_limit, captions, effect_mirror, effect_invert,
      last_posted_at, last_media_index,
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

  // Fetch human schedule settings for all users
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

  // Filter loops whose interval has elapsed
  const eligible = loops.filter((loop) => {
    if (!loop.last_posted_at) return true;
    const nextRun = new Date(loop.last_posted_at).getTime() + loop.interval_minutes * 60_000;
    return now.getTime() >= nextRun;
  });

  console.log(`[loop-cron] ${loops.length} loops ativos, ${eligible.length} elegíveis.`);

  const summary = { total: eligible.length, processed: 0, skipped: 0, errors: 0 };

  for (const loop of eligible) {
    // ── Human schedule check ─────────────────────────────────────────────────
    const schedule = scheduleMap.get(loop.user_id);
    if (schedule?.is_active) {
      const allowed = isWithinHumanSchedule(
        now, schedule.timezone, schedule.start_time, schedule.end_time
      );
      if (!allowed) {
        console.log(
          `[loop-cron] "${loop.name}" bloqueado pelo Horário Humano ` +
          `(fora de ${schedule.start_time}–${schedule.end_time}).`
        );
        summary.skipped++;
        continue;
      }
    }

    // ── Validações básicas ───────────────────────────────────────────────────
    const validAccounts = loop.loop_accounts
      .map((la) => la.instagram_accounts)
      .filter((acc): acc is AccountRow => acc !== null && acc.is_active);

    if (validAccounts.length === 0) {
      console.warn(`[loop-cron] "${loop.name}" sem contas ativas — pulando.`);
      summary.skipped++;
      continue;
    }

    if (!loop.folder_id) {
      console.warn(`[loop-cron] "${loop.name}" sem pasta — pulando.`);
      summary.skipped++;
      continue;
    }

    let videoQuery = (admin as any)
      .from("videos_library")
      .select("id, public_url, filename")
      .eq("folder_id", loop.folder_id)
      .order("created_at", { ascending: true });
    if (loop.media_limit) videoQuery = videoQuery.limit(loop.media_limit);
    const { data: videoRows, error: videoErr } = await videoQuery;

    if (videoErr || !videoRows?.length) {
      console.warn(`[loop-cron] "${loop.name}" sem vídeos na pasta — pulando.`);
      summary.skipped++;
      continue;
    }

    const videos = videoRows as VideoRow[];
    const mediaIndex = (loop.last_media_index ?? 0) % videos.length;
    const selectedVideo = videos[mediaIndex];
    const nextMediaIndex = (mediaIndex + 1) % videos.length;

    const caption =
      loop.captions.length > 0
        ? loop.captions[Math.floor(Math.random() * loop.captions.length)]
        : "";

    const videoUrl = await processVideoEffects(
      selectedVideo.public_url,
      loop.effect_mirror,
      loop.effect_invert
    );

    // ── CLAIM: avança estado do loop ANTES de processar contas ───────────────
    // Isso garante que, mesmo em caso de timeout, o próximo cron não veja este
    // loop como elegível e não reprocesse as contas desde o início.
    const newCyclesDone = loop.cycles_done + 1;
    const isComplete = !loop.is_infinite && newCyclesDone >= loop.cycles;

    await (admin as any).from("loops").update({
      last_posted_at: now.toISOString(),
      last_media_index: nextMediaIndex,
      cycles_done: newCyclesDone,
      ...(isComplete ? { status: "completed" } : {}),
    }).eq("id", loop.id);

    if (isComplete) {
      console.log(
        `[loop-cron] "${loop.name}" completou ${newCyclesDone}/${loop.cycles} ciclo(s) → completed.`
      );
    }

    // Janela de idempotência: containers criados dentro do último intervalo
    // (ex.: loop de 30 min → ignora containers > 30 min atrás)
    const windowStartIso = new Date(
      now.getTime() - loop.interval_minutes * 60_000
    ).toISOString();

    console.log(
      `[loop-cron] "${loop.name}" → vídeo [${mediaIndex}] "${selectedVideo.filename}" ` +
      `para ${validAccounts.length} conta(s). Janela: ${windowStartIso}`
    );

    let containersCreated = 0;

    // ── Iteração por conta — cada conta é independente ───────────────────────
    for (const account of validAccounts) {
      if (!account.meta_access_token || !account.ig_business_account_id) {
        console.warn(`[loop-cron] @${account.username} sem credenciais Meta — pulando.`);
        continue;
      }

      // ── IDEMPOTÊNCIA: verifica se container já foi criado neste ciclo ──────
      // Protege contra execuções paralelas ou re-tentativas após timeout parcial.
      const alreadyDone = await containerAlreadyExists(
        admin, loop.id, account.id, windowStartIso
      );
      if (alreadyDone) {
        console.log(`[loop-cron] ⚡ @${account.username}: container já existe neste ciclo — pulando.`);
        containersCreated++;
        continue;
      }

      // ── Processa conta individualmente — erro NÃO aborta o loop ─────────────
      try {
        let tokenToUse = account.meta_access_token;

        // Refresh preventivo se token expira em < 7 dias
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
          } catch {
            console.warn(`[loop-cron] Falha ao renovar token de @${account.username}, usando atual.`);
          }
        }

        // COMMIT PARCIAL: persiste container antes de avançar para a próxima conta
        await createContainerForAccount(admin, account, loop, videoUrl, caption, tokenToUse);
        containersCreated++;

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[loop-cron] ✗ @${account.username}:`, msg);

        // Registra erro para rastreabilidade (não bloqueia as próximas contas)
        await recordContainerError(admin, account, loop, caption, msg);

        if (isCriticalMetaError(msg)) {
          // Token inválido → tenta failover; outras contas CONTINUAM normalmente
          const failoverOk = await attemptFailover(
            admin, account, loop, videoUrl, caption, msg, windowStartIso
          );
          if (failoverOk) containersCreated++;
        }
        // Não faz break — próxima conta do array é processada independentemente
      }
    }

    if (containersCreated > 0) summary.processed++;
    else summary.errors++;
  }

  console.log("[loop-cron] Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}
