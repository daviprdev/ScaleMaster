"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, Clock, LogOut, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function PendingPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace("/auth/login"); return; }
      setEmail(user.email ?? null);
    });
  }, [router]);

  async function checkApproval() {
    setChecking(true);
    // Trying to navigate to dashboard — the server layout will let them in
    // if approved, or redirect back here if still pending.
    router.push("/dashboard");
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 grid-bg opacity-20 pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-amber-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] bg-violet-500/5 rounded-full blur-[80px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center mb-8"
        >
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.4)]">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              AutoScale
            </span>
          </div>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="glass neon-border rounded-2xl p-8 text-center"
        >
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Clock className="w-9 h-9 text-amber-400" />
              </div>
              {/* Pulse ring */}
              <motion.div
                animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-full border border-amber-400/30"
              />
            </div>
          </div>

          {/* Text */}
          <h1 className="text-2xl font-bold text-white mb-2">
            Conta em análise
          </h1>
          <p className="text-white/50 text-sm leading-relaxed mb-2">
            Seu acesso está aguardando a aprovação de um administrador.
          </p>
          {email && (
            <p className="text-xs text-white/25 mb-6 truncate">
              {email}
            </p>
          )}

          {/* Status badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-4 py-2 mb-8">
            <motion.div
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-amber-400"
            />
            <span className="text-xs font-medium text-amber-300">
              Aguardando aprovação
            </span>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <motion.button
              onClick={checkApproval}
              disabled={checking}
              whileTap={{ scale: 0.97 }}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {checking ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {checking ? "Verificando…" : "Verificar aprovação"}
            </motion.button>

            <button
              onClick={handleLogout}
              className="btn-ghost w-full flex items-center justify-center gap-2 text-sm text-white/40 hover:text-white/70"
            >
              <LogOut className="w-4 h-4" />
              Sair da conta
            </button>
          </div>
        </motion.div>

        <p className="text-center text-xs text-white/20 mt-6">
          Assim que aprovado, você terá acesso imediato ao painel.
        </p>
      </div>
    </div>
  );
}
