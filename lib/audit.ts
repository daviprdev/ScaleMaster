import { getSupabaseAdmin } from "@/lib/supabase";

export type AuditAction =
  | "user_registered"
  | "user_approved"
  | "user_rejected"
  | "user_banned"
  | "account_connected"
  | "account_revoked"
  | "impersonation_started";

export async function logAudit(params: {
  action: AuditAction;
  actorId?: string;
  actorEmail?: string;
  targetId?: string;
  targetEmail?: string;
  details?: Record<string, unknown>;
}) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("audit_logs").insert({
      action: params.action,
      actor_id: params.actorId ?? null,
      actor_email: params.actorEmail ?? null,
      target_id: params.targetId ?? null,
      target_email: params.targetEmail ?? null,
      details: params.details ?? {},
    });
  } catch {
    // fire-and-forget — never breaks the main flow
  }
}
