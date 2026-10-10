"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  CalendarClock,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Trash2,
  RotateCcw,
  X,
  AlertCircle,
  Instagram,
  CalendarRange,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type PostStatus = "pending" | "publishing" | "published" | "failed" | "cancelled";

interface ScheduledPost {
  id: string;
  video_id: string | null;
  video_url: string | null;
  caption: string | null;
  scheduled_at: string;
  status: PostStatus;
  error_message: string | null;
  published_at: string | null;
  media_id: string | null;
  created_at: string;
  instagram_accounts: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  videos_library: {
    filename: string;
    public_url: string;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "from-[#00498D] to-[#00346D]",
  "from-pink-500 to-rose-600",
  "from-[#85B9E9] to-[#00498D]",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-fuchsia-500 to-purple-600",
];

function avatarGradient(username: string) {
  let hash = 0;
  for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function relativeTime(iso: string, future = false): string {
  const diff = future
    ? new Date(iso).getTime() - Date.now()
    : Date.now() - new Date(iso).getTime();
  if (diff < 0) return future ? "vencido" : "agora";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return future ? "em instantes" : "agora";
  if (m < 60) return future ? `em ${m}min` : `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return future ? `em ${h}h` : `${h}h atrás`;
  const d = Math.floor(h / 24);
  return future ? `em ${d}d` : `${d}d atrás`;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<PostStatus, { label: string; color: string }> = {
  pending:    { label: "Pendente",      color: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  publishing: { label: "Publicando...", color: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  published:  { label: "Publicado",     color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  failed:     { label: "Falha",         color: "bg-red-500/15 text-red-400 border-red-500/20" },
  cancelled:  { label: "Cancelado",     color: "bg-white/[0.05] text-white/20 border-white/[0.06]" },
};

function StatusIcon({ status }: { status: PostStatus }) {
  if (status === "publishing") return <Loader2 size={10} className="animate-spin flex-shrink-0" />;
  if (status === "published")  return <CheckCircle2 size={10} className="flex-shrink-0" />;
  if (status === "failed")     return <XCircle size={10} className="flex-shrink-0" />;
  if (status === "cancelled")  return <X size={10} className="flex-shrink-0" />;
  return <Clock size={10} className="flex-shrink-0" />;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type FilterKey = "all" | PostStatus;

const TAB_KEYS: FilterKey[] = ["all", "pending", "publishing", "published", "failed", "cancelled"];
const TAB_LABELS: Record<FilterKey, string> = {
  all: "Todos", pending: "Pendentes", publishing: "Publicando",
  published: "Publicados", failed: "Com falha", cancelled: "Cancelados",
};

// ── PostRow ───────────────────────────────────────────────────────────────────

function PostRow({
  post,
  onCancel,
  onRetry,
  onDelete,
  actionId,
}: {
  post: ScheduledPost;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  actionId: string | null;
}) {
  const account = post.instagram_accounts;
  const cfg = STATUS_CONFIG[post.status];
  const busy = actionId === post.id;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className="glass-card rounded-xl p-4 flex items-start gap-4"
    >
      {/* Thumbnail 9:16 */}
      <div
        className={cn(
          "w-10 rounded-lg flex-shrink-0 bg-gradient-to-br",
          account ? avatarGradient(account.username) : "from-[#00498D] to-[#00346D]"
        )}
        style={{ aspectRatio: "9/16" }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/85 truncate">
              @{account?.username ?? "—"}
            </p>
            {post.caption && (
              <p className="text-xs text-white/35 mt-0.5 line-clamp-1 leading-snug">
                {post.caption}
              </p>
            )}
          </div>

          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border flex-shrink-0",
            cfg.color
          )}>
            <StatusIcon status={post.status} />
            {cfg.label}
          </span>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-[11px] text-white/30">
          <span className="flex items-center gap-1">
            <CalendarClock size={10} className="flex-shrink-0" />
            {formatDate(post.scheduled_at)}
          </span>
          {post.status === "pending" && (
            <span className={cn(
              new Date(post.scheduled_at) < new Date() ? "text-red-400/70" : "text-amber-400/70"
            )}>
              {relativeTime(post.scheduled_at, true)}
            </span>
          )}
          {post.status === "published" && post.published_at && (
            <span className="text-emerald-400/60">
              publicado {relativeTime(post.published_at)}
            </span>
          )}
          {post.media_id && (
            <span className="font-mono text-white/15">#{post.media_id.slice(-8)}</span>
          )}
        </div>

        {/* Error box */}
        {post.status === "failed" && post.error_message && (
          <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-red-500/8 border border-red-500/15">
            <p className="text-[11px] text-red-400/80 line-clamp-2 leading-snug">
              {post.error_message}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 mt-2.5">
          {post.status === "pending" && (
            <button
              onClick={() => onCancel(post.id)}
              disabled={busy}
              className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors disabled:opacity-40"
            >
              {busy ? <Loader2 size={9} className="animate-spin" /> : <X size={9} />}
              Cancelar
            </button>
          )}
          {post.status === "failed" && (
            <button
              onClick={() => onRetry(post.id)}
              disabled={busy}
              className="flex items-center gap-1 text-[11px] text-amber-400/70 hover:text-amber-400 transition-colors disabled:opacity-40"
            >
              {busy ? <Loader2 size={9} className="animate-spin" /> : <RotateCcw size={9} />}
              Reagendar
            </button>
          )}
          {(post.status === "cancelled" || post.status === "failed" || post.status === "published") && (
            <button
              onClick={() => onDelete(post.id)}
              disabled={busy}
              className="flex items-center gap-1 text-[11px] text-red-400/40 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              {busy ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
              Remover
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function RowSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4 flex items-start gap-4 animate-pulse">
      <div className="w-10 rounded-lg bg-white/[0.06] flex-shrink-0" style={{ aspectRatio: "9/16" }} />
      <div className="flex-1 space-y-2 pt-1">
        <div className="flex justify-between">
          <div className="h-3 bg-white/[0.07] rounded-full w-28" />
          <div className="h-4 bg-white/[0.05] rounded-full w-20" />
        </div>
        <div className="h-2.5 bg-white/[0.04] rounded-full w-48" />
        <div className="h-2.5 bg-white/[0.04] rounded-full w-36" />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [actionId, setActionId] = useState<string | null>(null);
  const _actionRef = useRef<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const fetchPosts = useCallback(async () => {
    const { data } = await supabase
      .from("scheduled_posts")
      .select(
        "id, video_id, video_url, caption, scheduled_at, status, error_message, published_at, media_id, created_at, " +
        "instagram_accounts(username, display_name, avatar_url), " +
        "videos_library(filename, public_url)"
      )
      .order("scheduled_at", { ascending: true });
    setPosts((data ?? []) as unknown as ScheduledPost[]);
  }, [supabase]);

  // Carga inicial
  useEffect(() => {
    setLoading(true);
    fetchPosts().finally(() => setLoading(false));
  }, [fetchPosts]);

  // Auto-refresh a cada 15s enquanto houver posts em 'publishing'
  useEffect(() => {
    const hasPublishing = posts.some(p => p.status === "publishing");
    if (!hasPublishing) return;
    const id = setInterval(fetchPosts, 15_000);
    return () => clearInterval(id);
  }, [posts, fetchPosts]);

  // Contadores por status
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: posts.length, pending: 0, publishing: 0, published: 0, failed: 0, cancelled: 0 };
    for (const p of posts) c[p.status]++;
    return c;
  }, [posts]);

  // Posts filtrados
  const filtered = useMemo(
    () => filter === "all" ? posts : posts.filter(p => p.status === filter),
    [posts, filter]
  );

  const handleCancel = useCallback(async (id: string) => {
    if (_actionRef.current) return;
    _actionRef.current = id;
    setActionId(id);
    try {
      await supabase
        .from("scheduled_posts")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("status", "pending");
      setPosts(prev => prev.map(p => p.id === id ? { ...p, status: "cancelled" as PostStatus } : p));
    } finally {
      _actionRef.current = null;
      setActionId(null);
    }
  }, [supabase]);

  const handleRetry = useCallback(async (id: string) => {
    if (_actionRef.current) return;
    _actionRef.current = id;
    setActionId(id);
    try {
      await supabase
        .from("scheduled_posts")
        .update({ status: "pending", error_message: null })
        .eq("id", id)
        .eq("status", "failed");
      setPosts(prev => prev.map(p => p.id === id ? { ...p, status: "pending" as PostStatus, error_message: null } : p));
    } finally {
      _actionRef.current = null;
      setActionId(null);
    }
  }, [supabase]);

  const handleDelete = useCallback(async (id: string) => {
    if (_actionRef.current) return;
    _actionRef.current = id;
    setActionId(id);
    try {
      await supabase.from("scheduled_posts").delete().eq("id", id);
      setPosts(prev => prev.filter(p => p.id !== id));
    } finally {
      _actionRef.current = null;
      setActionId(null);
    }
  }, [supabase]);

  return (
    <div className="space-y-6">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Agendamentos</h1>
          <p className="text-sm text-white/35 mt-0.5">
            {counts.all} total · {counts.pending} pendente{counts.pending !== 1 ? "s" : ""} · {counts.published} publicado{counts.published !== 1 ? "s" : ""}
            {counts.failed > 0 && <span className="text-red-400/70"> · {counts.failed} com falha</span>}
          </p>
        </div>
        <a href="/dashboard/posts" className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5">
          <CalendarRange size={15} />
          Novo agendamento
        </a>
      </motion.div>

      {/* Filter tabs */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1 flex-wrap">
        {TAB_KEYS.map(key => {
          const count = counts[key];
          if (key !== "all" && count === 0) return null;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors",
                filter === key
                  ? "bg-[#00498D]/25 text-[#AFBDD0] border border-[#00498D]/30"
                  : "text-white/35 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"
              )}
            >
              {TAB_LABELS[key]}
              {count > 0 && (
                <span className={cn(
                  "text-[10px] px-1.5 py-px rounded-full",
                  filter === key ? "bg-[#00498D]/30 text-[#AFBDD0]" : "bg-white/[0.06] text-white/30"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </motion.div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <RowSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card rounded-2xl flex flex-col items-center gap-4 py-20 text-center px-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            {filter === "all"
              ? <CalendarClock size={24} className="text-white/20" />
              : <AlertCircle size={24} className="text-white/20" />
            }
          </div>
          <div className="space-y-1">
            <p className="text-white/40 text-sm font-medium">
              {filter === "all" ? "Nenhum post agendado" : `Nenhum post ${TAB_LABELS[filter].toLowerCase()}`}
            </p>
            {filter === "all" && (
              <p className="text-white/20 text-xs max-w-xs">
                Crie agendamentos em massa na página Postagens para preencher sua fila.
              </p>
            )}
          </div>
          {filter === "all" && (
            <a href="/dashboard/posts" className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2">
              <CalendarRange size={14} /> Criar agendamentos
            </a>
          )}
        </motion.div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map(post => (
              <PostRow
                key={post.id}
                post={post}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onDelete={handleDelete}
                actionId={actionId}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Nota: auto-refresh ativo */}
      <AnimatePresence>
        {posts.some(p => p.status === "publishing") && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="flex items-center gap-2 text-xs text-blue-400/70"
          >
            <Loader2 size={11} className="animate-spin" />
            Atualizando automaticamente enquanto há posts sendo publicados...
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
