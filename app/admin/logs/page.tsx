"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Loader2,
  AlertCircle,
  UserCheck,
  UserX,
  ShieldBan,
  UserPlus,
  Instagram,
  Trash2,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LogEntry {
  id: string;
  created_at: string;
  action: string;
  actor_email: string | null;
  target_email: string | null;
  details: Record<string, unknown>;
}

const ACTION_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  user_registered:      { label: "Usuário cadastrado",       icon: UserPlus,   color: "text-[#85B9E9] bg-[#85B9E9]/10 border-[#85B9E9]/20" },
  user_approved:        { label: "Usuário aprovado",         icon: UserCheck,  color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  user_rejected:        { label: "Usuário reprovado",        icon: UserX,      color: "text-red-400 bg-red-500/10 border-red-500/20" },
  user_banned:          { label: "Usuário banido",           icon: ShieldBan,  color: "text-red-400 bg-red-500/10 border-red-500/20" },
  account_connected:    { label: "Conta conectada",          icon: Instagram,  color: "text-[#00498D] bg-[#00498D]/10 border-[#00498D]/20" },
  account_revoked:      { label: "Conta revogada",           icon: Trash2,     color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  impersonation_started:{ label: "Impersonação iniciada",    icon: Eye,        color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
};

function getActionMeta(action: string) {
  return ACTION_META[action] ?? {
    label: action.replace(/_/g, " "),
    icon: Activity,
    color: "text-white/40 bg-white/5 border-white/10",
  };
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/logs?limit=100")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLogs(data.logs);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Logs de Auditoria</h1>
        <p className="page-subtitle mt-1">
          Histórico de ações do sistema em tempo real
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-white/40 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-[#00498D]" />
          <span className="text-sm">Carregando logs…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && logs.length === 0 && (
        <div className="glass-card rounded-2xl flex flex-col items-center justify-center gap-3 py-16 text-white/30">
          <Activity className="w-8 h-8" />
          <p className="text-sm">Nenhuma ação registrada ainda</p>
          <p className="text-xs text-white/20">As ações aparecerão aqui conforme ocorrerem</p>
        </div>
      )}

      {!loading && !error && logs.length > 0 && (
        <div className="glass-card rounded-2xl p-4 relative">
          {/* Timeline line */}
          <div className="absolute left-9 top-4 bottom-4 w-px bg-white/[0.07]" />

          <div className="space-y-0.5">
            {logs.map((log, i) => {
              const meta = getActionMeta(log.action);
              const Icon = meta.icon;
              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.5) }}
                  className="relative flex items-start gap-4 pl-12 pr-4 py-3 rounded-xl hover:bg-white/[0.03] transition-colors group"
                >
                  {/* Dot on timeline */}
                  <div className={cn(
                    "absolute left-3 top-3.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0",
                    meta.color
                  )}>
                    <Icon className="w-2.5 h-2.5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white/90">{meta.label}</span>
                      {log.target_email && (
                        <span className="text-xs text-white/45 truncate">
                          → {log.target_email}
                        </span>
                      )}
                    </div>
                    {log.actor_email && (
                      <p className="text-xs text-white/30 mt-0.5">
                        por {log.actor_email}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-xs text-white/25 shrink-0 mt-0.5 tabular-nums">
                    {formatDate(log.created_at)}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
