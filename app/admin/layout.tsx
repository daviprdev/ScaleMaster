import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Shield, Users, FileText, Bell, MessageSquare, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Admin — Scale Master",
  description: "Painel administrativo do Scale Master",
};

// Admin pages depend on the signed-in user and must not be prerendered at build time.
export const dynamic = "force-dynamic";

interface AdminNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const ADMIN_NAV: AdminNavItem[] = [
  { label: "Visão geral", href: "/admin", icon: Shield },
  { label: "Usuários", href: "/admin/users", icon: Users },
  { label: "Contas", href: "/admin/accounts", icon: Users },
  { label: "Logs", href: "/admin/logs", icon: FileText },
  { label: "Notificações", href: "/admin/notifications", icon: Bell },
  { label: "Suporte", href: "/admin/support", icon: MessageSquare },
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
    <div className="flex h-screen w-full bg-bg">
      {/* Sidebar */}
      <aside className="hidden w-[var(--sidebar-width)] flex-col border-r border-line bg-surface lg:flex">
        {/* Logo */}
        <div className="flex h-[var(--topbar-height)] items-center gap-3 border-b border-line px-4">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div className="relative h-[26px] w-[26px] shrink-0 overflow-hidden rounded-[7px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/scale-master-logo.jpg"
                alt="Scale Master"
                width={26}
                height={26}
                className="h-full w-full object-contain"
              />
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-wordmark">
              Admin
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 custom-scrollbar">
          <div className="flex flex-col gap-1">
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex h-[34px] items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors duration-150 ease-in-out",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                    "text-ink-2 hover:bg-surface-hover hover:text-ink"
                  )}
                >
                  <Icon
                    size={17}
                    strokeWidth={1.75}
                    className="shrink-0 text-ink-3 group-hover:text-ink-2"
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-line p-3">
          <Link
            href="/dashboard"
            className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-ink-3 hover:bg-surface-hover hover:text-ink transition-colors"
          >
            <Settings size={16} strokeWidth={1.75} />
            <span>Voltar ao painel</span>
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="flex h-[var(--topbar-height)] items-center gap-3 border-b border-line bg-bg px-4 lg:hidden">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="relative h-[22px] w-[22px] shrink-0 overflow-hidden rounded-[6px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/scale-master-logo.jpg"
                alt="Scale Master"
                width={22}
                height={22}
                className="h-full w-full object-contain"
              />
            </div>
            <span className="text-sm font-semibold text-wordmark">Admin</span>
          </Link>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[var(--content-max)] px-4 py-7 sm:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
