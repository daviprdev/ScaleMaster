"use client";

import { motion, AnimatePresence } from "framer-motion";
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
  Bot,
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
      { label: "RPA", href: "/dashboard/rpa", icon: Bot },
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
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <motion.aside
        animate={{ width: collapsed ? 72 : 240 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="relative flex-shrink-0 h-screen hidden md:flex flex-col
          border-r border-white/[0.07] overflow-hidden z-20"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)" }}
      >
        {/* Horizon glow accent */}
        <div className="absolute top-0 left-0 w-full h-48 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 120% 60% at 50% -10%, rgba(0,255,65,0.05) 0%, transparent 100%)" }} />

        {/* Logo */}
        <div className="relative flex items-center h-16 px-4 border-b border-white/[0.06]">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#00FF41,#00E5FF)", boxShadow: "0 0 14px rgba(0,255,65,0.45)" }}>
            <Zap className="w-4 h-4 text-black" strokeWidth={2.5} />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="ml-3 font-bold text-lg gradient-text whitespace-nowrap"
              >
                AutoScale
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Nav */}
        <nav className="relative flex-1 px-3 py-3 overflow-y-auto overflow-x-hidden space-y-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {navGroups.map((group, gi) => (
            <div key={group.label} className={cn(gi > 0 ? "pt-2" : "")}>
              {/* Group label */}
              <AnimatePresence>
                {!collapsed && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="px-3 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-700"
                  >
                    {group.label}
                  </motion.p>
                )}
              </AnimatePresence>
              {collapsed && gi > 0 && (
                <div className="my-2 mx-auto w-6 h-px bg-[#1E1E1E]" />
              )}

              {/* Items */}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href, item.exact);
                  return (
                    <Link key={item.href} href={item.href}>
                      <motion.div
                        whileHover={{ x: 2 }}
                        whileTap={{ scale: 0.97 }}
                        className={cn(
                          "relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-300",
                          active
                            ? "text-white"
                            : "text-neutral-500 hover:text-neutral-200 hover:border-matrix/30",
                          !active && "border border-transparent"
                        )}
                      >
                        {active && (
                          <>
                            <motion.div
                              layoutId="activeNav"
                              className="absolute inset-0 rounded-xl"
                              style={{ background: "rgba(0,255,65,0.06)" }}
                              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                            />
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[55%] rounded-r-full"
                              style={{ background: "var(--matrix)", boxShadow: "0 0 8px rgba(0,255,65,0.8)" }} />
                          </>
                        )}
                        <item.icon
                          className={cn("flex-shrink-0 relative z-10")}
                          style={active ? { color: "var(--matrix)" } : undefined}
                          size={17}
                          strokeWidth={1.5}
                        />
                        <AnimatePresence>
                          {!collapsed && (
                            <motion.span
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -8 }}
                              transition={{ duration: 0.2 }}
                              className="text-sm font-medium whitespace-nowrap relative z-10"
                            >
                              {item.label}
                            </motion.span>
                          )}
                        </AnimatePresence>
                        {collapsed && active && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[55%] bg-violet-500 rounded-r-full" />
                        )}
                      </motion.div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Admin shortcut */}
          {isAdmin && (
            <div className="pt-2">
              <div className="my-1 border-t border-white/[0.06]" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-3 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-700"
                  >
                    SISTEMA
                  </motion.p>
                )}
              </AnimatePresence>
              <Link href="/admin">
                <motion.div
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    "relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200",
                    pathname.startsWith("/admin")
                      ? "bg-amber-500/[0.08] text-amber-300"
                      : "text-amber-600/60 hover:text-amber-400 hover:bg-amber-500/[0.07]"
                  )}
                >
                  <Shield className="flex-shrink-0 relative z-10" size={17} strokeWidth={1.5} />
                  <AnimatePresence>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        transition={{ duration: 0.2 }}
                        className="text-sm font-medium whitespace-nowrap relative z-10"
                      >
                        Painel Admin
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {collapsed && pathname.startsWith("/admin") && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[55%] bg-amber-400 rounded-r-full" />
                  )}
                </motion.div>
              </Link>
            </div>
          )}
        </nav>

        {/* User trigger */}
        <div className="p-3 border-t border-white/[0.06]">
          <div
            ref={triggerRef}
            onClick={menuOpen ? closeMenu : openMenu}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && (menuOpen ? closeMenu() : openMenu())}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 select-none",
              collapsed ? "justify-center" : "",
              menuOpen
                ? "bg-white/[0.06] border border-[#222]"
                : "hover:bg-white/[0.04] border border-transparent"
            )}
          >
            {userAvatar ? (
              <img
                src={userAvatar}
                alt="Avatar"
                className="w-8 h-8 rounded-full object-cover flex-shrink-0 shadow-[0_0_8px_rgba(0,255,65,0.22)]"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00FF41] to-[#00E5FF] flex items-center justify-center flex-shrink-0 text-sm font-bold text-white shadow-[0_0_8px_rgba(0,255,65,0.22)]">
                {userInitial}
              </div>
            )}
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 min-w-0"
                >
                  <p className="text-sm font-semibold text-white/85 truncate leading-tight">{userName}</p>
                  <p className="text-[11px] text-white/35 leading-tight">Minha Conta</p>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-shrink-0 text-white/25"
                >
                  <ChevronUp
                    size={14}
                    className={cn("transition-transform duration-200", menuOpen ? "rotate-180" : "")}
                  />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-[#0A0A0A] border border-[#1E1E1E] flex items-center justify-center text-neutral-600 hover:text-white hover:border-matrix/40 transition-all z-30"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </motion.aside>

      {/* ── Portal dropdown ── */}
      {mounted && createPortal(
        <>
          {/* Mobile drawer */}
          <AnimatePresence>
            {mobileOpen && (
              <>
                <motion.div
                  key="mobile-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.65)" }}
                  onClick={onMobileClose}
                />
                <motion.div
                  key="mobile-drawer"
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  style={{ position: "fixed", left: 0, top: 0, height: "100%", width: 280, zIndex: 260, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
                  className="flex flex-col border-r border-white/[0.07] overflow-hidden"
                >

                  {/* Logo row */}
                  <div className="relative flex items-center h-16 px-4 border-b border-white/[0.06]">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "linear-gradient(135deg,#00FF41,#00E5FF)", boxShadow: "0 0 14px rgba(0,255,65,0.45)" }}>
                      <Zap className="w-4 h-4 text-black" strokeWidth={2.5} />
                    </div>
                    <span className="ml-3 font-bold text-lg gradient-text whitespace-nowrap">AutoScale</span>
                  </div>

                  {/* Nav */}
                  <nav className="relative flex-1 px-3 py-3 overflow-y-auto overflow-x-hidden space-y-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    {navGroups.map((group, gi) => (
                      <div key={group.label} className={cn(gi > 0 ? "pt-2" : "")}>
                        <p className="px-3 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-700">
                          {group.label}
                        </p>
                        <div className="space-y-0.5">
                          {group.items.map((item) => {
                            const active = isActive(item.href, item.exact);
                            return (
                              <Link key={item.href} href={item.href} onClick={onMobileClose}>
                                <div
                                  className={cn(
                                    "relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-300",
                                    active ? "text-white" : "text-neutral-500 hover:text-neutral-200"
                                  )}
                                  style={active ? { background: "rgba(0,255,65,0.06)" } : undefined}
                                >
                                  {active && (
                                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[55%] rounded-r-full"
                                      style={{ background: "var(--matrix)", boxShadow: "0 0 8px rgba(0,255,65,0.8)" }} />
                                  )}
                                  <item.icon
                                    className="flex-shrink-0 relative z-10"
                                    style={active ? { color: "var(--matrix)" } : undefined}
                                    size={17}
                                    strokeWidth={1.5}
                                  />
                                  <span className="text-sm font-medium whitespace-nowrap relative z-10">{item.label}</span>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {isAdmin && (
                      <div className="pt-2">
                        <div className="my-1 border-t border-white/[0.06]" />
                        <p className="px-3 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-700">SISTEMA</p>
                        <Link href="/admin" onClick={onMobileClose}>
                          <div
                            className={cn(
                              "relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200",
                              pathname.startsWith("/admin")
                                ? "bg-amber-500/10 text-amber-300"
                                : "text-amber-500/50 hover:text-amber-400 hover:bg-amber-500/[0.07]"
                            )}
                          >
                            <Shield className="flex-shrink-0 relative z-10" size={17} strokeWidth={1.5} />
                            <span className="text-sm font-medium whitespace-nowrap relative z-10">Painel Admin</span>
                          </div>
                        </Link>
                      </div>
                    )}
                  </nav>

                  {/* User trigger (simplified in mobile) — nome/foto leva ao Perfil, logout só no botão dedicado */}
                  <div className="p-3 border-t border-white/[0.06] flex items-center gap-2">
                    <Link
                      href="/dashboard/settings"
                      onClick={onMobileClose}
                      className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/70 hover:bg-white/[0.05] transition-colors"
                    >
                      {userAvatar ? (
                        <img
                          src={userAvatar}
                          alt="Avatar"
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0 shadow-[0_0_8px_rgba(0,255,65,0.22)]"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00FF41] to-[#00E5FF] flex items-center justify-center flex-shrink-0 text-sm font-bold text-black">
                          {userInitial}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-semibold text-white/85 truncate leading-tight">{userName}</p>
                        <p className="text-[11px] text-white/35 leading-tight">Minha Conta</p>
                      </div>
                    </Link>
                    <button
                      onClick={handleLogout}
                      aria-label="Sair"
                      className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-red-500/60 hover:text-red-400 hover:bg-red-500/[0.07] transition-colors"
                    >
                      <LogOut size={17} />
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {menuOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 190 }} onClick={closeMenu} />
          )}
          <AnimatePresence>
            {menuOpen && menuPos && (
              <motion.div
                key="user-dropdown"
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                style={{
                  position: "fixed",
                  zIndex: 200,
                  width: menuPos.width,
                  left: menuPos.left,
                  background: "rgba(0,0,0,0.88)",
                  backdropFilter: "blur(28px) saturate(180%)",
                  WebkitBackdropFilter: "blur(28px) saturate(180%)",
                  ...(menuPos.top !== undefined ? { top: menuPos.top } : { bottom: menuPos.bottom }),
                }}
                className="border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3.5">
                  {userAvatar ? (
                    <img src={userAvatar} alt="Avatar" className="w-9 h-9 rounded-full object-cover flex-shrink-0 shadow-[0_0_10px_rgba(0,255,65,0.25)]" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00FF41] to-[#00E5FF] flex items-center justify-center text-sm font-bold text-white flex-shrink-0 shadow-[0_0_10px_rgba(0,255,65,0.25)]">
                      {userInitial}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate leading-tight">{userName}</p>
                    <p className="text-xs text-white/30 leading-tight">{userEmail}</p>
                  </div>
                </div>
                <div className="border-t border-white/[0.06]" />
                <div className="p-1.5 space-y-0.5">
                  <button
                    onClick={() => { closeMenu(); router.push("/dashboard/settings"); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    <User size={15} className="flex-shrink-0 text-white/30" />
                    Perfil
                  </button>
                  <button
                    disabled
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/20 cursor-not-allowed"
                  >
                    <CreditCard size={15} className="flex-shrink-0 text-white/15" />
                    <span className="flex-1 text-left">Pagamentos</span>
                    <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-md bg-matrix/10 text-matrix/50">Em breve</span>
                  </button>
                </div>
                <div className="border-t border-white/[0.06]" />
                <div className="p-1.5">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 hover:text-red-400 hover:bg-red-500/[0.07] transition-colors"
                  >
                    <LogOut size={15} className="flex-shrink-0" />
                    Sair
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body
      )}
    </>
  );
}
