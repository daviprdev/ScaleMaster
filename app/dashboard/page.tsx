"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Instagram,
  Download,
  CalendarCheck,
  TrendingUp,
  ArrowUpRight,
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Search,
  FolderOpen,
  CalendarPlus,
  UserPlus,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────
interface DashboardStats {
  accounts: { total: number; this_month: number };
  videos: { total: number; this_week: number };
  scheduled: { pending: number; next_at: string | null };
  published: { total: number };
  recent_activity: {
    type: "download" | "schedule";
    text: string;
    status: "success" | "error";
    created_at: string;
  }[];
  upcoming_posts: {
    account_username: string;
    scheduled_at: string;
    gradient: string;
  }[];
}

// ── Helpers ──────────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora mesmo";
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return `há ${Math.floor(hrs / 24)}d`;
}

function nextPostIn(dateStr: string | null): string {
  if (!dateStr) return "Nenhuma agendada";
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "Em breve";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `Próxima em ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Próxima em ${hrs}h`;
  return `Próxima em ${Math.floor(hrs / 24)}d`;
}

function formatScheduled(dateStr: string): { label: string; time: string } {
  const d = new Date(dateStr);
  const now = new Date();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return { label: "Hoje", time };
  const tmr = new Date(now);
  tmr.setDate(now.getDate() + 1);
  if (d.toDateString() === tmr.toDateString()) return { label: "Amanhã", time };
  return { label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), time };
}

// ── Animation variants ───────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};
const stagger = { show: { transition: { staggerChildren: 0.08 } } };

// ── Skeleton ─────────────────────────────────────────────────────
function StatSkeleton() {
  return (
    <div className="glass-card p-5 animate-pulse">
      <div className="w-10 h-10 rounded-xl bg-white/[0.06] mb-4" />
      <div className="h-7 w-14 rounded-lg bg-white/[0.08] mb-2" />
      <div className="h-3 w-28 rounded bg-white/[0.05] mb-1.5" />
      <div className="h-2.5 w-20 rounded bg-white/[0.03]" />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats]           = useState<DashboardStats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing]     = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStats = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await fetch("/api/dashboard/stats", { cache: "no-store" });
      const data = await r.json();
      if (!data.error) setStats(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const id = setInterval(() => loadStats(true), 60_000);
    return () => clearInterval(id);
  }, [loadStats]);

  const handleClearQueue = useCallback(async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      clearTimer.current = setTimeout(() => setClearConfirm(false), 3500);
      return;
    }
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setClearConfirm(false);
    setClearing(true);
    try {
      await fetch("/api/posts/clear-pending", { method: "POST" });
      await loadStats(true);
    } finally {
      setClearing(false);
    }
  }, [clearConfirm, loadStats]);

  const statCards = stats
    ? [
        {
          label: "Contas Conectadas",
          value: String(stats.accounts.total),
          change: stats.accounts.this_month > 0 ? `+${stats.accounts.this_month} este mês` : "Nenhuma este mês",
          up: stats.accounts.this_month > 0,
          icon: Instagram,
          iconColor: "#00FF41",
          glow: "rgba(0,255,65,0.18)",
          accent: "rgba(0,255,65,0.08)",
        },
        {
          label: "Vídeos Baixados",
          value: String(stats.videos.total),
          change: stats.videos.this_week > 0 ? `+${stats.videos.this_week} esta semana` : "Nenhum esta semana",
          up: stats.videos.this_week > 0,
          icon: Download,
          iconColor: "#00E5FF",
          glow: "rgba(0,229,255,0.18)",
          accent: "rgba(0,229,255,0.08)",
        },
        {
          label: "Postagens Agendadas",
          value: String(stats.scheduled.pending),
          change: nextPostIn(stats.scheduled.next_at),
          up: false,
          icon: CalendarCheck,
          iconColor: "#00FF41",
          glow: "rgba(0,255,65,0.18)",
          accent: "rgba(0,255,65,0.08)",
        },
        {
          label: "Posts Publicados",
          value: String(stats.published.total),
          change: stats.published.total > 0 ? "Total publicado" : "Nenhum ainda",
          up: stats.published.total > 0,
          icon: TrendingUp,
          iconColor: "#00E5FF",
          glow: "rgba(0,229,255,0.18)",
          accent: "rgba(0,229,255,0.08)",
        },
      ]
    : null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6 max-w-7xl">

      {/* Refresh */}
      <motion.div variants={fadeUp} className="flex items-center justify-end">
        <button
          onClick={() => loadStats(true)}
          disabled={loading || refreshing}
          className="flex items-center gap-1.5 text-[11px] text-white/25 hover:text-[#00FF41] transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Atualizando…" : "Atualizar"}
        </button>
      </motion.div>

      {/* Stat cards */}
      <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {loading || !statCards
          ? Array.from({ length: 4 }).map((_, i) => (
              <motion.div key={i} variants={fadeUp}><StatSkeleton /></motion.div>
            ))
          : statCards.map((stat, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="glass-card ticks p-5 group relative overflow-hidden"
              >
                {/* Background accent */}
                <div
                  className="absolute -top-8 -right-8 w-28 h-28 rounded-full blur-3xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: stat.accent }}
                />

                <div className="flex items-start justify-between mb-4 relative z-10">
                  {/* Glass icon */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: `0.5px solid ${stat.iconColor}33`,
                      boxShadow: `0 0 14px ${stat.glow}`,
                    }}
                  >
                    <stat.icon size={18} style={{ color: stat.iconColor }} strokeWidth={1.5} />
                  </div>

                  {stat.up && (
                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-400">
                      <ArrowUpRight size={11} />
                    </span>
                  )}
                </div>

                <div
                  className="text-2xl font-black mb-0.5 relative z-10"
                  style={{ color: stat.iconColor, textShadow: `0 0 20px ${stat.glow}` }}
                >
                  {stat.value}
                </div>
                <div className="text-xs text-white/50 font-medium relative z-10">{stat.label}</div>
                <div className="text-[10px] text-white/25 mt-1 relative z-10">{stat.change}</div>
              </motion.div>
            ))}
      </motion.div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Atividade Recente */}
        <motion.div variants={fadeUp} className="lg:col-span-2 glass-card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-white/80 tracking-wide uppercase">Atividade Recente</h2>
            <button className="text-[11px] text-[#00FF41]/60 hover:text-[#00FF41] transition-colors">
              Ver tudo
            </button>
          </div>

          {loading ? (
            <div className="space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
                  <div className="w-7 h-7 rounded-lg bg-white/[0.06] flex-shrink-0" />
                  <div className="flex-1 h-3 rounded bg-white/[0.06]" />
                  <div className="w-12 h-2.5 rounded bg-white/[0.04] flex-shrink-0" />
                </div>
              ))}
            </div>
          ) : !stats || stats.recent_activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-white/20">
              <Clock size={28} className="mb-2" />
              <p className="text-sm">Nenhuma atividade recente</p>
            </div>
          ) : (
            <div className="space-y-0">
              {stats.recent_activity.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 + i * 0.04 }}
                  className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] last:border-0"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: item.status === "success" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                      border: `0.5px solid ${item.status === "success" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                    }}
                  >
                    {item.status === "success"
                      ? <CheckCircle2 size={13} className="text-emerald-400" />
                      : <AlertCircle size={13} className="text-red-400" />
                    }
                  </div>
                  <p className="flex-1 text-sm text-white/55 truncate">{item.text}</p>
                  <div className="flex items-center gap-1 text-[10px] text-white/20 flex-shrink-0">
                    <Clock size={9} />
                    {timeAgo(item.created_at)}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Próximas Postagens */}
        <motion.div variants={fadeUp} className="glass-card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-white/80 tracking-wide uppercase">Próximas Postagens</h2>
            <div className="flex items-center gap-2">
              {loading && <div className="w-14 h-4 rounded-full bg-white/[0.06] animate-pulse" />}

              {!loading && stats && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{
                    background: "rgba(0,255,65,0.08)",
                    border: "0.5px solid rgba(0,255,65,0.2)",
                    color: "#00FF41",
                  }}
                >
                  {stats.scheduled.pending} agendadas
                </span>
              )}

              {!loading && stats && stats.scheduled.pending > 0 && (
                <button
                  onClick={handleClearQueue}
                  disabled={clearing}
                  className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                    clearConfirm
                      ? "bg-red-500/15 border-red-500/30 text-red-400"
                      : "bg-white/[0.03] border-white/[0.08] text-white/25 hover:border-red-500/25 hover:text-red-400"
                  }`}
                >
                  {clearing ? <RefreshCw size={9} className="animate-spin" /> : <Trash2 size={9} />}
                  {clearConfirm ? "Confirmar?" : "Limpar"}
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-20 rounded bg-white/[0.06]" />
                    <div className="h-2.5 w-14 rounded bg-white/[0.04]" />
                  </div>
                </div>
              ))}
            </div>
          ) : !stats || stats.upcoming_posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-white/20">
              <CalendarCheck size={28} className="mb-2" />
              <p className="text-sm">Nenhuma agendada</p>
            </div>
          ) : (
            <div className="space-y-1">
              {stats.upcoming_posts.map((post, i) => {
                const { label, time } = formatScheduled(post.scheduled_at);
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * 0.05 }}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors cursor-pointer group/post"
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "0.5px solid rgba(0,229,255,0.2)",
                      }}
                    >
                      <Play size={13} style={{ color: "#00E5FF" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white/70 truncate group-hover/post:text-white/90 transition-colors">
                        @{post.account_username}
                      </p>
                      <p className="text-[10px] text-white/25">{label} às {time}</p>
                    </div>
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: "#00FF41", boxShadow: "0 0 6px rgba(0,255,65,0.8)" }}
                    />
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* Ações Rápidas */}
      <motion.div variants={fadeUp} className="glass-card p-5">
        <h2 className="text-sm font-semibold text-white/80 tracking-wide uppercase mb-4">Ações Rápidas</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Pesquisar Reels", href: "/dashboard/inspirations", icon: Search, desc: "Scraping de perfil", color: "#00FF41" },
            { label: "Ver Biblioteca", href: "/dashboard/library", icon: FolderOpen, desc: "Seus vídeos", color: "#00E5FF" },
            { label: "Agendar Post", href: "/dashboard/postar", icon: CalendarPlus, desc: "Múltiplas contas", color: "#00FF41" },
            { label: "Adicionar Conta", href: "/dashboard/accounts", icon: UserPlus, desc: "Conectar Instagram", color: "#00E5FF" },
          ].map((action, i) => (
            <motion.a
              key={i}
              href={action.href}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="flex flex-col items-center gap-3 p-4 rounded-xl cursor-pointer text-center group/action transition-all duration-300"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "0.5px solid rgba(255,255,255,0.07)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.border = `0.5px solid ${action.color}33`;
                (e.currentTarget as HTMLAnchorElement).style.background = `${action.color}06`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.border = "0.5px solid rgba(255,255,255,0.07)";
                (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.02)";
              }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `0.5px solid ${action.color}22`,
                }}
              >
                <action.icon size={18} style={{ color: action.color }} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-xs font-medium text-white/70">{action.label}</p>
                <p className="text-[10px] text-white/30 mt-0.5">{action.desc}</p>
              </div>
            </motion.a>
          ))}
        </div>
      </motion.div>

    </motion.div>
  );
}
