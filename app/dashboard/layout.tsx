import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";

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

  // Admins are never blocked by account_status — they always have full access
  if (role !== "admin") {
    // No row yet (trigger hasn't run) or explicitly pending → waiting room
    if (!roleData || accountStatus === "pending") {
      redirect("/pending");
    }
    // Banned/rejected users — sign out and return to landing page
    if (accountStatus === "banned") {
      redirect("/auth/banned");
    }
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
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
  );
}
