"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Instagram,
  CalendarCheck,
  ListOrdered,
  UserPlus,
  ShieldAlert,
  ArrowUpRight,
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Send,
  Bot,
  Repeat2,
  ImagePlay,
  Eye,
  DollarSign,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────
interface DashboardStats {
  sales: { today: number; yesterday: number; month: number; prev_month: number };
  accounts: {
    total: number;
    added_today: number;
    added_yesterday: number;
    added_7d: number;
  };
  accounts_down: {
    total: number;
    down_today: number;
    down_yesterday: number;
    down_7d: number;
  };
  posts_today: { published: number; scheduled: number; loop: number };
  views: {
    total: number;
    tracked_posts: number;
    total_posts: number;
    last_synced_at: string | null;
  };
  queue: { pending: number };
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

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

// ── Skeletons ────────────────────────────────────────────────────
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

function BreakdownSkeleton() {
  return (
    <div className="glass-card p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex-shrink-0" />
        <div className="space-y-1.5">
          <div className="h-6 w-10 rounded bg-white/[0.08]" />
          <div className="h-2.5 w-24 rounded bg-white/[0.05]" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/[0.06]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="h-4 w-6 rounded bg-white/[0.06]" />
            <div className="h-2 w-10 rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Reusable ambient glow wrapper (efeito de fundo transparente) ──
function AmbientGlow({ color }: { color: string }) {
  return (
    <>
      <div
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl pointer-events-none transition-opacity duration-500 opacity-40 group-hover:opacity-90"
        style={{ background: color }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          background: `radial-gradient(120% 100% at 0% 0%, ${color}, transparent 60%)`,
        }}
      />
    </>
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
      if (!r.ok) return;
      const data = await r.json();
      if (!data.error) setStats(data);
    } catch {
      // Rede/JSON inválido — ignora silenciosamente, próximo tick (60s) tenta de novo
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

  const simpleCards = stats
    ? [
        {
          label: "Contas Conectadas",
          value: String(stats.accounts.total),
          change: "Total no SaaS",
          icon: Instagram,
          iconColor: "#00FF41",
          glow: "rgba(0,255,65,0.22)",
        },
        {
          label: "Postagens Hoje",
          value: String(stats.posts_today.published),
          change: `${stats.posts_today.loop} via Loop · ${stats.posts_today.scheduled} via campanhas`,
          icon: CalendarCheck,
          iconColor: "#00E5FF",
          glow: "rgba(0,229,255,0.22)",
        },
        {
          label: "Views Totais",
          value: formatCompact(stats.views.total),
          change:
            stats.views.total_posts > 0
              ? `${stats.views.tracked_posts}/${stats.views.total_posts} posts sincronizados`
              : "Contas ativas e conectadas",
          icon: Eye,
          iconColor: "#00E5FF",
          glow: "rgba(0,229,255,0.22)",
        },
        {
          label: "Fila",
          value: String(stats.queue.pending),
          change: "Aguardando publicação",
          icon: ListOrdered,
          iconColor: "#00FF41",
          glow: "rgba(0,255,65,0.22)",
        },
      ]
    : null;

  const breakdownCards = stats
    ? [
        {
          key: "added",
          label: "Contas Adicionadas",
          total: stats.accounts.added_7d,
          totalLabel: "novas em 7 dias",
          icon: UserPlus,
          iconColor: "#00FF41",
          glow: "rgba(0,255,65,0.22)",
          items: [
            { label: "Hoje", value: stats.accounts.added_today },
            { label: "Ontem", value: stats.accounts.added_yesterday },
            { label: "7 dias", value: stats.accounts.added_7d },
          ],
        },
        {
          key: "down",
          label: "Contas Caídas",
          total: stats.accounts_down.total,
          totalLabel: "com erro agora",
          icon: ShieldAlert,
          iconColor: "#FF3B3B",
          glow: "rgba(255,59,59,0.22)",
          items: [
            { label: "Hoje", value: stats.accounts_down.down_today },
            { label: "Ontem", value: stats.accounts_down.down_yesterday },
            { label: "7 dias", value: stats.accounts_down.down_7d },
          ],
        },
      ]
    : null;

  const salesCards = stats
    ? [
        {
          label: "Vendas Diárias",
          value: formatBRL(stats.sales.today),
          change: "Desde a meia-noite (Brasília)",
          compareLabel: "Ontem",
          compareValue: formatBRL(stats.sales.yesterday),
          icon: DollarSign,
          iconColor: "#00FF41",
          glow: "rgba(0,255,65,0.22)",
        },
        {
          label: "Vendas Mensais",
          value: formatBRL(stats.sales.month),
          change: "Reinicia no dia 1º de cada mês",
          compareLabel: "Mês anterior",
          compareValue: formatBRL(stats.sales.prev_month),
          icon: DollarSign,
          iconColor: "#00FF41",
          glow: "rgba(0,255,65,0.22)",
        },
      ]
    : null;

  const quickActions = [
    { label: "Postar", href: "/dashboard/postar", icon: Send, desc: "Distribuição de conteúdo", color: "#00FF41" },
    { label: "Automatizar", href: "/dashboard/automatizar", icon: Bot, desc: "Publicação por pasta", color: "#00E5FF" },
    { label: "Loop", href: "/dashboard/loop", icon: Repeat2, desc: "Ciclo contínuo", color: "#00FF41" },
    { label: "Stories", href: "/dashboard/stories", icon: ImagePlay, desc: "Postar e importar", color: "#00E5FF" },
  ];

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

      {/* Vendas: diária / mensal */}
      <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {loading || !salesCards
          ? Array.from({ length: 2 }).map((_, i) => (
              <motion.div key={i} variants={fadeUp}><StatSkeleton /></motion.div>
            ))
          : salesCards.map((stat, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="glass-card ticks p-5 group relative overflow-hidden"
              >
                <AmbientGlow color={stat.glow} />

                <div className="flex items-start justify-between mb-4 relative z-10">
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
                </div>

                <div
                  className="text-2xl font-black mb-0.5 relative z-10"
                  style={{ color: stat.iconColor, textShadow: `0 0 20px ${stat.glow}` }}
                >
                  {stat.value}
                </div>
                <div className="text-xs text-white/50 font-medium relative z-10">{stat.label}</div>
                <div className="text-[10px] text-white/25 mt-1 relative z-10">{stat.change}</div>
                <div className="text-[10px] text-white/30 mt-2 pt-2 border-t border-white/[0.06] relative z-10">
                  {stat.compareLabel}: <span className="text-white/50 font-medium">{stat.compareValue}</span>
                </div>
              </motion.div>
            ))}
      </motion.div>

      {/* Simple stat cards: Contas Conectadas / Postagens Hoje / Views Totais / Fila */}
      <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || !simpleCards
          ? Array.from({ length: 4 }).map((_, i) => (
              <motion.div key={i} variants={fadeUp}><StatSkeleton /></motion.div>
            ))
          : simpleCards.map((stat, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="glass-card ticks p-5 group relative overflow-hidden"
              >
                <AmbientGlow color={stat.glow} />

                <div className="flex items-start justify-between mb-4 relative z-10">
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

      {/* Breakdown cards: Contas Adicionadas / Contas Caídas */}
      <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading || !breakdownCards
          ? Array.from({ length: 2 }).map((_, i) => (
              <motion.div key={i} variants={fadeUp}><BreakdownSkeleton /></motion.div>
            ))
          : breakdownCards.map((card) => (
              <motion.div
                key={card.key}
                variants={fadeUp}
                className="glass-card ticks p-5 group relative overflow-hidden"
              >
                <AmbientGlow color={card.glow} />

                <div className="flex items-center gap-3 mb-4 relative z-10">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: `0.5px solid ${card.iconColor}33`,
                      boxShadow: `0 0 14px ${card.glow}`,
                    }}
                  >
                    <card.icon size={18} style={{ color: card.iconColor }} strokeWidth={1.5} />
                  </div>
                  <div>
                    <div
                      className="text-2xl font-black leading-none"
                      style={{ color: card.iconColor, textShadow: `0 0 20px ${card.glow}` }}
                    >
                      {card.total}
                    </div>
                    <div className="text-xs text-white/50 font-medium mt-1">{card.label}</div>
                  </div>
                </div>

                <div className="text-[10px] text-white/20 relative z-10 mb-2">{card.totalLabel}</div>

                <div className="grid grid-cols-3 gap-2 relative z-10 pt-3 border-t border-white/[0.06]">
                  {card.items.map((item) => (
                    <div key={item.label} className="flex flex-col items-center gap-0.5">
                      <div className="text-sm font-bold text-white/75">{item.value}</div>
                      <div className="text-[10px] text-white/25">{item.label}</div>
                    </div>
                  ))}
                </div>
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
                  {stats.queue.pending} na fila
                </span>
              )}

              {!loading && stats && stats.queue.pending > 0 && (
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
          {quickActions.map((action, i) => (
            <motion.a
              key={i}
              href={action.href}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="flex flex-col items-center gap-3 p-4 rounded-xl cursor-pointer text-center group/action relative overflow-hidden transition-all duration-300"
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
                className="absolute -top-6 -right-6 w-20 h-20 rounded-full blur-2xl pointer-events-none opacity-0 group-hover/action:opacity-60 transition-opacity duration-500"
                style={{ background: `${action.color}55` }}
              />
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center relative z-10"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `0.5px solid ${action.color}22`,
                }}
              >
                <action.icon size={18} style={{ color: action.color }} strokeWidth={1.5} />
              </div>
              <div className="relative z-10">
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
