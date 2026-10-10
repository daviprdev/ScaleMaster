"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  BarChart2, Heart, MessageCircle, Eye, Play, Share2,
  Bookmark, RefreshCw, CheckCircle2, Instagram, TrendingUp,
  AlertCircle, Users, Zap, Trophy, Loader2, ChevronDown,
  ArrowUpRight, ArrowDownRight, Minus, BarChart as BarChartIcon,
  Clock, Film,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ── Chart theme (recharts doesn't read CSS vars) ──────────────────────────────
const MATRIX   = "#00498D";
const ELECTRIC = "#85B9E9";
const GRID     = "rgba(255,255,255,0.04)";
const AXIS_CLR = "rgba(255,255,255,0.22)";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountItem {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  followers_count: number | null;
  folder_id: string | null;
}

interface FolderItem { id: string; name: string; }

interface ChartPoint {
  date: string;
  label: string;
  followers: number;
  posts: number;
}

interface Kpi {
  followers_now: number;
  followers_30d_ago: number;
  followers_growth: number;
  followers_growth_pct: number;
  posts_30d: number;
  reach_30d: number;
  days_with_data: number;
}

interface TopVideo {
  id: string;
  caption: string | null;
  video_url: string | null;
  plays: number;
  reach: number | null;
  likes: number | null;
  published_at: string | null;
  account_username?: string;
}

interface GrowthData {
  accounts: AccountItem[];
  folders: FolderItem[];
  chart_data: ChartPoint[];
  kpi: Kpi;
  top_videos: TopVideo[];
  days: number;
}

interface AnalyticsPost {
  id: string;
  published_at: string | null;
  media_id: string | null;
  caption: string | null;
  video_url: string | null;
  insights_likes: number | null;
  insights_comments: number | null;
  insights_reach: number | null;
  insights_plays: number | null;
  insights_shares: number | null;
  insights_saved: number | null;
  insights_fetched_at: string | null;
  instagram_accounts: { username: string; display_name: string | null; avatar_url: string | null } | null;
  videos_library: { filename: string; public_url: string } | null;
}

interface PostSummary {
  total_published: number; total_likes: number; total_comments: number;
  total_reach: number; total_plays: number; total_shares: number; total_saved: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("pt-BR");
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora mesmo";
  if (mins < 60) return `há ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `há ${days}d`;
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

const ACC_COLORS = [
  "from-[#00498D] to-emerald-600",
  "from-[#85B9E9] to-blue-600",
  "from-[#00498D] to-[#00346D]",
  "from-pink-500 to-rose-600",
  "from-amber-500 to-orange-600",
];
function accountGradient(u: string) {
  let h = 0;
  for (let i = 0; i < u.length; i++) h = u.charCodeAt(i) + ((h << 5) - h);
  return ACC_COLORS[Math.abs(h) % ACC_COLORS.length];
}

// ── Custom Recharts Tooltip ───────────────────────────────────────────────────

function CustomTooltip({
  active, payload, label, valueKey, valueLabel, valueFmt,
}: {
  active?: boolean;
  payload?: { value: number; color: string }[];
  label?: string;
  valueKey?: string;
  valueLabel?: string;
  valueFmt?: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className="px-3 py-2 rounded-xl bg-black/90 border border-white/10 text-xs backdrop-blur-xl shadow-xl">
      <p className="text-white/40 mb-1">{label}</p>
      <p style={{ color: payload[0]?.color ?? MATRIX }} className="font-bold">
        {valueLabel ?? valueKey ?? ""}: {valueFmt ? valueFmt(v) : v.toLocaleString("pt-BR")}
      </p>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, delta, deltaLabel, icon: Icon, accent, loading,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  icon: React.ElementType;
  accent: string;
  loading: boolean;
}) {
  const isPositive = (delta ?? 0) > 0;
  const isNeutral  = (delta ?? 0) === 0;

  return (
    <div className={cn("glass-card p-5 relative overflow-hidden border", accent)}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
      <div className="relative space-y-3">
        <div className="flex items-center justify-between">
          <Icon size={14} className="text-white/30" />
          {delta !== undefined && !loading && (
            <div className={cn(
              "flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
              isPositive ? "text-emerald-400 bg-emerald-500/10" :
              isNeutral  ? "text-white/30 bg-white/5" :
                           "text-red-400 bg-red-500/10"
            )}>
              {isPositive ? <ArrowUpRight size={10} /> : isNeutral ? <Minus size={10} /> : <ArrowDownRight size={10} />}
              {Math.abs(delta)}%
            </div>
          )}
        </div>
        {loading ? (
          <div className="space-y-1.5">
            <div className="h-7 w-20 rounded bg-white/8 animate-pulse" />
            <div className="h-3 w-14 rounded bg-white/5 animate-pulse" />
          </div>
        ) : (
          <div>
            <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
            <p className="text-[10px] text-white/35 mt-0.5">{sub ?? label}</p>
            {deltaLabel && delta !== undefined && (
              <p className="text-[10px] text-white/20 mt-0.5">{deltaLabel}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Account Avatar ────────────────────────────────────────────────────────────

function AccountAvatar({ username, size = "sm" }: { username: string; size?: "sm" | "md" }) {
  return (
    <div className={cn(
      "rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-white flex-shrink-0",
      accountGradient(username),
      size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs"
    )}>
      {username.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyGrowthState({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-12 flex flex-col items-center text-center"
    >
      <div className="w-16 h-16 rounded-2xl bg-[var(--matrix)]/8 border border-[var(--matrix)]/15 flex items-center justify-center mb-5">
        <BarChartIcon size={26} className="text-[var(--matrix)]/50" />
      </div>
      <p className="text-white/70 font-semibold text-base mb-2">Coletando dados...</p>
      <p className="text-sm text-white/30 max-w-xs leading-relaxed mb-6">
        Os gráficos de crescimento estarão disponíveis após a primeira sincronização.
        Geralmente ocorre automaticamente às 2h UTC — ou clique abaixo para iniciar agora.
      </p>
      <button
        onClick={onSync}
        disabled={syncing}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[var(--matrix)]/30 bg-[var(--matrix)]/8 text-[var(--matrix)] text-sm font-semibold hover:bg-[var(--matrix)]/15 transition-all disabled:opacity-50"
      >
        {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {syncing ? "Sincronizando..." : "Iniciar coleta de dados"}
      </button>
    </motion.div>
  );
}

// ── Post Row (existing analytics) ─────────────────────────────────────────────

function PostRow({
  post, onRefresh, refreshing,
}: {
  post: AnalyticsPost; onRefresh: (id: string) => void; refreshing: boolean;
}) {
  const account = post.instagram_accounts;
  const video   = post.videos_library;
  const hasInsights = post.insights_likes !== null || post.insights_reach !== null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-4"
    >
      <div className="flex-shrink-0">
        {video?.public_url ? (
          <video src={video.public_url} className="w-14 h-20 sm:w-10 sm:h-14 rounded-xl object-cover bg-black/40" muted />
        ) : (
          <div className={cn(
            "w-14 h-20 sm:w-10 sm:h-14 rounded-xl bg-gradient-to-br flex items-center justify-center",
            account ? accountGradient(account.username) : "from-gray-600 to-gray-700"
          )}>
            <Instagram size={16} className="text-white/60" />
          </div>
        )}
      </div>

      <div className="flex-shrink-0 min-w-[130px]">
        {account ? (
          <div className="flex items-center gap-2 mb-1">
            {account.avatar_url ? (
              <img
                src={`/api/proxy-image?url=${encodeURIComponent(account.avatar_url)}`}
                alt={account.username}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <AccountAvatar username={account.username} size="sm" />
            )}
            <span className="text-sm font-medium text-white/80">@{account.username}</span>
          </div>
        ) : (
          <p className="text-sm text-white/40 mb-1">Conta removida</p>
        )}
        <p className="text-xs text-white/35">{timeAgo(post.published_at)}</p>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/50 line-clamp-2">
          {post.caption || <span className="italic">Sem legenda</span>}
        </p>
      </div>

      <div className="flex-shrink-0 grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { icon: Heart, label: "Curtidas", value: post.insights_likes, color: "text-pink-400" },
          { icon: MessageCircle, label: "Comentários", value: post.insights_comments, color: "text-[#85B9E9]" },
          { icon: Eye, label: "Alcance", value: post.insights_reach, color: "text-[#85B9E9]" },
          { icon: Play, label: "Plays", value: post.insights_plays, color: "text-emerald-400" },
          { icon: Share2, label: "Shares", value: post.insights_shares, color: "text-amber-400" },
          { icon: Bookmark, label: "Salvos", value: post.insights_saved, color: "text-blue-400" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="flex flex-col items-center gap-0.5 min-w-[40px]">
            <Icon size={13} className={cn(value !== null ? color : "text-white/15")} />
            <span className={cn("text-xs font-semibold", value !== null ? "text-white/80" : "text-white/20")}>
              {fmt(value)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        <button
          onClick={() => onRefresh(post.id)}
          disabled={refreshing || !post.media_id}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
            refreshing
              ? "bg-white/5 text-white/30 cursor-not-allowed"
              : "bg-white/[0.07] text-white/60 hover:bg-white/[0.12] hover:text-white border border-white/10"
          )}
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Buscando..." : "Atualizar"}
        </button>
        {hasInsights && post.insights_fetched_at && (
          <p className="text-[10px] text-white/20">{timeAgo(post.insights_fetched_at)}</p>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const _supabase = useMemo(() => createClient(), []);
  void _supabase;

  // Tab
  const [tab, setTab] = useState<"growth" | "posts">("growth");

  // Growth tab state
  const [growthData, setGrowthData] = useState<GrowthData | null>(null);
  const [growthLoading, setGrowthLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);

  // Posts tab state
  const [postsLoading, setPostsLoading] = useState(false);
  const [postSummary, setPostSummary] = useState<PostSummary | null>(null);
  const [posts, setPosts] = useState<AnalyticsPost[]>([]);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [postToast, setPostToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [postsLoaded, setPostsLoaded] = useState(false);

  // ── Load growth data ────────────────────────────────────────────────────────
  const loadGrowth = useCallback(async () => {
    setGrowthLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAccountId) params.set("account_id", selectedAccountId);
      if (selectedFolderId)  params.set("folder_id", selectedFolderId);
      const res = await fetch(`/api/analytics/growth?${params.toString()}`, { cache: "no-store" });
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      if (res.ok) setGrowthData(await res.json() as GrowthData);
    } catch { /* silent */ }
    finally { setGrowthLoading(false); }
  }, [selectedAccountId, selectedFolderId]);

  useEffect(() => { loadGrowth(); }, [loadGrowth]);

  // ── Load posts (lazy — only when tab is opened) ───────────────────────────
  const loadPosts = useCallback(async () => {
    if (postsLoaded) return;
    setPostsLoading(true);
    try {
      const res = await fetch("/api/analytics/summary", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json() as { summary: PostSummary; posts: AnalyticsPost[] };
        setPostSummary(json.summary);
        setPosts(json.posts);
        setPostsLoaded(true);
      }
    } catch { /* silent */ }
    finally { setPostsLoading(false); }
  }, [postsLoaded]);

  useEffect(() => {
    if (tab === "posts") loadPosts();
  }, [tab, loadPosts]);

  // ── Sync ───────────────────────────────────────────────────────────────────
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncToast(null);
    try {
      const res = await fetch("/api/analytics/sync", { method: "POST" });
      const data = await res.json() as { synced?: number; errors?: number };
      setSyncToast(`${data.synced ?? 0} conta(s) sincronizada(s).`);
      await loadGrowth();
    } catch {
      setSyncToast("Erro ao sincronizar.");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncToast(null), 5000);
    }
  }, [loadGrowth]);

  // ── Post refresh ───────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async (postId: string) => {
    if (refreshingId) return;
    setRefreshingId(postId);
    try {
      const res = await fetch("/api/meta/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: postId }),
      });
      const json = await res.json() as { ok?: boolean; metrics?: Record<string, number | null>; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Erro ao buscar métricas.");
      setPosts((prev) => prev.map((p) =>
        p.id !== postId ? p : {
          ...p,
          insights_likes: json.metrics?.likes ?? p.insights_likes,
          insights_comments: json.metrics?.comments ?? p.insights_comments,
          insights_reach: json.metrics?.reach ?? p.insights_reach,
          insights_plays: json.metrics?.plays ?? p.insights_plays,
          insights_shares: json.metrics?.shares ?? p.insights_shares,
          insights_saved: json.metrics?.saved ?? p.insights_saved,
          insights_fetched_at: new Date().toISOString(),
        }
      ));
      setPostToast({ msg: "Métricas atualizadas!", ok: true });
    } catch (err) {
      setPostToast({ msg: err instanceof Error ? err.message : "Erro.", ok: false });
    } finally {
      setRefreshingId(null);
      setTimeout(() => setPostToast(null), 4000);
    }
  }, [refreshingId]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const kpi = growthData?.kpi;
  const hasHistory = (kpi?.days_with_data ?? 0) > 0;

  // Label for the active selector
  const selectorLabel = useMemo(() => {
    if (!growthData) return "Carregando...";
    if (selectedAccountId) {
      const acc = growthData.accounts.find((a) => a.id === selectedAccountId);
      return acc ? `@${acc.username}` : "Conta";
    }
    if (selectedFolderId) {
      const f = growthData.folders.find((f) => f.id === selectedFolderId);
      return f ? `📁 ${f.name}` : "Pasta";
    }
    return `Todas as contas (${growthData.accounts.length})`;
  }, [growthData, selectedAccountId, selectedFolderId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-full">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Desempenho e crescimento das contas automatizadas</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "growth" && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--matrix)]/20 bg-[var(--matrix)]/[0.05] text-xs text-[var(--matrix)]/70 hover:text-[var(--matrix)] hover:border-[var(--matrix)]/40 transition-all disabled:opacity-50"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Sincronizar dados
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit">
        {([
          { key: "growth", label: "Relatório do Chefe", icon: TrendingUp },
          { key: "posts",  label: "Posts Publicados",  icon: BarChart2    },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === key
                ? "bg-[var(--matrix)]/15 text-[var(--matrix)] border border-[var(--matrix)]/20"
                : "text-white/40 hover:text-white/70"
            )}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB 1 — Relatório do Chefe                                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === "growth" && (
        <div className="space-y-6">

          {/* Account / Folder Selector */}
          <div className="relative w-fit">
            <button
              onClick={() => setSelectorOpen((o) => !o)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/70 hover:text-white hover:border-white/20 transition-all"
            >
              <Users size={14} className="text-white/40" />
              <span>{selectorLabel}</span>
              <ChevronDown size={14} className={cn("text-white/30 transition-transform", selectorOpen && "rotate-180")} />
            </button>

            <AnimatePresence>
              {selectorOpen && growthData && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="absolute top-full mt-2 left-0 z-40 min-w-[220px] glass rounded-xl border border-white/10 shadow-2xl overflow-hidden"
                >
                  <div className="py-1">
                    <button
                      onClick={() => { setSelectedAccountId(null); setSelectedFolderId(null); setSelectorOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors",
                        !selectedAccountId && !selectedFolderId
                          ? "text-[var(--matrix)] bg-[var(--matrix)]/8"
                          : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                      )}
                    >
                      Todas as contas ({growthData.accounts.length})
                    </button>

                    {growthData.folders.length > 0 && (
                      <>
                        <p className="px-4 py-1.5 text-[10px] text-white/25 uppercase tracking-wider">Pastas</p>
                        {growthData.folders.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => { setSelectedFolderId(f.id); setSelectedAccountId(null); setSelectorOpen(false); }}
                            className={cn(
                              "w-full text-left px-4 py-2.5 text-sm transition-colors",
                              selectedFolderId === f.id
                                ? "text-[var(--matrix)] bg-[var(--matrix)]/8"
                                : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                            )}
                          >
                            📁 {f.name}
                          </button>
                        ))}
                      </>
                    )}

                    {growthData.accounts.length > 0 && (
                      <>
                        <p className="px-4 py-1.5 text-[10px] text-white/25 uppercase tracking-wider">Contas</p>
                        {growthData.accounts.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => { setSelectedAccountId(a.id); setSelectedFolderId(null); setSelectorOpen(false); }}
                            className={cn(
                              "w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2",
                              selectedAccountId === a.id
                                ? "text-[var(--matrix)] bg-[var(--matrix)]/8"
                                : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                            )}
                          >
                            <AccountAvatar username={a.username} size="sm" />
                            <div className="min-w-0">
                              <span className="block truncate">@{a.username}</span>
                              {a.followers_count !== null && (
                                <span className="text-[10px] text-white/30">{fmt(a.followers_count)} seguidores</span>
                              )}
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Seguidores"
              value={fmt(kpi?.followers_now ?? null)}
              sub="total atual"
              delta={kpi?.followers_growth_pct}
              deltaLabel={`vs. ${growthData?.days ?? 30} dias atrás`}
              icon={Users}
              accent="border-[var(--matrix)]/15"
              loading={growthLoading}
            />
            <KpiCard
              label="Crescimento"
              value={kpi?.followers_growth !== undefined
                ? `${kpi.followers_growth >= 0 ? "+" : ""}${fmt(kpi.followers_growth)}`
                : "—"}
              sub={`últimos ${growthData?.days ?? 30} dias`}
              icon={TrendingUp}
              accent="border-emerald-500/15"
              loading={growthLoading}
            />
            <KpiCard
              label="Posts Automáticos"
              value={fmt(kpi?.posts_30d ?? null)}
              sub={`últimos ${growthData?.days ?? 30} dias`}
              icon={Zap}
              accent="border-[var(--electric)]/15"
              loading={growthLoading}
            />
            <KpiCard
              label="Alcance Total"
              value={fmt(kpi?.reach_30d ?? null)}
              sub="via Meta Insights"
              icon={Eye}
              accent="border-[#00498D]/15"
              loading={growthLoading}
            />
          </div>

          {/* Growth Chart */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-semibold text-white/90">Crescimento de Seguidores</h2>
                <p className="text-[10px] text-white/30 mt-0.5">
                  {hasHistory
                    ? `${kpi!.days_with_data} dias com dados históricos`
                    : "Aguardando primeira sincronização"}
                </p>
              </div>
              {hasHistory && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: MATRIX }} />
                  <span className="text-[10px] text-white/30">Seguidores</span>
                </div>
              )}
            </div>

            {growthLoading ? (
              <div className="h-52 rounded-xl bg-white/[0.03] animate-pulse" />
            ) : !hasHistory ? (
              <EmptyGrowthState onSync={handleSync} syncing={syncing} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={growthData!.chart_data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="grad-followers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={MATRIX} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={MATRIX} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: AXIS_CLR, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: AXIS_CLR, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)}
                  />
                  <Tooltip
                    content={
                      <CustomTooltip
                        valueLabel="Seguidores"
                        valueFmt={(n) => n.toLocaleString("pt-BR")}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="followers"
                    stroke={MATRIX}
                    strokeWidth={2}
                    fill="url(#grad-followers)"
                    dot={false}
                    activeDot={{ r: 4, fill: MATRIX, stroke: "#000", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Posts per Day Chart */}
          {hasHistory && (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-2 h-2 rounded-full" style={{ background: ELECTRIC }} />
                <h2 className="text-sm font-semibold text-white/90">Posts Automáticos por Dia</h2>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={growthData!.chart_data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: AXIS_CLR, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: AXIS_CLR, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={<CustomTooltip valueLabel="Posts" />}
                  />
                  <Bar
                    dataKey="posts"
                    fill={ELECTRIC}
                    fillOpacity={0.7}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top 3 Videos */}
          {!growthLoading && (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <Trophy size={14} className="text-amber-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white/90">Top 3 Vídeos Mais Vistos</h2>
                  <p className="text-[10px] text-white/30">por número de plays registrados</p>
                </div>
              </div>

              {!growthData?.top_videos.length ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <Film size={24} className="text-white/15 mb-3" />
                  <p className="text-sm text-white/30">Nenhum vídeo com dados de plays ainda</p>
                  <p className="text-xs text-white/20 mt-1">
                    Clique em &quot;Atualizar&quot; nos posts da aba Posts Publicados para buscar métricas
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {growthData.top_videos.map((video, i) => (
                    <motion.div
                      key={video.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.08 }}
                      className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.025] border border-white/[0.05] hover:bg-white/[0.04] transition-colors"
                    >
                      {/* Rank */}
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0",
                        i === 0 ? "bg-amber-500/20 text-amber-400" :
                        i === 1 ? "bg-white/8 text-white/50" :
                                  "bg-white/5 text-white/30"
                      )}>
                        #{i + 1}
                      </div>

                      {/* Thumbnail/icon */}
                      <div className="w-10 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-black/40">
                        {video.video_url ? (
                          <video src={video.video_url} className="w-full h-full object-cover" muted />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Film size={14} className="text-white/20" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/70 line-clamp-1 font-medium">
                          {video.caption || "Sem legenda"}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          {video.account_username && (
                            <span className="text-[10px] text-white/30">@{video.account_username}</span>
                          )}
                          <span className="text-[10px] text-white/20">{timeAgo(video.published_at)}</span>
                        </div>
                      </div>

                      {/* Metrics */}
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="text-center">
                          <p className="text-sm font-bold text-emerald-400">{fmt(video.plays)}</p>
                          <p className="text-[10px] text-white/25">plays</p>
                        </div>
                        {video.reach !== null && (
                          <div className="text-center hidden sm:block">
                            <p className="text-sm font-bold text-[#85B9E9]">{fmt(video.reach)}</p>
                            <p className="text-[10px] text-white/25">alcance</p>
                          </div>
                        )}
                        {video.likes !== null && (
                          <div className="text-center hidden sm:block">
                            <p className="text-sm font-bold text-pink-400">{fmt(video.likes)}</p>
                            <p className="text-[10px] text-white/25">curtidas</p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Per-account current stats table */}
          {!growthLoading && (growthData?.accounts.length ?? 0) > 1 && (
            <div className="glass-card p-5">
              <h2 className="text-sm font-semibold text-white/90 mb-4">Seguidores por Conta</h2>
              <div className="space-y-2">
                {growthData!.accounts
                  .sort((a, b) => (b.followers_count ?? 0) - (a.followers_count ?? 0))
                  .map((acc) => {
                    const maxFollowers = Math.max(...growthData!.accounts.map((a) => a.followers_count ?? 0), 1);
                    const pct = Math.round(((acc.followers_count ?? 0) / maxFollowers) * 100);
                    return (
                      <div key={acc.id} className="flex items-center gap-3">
                        <AccountAvatar username={acc.username} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-white/70">@{acc.username}</span>
                            <span className="text-xs text-white/50 tabular-nums">{fmt(acc.followers_count)}</span>
                          </div>
                          <div className="h-1 rounded-full bg-white/[0.05]">
                            <div
                              className="h-1 rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, background: MATRIX }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Sync toast */}
          <AnimatePresence>
            {syncToast && (
              <motion.div
                key="sync-toast"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-medium bg-[var(--matrix)]/15 border border-[var(--matrix)]/30 text-[var(--matrix)]"
              >
                <CheckCircle2 size={15} />
                {syncToast}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* TAB 2 — Posts Publicados                                           */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {tab === "posts" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/35">
              {postsLoading ? "Carregando..." : `${postSummary?.total_published ?? 0} posts publicados`}
            </p>
            {!postsLoading && posts.length > 0 && (
              <button
                onClick={() => posts.filter((p) => p.media_id).forEach((p) => handleRefresh(p.id))}
                disabled={!!refreshingId}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium bg-white/[0.06] border border-white/10 text-white/60 hover:text-white hover:bg-white/[0.10] transition-all disabled:opacity-40"
              >
                <RefreshCw size={13} className={refreshingId ? "animate-spin" : ""} />
                Atualizar todos
              </button>
            )}
          </div>

          {/* Summary cards */}
          {!postsLoading && postSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
              {[
                { label: "Publicados", value: fmt(postSummary.total_published), icon: CheckCircle2, color: "bg-[#00498D]/30" },
                { label: "Curtidas",   value: fmt(postSummary.total_likes),     icon: Heart,        color: "bg-pink-600/30" },
                { label: "Comentários",value: fmt(postSummary.total_comments),  icon: MessageCircle,color: "bg-cyan-600/30" },
                { label: "Alcance",    value: fmt(postSummary.total_reach),     icon: Eye,          color: "bg-[#00498D]/30" },
                { label: "Plays",      value: fmt(postSummary.total_plays),     icon: Play,         color: "bg-emerald-600/30" },
                { label: "Shares",     value: fmt(postSummary.total_shares),    icon: Share2,       color: "bg-amber-600/30" },
                { label: "Salvos",     value: fmt(postSummary.total_saved),     icon: Bookmark,     color: "bg-blue-600/30" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="glass-card rounded-2xl p-5 flex items-start gap-4">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", color)}>
                    <Icon size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-white/40 mb-0.5">{label}</p>
                    <p className="text-xl font-bold text-white">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 text-sm text-amber-300/70">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-amber-400/60" />
            <p>
              <strong>Alcance, Plays, Shares e Salvos</strong> requerem a permissão{" "}
              <code className="text-amber-300 bg-amber-500/10 px-1 rounded">instagram_manage_insights</code> no seu app Meta.
            </p>
          </div>

          {postsLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-4">
                <BarChart2 size={28} className="text-white/20" />
              </div>
              <p className="text-white/50 font-medium mb-1">Nenhum post publicado ainda</p>
              <p className="text-sm text-white/25">Publique posts via Postagens → as métricas aparecerão aqui</p>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((p) => (
                <PostRow key={p.id} post={p} onRefresh={handleRefresh} refreshing={refreshingId === p.id} />
              ))}
            </div>
          )}

          {!postsLoading && posts.length > 0 && posts.every((p) => p.insights_likes === null) && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm text-white/40">
              <TrendingUp size={15} className="flex-shrink-0" />
              <p>Clique em <strong>Atualizar</strong> em cada post para buscar as métricas da Meta API.</p>
            </div>
          )}

          {/* Post toast */}
          <AnimatePresence>
            {postToast && (
              <motion.div
                key="post-toast"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className={cn(
                  "fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-medium",
                  postToast.ok
                    ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                    : "bg-red-500/20 border border-red-500/30 text-red-300"
                )}
              >
                {postToast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                {postToast.msg}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

    </div>
  );
}
