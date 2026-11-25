"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Clock, AlertTriangle, Loader2, RefreshCw,
  Radio, Zap, TrendingUp, XCircle, Activity, Heart, Layers,
  BarChart2, Send, Eye, MessageCircle, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Shared Types ───────────────────────────────────────────────────────────────

interface TimelineEntry { account_username: string; at: string; media_id: string | null }
interface UpcomingEntry { account_username: string; at: string; retry_count?: number }

// ── Loop Types ─────────────────────────────────────────────────────────────────

interface AccountStatus {
  id: string; username: string; display_name: string | null; health_status: string;
  in_active_loop: boolean; loop_name: string | null;
  container_status: "published" | "pending" | "publishing" | "error" | "none";
  last_published_at: string | null; last_media_id: string | null;
  next_publish_at: string | null; pending_since: string | null;
  retry_count: number; last_error: string | null;
  published_24h: number; errors_24h: number;
}

interface LoopMonitorData {
  metrics: {
    published_24h: number; pending: number; errors_24h: number;
    next_publish_in_ms: number | null; active_loops: number;
  };
  accounts: AccountStatus[];
  timeline: { published: TimelineEntry[]; upcoming: UpcomingEntry[] };
  last_updated: string;
}

// ── Campaign Types ─────────────────────────────────────────────────────────────

interface CampaignAccountStatus {
  account_id: string; username: string; display_name: string | null; avatar_url: string | null;
  total: number; published: number; pending: number; failed: number;
  overdue_count: number;
  last_published_at: string | null; next_scheduled_at: string | null;
  total_likes: number; total_plays: number; total_reach: number; total_comments: number;
  synced_posts: number;
  campaign_ids: string[];
  last_error_message: string | null;
}

interface CampaignMonitorData {
  metrics: {
    total_published: number; total_pending: number; total_failed: number;
    total_overdue: number; total_likes: number; total_plays: number; total_reach: number; total_comments: number;
    active_campaigns: number; next_publish_in_ms: number | null;
  };
  accounts: CampaignAccountStatus[];
  timeline: { published: TimelineEntry[]; upcoming: UpcomingEntry[] };
  last_updated: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)   return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  return `${Math.floor(diff / 3600)}h atrás`;
}

function timeIn(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Math.floor((new Date(dateStr).getTime() - Date.now()) / 1000);
  if (diff <= 0)   return "agora";
  if (diff < 60)   return `em ${diff}s`;
  if (diff < 3600) return `em ${Math.floor(diff / 60)}min`;
  return `em ${Math.floor(diff / 3600)}h`;
}

function formatClock(ms: number | null): string {
  if (ms === null || ms <= 0) return "agora";
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}min`;
  if (m > 0)   return `${m}min ${s}s`;
  return `${s}s`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const LOOP_STATUS_CONFIG = {
  published:  { label: "Publicado",   color: "text-link",  bg: "bg-primary/10",  border: "border-primary/25",  dot: "bg-primary"  },
  pending:    { label: "Aguardando",  color: "text-primary-2", bg: "bg-primary-2/10", border: "border-primary-2/25", dot: "bg-primary-2" },
  publishing: { label: "Publicando",  color: "text-warning",         bg: "bg-warning-soft",         border: "border-warning/25",         dot: "bg-warning"          },
  error:      { label: "Erro",        color: "text-danger",           bg: "bg-danger-soft",           border: "border-danger/25",           dot: "bg-danger"            },
  none:       { label: "Sem atividade", color: "text-ink-3",        bg: "bg-surface-raised",         border: "border-line",         dot: "bg-line-control/30"           },
};

// ── Shared Components ──────────────────────────────────────────────────────────

function Countdown({ ms }: { ms: number | null }) {
  const [val, setVal] = useState(ms);
  useEffect(() => {
    setVal(ms);
    if (!ms || ms <= 0) return;
    const t = setInterval(() => setVal(v => (v !== null ? Math.max(0, v - 1000) : null)), 1000);
    return () => clearInterval(t);
  }, [ms]);
  return <span className="tabular-nums">{formatClock(val)}</span>;
}

function Avatar({ username, size = "md" }: { username: string; size?: "sm" | "md" | "lg" }) {
  const colors = [
    "from-primary/70 to-primary-2/70",
    "from-primary to-primary-2",
    "from-primary-2 to-primary",
    "from-warning to-warning",
    "from-danger to-danger",
  ];
  const idx = username.charCodeAt(0) % colors.length;
  const sz = size === "sm" ? "w-7 h-7 text-[10px]" : size === "lg" ? "w-10 h-10 text-sm" : "w-8 h-8 text-xs";
  return (
    <div className={cn("rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-black shrink-0", colors[idx], sz)}>
      {username.charAt(0).toUpperCase()}
    </div>
  );
}

function MetricCard({ label, sub, value, color, icon: Icon, extra }: {
  label: string; sub: string; value: string | number; color: "green" | "cyan" | "red" | "amber" | "blue" | "pink";
  icon: React.ElementType; extra?: React.ReactNode;
}) {
  const bg = {
    green: "var(--gradient-primary)",
    cyan:  "linear-gradient(160deg,#3fd0ff,#2f7bff)",
    red:   "linear-gradient(160deg,#ff7a92,#d6455f)",
    amber: "linear-gradient(160deg,#ffc35c,#ff8a4c)",
    blue:  "var(--gradient-primary)",
    pink:  "linear-gradient(160deg,#c08cff,#ff6ab0)",
  }[color];
  return (
    <div className="glass-card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
          style={{ background: bg }}
        >
          <Icon size={16} />
        </span>
        <span className="text-[26px] font-semibold leading-8 tabular-nums tracking-[-0.02em] text-ink">{value}</span>
      </div>
      <div>
        <p className="text-[13px] text-ink-2 font-medium">{label}</p>
        <p className="text-xs text-ink-3">{sub}</p>
        {extra && <div className="mt-1">{extra}</div>}
      </div>
    </div>
  );
}

function Timeline({ published, upcoming }: { published: TimelineEntry[]; upcoming: UpcomingEntry[] }) {
  const now = Date.now();
  const windowMs = 9 * 60 * 60 * 1000;
  const startMs = now - 6 * 60 * 60 * 1000;
  const endMs   = now + 3 * 60 * 60 * 1000;

  function toPercent(ts: number) {
    return Math.max(0, Math.min(100, ((ts - startMs) / windowMs) * 100));
  }

  const nowPct = toPercent(now);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-7 h-7 rounded-xl bg-primary-2/10 flex items-center justify-center">
          <Activity size={14} className="text-primary-2" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink">Linha do Tempo</h2>
          <p className="text-[10px] text-ink-3">6h atrás → agora → próximas 3h</p>
        </div>
        <div className="ml-auto flex items-center gap-4 text-[10px] text-ink-3">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" />Publicado</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary-2" />Agendado</span>
        </div>
      </div>

      <div className="relative h-2 rounded-full bg-surface-raised border border-line overflow-visible mx-2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-surface-raised" style={{ width: `${nowPct}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 z-20" style={{ left: `${nowPct}%` }}>
          <div className="w-px h-6 bg-line -translate-x-1/2 -translate-y-2" />
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-[9px] text-ink-3 whitespace-nowrap">agora</div>
        </div>

        {published.map((p, i) => {
          const pct = toPercent(new Date(p.at).getTime());
          if (pct < 0 || pct > nowPct) return null;
          return (
            <div key={i} className="absolute top-1/2 -translate-y-1/2 z-10 group" style={{ left: `${pct}%` }}>
              <div className="w-2.5 h-2.5 rounded-full bg-primary -translate-x-1/2 border border-black/50 cursor-default" />
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center">
                <div className="bg-black/90 border border-line rounded-lg px-2 py-1 text-[10px] text-ink-2 whitespace-nowrap">
                  @{p.account_username}<br />
                  <span className="text-ink-3">{new Date(p.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            </div>
          );
        })}

        {upcoming.map((u, i) => {
          const pct = toPercent(new Date(u.at).getTime());
          if (pct <= nowPct || pct > 100) return null;
          return (
            <div key={i} className="absolute top-1/2 -translate-y-1/2 z-10 group" style={{ left: `${pct}%` }}>
              <div className="w-2.5 h-2.5 rounded-full bg-primary-2 -translate-x-1/2 border border-black/50 cursor-default animate-pulse" />
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center">
                <div className="bg-black/90 border border-line rounded-lg px-2 py-1 text-[10px] text-ink-2 whitespace-nowrap">
                  @{u.account_username}<br />
                  <span className="text-ink-3">{timeIn(u.at)}</span>
                  {u.retry_count && u.retry_count > 0 && (
                    <span className="text-warning/70"> · retry {u.retry_count}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-3 text-[9px] text-ink-3 px-2">
        <span>-6h</span><span>-4h</span><span>-2h</span>
        <span className="text-ink-3 font-medium">agora</span>
        <span>+1h</span><span>+2h</span><span>+3h</span>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[10px] text-ink-3 uppercase tracking-wider mb-3">Próximas na fila</p>
          <div className="flex flex-wrap gap-2">
            {upcoming.slice(0, 12).map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-primary-2/[0.05] border border-primary-2/15">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-2 animate-pulse shrink-0" />
                <span className="text-[11px] text-ink-2 font-medium">@{u.account_username}</span>
                <span className="text-[10px] text-primary-2/70">{timeIn(u.at)}</span>
                {u.retry_count && u.retry_count > 0 && (
                  <span className="text-[9px] text-warning/60 border border-warning/20 rounded px-1">retry {u.retry_count}</span>
                )}
              </div>
            ))}
            {upcoming.length > 12 && (
              <div className="flex items-center px-2.5 py-1.5 rounded-xl bg-surface-raised border border-line">
                <span className="text-[10px] text-ink-3">+{upcoming.length - 12} mais</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Loop Account Card ──────────────────────────────────────────────────────────

function LoopAccountCard({ acc }: { acc: AccountStatus }) {
  const cfg = LOOP_STATUS_CONFIG[acc.container_status];
  const [expanded, setExpanded] = useState(false);
  const hasError = acc.container_status === "error" || acc.health_status === "error";
  const errorMsg = acc.last_error ?? (acc.health_status === "error" ? "Conta marcada como erro" : null);

  return (
    <motion.div layout className={cn("glass-card p-4 border flex flex-col gap-3 cursor-default", cfg.border, hasError && "border-danger/25")}>
      <div className="flex items-start gap-3">
        <div className="relative">
          <Avatar username={acc.username} size="md" />
          <span className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black", hasError ? "bg-danger" : cfg.dot)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink truncate">@{acc.username}</p>
            {acc.in_active_loop && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-info-soft border border-primary/20">
                <Radio size={8} className="text-link animate-pulse" />
                <span className="text-[9px] text-link">{acc.loop_name ?? "Loop"}</span>
              </span>
            )}
          </div>
          {acc.display_name && <p className="text-[10px] text-ink-3 truncate">{acc.display_name}</p>}
        </div>
        <span className={cn("shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border",
          hasError ? "text-danger bg-danger-soft border-danger/25" : cn(cfg.color, cfg.bg, cfg.border))}>
          {acc.container_status === "published"  && <CheckCircle2 size={10} />}
          {acc.container_status === "pending"    && <Clock size={10} className="animate-pulse" />}
          {acc.container_status === "publishing" && <Loader2 size={10} className="animate-spin" />}
          {(acc.container_status === "error" || hasError) && <AlertTriangle size={10} />}
          {acc.container_status === "none" && !hasError && <Zap size={10} />}
          {hasError ? "Erro" : cfg.label}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-surface-raised border border-line">
          <span className="text-ink-3 text-[9px] uppercase tracking-wider">Último post</span>
          <span className={cn("font-medium", acc.last_published_at ? "text-link" : "text-ink-3")}>
            {timeAgo(acc.last_published_at)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-surface-raised border border-line">
          <span className="text-ink-3 text-[9px] uppercase tracking-wider">
            {acc.container_status === "pending" ? "Próximo" : "Postados 24h"}
          </span>
          {acc.container_status === "pending" ? (
            <span className="font-medium text-primary-2">{timeIn(acc.next_publish_at)}</span>
          ) : (
            <span className={cn("font-medium", acc.published_24h > 0 ? "text-link" : "text-ink-3")}>
              {acc.published_24h}
            </span>
          )}
        </div>
      </div>

      {hasError && errorMsg && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-danger-soft border border-danger/15 cursor-pointer" onClick={() => setExpanded(e => !e)}>
          <AlertTriangle size={11} className="text-danger shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className={cn("text-[10px] text-danger/80 leading-relaxed", !expanded && "line-clamp-1")}>{errorMsg}</p>
            {errorMsg.length > 60 && <p className="text-[9px] text-danger/50 mt-0.5">{expanded ? "▲ ocultar" : "▼ ver tudo"}</p>}
          </div>
        </div>
      )}

      {acc.container_status === "pending" && acc.retry_count > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-warning-soft border border-warning/15">
          <span className="text-[10px] text-warning/70">Tentativa #{acc.retry_count + 1} · {timeIn(acc.next_publish_at)}</span>
        </div>
      )}
    </motion.div>
  );
}

// ── Campaign Account Card ──────────────────────────────────────────────────────

function CampaignAccountCard({ acc }: { acc: CampaignAccountStatus }) {
  const [expanded, setExpanded] = useState(false);

  const progress    = acc.total > 0 ? (acc.published / acc.total) * 100 : 0;
  const progressPct = Math.round(progress);
  const hasPending  = acc.pending > 0;
  const hasFailed   = acc.failed > 0;
  const hasOverdue  = acc.overdue_count > 0;
  const recentlyPublished = acc.last_published_at &&
    (Date.now() - new Date(acc.last_published_at).getTime()) < 30 * 60_000;

  // Derived status
  let statusLabel: string;
  let statusColor: string, statusBg: string, statusBorder: string;
  let statusDot: string, statusDotAnim = false;
  let cardBorder: string;

  if (!hasPending && acc.published === 0 && !hasFailed) {
    statusLabel = "Sem posts";
    statusColor = "text-ink-3"; statusBg = "bg-surface-raised"; statusBorder = "border-line";
    statusDot = "bg-line-control/30"; cardBorder = "border-line";
  } else if (!hasPending && hasFailed && acc.published === 0) {
    statusLabel = "Falhou";
    statusColor = "text-danger"; statusBg = "bg-danger-soft"; statusBorder = "border-danger/25";
    statusDot = "bg-danger"; cardBorder = "border-danger/20";
  } else if (!hasPending) {
    statusLabel = "Concluída";
    statusColor = "text-link"; statusBg = "bg-primary/10"; statusBorder = "border-primary/25";
    statusDot = "bg-primary"; cardBorder = "border-primary/20";
  } else if (hasOverdue) {
    statusLabel = "Atrasada";
    statusColor = "text-warning"; statusBg = "bg-warning-soft"; statusBorder = "border-warning/25";
    statusDot = "bg-warning"; statusDotAnim = true; cardBorder = "border-warning/20";
  } else if (recentlyPublished) {
    statusLabel = "Publicando";
    statusColor = "text-link"; statusBg = "bg-primary/10"; statusBorder = "border-primary/25";
    statusDot = "bg-primary"; statusDotAnim = true; cardBorder = "border-primary/20";
  } else {
    statusLabel = "Na Fila";
    statusColor = "text-primary-2"; statusBg = "bg-primary-2/10"; statusBorder = "border-primary-2/25";
    statusDot = "bg-primary-2"; cardBorder = "border-primary-2/20";
  }

  return (
    <motion.div layout className={cn("glass-card p-4 border flex flex-col gap-3 cursor-default", cardBorder)}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar username={acc.username} size="md" />
          <span className={cn(
            "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black",
            statusDot, statusDotAnim && "animate-pulse"
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">@{acc.username}</p>
          {acc.display_name && <p className="text-[10px] text-ink-3 truncate">{acc.display_name}</p>}
        </div>
        <span className={cn("shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border", statusColor, statusBg, statusBorder)}>
          {statusLabel === "Concluída"  && <CheckCircle2 size={10} />}
          {statusLabel === "Na Fila"    && <Clock size={10} />}
          {statusLabel === "Publicando" && <Loader2 size={10} className="animate-spin" />}
          {statusLabel === "Atrasada"   && <AlertTriangle size={10} />}
          {statusLabel === "Falhou"     && <XCircle size={10} />}
          {statusLabel === "Sem posts"  && <Zap size={10} />}
          {statusLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-[10px] mb-1.5">
          <span className="text-ink-3">Progresso</span>
          <span className="tabular-nums">
            <span className="text-ink-2 font-medium">{acc.published}</span>
            <span className="text-ink-3">/{acc.total}</span>
            <span className="text-ink-3 ml-1">({progressPct}%)</span>
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
          <motion.div
            className={cn("h-full rounded-full", hasFailed && !hasPending
              ? "bg-danger/50"
              : "bg-gradient-primary"
            )}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Stats grid — operational */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-1.5 text-[10px]">
        <div className="flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl bg-surface-raised border border-line">
          <CheckCircle2 size={11} className="text-link/60" />
          <span className="font-bold text-link tabular-nums">{acc.published}</span>
          <span className="text-[9px] text-ink-3">publ.</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl bg-surface-raised border border-line">
          <Clock size={11} className={cn(hasPending ? "text-primary-2/60" : "text-ink-3")} />
          <span className={cn("font-bold tabular-nums", hasPending ? "text-primary-2" : "text-ink-3")}>{acc.pending}</span>
          <span className="text-[9px] text-ink-3">fila</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl bg-surface-raised border border-line">
          <XCircle size={11} className={cn(hasFailed ? "text-danger/60" : "text-ink-3")} />
          <span className={cn("font-bold tabular-nums", hasFailed ? "text-danger" : "text-ink-3")}>{acc.failed}</span>
          <span className="text-[9px] text-ink-3">falha</span>
        </div>
      </div>

      {/* Stats grid — engagement */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
        <div className="flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl bg-surface-raised border border-line">
          <Eye size={11} className={cn(acc.total_plays > 0 ? "text-primary-2/60" : "text-ink-3")} />
          <span className={cn("font-bold tabular-nums", acc.total_plays > 0 ? "text-primary-2" : "text-ink-3")}>{fmtNum(acc.total_plays)}</span>
          <span className="text-[9px] text-ink-3">views</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl bg-surface-raised border border-line">
          <Heart size={11} className={cn(acc.total_likes > 0 ? "text-danger/60" : "text-ink-3")} />
          <span className={cn("font-bold tabular-nums", acc.total_likes > 0 ? "text-danger" : "text-ink-3")}>{fmtNum(acc.total_likes)}</span>
          <span className="text-[9px] text-ink-3">likes</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl bg-surface-raised border border-line">
          <MessageCircle size={11} className={cn(acc.total_comments > 0 ? "text-warning/60" : "text-ink-3")} />
          <span className={cn("font-bold tabular-nums", acc.total_comments > 0 ? "text-warning" : "text-ink-3")}>{fmtNum(acc.total_comments)}</span>
          <span className="text-[9px] text-ink-3">coment.</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl bg-surface-raised border border-line">
          <Users size={11} className={cn(acc.total_reach > 0 ? "text-link/60" : "text-ink-3")} />
          <span className={cn("font-bold tabular-nums", acc.total_reach > 0 ? "text-link" : "text-ink-3")}>{fmtNum(acc.total_reach)}</span>
          <span className="text-[9px] text-ink-3">alcance</span>
        </div>
      </div>

      {/* Sync hint */}
      {acc.published > 0 && acc.synced_posts === 0 && (
        <p className="text-[9px] text-ink-3 px-1">Sincronizando métricas…</p>
      )}

      {/* Timing row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-surface-raised border border-line">
          <span className="text-ink-3 text-[9px] uppercase tracking-wider">Último post</span>
          <span className={cn("font-medium", acc.last_published_at ? "text-link" : "text-ink-3")}>
            {timeAgo(acc.last_published_at)}
          </span>
        </div>
        <div className={cn("flex flex-col gap-0.5 px-3 py-2 rounded-xl border",
          hasOverdue
            ? "bg-warning-soft border-warning/15"
            : "bg-surface-raised border-line"
        )}>
          <span className="text-ink-3 text-[9px] uppercase tracking-wider">
            {hasPending ? "Próximo" : "Situação"}
          </span>
          {hasPending ? (
            <span className={cn("font-medium", hasOverdue ? "text-warning" : "text-primary-2")}>
              {hasOverdue ? "⏱ " : ""}{timeIn(acc.next_scheduled_at)}
            </span>
          ) : (
            <span className="font-medium text-link/60 text-[10px]">✓ concluído</span>
          )}
        </div>
      </div>

      {/* Overdue warning */}
      {hasOverdue && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-warning-soft border border-warning/15">
          <AlertTriangle size={11} className="text-warning/80 shrink-0" />
          <span className="text-[10px] text-warning/80">
            {acc.overdue_count} post{acc.overdue_count > 1 ? "s" : ""} atrasado{acc.overdue_count > 1 ? "s" : ""} — aguardando o cron
          </span>
        </div>
      )}

      {/* Error detail (expandable) */}
      {hasFailed && acc.last_error_message && (
        <div
          className="flex items-start gap-2 px-3 py-2 rounded-xl bg-danger-soft border border-danger/15 cursor-pointer"
          onClick={() => setExpanded(e => !e)}
        >
          <XCircle size={11} className="text-danger shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className={cn("text-[10px] text-danger/80 leading-relaxed break-all", !expanded && "line-clamp-1")}>
              {acc.last_error_message}
            </p>
            {acc.last_error_message.length > 55 && (
              <p className="text-[9px] text-danger/50 mt-0.5">{expanded ? "▲ ocultar" : "▼ ver tudo"}</p>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Filter Tabs ────────────────────────────────────────────────────────────────

type LoopFilter = "all" | "published" | "pending" | "error";
type CampaignFilter = "all" | "active" | "overdue" | "error" | "completed";

// ── Loop View ──────────────────────────────────────────────────────────────────

function LoopView() {
  const [data, setData] = useState<LoopMonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(15);
  const [filter, setFilter] = useState<LoopFilter>("all");
  const [updatedAt, setUpdatedAt] = useState("");

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/loop/monitor");
      if (!res.ok) return;
      const d = await res.json() as LoopMonitorData;
      setData(d);
      setCountdown(15);
      setUpdatedAt(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const r = setInterval(() => fetchData(true), 15_000);
    const t = setInterval(() => setCountdown(c => c <= 1 ? 15 : c - 1), 1_000);
    return () => { clearInterval(r); clearInterval(t); };
  }, [fetchData]);

  if (loading && !data) {
    return <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-primary-2" /></div>;
  }

  const m = data?.metrics ?? { published_24h: 0, pending: 0, errors_24h: 0, next_publish_in_ms: null, active_loops: 0 };
  const allAccounts = data?.accounts ?? [];

  const LOOP_FILTERS = [
    { key: "all" as const,       label: "Todas",      color: "text-ink-2"          },
    { key: "published" as const, label: "Publicado",  color: "text-link"   },
    { key: "pending" as const,   label: "Aguardando", color: "text-primary-2" },
    { key: "error" as const,     label: "Erro",       color: "text-danger"           },
  ];

  const filtered = filter === "all" ? allAccounts
    : filter === "error" ? allAccounts.filter(a => a.container_status === "error")
    : allAccounts.filter(a => a.container_status === filter);

  const byRecent = (a: AccountStatus, b: AccountStatus) => {
    if (a.last_published_at && b.last_published_at)
      return new Date(b.last_published_at).getTime() - new Date(a.last_published_at).getTime();
    if (a.last_published_at) return -1;
    if (b.last_published_at) return 1;
    return 0;
  };

  const sorted = [...filtered].sort(byRecent);

  const groups: { loopName: string | null; accounts: AccountStatus[] }[] = [];
  if (filter === "all") {
    const map = new Map<string, AccountStatus[]>();
    for (const acc of sorted) {
      const key = acc.loop_name ?? "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(acc);
    }
    const keys = [...map.keys()].sort((a, b) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return a.localeCompare(b);
    });
    for (const k of keys) groups.push({ loopName: k === "__none__" ? null : k, accounts: map.get(k)! });
  }

  const counts = {
    all:       allAccounts.length,
    published: allAccounts.filter(a => a.container_status === "published").length,
    pending:   allAccounts.filter(a => a.container_status === "pending").length,
    error:     allAccounts.filter(a => a.container_status === "error").length,
  };

  return (
    <div className="space-y-6">
      {/* Sub-header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          <p className="text-xs text-ink-3">
            {updatedAt ? `Atualizado ${updatedAt}` : "Carregando..."}
            {" · "}auto em <span className="tabular-nums text-ink-2">{countdown}s</span>
          </p>
        </div>
        <button onClick={() => fetchData(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-surface-raised text-xs text-ink-3 hover:text-ink-2 hover:border-line transition-all">
          <RefreshCw size={12} />Atualizar
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Publicados" sub="últimas 24h" value={m.published_24h} color="green" icon={CheckCircle2} />
        <MetricCard label="Na fila" sub="aguardando" value={m.pending} color="cyan" icon={Clock} />
        <MetricCard label="Erros" sub="últimas 24h" value={m.errors_24h} color="red" icon={XCircle} />
        <MetricCard label="Próxima postagem" sub="countdown" value="" color="amber" icon={TrendingUp}
          extra={<p className="text-sm font-bold text-warning tabular-nums"><Countdown ms={m.next_publish_in_ms} /></p>} />
        <MetricCard label="Loops ativos" sub="em execução" value={m.active_loops} color="blue" icon={Radio} />
      </div>

      {data && <Timeline published={data.timeline.published} upcoming={data.timeline.upcoming} />}

      {/* Filter + Grid */}
      <div>
        <div className="flex items-center gap-1 mb-4 overflow-x-auto no-scrollbar pb-1">
          {LOOP_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap",
                filter === f.key ? "bg-line-control/20 border border-line text-ink" : "text-ink-3 hover:text-ink-2 hover:bg-surface-raised")}>
              <span className={f.color}>{f.label}</span>
              {counts[f.key] > 0 && (
                <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full tabular-nums",
                  filter === f.key ? "bg-line-control/20 text-ink-2" : "bg-surface-hover text-ink-3")}>
                  {counts[f.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {sorted.length === 0 ? (
          <div className="glass-card p-12 flex flex-col items-center justify-center text-center">
            <Zap size={22} className="text-ink-3 mb-3" />
            <p className="text-sm text-ink-3">Nenhuma conta com este status</p>
          </div>
        ) : filter === "all" ? (
          <div className="space-y-6">
            {groups.map(({ loopName, accounts: groupAccs }) => (
              <div key={loopName ?? "__none__"}>
                <div className="flex items-center gap-2 mb-3">
                  <Radio size={11} className={loopName ? "text-primary-2/60" : "text-ink-3"} />
                  <span className={cn("text-[11px] font-bold uppercase tracking-widest",
                    loopName ? "text-primary-2/70" : "text-ink-3")}>
                    {loopName ?? "Sem loop"}
                  </span>
                  <span className="text-[10px] text-ink-3">{groupAccs.length}</span>
                  <div className="flex-1 h-px bg-surface-hover" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                  <AnimatePresence mode="popLayout">
                    {groupAccs.map((acc, i) => (
                      <motion.div key={acc.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.03, duration: 0.2 }}>
                        <LoopAccountCard acc={acc} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            <AnimatePresence mode="popLayout">
              {sorted.map((acc, i) => (
                <motion.div key={acc.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.03, duration: 0.2 }}>
                  <LoopAccountCard acc={acc} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Campaign View ──────────────────────────────────────────────────────────────

function CampaignView() {
  const [data, setData] = useState<CampaignMonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(15);
  const [filter, setFilter] = useState<CampaignFilter>("all");
  const [updatedAt, setUpdatedAt] = useState("");

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/campaigns/monitor");
      if (!res.ok) return;
      const d = await res.json() as CampaignMonitorData;
      setData(d);
      setCountdown(15);
      setUpdatedAt(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const r = setInterval(() => fetchData(true), 15_000);
    const t = setInterval(() => setCountdown(c => c <= 1 ? 15 : c - 1), 1_000);
    return () => { clearInterval(r); clearInterval(t); };
  }, [fetchData]);

  if (loading && !data) {
    return <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-primary-2" /></div>;
  }

  const m = data?.metrics ?? { total_published: 0, total_pending: 0, total_failed: 0, total_overdue: 0, total_likes: 0, total_plays: 0, total_reach: 0, total_comments: 0, active_campaigns: 0, next_publish_in_ms: null };
  const allAccounts = data?.accounts ?? [];

  const CAMP_FILTERS = [
    { key: "all" as const,       label: "Todas",      color: "text-ink-2"          },
    { key: "active" as const,    label: "Na Fila",    color: "text-primary-2" },
    { key: "overdue" as const,   label: "Atrasadas",  color: "text-warning"         },
    { key: "error" as const,     label: "Com Erros",  color: "text-danger"           },
    { key: "completed" as const, label: "Concluídas", color: "text-link"   },
  ];

  const filtered = filter === "all"       ? allAccounts
    : filter === "active"    ? allAccounts.filter(a => a.pending > 0 && a.overdue_count === 0)
    : filter === "overdue"   ? allAccounts.filter(a => a.overdue_count > 0)
    : filter === "error"     ? allAccounts.filter(a => a.failed > 0)
    : allAccounts.filter(a => a.pending === 0 && a.published > 0);

  const counts = {
    all:       allAccounts.length,
    active:    allAccounts.filter(a => a.pending > 0 && a.overdue_count === 0).length,
    overdue:   allAccounts.filter(a => a.overdue_count > 0).length,
    error:     allAccounts.filter(a => a.failed > 0).length,
    completed: allAccounts.filter(a => a.pending === 0 && a.published > 0).length,
  };

  return (
    <div className="space-y-6">
      {/* Sub-header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-2 opacity-50" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-2" />
          </span>
          <p className="text-xs text-ink-3">
            {updatedAt ? `Atualizado ${updatedAt}` : "Carregando..."}
            {" · "}auto em <span className="tabular-nums text-ink-2">{countdown}s</span>
          </p>
        </div>
        <button onClick={() => fetchData(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-surface-raised text-xs text-ink-3 hover:text-ink-2 hover:border-line transition-all">
          <RefreshCw size={12} />Atualizar
        </button>
      </div>

      {/* Metrics — operational */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Publicados" sub="em campanhas" value={m.total_published} color="green" icon={CheckCircle2} />
        <MetricCard label="Na fila" sub="agendados" value={m.total_pending} color="cyan" icon={Clock} />
        <MetricCard label="Atrasados" sub="fora do prazo" value={m.total_overdue} color="amber" icon={AlertTriangle} />
        <MetricCard label="Falhas" sub="total" value={m.total_failed} color="red" icon={XCircle} />
        <MetricCard label="Próxima postagem" sub="countdown" value="" color="amber" icon={TrendingUp}
          extra={<p className="text-sm font-bold text-warning tabular-nums"><Countdown ms={m.next_publish_in_ms} /></p>} />
      </div>
      {/* Metrics — engagement */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
        <MetricCard label="Views" sub="total campanhas" value={fmtNum(m.total_plays ?? 0)} color="cyan" icon={Eye} />
        <MetricCard label="Likes" sub="total campanhas" value={fmtNum(m.total_likes ?? 0)} color="pink" icon={Heart} />
        <MetricCard label="Comentários" sub="total campanhas" value={fmtNum(m.total_comments ?? 0)} color="amber" icon={MessageCircle} />
        <MetricCard label="Alcance" sub="total campanhas" value={fmtNum(m.total_reach ?? 0)} color="blue" icon={Users} />
      </div>

      {data && <Timeline published={data.timeline.published} upcoming={data.timeline.upcoming} />}

      {/* Empty state */}
      {allAccounts.length === 0 ? (
        <div className="glass-card p-16 flex flex-col items-center justify-center text-center">
          <Send size={28} className="text-ink-3 mb-4" />
          <p className="text-sm font-medium text-ink-3 mb-1">Nenhuma campanha ativa</p>
          <p className="text-xs text-ink-3">Crie uma campanha na aba <span className="text-primary-2/50">Postar</span> para monitorar aqui</p>
        </div>
      ) : (
        <div>
          {/* Filter tabs */}
          <div className="flex items-center gap-1 mb-4 overflow-x-auto no-scrollbar pb-1">
            {CAMP_FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap",
                  filter === f.key ? "bg-line-control/20 border border-line text-ink" : "text-ink-3 hover:text-ink-2 hover:bg-surface-raised")}>
                <span className={f.color}>{f.label}</span>
                {counts[f.key] > 0 && (
                  <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full tabular-nums",
                    filter === f.key ? "bg-line-control/20 text-ink-2" : "bg-surface-hover text-ink-3")}>
                    {counts[f.key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="glass-card p-12 flex flex-col items-center justify-center text-center">
              <BarChart2 size={22} className="text-ink-3 mb-3" />
              <p className="text-sm text-ink-3">Nenhuma conta com este filtro</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              <AnimatePresence mode="popLayout">
                {filtered.map((acc, i) => (
                  <motion.div key={acc.account_id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.03, duration: 0.2 }}>
                    <CampaignAccountCard acc={acc} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

type MainTab = "loop" | "campanhas";

export default function MonitorPage() {
  const [tab, setTab] = useState<MainTab>("loop");

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div>
        <h1 className="page-title">Monitor de Postagens</h1>
        <p className="page-subtitle mt-1">Acompanhe loops e campanhas em tempo real</p>
      </div>

      {/* Main Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-2xl bg-surface-raised border border-line w-fit">
        <button
          onClick={() => setTab("loop")}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all",
            tab === "loop"
              ? "bg-line-control/20 border border-line text-ink"
              : "text-ink-3 hover:text-ink-2"
          )}
        >
          <Radio size={14} className={tab === "loop" ? "text-link" : "text-ink-3"} />
          Loop
        </button>
        <button
          onClick={() => setTab("campanhas")}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all",
            tab === "campanhas"
              ? "bg-line-control/20 border border-line text-ink"
              : "text-ink-3 hover:text-ink-2"
          )}
        >
          <Send size={14} className={tab === "campanhas" ? "text-primary-2" : "text-ink-3"} />
          Campanhas
        </button>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {tab === "loop" ? <LoopView /> : <CampaignView />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
