"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Zap,
  LayoutDashboard,
  Search,
  FolderOpen,
  CalendarClock,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Instagram,
  Bell,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    label: "Visão Geral",
    href: "/dashboard",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    label: "Pesquisa de Reels",
    href: "/dashboard/search",
    icon: Search,
  },
  {
    label: "Biblioteca",
    href: "/dashboard/library",
    icon: FolderOpen,
  },
  {
    label: "Agendamento",
    href: "/dashboard/schedule",
    icon: CalendarClock,
  },
];

const bottomItems = [
  { label: "Configurações", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 240 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="relative flex-shrink-0 h-screen flex flex-col
        bg-white/[0.03] backdrop-blur-xl
        border-r border-white/[0.07]
        overflow-hidden z-20"
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
              NexusSocial
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Nav */}
      <nav className="relative flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
        {/* Section label */}
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
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 group",
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
                  className={cn(
                    "w-4.5 h-4.5 flex-shrink-0 relative z-10",
                    active ? "text-violet-400" : ""
                  )}
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

                {/* Active dot for collapsed */}
                {collapsed && active && (
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-violet-400" />
                )}
              </motion.div>
            </Link>
          );
        })}

        {/* Accounts section */}
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/25">
                Contas Instagram
              </p>
              <div className="space-y-1">
                {["@minha_marca", "@loja_oficial"].map((account, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 cursor-pointer transition-all"
                  >
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center flex-shrink-0">
                      <Instagram size={10} className="text-white" />
                    </div>
                    <span className="text-xs truncate">{account}</span>
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                  </div>
                ))}
                <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-violet-400/60 hover:text-violet-300 hover:bg-violet-600/10 cursor-pointer transition-all text-xs">
                  <span className="text-lg leading-none">+</span>
                  Adicionar conta
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-white/[0.07] space-y-1">
        {bottomItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <motion.div
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/5 cursor-pointer transition-all"
            >
              <item.icon size={18} className="flex-shrink-0" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm font-medium whitespace-nowrap"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          </Link>
        ))}

        {/* User card */}
        <div
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 cursor-pointer transition-all",
            collapsed ? "justify-center" : ""
          )}
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center flex-shrink-0 text-xs font-bold">
            D
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0"
              >
                <p className="text-xs font-semibold text-white/80 truncate">
                  Davi Pereira
                </p>
                <p className="text-[10px] text-white/30 truncate">Pro Plan</p>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {!collapsed && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-white/20 hover:text-red-400 transition-colors"
              >
                <LogOut size={14} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-gray-800 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:border-violet-500/50 transition-all z-30"
      >
        {collapsed ? (
          <ChevronRight size={12} />
        ) : (
          <ChevronLeft size={12} />
        )}
      </button>
    </motion.aside>
  );
}
