import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Auth helper ─────────────────────────────────────────────────────────────
// Accepts either user session (UI button) or ?secret= query param (curl/CLI).

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const url = new URL(req.url);
  const secretParam = url.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (secretParam && cronSecret && secretParam === cronSecret) return true;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return true;
  } catch {
    // ignore
  }

  return false;
}

// ─── GET — diagnóstico do estado atual da fila ────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const admin = getSupabaseAdmin() as any;
  const now = new Date().toISOString();

  const [
    { count: pendingTotal },
    { count: eligibleNow },
    { count: stuckPublishing },
    { count: failedTotal },
    { count: pendingContainers },
  ] = await Promise.all([
    admin.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "pending").lte("scheduled_at", now),
    admin.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "publishing"),
    admin.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "failed"),
    admin.from("pending_containers").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const futureDated = Math.max(0, (pendingTotal ?? 0) - (eligibleNow ?? 0));

  // Sample of recent failed posts to expose error messages
  const { data: recentFailures } = await admin
    .from("scheduled_posts")
    .select("id, error_message, scheduled_at, account_id")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(5);

  // Stuck in "publishing" for > 10 min = zombie
  const stuckCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: zombies } = await admin
    .from("scheduled_posts")
    .select("id, scheduled_at")
    .eq("status", "publishing")
    .lte("scheduled_at", stuckCutoff)
    .limit(5);

  return NextResponse.json({
    now,
    scheduled_posts: {
      pending_total: pendingTotal ?? 0,
      eligible_now: eligibleNow ?? 0,
      future_dated: futureDated,
      stuck_publishing: stuckPublishing ?? 0,
      zombie_posts: zombies ?? [],
      failed: failedTotal ?? 0,
    },
    pending_containers: pendingContainers ?? 0,
    recent_failures: recentFailures ?? [],
  });
}

// ─── POST — dispara o processamento manual ────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const cronSecret = process.env.CRON_SECRET ?? "";

  const callCron = async (path: string): Promise<Record<string, unknown>> => {
    try {
      const r = await fetch(`${baseUrl}${path}`, {
        headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
        signal: AbortSignal.timeout(55_000),
      });
      const json = await r.json() as Record<string, unknown>;
      return { status: r.status, ...json };
    } catch (e) {
      return { error: String(e) };
    }
  };

  const triggeredAt = new Date().toISOString();

  // Fase 1: criar containers para loops ativos
  const processLoops = await callCron("/api/cron/process-loops");

  // Fase 2: publicar containers prontos + posts agendados vencidos (paralelo)
  const [publishPending, publishScheduled] = await Promise.all([
    callCron("/api/cron/publish-pending"),
    callCron("/api/cron/publish-scheduled"),
  ]);

  return NextResponse.json({
    ok: true,
    triggered_at: triggeredAt,
    process_loops: processLoops,
    publish_pending: publishPending,
    publish_scheduled: publishScheduled,
  });
}
