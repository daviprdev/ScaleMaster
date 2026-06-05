import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ accounts: [], metrics: {}, timeline: { published: [], upcoming: [] }, last_updated: new Date().toISOString() });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin() as any;
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since6h  = new Date(now.getTime() -  6 * 60 * 60 * 1000).toISOString();

  // Parallel fetch: accounts + loops + containers (last 24h) + active loops count
  const [accountsRes, loopsRes, containersRes] = await Promise.all([
    admin
      .from("instagram_accounts")
      .select("id, username, display_name, avatar_url, health_status, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("health_status", "online"),

    admin
      .from("loops")
      .select("id, name, status, loop_accounts(account_id)")
      .eq("user_id", user.id)
      .eq("status", "active"),

    admin
      .from("pending_containers")
      .select("id, account_id, status, retry_after, retry_count, created_at, error_message, media_id")
      .eq("user_id", user.id)
      .gte("created_at", since24h)
      .order("created_at", { ascending: false }),
  ]);

  const accounts  = (accountsRes.data  ?? []) as { id: string; username: string; display_name: string | null; avatar_url: string | null; health_status: string; is_active: boolean }[];
  const loops     = (loopsRes.data     ?? []) as { id: string; name: string; status: string; loop_accounts: { account_id: string }[] }[];
  const allContainers = (containersRes.data ?? []) as { id: string; account_id: string; status: string; retry_after: string | null; retry_count: number; created_at: string; error_message: string | null; media_id: string | null }[];

  // Filtra containers cujas contas já foram excluídas
  const accountIds = new Set(accounts.map(a => a.id));
  const orphanIds  = allContainers.filter(c => !accountIds.has(c.account_id)).map(c => c.id);
  if (orphanIds.length > 0) {
    // Limpa silenciosamente os containers órfãos
    await admin.from("pending_containers").delete().in("id", orphanIds);
  }
  const containers = allContainers.filter(c => accountIds.has(c.account_id));

  // Build loop membership map: accountId → loopName
  const accountLoopMap = new Map<string, string>();
  for (const loop of loops) {
    for (const la of loop.loop_accounts) {
      accountLoopMap.set(la.account_id, loop.name);
    }
  }

  // Group containers by account (already sorted newest-first)
  const containersByAccount = new Map<string, typeof containers>();
  for (const c of containers) {
    if (!containersByAccount.has(c.account_id)) containersByAccount.set(c.account_id, []);
    containersByAccount.get(c.account_id)!.push(c);
  }

  // Build per-account status
  const accountStatuses = accounts.map(acc => {
    const acContainers = containersByAccount.get(acc.id) ?? [];

    // Latest container of each status
    const latestPending   = acContainers.find(c => c.status === "pending");
    const latestPublishing = acContainers.find(c => c.status === "publishing");
    const latestPublished = acContainers.find(c => c.status === "published");
    const latestError     = acContainers.find(c => c.status === "error" && c.error_message && !c.error_message.includes("AUTO-HEALING"));

    const published24h = acContainers.filter(c => c.status === "published").length;
    const errors24h    = acContainers.filter(c => c.status === "error" && c.error_message && !c.error_message.includes("AUTO-HEALING")).length;

    // Determine display status
    let containerStatus: "published" | "pending" | "publishing" | "error" | "none" = "none";
    if (latestPublishing) containerStatus = "publishing";
    else if (latestPending) containerStatus = "pending";
    else if (latestPublished) containerStatus = "published";
    else if (acc.health_status === "error") containerStatus = "error";
    else if (latestError && errors24h > 0) containerStatus = "error";

    // Last error message (non-AUTO-HEALING)
    const lastError = latestError?.error_message ?? null;

    return {
      id:             acc.id,
      username:       acc.username,
      display_name:   acc.display_name,
      avatar_url:     acc.avatar_url,
      health_status:  acc.health_status,
      in_active_loop: accountLoopMap.has(acc.id),
      loop_name:      accountLoopMap.get(acc.id) ?? null,
      container_status: containerStatus,
      last_published_at: latestPublished?.created_at ?? null,
      last_media_id:  latestPublished?.media_id ?? null,
      next_publish_at: latestPending?.retry_after ?? null,
      pending_since:  latestPending?.created_at ?? null,
      retry_count:    latestPending?.retry_count ?? 0,
      last_error:     lastError,
      published_24h:  published24h,
      errors_24h:     errors24h,
    };
  });

  // Aggregate metrics
  const published_24h  = accountStatuses.reduce((s, a) => s + a.published_24h, 0);
  const errors_24h_sum = accountStatuses.reduce((s, a) => s + a.errors_24h, 0);
  const pendingCount   = accountStatuses.filter(a => a.container_status === "pending").length;
  const active_loops   = loops.length;

  // Earliest upcoming publish
  const upcoming = accountStatuses
    .filter(a => a.next_publish_at)
    .map(a => ({ account_id: a.id, username: a.username, at: a.next_publish_at!, retry_count: a.retry_count }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const next_publish_in_ms = upcoming.length > 0
    ? Math.max(0, new Date(upcoming[0].at).getTime() - now.getTime())
    : null;

  // Timeline: published in last 6h
  const publishedTimeline = containers
    .filter(c => c.status === "published" && new Date(c.created_at) >= new Date(since6h))
    .map(c => {
      const acc = accounts.find(a => a.id === c.account_id);
      return { account_username: acc?.username ?? "?", at: c.created_at, media_id: c.media_id };
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return NextResponse.json({
    metrics: { published_24h, pending: pendingCount, errors_24h: errors_24h_sum, next_publish_in_ms, active_loops },
    accounts: accountStatuses,
    timeline: { published: publishedTimeline, upcoming },
    last_updated: now.toISOString(),
  });
}
