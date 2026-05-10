"use client";

import { motion } from "framer-motion";
import { FolderOpen, Sparkles } from "lucide-react";

export default function LibraryPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.4)]">
        <FolderOpen className="w-7 h-7 text-white" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Biblioteca de Vídeos
        </h2>
        <p className="text-white/40 max-w-md">
          A biblioteca de mídia será construída na{" "}
          <span className="text-cyan-400 font-medium">Fase 5</span> — listagem de
          vídeos processados com opções de agendamento e exclusão.
        </p>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 rounded-full glass border border-cyan-500/20 text-sm text-cyan-300">
        <Sparkles size={14} />
        Em breve — Fase 5
      </div>
    </motion.div>
  );
}
