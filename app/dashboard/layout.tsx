import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ImpersonationBanner } from "@/components/dashboard/ImpersonationBanner";
import { AnnouncementBanner } from "@/components/dashboard/AnnouncementBanner";
import { AccountHealthBanner, type AccountHealthError } from "@/components/dashboard/AccountHealthBanner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .single();

  const role = (roleData as { role?: string; account_status?: string } | null)?.role;
  const accountStatus = (roleData as { role?: string; account_status?: string } | null)?.account_status;

  if (role !== "admin") {
    if (!roleData || accountStatus === "pending") redirect("/pending");
    if (accountStatus === "banned") redirect("/auth/banned");
  }

  // Impersonation banner data
  const cookieStore = await cookies();
  const impCookie = cookieStore.get("admin-impersonating");
  const impData = impCookie
    ? (JSON.parse(impCookie.value) as { adminEmail: string })
    : null;

  // Active system announcement
  let announcementMessage: string | null = null;
  try {
    const adminClient = getSupabaseAdmin();
    const { data: ann } = await adminClient
      .from("system_announcements")
      .select("message")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    announcementMessage = ann?.message ?? null;
  } catch {
    // table not created yet — safe to ignore
  }

  // Contas com erro de publicação — banner de saúde
  let accountHealthErrors: AccountHealthError[] = [];
  try {
    const adminClient = getSupabaseAdmin();
    const { data: errAccounts } = await adminClient
      .from("instagram_accounts")
      .select("id, username")
      .eq("user_id", user.id)
      .eq("health_status", "error")
      .eq("is_active", true);

    if (errAccounts && errAccounts.length > 0) {
      // Busca o último erro real de cada conta para categorizar
      const accountIds = errAccounts.map((a: { id: string }) => a.id);
      const { data: errContainers } = await adminClient
        .from("pending_containers")
        .select("account_id, error_message")
        .in("account_id", accountIds)
        .eq("status", "error")
        .not("error_message", "is", null)
        .not("error_message", "like", "%AUTO-HEALING%")
        .order("created_at", { ascending: false });

      // Pega o último erro por conta
      const lastErrorByAccount = new Map<string, string>();
      for (const row of (errContainers ?? []) as { account_id: string; error_message: string }[]) {
        if (!lastErrorByAccount.has(row.account_id)) {
          lastErrorByAccount.set(row.account_id, row.error_message);
        }
      }

      accountHealthErrors = (errAccounts as { id: string; username: string }[]).map(a => {
        const msg = (lastErrorByAccount.get(a.id) ?? "").toLowerCase();
        const errorType: AccountHealthError["errorType"] =
          msg.includes("unsupported request") ? "unsupported"
          : msg.includes("not a confirmed user") || msg.includes("sessions for the user") || msg.includes("access token")
          ? "token"
          : "unknown";
        return { id: a.id, username: a.username, errorType };
      });
    }
  } catch {
    // falha silenciosa — banner não é crítico
  }

  return (
    <div className="flex flex-col h-screen">
      {/* ── System banners ─────────────────────────────────────── */}
      {impData && (
        <ImpersonationBanner
          adminEmail={impData.adminEmail}
          userEmail={user.email ?? ""}
        />
      )}
      {announcementMessage && !impData && (
        <AnnouncementBanner message={announcementMessage} />
      )}
      {accountHealthErrors.length > 0 && (
        <AccountHealthBanner accounts={accountHealthErrors} />
      )}

      {/* ── App shell ──────────────────────────────────────────── */}
      <DashboardShell>{children}</DashboardShell>
    </div>
  );
}
