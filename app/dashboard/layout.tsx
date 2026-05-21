import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ImpersonationBanner } from "@/components/dashboard/ImpersonationBanner";
import { AnnouncementBanner } from "@/components/dashboard/AnnouncementBanner";

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

  return (
    <div className="flex flex-col h-screen bg-[#050505]">
      {/* ── Ambient — single violet spotlight + hairline grid ── */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div
          className="absolute inset-x-0 top-0 h-[560px]"
          style={{
            background:
              "radial-gradient(ellipse 85% 55% at 50% -5%, rgba(124,58,237,0.1) 0%, transparent 100%)",
          }}
        />
        <div className="absolute inset-0 grid-bg" />
      </div>

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

      {/* ── App shell ──────────────────────────────────────────── */}
      <DashboardShell>{children}</DashboardShell>
    </div>
  );
}
