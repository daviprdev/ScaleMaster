"use client";

import { motion } from "framer-motion";
import { Bell, Plus, Menu, Zap } from "lucide-react";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Visão Geral",
    subtitle: "Bem-vindo de volta",
  },
  "/dashboard/search": {
    title: "Inspirações",
    subtitle: "Encontre e baixe Reels de qualquer perfil",
  },
  "/dashboard/library": {
    title: "Biblioteca de Vídeos",
    subtitle: "Seus vídeos processados e prontos para postar",
  },
  "/dashboard/posts": {
    title: "Postagens",
    subtitle: "Agendamento em massa com distribuição inteligente",
  },
  "/dashboard/schedule": {
    title: "Agendamentos",
    subtitle: "Acompanhe o status de todos os posts agendados",
  },
  "/dashboard/accounts": {
    title: "Contas",
    subtitle: "Gerencie suas contas do Instagram",
  },
  "/dashboard/settings": {
    title: "Configurações",
    subtitle: "Configurações e sessão",
  },
  "/dashboard/analytics": {
    title: "Analytics",
    subtitle: "Métricas reais dos posts publicados via Meta API",
  },
  "/dashboard/loop": {
    title: "Loop",
    subtitle: "Publicação automatizada em ciclos",
  },
  "/dashboard/postar": {
    title: "Novo Post",
    subtitle: "Publique agora ou agende para uma data específica",
  },
  "/dashboard/fila": {
    title: "Fila",
    subtitle: "Os vídeos da fila, um por um",
  },
  "/dashboard/apps": {
    title: "Meus Apps",
    subtitle: "Gerencie suas credenciais Meta",
  },
  "/dashboard/emulador": {
    title: "Emulador",
    subtitle: "As instâncias do MuMu do seu PC",
  },
  "/dashboard/contas-vps": {
    title: "Contas VPS",
    subtitle: "Contas criadas em containers redroid na VPS",
  },
};

export function Header({ onMobileMenuToggle }: { onMobileMenuToggle?: () => void }) {
  const pathname = usePathname();
  const page = pageTitles[pathname] ?? { title: "Dashboard", subtitle: "" };

  return (
    <header
      className="h-14 md:h-16 flex items-center justify-between px-4 md:px-5
        border-b border-white/[0.07] md:border md:border-white/10 md:rounded-[18px] sticky top-0 z-10 flex-shrink-0"
      style={{ background: "linear-gradient(155deg, rgba(255,255,255,.07), rgba(255,255,255,.02))", backdropFilter: "blur(22px) saturate(140%)", WebkitBackdropFilter: "blur(22px) saturate(140%)" }}
    >
      {/* Mobile: hamburger + logo | Desktop: page title */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMobileMenuToggle}
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl
            text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </button>

        {/* Logo — mobile only */}
        <div className="md:hidden flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "var(--gradient-primary)", boxShadow: "0 0 12px var(--glow)" }}>
            <Zap size={14} className="text-black" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-sm gradient-text">Scale Master</span>
        </div>

        {/* Page title — desktop only */}
        <div className="hidden md:block min-w-0">
          <h1 className="text-base font-bold text-white leading-tight truncate">
            {page.title}
          </h1>
          <p className="text-xs text-ink-3 leading-tight truncate">{page.subtitle}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button aria-label="Notificações" className="relative w-10 h-10 rounded-[13px] bg-white/[0.06] border border-white/10
          flex items-center justify-center text-ink-2 hover:text-white hover:bg-white/[0.12]
          transition-all duration-300">
          <Bell size={16} strokeWidth={1.75} />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--primary-2)", boxShadow: "0 0 6px var(--primary-2)" }} />
        </button>

        {pathname === "/dashboard/schedule" && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
              text-white text-xs font-semibold btn-primary
              transition-all duration-200"
          style={{ padding: "0.375rem 0.75rem" }}
          >
            <Plus size={14} />
            <span className="hidden sm:inline">Nova postagem</span>
            <span className="sm:hidden">Nova</span>
          </motion.button>
        )}
      </div>
    </header>
  );
}
