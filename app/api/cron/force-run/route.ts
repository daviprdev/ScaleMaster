import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hasValidCronSecret } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Auth helper ─────────────────────────────────────────────────────────────
// Esta rota é GLOBAL, não escopada por usuário: o GET expõe o estado da fila de
// TODOS os usuários (contagens, mensagens de erro, ids de posts travados) e o
// POST dispara o pipeline de crons inteiro com o CRON_SECRET do servidor.
// Antes bastava estar logado — qualquer usuário aprovado conseguia ler dados de
// outros e forçar o processamento de todo mundo (abuso de rate limit da Meta e
// de recursos do servidor). Agora exige CRON_SECRET ou papel de admin.

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // hasValidCronSecret é fail-closed: com CRON_SECRET ausente/vazio devolve
  // false, então a rota exige sessão de admin em vez de liberar.
  const secretParam = new URL(req.url).searchParams.get("secret");
  if (hasValidCronSecret(secretParam, false)) return true;
  if (hasValidCronSecret(req.headers.get("authorization"))) return true;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    return (roleRow as { role?: string } | null)?.role === "admin";
  } catch {
    return false;
  }
}

// ─── GET — diagnóstico do estado atual da fila ────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 });
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
    // scheduled_posts não tem updated_at — ordenar por ela fazia a query
    // falhar em silêncio e a amostra de falhas vir sempre vazia.
    .order("scheduled_at", { ascending: false })
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
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ skipped: true, reason: "Supabase não configurado." });
  }

  // Chama o próprio app pelo endereço interno — montar a URL a partir do Host
  // da requisição deixava um Host forjado receber o Bearer CRON_SECRET.
  const baseUrl = process.env.INTERNAL_APP_URL || "http://127.0.0.1:3000";
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
