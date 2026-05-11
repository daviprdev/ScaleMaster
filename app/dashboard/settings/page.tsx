"use client";

import { motion } from "framer-motion";
import { Settings, Construction } from "lucide-react";

export default function SettingsPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-24 gap-4 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
        <Settings size={24} className="text-white/25" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-white/70 flex items-center justify-center gap-2">
          <Construction size={16} className="text-amber-400" />
          Configurações
        </h1>
        <p className="text-sm text-white/30 mt-1">Em breve.</p>
      </div>
    </motion.div>
  );
}
