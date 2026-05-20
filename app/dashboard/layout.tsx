import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { ImpersonationBanner } from "@/components/dashboard/ImpersonationBanner";
import { AnnouncementBanner } from "@/components/dashboard/AnnouncementBanner";
import { ParticleBackground } from "@/components/dashboard/ParticleBackground";

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
    <div className="flex flex-col h-screen bg-slate-950">
      {/* ── Ambient background ─────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        {/* Grid overlay */}
        <div className="absolute inset-0 grid-bg opacity-[0.10]" />
        {/* Violet top-center glow */}
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[900px] h-[700px] bg-violet-600/[0.09] rounded-full blur-[140px]" />
        {/* Cyan right-side glow */}
        <div className="absolute top-1/3 -right-48 w-[600px] h-[600px] bg-cyan-500/[0.05] rounded-full blur-[120px]" />
        {/* Indigo bottom-left glow */}
        <div className="absolute -bottom-32 left-1/4 w-[500px] h-[500px] bg-indigo-700/[0.06] rounded-full blur-[100px]" />
      </div>

      {/* ── Floating particles ────────────────────────────────── */}
      <ParticleBackground />

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
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />

        <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />

          <main className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto w-full px-6 py-8 sm:px-8 sm:py-10">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
