import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
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
    <div className="flex flex-col h-screen bg-[#020617]">
      {/* ── Ambient background ─────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        {/* Subtle grid overlay */}
        <div className="absolute inset-0 grid-bg opacity-[0.12]" />
        {/* Violet top-center aurora — primary */}
        <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-[1100px] h-[800px] bg-violet-600/[0.11] rounded-full blur-[160px] animate-[aurora-shift_14s_ease-in-out_infinite_alternate]" />
        {/* Cyan right aurora */}
        <div className="absolute top-1/4 -right-64 w-[700px] h-[700px] bg-cyan-500/[0.07] rounded-full blur-[140px] animate-[aurora-shift_18s_ease-in-out_infinite_alternate-reverse]" />
        {/* Indigo bottom-left aurora */}
        <div className="absolute -bottom-48 left-1/4 w-[600px] h-[600px] bg-indigo-700/[0.08] rounded-full blur-[120px] animate-[aurora-shift_22s_ease-in-out_infinite_alternate]" />
        {/* Fuchsia accent — subtle far-right */}
        <div className="absolute top-2/3 -right-24 w-[400px] h-[400px] bg-fuchsia-700/[0.05] rounded-full blur-[100px]" />
        {/* Teal accent — bottom-center */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-teal-600/[0.04] rounded-full blur-[100px]" />
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
      <DashboardShell>{children}</DashboardShell>
    </div>
  );
}
