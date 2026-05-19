"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  Zap,
  LayoutDashboard,
  Search,
  FolderOpen,
  CalendarClock,
  CalendarRange,
  Users,
  BarChart2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  User,
  CreditCard,
  Shield,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { label: "Visão Geral", href: "/dashboard", icon: LayoutDashboard, exact: true },
  { label: "Contas", href: "/dashboard/accounts", icon: Users },
  { label: "Inspirações", href: "/dashboard/search", icon: Search },
  { label: "Biblioteca", href: "/dashboard/library", icon: FolderOpen },
  { label: "Postagens", href: "/dashboard/posts", icon: CalendarRange },
  { label: "Agendamentos", href: "/dashboard/schedule", icon: CalendarClock },
  { label: "Analytics", href: "/dashboard/analytics", icon: BarChart2 },
];

export function Sidebar() {
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
  // Track collapsed inside handler without stale closure
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

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

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
        className="relative flex-shrink-0 h-screen flex flex-col
          bg-[#0c0e15] border-r border-white/[0.08] overflow-hidden z-20"
      >
        {/* Glow accent */}
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-violet-600/10 to-transparent pointer-events-none" />

        {/* Logo */}
        <div className="relative flex items-center h-16 px-4 border-b border-white/[0.07]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(139,92,246,0.4)]">
            <Zap className="w-4 h-4 text-white" />
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
        <nav className="relative flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
          <AnimatePresence>
            {!collapsed && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/25"
              >
                Menu
              </motion.p>
            )}
          </AnimatePresence>

          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link key={item.href} href={item.href}>
                <motion.div
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    "relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200",
                    active
                      ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                      : "text-white/40 hover:text-white/80 hover:bg-white/5"
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 rounded-xl bg-violet-600/10"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                    />
                  )}
                  <item.icon
                    className={cn("flex-shrink-0 relative z-10", active ? "text-violet-400" : "")}
                    size={18}
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
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-violet-400" />
                  )}
                </motion.div>
              </Link>
            );
          })}

          {/* Admin shortcut — only rendered for admins */}
          {isAdmin && (
            <>
              <div className="my-2 border-t border-white/[0.06]" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-500/40"
                  >
                    Sistema
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
                      ? "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                      : "text-amber-500/50 hover:text-amber-400 hover:bg-amber-500/10"
                  )}
                >
                  <Shield className="flex-shrink-0 relative z-10" size={18} />
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
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-amber-400" />
                  )}
                </motion.div>
              </Link>
            </>
          )}
        </nav>

        {/* User trigger */}
        <div className="p-3 border-t border-white/[0.07]">
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
                ? "bg-white/[0.08] border border-white/[0.12]"
                : "hover:bg-white/[0.05] border border-transparent"
            )}
          >
            {userAvatar ? (
              <img
                src={userAvatar}
                alt="Avatar"
                className="w-8 h-8 rounded-full object-cover flex-shrink-0 shadow-[0_0_8px_rgba(139,92,246,0.3)]"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center flex-shrink-0 text-sm font-bold text-white shadow-[0_0_8px_rgba(139,92,246,0.3)]">
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
                  <p className="text-sm font-semibold text-white/85 truncate leading-tight">
                    {userName}
                  </p>
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
                    className={cn(
                      "transition-transform duration-200",
                      menuOpen ? "rotate-180" : ""
                    )}
                  />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-gray-800 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:border-violet-500/50 transition-all z-30"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </motion.aside>

      {/* ── Portal dropdown — outside the aside, renders in document.body ── */}
      {mounted && createPortal(
        <>
          {/* Backdrop — closes menu on outside click */}
          {menuOpen && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 190 }}
              onClick={closeMenu}
            />
          )}

          {/* Dropdown menu */}
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
                  ...(menuPos.top !== undefined ? { top: menuPos.top } : { bottom: menuPos.bottom }),
                }}
                className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  {userAvatar ? (
                    <img
                      src={userAvatar}
                      alt="Avatar"
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0 shadow-[0_0_10px_rgba(139,92,246,0.35)]"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-sm font-bold text-white flex-shrink-0 shadow-[0_0_10px_rgba(139,92,246,0.35)]">
                      {userInitial}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate leading-tight">
                      {userName}
                    </p>
                    <p className="text-xs text-gray-500 leading-tight">{userEmail}</p>
                  </div>
                </div>

                <div className="border-t border-gray-800" />

                {/* Links */}
                <div className="p-1.5 space-y-0.5">
                  <button
                    onClick={() => { closeMenu(); router.push("/dashboard/settings"); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    <User size={15} className="flex-shrink-0 text-gray-500" />
                    Perfil
                  </button>
                  <button
                    disabled
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 cursor-not-allowed"
                  >
                    <CreditCard size={15} className="flex-shrink-0 text-gray-700" />
                    <span className="flex-1 text-left">Pagamentos</span>
                    <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-500/60">
                      Em breve
                    </span>
                  </button>
                </div>

                <div className="border-t border-gray-800" />

                {/* Logout */}
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
