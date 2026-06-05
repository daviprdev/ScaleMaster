"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Clock, AlertTriangle, Loader2, RefreshCw,
  Radio, Zap, TrendingUp, XCircle, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AccountStatus {
  id: string;
  username: string;
  display_name: string | null;
  health_status: string;
  in_active_loop: boolean;
  loop_name: string | null;
  container_status: "published" | "pending" | "publishing" | "error" | "none";
  last_published_at: string | null;
  last_media_id: string | null;
  next_publish_at: string | null;
  pending_since: string | null;
  retry_count: number;
  last_error: string | null;
  published_24h: number;
  errors_24h: number;
}

interface TimelineEntry { account_username: string; at: string; media_id: string | null }
interface UpcomingEntry { account_username: string; at: string; retry_count: number }

interface MonitorData {
  metrics: {
    published_24h: number;
    pending: number;
    errors_24h: number;
    next_publish_in_ms: number | null;
    active_loops: number;
  };
  accounts: AccountStatus[];
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

const STATUS_CONFIG = {
  published:  { label: "Publicado",   color: "text-[var(--matrix)]",  bg: "bg-[var(--matrix)]/10",  border: "border-[var(--matrix)]/25",  dot: "bg-[var(--matrix)]"  },
  pending:    { label: "Aguardando",  color: "text-[var(--electric)]", bg: "bg-[var(--electric)]/10", border: "border-[var(--electric)]/25", dot: "bg-[var(--electric)]" },
  publishing: { label: "Publicando",  color: "text-amber-400",         bg: "bg-amber-500/10",         border: "border-amber-500/25",         dot: "bg-amber-400"          },
  error:      { label: "Erro",        color: "text-red-400",           bg: "bg-red-500/10",           border: "border-red-500/25",           dot: "bg-red-500"            },
  none:       { label: "Sem atividade", color: "text-white/25",        bg: "bg-white/[0.03]",         border: "border-white/[0.06]",         dot: "bg-white/20"           },
};

// ── Components ─────────────────────────────────────────────────────────────────

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
    "from-[var(--matrix)]/70 to-[var(--electric)]/70",
    "from-violet-500 to-purple-700",
    "from-cyan-500 to-blue-600",
    "from-amber-500 to-orange-600",
    "from-rose-500 to-pink-700",
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
  label: string; sub: string; value: string | number; color: "green" | "cyan" | "red" | "amber" | "violet";
  icon: React.ElementType; extra?: React.ReactNode;
}) {
  const c = {
    green:  { border: "border-[var(--matrix)]/20",  glow: "from-[var(--matrix)]/8",  num: "text-[var(--matrix)]",  ic: "text-[var(--matrix)]/40"  },
    cyan:   { border: "border-[var(--electric)]/20", glow: "from-[var(--electric)]/8", num: "text-[var(--electric)]", ic: "text-[var(--electric)]/40" },
    red:    { border: "border-red-500/20",    glow: "from-red-500/8",    num: "text-red-400",    ic: "text-red-400/40"    },
    amber:  { border: "border-amber-500/20",  glow: "from-amber-500/8",  num: "text-amber-400",  ic: "text-amber-400/40"  },
    violet: { border: "border-violet-500/20", glow: "from-violet-500/8", num: "text-violet-400", ic: "text-violet-400/40" },
  }[color];
  return (
    <div className={cn("glass-card p-4 border relative overflow-hidden", c.border)}>
      <div className={cn("absolute inset-0 bg-gradient-to-br to-transparent", c.glow)} />
      <div className="relative flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Icon size={13} className={c.ic} />
          <span className={cn("text-2xl font-bold tabular-nums tracking-tight", c.num)}>{value}</span>
        </div>
        <div>
          <p className="text-xs text-white/55 font-medium">{label}</p>
          <p className="text-[10px] text-white/25">{sub}</p>
          {extra && <div className="mt-1">{extra}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────────────

function Timeline({ published, upcoming }: { published: TimelineEntry[]; upcoming: UpcomingEntry[] }) {
  const now = Date.now();
  const windowMs = 9 * 60 * 60 * 1000; // 9 hours window: 6h back + 3h forward
  const startMs = now - 6 * 60 * 60 * 1000;
  const endMs   = now + 3 * 60 * 60 * 1000;

  function toPercent(ts: number) {
    return Math.max(0, Math.min(100, ((ts - startMs) / windowMs) * 100));
  }

  const nowPct = toPercent(now);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-7 h-7 rounded-xl bg-[var(--electric)]/10 flex items-center justify-center">
          <Activity size={14} className="text-[var(--electric)]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white/90">Linha do Tempo</h2>
          <p className="text-[10px] text-white/30">6h atrás → agora → próximas 3h</p>
        </div>
        <div className="ml-auto flex items-center gap-4 text-[10px] text-white/30">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--matrix)]" />Publicado</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--electric)]" />Agendado</span>
        </div>
      </div>

      {/* Track */}
      <div className="relative h-2 rounded-full bg-white/[0.04] border border-white/[0.06] overflow-visible mx-2">
        {/* Past region */}
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/[0.03]" style={{ width: `${nowPct}%` }} />
        {/* Now line */}
        <div className="absolute top-1/2 -translate-y-1/2 z-20" style={{ left: `${nowPct}%` }}>
          <div className="w-px h-6 bg-white/40 -translate-x-1/2 -translate-y-2" />
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-[9px] text-white/40 whitespace-nowrap">agora</div>
        </div>

        {/* Published dots */}
        {published.map((p, i) => {
          const pct = toPercent(new Date(p.at).getTime());
          if (pct < 0 || pct > nowPct) return null;
          return (
            <div key={i} className="absolute top-1/2 -translate-y-1/2 z-10 group" style={{ left: `${pct}%` }}>
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--matrix)] -translate-x-1/2 border border-black/50 cursor-default" />
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center">
                <div className="bg-black/90 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white/70 whitespace-nowrap">
                  @{p.account_username}<br />
                  <span className="text-white/40">{new Date(p.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Upcoming dots */}
        {upcoming.map((u, i) => {
          const pct = toPercent(new Date(u.at).getTime());
          if (pct <= nowPct || pct > 100) return null;
          return (
            <div key={i} className="absolute top-1/2 -translate-y-1/2 z-10 group" style={{ left: `${pct}%` }}>
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--electric)] -translate-x-1/2 border border-black/50 cursor-default animate-pulse" />
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center">
                <div className="bg-black/90 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white/70 whitespace-nowrap">
                  @{u.account_username}<br />
                  <span className="text-white/40">{timeIn(u.at)}</span>
                  {u.retry_count > 0 && <span className="text-amber-400/70"> · retry {u.retry_count}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Time labels */}
      <div className="flex justify-between mt-3 text-[9px] text-white/20 px-2">
        <span>-6h</span>
        <span>-4h</span>
        <span>-2h</span>
        <span className="text-white/40 font-medium">agora</span>
        <span>+1h</span>
        <span>+2h</span>
        <span>+3h</span>
      </div>

      {/* Upcoming queue list */}
      {upcoming.length > 0 && (
        <div className="mt-5 border-t border-white/[0.05] pt-4">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-3">Próximas na fila</p>
          <div className="flex flex-wrap gap-2">
            {upcoming.slice(0, 12).map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[var(--electric)]/[0.05] border border-[var(--electric)]/15">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--electric)] animate-pulse shrink-0" />
                <span className="text-[11px] text-white/60 font-medium">@{u.account_username}</span>
                <span className="text-[10px] text-[var(--electric)]/70">{timeIn(u.at)}</span>
                {u.retry_count > 0 && (
                  <span className="text-[9px] text-amber-400/60 border border-amber-500/20 rounded px-1">retry {u.retry_count}</span>
                )}
              </div>
            ))}
            {upcoming.length > 12 && (
              <div className="flex items-center px-2.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <span className="text-[10px] text-white/25">+{upcoming.length - 12} mais</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Account Card ───────────────────────────────────────────────────────────────

function AccountCard({ acc }: { acc: AccountStatus }) {
  const cfg = STATUS_CONFIG[acc.container_status];
  const [expanded, setExpanded] = useState(false);
  const hasError = acc.container_status === "error" || acc.health_status === "error";
  const errorMsg = acc.last_error ?? (acc.health_status === "error" ? "Conta marcada como erro" : null);

  return (
    <motion.div
      layout
      className={cn(
        "glass-card p-4 border flex flex-col gap-3 cursor-default",
        cfg.border,
        hasError && "border-red-500/25"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="relative">
          <Avatar username={acc.username} size="md" />
          <span className={cn(
            "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black",
            hasError ? "bg-red-500" : cfg.dot
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white/90 truncate">@{acc.username}</p>
            {acc.in_active_loop && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-600/15 border border-violet-500/20">
                <Radio size={8} className="text-violet-400 animate-pulse" />
                <span className="text-[9px] text-violet-300">{acc.loop_name ?? "Loop"}</span>
              </span>
            )}
          </div>
          {acc.display_name && (
            <p className="text-[10px] text-white/30 truncate">{acc.display_name}</p>
          )}
        </div>
        {/* Status badge */}
        <span className={cn(
          "shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border",
          hasError ? "text-red-400 bg-red-500/10 border-red-500/25" : cn(cfg.color, cfg.bg, cfg.border)
        )}>
          {acc.container_status === "published"  && <CheckCircle2 size={10} />}
          {acc.container_status === "pending"    && <Clock size={10} className="animate-pulse" />}
          {acc.container_status === "publishing" && <Loader2 size={10} className="animate-spin" />}
          {(acc.container_status === "error" || hasError) && <AlertTriangle size={10} />}
          {acc.container_status === "none" && !hasError && <Zap size={10} />}
          {hasError ? "Erro" : cfg.label}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04]">
          <span className="text-white/30 text-[9px] uppercase tracking-wider">Último post</span>
          <span className={cn("font-medium", acc.last_published_at ? "text-[var(--matrix)]" : "text-white/20")}>
            {timeAgo(acc.last_published_at)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04]">
          <span className="text-white/30 text-[9px] uppercase tracking-wider">
            {acc.container_status === "pending" ? "Próximo" : "Postados 24h"}
          </span>
          {acc.container_status === "pending" ? (
            <span className="font-medium text-[var(--electric)]">{timeIn(acc.next_publish_at)}</span>
          ) : (
            <span className={cn("font-medium", acc.published_24h > 0 ? "text-[var(--matrix)]" : "text-white/20")}>
              {acc.published_24h}
            </span>
          )}
        </div>
      </div>

      {/* Error detail */}
      {hasError && errorMsg && (
        <div
          className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/[0.05] border border-red-500/15 cursor-pointer"
          onClick={() => setExpanded(e => !e)}
        >
          <AlertTriangle size={11} className="text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className={cn("text-[10px] text-red-400/80 leading-relaxed", !expanded && "line-clamp-1")}>
              {errorMsg}
            </p>
            {errorMsg.length > 60 && (
              <p className="text-[9px] text-red-500/50 mt-0.5">{expanded ? "▲ ocultar" : "▼ ver tudo"}</p>
            )}
          </div>
        </div>
      )}

      {/* Retry info */}
      {acc.container_status === "pending" && acc.retry_count > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/15">
          <span className="text-[10px] text-amber-400/70">Tentativa #{acc.retry_count + 1} · {timeIn(acc.next_publish_at)}</span>
        </div>
      )}
    </motion.div>
  );
}

// ── Filter Tabs ────────────────────────────────────────────────────────────────

type FilterKey = "all" | "published" | "pending" | "error";

const FILTERS: { key: FilterKey; label: string; color: string }[] = [
  { key: "all",       label: "Todas",     color: "text-white/60"         },
  { key: "published", label: "Publicado", color: "text-[var(--matrix)]"  },
  { key: "pending",   label: "Aguardando",color: "text-[var(--electric)]"},
  { key: "error",     label: "Erro",      color: "text-red-400"          },
];

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(15);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [updatedAt, setUpdatedAt] = useState("");

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/loop/monitor");
      if (!res.ok) return;
      const d = await res.json() as MonitorData;
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
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-[var(--electric)]" />
      </div>
    );
  }

  const m = data?.metrics ?? { published_24h: 0, pending: 0, errors_24h: 0, next_publish_in_ms: null, active_loops: 0 };
  const allAccounts = data?.accounts ?? [];

  const filtered = filter === "all" ? allAccounts
    : filter === "error" ? allAccounts.filter(a => a.container_status === "error")
    : allAccounts.filter(a => a.container_status === filter);

  // Sort: error → publishing → pending → published → none
  const ORDER: Record<string, number> = { error: 0, publishing: 1, pending: 2, published: 3, none: 4 };
  const sorted = [...filtered].sort((a, b) => {
    const ao = a.health_status === "error" ? 0 : (ORDER[a.container_status] ?? 5);
    const bo = b.health_status === "error" ? 0 : (ORDER[b.container_status] ?? 5);
    return ao - bo;
  });

  const counts: Record<FilterKey, number> = {
    all:       allAccounts.length,
    published: allAccounts.filter(a => a.container_status === "published").length,
    pending:   allAccounts.filter(a => a.container_status === "pending").length,
    error:     allAccounts.filter(a => a.container_status === "error").length,
  };

  return (
    <div className="space-y-6 max-w-full">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Monitor de Postagens</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--matrix)] opacity-50" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--matrix)]" />
            </span>
            <p className="text-xs text-white/35">
              {updatedAt ? `Atualizado ${updatedAt}` : "Carregando..."}
              {" · "}auto em <span className="tabular-nums text-white/50">{countdown}s</span>
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchData(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/40 hover:text-white/70 hover:border-white/15 transition-all"
        >
          <RefreshCw size={12} />
          Atualizar
        </button>
      </div>

      {/* ── Metrics ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Publicados" sub="últimas 24h" value={m.published_24h} color="green" icon={CheckCircle2} />
        <MetricCard label="Na fila" sub="aguardando" value={m.pending} color="cyan" icon={Clock} />
        <MetricCard label="Erros" sub="últimas 24h" value={m.errors_24h} color="red" icon={XCircle} />
        <MetricCard
          label="Próxima postagem"
          sub="countdown"
          value=""
          color="amber"
          icon={TrendingUp}
          extra={
            <p className="text-sm font-bold text-amber-400 tabular-nums">
              <Countdown ms={m.next_publish_in_ms} />
            </p>
          }
        />
        <MetricCard label="Loops ativos" sub="em execução" value={m.active_loops} color="violet" icon={Radio} />
      </div>

      {/* ── Timeline ───────────────────────────────────────────── */}
      {data && (
        <Timeline
          published={data.timeline.published}
          upcoming={data.timeline.upcoming}
        />
      )}

      {/* ── Filter Tabs + Grid ─────────────────────────────────── */}
      <div>
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto no-scrollbar pb-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap",
                filter === f.key
                  ? "bg-white/[0.08] border border-white/15 text-white/80"
                  : "text-white/30 hover:text-white/55 hover:bg-white/[0.04]"
              )}
            >
              <span className={f.color}>{f.label}</span>
              {counts[f.key] > 0 && (
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-full tabular-nums",
                  filter === f.key ? "bg-white/10 text-white/60" : "bg-white/[0.05] text-white/25"
                )}>
                  {counts[f.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Grid */}
        {sorted.length === 0 ? (
          <div className="glass-card p-12 flex flex-col items-center justify-center text-center">
            <Zap size={22} className="text-white/15 mb-3" />
            <p className="text-sm text-white/30">Nenhuma conta com este status</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            <AnimatePresence mode="popLayout">
              {sorted.map((acc, i) => (
                <motion.div
                  key={acc.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.03, duration: 0.2 }}
                >
                  <AccountCard acc={acc} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

    </div>
  );
}
