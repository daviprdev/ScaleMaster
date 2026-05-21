"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, CheckCircle2, Clock, AlertTriangle, Loader2,
  Zap, Users, RefreshCw, Radio, Ban, Inbox,
  BarChart3, TrendingUp, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

interface Metrics {
  total_1h: number;
  posted_1h: number;
  pending: number;
  processing: number;
  errors_24h: number;
}

interface RecentPost {
  id: string;
  account_id: string;
  account_username: string;
  account_display_name: string | null;
  media_id: string | null;
  published_at: string;
  source: "scheduled" | "single";
}

interface IdleAccount {
  id: string;
  username: string;
  display_name: string | null;
}

interface PerAccountStat {
  id: string;
  username: string;
  display_name: string | null;
  pending: number;
  posted_24h: number;
  errors_24h: number;
  has_active_loop: boolean;
}

interface QueueStats {
  metrics: Metrics;
  recent_posts: RecentPost[];
  idle_accounts: IdleAccount[];
  per_account: PerAccountStat[];
  last_updated: string;
}

// ── Helpers ───────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  return `há ${Math.floor(diff / 3600)}h`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Sub-components ────────────────────────────────────────────

function AccountAvatar({ username, size = "sm" }: { username: string; size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center font-bold text-white flex-shrink-0",
        size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs"
      )}
    >
      {username.charAt(0).toUpperCase()}
    </div>
  );
}

function MetricCard({
  label,
  sublabel,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  sublabel: string;
  value: number;
  color: "blue" | "green" | "cyan" | "amber" | "red";
  icon: React.ElementType;
}) {
  const palette = {
    blue:  { ring: "border-blue-500/20",    glow: "from-blue-500/10",    num: "text-blue-400",    ic: "text-blue-400/50"    },
    green: { ring: "border-emerald-500/20", glow: "from-emerald-500/10", num: "text-emerald-400", ic: "text-emerald-400/50" },
    cyan:  { ring: "border-cyan-500/20",    glow: "from-cyan-500/10",    num: "text-cyan-400",    ic: "text-cyan-400/50"    },
    amber: { ring: "border-amber-500/20",   glow: "from-amber-500/10",   num: "text-amber-400",   ic: "text-amber-400/50"   },
    red:   { ring: "border-red-500/20",     glow: "from-red-500/10",     num: "text-red-400",     ic: "text-red-400/50"     },
  }[color];

  return (
    <div className={cn("glass-card p-4 border relative overflow-hidden", palette.ring)}>
      <div className={cn("absolute inset-0 bg-gradient-to-br to-transparent opacity-60", palette.glow)} />
      <div className="relative flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Icon size={14} className={palette.ic} />
          <span className={cn("text-2xl font-bold tabular-nums tracking-tight", palette.num)}>
            {value}
          </span>
        </div>
        <div>
          <p className="text-xs text-white/60 font-medium">{label}</p>
          <p className="text-[10px] text-white/25 mt-0.5">{sublabel}</p>
        </div>
      </div>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────

const REFRESH_INTERVAL = 15;

// ── Page ──────────────────────────────────────────────────────

export default function QueuePage() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [updatedAt, setUpdatedAt] = useState("");

  const fetchStats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/queue/stats");
      if (!res.ok) return;
      const data = await res.json() as QueueStats;
      setStats(data);
      setCountdown(REFRESH_INTERVAL);
      setUpdatedAt(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // 15s auto-refresh + countdown ticker
  useEffect(() => {
    const refresh = setInterval(() => fetchStats(true), REFRESH_INTERVAL * 1000);
    const tick = setInterval(() => setCountdown(c => (c <= 1 ? REFRESH_INTERVAL : c - 1)), 1000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, [fetchStats]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-violet-400" />
      </div>
    );
  }

  const m = stats?.metrics ?? { total_1h: 0, posted_1h: 0, pending: 0, processing: 0, errors_24h: 0 };
  const hasActivity = (stats?.per_account.length ?? 0) > 0 || (stats?.idle_accounts.length ?? 0) > 0;

  return (
    <div className="space-y-6 max-w-full">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Status da Fila</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <p className="text-xs text-white/35">
              {updatedAt ? `Atualizado às ${updatedAt}` : "Carregando..."}
              {" · "}auto em{" "}
              <span className="tabular-nums text-white/50">{countdown}s</span>
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchStats(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/40 hover:text-white/70 hover:border-white/15 transition-all"
        >
          <RefreshCw size={12} />
          Atualizar agora
        </button>
      </div>

      {/* ── Metric Cards ────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Total do batch"  sublabel="última 1h"       value={m.total_1h}    color="blue"  icon={BarChart3}     />
        <MetricCard label="Postados"        sublabel="última 1h"       value={m.posted_1h}   color="green" icon={CheckCircle2}  />
        <MetricCard label="Na fila"         sublabel="pendentes"       value={m.pending}     color="cyan"  icon={Clock}         />
        <MetricCard label="Processando"     sublabel="em andamento"    value={m.processing}  color="amber" icon={Activity}      />
        <MetricCard label="Erros"           sublabel="últimas 24h"     value={m.errors_24h}  color="red"   icon={XCircle}       />
      </div>

      {/* ── Recently Posted ─────────────────────────────────── */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 size={14} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/90">Postados recentemente</h2>
            <p className="text-[10px] text-white/30">última 1 hora · máx. 25</p>
          </div>
          {(stats?.recent_posts.length ?? 0) > 0 && (
            <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 tabular-nums">
              {stats!.recent_posts.length}
            </span>
          )}
        </div>

        {!stats?.recent_posts.length ? (
          <div className="flex flex-col items-center justify-center py-10 text-white/20">
            <Inbox size={28} className="mb-3" />
            <p className="text-sm">Nenhum post publicado na última hora</p>
            <p className="text-xs mt-1 text-white/15">Os posts aparecerão aqui quando forem publicados</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            <AnimatePresence>
              {stats.recent_posts.map((post, i) => (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025, duration: 0.2 }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group"
                >
                  <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                  <AccountAvatar username={post.account_username} size="sm" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white/80 font-medium">
                      @{post.account_username}
                    </span>
                    {post.media_id && (
                      <span className="ml-2 text-[10px] text-white/20 font-mono group-hover:text-white/35 transition-colors">
                        #{post.media_id.slice(0, 10)}…
                      </span>
                    )}
                    <span className="ml-2 text-[10px] text-white/20 capitalize">
                      {post.source === "scheduled" ? "agendado" : "único"}
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-white/40 tabular-nums">{formatTime(post.published_at)}</p>
                    <p className="text-[10px] text-white/20">{timeAgo(post.published_at)}</p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Idle Accounts ───────────────────────────────────── */}
      <AnimatePresence>
        {(stats?.idle_accounts.length ?? 0) > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="glass-card p-5 border border-amber-500/15"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-xl bg-amber-500/15 flex items-center justify-center">
                <AlertTriangle size={14} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white/90">Contas fora da fila</h2>
                <p className="text-[10px] text-white/30">sem postagens agendadas ou loop ativo</p>
              </div>
              <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 tabular-nums">
                {stats!.idle_accounts.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {stats!.idle_accounts.map(acc => (
                <div
                  key={acc.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/10"
                >
                  <AccountAvatar username={acc.username} size="sm" />
                  <div>
                    <p className="text-xs text-white/65 font-medium">@{acc.username}</p>
                    {acc.display_name && (
                      <p className="text-[10px] text-white/30 leading-tight">{acc.display_name}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Per-Account Management ──────────────────────────── */}
      <AnimatePresence>
        {(stats?.per_account.length ?? 0) > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="flex items-center gap-2 mb-3">
              <Users size={14} className="text-violet-400" />
              <h2 className="text-sm font-semibold text-white/70">Gerenciamento por conta</h2>
              <span className="text-[10px] text-white/25 ml-1">ativas nas últimas 24h</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {stats!.per_account.map((acc, i) => (
                <motion.div
                  key={acc.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.25 }}
                  className="glass-card p-4 flex flex-col gap-4"
                >
                  {/* Account header */}
                  <div className="flex items-center gap-3">
                    <AccountAvatar username={acc.username} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/90 font-semibold truncate">
                        @{acc.username}
                      </p>
                      {acc.display_name && (
                        <p className="text-[11px] text-white/35 truncate">{acc.display_name}</p>
                      )}
                    </div>
                    {acc.has_active_loop && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-600/15 border border-violet-500/25 flex-shrink-0">
                        <Radio size={9} className="text-violet-400 animate-pulse" />
                        <span className="text-[10px] text-violet-300 font-medium">Loop</span>
                      </div>
                    )}
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                      <p className={cn(
                        "text-lg font-bold tabular-nums leading-tight",
                        acc.pending > 0 ? "text-cyan-400" : "text-white/25"
                      )}>
                        {acc.pending}
                      </p>
                      <p className="text-[10px] text-white/30 mt-0.5">Pendentes</p>
                    </div>
                    <div className="text-center p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                      <p className={cn(
                        "text-lg font-bold tabular-nums leading-tight",
                        acc.posted_24h > 0 ? "text-emerald-400" : "text-white/25"
                      )}>
                        {acc.posted_24h}
                      </p>
                      <p className="text-[10px] text-white/30 mt-0.5">Postados</p>
                    </div>
                    <div className="text-center p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                      <p className={cn(
                        "text-lg font-bold tabular-nums leading-tight",
                        acc.errors_24h > 0 ? "text-red-400" : "text-white/25"
                      )}>
                        {acc.errors_24h}
                      </p>
                      <p className="text-[10px] text-white/30 mt-0.5">Erros</p>
                    </div>
                  </div>

                  {/* Cancel queue button — visual placeholder */}
                  <button
                    disabled
                    title="Funcionalidade em breve"
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-500/10 text-red-500/30 text-xs cursor-not-allowed select-none"
                  >
                    <Ban size={10} />
                    Cancelar fila
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Empty State ─────────────────────────────────────── */}
      {!loading && stats && !hasActivity && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card p-12 flex flex-col items-center justify-center text-center"
        >
          <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-4">
            <Zap size={22} className="text-white/20" />
          </div>
          <p className="text-sm text-white/35 font-medium">Fila vazia</p>
          <p className="text-xs text-white/20 mt-1 max-w-xs">
            Nenhuma conta com itens na fila. Crie um loop ou agende um post para começar.
          </p>
        </motion.div>
      )}

    </div>
  );
}
