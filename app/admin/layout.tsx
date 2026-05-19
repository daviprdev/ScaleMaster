import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import {
  Shield,
  LayoutDashboard,
  Users,
  Instagram,
  Headphones,
  LogOut,
} from "lucide-react";

export const metadata = { title: "Admin — AutoScale" };

const NAV_ITEMS = [
  { href: "/admin", label: "Visão Geral", icon: LayoutDashboard },
  { href: "/admin/users", label: "Usuários", icon: Users },
  { href: "/admin/accounts", label: "Contas Conectadas", icon: Instagram },
  { href: "/admin/support", label: "Suporte", icon: Headphones },
];

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
    <div className="min-h-screen bg-gray-950 text-white flex">
      {/* Fixed grid background */}
      <div className="fixed inset-0 grid-bg opacity-20 pointer-events-none" />

      {/* ── Sidebar ── */}
      <aside className="relative z-10 w-60 shrink-0 flex flex-col border-r border-white/10 bg-gray-950/80 backdrop-blur-xl">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30">
            <Shield className="w-4 h-4 text-violet-400" />
          </div>
          <div className="leading-none">
            <p className="text-sm font-bold text-white">AutoScale</p>
            <p className="text-[11px] text-violet-400 font-medium mt-0.5">Admin Panel</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors group"
            >
              <Icon className="w-4 h-4 shrink-0 group-hover:text-violet-400 transition-colors" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-white/10 space-y-0.5">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Voltar ao Dashboard
          </Link>
          <p className="px-3 pt-2 text-[11px] text-white/20 truncate">{user.email}</p>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
