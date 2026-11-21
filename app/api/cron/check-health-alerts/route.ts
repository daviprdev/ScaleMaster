import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";
import { requireCronAuth } from "@/lib/cron-auth";
import { buildPublishFailureAlert } from "@/lib/publish-failure-alert";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Mesmos limiares dos banners do dashboard (app/dashboard/layout.tsx) — o que
// aparece no painel é exatamente o que vira push, sem lógica duplicada/divergente.
const PROXY_OUTAGE_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // não reenvia o mesmo tipo de alerta em menos de 1h

interface AccountRow {
  id: string;
  user_id: string;
  username: string;
  health_status: string;
  is_active: boolean;
}

interface SettingsRow {
  user_id: string;
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

// Janela de falhas olhada a cada execução (o cron roda a cada 10 min).
const FAILURE_WINDOW_MS = 3 * 60 * 60 * 1000;
const FAILURE_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Push "N postagens falharam" com o erro da Meta. Só reenvia quando existe
 * falha com scheduled_at mais novo que o do último aviso, e no máximo a cada
 * 30 min. Devolve quantas falhas foram avisadas (0 = nada enviado).
 */
async function alertPublishFailures(admin: ReturnType<typeof getSupabaseAdmin>, userId: string): Promise<number> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString();
  const { data: rows, error } = await admin
    .from("scheduled_posts")
    .select("scheduled_at, error_message, instagram_accounts(username)")
    .eq("user_id", userId)
    .eq("status", "failed")
    .gte("scheduled_at", since)
    .order("scheduled_at", { ascending: false })
    .limit(500);
  if (error) {
    console.warn(`[check-health-alerts] falhas de postagem de ${userId.slice(0, 8)}: ${error.message}`);
    return 0;
  }
  type Row = { scheduled_at: string; error_message: string | null; instagram_accounts: { username: string } | null };
  const failed = (rows ?? []) as unknown as Row[];
  if (failed.length === 0) return 0;

  const newest = failed[0].scheduled_at;
  const last = await wasRecentlyAlerted(admin, userId, "publish_failures", 24 * 60 * 60 * 1000);
  const lastData = last?.data as { lastFailedAt?: string } | undefined;
  if (lastData?.lastFailedAt && new Date(newest) <= new Date(lastData.lastFailedAt)) return 0;
  if (await wasRecentlyAlerted(admin, userId, "publish_failures", FAILURE_ALERT_COOLDOWN_MS)) return 0;

  // Só as falhas novas desde o último aviso entram na contagem.
  const fresh = lastData?.lastFailedAt
    ? failed.filter((r) => new Date(r.scheduled_at) > new Date(lastData.lastFailedAt!))
    : failed;
  const alert = buildPublishFailureAlert(
    fresh.map((r) => ({ error_message: r.error_message, username: r.instagram_accounts?.username ?? "?" }))
  );
  if (!alert) return 0;

  await sendPushNotification({
    targetType: "user",
    targetUserId: userId,
    type: "system",
    title: alert.title,
    body: alert.body,
    url: "/dashboard/postar",
    extraData: { alertType: "publish_failures", lastFailedAt: newest },
  });
  return fresh.length;
}

export async function GET(req: NextRequest) {
  const cronAuth = requireCronAuth(req);
  if (!cronAuth.ok) return cronAuth.response;

  const admin = getSupabaseAdmin();

  const { data: accounts, error } = await admin
    .from("instagram_accounts")
    .select("id, user_id, username, health_status, is_active")
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
    .select("user_id, account_alerts_enabled")
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  const settingsMap = new Map((settingsRows as SettingsRow[] | null ?? []).map((s) => [s.user_id, s]));

  const results: Record<string, unknown>[] = [];

  for (const [userId, userAccounts] of byUser) {
    const settings = settingsMap.get(userId) ?? { account_alerts_enabled: true };

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
            title: `⚠️ ${errored.length} conta${errored.length > 1 ? "s" : ""} com erro`,
            body: `${usernames}${suffix} com erro de publicação.`,
            url: "/dashboard/failover",
            extraData: { alertType: "account_health", accountIds: errored.map((a) => a.id) },
          });
          results.push({ userId, alert: "account_health", count: errored.length });
        }
      }
    }

    // ── Falha de postagem ──
    // Avisa o erro exato que a Meta devolveu, sem concluir nada sobre a conta:
    // o usuário analisa. Reenvia só quando há falha mais nova que a do último aviso.
    if (settings.account_alerts_enabled) {
      const r = await alertPublishFailures(admin, userId);
      if (r) results.push({ userId, alert: "publish_failures", count: r });
    }
  }

  return NextResponse.json({ checked: userIds.length, alerts: results });
}
