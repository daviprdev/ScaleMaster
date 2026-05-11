"use client";

import { motion } from "framer-motion";
import { Bell, Plus } from "lucide-react";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Visão Geral",
    subtitle: "Bem-vindo de volta, Davi",
  },
  "/dashboard/search": {
    title: "Inspirações",
    subtitle: "Encontre e baixe Reels de qualquer perfil",
  },
  "/dashboard/library": {
    title: "Biblioteca de Vídeos",
    subtitle: "Seus vídeos processados e prontos para postar",
  },
  "/dashboard/schedule": {
    title: "Agendamento",
    subtitle: "Programe postagens para múltiplas contas",
  },
};

export function Header() {
  const pathname = usePathname();
  const page = pageTitles[pathname] ?? { title: "Dashboard", subtitle: "" };

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-16 flex items-center justify-between px-6
        bg-white/[0.02] backdrop-blur-xl
        border-b border-white/[0.07]
        sticky top-0 z-10"
    >
      {/* Page title */}
      <div>
        <h1 className="text-base font-bold text-white leading-tight">
          {page.title}
        </h1>
        <p className="text-xs text-white/35 leading-tight">{page.subtitle}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button className="relative w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white/80 hover:border-white/20 transition-all">
          <Bell size={15} />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-500" />
        </button>

        {/* New post CTA — only on schedule page */}
        {pathname === "/dashboard/schedule" && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
              bg-gradient-to-r from-violet-600 to-cyan-600
              hover:from-violet-500 hover:to-cyan-500
              text-white text-xs font-semibold
              hover:shadow-[0_0_15px_rgba(139,92,246,0.4)]
              transition-all duration-200"
          >
            <Plus size={14} />
            Nova postagem
          </motion.button>
        )}
      </div>
    </motion.header>
  );
}
