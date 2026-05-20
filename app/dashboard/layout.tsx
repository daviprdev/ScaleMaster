import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
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

  // Active system announcement (graceful: returns null if table doesn't exist yet)
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
    <div className="flex flex-col h-screen bg-gray-950">
      {/* System banners (stacked above the main layout) */}
      {impData && (
        <ImpersonationBanner
          adminEmail={impData.adminEmail}
          userEmail={user.email ?? ""}
        />
      )}
      {announcementMessage && !impData && (
        <AnnouncementBanner message={announcementMessage} />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Subtle grid background */}
        <div className="fixed inset-0 grid-bg opacity-20 pointer-events-none" />

        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
