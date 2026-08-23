import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ImpersonationBanner } from "@/components/dashboard/ImpersonationBanner";
import { AnnouncementBanner } from "@/components/dashboard/AnnouncementBanner";
import { AccountHealthBanner, type AccountHealthError } from "@/components/dashboard/AccountHealthBanner";
import { CascadeHealthBanner } from "@/components/dashboard/CascadeHealthBanner";
import { ProxyOutageBanner } from "@/components/dashboard/ProxyOutageBanner";

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
  let impData: { adminEmail: string } | null = null;
  if (impCookie) {
    try {
      impData = JSON.parse(impCookie.value) as { adminEmail: string };
    } catch {
      // Cookie malformado (editado manualmente/corrompido) — ignora em vez de derrubar o dashboard
      impData = null;
    }
  }

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

  // Contas com erro de publicação — banner de saúde + detecção de cascade
  let accountHealthErrors: AccountHealthError[] = [];
  let cascadeCount = 0;
  try {
    const adminClient = getSupabaseAdmin();
    const { data: errAccounts } = await adminClient
      .from("instagram_accounts")
      .select("id, username")
      .eq("user_id", user.id)
      .eq("health_status", "error")
      .eq("is_active", true);

    if (errAccounts && errAccounts.length > 0) {
      const accountIds = (errAccounts as { id: string; username: string }[]).map(a => a.id);

      // Busca o último erro real de cada conta para categorizar
      const { data: errContainers } = await adminClient
        .from("pending_containers")
        .select("account_id, error_message, created_at")
        .in("account_id", accountIds)
        .eq("status", "error")
        .not("error_message", "is", null)
        .not("error_message", "like", "%AUTO-HEALING%")
        .order("created_at", { ascending: false });

      // Pega o último erro por conta
      const lastErrorByAccount = new Map<string, string>();
      for (const row of (errContainers ?? []) as { account_id: string; error_message: string; created_at: string }[]) {
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

      // Detecção de queda em cascata: 4+ contas com erros na última hora
      // Sinal de problema no App Meta, não nas contas individualmente
      if (accountIds.length >= 4) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recentErrors } = await adminClient
          .from("pending_containers")
          .select("account_id")
          .in("account_id", accountIds)
          .eq("status", "error")
          .gte("created_at", oneHourAgo)
          .not("error_message", "like", "%AUTO-HEALING%");

        const distinctRecent = new Set(
          (recentErrors ?? []).map((r: { account_id: string }) => r.account_id)
        );
        if (distinctRecent.size >= 4) {
          cascadeCount = distinctRecent.size;
        }
      }
    }
  } catch {
    // falha silenciosa — banners não são críticos
  }

  // Queda global de proxy: 3+ contas com falha de proxy nos últimos 30 min.
  // Sinal de plano expirado / lista de IPs rotacionada no provedor — o pipeline
  // inteiro para em silêncio (crons pulam contas sem marcar erro). Outage 2026-07-09.
  let proxyOutageCount = 0;
  let proxyOutageSince: string | null = null;
  try {
    const adminClient = getSupabaseAdmin();
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: proxyFails } = await adminClient
      .from("instagram_accounts")
      .select("id, last_proxy_error_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .not("proxy_url", "is", null)
      .gte("last_proxy_error_at", thirtyMinAgo);

    const rows = (proxyFails ?? []) as { id: string; last_proxy_error_at: string }[];
    if (rows.length >= 3) {
      proxyOutageCount = rows.length;
      const earliest = rows.reduce(
        (min, r) => (r.last_proxy_error_at < min ? r.last_proxy_error_at : min),
        rows[0].last_proxy_error_at
      );
      proxyOutageSince = new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(earliest));
    }
  } catch {
    // coluna last_proxy_error_at pode não existir ainda — fallback gracioso
  }

  return (
    <div className="flex flex-col h-dvh pt-safe pb-safe">
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
      {proxyOutageCount >= 3 && (
        <ProxyOutageBanner count={proxyOutageCount} sinceLabel={proxyOutageSince} />
      )}
      {cascadeCount >= 4 && (
        <CascadeHealthBanner count={cascadeCount} />
      )}
      {accountHealthErrors.length > 0 && (
        <AccountHealthBanner accounts={accountHealthErrors} />
      )}

      {/* ── App shell ──────────────────────────────────────────── */}
      <DashboardShell>{children}</DashboardShell>
    </div>
  );
}
