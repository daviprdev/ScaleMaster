"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Clock, LogOut, RefreshCw, Send, CheckCircle2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function PendingPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [messageText, setMessageText] = useState("");
  const [messageSent, setMessageSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace("/auth/login"); return; }
      setEmail(user.email ?? null);

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("account_status, pending_message")
        .eq("user_id", user.id)
        .single();

      if (roleData?.account_status === "banned") {
        router.replace("/auth/banned");
        return;
      }

      // Pre-fill if user already sent a message
      if (roleData?.pending_message) {
        setMessageText(roleData.pending_message);
        setMessageSent(true);
      }
    });
  }, [router]);

  async function checkApproval() {
    setChecking(true);
    router.push("/dashboard");
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
  }

  async function sendMessage() {
    if (!messageText.trim() || sending) return;
    setSending(true);
    setMessageError(null);
    try {
      const res = await fetch("/api/pending/message", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao enviar mensagem");
      setMessageSent(true);
    } catch (e) {
      setMessageError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 pt-safe pb-safe relative overflow-hidden">
      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center mb-8"
        >
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
              <Zap className="w-5 h-5 text-ink" />
            </div>
            <span className="text-2xl font-bold gradient-text">
              Scale Master
            </span>
          </div>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="glass  rounded-2xl p-8"
        >
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-warning-soft border border-warning/20 flex items-center justify-center">
                <Clock className="w-9 h-9 text-warning" />
              </div>
              <motion.div
                animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-full border border-warning/30"
              />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-ink mb-2 text-center">
            Conta em análise
          </h1>
          <p className="text-ink-3 text-sm leading-relaxed mb-2 text-center">
            Seu acesso está aguardando a aprovação de um administrador.
          </p>
          {email && (
            <p className="text-xs text-ink-3 mb-5 truncate text-center">
              {email}
            </p>
          )}

          {/* Status badge */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-warning/25 bg-warning-soft px-4 py-2">
              <motion.div
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="w-2 h-2 rounded-full bg-warning"
              />
              <span className="text-xs font-medium text-warning">
                Aguardando aprovação
              </span>
            </div>
          </div>

          {/* Message form / success state */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mb-6"
          >
            <AnimatePresence mode="wait">
              {messageSent ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex flex-col items-center gap-2 rounded-xl border border-success/20 bg-success-soft px-4 py-5 text-center"
                >
                  <CheckCircle2 className="w-7 h-7 text-success" />
                  <p className="text-sm font-semibold text-success">
                    Mensagem enviada com sucesso!
                  </p>
                  <p className="text-xs text-ink-3 leading-relaxed">
                    O admin vai ler quando ele terminar o café. Aguarde a aprovação. ☕
                  </p>
                  <button
                    onClick={() => setMessageSent(false)}
                    className="mt-1 text-[11px] text-ink-3 hover:text-ink-3 underline underline-offset-2 transition-colors"
                  >
                    Editar mensagem
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="space-y-3"
                >
                  <label className="block text-[10px] font-semibold text-ink-3 uppercase tracking-widest">
                    Mensagem para o Admin (opcional)
                  </label>
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value.slice(0, 500))}
                    placeholder="Manda a real: por que o todo-poderoso Admin (que provavelmente está tomando café agora) deveria liberar seu acesso? (Vale apelo emocional, promessa de PIX ou só dizer o que você faz mesmo...) 👀☕"
                    rows={4}
                    className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-ink placeholder:text-ink-3 text-sm px-4 py-3 resize-none outline-none focus:border-primary/40 focus:bg-white/[0.06] transition-all leading-relaxed"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-ink-3">
                      {messageText.length}/500
                    </span>
                    <motion.button
                      onClick={sendMessage}
                      disabled={!messageText.trim() || sending}
                      whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-2 rounded-xl bg-info-soft border border-primary/25 text-link text-xs font-medium px-4 py-2 hover:border-primary/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {sending ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      {sending ? "Enviando…" : "Enviar mensagem"}
                    </motion.button>
                  </div>

                  {/* Error */}
                  <AnimatePresence>
                    {messageError && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="flex items-center gap-2 text-xs text-danger bg-danger-soft border border-danger/20 rounded-lg px-3 py-2"
                      >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {messageError}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

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
              className="btn-ghost w-full flex items-center justify-center gap-2 text-sm text-ink-3 hover:text-ink-2"
            >
              <LogOut className="w-4 h-4" />
              Sair da conta
            </button>
          </div>
        </motion.div>

        <p className="text-center text-xs text-ink-3 mt-6">
          Assim que aprovado, você terá acesso imediato ao painel.
        </p>
      </div>
    </div>
  );
}
