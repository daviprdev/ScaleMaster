import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: automation } = await admin
    .from("automations")
    .select("id, user_id, posts_per_day")
    .eq("id", id)
    .single();
  if (!automation || automation.user_id !== user.id)
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

  const { data: aFolders } = await admin
    .from("automation_account_folders")
    .select("folder_id")
    .eq("automation_id", id);
  const folderIds = (aFolders ?? []).map((f) => f.folder_id);

  if (!folderIds.length) {
    return NextResponse.json({ accounts: [], summary: { total_accounts: 0, published_today: 0, pending: 0, failed_today: 0, no_activity: 0 } });
  }

  const { data: accounts } = await admin
    .from("instagram_accounts")
    .select("id, username, avatar_url, health_status, is_active")
    .in("folder_id", folderIds)
    .order("username", { ascending: true });

  const accountIds = (accounts ?? []).map((a) => a.id);
  if (!accountIds.length) {
    return NextResponse.json({ accounts: [], summary: { total_accounts: 0, published_today: 0, pending: 0, failed_today: 0, no_activity: 0 } });
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [publishedRes, pendingRes, failedRes] = await Promise.all([
    admin.from("scheduled_posts")
      .select("account_id, scheduled_at")
      .eq("campaign_id", id)
      .in("account_id", accountIds)
      .eq("status", "published")
      .gte("scheduled_at", since24h)
      .limit(20000),
    admin.from("scheduled_posts")
      .select("account_id, scheduled_at")
      .eq("campaign_id", id)
      .in("account_id", accountIds)
      .in("status", ["pending", "publishing"])
      .limit(20000),
    admin.from("scheduled_posts")
      .select("account_id, scheduled_at, error_message")
      .eq("campaign_id", id)
      .in("account_id", accountIds)
      .eq("status", "failed")
      .gte("scheduled_at", since24h)
      .limit(20000),
  ]);

  const publishedToday: Record<string, number> = {};
  const lastPublishedAt: Record<string, string> = {};
  for (const row of (publishedRes.data ?? [])) {
    publishedToday[row.account_id] = (publishedToday[row.account_id] ?? 0) + 1;
    if (!lastPublishedAt[row.account_id] || row.scheduled_at > lastPublishedAt[row.account_id]) {
      lastPublishedAt[row.account_id] = row.scheduled_at;
    }
  }

  const pending: Record<string, number> = {};
  const nextScheduledAt: Record<string, string> = {};
  for (const row of (pendingRes.data ?? [])) {
    pending[row.account_id] = (pending[row.account_id] ?? 0) + 1;
    if (!nextScheduledAt[row.account_id] || row.scheduled_at < nextScheduledAt[row.account_id]) {
      nextScheduledAt[row.account_id] = row.scheduled_at;
    }
  }

  const failedToday: Record<string, number> = {};
  const lastError: Record<string, string> = {};
  for (const row of (failedRes.data ?? [])) {
    failedToday[row.account_id] = (failedToday[row.account_id] ?? 0) + 1;
    if (row.error_message) lastError[row.account_id] = row.error_message;
  }

  let summaryPublished = 0, summaryPending = 0, summaryFailed = 0, summaryNoActivity = 0;

  const result = (accounts ?? []).map((a) => {
    const pub = publishedToday[a.id] ?? 0;
    const pend = pending[a.id] ?? 0;
    const fail = failedToday[a.id] ?? 0;

    let status: "publicado" | "na_fila" | "erro_conta" | "inativa" | "falhou" | "sem_atividade";
    if (!a.is_active) status = "inativa";
    else if (a.health_status === "error") status = "erro_conta";
    else if (pub > 0) status = "publicado";
    else if (pend > 0) status = "na_fila";
    else if (fail > 0) status = "falhou";
    else status = "sem_atividade";

    if (status === "publicado") summaryPublished++;
    else if (status === "na_fila") summaryPending++;
    else if (status === "falhou") summaryFailed++;
    else if (status === "sem_atividade") summaryNoActivity++;

    return {
      id: a.id,
      username: a.username,
      avatar_url: a.avatar_url,
      health_status: a.health_status,
      is_active: a.is_active,
      published_today: pub,
      last_published_at: lastPublishedAt[a.id] ?? null,
      pending: pend,
      next_scheduled_at: nextScheduledAt[a.id] ?? null,
      failed_today: fail,
      last_error: lastError[a.id] ?? null,
      status,
    };
  });

  return NextResponse.json({
    accounts: result,
    summary: {
      total_accounts: result.length,
      published_today: summaryPublished,
      pending: summaryPending,
      failed_today: summaryFailed,
      no_activity: summaryNoActivity,
    },
  });
}
