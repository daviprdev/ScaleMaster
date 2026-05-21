"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, ArrowUp, ArrowDown, RefreshCw, CheckCircle2,
  XCircle, AlertTriangle, ChevronRight, Wifi,
} from "lucide-react";

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  is_active: boolean;
  health_status: "online" | "error" | "blocked";
  failover_priority: number;
}

interface FailoverLog {
  id: string;
  error_reason: string | null;
  created_at: string;
  failed_account: { id: string; username: string; display_name: string | null } | null;
  backup_account: { id: string; username: string; display_name: string | null } | null;
}

function HealthBadge({ status }: { status: string }) {
  if (status === "online")
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        Online
      </span>
    );
  if (status === "error")
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Erro
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      Bloqueada
    </span>
  );
}

function PriorityLabel({ index }: { index: number }) {
  if (index === 0)
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-violet-500/15 border border-violet-500/30 text-violet-300">
        PRINCIPAL
      </span>
    );
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-white/[0.05] border border-white/[0.08] text-white/40">
      RESERVA {index}
    </span>
  );
}

function AccountAvatar({ username }: { username: string }) {
  const initials = username.slice(0, 2).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
      {initials}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export default function FailoverPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<FailoverLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, logRes] = await Promise.all([
        fetch("/api/failover/accounts"),
        fetch("/api/failover/logs"),
      ]);
      const accData = await accRes.json();
      const logData = await logRes.json();
      if (accData.error) throw new Error(accData.error);
      setAccounts(accData.accounts ?? []);
      setLogs(logData.logs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePriorities = useCallback(async (arr: Account[]) => {
    setSaving(true);
    await fetch("/api/failover/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: arr.map((a, i) => ({ id: a.id, failover_priority: i })),
      }),
    });
    setSaving(false);
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    const swap = idx + dir;
    if (swap < 0 || swap >= accounts.length) return;
    const arr = [...accounts];
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    setAccounts(arr);
    savePriorities(arr);
  };

  const restore = async (id: string) => {
    setRestoringId(id);
    await fetch("/api/failover/accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setRestoringId(null);
    load();
  };

  const healthCounts = accounts.reduce(
    (acc, a) => {
      acc[a.health_status] = (acc[a.health_status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={20} className="text-violet-400" />
            <h1 className="text-xl font-bold text-white">Failover de Contas</h1>
          </div>
          <p className="text-sm text-white/40">
            Redundância automática — quando uma conta falha, a próxima assume.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08] text-sm transition-colors disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Summary chips */}
      {!loading && accounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {healthCounts.online > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium">
              <CheckCircle2 size={12} /> {healthCounts.online} online
            </span>
          )}
          {healthCounts.error > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
              <XCircle size={12} /> {healthCounts.error} com erro
            </span>
          )}
          {healthCounts.blocked > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
              <AlertTriangle size={12} /> {healthCounts.blocked} bloqueada
            </span>
          )}
          {saving && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium">
              <RefreshCw size={12} className="animate-spin" /> Salvando ordem…
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Grupo de Failover */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white/80 mb-0.5">Grupo de Failover</h2>
            <p className="text-xs text-white/30">
              Use as setas para definir a ordem de prioridade das contas.
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-[60px] rounded-xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Wifi size={28} className="text-white/10" />
              <p className="text-sm text-white/30">Nenhuma conta conectada.</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {accounts.map((acc, idx) => (
                <motion.div
                  key={acc.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.18 }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                    idx === 0
                      ? "bg-violet-500/[0.06] border-violet-500/20"
                      : acc.health_status !== "online"
                      ? "bg-red-500/[0.04] border-red-500/15"
                      : "bg-white/[0.03] border-white/[0.06]"
                  }`}
                >
                  {/* Avatar */}
                  <AccountAvatar username={acc.username} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-white/90 truncate">
                        @{acc.username}
                      </span>
                      <PriorityLabel index={idx} />
                    </div>
                    <HealthBadge status={acc.health_status} />
                  </div>

                  {/* Restore button */}
                  {acc.health_status !== "online" && (
                    <button
                      onClick={() => restore(acc.id)}
                      disabled={restoringId === acc.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.1] text-xs transition-colors disabled:opacity-40"
                    >
                      {restoringId === acc.id ? (
                        <RefreshCw size={11} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={11} />
                      )}
                      Restaurar
                    </button>
                  )}

                  {/* Reorder arrows */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="p-1 rounded-md hover:bg-white/[0.08] text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === accounts.length - 1}
                      className="p-1 rounded-md hover:bg-white/[0.08] text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Histórico de Failover */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white/80 mb-0.5">Histórico de Failover</h2>
            <p className="text-xs text-white/30">Últimos 50 eventos de troca automática de conta.</p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[52px] rounded-xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle2 size={28} className="text-green-500/30" />
              <p className="text-sm text-white/30">Nenhum evento de failover registrado.</p>
              <p className="text-xs text-white/20">
                Isso é ótimo — significa que suas contas estão saudáveis.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1 custom-scrollbar">
              <AnimatePresence>
                {logs.map((log, idx) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.05] transition-colors"
                  >
                    {/* Event icon */}
                    <div className="mt-0.5 p-1.5 rounded-lg bg-red-500/10 border border-red-500/15 shrink-0">
                      <XCircle size={12} className="text-red-400" />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="text-xs font-semibold text-white/80">
                          @{log.failed_account?.username ?? "conta removida"}
                        </span>
                        <ChevronRight size={10} className="text-white/20 shrink-0" />
                        <span
                          className={`text-xs font-semibold ${
                            log.backup_account ? "text-cyan-400" : "text-white/30"
                          }`}
                        >
                          {log.backup_account
                            ? `@${log.backup_account.username}`
                            : "sem backup"}
                        </span>
                        {log.backup_account && (
                          <span className="text-[10px] text-green-400/70">(assumiu)</span>
                        )}
                      </div>
                      {log.error_reason && (
                        <p className="text-[11px] text-white/30 truncate">
                          {log.error_reason.length > 80
                            ? log.error_reason.slice(0, 80) + "…"
                            : log.error_reason}
                        </p>
                      )}
                    </div>

                    {/* Time */}
                    <span className="text-[11px] text-white/25 shrink-0 mt-0.5">
                      {timeAgo(log.created_at)}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Info box */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-violet-500/[0.06] border border-violet-500/15">
        <Shield size={14} className="text-violet-400 mt-0.5 shrink-0" />
        <p className="text-xs text-white/40 leading-relaxed">
          Quando uma conta recebe um erro crítico da Meta API (token inválido, conta restrita ou
          bloqueada), o sistema marca-a automaticamente como{" "}
          <span className="text-red-400/80">Erro</span> e tenta publicar com a próxima conta{" "}
          <span className="text-green-400/80">Online</span> na lista de prioridade. O registro de
          cada troca fica visível no histórico acima.
        </p>
      </div>
    </div>
  );
}
