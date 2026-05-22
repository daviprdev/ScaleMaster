"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Film, CalendarDays, Send, FolderOpen, X, Check,
  Loader2, AlertCircle, CheckCircle2, Plus, Trash2, Clock,
  Layers, ChevronDown, Shuffle, Zap, LayoutGrid, List,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
}

interface VideoItem {
  id: string;
  filename: string;
  public_url: string;
  folder_id: string | null;
  created_at: string;
}

interface FolderItem {
  id: string;
  name: string;
  video_count: number;
}

const INTERVAL_PRESETS = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1440 },
];

const MAX_CAPTION_CHARS = 2200;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function computeLastSlot(startIso: string, intervalMinutes: number, slots: number): string {
  if (!startIso || slots <= 1) return startIso;
  try {
    const ms = new Date(startIso).getTime() + (slots - 1) * intervalMinutes * 60_000;
    return new Date(ms).toISOString();
  } catch { return startIso; }
}

// ── VideoPickerModal ───────────────────────────────────────────────────────

function VideoPickerModal({
  selected,
  onConfirm,
  onClose,
}: {
  selected: string[];
  onConfirm: (ids: string[], items: VideoItem[]) => void;
  onClose: () => void;
}) {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set(selected));
  const [gridView, setGridView] = useState(true);

  useEffect(() => {
    fetch("/api/library")
      .then(r => r.json() as Promise<{ videos: VideoItem[] }>)
      .then(d => setVideos(d.videos ?? []))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setChecked(prev =>
      prev.size === videos.length ? new Set() : new Set(videos.map(v => v.id))
    );

  const handleConfirm = () => {
    const selectedItems = videos.filter(v => checked.has(v.id));
    onConfirm([...checked], selectedItems);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={e => e.stopPropagation()}
        className="bg-black border border-white/10 rounded-2xl w-full max-w-3xl flex flex-col"
        style={{ maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-3">
            <Film size={16} className="text-[#00FF41]" />
            <h2 className="text-white font-semibold text-sm">Selecionar Vídeos</h2>
            {checked.size > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-[#00FF41]/15 text-[#00FF41] text-xs font-mono">
                {checked.size} selecionados
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGridView(v => !v)}
              className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors"
            >
              {gridView ? <List size={14} /> : <LayoutGrid size={14} />}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.05] flex-shrink-0">
          <button
            onClick={toggleAll}
            className="text-xs text-[#00E5FF] hover:text-white transition-colors"
          >
            {checked.size === videos.length ? "Desmarcar todos" : "Selecionar todos"}
          </button>
          <span className="text-white/15 text-xs">·</span>
          <span className="text-white/30 text-xs">{videos.length} vídeos na biblioteca</span>
        </div>

        {/* Grid / List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={24} className="animate-spin text-[#00FF41]" />
            </div>
          ) : videos.length === 0 ? (
            <div className="text-center py-16 text-white/25 text-sm">
              Nenhum vídeo na biblioteca
            </div>
          ) : gridView ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {videos.map(v => {
                const isChecked = checked.has(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => toggle(v.id)}
                    className={cn(
                      "group relative aspect-[9/16] rounded-xl overflow-hidden border transition-all",
                      isChecked
                        ? "border-[#00FF41]/60 ring-1 ring-[#00FF41]/30"
                        : "border-white/10 hover:border-white/25"
                    )}
                  >
                    <video
                      src={v.public_url}
                      className="w-full h-full object-cover"
                      muted preload="metadata"
                    />
                    <div className={cn(
                      "absolute inset-0 transition-colors",
                      isChecked ? "bg-[#00FF41]/10" : "bg-black/0 group-hover:bg-black/20"
                    )} />
                    {isChecked && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#00FF41] flex items-center justify-center">
                        <Check size={11} className="text-black" strokeWidth={3} />
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                      <p className="text-white text-[9px] truncate">{v.filename}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {videos.map(v => {
                const isChecked = checked.has(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => toggle(v.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left",
                      isChecked
                        ? "border-[#00FF41]/30 bg-[#00FF41]/5"
                        : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-[4px] border flex items-center justify-center flex-shrink-0 transition-all",
                      isChecked ? "bg-[#00FF41] border-[#00FF41]" : "border-white/20"
                    )}>
                      {isChecked && <Check size={9} className="text-black" strokeWidth={3} />}
                    </div>
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-black/50 flex-shrink-0 border border-white/10">
                      <video src={v.public_url} className="w-full h-full object-cover" muted preload="metadata" />
                    </div>
                    <span className="text-white/70 text-xs truncate flex-1">{v.filename}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.07] flex-shrink-0">
          <span className="text-white/30 text-xs">{checked.size} de {videos.length} selecionados</span>
          <button
            onClick={handleConfirm}
            disabled={checked.size === 0}
            className={cn(
              "px-6 py-2 rounded-xl text-sm font-semibold transition-all",
              checked.size > 0
                ? "bg-[#00FF41] text-black hover:bg-[#00FF41]/90"
                : "bg-white/[0.05] text-white/25 cursor-not-allowed"
            )}
          >
            Confirmar ({checked.size})
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── CampaignPreview ────────────────────────────────────────────────────────

function CampaignPreview({
  totalVideos,
  totalAccounts,
  intervalMinutes,
  startDatetime,
  captionCount,
}: {
  totalVideos: number;
  totalAccounts: number;
  intervalMinutes: number;
  startDatetime: string;
  captionCount: number;
}) {
  const slots = totalAccounts > 0 && totalVideos > 0
    ? Math.ceil(totalVideos / totalAccounts)
    : 0;

  const lastSlot = slots > 0 && startDatetime
    ? computeLastSlot(startDatetime, intervalMinutes, slots)
    : null;

  const totalPosts = totalVideos;

  // Generate preview of first 5 slots
  const previewSlots = useMemo(() => {
    if (!startDatetime || slots === 0 || totalAccounts === 0) return [];
    const preview = [];
    for (let i = 0; i < Math.min(4, slots); i++) {
      const t = new Date(new Date(startDatetime).getTime() + i * intervalMinutes * 60_000);
      preview.push({
        time: t.toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
        count: i === slots - 1
          ? totalVideos - i * totalAccounts
          : totalAccounts,
      });
    }
    if (slots > 4) preview.push({ time: "...", count: 0 });
    return preview;
  }, [startDatetime, slots, totalAccounts, intervalMinutes, totalVideos]);

  const isReady = totalVideos > 0 && totalAccounts > 0 && startDatetime;

  return (
    <div className="glass-card rounded-2xl p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Layers size={14} className="text-[#00E5FF]" />
        <span className="text-xs font-semibold uppercase tracking-widest text-white/40">Resumo da Campanha</span>
      </div>

      {!isReady ? (
        <p className="text-white/20 text-xs text-center py-4">
          Preencha os campos para ver o resumo
        </p>
      ) : (
        <>
          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Vídeos", value: totalVideos, color: "text-[#00FF41]" },
              { label: "Contas", value: totalAccounts, color: "text-[#00E5FF]" },
              { label: "Slots", value: slots, color: "text-white" },
              { label: "Posts Total", value: totalPosts, color: "text-white" },
              { label: "Legendas", value: captionCount, color: "text-white/60" },
              { label: "Intervalo", value: `${intervalMinutes}min`, color: "text-white/60" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/[0.03] rounded-xl px-3 py-2.5 border border-white/[0.06]">
                <p className="text-white/35 text-[10px] uppercase tracking-wider">{label}</p>
                <p className={cn("font-mono font-semibold text-base mt-0.5", color)}>{value}</p>
              </div>
            ))}
          </div>

          {/* Time range */}
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-white/30 uppercase tracking-wider">Início</span>
              <span className="text-[#00FF41] font-mono">{formatDatetime(startDatetime)}</span>
            </div>
            {lastSlot && (
              <div className="flex justify-between text-[10px]">
                <span className="text-white/30 uppercase tracking-wider">Fim</span>
                <span className="text-[#00E5FF] font-mono">{formatDatetime(lastSlot)}</span>
              </div>
            )}
          </div>

          {/* Anti-spam badge */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#00FF41]/5 border border-[#00FF41]/20">
            <Shuffle size={12} className="text-[#00FF41] flex-shrink-0" />
            <p className="text-[10px] text-[#00FF41]/80">
              Anti-spam ativo — vídeos diferentes por conta em cada slot
            </p>
          </div>

          {/* Slot preview */}
          {previewSlots.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-white/25 uppercase tracking-wider">Timeline</p>
              {previewSlots.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  {s.time !== "..." ? (
                    <>
                      <span className="text-[#00E5FF]/60 font-mono text-[10px] w-28 flex-shrink-0">{s.time}</span>
                      <div className="flex-1 h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#00FF41]/60 to-[#00E5FF]/60"
                          style={{ width: `${Math.round((s.count / totalAccounts) * 100)}%` }}
                        />
                      </div>
                      <span className="text-white/30 text-[10px] w-16 text-right">{s.count} post{s.count !== 1 ? "s" : ""}</span>
                    </>
                  ) : (
                    <span className="text-white/15 text-[10px] pl-0">
                      + {slots - 4} slots restantes...
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── CaptionEditor ─────────────────────────────────────────────────────────

function CaptionEditor({
  captions,
  onChange,
}: {
  captions: string[];
  onChange: (captions: string[]) => void;
}) {
  const update = (i: number, val: string) => {
    const next = [...captions];
    next[i] = val.slice(0, MAX_CAPTION_CHARS);
    onChange(next);
  };

  const remove = (i: number) => onChange(captions.filter((_, idx) => idx !== i));

  const add = () => onChange([...captions, ""]);

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {captions.map((cap, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="relative">
              <div className="absolute top-3 left-3 flex items-center gap-1.5 pointer-events-none z-10">
                <span className="text-[10px] font-mono text-[#00FF41]/50 bg-[#00FF41]/10 rounded-md px-1.5 py-0.5">
                  #{i + 1}
                </span>
              </div>
              <textarea
                value={cap}
                onChange={e => update(i, e.target.value)}
                rows={3}
                placeholder={`Legenda ${i + 1}...`}
                className="w-full pl-14 pr-10 pt-3 pb-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm placeholder-white/20 resize-none focus:outline-none focus:border-[#00FF41]/40 focus:ring-1 focus:ring-[#00FF41]/20 transition-all leading-relaxed"
              />
              <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2">
                <span className={cn(
                  "text-[10px] transition-colors",
                  cap.length > MAX_CAPTION_CHARS * 0.9 ? "text-yellow-400" : "text-white/20"
                )}>
                  {cap.length}/{MAX_CAPTION_CHARS}
                </span>
                {captions.length > 1 && (
                  <button
                    onClick={() => remove(i)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-white/25 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <button
        type="button"
        onClick={add}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-white/15 text-white/40 text-sm hover:border-[#00FF41]/40 hover:text-[#00FF41]/60 transition-all"
      >
        <Plus size={14} />
        Adicionar Legenda
      </button>

      {captions.length > 1 && (
        <p className="text-[10px] text-white/25 flex items-center gap-1.5">
          <Shuffle size={9} />
          Legendas sorteadas aleatoriamente em cada post
        </p>
      )}
    </div>
  );
}

// ── SectionCard ────────────────────────────────────────────────────────────

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glass-card p-5 rounded-2xl", className)}>
      {children}
    </div>
  );
}

function SectionLabel({ Icon, children }: { Icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={14} className="text-white/35" />
      <span className="text-xs font-semibold uppercase tracking-widest text-white/35">{children}</span>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function PostarPage() {
  // ── Accounts ──────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  // ── Media ─────────────────────────────────────────────────────
  const [mediaMode, setMediaMode] = useState<"videos" | "folder">("videos");
  const [showVideoPicker, setShowVideoPicker] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [selectedVideoItems, setSelectedVideoItems] = useState<VideoItem[]>([]);

  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [folderVideoCount, setFolderVideoCount] = useState<number>(0);
  const [loadingFolderCount, setLoadingFolderCount] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);

  // ── Schedule ──────────────────────────────────────────────────
  const [startDatetime, setStartDatetime] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(60);

  // ── Captions ──────────────────────────────────────────────────
  const [captions, setCaptions] = useState<string[]>(["", ""]);

  // ── Submit ────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    count: number; slots: number; first_slot: string; last_slot: string;
  } | null>(null);

  const minDatetime = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  // ── Fetch accounts ──────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/accounts/list");
      const d = await res.json() as { accounts: Account[] };
      setAccounts((d.accounts ?? []).filter(a => a.is_active));
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // ── Fetch folders ────────────────────────────────────────────
  useEffect(() => {
    if (mediaMode !== "folder") return;
    setLoadingFolders(true);
    fetch("/api/library/folders")
      .then(r => r.json() as Promise<{ folders: FolderItem[] }>)
      .then(d => setFolders(d.folders ?? []))
      .finally(() => setLoadingFolders(false));
  }, [mediaMode]);

  // ── Fetch folder video count when folder changes ──────────────
  useEffect(() => {
    if (!selectedFolderId) { setFolderVideoCount(0); return; }
    setLoadingFolderCount(true);
    fetch(`/api/library?folderId=${selectedFolderId}`)
      .then(r => r.json() as Promise<{ videos: VideoItem[] }>)
      .then(d => setFolderVideoCount(d.videos?.length ?? 0))
      .finally(() => setLoadingFolderCount(false));
  }, [selectedFolderId]);

  // ── Computed values ──────────────────────────────────────────
  const totalVideos = mediaMode === "videos"
    ? selectedVideoIds.length
    : folderVideoCount;

  const totalAccounts = selectedAccountIds.length;

  const validCaptions = captions.filter(c => c.trim().length > 0);

  // ── Handlers ─────────────────────────────────────────────────

  const toggleAccount = (id: string) =>
    setSelectedAccountIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const selectAllAccounts = () =>
    setSelectedAccountIds(accounts.map(a => a.id));

  const deselectAllAccounts = () =>
    setSelectedAccountIds([]);

  const handleVideoConfirm = (ids: string[], items: VideoItem[]) => {
    setSelectedVideoIds(ids);
    setSelectedVideoItems(items);
    setShowVideoPicker(false);
  };

  const handleSubmit = async () => {
    if (totalAccounts === 0) { setSubmitError("Selecione ao menos 1 conta."); return; }
    if (mediaMode === "videos" && selectedVideoIds.length === 0) {
      setSubmitError("Selecione ao menos 1 vídeo.");
      return;
    }
    if (mediaMode === "folder" && !selectedFolderId) {
      setSubmitError("Selecione uma pasta.");
      return;
    }
    if (mediaMode === "folder" && folderVideoCount === 0) {
      setSubmitError("A pasta selecionada está vazia.");
      return;
    }
    if (validCaptions.length === 0) { setSubmitError("Adicione ao menos 1 legenda."); return; }
    if (!startDatetime) { setSubmitError("Defina a data e hora de início."); return; }
    if (intervalMinutes < 1) { setSubmitError("Intervalo mínimo de 1 minuto."); return; }

    setSubmitError(null);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        account_ids: selectedAccountIds,
        captions: validCaptions,
        start_datetime: new Date(startDatetime).toISOString(),
        interval_minutes: intervalMinutes,
      };

      if (mediaMode === "videos") {
        body.video_ids = selectedVideoIds;
      } else {
        body.folder_id = selectedFolderId;
      }

      const res = await fetch("/api/posts/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json() as {
        success: boolean;
        count: number;
        slots: number;
        first_slot: string;
        last_slot: string;
        error?: string;
      };

      if (!res.ok || data.error) {
        setSubmitError(data.error ?? "Erro ao criar campanha.");
        return;
      }

      setSuccess({ count: data.count, slots: data.slots, first_slot: data.first_slot, last_slot: data.last_slot });
    } catch {
      setSubmitError("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSuccess(null);
    setSubmitError(null);
    setSelectedAccountIds([]);
    setSelectedVideoIds([]);
    setSelectedVideoItems([]);
    setSelectedFolderId("");
    setFolderVideoCount(0);
    setStartDatetime("");
    setIntervalMinutes(60);
    setCaptions(["", ""]);
    setMediaMode("videos");
  };

  const selectedFolder = folders.find(f => f.id === selectedFolderId);

  // ── Success screen ───────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 flex flex-col items-center text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-20 h-20 rounded-3xl bg-[#00FF41]/10 border border-[#00FF41]/30 flex items-center justify-center mb-6"
        >
          <CheckCircle2 size={36} className="text-[#00FF41]" />
        </motion.div>
        <h2 className="text-white text-2xl font-bold mb-2">Campanha Criada!</h2>
        <p className="text-white/40 text-sm mb-8">
          {success.count} posts foram agendados em {success.slots} slot{success.slots !== 1 ? "s" : ""} de tempo.
        </p>
        <div className="w-full glass-card rounded-2xl p-5 text-left space-y-3 mb-8">
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Primeiro post</span>
            <span className="text-[#00FF41] font-mono text-xs">{formatDatetime(success.first_slot)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Último post</span>
            <span className="text-[#00E5FF] font-mono text-xs">{formatDatetime(success.last_slot)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Total agendado</span>
            <span className="text-white font-mono text-xs">{success.count} posts</span>
          </div>
        </div>
        <div className="flex gap-3 w-full">
          <button onClick={handleReset} className="flex-1 btn-primary py-3 text-sm">
            Nova Campanha
          </button>
          <a href="/dashboard/schedule" className="flex-1 flex items-center justify-center py-3 rounded-xl border border-white/15 text-white/60 text-sm hover:border-white/30 hover:text-white transition-all">
            Ver Agendamentos
          </a>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="page-title">Gerenciador de Campanhas</h1>
        <p className="page-subtitle">Agendamento em lote com distribuição inteligente anti-spam</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* ── Left: Form ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* 1. Contas */}
          <SectionCard>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-white/35" />
                <span className="text-xs font-semibold uppercase tracking-widest text-white/35">Contas</span>
              </div>
              {accounts.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={selectAllAccounts}
                    className="text-xs text-[#00FF41]/70 hover:text-[#00FF41] transition-colors"
                  >
                    Selecionar Todas
                  </button>
                  <span className="text-white/15 text-xs">·</span>
                  <button
                    onClick={deselectAllAccounts}
                    className="text-xs text-white/30 hover:text-white/60 transition-colors"
                  >
                    Desmarcar
                  </button>
                </div>
              )}
            </div>

            {loadingAccounts ? (
              <div className="flex items-center gap-2 text-white/30 text-sm py-2">
                <Loader2 size={14} className="animate-spin" /> Carregando contas...
              </div>
            ) : accounts.length === 0 ? (
              <p className="text-white/25 text-sm py-4 text-center">
                Nenhuma conta conectada.{" "}
                <a href="/dashboard/accounts" className="text-[#00E5FF] hover:underline">Conectar conta</a>
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {accounts.map(acc => {
                  const isSelected = selectedAccountIds.includes(acc.id);
                  return (
                    <button
                      key={acc.id}
                      onClick={() => toggleAccount(acc.id)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left",
                        isSelected
                          ? "border-[#00FF41]/40 bg-[#00FF41]/5"
                          : "border-white/[0.07] bg-white/[0.02] hover:border-white/15"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded-[4px] border flex items-center justify-center flex-shrink-0 transition-all",
                        isSelected ? "bg-[#00FF41] border-[#00FF41]" : "border-white/20"
                      )}>
                        {isSelected && <Check size={9} className="text-black" strokeWidth={3} />}
                      </div>
                      {acc.avatar_url ? (
                        <img src={acc.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#00FF41]/40 to-[#00E5FF]/40 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">@{acc.username}</p>
                        {acc.display_name && (
                          <p className="text-xs text-white/35 truncate">{acc.display_name}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedAccountIds.length > 0 && (
              <p className="mt-3 text-xs text-[#00FF41]/60 font-mono">
                {selectedAccountIds.length} conta{selectedAccountIds.length !== 1 ? "s" : ""} selecionada{selectedAccountIds.length !== 1 ? "s" : ""}
              </p>
            )}
          </SectionCard>

          {/* 2. Mídia */}
          <SectionCard>
            <SectionLabel Icon={Film}>Mídia</SectionLabel>

            {/* Mode toggle */}
            <div className="flex rounded-xl overflow-hidden border border-white/10 mb-4">
              {(["videos", "folder"] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setMediaMode(mode)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-all",
                    mediaMode === mode
                      ? "bg-[#00FF41]/15 text-[#00FF41] border-r border-[#00FF41]/20"
                      : "bg-white/[0.02] text-white/35 hover:text-white/60"
                  )}
                >
                  {mode === "videos" ? <><Film size={14} /> Vídeos Avulsos</> : <><FolderOpen size={14} /> Pasta Completa</>}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {mediaMode === "videos" ? (
                <motion.div
                  key="videos"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  <button
                    onClick={() => setShowVideoPicker(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/15 text-white/40 text-sm hover:border-[#00FF41]/40 hover:text-[#00FF41]/60 transition-all"
                  >
                    <Plus size={14} />
                    {selectedVideoIds.length === 0 ? "Selecionar vídeos da biblioteca" : `${selectedVideoIds.length} vídeo${selectedVideoIds.length !== 1 ? "s" : ""} selecionado${selectedVideoIds.length !== 1 ? "s" : ""}`}
                  </button>

                  {selectedVideoItems.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedVideoItems.slice(0, 8).map(v => (
                        <div
                          key={v.id}
                          className="relative w-10 h-[71px] rounded-lg overflow-hidden border border-[#00FF41]/30"
                        >
                          <video src={v.public_url} className="w-full h-full object-cover" muted preload="metadata" />
                        </div>
                      ))}
                      {selectedVideoItems.length > 8 && (
                        <div className="w-10 h-[71px] rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center">
                          <span className="text-white/30 text-[10px]">+{selectedVideoItems.length - 8}</span>
                        </div>
                      )}
                      <button
                        onClick={() => { setSelectedVideoIds([]); setSelectedVideoItems([]); }}
                        className="ml-1 text-[10px] text-white/25 hover:text-red-400 transition-colors self-end pb-1"
                      >
                        Limpar
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="folder"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  {loadingFolders ? (
                    <div className="flex items-center gap-2 text-white/30 text-sm py-2">
                      <Loader2 size={14} className="animate-spin" /> Carregando pastas...
                    </div>
                  ) : folders.length === 0 ? (
                    <p className="text-white/25 text-sm py-4 text-center">
                      Nenhuma pasta criada.{" "}
                      <a href="/dashboard/library" className="text-[#00E5FF] hover:underline">Criar pasta</a>
                    </p>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={() => setFolderOpen(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 hover:border-white/20 transition-colors"
                      >
                        <span className={cn("text-sm", selectedFolder ? "text-white" : "text-white/30")}>
                          {selectedFolder
                            ? `📁 ${selectedFolder.name} · ${folderVideoCount} vídeos`
                            : "Selecionar pasta..."
                          }
                        </span>
                        <ChevronDown size={14} className={cn("text-white/30 transition-transform", folderOpen && "rotate-180")} />
                      </button>

                      <AnimatePresence>
                        {folderOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.12 }}
                            className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#0d111b] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
                          >
                            {folders.map(f => (
                              <button
                                key={f.id}
                                onClick={() => { setSelectedFolderId(f.id); setFolderOpen(false); }}
                                className={cn(
                                  "w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-white/[0.05] transition-colors",
                                  selectedFolderId === f.id && "bg-[#00FF41]/5 text-[#00FF41]"
                                )}
                              >
                                <span className="text-white">📁 {f.name}</span>
                                <span className="text-white/30 text-xs">{f.video_count} vídeos</span>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {loadingFolderCount && selectedFolderId && (
                    <p className="mt-2 text-xs text-white/30 flex items-center gap-1.5">
                      <Loader2 size={10} className="animate-spin" /> Contando vídeos...
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </SectionCard>

          {/* 3. Distribuição */}
          <SectionCard>
            <SectionLabel Icon={CalendarDays}>Distribuição de Tempo</SectionLabel>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-white/35 mb-2">Data e Hora de Início</label>
                <input
                  type="datetime-local"
                  value={startDatetime}
                  min={minDatetime}
                  onChange={e => setStartDatetime(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm focus:outline-none focus:border-[#00FF41]/40 focus:ring-1 focus:ring-[#00FF41]/20 transition-all [color-scheme:dark]"
                />
              </div>

              <div>
                <label className="block text-xs text-white/35 mb-2">Intervalo entre Slots</label>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {INTERVAL_PRESETS.map(p => (
                    <button
                      key={p.minutes}
                      onClick={() => setIntervalMinutes(p.minutes)}
                      className={cn(
                        "px-3 py-1 rounded-lg text-xs font-mono transition-all",
                        intervalMinutes === p.minutes
                          ? "bg-[#00FF41]/15 text-[#00FF41] border border-[#00FF41]/30"
                          : "bg-white/[0.04] text-white/40 border border-white/[0.07] hover:border-white/20 hover:text-white/60"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={intervalMinutes}
                    min={1}
                    max={43200}
                    onChange={e => setIntervalMinutes(Math.max(1, Number(e.target.value)))}
                    className="w-24 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm text-center focus:outline-none focus:border-[#00FF41]/40 focus:ring-1 focus:ring-[#00FF41]/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-white/35 text-sm">minutos</span>
                  {intervalMinutes >= 60 && (
                    <span className="text-white/25 text-xs">
                      ({(intervalMinutes / 60).toFixed(1).replace(".0", "")}h)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* 4. Legendas */}
          <SectionCard>
            <SectionLabel Icon={List}>Legendas Dinâmicas</SectionLabel>
            <CaptionEditor captions={captions} onChange={setCaptions} />
          </SectionCard>

          {/* Error */}
          <AnimatePresence>
            {submitError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
              >
                <AlertCircle size={14} className="flex-shrink-0" />
                {submitError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-black text-sm transition-all",
              submitting
                ? "bg-[#00FF41]/50 cursor-not-allowed"
                : "bg-[#00FF41] hover:bg-[#00FF41]/90 hover:shadow-[0_0_28px_rgba(0,255,65,0.35)]"
            )}
          >
            {submitting ? (
              <><Loader2 size={16} className="animate-spin text-black/70" /> Criando campanha...</>
            ) : (
              <><Send size={16} /> Criar Campanha
                {totalVideos > 0 && totalAccounts > 0 && (
                  <span className="ml-1 opacity-70">
                    ({totalVideos} vídeo{totalVideos !== 1 ? "s" : ""} · {totalAccounts} conta{totalAccounts !== 1 ? "s" : ""})
                  </span>
                )}
              </>
            )}
          </button>
        </div>

        {/* ── Right: Campaign Preview ── */}
        <div className="w-full lg:w-72 lg:sticky lg:top-8 flex-shrink-0">
          <CampaignPreview
            totalVideos={totalVideos}
            totalAccounts={totalAccounts}
            intervalMinutes={intervalMinutes}
            startDatetime={startDatetime}
            captionCount={validCaptions.length}
          />

          {/* Quick tips */}
          <div className="mt-4 glass-card rounded-2xl p-4 space-y-2.5">
            <p className="text-[10px] text-white/25 uppercase tracking-wider">Como funciona</p>
            {[
              { icon: Shuffle, text: "Vídeos embaralhados (Fisher-Yates) uma vez para toda a campanha" },
              { icon: Zap, text: "Mesmo slot → vídeos diferentes por conta (anti-spam)" },
              { icon: Clock, text: "Slot 0 = início, Slot 1 = início + intervalo, ..." },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-2">
                <Icon size={10} className="text-[#00FF41]/50 mt-0.5 flex-shrink-0" />
                <p className="text-[10px] text-white/30 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Video Picker Modal */}
      <AnimatePresence>
        {showVideoPicker && (
          <VideoPickerModal
            selected={selectedVideoIds}
            onConfirm={handleVideoConfirm}
            onClose={() => setShowVideoPicker(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
