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
  user_registered:      { label: "Usuário cadastrado",       icon: UserPlus,   color: "text-link bg-info-soft border-primary-2/20" },
  user_approved:        { label: "Usuário aprovado",         icon: UserCheck,  color: "text-success bg-success-soft border-success/20" },
  user_rejected:        { label: "Usuário reprovado",        icon: UserX,      color: "text-danger bg-danger-soft border-danger/20" },
  user_banned:          { label: "Usuário banido",           icon: ShieldBan,  color: "text-danger bg-danger-soft border-danger/20" },
  account_connected:    { label: "Conta conectada",          icon: Instagram,  color: "text-link bg-info-soft border-primary/20" },
  account_revoked:      { label: "Conta revogada",           icon: Trash2,     color: "text-warning bg-warning-soft border-warning/20" },
  impersonation_started:{ label: "Impersonação iniciada",    icon: Eye,        color: "text-link bg-info-soft border-primary/20" },};

function getActionMeta(action: string) {
  return ACTION_META[action] ?? {
    label: action.replace(/_/g, " "),
    icon: Activity,
    color: "text-ink-3 bg-white/5 border-white/10",
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
        <div className="flex items-center justify-center py-20 text-ink-3 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-link" />
          <span className="text-sm">Carregando logs…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && logs.length === 0 && (
        <div className="glass-card rounded-2xl flex flex-col items-center justify-center gap-3 py-16 text-ink-3">
          <Activity className="w-8 h-8" />
          <p className="text-sm">Nenhuma ação registrada ainda</p>
          <p className="text-xs text-ink-3">As ações aparecerão aqui conforme ocorrerem</p>
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
                      <span className="text-sm font-medium text-ink">{meta.label}</span>
                      {log.target_email && (
                        <span className="text-xs text-ink-3 truncate">
                          → {log.target_email}
                        </span>
                      )}
                    </div>
                    {log.actor_email && (
                      <p className="text-xs text-ink-3 mt-0.5">
                        por {log.actor_email}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-xs text-ink-3 shrink-0 mt-0.5 tabular-nums">
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
