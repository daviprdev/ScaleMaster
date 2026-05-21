import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { publishViaMetaAPI } from "@/lib/meta-publish";
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
  start_time: string; // "HH:MM:SS"
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

/**
 * Returns true for Meta API errors that indicate the account itself is
 * compromised (bad token, restricted, blocked) — as opposed to transient
 * network or rate-limit issues that don't warrant marking the account unhealthy.
 */
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
// Video effects stub
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Human schedule helper — no external deps, pure Intl
// ---------------------------------------------------------------------------

function isWithinHumanSchedule(
  now: Date,
  timezone: string,
  startTime: string, // "HH:MM" or "HH:MM:SS"
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
    return true; // fail open — don't block on tz parse error
  }
}

// ---------------------------------------------------------------------------

/**
 * processVideoEffects — Applies mirror/invert effects to a video.
 *
 * Currently returns the original URL as a passthrough.
 *
 * FUTURE: Heavy FFmpeg processing must be offloaded to a dedicated Worker
 * (e.g., AWS SQS + EC2, Render background job, or Railway worker) to avoid
 * Vercel's 300s execution limit and per-invocation memory cap. The correct
 * implementation should:
 *   1. Enqueue a job: POST /worker/process-video { videoUrl, effectMirror, effectInvert }
 *   2. Worker downloads video → applies FFmpeg filters → uploads to Supabase Storage
 *   3. Return the new public_url from Storage
 * This function signature stays the same; only the body changes when the
 * worker is wired up.
 */
async function processVideoEffects(
  videoUrl: string,
  effectMirror: boolean,
  effectInvert: boolean
): Promise<string> {
  if (!effectMirror && !effectInvert) return videoUrl;
  // TODO: enqueue to dedicated video-processing worker and await processed URL.
  console.warn(
    `[loop-cron] Efeitos solicitados (mirror=${effectMirror}, invert=${effectInvert}) — ` +
    `worker de vídeo não configurado, usando URL original como passthrough.`
  );
  return videoUrl;
}

// ---------------------------------------------------------------------------
// Cron handler — Vercel Cron Jobs send GET requests
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

  const admin = getSupabaseAdmin() as any;
  const now = new Date();

  // Fetch all active loops with their linked accounts
  const { data: loopRows, error: fetchErr } = await admin
    .from("loops")
    .select(`
      id, user_id, name, folder_id, is_infinite, cycles, cycles_done,
      interval_minutes, media_limit, captions, effect_mirror, effect_invert,
      last_posted_at, last_media_index,
      loop_accounts (
        account_id,
        instagram_accounts (
          id, username, is_active, meta_access_token,
          ig_business_account_id, token_expires_at, fb_page_id
        )
      )
    `)
    .eq("status", "active");

  if (fetchErr) {
    console.error("[loop-cron] Erro ao buscar loops:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const loops = (loopRows ?? []) as LoopRow[];

  // Fetch human schedule settings for all distinct users that have active loops
  const distinctUserIds = [...new Set(loops.map(l => l.user_id))];
  let scheduleMap = new Map<string, HumanScheduleRow>();

  if (distinctUserIds.length > 0) {
    const { data: scheduleRows } = await admin
      .from("human_schedule_settings")
      .select("user_id, is_active, start_time, end_time, timezone")
      .in("user_id", distinctUserIds);

    scheduleMap = new Map(
      ((scheduleRows ?? []) as HumanScheduleRow[]).map(r => [r.user_id, r])
    );
  }

  // Filter to loops whose interval has elapsed (JS-side — avoids typing issues)
  const eligible = loops.filter((loop) => {
    if (!loop.last_posted_at) return true;
    const nextRun = new Date(loop.last_posted_at).getTime() + loop.interval_minutes * 60_000;
    return now.getTime() >= nextRun;
  });

  console.log(`[loop-cron] ${loops.length} loops ativos, ${eligible.length} elegíveis.`);

  const summary = { total: eligible.length, processed: 0, skipped: 0, errors: 0 };

  for (const loop of eligible) {
    // Human schedule check — skip if outside the user's allowed posting window
    const schedule = scheduleMap.get(loop.user_id);
    if (schedule?.is_active) {
      const allowed = isWithinHumanSchedule(
        now,
        schedule.timezone,
        schedule.start_time,
        schedule.end_time
      );
      if (!allowed) {
        console.log(
          `[loop-cron] "${loop.name}" bloqueado pelo Horário Humano ` +
          `(fora de ${schedule.start_time}–${schedule.end_time} em ${schedule.timezone}).`
        );
        summary.skipped++;
        continue;
      }
    }

    // Collect valid (active + with Meta credentials) accounts
    const validAccounts = loop.loop_accounts
      .map((la) => la.instagram_accounts)
      .filter((acc): acc is AccountRow => acc !== null && acc.is_active);

    if (validAccounts.length === 0) {
      console.warn(`[loop-cron] "${loop.name}" sem contas ativas — pulando.`);
      summary.skipped++;
      continue;
    }

    if (!loop.folder_id) {
      console.warn(`[loop-cron] "${loop.name}" sem pasta de biblioteca vinculada — pulando.`);
      summary.skipped++;
      continue;
    }

    // Fetch videos from the library folder, ordered for deterministic round-robin.
    // If media_limit is set, restrict the working set to that many videos (oldest first).
    let videoQuery = admin
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

    // Random caption from the captions array (or empty)
    const caption =
      loop.captions.length > 0
        ? loop.captions[Math.floor(Math.random() * loop.captions.length)]
        : "";

    // Apply video effects (stub — returns original URL until worker is wired)
    const videoUrl = await processVideoEffects(
      selectedVideo.public_url,
      loop.effect_mirror,
      loop.effect_invert
    );

    console.log(
      `[loop-cron] "${loop.name}" → vídeo [${mediaIndex}/${videos.length - 1}] ` +
      `"${selectedVideo.filename}" para ${validAccounts.length} conta(s).`
    );

    let loopPublished = 0;

    // Publish to every connected account
    for (const account of validAccounts) {
      if (!account.meta_access_token || !account.ig_business_account_id) {
        console.warn(`[loop-cron] @${account.username} sem credenciais Meta — pulando conta.`);
        continue;
      }

      try {
        let tokenToUse = account.meta_access_token;

        // Preventive token refresh if expiring within 7 days
        if (isTokenExpiringSoon(account.token_expires_at, 7)) {
          try {
            const { token, expiresAt } = await refreshMetaToken(
              account.meta_access_token,
              account.fb_page_id
            );
            await admin
              .from("instagram_accounts")
              .update({ meta_access_token: token, token_expires_at: expiresAt.toISOString() })
              .eq("id", account.id);
            tokenToUse = token;
          } catch {
            console.warn(`[loop-cron] Falha ao renovar token de @${account.username}, usando atual.`);
          }
        }

        const result = await publishViaMetaAPI(
          account.ig_business_account_id,
          tokenToUse,
          videoUrl,
          caption
        );

        if (result.status !== "ok") throw new Error(result.error ?? "Erro na Meta API.");
        console.log(`[loop-cron] ✓ @${account.username} → media_id: ${result.media_id}`);
        loopPublished++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[loop-cron] ✗ @${account.username}:`, msg);

        if (isCriticalMetaError(msg)) {
          // Mark the failed account as errored in DB
          await admin
            .from("instagram_accounts")
            .update({ health_status: "error" })
            .eq("id", account.id);

          // Find the next healthy backup account for this user (any account, ordered by priority)
          const { data: backups } = await admin
            .from("instagram_accounts")
            .select("id, username, meta_access_token, ig_business_account_id, token_expires_at, fb_page_id")
            .eq("user_id", loop.user_id)
            .eq("is_active", true)
            .eq("health_status", "online")
            .neq("id", account.id)
            .order("failover_priority", { ascending: true })
            .limit(1);

          const backup = backups?.[0] ?? null;

          // Log the failover event regardless of whether a backup was found
          await admin.from("failover_logs").insert({
            user_id: loop.user_id,
            failed_account_id: account.id,
            backup_account_id: backup?.id ?? null,
            error_reason: msg,
          });

          if (backup?.meta_access_token && backup?.ig_business_account_id) {
            console.log(`[loop-cron] Failover: tentando @${backup.username} como reserva.`);
            try {
              const backupResult = await publishViaMetaAPI(
                backup.ig_business_account_id,
                backup.meta_access_token,
                videoUrl,
                caption
              );
              if (backupResult.status !== "ok") throw new Error(backupResult.error ?? "Erro na Meta API.");
              console.log(`[loop-cron] ✓ @${backup.username} (failover) → media_id: ${backupResult.media_id}`);
              loopPublished++;
            } catch (backupErr) {
              const backupMsg = backupErr instanceof Error ? backupErr.message : String(backupErr);
              console.error(`[loop-cron] ✗ @${backup.username} (failover):`, backupMsg);
            }
          } else {
            console.warn(`[loop-cron] Sem conta de backup disponível para o loop "${loop.name}".`);
          }
        }
      }
    }

    // Update loop state — always advance index and increment cycles_done
    const newCyclesDone = loop.cycles_done + 1;
    const isComplete = !loop.is_infinite && newCyclesDone >= loop.cycles;

    const updatePayload: Record<string, unknown> = {
      last_posted_at: now.toISOString(),
      last_media_index: nextMediaIndex,
      cycles_done: newCyclesDone,
    };

    if (isComplete) {
      updatePayload.status = "completed";
      console.log(
        `[loop-cron] "${loop.name}" completou ${newCyclesDone}/${loop.cycles} ciclo(s) — status → completed.`
      );
    }

    await admin.from("loops").update(updatePayload).eq("id", loop.id);

    if (loopPublished > 0) summary.processed++;
    else summary.errors++;
  }

  console.log("[loop-cron] Resumo:", summary);
  return NextResponse.json({ ok: true, ...summary });
}
