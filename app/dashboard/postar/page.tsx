"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Film, CalendarDays, Send, FolderOpen, X, Check,
  Loader2, AlertCircle, CheckCircle2, Plus, Trash2, Clock,
  Layers, ChevronDown, Shuffle, Zap, LayoutGrid, List,
  Library, Save, BookMarked, BarChart2, RefreshCw,
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

interface SavedCaption {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
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
  account_ids: string[];
  campaign_status: "running" | "completed";
  created_at: string;
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

const BATCH_PRESETS = [1, 3, 5, 10, 20];

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
  batchSize,
  intervalMinutes,
  startDatetime,
  captionCount,
}: {
  totalVideos: number;
  totalAccounts: number;
  batchSize: number;
  intervalMinutes: number;
  startDatetime: string;
  captionCount: number;
}) {
  const effectiveBatch = Math.max(1, batchSize);
  const postsPerSlot = Math.max(1, totalAccounts) * effectiveBatch;
  const slots = totalVideos > 0 ? Math.ceil(totalVideos / postsPerSlot) : 0;

  const lastSlot = slots > 0 && startDatetime
    ? computeLastSlot(startDatetime, intervalMinutes, slots)
    : null;

  const previewSlots = useMemo(() => {
    if (!startDatetime || slots === 0) return [];
    const preview = [];
    for (let i = 0; i < Math.min(4, slots); i++) {
      const t = new Date(new Date(startDatetime).getTime() + i * intervalMinutes * 60_000);
      const remaining = totalVideos - i * postsPerSlot;
      preview.push({
        time: t.toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
        count: Math.min(postsPerSlot, remaining),
      });
    }
    if (slots > 4) preview.push({ time: "...", count: 0 });
    return preview;
  }, [startDatetime, slots, postsPerSlot, intervalMinutes, totalVideos]);

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
              { label: "Por Lote", value: effectiveBatch, color: "text-white" },
              { label: "Disparos", value: slots, color: "text-white" },
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
              Anti-spam ativo — vídeos diferentes por conta em cada disparo
            </p>
          </div>

          {/* Slot preview timeline */}
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
                          style={{ width: `${Math.round((s.count / postsPerSlot) * 100)}%` }}
                        />
                      </div>
                      <span className="text-white/30 text-[10px] w-16 text-right">{s.count} vídeo{s.count !== 1 ? "s" : ""}</span>
                    </>
                  ) : (
                    <span className="text-white/15 text-[10px]">
                      + {slots - 4} disparos restantes...
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
  const [savedCaptions, setSavedCaptions] = useState<SavedCaption[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingFor, setSavingFor] = useState<number | null>(null);
  const [saveTitle, setSaveTitle] = useState("");
  const [savingApi, setSavingApi] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<number | null>(null);
  const libraryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoadingSaved(true);
    fetch("/api/saved-captions")
      .then(r => r.json() as Promise<{ captions: SavedCaption[] }>)
      .then(d => setSavedCaptions(d.captions ?? []))
      .catch(() => {})
      .finally(() => setLoadingSaved(false));
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (libraryRef.current && !libraryRef.current.contains(e.target as Node)) {
        setShowLibrary(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const update = (i: number, val: string) => {
    const next = [...captions];
    next[i] = val.slice(0, MAX_CAPTION_CHARS);
    onChange(next);
  };

  const remove = (i: number) => {
    setSavingFor(null);
    onChange(captions.filter((_, idx) => idx !== i));
  };

  const add = () => onChange([...captions, ""]);

  const inject = (content: string) => {
    onChange([...captions, content]);
    setShowLibrary(false);
  };

  const handleSave = async (i: number) => {
    const content = captions[i];
    if (!content.trim()) return;
    setSavingApi(true);
    try {
      const res = await fetch("/api/saved-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: saveTitle.trim() || null,
          content: content.trim(),
        }),
      });
      const d = await res.json() as { caption?: SavedCaption };
      if (d.caption) {
        setSavedCaptions(prev => [d.caption!, ...prev]);
        setSavedFeedback(i);
        setTimeout(() => setSavedFeedback(null), 2500);
      }
    } catch {/* best-effort */}
    finally {
      setSavingApi(false);
      setSavingFor(null);
      setSaveTitle("");
    }
  };

  const removeFromLibrary = async (id: string) => {
    setSavedCaptions(prev => prev.filter(c => c.id !== id));
    await fetch("/api/saved-captions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  };

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
            <div>
              {/* Textarea */}
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

              {/* Save-to-library inline panel */}
              <AnimatePresence>
                {cap.trim().length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.12 }}
                    className="overflow-hidden"
                  >
                    {savedFeedback === i ? (
                      <div className="flex items-center gap-1.5 px-1 pt-1.5 pb-0.5">
                        <CheckCircle2 size={11} className="text-[#00FF41]" />
                        <span className="text-[10px] text-[#00FF41]">Salva na biblioteca!</span>
                      </div>
                    ) : savingFor === i ? (
                      <div className="flex items-center gap-2 px-1 pt-1.5 pb-0.5">
                        <input
                          autoFocus
                          value={saveTitle}
                          onChange={e => setSaveTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleSave(i); if (e.key === "Escape") { setSavingFor(null); setSaveTitle(""); } }}
                          placeholder="Nome da legenda (opcional)..."
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] border border-white/15 text-white text-xs placeholder-white/25 focus:outline-none focus:border-[#00FF41]/40 transition-all"
                        />
                        <button
                          onClick={() => handleSave(i)}
                          disabled={savingApi}
                          className="px-3 py-1.5 rounded-lg bg-[#00FF41]/15 text-[#00FF41] text-xs font-medium hover:bg-[#00FF41]/25 transition-all disabled:opacity-50 flex items-center gap-1"
                        >
                          {savingApi ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                          Salvar
                        </button>
                        <button
                          onClick={() => { setSavingFor(null); setSaveTitle(""); }}
                          className="w-6 h-6 flex items-center justify-center text-white/25 hover:text-white/60 transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setSavingFor(i); setSaveTitle(""); }}
                        className="flex items-center gap-1.5 px-1 pt-1.5 pb-0.5 text-[10px] text-white/25 hover:text-[#00FF41]/60 transition-colors group"
                      >
                        <Save size={9} className="group-hover:text-[#00FF41]/60 transition-colors" />
                        Salvar esta legenda para usar depois
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Bottom action row */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={add}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-white/15 text-white/40 text-sm hover:border-[#00FF41]/40 hover:text-[#00FF41]/60 transition-all"
        >
          <Plus size={14} />
          Adicionar Legenda
        </button>

        <div ref={libraryRef} className="relative">
          <button
            type="button"
            onClick={() => setShowLibrary(v => !v)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all",
              showLibrary
                ? "border-[#00E5FF]/40 bg-[#00E5FF]/8 text-[#00E5FF]"
                : "border-white/15 text-white/40 hover:border-[#00E5FF]/40 hover:text-[#00E5FF]/70"
            )}
          >
            <Library size={14} />
            Usar Salva
            {savedCaptions.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#00E5FF]/15 text-[#00E5FF] text-[9px] font-mono">
                {savedCaptions.length}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showLibrary && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.14 }}
                className="absolute z-30 bottom-full mb-2 right-0 w-80 bg-[#0d111b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
                  <div className="flex items-center gap-2">
                    <BookMarked size={13} className="text-[#00E5FF]" />
                    <span className="text-xs font-semibold text-white/70">Biblioteca de Legendas</span>
                  </div>
                  <button onClick={() => setShowLibrary(false)} className="text-white/25 hover:text-white/60 transition-colors">
                    <X size={13} />
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto">
                  {loadingSaved ? (
                    <div className="flex items-center justify-center py-8 gap-2 text-white/30 text-xs">
                      <Loader2 size={13} className="animate-spin" /> Carregando...
                    </div>
                  ) : savedCaptions.length === 0 ? (
                    <div className="py-8 text-center">
                      <BookMarked size={20} className="text-white/10 mx-auto mb-2" />
                      <p className="text-white/25 text-xs">Nenhuma legenda salva ainda.</p>
                      <p className="text-white/15 text-[10px] mt-1">Use o botão &ldquo;Salvar para depois&rdquo; abaixo de uma legenda.</p>
                    </div>
                  ) : (
                    savedCaptions.map(sc => (
                      <div
                        key={sc.id}
                        className="group flex items-start gap-2 px-4 py-3 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04] last:border-0"
                      >
                        <button
                          onClick={() => inject(sc.content)}
                          className="flex-1 text-left min-w-0"
                        >
                          {sc.title && (
                            <p className="text-xs font-medium text-[#00E5FF]/80 truncate mb-0.5">
                              {sc.title}
                            </p>
                          )}
                          <p className="text-xs text-white/55 line-clamp-2 leading-relaxed">
                            {sc.content}
                          </p>
                          <p className="text-[9px] text-white/20 mt-1">
                            Clique para usar
                          </p>
                        </button>
                        <button
                          onClick={() => removeFromLibrary(sc.id)}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-white/20 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {savedCaptions.length > 0 && (
                  <div className="px-4 py-2.5 border-t border-white/[0.05]">
                    <p className="text-[9px] text-white/20 text-center">
                      Clique em uma legenda para adicioná-la à campanha
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

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

// ── CampaignsList ──────────────────────────────────────────────────────────

function CampaignsList({
  accounts,
  onCreateNew,
}: {
  accounts: Account[];
  onCreateNew: () => void;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns");
      const d = await res.json() as { campaigns: Campaign[] };
      setCampaigns(d.campaigns ?? []);
    } catch {/* silent */} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  // Auto-refresh every 15s when running campaigns exist
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.campaign_status === "running");
    if (!hasRunning) return;
    const interval = setInterval(fetchCampaigns, 15000);
    return () => clearInterval(interval);
  }, [campaigns, fetchCampaigns]);

  const accountMap = useMemo(() => {
    const m = new Map<string, Account>();
    accounts.forEach(a => m.set(a.id, a));
    return m;
  }, [accounts]);

  const handleDelete = async (campaignId: string) => {
    if (confirmDelete !== campaignId) {
      setConfirmDelete(campaignId);
      setTimeout(() => setConfirmDelete(c => c === campaignId ? null : c), 3000);
      return;
    }
    setDeletingId(campaignId);
    setConfirmDelete(null);
    try {
      await fetch(`/api/campaigns?id=${encodeURIComponent(campaignId)}`, { method: "DELETE" });
      await fetchCampaigns();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-[#00FF41]" />
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-4">
          <BarChart2 size={24} className="text-white/15" />
        </div>
        <p className="text-white/30 text-sm mb-1">Nenhuma campanha encontrada</p>
        <p className="text-white/15 text-xs mb-5">Crie sua primeira campanha em lote</p>
        <button
          onClick={onCreateNew}
          className="px-5 py-2.5 rounded-xl bg-[#00FF41]/10 text-[#00FF41] text-sm font-medium hover:bg-[#00FF41]/20 transition-all border border-[#00FF41]/20"
        >
          Criar campanha
        </button>
      </div>
    );
  }

  const running = campaigns.filter(c => c.campaign_status === "running");

  return (
    <div className="max-w-3xl mx-auto">
      {/* Summary bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4 text-xs text-white/30">
          {running.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41] shadow-[0_0_4px_#00FF41] animate-pulse" />
              <span className="text-[#00FF41]/70">{running.length} executando</span>
            </span>
          )}
          <span>{campaigns.length} campanha{campaigns.length !== 1 ? "s" : ""} no total</span>
        </div>
        <button
          onClick={fetchCampaigns}
          className="flex items-center gap-1.5 text-xs text-white/25 hover:text-[#00E5FF] transition-colors"
        >
          <RefreshCw size={11} />
          Atualizar
        </button>
      </div>

      {/* Campaign cards */}
      <div className="space-y-3">
        {campaigns.map(campaign => {
          const progress = campaign.total > 0
            ? Math.round((campaign.published / campaign.total) * 100)
            : 0;
          const isRunning = campaign.campaign_status === "running";
          const isDeleting = deletingId === campaign.campaign_id;
          const isConfirming = confirmDelete === campaign.campaign_id;
          const campAccounts = campaign.account_ids
            .map(id => accountMap.get(id))
            .filter(Boolean) as Account[];

          return (
            <motion.div
              key={campaign.campaign_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="glass-card rounded-2xl p-5 space-y-4"
            >
              {/* Row 1: ID + Status badge + Delete */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn(
                    "w-2 h-2 rounded-full flex-shrink-0 mt-0.5",
                    isRunning
                      ? "bg-[#00FF41] shadow-[0_0_6px_rgba(0,255,65,0.8)]"
                      : "bg-white/15"
                  )} />
                  <div className="min-w-0">
                    <p className="text-white/60 font-mono text-xs tracking-wider">
                      #{campaign.campaign_id.slice(0, 8).toUpperCase()}
                    </p>
                    <p className="text-white/25 text-[10px] mt-0.5">
                      Criada {formatDatetime(campaign.created_at)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Status badge */}
                  <span className={cn(
                    "px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide border whitespace-nowrap",
                    isRunning
                      ? "bg-[#00FF41]/10 text-[#00FF41] border-[#00FF41]/20"
                      : "bg-white/[0.04] text-white/25 border-white/[0.08]"
                  )}>
                    {isRunning ? "🟢 Executando" : "⚫ Concluída"}
                  </span>

                  {/* Confirm-then-delete button */}
                  <button
                    onClick={() => handleDelete(campaign.campaign_id)}
                    disabled={isDeleting}
                    title={isConfirming
                      ? "Clique novamente para confirmar"
                      : isRunning
                        ? "Cancelar posts pendentes"
                        : "Remover campanha"}
                    className={cn(
                      "w-7 h-7 rounded-lg border flex items-center justify-center transition-all text-xs",
                      isConfirming
                        ? "bg-red-500/15 border-red-500/40 text-red-400 font-bold"
                        : "bg-white/[0.04] border-white/[0.08] text-white/25 hover:text-red-400 hover:border-red-400/25 hover:bg-red-400/8",
                      isDeleting && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    {isDeleting
                      ? <Loader2 size={11} className="animate-spin" />
                      : isConfirming
                        ? "?"
                        : <Trash2 size={11} />
                    }
                  </button>
                </div>
              </div>

              {/* Row 2: Progress bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/40">
                    {campaign.published} de {campaign.total} posts publicados
                  </span>
                  <span className={cn(
                    "font-mono font-bold",
                    progress >= 100 ? "text-[#00FF41]" : isRunning ? "text-[#00E5FF]" : "text-white/30"
                  )}>
                    {progress}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                    className={cn(
                      "h-full rounded-full",
                      progress >= 100
                        ? "bg-[#00FF41]"
                        : "bg-gradient-to-r from-[#00FF41]/70 to-[#00E5FF]/70"
                    )}
                  />
                </div>
                {(campaign.failed > 0 || campaign.cancelled > 0 || campaign.pending > 0) && (
                  <div className="flex gap-3 text-[10px]">
                    {campaign.pending > 0 && (
                      <span className="text-yellow-400/60">
                        {campaign.pending} pendente{campaign.pending !== 1 ? "s" : ""}
                      </span>
                    )}
                    {campaign.failed > 0 && (
                      <span className="text-red-400/60">
                        {campaign.failed} falha{campaign.failed !== 1 ? "s" : ""}
                      </span>
                    )}
                    {campaign.cancelled > 0 && (
                      <span className="text-white/20">
                        {campaign.cancelled} cancelado{campaign.cancelled !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Row 3: Accounts + Next/Last slot */}
              <div className="flex items-center justify-between gap-2">
                {/* Account avatars */}
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-1.5">
                    {campAccounts.slice(0, 5).map(acc => (
                      acc.avatar_url ? (
                        <img
                          key={acc.id}
                          src={acc.avatar_url}
                          alt={acc.username}
                          title={`@${acc.username}`}
                          className="w-5 h-5 rounded-full border border-black object-cover"
                        />
                      ) : (
                        <div
                          key={acc.id}
                          title={`@${acc.username}`}
                          className="w-5 h-5 rounded-full border border-black bg-gradient-to-br from-[#00FF41]/30 to-[#00E5FF]/30"
                        />
                      )
                    ))}
                    {/* Fallback circles when accounts not yet loaded */}
                    {campAccounts.length === 0 && campaign.account_ids.slice(0, 5).map(id => (
                      <div
                        key={id}
                        className="w-5 h-5 rounded-full border border-black bg-white/10"
                      />
                    ))}
                    {campaign.account_ids.length > 5 && (
                      <div className="w-5 h-5 rounded-full border border-black bg-white/10 flex items-center justify-center">
                        <span className="text-[7px] text-white/40">+{campaign.account_ids.length - 5}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-white/25 text-[10px]">
                    {campaign.account_ids.length} conta{campaign.account_ids.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Next / Last slot */}
                <div className="text-right text-[10px] flex-shrink-0">
                  {isRunning && campaign.next_pending ? (
                    <span className="flex items-center gap-1 text-[#00E5FF]/60">
                      <Clock size={9} />
                      Próximo: {formatDatetime(campaign.next_pending)}
                    </span>
                  ) : (
                    <span className="text-white/20">
                      Encerrada: {formatDatetime(campaign.last_slot)}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function PostarPage() {
  // ── Tab ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"create" | "campaigns">("create");

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
  const [batchSize, setBatchSize] = useState(1);

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
        batch_size: Math.max(1, batchSize),
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

      // Success: reset form, show notification banner, switch to campaigns tab
      setSelectedAccountIds([]);
      setSelectedVideoIds([]);
      setSelectedVideoItems([]);
      setSelectedFolderId("");
      setFolderVideoCount(0);
      setStartDatetime("");
      setIntervalMinutes(60);
      setBatchSize(1);
      setCaptions(["", ""]);
      setMediaMode("videos");

      setSuccess({ count: data.count, slots: data.slots, first_slot: data.first_slot, last_slot: data.last_slot });
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
    setSelectedAccountIds([]);
    setSelectedVideoIds([]);
    setSelectedVideoItems([]);
    setSelectedFolderId("");
    setFolderVideoCount(0);
    setStartDatetime("");
    setIntervalMinutes(60);
    setBatchSize(1);
    setCaptions(["", ""]);
    setMediaMode("videos");
    setActiveTab("create");
  };

  const selectedFolder = folders.find(f => f.id === selectedFolderId);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="page-title">Gerenciador de Campanhas</h1>
        <p className="page-subtitle">Agendamento em lote com distribuição inteligente anti-spam</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.07] mb-6 gap-1">
        {([
          { id: "create", label: "Criar Campanha", Icon: Plus },
          { id: "campaigns", label: "Campanhas Ativas", Icon: BarChart2 },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
              activeTab === id
                ? "border-[#00FF41] text-[#00FF41]"
                : "border-transparent text-white/35 hover:text-white/60"
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Success notification banner (visible in campaigns tab) */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="mb-5 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#00FF41]/10 border border-[#00FF41]/20"
          >
            <CheckCircle2 size={14} className="text-[#00FF41] flex-shrink-0" />
            <p className="text-sm text-[#00FF41] flex-1">
              <span className="font-semibold">{success.count} posts</span> agendados em{" "}
              <span className="font-semibold">{success.slots} disparos</span>
              {" · "}Primeiro disparo: {formatDatetime(success.first_slot)}
            </p>
            <button
              onClick={() => setSuccess(null)}
              className="text-[#00FF41]/40 hover:text-[#00FF41] transition-colors flex-shrink-0"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab Content ── */}

      {activeTab === "campaigns" ? (
        <CampaignsList accounts={accounts} onCreateNew={handleReset} />
      ) : (
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

              <div className="space-y-6">

                {/* ① Tamanho do Lote */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-[#00FF41]/15 text-[#00FF41] text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
                    <label className="text-xs text-white/60 font-medium">Vídeos por disparo (tamanho do lote)</label>
                  </div>

                  {/* Stepper */}
                  <div className="flex items-center gap-4 mb-3">
                    <button
                      type="button"
                      onClick={() => setBatchSize(v => Math.max(1, v - 1))}
                      className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/10 text-white/60 hover:bg-white/[0.1] hover:text-white transition-all flex items-center justify-center text-lg font-light select-none"
                    >
                      −
                    </button>
                    <div className="flex-1 text-center">
                      <span className="text-[#00FF41] font-mono text-3xl font-bold">{batchSize}</span>
                      <p className="text-white/25 text-[10px] mt-0.5">vídeo{batchSize !== 1 ? "s" : ""} por disparo</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBatchSize(v => Math.min(100, v + 1))}
                      className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/10 text-white/60 hover:bg-white/[0.1] hover:text-white transition-all flex items-center justify-center text-lg font-light select-none"
                    >
                      +
                    </button>
                  </div>

                  {/* Presets */}
                  <div className="flex gap-2">
                    {BATCH_PRESETS.map(v => (
                      <button
                        key={v}
                        onClick={() => setBatchSize(v)}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-xs font-mono transition-all",
                          batchSize === v
                            ? "bg-[#00FF41]/15 text-[#00FF41] border border-[#00FF41]/30"
                            : "bg-white/[0.04] text-white/35 border border-white/[0.07] hover:border-white/20 hover:text-white/60"
                        )}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-white/[0.06]" />

                {/* ② Intervalo */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-[#00E5FF]/15 text-[#00E5FF] text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
                    <label className="text-xs text-white/60 font-medium">A cada quanto tempo (intervalo entre disparos)</label>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {INTERVAL_PRESETS.map(p => (
                      <button
                        key={p.minutes}
                        onClick={() => setIntervalMinutes(p.minutes)}
                        className={cn(
                          "px-3 py-1 rounded-lg text-xs font-mono transition-all",
                          intervalMinutes === p.minutes
                            ? "bg-[#00E5FF]/15 text-[#00E5FF] border border-[#00E5FF]/30"
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
                      className="w-24 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm text-center focus:outline-none focus:border-[#00E5FF]/40 focus:ring-1 focus:ring-[#00E5FF]/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-white/35 text-sm">minutos</span>
                    {intervalMinutes >= 60 && (
                      <span className="text-white/25 text-xs">
                        ({(intervalMinutes / 60).toFixed(1).replace(".0", "")}h)
                      </span>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-white/[0.06]" />

                {/* ③ Data de início */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-white/10 text-white/50 text-[10px] font-bold flex items-center justify-center flex-shrink-0">3</span>
                    <label className="text-xs text-white/60 font-medium">Começando quando (data e hora de início)</label>
                  </div>
                  <input
                    type="datetime-local"
                    value={startDatetime}
                    min={minDatetime}
                    onChange={e => setStartDatetime(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm focus:outline-none focus:border-[#00FF41]/40 focus:ring-1 focus:ring-[#00FF41]/20 transition-all [color-scheme:dark]"
                  />
                </div>

                {/* Dynamic summary */}
                <AnimatePresence>
                  {totalVideos > 0 && startDatetime && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]"
                    >
                      {(() => {
                        const effectiveBatch = Math.max(1, batchSize);
                        const nAccounts = Math.max(1, selectedAccountIds.length);
                        const postsPerSlot = nAccounts * effectiveBatch;
                        const slots = Math.ceil(totalVideos / postsPerSlot);
                        const lastMs = new Date(startDatetime).getTime() + (slots - 1) * intervalMinutes * 60_000;
                        const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
                        });
                        const lastIso = new Date(lastMs).toISOString();
                        return (
                          <p className="text-xs text-white/55 leading-relaxed">
                            <span className="text-[#00FF41] font-semibold">{totalVideos}</span> vídeo{totalVideos !== 1 ? "s" : ""} em{" "}
                            <span className="text-white font-semibold">{slots}</span> disparo{slots !== 1 ? "s" : ""} —{" "}
                            <span className="text-[#00E5FF] font-semibold">{nAccounts}</span> conta{nAccounts !== 1 ? "s" : ""} × <span className="text-[#00E5FF] font-semibold">{effectiveBatch}</span> vídeo{effectiveBatch !== 1 ? "s" : ""} por disparo.{" "}
                            Início: <span className="text-white/80">{fmt(startDatetime)}</span>
                            {slots > 1 && <> · Fim: <span className="text-white/80">{fmt(lastIso)}</span></>}.
                          </p>
                        );
                      })()}
                    </motion.div>
                  )}
                </AnimatePresence>

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
              batchSize={batchSize}
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
      )}

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
