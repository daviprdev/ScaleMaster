"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Send, X, Check, Loader2, AlertCircle, CheckCircle2,
  ImagePlay, RefreshCw, Trash2, Upload, Image, Film, XCircle,
  Play, Pause, Download, Sparkles, SlidersHorizontal, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { VideoProcessingSelector, type VideoProcessingMode } from "@/components/dashboard/VideoProcessingSelector";
import { StoryLinkSelector, EMPTY_STORY_LINK, type StoryLinkValue } from "@/components/dashboard/StoryLinkSelector";

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

interface FolderItem {
  id: string;
  name: string;
}

interface UploadedMedia {
  file: File | null;
  previewUrl: string;
  url: string | null;
  media_type: "image" | "video";
  storage_path: string | null;
  status: "uploading" | "done" | "error";
  error?: string;
  duration?: number;
}

interface StoryMediaItem {
  id: string;
  public_url: string;
  storage_path: string;
  media_type: "image" | "video";
  created_at: string;
}

interface HistoryItem {
  id: string;
  account_id: string | null;
  video_url: string | null;
  status: "pending" | "publishing" | "published" | "failed" | "cancelled";
  media_id: string | null;
  error_message: string | null;
  scheduled_at: string;
  created_at: string | null;
  instagram_accounts: { username: string; avatar_url: string | null } | null;
}

interface StoryTemplate {
  id: string;
  media_url: string;
  media_type: "image" | "video";
  interval_minutes: number;
  last_posted_at: string | null;
  last_error: string | null;
  status: "active" | "paused";
  created_at: string;
  source_account_id: string | null;
  instagram_accounts: { username: string } | null;
  story_template_accounts: { account_id: string; instagram_accounts: { username: string; avatar_url: string | null } | null }[];
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

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "video/mp4", "video/quicktime"];
const MAX_VIDEO_DURATION = 60; // segundos

async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => { URL.revokeObjectURL(video.src); resolve(video.duration); };
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

// ── Upload de mídia única ──────────────────────────────────────────────────

function SingleMediaUpload({
  media,
  onAdd,
  onRemove,
}: {
  media: UploadedMedia | null;
  onAdd: (file: File) => void;
  onRemove: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const handleFile = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => ACCEPTED_TYPES.includes(f.type));
    if (arr.length) onAdd(arr[0]);
  }, [onAdd]);

  if (media) {
    const isVideo = media.media_type === "video";
    const sizeLabel = !media.file
      ? "Da biblioteca"
      : media.file.size < 1024 * 1024
        ? `${(media.file.size / 1024).toFixed(0)} KB`
        : `${(media.file.size / 1024 / 1024).toFixed(1)} MB`;

    return (
      <div className="relative group rounded-2xl overflow-hidden border border-white/10 bg-black/30" style={{ aspectRatio: "9/16", maxHeight: 320 }}>
        {isVideo ? (
          <video src={media.previewUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.previewUrl} alt={media.file?.name ?? ""} className="w-full h-full object-cover" />
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold",
            isVideo ? "bg-[#00E5FF]/20 text-[#00E5FF]" : "bg-[#00FF41]/20 text-[#00FF41]"
          )}>
            {isVideo ? <Film size={9} /> : <Image size={9} />}
            {isVideo ? "MP4" : "IMG"}
          </span>
          {isVideo && media.duration && (
            <span className="px-2 py-1 rounded-md text-[10px] bg-black/60 text-white/60">{Math.round(media.duration)}s</span>
          )}
        </div>
        {media.status === "uploading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="flex flex-col items-center gap-1.5">
              <Loader2 size={20} className="animate-spin text-[#00E5FF]" />
              <span className="text-xs text-white/60">Enviando…</span>
            </div>
          </div>
        )}
        {media.status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900/60">
            <div className="flex flex-col items-center gap-1 px-3 text-center">
              <XCircle size={20} className="text-red-400" />
              <span className="text-xs text-red-300 leading-tight">{media.error ?? "Falha"}</span>
            </div>
          </div>
        )}
        {media.status === "done" && (
          <div className="absolute top-2 right-2">
            <div className="w-6 h-6 rounded-full bg-[#00FF41]/20 border border-[#00FF41]/40 flex items-center justify-center">
              <Check size={12} className="text-[#00FF41]" strokeWidth={3} />
            </div>
          </div>
        )}
        <button
          onClick={onRemove}
          className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 hover:bg-red-500/30 transition-all"
        >
          <Trash2 size={12} />
        </button>
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5" style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.75))" }}>
          <p className="text-[10px] text-white/50 truncate">{sizeLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragEnter={e => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
      onDragLeave={e => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); dragCounter.current = 0; setDragging(false); handleFile(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all select-none py-10 px-6",
        dragging ? "border-[#00E5FF]/60 bg-[#00E5FF]/5 scale-[1.01]" : "border-white/15 bg-white/[0.02] hover:border-[#00E5FF]/40 hover:bg-[#00E5FF]/[0.03]"
      )}
    >
      <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.mp4" className="hidden"
        onChange={e => e.target.files && handleFile(e.target.files)} />
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-all", dragging ? "bg-[#00E5FF]/20" : "bg-white/[0.06]")}>
        <Upload size={22} className={dragging ? "text-[#00E5FF]" : "text-white/30"} />
      </div>
      <div className="text-center">
        <p className={cn("text-sm font-medium transition-colors", dragging ? "text-[#00E5FF]" : "text-white/60")}>
          {dragging ? "Solte aqui" : "Clique para escolher"}
        </p>
        <p className="text-xs text-white/25 mt-1">JPG, PNG, MP4 (máx. 60s)</p>
      </div>
    </div>
  );
}

// ── Biblioteca de Mídia ──────────────────────────────────────────────────

function MediaLibrary({
  items, loading, selectedStoragePath, onSelect, onDelete, deletingId,
}: {
  items: StoryMediaItem[];
  loading: boolean;
  selectedStoragePath: string | null;
  onSelect: (item: StoryMediaItem) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6"><Loader2 size={16} className="animate-spin text-[#00E5FF]" /></div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-white/20 text-xs text-center py-4">
        Nada salvo ainda — toda foto/vídeo enviado aqui fica guardado para reusar depois.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
      {items.map(item => {
        const isVideo = item.media_type === "video";
        const isSelected = selectedStoragePath === item.storage_path;
        return (
          <div
            key={item.id}
            onClick={() => onSelect(item)}
            className={cn(
              "relative group rounded-lg overflow-hidden border cursor-pointer bg-black/30 transition-all",
              isSelected ? "border-[#00E5FF]/60 ring-1 ring-[#00E5FF]/40" : "border-white/[0.08] hover:border-white/25"
            )}
            style={{ aspectRatio: "9/16" }}
          >
            {isVideo ? (
              <video src={item.public_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.public_url} alt="" className="w-full h-full object-cover" />
            )}
            <span className="absolute top-1 left-1 w-4 h-4 rounded-md bg-black/60 flex items-center justify-center">
              {isVideo ? <Film size={8} className="text-[#00E5FF]" /> : <Image size={8} className="text-[#00FF41]" />}
            </span>
            {isSelected && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#00E5FF]/90 flex items-center justify-center">
                <Check size={8} className="text-black" strokeWidth={3} />
              </span>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDelete(item.id); }}
              disabled={deletingId === item.id}
              className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 w-5 h-5 rounded-md bg-red-500/70 flex items-center justify-center text-white transition-all"
            >
              {deletingId === item.id ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Histórico ──────────────────────────────────────────────────────────────

function HistoryPanel({
  items, published, queued, loading, onRefresh, refreshing,
  onDeleteItem, deletingId, onClearAll, clearingAll,
}: {
  items: HistoryItem[];
  published: number;
  queued: number;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  onDeleteItem: (id: string) => void;
  deletingId: string | null;
  onClearAll: () => void;
  clearingAll: boolean;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClear = () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); return; }
    setConfirmClear(false);
    onClearAll();
  };

  return (
    <SectionCard className="flex flex-col max-h-[720px]">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-white/35">Histórico</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-1 rounded-lg bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41]/20 font-mono">{published} ok</span>
          <span className="text-[10px] px-2 py-1 rounded-lg bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20 font-mono">{queued} em fila</span>
          <button onClick={onRefresh} disabled={refreshing} className="text-white/30 hover:text-white/60 transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
          {items.length > 0 && (
            <button onClick={handleClear} disabled={clearingAll}
              className={cn("flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-all",
                confirmClear ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/[0.08] text-white/30 hover:text-red-400"
              )}>
              {clearingAll ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
              {confirmClear ? "Confirmar" : "Limpar tudo"}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-[#00E5FF]" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ImagePlay size={22} className="text-white/15 mb-2" />
            <p className="text-white/25 text-xs">Nenhum story postado ainda</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {items.map(item => {
              const isVideo = item.video_url?.match(/\.(mp4|mov)(\?|$)/i);
              let statusCls = "bg-white/10 text-white/40";
              let statusLabel: string = item.status;
              if (item.status === "published") { statusCls = "bg-[#00FF41]/15 text-[#00FF41]"; statusLabel = "Publicado"; }
              else if (item.status === "pending" || item.status === "publishing") { statusCls = "bg-[#00E5FF]/15 text-[#00E5FF]"; statusLabel = item.status === "pending" ? "Na fila" : "Publicando"; }
              else if (item.status === "failed") { statusCls = "bg-red-500/15 text-red-400"; statusLabel = "Falhou"; }
              else { statusCls = "bg-white/10 text-white/30"; statusLabel = "Cancelado"; }

              return (
                <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isVideo ? <Film size={12} className="text-[#00E5FF]/60 flex-shrink-0" /> : <Image size={12} className="text-[#00FF41]/60 flex-shrink-0" />}
                      <span className="text-sm text-white/70 truncate">@{item.instagram_accounts?.username ?? "conta removida"}</span>
                    </div>
                    <span className={cn("text-[9px] px-2 py-0.5 rounded-md font-semibold flex-shrink-0", statusCls)}>{statusLabel}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] text-white/25 truncate">
                        {item.status === "published" ? `Publicado ${timeAgo(item.created_at)}` : formatDatetime(item.scheduled_at)}
                      </p>
                      {item.media_id && <p className="text-[9px] text-white/15 font-mono truncate">ID: {item.media_id}</p>}
                      {item.error_message && <p className="text-[9px] text-red-400/70 truncate">{item.error_message}</p>}
                    </div>
                    <button onClick={() => onDeleteItem(item.id)} disabled={deletingId === item.id}
                      className="text-white/20 hover:text-red-400 transition-colors flex-shrink-0">
                      {deletingId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </SectionCard>
  );
}

// ── Templates de Story ───────────────────────────────────────────────────

function TemplatesSection({
  templates, loading, onImportClick, onToggle, togglingId, onDelete, deletingId,
}: {
  templates: StoryTemplate[];
  loading: boolean;
  onImportClick: () => void;
  onToggle: (t: StoryTemplate) => void;
  togglingId: string | null;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  return (
    <SectionCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <RefreshCw size={14} className="text-white/35" />
          <span className="text-xs font-semibold uppercase tracking-widest text-white/35">Templates de Story</span>
        </div>
        <button onClick={onImportClick} className="btn-primary flex items-center gap-1.5 text-xs px-3 py-2">
          <Download size={12} /> Importar do IG
        </button>
      </div>
      <p className="text-xs text-white/30 mb-4">Importe um story já postado e reposte em loop — mantém o story sempre ativo.</p>

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 size={18} className="animate-spin text-[#00E5FF]" /></div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-white/10 rounded-xl">
          <Sparkles size={18} className="text-white/15 mb-2" />
          <p className="text-white/25 text-xs">Nenhum template ainda. Importe um story ativo de uma conta.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map(t => {
            const isVideo = t.media_type === "video";
            const isActive = t.status === "active";
            return (
              <div key={t.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                <div className="relative bg-black/30" style={{ aspectRatio: "9/16", maxHeight: 160 }}>
                  {isVideo ? (
                    <video src={t.media_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.media_url} alt="" className="w-full h-full object-cover" />
                  )}
                  <span className={cn("absolute top-1.5 left-1.5 text-[9px] px-1.5 py-0.5 rounded-md font-bold",
                    isActive ? "bg-[#00FF41]/20 text-[#00FF41]" : "bg-white/15 text-white/50")}>
                    {isActive ? "Ativo" : "Pausado"}
                  </span>
                </div>
                <div className="p-2.5 space-y-1.5">
                  <p className="text-[10px] text-white/40">De @{t.instagram_accounts?.username ?? "?"} → {t.story_template_accounts.length} conta{t.story_template_accounts.length !== 1 ? "s" : ""}</p>
                  <p className="text-[10px] text-white/25">A cada {t.interval_minutes >= 60 ? `${Math.round(t.interval_minutes / 60)}h` : `${t.interval_minutes}min`}
                    {t.last_posted_at ? ` · último ${timeAgo(t.last_posted_at)}` : " · aguardando 1º ciclo"}</p>
                  {t.last_error && <p className="text-[9px] text-red-400/70 truncate">{t.last_error}</p>}
                  <div className="flex items-center gap-1.5 pt-1">
                    <button onClick={() => onToggle(t)} disabled={togglingId === t.id}
                      className="flex-1 flex items-center justify-center gap-1 text-[10px] px-2 py-1.5 rounded-lg border border-white/[0.08] text-white/50 hover:text-white/80 transition-all">
                      {togglingId === t.id ? <Loader2 size={10} className="animate-spin" /> : isActive ? <Pause size={10} /> : <Play size={10} />}
                      {isActive ? "Pausar" : "Retomar"}
                    </button>
                    <button onClick={() => onDelete(t.id)} disabled={deletingId === t.id}
                      className="px-2 py-1.5 rounded-lg border border-white/[0.08] text-white/30 hover:text-red-400 transition-all">
                      {deletingId === t.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// ── Modal de importação de template ─────────────────────────────────────────

function ImportTemplateModal({
  accounts, storiesMap, onClose, onCreated,
}: {
  accounts: Account[];
  storiesMap: Record<string, { count: number; expiring_first_at?: string | null }> | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<"source" | "targets">("source");
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ media_url: string; media_type: "image" | "video"; source_account_id: string; source_username: string } | null>(null);
  const [targetAccountIds, setTargetAccountIds] = useState<string[]>([]);
  const [intervalMinutes, setIntervalMinutes] = useState(1380);
  const [templateProcessingMode, setTemplateProcessingMode] = useState<VideoProcessingMode>("original");
  const [creating, setCreating] = useState(false);

  const handleImport = async () => {
    if (!sourceAccountId) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/stories/templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: sourceAccountId }),
      });
      const data = await res.json() as { media_url?: string; media_type?: "image" | "video"; source_account_id?: string; source_username?: string; error?: string };
      if (!res.ok || data.error) { setImportError(data.error ?? "Falha ao importar."); return; }
      setImported({ media_url: data.media_url!, media_type: data.media_type!, source_account_id: data.source_account_id!, source_username: data.source_username! });
      setStep("targets");
    } catch {
      setImportError("Erro de conexão.");
    } finally {
      setImporting(false);
    }
  };

  const handleCreate = async () => {
    if (!imported || targetAccountIds.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch("/api/stories/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_url: imported.media_url,
          media_type: imported.media_type,
          source_account_id: imported.source_account_id,
          account_ids: targetAccountIds,
          interval_minutes: intervalMinutes,
          video_processing_mode: templateProcessingMode,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || data.error) { setImportError(data.error ?? "Falha ao criar template."); return; }
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.15 }} className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none">
        <div className="glass rounded-2xl border border-[#00E5FF]/20 w-full max-w-sm p-5 space-y-4 pointer-events-auto max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Importar Template de Story</h3>
            <button onClick={onClose} className="text-white/30 hover:text-white/60"><X size={16} /></button>
          </div>

          {step === "source" ? (
            <>
              <p className="text-xs text-white/40">Escolha a conta que tem o story ativo que você quer manter em loop.</p>
              <div className="max-h-64 overflow-y-auto space-y-1.5">
                {accounts.map(acc => {
                  const withStory = (storiesMap?.[acc.id]?.count ?? 0) > 0;
                  return (
                    <button key={acc.id} onClick={() => setSourceAccountId(acc.id)}
                      className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-left",
                        sourceAccountId === acc.id ? "border-[#00E5FF]/40 bg-[#00E5FF]/8 text-[#00E5FF]" : "border-white/[0.08] text-white/60 hover:border-white/20")}>
                      <span className={cn("relative flex-shrink-0 rounded-full", withStory && "p-[1.5px] bg-gradient-to-tr from-[#00FF41] to-[#00E5FF]")}>
                        {acc.avatar_url
                          ? <img src={acc.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover block" />
                          : <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00E5FF]/40 to-[#00FF41]/40 flex items-center justify-center"><span className="text-[9px] font-bold text-black">{acc.username.charAt(0).toUpperCase()}</span></div>}
                      </span>
                      <span className="text-xs font-medium">@{acc.username}</span>
                      {withStory && <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-[#00FF41]/15 text-[#00FF41] font-semibold">story ativo</span>}
                      {sourceAccountId === acc.id && <Check size={12} className="ml-auto text-[#00E5FF]" />}
                    </button>
                  );
                })}
              </div>
              {imported?.media_type === "video" && (
                <div>
                  <p className="text-xs text-white/40 font-medium mb-2 uppercase tracking-wider">Processamento do vídeo</p>
                  <VideoProcessingSelector
                    value={templateProcessingMode}
                    onChange={setTemplateProcessingMode}
                    compact
                  />
                </div>
              )}
              {importError && (
                <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle size={12} /> {importError}</p>
              )}
              <button onClick={handleImport} disabled={!sourceAccountId || importing}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#00E5FF] text-black font-semibold text-sm disabled:opacity-40 transition-all">
                {importing ? <><Loader2 size={14} className="animate-spin" /> Buscando story ativo…</> : <>Importar</>}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-[#00FF41]">
                <CheckCircle2 size={13} /> Importado de @{imported?.source_username}
              </div>
              <div>
                <p className="text-xs text-white/40 font-medium mb-2 uppercase tracking-wider">Repostar para</p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {accounts.map(acc => {
                    const selected = targetAccountIds.includes(acc.id);
                    return (
                      <button key={acc.id} onClick={() => setTargetAccountIds(prev => selected ? prev.filter(id => id !== acc.id) : [...prev, acc.id])}
                        className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all",
                          selected ? "border-[#00E5FF]/40 bg-[#00E5FF]/8 text-[#00E5FF]" : "border-white/[0.08] text-white/55 hover:border-white/20")}>
                        <span className="text-xs font-medium">@{acc.username}</span>
                        {selected && <Check size={9} className="text-[#00E5FF]" strokeWidth={3} />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-xs text-white/40 font-medium mb-2 uppercase tracking-wider">Repostar a cada</p>
                <div className="flex gap-2">
                  {[
                    { label: "12h", v: 720 }, { label: "18h", v: 1080}, { label: "23h", v: 1380 },
                  ].map(opt => (
                    <button key={opt.v} onClick={() => setIntervalMinutes(opt.v)}
                      className={cn("flex-1 py-2 rounded-lg border text-xs font-semibold transition-all",
                        intervalMinutes === opt.v ? "bg-[#00E5FF]/15 text-[#00E5FF] border-[#00E5FF]/30" : "bg-white/[0.04] text-white/40 border-white/[0.07]")}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {importError && (
                <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle size={12} /> {importError}</p>
              )}
              <button onClick={handleCreate} disabled={targetAccountIds.length === 0 || creating}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#00E5FF] text-black font-semibold text-sm disabled:opacity-40 transition-all">
                {creating ? <><Loader2 size={14} className="animate-spin" /> Criando…</> : <><RefreshCw size={14} /> Criar Loop</>}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function StoriesPage() {
  // Accounts / folders
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  // Media
  const [media, setMedia] = useState<UploadedMedia | null>(null);

  // Biblioteca de Mídia (memória de fotos/vídeos já enviados)
  const [mediaLibrary, setMediaLibrary] = useState<StoryMediaItem[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [deletingLibraryId, setDeletingLibraryId] = useState<string | null>(null);

  // Publish
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Processamento do video (opt-in). Imagens ignoram na publicacao (nao ha
  // stream copy de video), mas a escolha e persistida junto com o post.
  const [videoProcessingMode, setVideoProcessingMode] = useState<VideoProcessingMode>("original");
  // Link divulgado junto do Story (registro + cópia — a API não anexa sticker).
  const [storyLink, setStoryLink] = useState<StoryLinkValue>(EMPTY_STORY_LINK);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyPublished, setHistoryPublished] = useState(0);
  const [historyQueued, setHistoryQueued] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);

  // Stories ativos por conta (checagem ao vivo na Meta)
  const [storiesMap, setStoriesMap] = useState<Record<string, { count: number; expiring_first_at?: string | null }> | null>(null);
  const [loadingStories, setLoadingStories] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<StoryTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [togglingTemplateId, setTogglingTemplateId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/accounts/list");
      const d = await res.json() as { accounts: Account[] };
      setAccounts((d.accounts ?? []).filter(a => a.is_active));
    } finally { setLoadingAccounts(false); }
  }, []);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts/folders");
      const d = await res.json() as { folders: FolderItem[] };
      setFolders(d.folders ?? []);
    } catch {/* silent */}
  }, []);

  const fetchHistory = useCallback(async (silent = false) => {
    if (!silent) setLoadingHistory(true); else setRefreshingHistory(true);
    try {
      const res = await fetch("/api/posts/stories/history");
      const d = await res.json() as { items?: HistoryItem[]; published?: number; queued?: number };
      setHistory(d.items ?? []);
      setHistoryPublished(d.published ?? 0);
      setHistoryQueued(d.queued ?? 0);
    } finally { setLoadingHistory(false); setRefreshingHistory(false); }
  }, []);

  const fetchActiveStories = useCallback(async () => {
    setLoadingStories(true);
    try {
      const res = await fetch("/api/accounts/stories");
      const d = await res.json() as { stories?: Record<string, { count: number; expiring_first_at?: string | null }> };
      setStoriesMap(d.stories ?? {});
    } catch {/* silent */} finally { setLoadingStories(false); }
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/stories/templates");
      const d = await res.json() as { templates?: StoryTemplate[] };
      setTemplates(d.templates ?? []);
    } finally { setLoadingTemplates(false); }
  }, []);

  const fetchMediaLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch("/api/stories/media");
      const d = await res.json() as { items?: StoryMediaItem[] };
      setMediaLibrary(d.items ?? []);
    } catch {/* silent */} finally { setLoadingLibrary(false); }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchFolders();
    fetchHistory();
    fetchTemplates();
    fetchMediaLibrary();
  }, [fetchAccounts, fetchFolders, fetchHistory, fetchTemplates, fetchMediaLibrary]);

  useEffect(() => {
    if (historyQueued === 0) return;
    const t = setInterval(() => fetchHistory(true), 15_000);
    return () => clearInterval(t);
  }, [historyQueued, fetchHistory]);

  // ── Upload handler ─────────────────────────────────────────────────────────

  const handleAddMedia = useCallback(async (file: File) => {
    if (media?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(media.previewUrl);

    const isVideo = file.type.startsWith("video/");
    const previewUrl = URL.createObjectURL(file);
    let duration: number | undefined;

    if (isVideo) {
      duration = await getVideoDuration(file);
      if (duration > MAX_VIDEO_DURATION) {
        setMedia({
          file, previewUrl, url: null, media_type: "video", storage_path: null,
          status: "error", error: `Vídeo muito longo (${Math.round(duration)}s). Máx. 60s.`, duration,
        });
        return;
      }
    }

    const item: UploadedMedia = {
      file, previewUrl, url: null, media_type: isVideo ? "video" : "image",
      storage_path: null, status: "uploading", duration,
    };
    setMedia(item);

    const fail = (error: string) =>
      setMedia(prev => prev && prev.previewUrl === previewUrl ? { ...prev, status: "error", error } : prev);

    // O arquivo vai DIRETO ao Supabase Storage via URL assinada — passar pela
    // Vercel estourava o limite de 4,5 MB do corpo e todo vídeo falhava.
    try {
      const signRes = await fetch("/api/stories/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: file.type, size: file.size }),
      });
      const sign = await signRes.json().catch(() => ({})) as { storage_path?: string; token?: string; error?: string };
      if (!signRes.ok || !sign.storage_path || !sign.token) {
        fail(sign.error ?? `Falha ao preparar upload (HTTP ${signRes.status})`);
        return;
      }

      const { error: upErr } = await createClient().storage
        .from("videos-library")
        .uploadToSignedUrl(sign.storage_path, sign.token, file, { contentType: file.type });
      if (upErr) {
        fail(`Falha no envio: ${upErr.message}`);
        return;
      }

      const doneRes = await fetch("/api/stories/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: sign.storage_path, filename: file.name }),
      });
      const data = await doneRes.json().catch(() => ({})) as { url?: string; storage_path?: string; error?: string };
      if (!doneRes.ok || !data.url) {
        fail(data.error ?? `Falha ao confirmar upload (HTTP ${doneRes.status})`);
        return;
      }

      setMedia(prev => prev && prev.previewUrl === previewUrl ? { ...prev, url: data.url!, storage_path: data.storage_path!, status: "done" } : prev);
      fetchMediaLibrary();
    } catch (err) {
      fail(err instanceof Error ? `Erro de conexão: ${err.message}` : "Erro de conexão");
    }
  }, [media, fetchMediaLibrary]);

  const handleRemoveMedia = useCallback(() => {
    setMedia(prev => { if (prev?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(prev.previewUrl); return null; });
  }, []);

  const handleSelectFromLibrary = useCallback((item: StoryMediaItem) => {
    setMedia(prev => {
      if (prev?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(prev.previewUrl);
      return {
        file: null,
        previewUrl: item.public_url,
        url: item.public_url,
        media_type: item.media_type,
        storage_path: item.storage_path,
        status: "done",
      };
    });
  }, []);

  const handleDeleteLibraryItem = useCallback(async (id: string) => {
    setDeletingLibraryId(id);
    try {
      await fetch(`/api/stories/media?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setMediaLibrary(prev => prev.filter(i => i.id !== id));
    } finally { setDeletingLibraryId(null); }
  }, []);

  // ── Modelo (pasta) / Contas ──────────────────────────────────────────────────

  const foldersWithAccounts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; accounts: Account[] }>();
    const noFolder: Account[] = [];
    for (const acc of accounts) {
      if (acc.folder_id) {
        if (!map.has(acc.folder_id)) {
          const f = folders.find(f => f.id === acc.folder_id);
          map.set(acc.folder_id, { id: acc.folder_id, name: f?.name ?? acc.account_folders?.name ?? "Pasta", accounts: [] });
        }
        map.get(acc.folder_id)!.accounts.push(acc);
      } else {
        noFolder.push(acc);
      }
    }
    const groups = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (noFolder.length > 0) groups.push({ id: "__no_folder__", name: "Sem pasta", accounts: noFolder });
    return groups;
  }, [accounts, folders]);

  const selectedFolder = foldersWithAccounts.find(f => f.id === selectedFolderId) ?? null;

  const handleSelectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setSelectedAccountIds([]);
    if (!storiesMap && !loadingStories) fetchActiveStories();
  };

  const hasActiveStory = (accountId: string) => (storiesMap?.[accountId]?.count ?? 0) > 0;

  const folderWithStoryCount = selectedFolder && storiesMap
    ? selectedFolder.accounts.filter(a => hasActiveStory(a.id)).length
    : 0;

  const toggleAccount = (id: string) =>
    setSelectedAccountIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // ── Publicar ───────────────────────────────────────────────────────────────

  const handlePublish = async () => {
    if (!media || media.status !== "done" || !media.url) { setPublishError("Adicione uma mídia."); return; }
    if (!selectedFolderId) { setPublishError("Escolha um modelo."); return; }
    if (selectedAccountIds.length === 0) { setPublishError("Selecione ao menos 1 conta."); return; }
    if (storyLink.mode === "managed" && !storyLink.managedLinkId) {
      setPublishError("Escolha o link gerenciado ou volte para \"Sem link\"."); return;
    }
    if (storyLink.mode === "direct" && !storyLink.directUrl.trim()) {
      setPublishError("Informe a URL do link ou volte para \"Sem link\"."); return;
    }

    setPublishError(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/posts/stories/post-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids: selectedAccountIds,
          media_url: media.url,
          media_type: media.media_type,
          video_processing_mode: videoProcessingMode,
          // O servidor deriva a URL pública a partir do slug quando é link
          // gerenciado — o que for mandado aqui em story_link_url é ignorado
          // nesse caso.
          managed_link_id: storyLink.mode === "managed" ? storyLink.managedLinkId : null,
          story_link_url: storyLink.mode === "direct" ? storyLink.directUrl.trim() || null : null,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string; accounts?: number };
      if (!res.ok || data.error) { setPublishError(data.error ?? "Erro ao publicar."); return; }

      setPublishSuccess(`Story enviado para ${data.accounts ?? selectedAccountIds.length} conta(s) — publicando em instantes.`);
      handleRemoveMedia();
      setSelectedAccountIds([]);
      fetchHistory();
    } catch {
      setPublishError("Erro de conexão. Tente novamente.");
    } finally {
      setPublishing(false);
    }
  };

  // ── Histórico handlers ──────────────────────────────────────────────────────

  const handleDeleteHistoryItem = async (id: string) => {
    setDeletingHistoryId(id);
    try {
      const res = await fetch(`/api/posts/stories/history?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("DELETE falhou");
      setHistory(prev => prev.filter(i => i.id !== id));
    } catch {
      window.alert("Não foi possível remover o item do histórico. Tente novamente.");
    } finally { setDeletingHistoryId(null); }
  };

  const handleClearHistory = async () => {
    setClearingHistory(true);
    try {
      const res = await fetch("/api/posts/stories/history?all=true", { method: "DELETE" });
      if (!res.ok) throw new Error("DELETE falhou");
      setHistory([]); setHistoryPublished(0); setHistoryQueued(0);
    } catch {
      window.alert("Não foi possível limpar o histórico. Tente novamente.");
    } finally { setClearingHistory(false); }
  };

  // ── Templates handlers ───────────────────────────────────────────────────────

  const handleToggleTemplate = async (t: StoryTemplate) => {
    setTogglingTemplateId(t.id);
    try {
      const newStatus = t.status === "active" ? "paused" : "active";
      const res = await fetch(`/api/stories/templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("PATCH falhou");
      setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, status: newStatus } : x));
    } catch {
      window.alert("Não foi possível alterar o status do modelo. Tente novamente.");
    } finally { setTogglingTemplateId(null); }
  };

  const handleDeleteTemplate = async (id: string) => {
    setDeletingTemplateId(id);
    try {
      const res = await fetch(`/api/stories/templates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("DELETE falhou");
      setTemplates(prev => prev.filter(x => x.id !== id));
    } catch {
      window.alert("Não foi possível excluir o modelo. Tente novamente.");
    } finally { setDeletingTemplateId(null); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="page-title">Postagem de Stories</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-lg bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20 font-semibold tracking-wide">STORIES</span>
        </div>
        <p className="page-subtitle">Suba uma foto ou vídeo e publique como Story agora — expira em 24h</p>
      </div>

      {/* Success banner */}
      <AnimatePresence>
        {publishSuccess && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-5 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/20">
            <CheckCircle2 size={14} className="text-[#00E5FF] flex-shrink-0" />
            <p className="text-sm text-[#00E5FF] flex-1">{publishSuccess}</p>
            <button onClick={() => setPublishSuccess(null)} className="text-[#00E5FF]/40 hover:text-[#00E5FF] transition-colors"><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Form */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Mídia */}
          <SectionCard>
            <SectionLabel Icon={Upload}>Mídia (foto ou vídeo)</SectionLabel>
            <SingleMediaUpload media={media} onAdd={handleAddMedia} onRemove={handleRemoveMedia} />

            <div className="mt-5 pt-4 border-t border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3">
                <ImagePlay size={12} className="text-white/30" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
                  Biblioteca — mídias já enviadas antes
                </span>
              </div>
              <MediaLibrary
                items={mediaLibrary}
                loading={loadingLibrary}
                selectedStoragePath={media?.storage_path ?? null}
                onSelect={handleSelectFromLibrary}
                onDelete={handleDeleteLibraryItem}
                deletingId={deletingLibraryId}
              />
            </div>
          </SectionCard>

          {/* Modelo */}
          <SectionCard>
            <SectionLabel Icon={Sparkles}>Modelo (obrigatório)</SectionLabel>
            {loadingAccounts ? (
              <div className="flex items-center gap-2 text-white/30 text-sm py-2"><Loader2 size={14} className="animate-spin" /> Carregando...</div>
            ) : foldersWithAccounts.length === 0 ? (
              <p className="text-white/25 text-sm py-2">
                Nenhuma pasta de contas encontrada. <a href="/dashboard/accounts" className="text-[#00E5FF] hover:underline">Criar pasta</a>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {foldersWithAccounts.map(f => (
                  <button key={f.id} onClick={() => handleSelectFolder(f.id)}
                    className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all",
                      selectedFolderId === f.id ? "border-[#00E5FF]/40 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/[0.08] text-white/50 hover:border-white/20")}>
                    {f.id === "__no_folder__" ? "📂" : "📁"} {f.name}
                    <span className="text-[10px] opacity-50">({f.accounts.length})</span>
                  </button>
                ))}
              </div>
            )}
            {!selectedFolderId && foldersWithAccounts.length > 0 && (
              <p className="mt-3 text-xs text-amber-400/80">Escolha um modelo. Só as contas dele podem postar — evita postar na conta errada.</p>
            )}
          </SectionCard>

          {/* Contas */}
          <SectionCard>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-white/35" />
                <span className="text-xs font-semibold uppercase tracking-widest text-white/35">
                  Contas ({selectedAccountIds.length}/{selectedFolder?.accounts.length ?? 0})
                </span>
              </div>
              {selectedFolder && selectedFolder.accounts.length > 0 && (
                <div className="flex items-center gap-2">
                  {storiesMap && (
                    <>
                      <button onClick={() => setSelectedAccountIds(selectedFolder.accounts.filter(a => !hasActiveStory(a.id)).map(a => a.id))}
                        className="text-xs text-amber-400/70 hover:text-amber-400 transition-colors">Sem story</button>
                      <span className="text-white/15 text-xs">·</span>
                    </>
                  )}
                  <button onClick={() => setSelectedAccountIds(selectedFolder.accounts.map(a => a.id))} className="text-xs text-[#00FF41]/70 hover:text-[#00FF41] transition-colors">Todas</button>
                  <span className="text-white/15 text-xs">·</span>
                  <button onClick={() => setSelectedAccountIds([])} className="text-xs text-white/30 hover:text-white/60 transition-colors">Limpar</button>
                  <button onClick={fetchActiveStories} disabled={loadingStories} title="Verificar stories ativos agora"
                    className="text-white/30 hover:text-white/60 transition-colors disabled:opacity-40">
                    <RefreshCw size={12} className={loadingStories ? "animate-spin" : ""} />
                  </button>
                </div>
              )}
            </div>
            {selectedFolder && loadingStories && !storiesMap && (
              <div className="flex items-center gap-2 mb-3 text-[10px] text-white/30">
                <Loader2 size={10} className="animate-spin" /> Verificando quais contas já têm story ativo…
              </div>
            )}
            {selectedFolder && storiesMap && (
              <div className="flex items-center gap-3 mb-3 text-[10px]">
                <span className="flex items-center gap-1.5 text-[#00FF41]/80">
                  <span className="w-2 h-2 rounded-full bg-gradient-to-tr from-[#00FF41] to-[#00E5FF]" />
                  {folderWithStoryCount} com story ativo
                </span>
                <span className="flex items-center gap-1.5 text-white/35">
                  <span className="w-2 h-2 rounded-full bg-white/20" />
                  {selectedFolder.accounts.length - folderWithStoryCount} sem story
                </span>
              </div>
            )}
            {!selectedFolder ? (
              <p className="text-white/25 text-sm py-4 text-center">Selecione um modelo acima</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedFolder.accounts.map(acc => {
                  const isSelected = selectedAccountIds.includes(acc.id);
                  const withStory = hasActiveStory(acc.id);
                  return (
                    <button key={acc.id} onClick={() => toggleAccount(acc.id)}
                      title={storiesMap ? (withStory ? `${storiesMap[acc.id]?.count ?? 1} story ativo` : "Sem story ativo") : undefined}
                      className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all",
                        isSelected ? "border-[#00E5FF]/40 bg-[#00E5FF]/8 text-[#00E5FF]" : "border-white/[0.08] text-white/55 hover:border-white/20")}>
                      <span className={cn("relative flex-shrink-0 rounded-full", withStory && "p-[1.5px] bg-gradient-to-tr from-[#00FF41] to-[#00E5FF]")}>
                        {acc.avatar_url
                          ? <img src={acc.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover block" />
                          : <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#00E5FF]/40 to-[#00FF41]/40 flex items-center justify-center"><span className="text-[8px] font-bold text-black">{acc.username.charAt(0).toUpperCase()}</span></div>}
                      </span>
                      <span className="text-xs font-medium leading-none">@{acc.username}</span>
                      {isSelected && <Check size={9} className="text-[#00E5FF] flex-shrink-0" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Link do Story */}
          <SectionCard>
            <SectionLabel Icon={Link2}>Link do Story</SectionLabel>
            <StoryLinkSelector value={storyLink} onChange={setStoryLink} />
          </SectionCard>

          {/* Processamento do vídeo */}
          <SectionCard>
            <SectionLabel Icon={SlidersHorizontal}>Processamento do vídeo</SectionLabel>
            <VideoProcessingSelector
              value={videoProcessingMode}
              onChange={setVideoProcessingMode}
            />
            {media?.media_type === "image" && (
              <p className="mt-2.5 text-[10px] text-white/30">
                Esta mídia é uma imagem — a limpeza de metadados só se aplica a vídeo.
              </p>
            )}
          </SectionCard>

          {/* Nota */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[#00E5FF]/[0.04] border border-[#00E5FF]/15">
            <ImagePlay size={14} className="text-[#00E5FF]/60 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-white/40 leading-relaxed">
              <span className="text-[#00E5FF]/70 font-medium">Stories não suportam legendas</span> pela API do Instagram.
              Publica em até 1 minuto e expira automaticamente em 24 horas.
            </p>
          </div>

          {/* Error */}
          <AnimatePresence>
            {publishError && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertCircle size={14} className="flex-shrink-0" /> {publishError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Publicar */}
          <button type="button" onClick={handlePublish} disabled={publishing || media?.status === "uploading"}
            className={cn("w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-black text-sm transition-all",
              publishing || media?.status === "uploading" ? "bg-[#00E5FF]/40 cursor-not-allowed" : "bg-[#00E5FF] hover:bg-[#00E5FF]/90 hover:shadow-[0_0_28px_rgba(0,229,255,0.35)]"
            )}>
            {publishing ? <><Loader2 size={16} className="animate-spin text-black/70" /> Publicando...</>
              : media?.status === "uploading" ? <><Loader2 size={16} className="animate-spin text-black/70" /> Aguardando upload...</>
              : <><Send size={16} /> Publicar Story</>}
          </button>

          {/* Templates de Story */}
          <TemplatesSection
            templates={templates}
            loading={loadingTemplates}
            onImportClick={() => { setImportModalOpen(true); if (!storiesMap && !loadingStories) fetchActiveStories(); }}
            onToggle={handleToggleTemplate}
            togglingId={togglingTemplateId}
            onDelete={handleDeleteTemplate}
            deletingId={deletingTemplateId}
          />
        </div>

        {/* Histórico */}
        <div className="w-full lg:w-96 lg:sticky lg:top-8 flex-shrink-0">
          <HistoryPanel
            items={history}
            published={historyPublished}
            queued={historyQueued}
            loading={loadingHistory}
            onRefresh={() => fetchHistory(true)}
            refreshing={refreshingHistory}
            onDeleteItem={handleDeleteHistoryItem}
            deletingId={deletingHistoryId}
            onClearAll={handleClearHistory}
            clearingAll={clearingHistory}
          />
        </div>
      </div>

      <AnimatePresence>
        {importModalOpen && (
          <ImportTemplateModal
            accounts={accounts}
            storiesMap={storiesMap}
            onClose={() => setImportModalOpen(false)}
            onCreated={() => { setImportModalOpen(false); fetchTemplates(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
