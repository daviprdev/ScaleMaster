"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart2,
  Heart,
  MessageCircle,
  Eye,
  Play,
  Share2,
  Bookmark,
  RefreshCw,
  CheckCircle2,
  Instagram,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface Summary {
  total_published: number;
  total_likes: number;
  total_comments: number;
  total_reach: number;
  total_plays: number;
  total_shares: number;
  total_saved: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
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

const ACCOUNT_COLORS = [
  "from-violet-500 to-purple-600",
  "from-pink-500 to-rose-600",
  "from-cyan-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
];

function accountColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return ACCOUNT_COLORS[Math.abs(hash) % ACCOUNT_COLORS.length];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 flex items-start gap-4">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", color)}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-xs text-white/40 mb-0.5">{label}</p>
        {loading ? (
          <div className="h-6 w-16 rounded bg-white/10 animate-pulse" />
        ) : (
          <p className="text-xl font-bold text-white">{value}</p>
        )}
      </div>
    </div>
  );
}

function PostRow({
  post,
  onRefresh,
  refreshing,
}: {
  post: AnalyticsPost;
  onRefresh: (id: string) => void;
  refreshing: boolean;
}) {
  const account = post.instagram_accounts;
  const video = post.videos_library;
  const hasInsights =
    post.insights_likes !== null ||
    post.insights_comments !== null ||
    post.insights_reach !== null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-4"
    >
      {/* Thumbnail */}
      <div className="flex-shrink-0">
        {video?.public_url ? (
          <video
            src={video.public_url}
            className="w-14 h-20 sm:w-10 sm:h-14 rounded-xl object-cover bg-black/40"
            muted
          />
        ) : (
          <div
            className={cn(
              "w-14 h-20 sm:w-10 sm:h-14 rounded-xl bg-gradient-to-br",
              account ? accountColor(account.username) : "from-gray-600 to-gray-700",
              "flex items-center justify-center"
            )}
          >
            <Instagram size={16} className="text-white/60" />
          </div>
        )}
      </div>

      {/* Account + date */}
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
              <div
                className={cn(
                  "w-6 h-6 rounded-full bg-gradient-to-br text-[9px] font-bold text-white flex items-center justify-center",
                  accountColor(account.username)
                )}
              >
                {account.username[0].toUpperCase()}
              </div>
            )}
            <span className="text-sm font-medium text-white/80">@{account.username}</span>
          </div>
        ) : (
          <p className="text-sm text-white/40 mb-1">Conta removida</p>
        )}
        <p className="text-xs text-white/35">{timeAgo(post.published_at)}</p>
        {post.media_id && (
          <p className="text-[10px] text-white/20 font-mono mt-0.5 truncate max-w-[130px]">
            {post.media_id}
          </p>
        )}
      </div>

      {/* Caption */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/50 line-clamp-2">
          {post.caption || <span className="italic">Sem legenda</span>}
        </p>
      </div>

      {/* Metrics grid */}
      <div className="flex-shrink-0 grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { icon: Heart, label: "Curtidas", value: post.insights_likes, color: "text-pink-400" },
          { icon: MessageCircle, label: "Comentários", value: post.insights_comments, color: "text-cyan-400" },
          { icon: Eye, label: "Alcance", value: post.insights_reach, color: "text-violet-400" },
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

      {/* Refresh button */}
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
  const supabase = useMemo(() => createClient(), []);
  void supabase;

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [posts, setPosts] = useState<AnalyticsPost[]>([]);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const _fetchRef = useRef(false);

  const loadData = useCallback(async () => {
    if (_fetchRef.current) return;
    _fetchRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/analytics/summary", { cache: "no-store" });
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      if (!res.ok) throw new Error("Erro ao carregar analytics.");
      const json = (await res.json()) as { summary: Summary; posts: AnalyticsPost[] };
      setSummary(json.summary);
      setPosts(json.posts);
    } catch {
      setToast({ msg: "Erro ao carregar dados de analytics.", ok: false });
    } finally {
      setLoading(false);
      _fetchRef.current = false;
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = useCallback(async (postId: string) => {
    if (refreshingId) return;
    setRefreshingId(postId);
    try {
      const res = await fetch("/api/meta/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: postId }),
      });
      const json = (await res.json()) as { ok?: boolean; metrics?: Record<string, number | null>; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Erro ao buscar métricas.");

      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                insights_likes: json.metrics?.likes ?? p.insights_likes,
                insights_comments: json.metrics?.comments ?? p.insights_comments,
                insights_reach: json.metrics?.reach ?? p.insights_reach,
                insights_plays: json.metrics?.plays ?? p.insights_plays,
                insights_shares: json.metrics?.shares ?? p.insights_shares,
                insights_saved: json.metrics?.saved ?? p.insights_saved,
                insights_fetched_at: new Date().toISOString(),
              }
            : p
        )
      );

      // Update summary totals
      setSummary((prev) => {
        if (!prev || !json.metrics) return prev;
        const old = posts.find((p) => p.id === postId);
        const diff = (field: keyof typeof json.metrics, oldVal: number | null) =>
          (json.metrics![field] ?? 0) - (oldVal ?? 0);
        return {
          ...prev,
          total_likes: prev.total_likes + diff("likes", old?.insights_likes ?? null),
          total_comments: prev.total_comments + diff("comments", old?.insights_comments ?? null),
          total_reach: prev.total_reach + diff("reach", old?.insights_reach ?? null),
          total_plays: prev.total_plays + diff("plays", old?.insights_plays ?? null),
          total_shares: prev.total_shares + diff("shares", old?.insights_shares ?? null),
          total_saved: prev.total_saved + diff("saved", old?.insights_saved ?? null),
        };
      });

      setToast({ msg: "Métricas atualizadas!", ok: true });
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : "Erro ao atualizar.", ok: false });
    } finally {
      setRefreshingId(null);
      setTimeout(() => setToast(null), 4000);
    }
  }, [refreshingId, posts]);

  const handleRefreshAll = useCallback(async () => {
    const publishedWithMedia = posts.filter((p) => p.media_id);
    for (const p of publishedWithMedia) {
      await handleRefresh(p.id);
    }
  }, [posts, handleRefresh]);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Desempenho dos Posts</h2>
          <p className="text-sm text-white/35">
            {loading ? "Carregando..." : `${summary?.total_published ?? 0} posts publicados`}
          </p>
        </div>
        {!loading && posts.length > 0 && (
          <button
            onClick={handleRefreshAll}
            disabled={!!refreshingId}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium
              bg-white/[0.06] border border-white/10 text-white/60
              hover:text-white hover:bg-white/[0.10] transition-all disabled:opacity-40"
          >
            <RefreshCw size={13} className={refreshingId ? "animate-spin" : ""} />
            Atualizar todos
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatCard label="Publicados" value={fmt(summary?.total_published ?? null)} icon={CheckCircle2} color="bg-violet-600/30" loading={loading} />
        <StatCard label="Curtidas" value={fmt(summary?.total_likes ?? null)} icon={Heart} color="bg-pink-600/30" loading={loading} />
        <StatCard label="Comentários" value={fmt(summary?.total_comments ?? null)} icon={MessageCircle} color="bg-cyan-600/30" loading={loading} />
        <StatCard label="Alcance" value={fmt(summary?.total_reach ?? null)} icon={Eye} color="bg-violet-500/30" loading={loading} />
        <StatCard label="Plays" value={fmt(summary?.total_plays ?? null)} icon={Play} color="bg-emerald-600/30" loading={loading} />
        <StatCard label="Shares" value={fmt(summary?.total_shares ?? null)} icon={Share2} color="bg-amber-600/30" loading={loading} />
        <StatCard label="Salvos" value={fmt(summary?.total_saved ?? null)} icon={Bookmark} color="bg-blue-600/30" loading={loading} />
      </div>

      {/* Note about advanced metrics */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 text-sm text-amber-300/70">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-amber-400/60" />
        <p>
          <strong>Alcance, Plays, Shares e Salvos</strong> requerem a permissão{" "}
          <code className="text-amber-300 bg-amber-500/10 px-1 rounded">instagram_manage_insights</code> no seu app Meta.
          Curtidas e Comentários funcionam com as permissões atuais.
        </p>
      </div>

      {/* Posts list */}
      {loading ? (
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
          <p className="text-sm text-white/25">
            Publique posts via Postagens → as métricas aparecerão aqui
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              onRefresh={handleRefresh}
              refreshing={refreshingId === p.id}
            />
          ))}
        </div>
      )}

      {/* Empty advanced metrics hint */}
      {!loading && posts.length > 0 && posts.every((p) => p.insights_likes === null) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm text-white/40">
          <TrendingUp size={15} className="flex-shrink-0" />
          <p>Clique em <strong>Atualizar</strong> em cada post para buscar as métricas da Meta API.</p>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn(
              "fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-medium",
              toast.ok
                ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                : "bg-red-500/20 border border-red-500/30 text-red-300"
            )}
          >
            {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
