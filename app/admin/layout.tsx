import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Shield, LayoutDashboard } from "lucide-react";

export const metadata = { title: "Admin — AutoScale" };

export default async function AdminLayout({
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
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") redirect("/dashboard");

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Fixed grid background */}
      <div className="fixed inset-0 grid-bg opacity-20 pointer-events-none" />

      {/* Top bar */}
      <header className="relative z-10 border-b border-white/10 bg-gray-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30">
              <Shield className="w-4 h-4 text-violet-400" />
            </div>
            <span className="font-semibold text-white">AutoScale</span>
            <span className="text-white/20">/</span>
            <span className="text-sm text-violet-400 font-medium">Admin</span>
          </div>

          <nav className="flex items-center gap-2">
            <Link
              href="/admin/users"
              className="text-sm text-white/60 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              Usuários
            </Link>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-sm text-white/60 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
