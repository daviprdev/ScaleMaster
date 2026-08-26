import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@autoscale.local";

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[web-push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas.");
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
}

/** Envia para UMA subscription; poda do banco em 404/410 (subscription morta). */
async function pushToRow(sub: SubscriptionRow, payload: PushPayload): Promise<boolean> {
  ensureVapid();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await getSupabaseAdmin().from("push_subscriptions").delete().eq("id", sub.id);
    } else {
      console.warn("[web-push] falha ao enviar:", err?.statusCode, err?.body ?? err?.message);
    }
    return false;
  }
}

export type NotificationTargetType = "all" | "admins" | "user";
export type NotificationType = "admin" | "system" | "sale";

/**
 * Ponto único de envio: resolve o público-alvo, insere o registro de auditoria
 * em `notifications`, dispara os pushes em paralelo e atualiza sent_count/failed_count.
 */
export async function sendPushNotification(params: {
  targetType: NotificationTargetType;
  targetUserId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  url?: string;
  createdBy?: string | null;
  extraData?: Record<string, unknown>;
}) {
  const admin = getSupabaseAdmin();
  const { targetType, targetUserId, type, title, body, url, createdBy, extraData } = params;

  if (targetType === "user" && !targetUserId) {
    throw new Error("target_user_id é obrigatório quando target_type = 'user'.");
  }

  const { data: notif, error: insertErr } = await admin
    .from("notifications")
    .insert({
      target_type: targetType,
      target_user_id: targetType === "user" ? targetUserId : null,
      type,
      title,
      body,
      data: { url: url ?? null, ...extraData },
      created_by: createdBy ?? null,
    })
    .select()
    .single();
  if (insertErr) throw new Error(insertErr.message);

  let subs: SubscriptionRow[] = [];
  if (targetType === "user") {
    const { data } = await admin
      .from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .eq("user_id", targetUserId!);
    subs = data ?? [];
  } else if (targetType === "admins") {
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const ids = (admins ?? []).map((a: any) => a.user_id);

    if (ids.length) {
      const { data } = await admin
        .from("push_subscriptions")
        .select("id,user_id,endpoint,p256dh,auth")
        .in("user_id", ids);
      subs = data ?? [];
    }
  } else {
    const { data } = await admin.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth");
    subs = data ?? [];
  }

  const payload: PushPayload = { title, body, url, data: { notificationId: notif.id, ...extraData } };
  const results = await Promise.allSettled(subs.map((s) => pushToRow(s, payload)));
  const sent = results.filter((r) => r.status === "fulfilled" && r.value).length;
  const failed = results.length - sent;

  await admin.from("notifications").update({ sent_count: sent, failed_count: failed }).eq("id", notif.id);

  return { notificationId: notif.id as string, targeted: subs.length, sent, failed };
}
