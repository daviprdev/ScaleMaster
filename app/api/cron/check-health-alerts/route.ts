import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Mesmos limiares dos banners do dashboard (app/dashboard/layout.tsx) — o que
// aparece no painel é exatamente o que vira push, sem lógica duplicada/divergente.
const PROXY_OUTAGE_THRESHOLD = 3;
const PROXY_OUTAGE_WINDOW_MS = 30 * 60 * 1000;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // não reenvia o mesmo tipo de alerta em menos de 1h

interface AccountRow {
  id: string;
  user_id: string;
  username: string;
  health_status: string;
  last_proxy_error_at: string | null;
  proxy_url: string | null;
  is_active: boolean;
}

interface SettingsRow {
  user_id: string;
  proxy_alerts_enabled: boolean;
  account_alerts_enabled: boolean;
}

async function wasRecentlyAlerted(admin: ReturnType<typeof getSupabaseAdmin>, userId: string, alertType: string, windowMs: number) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data } = await admin
    .from("notifications")
    .select("id, data")
    .eq("target_type", "user")
    .eq("target_user_id", userId)
    .eq("type", "system")
    .gte("created_at", since)
    .contains("data", { alertType })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; data: { alertType: string; accountIds?: string[] } } | null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret) {
    console.warn("[cron] AVISO: CRON_SECRET nao configurado.");
  } else if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: accounts, error } = await admin
    .from("instagram_accounts")
    .select("id, user_id, username, health_status, last_proxy_error_at, proxy_url, is_active")
    .eq("is_active", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byUser = new Map<string, AccountRow[]>();
  for (const acc of (accounts ?? []) as AccountRow[]) {
    if (!byUser.has(acc.user_id)) byUser.set(acc.user_id, []);
    byUser.get(acc.user_id)!.push(acc);
  }

  const userIds = Array.from(byUser.keys());
  const { data: settingsRows } = await admin
    .from("notification_settings")
    .select("user_id, proxy_alerts_enabled, account_alerts_enabled")
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  const settingsMap = new Map((settingsRows as SettingsRow[] | null ?? []).map((s) => [s.user_id, s]));

  const results: Record<string, unknown>[] = [];
  const proxyWindowStart = new Date(Date.now() - PROXY_OUTAGE_WINDOW_MS).toISOString();

  for (const [userId, userAccounts] of byUser) {
    const settings = settingsMap.get(userId) ?? { proxy_alerts_enabled: true, account_alerts_enabled: true };

    // ── Queda de proxy ──
    if (settings.proxy_alerts_enabled) {
      const failing = userAccounts.filter(
        (a) => a.proxy_url && a.last_proxy_error_at && a.last_proxy_error_at >= proxyWindowStart
      );
      if (failing.length >= PROXY_OUTAGE_THRESHOLD) {
        const already = await wasRecentlyAlerted(admin, userId, "proxy_outage", ALERT_COOLDOWN_MS);
        if (!already) {
          await sendPushNotification({
            targetType: "user",
            targetUserId: userId,
            type: "system",
            title: "Queda de proxy detectada",
            body: `${failing.length} contas ativas com falha de proxy nos últimos 30 min.`,
            url: "/dashboard/proxy-test",
            extraData: { alertType: "proxy_outage", accountIds: failing.map((a) => a.id) },
          });
          results.push({ userId, alert: "proxy_outage", count: failing.length });
        }
      }
    }

    // ── Queda de contas ──
    if (settings.account_alerts_enabled) {
      const errored = userAccounts.filter((a) => a.health_status === "error");
      if (errored.length > 0) {
        const already = await wasRecentlyAlerted(admin, userId, "account_health", ALERT_COOLDOWN_MS);
        const previousIds = new Set(already?.data?.accountIds ?? []);
        const hasNew = errored.some((a) => !previousIds.has(a.id));

        if (!already || hasNew) {
          const usernames = errored.slice(0, 5).map((a) => `@${a.username}`).join(", ");
          const suffix = errored.length > 5 ? ` e mais ${errored.length - 5}` : "";
          await sendPushNotification({
            targetType: "user",
            targetUserId: userId,
            type: "system",
            title: `${errored.length} conta${errored.length > 1 ? "s" : ""} caída${errored.length > 1 ? "s" : ""}`,
            body: `${usernames}${suffix} com erro de publicação.`,
            url: "/dashboard/failover",
            extraData: { alertType: "account_health", accountIds: errored.map((a) => a.id) },
          });
          results.push({ userId, alert: "account_health", count: errored.length });
        }
      }
    }
  }

  return NextResponse.json({ checked: userIds.length, alerts: results });
}
