"use client";

import { motion } from "framer-motion";
import { CalendarClock, Sparkles } from "lucide-react";

export default function SchedulePage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.4)]">
        <CalendarClock className="w-7 h-7 text-white" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Agendamento</h2>
        <p className="text-white/40 max-w-md">
          A interface de agendamento multi-conta será construída na{" "}
          <span className="text-amber-400 font-medium">Fase 5</span> — seleção
          de contas, vídeo da biblioteca e configuração de horário.
        </p>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 rounded-full glass border border-amber-500/20 text-sm text-amber-300">
        <Sparkles size={14} />
        Em breve — Fase 5
      </div>
    </motion.div>
  );
}
