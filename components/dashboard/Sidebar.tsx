"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  Zap,
  LayoutDashboard,
  FolderOpen,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  User,
  CreditCard,
  Shield,
  KeyRound,
  Send,
  Repeat2,
  ShieldAlert,
  Clock,
  Activity,
  Sparkles,
  TrendingUp,
  Globe,
  Copy,
  ImagePlay,
  Link2,
  Lock,
  BookUser,
  UserPlus,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  exact?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "VISÃO GERAL",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, exact: true },
      { label: "Contas", href: "/dashboard/accounts", icon: Users },
      { label: "Onboarding", href: "/dashboard/onboarding", icon: UserPlus },
    ],
  },
  {
    label: "PUBLICAÇÃO",
    items: [
      { label: "Postar", href: "/dashboard/postar", icon: Send },
      { label: "Loop", href: "/dashboard/loop", icon: Repeat2 },
      { label: "Clonar Perfil", href: "/dashboard/clone", icon: Copy },
      { label: "Stories", href: "/dashboard/stories", icon: ImagePlay },
    ],
  },
  {
    label: "CONTEÚDO",
    items: [
      { label: "Inspirações",     href: "/dashboard/inspirations",    icon: Sparkles },
      { label: "Contas Leitoras", href: "/dashboard/contas-leitoras", icon: BookUser },
      { label: "Biblioteca",      href: "/dashboard/library",         icon: FolderOpen },
      { label: "Links",           href: "/dashboard/links",           icon: Link2 },
    ],
  },
  {
    label: "RELATÓRIOS",
    items: [
      { label: "Monitor",   href: "/dashboard/monitor",   icon: Activity },
      { label: "Analytics", href: "/dashboard/analytics", icon: TrendingUp },
    ],
  },
  {
    label: "CONFIGURAÇÕES",
    items: [
      { label: "Meu App",        href: "/dashboard/apps",           icon: KeyRound },
      { label: "Logins",         href: "/dashboard/logins",         icon: Lock },
      { label: "Failover",       href: "/dashboard/failover",       icon: ShieldAlert },
      { label: "Horário Humano", href: "/dashboard/human-schedule", icon: Clock },
      { label: "Proxies",        href: "/dashboard/proxy-test",     icon: Globe },
    ],
  },
];

export function Sidebar({ mobileOpen = false, onMobileClose = () => {} }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [collapsed, setCollapsed] = useState(false);
  const [userName, setUserName] = useState("Usuário");
  const [userEmail, setUserEmail] = useState("");
  const [userInitial, setUserInitial] = useState("U");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLDivElement>(null);
  const loggingOutRef = useRef(false);
  const collapsedRef = useRef(collapsed);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const name = user.user_metadata?.full_name || user.email || "Usuário";
      setUserName(name);
      setUserEmail(user.email ?? "");
      setUserInitial(name.charAt(0).toUpperCase());
      setUserAvatar(user.user_metadata?.avatar_url ?? null);

      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.role === "admin") setIsAdmin(true);
        });
    });
  }, [supabase]);

  const openMenu = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pos = collapsedRef.current
      ? { top: rect.top, left: rect.right + 8, width: 240 }
      : { bottom: window.innerHeight - rect.top + 8, left: rect.left, width: Math.max(rect.width, 240) };
    setMenuPos(pos);
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => { setMenuOpen(false); }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, closeMenu]);

  const handleLogout = async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    closeMenu();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {/* ── Sidebar Desktop ─────────────────────────────────────── */}
      <aside
        className={cn(
          "relative flex-shrink-0 h-screen hidden md:flex flex-col border-r overflow-hidden z-20 transition-[width] duration-300 ease-in-out",
          collapsed ? "w-[72px]" : "w-[260px]"
        )}
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        {/* Logo */}
        <div className="flex items-center h-16 px-4 border-b flex-shrink-0" style={{ borderColor: "var(--border-subtle, rgba(255,255,255,0.06))" }}>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--accent)" }}
          >
            <Zap className="w-4 h-4 text-black" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <span className="ml-3 font-bold text-base tracking-tight whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
              AutoScale
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto overflow-x-hidden no-scrollbar">
          {navGroups.map((group, gi) => (
            <div key={group.label} className={cn(gi > 0 ? "pt-3" : "")}>
              {!collapsed && (
                <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  {group.label}
                </p>
              )}
              {collapsed && gi > 0 && (
                <div className="my-2 mx-auto w-6 h-px" style={{ background: "var(--border)" }} />
              )}

              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href, item.exact);
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        className={cn(
                          "relative flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-150",
                          active ? "" : "hover:bg-white/[0.04]"
                        )}
                        style={{
                          color: active ? "var(--accent-text)" : "var(--text-secondary)",
                          background: active ? "var(--accent-dim)" : undefined,
                        }}
                      >
                        <item.icon
                          className="flex-shrink-0"
                          size={16}
                          strokeWidth={1.8}
                          style={{ opacity: active ? 1 : 0.7 }}
                        />
                        {!collapsed && (
                          <span className="text-sm font-medium whitespace-nowrap">
                            {item.label}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Admin shortcut */}
          {isAdmin && (
            <div className="pt-3">
              <div className="my-1 border-t" style={{ borderColor: "var(--border-subtle, rgba(255,255,255,0.06))" }} />
              {!collapsed && (
                <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  SISTEMA
                </p>
              )}
              <Link href="/admin">
                <div
                  className={cn(
                    "relative flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-150",
                    pathname.startsWith("/admin") ? "" : "hover:bg-white/[0.04]"
                  )}
                  style={{
                    color: pathname.startsWith("/admin") ? "#FCD34D" : "var(--text-muted)",
                    background: pathname.startsWith("/admin") ? "rgba(245,158,11,0.08)" : undefined,
                  }}
                >
                  <Shield className="flex-shrink-0" size={16} strokeWidth={1.8} />
                  {!collapsed && (
                    <span className="text-sm font-medium whitespace-nowrap">Painel Admin</span>
                  )}
                </div>
              </Link>
            </div>
          )}
        </nav>

        {/* User trigger */}
        <div className="p-3 border-t flex-shrink-0" style={{ borderColor: "var(--border-subtle, rgba(255,255,255,0.06))" }}>
          <div
            ref={triggerRef}
            onClick={menuOpen ? closeMenu : openMenu}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && (menuOpen ? closeMenu() : openMenu())}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-150 select-none",
              collapsed ? "justify-center" : "",
              menuOpen ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
            )}
          >
            {userAvatar ? (
              <img src={userAvatar} alt="Avatar" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-black"
                style={{ background: "var(--accent)" }}
              >
                {userInitial}
              </div>
            )}
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate leading-tight" style={{ color: "var(--text-primary)" }}>{userName}</p>
                  <p className="text-[11px] leading-tight" style={{ color: "var(--text-muted)" }}>Minha Conta</p>
                </div>
                <ChevronUp
                  size={14}
                  className={cn("transition-transform duration-200 flex-shrink-0", menuOpen ? "rotate-180" : "")}
                  style={{ color: "var(--text-muted)" }}
                />
              </>
            )}
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-[72px] w-6 h-6 rounded-full flex items-center justify-center transition-colors z-30"
          style={{
            background: "var(--background)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </aside>

      {/* ── Portal dropdown & Mobile drawer ── */}
      {mounted && createPortal(
        <>
          {/* Mobile drawer */}
          {mobileOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.6)" }}
                onClick={onMobileClose}
              />
              <div
                style={{
                  position: "fixed", left: 0, top: 0, height: "100%", width: 280, zIndex: 260,
                  background: "var(--surface)",
                  paddingTop: "env(safe-area-inset-top)",
                  paddingBottom: "env(safe-area-inset-bottom)",
                }}
                className="flex flex-col border-r overflow-hidden"
              >
                {/* Logo row */}
                <div className="flex items-center h-16 px-4 border-b flex-shrink-0" style={{ borderColor: "var(--border-subtle, rgba(255,255,255,0.06))" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent)" }}>
                    <Zap className="w-4 h-4 text-black" strokeWidth={2.5} />
                  </div>
                  <span className="ml-3 font-bold text-base tracking-tight whitespace-nowrap" style={{ color: "var(--text-primary)" }}>AutoScale</span>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 py-3 overflow-y-auto overflow-x-hidden no-scrollbar">
                  {navGroups.map((group, gi) => (
                    <div key={group.label} className={cn(gi > 0 ? "pt-3" : "")}>
                      <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                        {group.label}
                      </p>
                      <div className="space-y-0.5">
                        {group.items.map((item) => {
                          const active = isActive(item.href, item.exact);
                          return (
                            <Link key={item.href} href={item.href} onClick={onMobileClose}>
                              <div
                                className="flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-150"
                                style={{
                                  color: active ? "var(--accent-text)" : "var(--text-secondary)",
                                  background: active ? "var(--accent-dim)" : undefined,
                                }}
                              >
                                <item.icon className="flex-shrink-0" size={16} strokeWidth={1.8} style={{ opacity: active ? 1 : 0.7 }} />
                                <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {isAdmin && (
                    <div className="pt-3">
                      <div className="my-1 border-t" style={{ borderColor: "var(--border-subtle, rgba(255,255,255,0.06))" }} />
                      <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>SISTEMA</p>
                      <Link href="/admin" onClick={onMobileClose}>
                        <div
                          className="flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-150"
                          style={{
                            color: pathname.startsWith("/admin") ? "#FCD34D" : "var(--text-muted)",
                            background: pathname.startsWith("/admin") ? "rgba(245,158,11,0.08)" : undefined,
                          }}
                        >
                          <Shield className="flex-shrink-0" size={16} strokeWidth={1.8} />
                          <span className="text-sm font-medium whitespace-nowrap">Painel Admin</span>
                        </div>
                      </Link>
                    </div>
                  )}
                </nav>

                {/* User section (mobile) */}
                <div className="p-3 border-t flex items-center gap-2 flex-shrink-0" style={{ borderColor: "var(--border-subtle, rgba(255,255,255,0.06))" }}>
                  <Link
                    href="/dashboard/settings"
                    onClick={onMobileClose}
                    className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors hover:bg-white/[0.04]"
                  >
                    {userAvatar ? (
                      <img src={userAvatar} alt="Avatar" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-black" style={{ background: "var(--accent)" }}>
                        {userInitial}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-semibold truncate leading-tight" style={{ color: "var(--text-primary)" }}>{userName}</p>
                      <p className="text-[11px] leading-tight" style={{ color: "var(--text-muted)" }}>Minha Conta</p>
                    </div>
                  </Link>
                  <button
                    onClick={handleLogout}
                    aria-label="Sair"
                    className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-md transition-colors hover:bg-red-500/[0.07]"
                    style={{ color: "#EF4444" }}
                  >
                    <LogOut size={17} />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Backdrop for desktop dropdown */}
          {menuOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 190 }} onClick={closeMenu} />
          )}

          {/* Desktop user dropdown */}
          {menuOpen && menuPos && (
            <div
              style={{
                position: "fixed",
                zIndex: 200,
                width: menuPos.width,
                left: menuPos.left,
                background: "var(--bg-elevated, #3F3F46)",
                ...(menuPos.top !== undefined ? { top: menuPos.top } : { bottom: menuPos.bottom }),
              }}
              className="border rounded-xl shadow-lg overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 py-3.5">
                {userAvatar ? (
                  <img src={userAvatar} alt="Avatar" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-black flex-shrink-0" style={{ background: "var(--accent)" }}>
                    {userInitial}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate leading-tight" style={{ color: "var(--text-primary)" }}>{userName}</p>
                  <p className="text-xs leading-tight" style={{ color: "var(--text-muted)" }}>{userEmail}</p>
                </div>
              </div>
              <div className="border-t" style={{ borderColor: "var(--border-subtle, rgba(255,255,255,0.06))" }} />
              <div className="p-1.5 space-y-0.5">
                <button
                  onClick={() => { closeMenu(); router.push("/dashboard/settings"); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors hover:bg-white/[0.05]"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  <User size={15} className="flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                  Perfil
                </button>
                <button
                  disabled
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm cursor-not-allowed"
                  style={{ color: "var(--text-disabled)" }}
                >
                  <CreditCard size={15} className="flex-shrink-0" style={{ opacity: 0.4 }} />
                  <span className="flex-1 text-left">Pagamentos</span>
                  <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-md" style={{ background: "var(--accent-dim)", color: "var(--accent-text)" }}>Em breve</span>
                </button>
              </div>
              <div className="border-t" style={{ borderColor: "var(--border-subtle, rgba(255,255,255,0.06))" }} />
              <div className="p-1.5">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors hover:bg-red-500/[0.07]"
                  style={{ color: "#EF4444" }}
                >
                  <LogOut size={15} className="flex-shrink-0" />
                  Sair
                </button>
              </div>
            </div>
          )}
        </>,
        document.body
      )}
    </>
  );
}