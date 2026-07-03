"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, CalendarDays, Send, X, Check,
  Loader2, AlertCircle, CheckCircle2, Clock, Shuffle,
  Zap, ChevronDown, ImagePlay, BarChart2, RefreshCw, Trash2,
  Upload, Image, Film, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  folder_id: string | null;
  account_folders: { name: string } | null;
}

interface UploadedMedia {
  id: string;               // local UUID para key React
  file: File;
  previewUrl: string;       // object URL para preview local
  url: string | null;       // URL Supabase após upload
  media_type: "image" | "video";
  storage_path: string | null;
  status: "uploading" | "done" | "error";
  error?: string;
  duration?: number;        // segundos (apenas vídeos)
}

interface Campaign {
  campaign_id: string;
  total: number;
  published: number;
  pending: number;
  failed: number;
  cancelled: number;
  first_slot: string;
  last_slot: string;
  next_pending: string | null;
  last_published_at: string | null;
  last_error_message: string | null;
  account_ids: string[];
  campaign_status: "running" | "completed";
  created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function campTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

function campTimeIn(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Math.floor((new Date(dateStr).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "aguardando cron";
  if (diff < 60) return `em ${diff}s`;
  if (diff < 3600) return `em ${Math.floor(diff / 60)}min`;
  return `em ${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}min`;
}

const POSTS_PER_DAY_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24, 36, 48, 72];
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "video/mp4", "video/quicktime"];
const MAX_VIDEO_DURATION = 60; // segundos

async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => resolve(0);
    video.src = URL.createObjectURL(file);
  });
}

// ── SectionCard / SectionLabel ─────────────────────────────────────────────

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("glass-card p-5 rounded-2xl", className)}>{children}</div>;
}

function SectionLabel({ Icon, children }: { Icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={14} className="text-white/35" />
      <span className="text-xs font-semibold uppercase tracking-widest text-white/35">{children}</span>
    </div>
  );
}

// ── MediaPreviewCard ───────────────────────────────────────────────────────

function MediaPreviewCard({ item, onRemove }: { item: UploadedMedia; onRemove: () => void }) {
  const isVideo = item.media_type === "video";
  const sizeLabel = item.file.size < 1024 * 1024
    ? `${(item.file.size / 1024).toFixed(0)} KB`
    : `${(item.file.size / 1024 / 1024).toFixed(1)} MB`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.88 }}
      transition={{ duration: 0.15 }}
      className="relative group rounded-xl overflow-hidden border border-white/10 bg-black/30"
      style={{ aspectRatio: "9/16" }}
    >
      {/* Thumbnail */}
      {isVideo ? (
        <video
          src={item.previewUrl}
          className="w-full h-full object-cover"
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.previewUrl}
          alt={item.file.name}
          className="w-full h-full object-cover"
        />
      )}

      {/* Overlay on hover */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Top badges */}
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
        <span className={cn(
          "flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold",
          isVideo ? "bg-[#00E5FF]/20 text-[#00E5FF]" : "bg-[#00FF41]/20 text-[#00FF41]"
        )}>
          {isVideo ? <Film size={8} /> : <Image size={8} />}
          {isVideo ? "MP4" : item.file.name.split(".").pop()?.toUpperCase()}
        </span>
        {isVideo && item.duration && (
          <span className="px-1.5 py-0.5 rounded-md text-[9px] bg-black/60 text-white/60">
            {Math.round(item.duration)}s
          </span>
        )}
      </div>

      {/* Status overlay */}
      {item.status === "uploading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-1.5">
            <Loader2 size={18} className="animate-spin text-[#00E5FF]" />
            <span className="text-[9px] text-white/60">Enviando…</span>
          </div>
        </div>
      )}
      {item.status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/60">
          <div className="flex flex-col items-center gap-1 px-2 text-center">
            <XCircle size={18} className="text-red-400" />
            <span className="text-[9px] text-red-300 leading-tight">{item.error ?? "Falha"}</span>
          </div>
        </div>
      )}
      {item.status === "done" && (
        <div className="absolute top-1.5 right-1.5">
          <div className="w-5 h-5 rounded-full bg-[#00FF41]/20 border border-[#00FF41]/40 flex items-center justify-center">
            <Check size={10} className="text-[#00FF41]" strokeWidth={3} />
          </div>
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 hover:bg-red-500/30 transition-all"
      >
        <Trash2 size={10} />
      </button>

      {/* Bottom filename */}
      <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1"
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.75))" }}>
        <p className="text-[9px] text-white/50 truncate">{sizeLabel}</p>
      </div>
    </motion.div>
  );
}

// ── UploadZone ─────────────────────────────────────────────────────────────

function UploadZone({
  mediaItems,
  onAdd,
  onRemove,
}: {
  mediaItems: UploadedMedia[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => ACCEPTED_TYPES.includes(f.type));
    if (arr.length) onAdd(arr);
  }, [onAdd]);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all select-none",
          "py-10 px-6",
          dragging
            ? "border-[#00E5FF]/60 bg-[#00E5FF]/5 scale-[1.01]"
            : "border-white/15 bg-white/[0.02] hover:border-[#00E5FF]/40 hover:bg-[#00E5FF]/[0.03]"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.mp4"
          multiple
          className="hidden"
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />

        <div className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
          dragging ? "bg-[#00E5FF]/20" : "bg-white/[0.06]"
        )}>
          <Upload size={22} className={dragging ? "text-[#00E5FF]" : "text-white/30"} />
        </div>

        <div className="text-center">
          <p className={cn("text-sm font-medium transition-colors", dragging ? "text-[#00E5FF]" : "text-white/60")}>
            {dragging ? "Solte aqui para adicionar" : "Clique ou arraste para escolher"}
          </p>
          <p className="text-xs text-white/25 mt-1">JPG, PNG, MP4 (máx. 60s)</p>
        </div>

        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{ boxShadow: "inset 0 0 0 2px rgba(0,229,255,0.4)" }}
          />
        )}
      </div>

      {/* Preview grid */}
      <AnimatePresence>
        {mediaItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-white/40">
                <span className="text-[#00E5FF] font-semibold">{mediaItems.filter(m => m.status === "done").length}</span>
                /{mediaItems.length} pronto{mediaItems.length !== 1 ? "s" : ""}
              </span>
              {mediaItems.length > 1 && (
                <button
                  onClick={() => mediaItems.forEach(m => onRemove(m.id))}
                  className="text-[10px] text-white/25 hover:text-red-400 transition-colors"
                >
                  Remover todos
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
              <AnimatePresence>
                {mediaItems.map(item => (
                  <MediaPreviewCard key={item.id} item={item} onRemove={() => onRemove(item.id)} />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── StoriesPreview ─────────────────────────────────────────────────────────

function StoriesPreview({
  itemCount,
  totalAccounts,
  postsPerDay,
  startDatetime,
}: {
  itemCount: number;
  totalAccounts: number;
  postsPerDay: number;
  startDatetime: string;
}) {
  const intervalMinutes = Math.floor((24 * 60) / Math.max(1, postsPerDay));
  const days = itemCount > 0 ? Math.ceil(itemCount / Math.max(1, postsPerDay)) : 0;
  const totalPosts = itemCount * Math.max(1, totalAccounts);
  const isReady = itemCount > 0 && totalAccounts > 0 && startDatetime;

  return (
    <div className="glass-card rounded-2xl p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Zap size={14} className="text-[#00E5FF]" />
        <span className="text-xs font-semibold uppercase tracking-widest text-white/40">Resumo</span>
      </div>

      {!isReady ? (
        <p className="text-white/20 text-xs text-center py-4">Preencha os campos para ver o resumo</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Mídias/conta", value: itemCount, color: "text-[#00E5FF]" },
              { label: "Contas", value: totalAccounts, color: "text-[#00FF41]" },
              { label: "Total stories", value: totalPosts, color: "text-white" },
              { label: "Duração", value: `${days}d`, color: "text-white" },
              { label: "Por dia", value: postsPerDay, color: "text-white/60" },
              { label: "Intervalo", value: intervalMinutes >= 60 ? `${Math.floor(intervalMinutes / 60)}h` : `${intervalMinutes}min`, color: "text-white/60" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/[0.03] rounded-xl px-3 py-2.5 border border-white/[0.06]">
                <p className="text-white/35 text-[10px] uppercase tracking-wider">{label}</p>
                <p className={cn("font-mono font-semibold text-base mt-0.5", color)}>{value}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-between text-[10px]">
            <span className="text-white/30 uppercase tracking-wider">Início</span>
            <span className="text-[#00FF41] font-mono">{formatDatetime(startDatetime)}</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#00E5FF]/5 border border-[#00E5FF]/20">
            <Shuffle size={12} className="text-[#00E5FF] flex-shrink-0" />
            <p className="text-[10px] text-[#00E5FF]/80">Ordem aleatória única por conta</p>
          </div>
        </>
      )}

      {/* Phone mockup */}
      <div className="flex justify-center pt-1">
        <div className="relative w-[80px] h-[142px] rounded-[16px] border-2 border-white/15 bg-black/60 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
            <div className="w-5 h-1 rounded-full bg-white/20" />
            <div className="flex gap-0.5">
              {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full bg-white/25" />)}
            </div>
          </div>
          <div className="flex-1 mx-1 mb-1 rounded-[10px] overflow-hidden relative"
            style={{ background: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)" }}>
            <div className="absolute top-1 left-1 right-1 flex gap-0.5">
              {[1,2,3,4].map(i => (
                <div key={i} className="flex-1 h-[3px] rounded-full bg-white/25 overflow-hidden">
                  <div className={cn("h-full rounded-full bg-white", i === 1 ? "w-2/3" : "w-0")} />
                </div>
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <ImagePlay size={20} className="text-white/20" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CampaignsList ──────────────────────────────────────────────────────────

function StoriesCampaignsList({ accounts, onCreateNew }: { accounts: Account[]; onCreateNew: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const fetchCampaigns = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res = await fetch("/api/campaigns?post_type=story");
      const d = await res.json() as { campaigns: Campaign[] };
      setCampaigns(d.campaigns ?? []);
    } catch {/* silent */} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.campaign_status === "running");
    if (!hasRunning) return;
    const t = setInterval(() => fetchCampaigns(true), 15_000);
    return () => clearInterval(t);
  }, [campaigns, fetchCampaigns]);
  useEffect(() => { const t = setInterval(() => setTick(v => v + 1), 10_000); return () => clearInterval(t); }, []);
  void tick;

  const accountMap = useMemo(() => { const m = new Map<string, Account>(); accounts.forEach(a => m.set(a.id, a)); return m; }, [accounts]);

  const handleDelete = async (campaignId: string) => {
    if (confirmDelete !== campaignId) {
      setConfirmDelete(campaignId);
      setTimeout(() => setConfirmDelete(c => c === campaignId ? null : c), 3000);
      return;
    }
    setDeletingId(campaignId); setConfirmDelete(null);
    try { await fetch(`/api/campaigns?id=${encodeURIComponent(campaignId)}&hard=true`, { method: "DELETE" }); await fetchCampaigns(true); }
    finally { setDeletingId(null); }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 size={24} className="animate-spin text-[#00E5FF]" /></div>;

  if (campaigns.length === 0) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-4">
        <ImagePlay size={24} className="text-white/15" />
      </div>
      <p className="text-white/30 text-sm mb-1">Nenhuma campanha de stories</p>
      <p className="text-white/15 text-xs mb-5">Crie sua primeira distribuição</p>
      <button onClick={onCreateNew} className="px-5 py-2.5 rounded-xl bg-[#00E5FF]/10 text-[#00E5FF] text-sm font-medium hover:bg-[#00E5FF]/20 transition-all border border-[#00E5FF]/20">
        Nova Distribuição
      </button>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-white/30">{campaigns.length} campanha{campaigns.length !== 1 ? "s" : ""}</span>
        <button onClick={() => fetchCampaigns(true)} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.07] text-xs text-white/40 hover:text-[#00E5FF] transition-all disabled:opacity-40">
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>
      {campaigns.map(campaign => {
        const progress = campaign.total > 0 ? Math.round((campaign.published / campaign.total) * 100) : 0;
        const isRunning = campaign.campaign_status === "running";
        const isDeleting = deletingId === campaign.campaign_id;
        const isConfirming = confirmDelete === campaign.campaign_id;
        const campAccounts = campaign.account_ids.map(id => accountMap.get(id)).filter(Boolean) as Account[];
        const hasFailed = campaign.failed > 0;
        const isOverdue = isRunning && campaign.next_pending != null && new Date(campaign.next_pending) < new Date();

        let statusLabel: string, statusCls: string, statusBorder: string, dotCls: string, dotPulse = false;
        if (!isRunning) { statusLabel = "Concluída"; statusCls = "bg-[#00FF41]/10 text-[#00FF41]"; statusBorder = "border-[#00FF41]/20"; dotCls = "bg-[#00FF41]"; }
        else if (isOverdue) { statusLabel = "Atrasada"; statusCls = "bg-amber-500/10 text-amber-400"; statusBorder = "border-amber-500/20"; dotCls = "bg-amber-400"; dotPulse = true; }
        else { statusLabel = "Na Fila"; statusCls = "bg-[#00E5FF]/10 text-[#00E5FF]"; statusBorder = "border-[#00E5FF]/20"; dotCls = "bg-[#00E5FF]"; }

        return (
          <motion.div key={campaign.campaign_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
            className={cn("glass-card rounded-2xl p-5 space-y-4 border", isOverdue ? "border-amber-500/15" : hasFailed && !isRunning ? "border-red-500/15" : isRunning ? "border-[#00E5FF]/10" : "border-white/[0.08]")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={cn("w-2 h-2 rounded-full shrink-0", dotCls, dotPulse && "animate-pulse")} />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white/60 font-mono text-xs">#{campaign.campaign_id.slice(0, 8).toUpperCase()}</p>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-[#00E5FF]/10 text-[#00E5FF]/70 border border-[#00E5FF]/15">STORY</span>
                  </div>
                  <p className="text-white/25 text-[10px]">Criada {formatDatetime(campaign.created_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border", statusCls, statusBorder)}>
                  {statusLabel === "Concluída" && <CheckCircle2 size={9} />}
                  {statusLabel === "Na Fila" && <Clock size={9} />}
                  {statusLabel === "Atrasada" && <AlertCircle size={9} />}
                  {statusLabel}
                </span>
                <button onClick={() => handleDelete(campaign.campaign_id)} disabled={isDeleting}
                  className={cn("w-7 h-7 rounded-lg border flex items-center justify-center transition-all",
                    isConfirming ? "bg-red-500/15 border-red-500/40 text-red-400" : "bg-white/[0.04] border-white/[0.08] text-white/25 hover:text-red-400",
                    isDeleting && "opacity-40 cursor-not-allowed")}>
                  {isDeleting ? <Loader2 size={11} className="animate-spin" /> : isConfirming ? <Check size={11} /> : <Trash2 size={11} />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-white/40">{campaign.published} de {campaign.total} stories</span>
                <span className={cn("font-bold", progress >= 100 ? "text-[#00FF41]" : "text-[#00E5FF]")}>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.7, ease: "easeOut" }}
                  className="h-full rounded-full bg-gradient-to-r from-[#00E5FF]/70 to-[#00FF41]/70" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[10px]">
              {[
                { label: "Fila", value: campaign.pending, cls: campaign.pending > 0 ? "text-[#00E5FF]" : "text-white/20" },
                { label: "Falhas", value: campaign.failed, cls: hasFailed ? "text-red-400" : "text-white/20" },
                { label: "Cancelados", value: campaign.cancelled, cls: "text-white/25" },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <span className="text-white/25 text-[9px] uppercase tracking-wider">{label}</span>
                  <span className={cn("font-bold tabular-nums", cls)}>{value}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                <span className="text-white/25 text-[9px] uppercase tracking-wider">Último</span>
                <span className={cn("font-medium", campaign.last_published_at ? "text-[#00FF41]" : "text-white/20")}>{campTimeAgo(campaign.last_published_at)}</span>
              </div>
              <div className={cn("flex flex-col gap-0.5 px-3 py-2 rounded-xl border", isOverdue ? "bg-amber-500/[0.04] border-amber-500/15" : "bg-white/[0.03] border-white/[0.04]")}>
                <span className="text-white/25 text-[9px] uppercase tracking-wider">{isRunning ? "Próximo" : "Fim"}</span>
                {isRunning
                  ? <span className={cn("font-medium", isOverdue ? "text-amber-400" : "text-[#00E5FF]")}>{campTimeIn(campaign.next_pending)}</span>
                  : <span className="font-medium text-white/25 text-[10px]">{formatDatetime(campaign.last_slot)}</span>}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
              <div className="flex -space-x-1.5">
                {campAccounts.slice(0, 6).map(acc => (
                  acc.avatar_url
                    ? <img key={acc.id} src={acc.avatar_url} alt={acc.username} className="w-5 h-5 rounded-full border border-black object-cover" />
                    : <div key={acc.id} className="w-5 h-5 rounded-full border border-black bg-gradient-to-br from-[#00E5FF]/30 to-[#00FF41]/30 flex items-center justify-center"><span className="text-[7px] font-bold text-black">{acc.username.charAt(0).toUpperCase()}</span></div>
                ))}
                {campaign.account_ids.length > 6 && (
                  <div className="w-5 h-5 rounded-full border border-black bg-white/10 flex items-center justify-center">
                    <span className="text-[7px] text-white/40">+{campaign.account_ids.length - 6}</span>
                  </div>
                )}
              </div>
              <span className="text-white/25 text-[10px]">{campaign.account_ids.length} conta{campaign.account_ids.length !== 1 ? "s" : ""}</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function StoriesPage() {
  const [activeTab, setActiveTab] = useState<"create" | "campaigns">("create");

  // Media upload
  const [mediaItems, setMediaItems] = useState<UploadedMedia[]>([]);

  // Accounts
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Distribution
  const [postsPerDay, setPostsPerDay] = useState<number>(3);
  const [startDatetime, setStartDatetime] = useState("");
  const [accountStaggerSeconds, setAccountStaggerSeconds] = useState<number | null>(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    total_posts: number; items_per_account: number; days: number; accounts: number; first_slot: string;
  } | null>(null);

  const minDatetime = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/accounts/list");
      const d = await res.json() as { accounts: Account[] };
      setAccounts((d.accounts ?? []).filter(a => a.is_active));
    } finally { setLoadingAccounts(false); }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // ── Upload handler ─────────────────────────────────────────────────────────

  const handleAddFiles = useCallback(async (files: File[]) => {
    const newItems: UploadedMedia[] = [];

    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const previewUrl = URL.createObjectURL(file);
      let duration: number | undefined;

      if (isVideo) {
        duration = await getVideoDuration(file);
        if (duration > MAX_VIDEO_DURATION) {
          // Mostra item com erro de duração mas não faz upload
          const errItem: UploadedMedia = {
            id: crypto.randomUUID(),
            file,
            previewUrl,
            url: null,
            media_type: "video",
            storage_path: null,
            status: "error",
            error: `Vídeo muito longo (${Math.round(duration)}s). Máx. 60s.`,
            duration,
          };
          newItems.push(errItem);
          continue;
        }
      }

      const item: UploadedMedia = {
        id: crypto.randomUUID(),
        file,
        previewUrl,
        url: null,
        media_type: isVideo ? "video" : "image",
        storage_path: null,
        status: "uploading",
        duration,
      };
      newItems.push(item);
    }

    setMediaItems(prev => [...prev, ...newItems]);

    // Upload em paralelo para todos os itens válidos
    for (const item of newItems.filter(i => i.status === "uploading")) {
      const formData = new FormData();
      formData.append("file", item.file);

      try {
        const res = await fetch("/api/stories/upload", { method: "POST", body: formData });
        const data = await res.json() as { url?: string; media_type?: string; storage_path?: string; error?: string };
        if (!res.ok || data.error) {
          setMediaItems(prev => prev.map(m => m.id === item.id
            ? { ...m, status: "error", error: data.error ?? "Falha no upload" }
            : m
          ));
        } else {
          setMediaItems(prev => prev.map(m => m.id === item.id
            ? { ...m, url: data.url!, storage_path: data.storage_path!, status: "done" }
            : m
          ));
        }
      } catch {
        setMediaItems(prev => prev.map(m => m.id === item.id
          ? { ...m, status: "error", error: "Erro de conexão" }
          : m
        ));
      }
    }
  }, []);

  const handleRemoveMedia = useCallback((id: string) => {
    setMediaItems(prev => {
      const item = prev.find(m => m.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(m => m.id !== id);
    });
  }, []);

  // ── Computed ───────────────────────────────────────────────────────────────

  const readyItems = mediaItems.filter(m => m.status === "done");
  const hasUploading = mediaItems.some(m => m.status === "uploading");

  const accountsByFolder = useMemo(() => {
    const folderMap = new Map<string, { name: string; accounts: Account[] }>();
    const noFolder: Account[] = [];
    for (const acc of accounts) {
      if (acc.folder_id && acc.account_folders) {
        if (!folderMap.has(acc.folder_id)) folderMap.set(acc.folder_id, { name: acc.account_folders.name, accounts: [] });
        folderMap.get(acc.folder_id)!.accounts.push(acc);
      } else { noFolder.push(acc); }
    }
    const groups = Array.from(folderMap.entries()).map(([id, val]) => ({ id, name: val.name, accounts: val.accounts }));
    groups.sort((a, b) => a.name.localeCompare(b.name));
    if (noFolder.length > 0) groups.push({ id: "__no_folder__", name: "Sem pasta", accounts: noFolder });
    return groups;
  }, [accounts]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleAccount = (id: string) =>
    setSelectedAccountIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleFolder = (folderAccounts: Account[]) => {
    const ids = folderAccounts.map(a => a.id);
    const allSelected = ids.every(id => selectedAccountIds.includes(id));
    setSelectedAccountIds(prev => allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  const toggleExpand = (folderId: string) =>
    setExpandedFolders(prev => { const next = new Set(prev); if (next.has(folderId)) next.delete(folderId); else next.add(folderId); return next; });

  const handleSubmit = async () => {
    if (readyItems.length === 0) { setSubmitError("Adicione ao menos 1 mídia."); return; }
    if (hasUploading) { setSubmitError("Aguarde o upload terminar."); return; }
    if (selectedAccountIds.length === 0) { setSubmitError("Selecione ao menos 1 conta."); return; }
    if (!startDatetime) { setSubmitError("Defina a data e hora de início."); return; }

    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/posts/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids: selectedAccountIds,
          media_items: readyItems.map(m => ({ url: m.url!, media_type: m.media_type, storage_path: m.storage_path })),
          posts_per_day: postsPerDay,
          start_at: new Date(startDatetime).toISOString(),
          account_stagger_seconds: accountStaggerSeconds,
        }),
      });

      const data = await res.json() as {
        success?: boolean; error?: string;
        total_posts?: number; items_per_account?: number;
        days?: number; accounts?: number; first_slot?: string;
      };

      if (!res.ok || data.error) { setSubmitError(data.error ?? "Erro ao criar distribuição."); return; }

      // Limpa mídia
      mediaItems.forEach(m => URL.revokeObjectURL(m.previewUrl));
      setMediaItems([]);
      setSelectedAccountIds([]);
      setStartDatetime("");
      setPostsPerDay(3);
      setAccountStaggerSeconds(null);

      setSuccess({
        total_posts: data.total_posts ?? 0,
        items_per_account: data.items_per_account ?? 0,
        days: data.days ?? 0,
        accounts: data.accounts ?? 0,
        first_slot: data.first_slot ?? "",
      });
      setActiveTab("campaigns");
    } catch {
      setSubmitError("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSuccess(null);
    setSubmitError(null);
    mediaItems.forEach(m => URL.revokeObjectURL(m.previewUrl));
    setMediaItems([]);
    setSelectedAccountIds([]);
    setStartDatetime("");
    setPostsPerDay(3);
    setAccountStaggerSeconds(null);
    setActiveTab("create");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="page-title">Postar Stories</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-lg bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20 font-semibold tracking-wide">
            STORIES
          </span>
        </div>
        <p className="page-subtitle">Suba fotos e vídeos e distribua como Stories para múltiplas contas — expira em 24h</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.07] mb-6 gap-1">
        {([
          { id: "create", label: "Nova Distribuição", Icon: ImagePlay },
          { id: "campaigns", label: "Campanhas Ativas", Icon: BarChart2 },
        ] as const).map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={cn("flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
              activeTab === id ? "border-[#00E5FF] text-[#00E5FF]" : "border-transparent text-white/35 hover:text-white/60"
            )}>
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Success banner */}
      <AnimatePresence>
        {success && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-5 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/20">
            <CheckCircle2 size={14} className="text-[#00E5FF] flex-shrink-0" />
            <p className="text-sm text-[#00E5FF] flex-1">
              <span className="font-semibold">{success.total_posts} stories</span> criados —{" "}
              <span className="font-semibold">{success.items_per_account} mídias</span> por conta em{" "}
              <span className="font-semibold">{success.days} dia{success.days !== 1 ? "s" : ""}</span>
              {" · "}Início: {formatDatetime(success.first_slot)}
            </p>
            <button onClick={() => setSuccess(null)} className="text-[#00E5FF]/40 hover:text-[#00E5FF] transition-colors">
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {activeTab === "campaigns" ? (
        <StoriesCampaignsList accounts={accounts} onCreateNew={handleReset} />
      ) : (
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* Form */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* 1. Mídia */}
            <SectionCard>
              <SectionLabel Icon={Upload}>Mídia</SectionLabel>
              <UploadZone mediaItems={mediaItems} onAdd={handleAddFiles} onRemove={handleRemoveMedia} />
            </SectionCard>

            {/* 2. Contas */}
            <SectionCard>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-white/35" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-white/35">Contas</span>
                </div>
                {accounts.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedAccountIds(accounts.map(a => a.id))} className="text-xs text-[#00FF41]/70 hover:text-[#00FF41] transition-colors">Todas</button>
                    <span className="text-white/15 text-xs">·</span>
                    <button onClick={() => setSelectedAccountIds([])} className="text-xs text-white/30 hover:text-white/60 transition-colors">Nenhuma</button>
                  </div>
                )}
              </div>

              {loadingAccounts ? (
                <div className="flex items-center gap-2 text-white/30 text-sm py-2"><Loader2 size={14} className="animate-spin" /> Carregando...</div>
              ) : accounts.length === 0 ? (
                <p className="text-white/25 text-sm py-4 text-center">
                  Nenhuma conta conectada. <a href="/dashboard/accounts" className="text-[#00E5FF] hover:underline">Conectar conta</a>
                </p>
              ) : (
                <div className="space-y-1.5">
                  {accountsByFolder.map(group => {
                    const groupIds = group.accounts.map(a => a.id);
                    const allSelected = groupIds.length > 0 && groupIds.every(id => selectedAccountIds.includes(id));
                    const someSelected = groupIds.some(id => selectedAccountIds.includes(id));
                    const isExpanded = expandedFolders.has(group.id);
                    const isNoFolder = group.id === "__no_folder__";
                    return (
                      <div key={group.id}>
                        <div
                          className={cn("flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all cursor-pointer group",
                            isExpanded
                              ? allSelected ? "border-[#00E5FF]/30 bg-[#00E5FF]/5" : someSelected ? "border-[#00E5FF]/20 bg-[#00E5FF]/3" : "border-white/12 bg-white/[0.03]"
                              : allSelected ? "border-[#00E5FF]/25 bg-[#00E5FF]/4" : someSelected ? "border-[#00E5FF]/15" : "border-white/[0.07] bg-white/[0.02] hover:border-white/12"
                          )}
                          onClick={() => toggleExpand(group.id)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ChevronDown size={13} className={cn("flex-shrink-0 transition-transform duration-200 text-white/30", isExpanded && "rotate-180")} />
                            <span className="text-sm">{isNoFolder ? "📂" : "📁"}</span>
                            <span className={cn("text-sm font-medium truncate", allSelected ? "text-[#00E5FF]" : someSelected ? "text-[#00E5FF]/70" : "text-white/60 group-hover:text-white/80")}>
                              {group.name}
                            </span>
                            <span className="text-xs text-white/25 font-mono flex-shrink-0">({group.accounts.length})</span>
                            {someSelected && (
                              <span className="text-[10px] text-white/30 flex-shrink-0">· {groupIds.filter(id => selectedAccountIds.includes(id)).length} sel.</span>
                            )}
                          </div>
                          <button type="button" onClick={e => { e.stopPropagation(); toggleFolder(group.accounts); }}
                            className={cn("flex-shrink-0 text-[10px] px-2.5 py-1 rounded-lg border transition-all ml-2",
                              allSelected ? "border-[#00E5FF]/30 text-[#00E5FF]/70" : "border-white/[0.08] text-white/30 hover:border-[#00E5FF]/30 hover:text-[#00E5FF]/60"
                            )}>
                            {allSelected ? "desmarcar" : "selecionar"}
                          </button>
                        </div>
                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                              <div className="flex flex-wrap gap-1.5 pt-2 pl-2 pb-1">
                                {group.accounts.map(acc => {
                                  const isSelected = selectedAccountIds.includes(acc.id);
                                  return (
                                    <button key={acc.id} type="button" onClick={() => toggleAccount(acc.id)}
                                      className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all",
                                        isSelected ? "border-[#00E5FF]/40 bg-[#00E5FF]/8 text-[#00E5FF]" : "border-white/[0.08] text-white/55 hover:border-white/20"
                                      )}>
                                      {acc.avatar_url
                                        ? <img src={acc.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                                        : <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#00E5FF]/40 to-[#00FF41]/40 flex-shrink-0 flex items-center justify-center"><span className="text-[8px] font-bold text-black">{acc.username.charAt(0).toUpperCase()}</span></div>
                                      }
                                      <span className="text-xs font-medium leading-none">@{acc.username}</span>
                                      {isSelected && <Check size={9} className="text-[#00E5FF] flex-shrink-0" strokeWidth={3} />}
                                    </button>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedAccountIds.length > 0 && (
                <p className="mt-3 text-xs text-[#00E5FF]/60 font-mono">
                  {selectedAccountIds.length} conta{selectedAccountIds.length !== 1 ? "s" : ""} selecionada{selectedAccountIds.length !== 1 ? "s" : ""}
                </p>
              )}
            </SectionCard>

            {/* 3. Cadência */}
            <SectionCard>
              <SectionLabel Icon={CalendarDays}>Cadência</SectionLabel>

              <div className="mb-5">
                <p className="text-xs text-white/40 font-medium mb-3 uppercase tracking-wider">Stories por dia por conta</p>
                <div className="flex flex-wrap gap-2">
                  {POSTS_PER_DAY_OPTIONS.map(n => {
                    const mins = Math.floor((24 * 60) / n);
                    const hint = mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}min`;
                    return (
                      <button key={n} onClick={() => setPostsPerDay(n)} title={`Intervalo: ~${hint}`}
                        className={cn("flex flex-col items-center px-3.5 py-2 rounded-xl border transition-all",
                          postsPerDay === n ? "bg-[#00E5FF]/15 text-[#00E5FF] border-[#00E5FF]/30" : "bg-white/[0.04] text-white/40 border-white/[0.07] hover:border-white/20 hover:text-white/70"
                        )}>
                        <span className="text-sm font-bold leading-none">{n}</span>
                        <span className="text-[9px] opacity-50 mt-0.5 leading-none">{hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs text-white/40 font-medium mb-3 uppercase tracking-wider">Data e hora do primeiro story</p>
                <input type="datetime-local" value={startDatetime} min={minDatetime} onChange={e => setStartDatetime(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm focus:outline-none focus:border-[#00E5FF]/40 focus:ring-1 focus:ring-[#00E5FF]/20 transition-all [color-scheme:dark]" />
              </div>

              <div className="mt-5">
                <p className="text-xs text-white/40 font-medium mb-3 uppercase tracking-wider">Intervalo entre contas</p>
                <div className="space-y-3 p-4 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Auto</span>
                    <span className={cn("text-base font-bold", accountStaggerSeconds ? "text-[#00E5FF]" : "text-white/30")}>
                      {accountStaggerSeconds ? `${accountStaggerSeconds}s` : "Automático"}
                    </span>
                    <span className="text-xs text-white/40">5 min</span>
                  </div>
                  <input type="range" min={0} max={300} step={5} value={accountStaggerSeconds ?? 0}
                    onChange={e => { const v = Number(e.target.value); setAccountStaggerSeconds(v === 0 ? null : v); }}
                    className="range-slider"
                    style={{ background: accountStaggerSeconds
                      ? `linear-gradient(to right, #00E5FF 0%, #00E5FF ${(accountStaggerSeconds / 300) * 100}%, rgba(255,255,255,0.08) ${(accountStaggerSeconds / 300) * 100}%, rgba(255,255,255,0.08) 100%)`
                      : `linear-gradient(to right, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.08) 100%)` }} />
                  <p className="text-[11px] text-white/30 italic">
                    {accountStaggerSeconds ? `${accountStaggerSeconds}s entre cada conta` : "Proporcional ao intervalo (máx. 5 min)"}
                  </p>
                </div>
              </div>

              <AnimatePresence>
                {readyItems.length > 0 && startDatetime && selectedAccountIds.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}
                    className="mt-5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]">
                    {(() => {
                      const days = Math.ceil(readyItems.length / postsPerDay);
                      const totalPosts = readyItems.length * selectedAccountIds.length;
                      return (
                        <p className="text-xs text-white/55 leading-relaxed">
                          <span className="text-[#00E5FF] font-semibold">{readyItems.length}</span> mídias ×{" "}
                          <span className="text-[#00FF41] font-semibold">{selectedAccountIds.length}</span> conta{selectedAccountIds.length !== 1 ? "s" : ""} ={" "}
                          <span className="text-white font-semibold">{totalPosts}</span> stories em{" "}
                          <span className="text-white font-semibold">{days}</span> dia{days !== 1 ? "s" : ""}.
                          {" "}Cada story expira em 24h.
                        </p>
                      );
                    })()}
                  </motion.div>
                )}
              </AnimatePresence>
            </SectionCard>

            {/* Nota */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[#00E5FF]/[0.04] border border-[#00E5FF]/15">
              <ImagePlay size={14} className="text-[#00E5FF]/60 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-white/40 leading-relaxed">
                <span className="text-[#00E5FF]/70 font-medium">Stories não suportam legendas</span> pela API do Instagram.
                Cada story expira automaticamente em 24 horas.
              </p>
            </div>

            {/* Error */}
            <AnimatePresence>
              {submitError && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  {submitError}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button type="button" onClick={handleSubmit} disabled={submitting || hasUploading}
              className={cn("w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-black text-sm transition-all",
                submitting || hasUploading ? "bg-[#00E5FF]/40 cursor-not-allowed" : "bg-[#00E5FF] hover:bg-[#00E5FF]/90 hover:shadow-[0_0_28px_rgba(0,229,255,0.35)]"
              )}>
              {submitting ? (
                <><Loader2 size={16} className="animate-spin text-black/70" /> Criando distribuição...</>
              ) : hasUploading ? (
                <><Loader2 size={16} className="animate-spin text-black/70" /> Aguardando uploads...</>
              ) : (
                <><Send size={16} /> Criar Distribuição de Stories
                  {readyItems.length > 0 && selectedAccountIds.length > 0 && (
                    <span className="ml-1 opacity-70">({readyItems.length * selectedAccountIds.length} stories)</span>
                  )}
                </>
              )}
            </button>
          </div>

          {/* Preview */}
          <div className="w-full lg:w-72 lg:sticky lg:top-8 flex-shrink-0">
            <StoriesPreview
              itemCount={readyItems.length}
              totalAccounts={selectedAccountIds.length}
              postsPerDay={postsPerDay}
              startDatetime={startDatetime}
            />
            <div className="mt-4 glass-card rounded-2xl p-4 space-y-2.5">
              <p className="text-[10px] text-white/25 uppercase tracking-wider">Como funciona</p>
              {[
                { icon: Upload, text: "Suba JPG, PNG ou MP4 (máx. 60s) direto do seu computador" },
                { icon: Shuffle, text: "Cada conta recebe as mídias em ordem aleatória única" },
                { icon: CalendarDays, text: "Stories distribuídos uniformemente ao longo do dia" },
                { icon: ImagePlay, text: "Publicado como Story via Meta API — expira em 24h" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-2">
                  <Icon size={10} className="text-[#00E5FF]/50 mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] text-white/30 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
