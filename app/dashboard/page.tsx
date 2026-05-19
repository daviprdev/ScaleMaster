"use client";

import { useEffect, useState } from "react";
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
  Clapperboard,
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

interface StoriesData {
  total: number;
  expiring_first_at: string | null;
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
  const time = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (d.toDateString() === now.toDateString()) return { label: "Hoje", time };
  const tmr = new Date(now);
  tmr.setDate(now.getDate() + 1);
  if (d.toDateString() === tmr.toDateString()) return { label: "Amanhã", time };
  return {
    label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    time,
  };
}

/**
 * Stories expire exactly 24h after their timestamp.
 * Returns human-readable countdown to the earliest expiring story.
 */
function storyExpiresIn(timestamp: string | null): string {
  if (!timestamp) return "Nenhum story ativo";
  const expiresAt = new Date(timestamp).getTime() + 24 * 60 * 60 * 1000;
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "Expirando agora";
  const totalMins = Math.floor(diff / 60_000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) return `Próximo a expirar em: ${hrs}h ${mins}m`;
  return `Próximo a expirar em: ${mins}m`;
}

// ── Animation variants ───────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

const stagger = {
  show: { transition: { staggerChildren: 0.08 } },
};

// ── Skeleton ─────────────────────────────────────────────────────
function StatSkeleton() {
  return (
    <div className="glass-card p-5 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl bg-white/10" />
      </div>
      <div className="h-7 w-14 rounded-lg bg-white/10 mb-2" />
      <div className="h-3 w-28 rounded bg-white/10 mb-1.5" />
      <div className="h-2.5 w-20 rounded bg-white/[0.06]" />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [stories, setStories] = useState<StoriesData>({ total: 0, expiring_first_at: null });
  const [storiesLoading, setStoriesLoading] = useState(true);

  useEffect(() => {
    // Fetch dashboard stats and stories in parallel
    Promise.all([
      fetch("/api/dashboard/stats").then((r) => r.json()),
      fetch("/api/instagram/stories").then((r) => r.json()),
    ]).then(([statsData, storiesData]) => {
      if (!statsData.error) setStats(statsData);
      if (!storiesData.error) {
        setStories({
          total: storiesData.total ?? 0,
          expiring_first_at: storiesData.expiring_first_at ?? null,
        });
      }
      setLoading(false);
      setStoriesLoading(false);
    }).catch(() => {
      setLoading(false);
      setStoriesLoading(false);
    });
  }, []);

  // Build stat cards from fetched data
  const statCards = stats
    ? [
        {
          label: "Contas Conectadas",
          value: String(stats.accounts.total),
          change:
            stats.accounts.this_month > 0
              ? `+${stats.accounts.this_month} este mês`
              : "Nenhuma este mês",
          up: stats.accounts.this_month > 0 ? true : null,
          icon: Instagram,
          color: "from-pink-500 to-rose-600",
          glow: "rgba(244,63,94,0.3)",
        },
        {
          label: "Vídeos Baixados",
          value: String(stats.videos.total),
          change:
            stats.videos.this_week > 0
              ? `+${stats.videos.this_week} esta semana`
              : "Nenhum esta semana",
          up: stats.videos.this_week > 0 ? true : null,
          icon: Download,
          color: "from-violet-500 to-purple-600",
          glow: "rgba(139,92,246,0.3)",
        },
        {
          label: "Postagens Agendadas",
          value: String(stats.scheduled.pending),
          change: nextPostIn(stats.scheduled.next_at),
          up: null,
          icon: CalendarCheck,
          color: "from-cyan-500 to-blue-600",
          glow: "rgba(6,182,212,0.3)",
        },
        {
          label: "Posts Publicados",
          value: String(stats.published.total),
          change:
            stats.published.total > 0 ? "Total publicado" : "Nenhum ainda",
          up: stats.published.total > 0 ? true : null,
          icon: TrendingUp,
          color: "from-emerald-500 to-teal-600",
          glow: "rgba(16,185,129,0.3)",
        },
      ]
    : null;

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="space-y-6 max-w-7xl"
    >
      {/* Stats grid — 4 main cards */}
      <motion.div
        variants={stagger}
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        {loading || !statCards
          ? Array.from({ length: 4 }).map((_, i) => (
              <motion.div key={i} variants={fadeUp}>
                <StatSkeleton />
              </motion.div>
            ))
          : statCards.map((stat, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="glass-card p-5 group hover:border-white/20 transition-all duration-300 relative overflow-hidden"
                style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.07)" }}
              >
                <div
                  className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 blur-2xl"
                  style={{ background: stat.glow }}
                />
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center group-hover:scale-110 transition-transform`}
                  >
                    <stat.icon className="w-4.5 h-4.5 text-white" size={18} />
                  </div>
                  {stat.up !== null && (
                    <span className="flex items-center gap-0.5 text-xs font-medium text-emerald-400">
                      <ArrowUpRight size={12} />
                    </span>
                  )}
                </div>
                <div className="text-2xl font-black text-white mb-0.5">
                  {stat.value}
                </div>
                <div className="text-xs text-white/40 font-medium">
                  {stat.label}
                </div>
                <div className="text-[10px] text-white/25 mt-1">
                  {stat.change}
                </div>
              </motion.div>
            ))}
      </motion.div>

      {/* Stories Ativos card — full width strip */}
      <motion.div variants={fadeUp}>
        {storiesLoading ? (
          <div className="glass-card p-5 animate-pulse flex items-center gap-5">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-32 rounded bg-white/10" />
              <div className="h-2.5 w-48 rounded bg-white/[0.06]" />
            </div>
            <div className="h-8 w-14 rounded-lg bg-white/10 flex-shrink-0" />
          </div>
        ) : (
          <div
            className="glass-card p-5 relative overflow-hidden group hover:border-white/20 transition-all duration-300"
            style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.07)" }}
          >
            {/* Glow */}
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-10 blur-2xl bg-amber-500 pointer-events-none" />

            <div className="flex items-center gap-5">
              {/* Icon */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(245,158,11,0.25)]">
                <Clapperboard className="text-white" size={20} />
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/40 font-medium mb-0.5">
                  Stories Ativos
                </p>
                <p className="text-[11px] text-white/25 truncate">
                  {stories.total === 0
                    ? "Nenhum story ativo no momento"
                    : storyExpiresIn(stories.expiring_first_at)}
                </p>
              </div>

              {/* Count */}
              <div className="flex-shrink-0 text-right">
                <span className="text-3xl font-black text-white leading-none">
                  {stories.total}
                </span>
                <p className="text-[10px] text-white/25 mt-0.5">
                  {stories.total === 1 ? "story" : "stories"}
                </p>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <motion.div variants={fadeUp} className="lg:col-span-2 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white/90">Atividade Recente</h2>
            <button className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
              Ver tudo
            </button>
          </div>

          {loading ? (
            <div className="space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0"
                >
                  <div className="w-7 h-7 rounded-lg bg-white/10 flex-shrink-0" />
                  <div className="flex-1 h-3.5 rounded bg-white/10" />
                  <div className="w-14 h-3 rounded bg-white/[0.06] flex-shrink-0" />
                </div>
              ))}
            </div>
          ) : !stats || stats.recent_activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-white/25">
              <Clock size={28} className="mb-2 opacity-40" />
              <p className="text-sm">Nenhuma atividade recente</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stats.recent_activity.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                  className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0"
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      item.status === "success"
                        ? "bg-emerald-500/15"
                        : "bg-red-500/15"
                    }`}
                  >
                    {item.status === "success" ? (
                      <CheckCircle2 size={14} className="text-emerald-400" />
                    ) : (
                      <AlertCircle size={14} className="text-red-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/70 truncate">{item.text}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-white/25 flex-shrink-0">
                    <Clock size={10} />
                    {timeAgo(item.created_at)}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Upcoming Posts */}
        <motion.div variants={fadeUp} className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white/90">Próximas Postagens</h2>
            {!loading && stats && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                {stats.scheduled.pending} agendadas
              </span>
            )}
            {loading && (
              <div className="w-16 h-4 rounded-full bg-white/10 animate-pulse" />
            )}
          </div>

          {loading ? (
            <div className="space-y-3 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2.5 rounded-xl"
                >
                  <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-24 rounded bg-white/10" />
                    <div className="h-2.5 w-16 rounded bg-white/[0.06]" />
                  </div>
                </div>
              ))}
            </div>
          ) : !stats || stats.upcoming_posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-white/25">
              <CalendarCheck size={28} className="mb-2 opacity-40" />
              <p className="text-sm">Nenhuma postagem agendada</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stats.upcoming_posts.map((post, i) => {
                const { label, time } = formatScheduled(post.scheduled_at);
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.06 }}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <div
                      className={`w-10 h-10 rounded-lg bg-gradient-to-br ${post.gradient} flex items-center justify-center flex-shrink-0`}
                    >
                      <Play size={14} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white/80 truncate">
                        @{post.account_username}
                      </p>
                      <p className="text-[10px] text-white/30">
                        {label} às {time}
                      </p>
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* Quick actions */}
      <motion.div variants={fadeUp} className="glass-card p-5">
        <h2 className="font-semibold text-white/90 mb-4">Ações Rápidas</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Pesquisar Reels",
              href: "/dashboard/search",
              icon: "🔍",
              desc: "Scraping de perfil",
            },
            {
              label: "Ver Biblioteca",
              href: "/dashboard/library",
              icon: "📁",
              desc: "Seus vídeos",
            },
            {
              label: "Agendar Post",
              href: "/dashboard/schedule",
              icon: "📅",
              desc: "Múltiplas contas",
            },
            {
              label: "Adicionar Conta",
              href: "/dashboard/accounts",
              icon: "➕",
              desc: "Conectar Instagram",
            },
          ].map((action, i) => (
            <motion.a
              key={i}
              href={action.href}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-violet-500/30 hover:bg-violet-600/5 transition-all cursor-pointer text-center"
            >
              <span className="text-2xl">{action.icon}</span>
              <div>
                <p className="text-xs font-medium text-white/80">
                  {action.label}
                </p>
                <p className="text-[10px] text-white/30">{action.desc}</p>
              </div>
            </motion.a>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
