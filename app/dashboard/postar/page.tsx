"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Film, CalendarDays, Send, FolderOpen, X, Check,
  Loader2, AlertCircle, CheckCircle2, Plus, Trash2, Clock,
  Shuffle, Zap, List, Library, Save, BookMarked, BarChart2,
  RefreshCw, ChevronDown,
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

const VIDEO_COUNT_PRESETS = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "Todos", value: -1 },
];

const POSTS_PER_DAY_OPTIONS = [1, 2, 3, 4, 5];

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

// ── DistributePreview ──────────────────────────────────────────────────────

function DistributePreview({
  videosPerAccount,
  totalAccounts,
  postsPerDay,
  startDatetime,
  captionCount,
}: {
  videosPerAccount: number;
  totalAccounts: number;
  postsPerDay: number;
  startDatetime: string;
  captionCount: number;
}) {
  const intervalMinutes = Math.floor((24 * 60) / Math.max(1, postsPerDay));
  const days = videosPerAccount > 0 ? Math.ceil(videosPerAccount / Math.max(1, postsPerDay)) : 0;
  const totalPosts = videosPerAccount * Math.max(1, totalAccounts);

  const lastSlotIso = useMemo(() => {
    if (!startDatetime || videosPerAccount === 0) return null;
    try {
      // Last post = last account (+ stagger) + last video slot
      const lastAccountStagger = (Math.max(1, totalAccounts) - 1) * 5 * 60_000;
      const lastVideoSlot = (videosPerAccount - 1) * intervalMinutes * 60_000;
      return new Date(new Date(startDatetime).getTime() + lastVideoSlot + lastAccountStagger).toISOString();
    } catch { return null; }
  }, [startDatetime, videosPerAccount, totalAccounts, intervalMinutes]);

  const timelineSlots = useMemo(() => {
    if (!startDatetime || videosPerAccount === 0) return [];
    const slots = [];
    // Show first 3 days max (up to posts_per_day × 3 slots)
    const total = Math.min(postsPerDay * 3, videosPerAccount);
    for (let i = 0; i < total; i++) {
      const t = new Date(new Date(startDatetime).getTime() + i * intervalMinutes * 60_000);
      slots.push(t.toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }));
    }
    return slots;
  }, [startDatetime, postsPerDay, videosPerAccount, intervalMinutes]);

  const isReady = videosPerAccount > 0 && totalAccounts > 0 && startDatetime;

  return (
    <div className="glass-card rounded-2xl p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Zap size={14} className="text-[#00E5FF]" />
        <span className="text-xs font-semibold uppercase tracking-widest text-white/40">Resumo</span>
      </div>

      {!isReady ? (
        <p className="text-white/20 text-xs text-center py-4">
          Preencha os campos para ver o resumo
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Vídeos/conta", value: videosPerAccount, color: "text-[#00FF41]" },
              { label: "Contas", value: totalAccounts, color: "text-[#00E5FF]" },
              { label: "Total de posts", value: totalPosts, color: "text-white" },
              { label: "Duração", value: `${days}d`, color: "text-white" },
              { label: "Posts/dia", value: postsPerDay, color: "text-white/60" },
              { label: "Legendas", value: captionCount, color: "text-white/60" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/[0.03] rounded-xl px-3 py-2.5 border border-white/[0.06]">
                <p className="text-white/35 text-[10px] uppercase tracking-wider">{label}</p>
                <p className={cn("font-mono font-semibold text-base mt-0.5", color)}>{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-white/30 uppercase tracking-wider">Início</span>
              <span className="text-[#00FF41] font-mono">{formatDatetime(startDatetime)}</span>
            </div>
            {lastSlotIso && (
              <div className="flex justify-between text-[10px]">
                <span className="text-white/30 uppercase tracking-wider">Fim estimado</span>
                <span className="text-[#00E5FF] font-mono">{formatDatetime(lastSlotIso)}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#00FF41]/5 border border-[#00FF41]/20">
            <Shuffle size={12} className="text-[#00FF41] flex-shrink-0" />
            <p className="text-[10px] text-[#00FF41]/80">
              Cada conta recebe os vídeos em ordem aleatória única
            </p>
          </div>

          {timelineSlots.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-white/25 uppercase tracking-wider">
                Horários por conta (Conta 1)
              </p>
              {timelineSlots.slice(0, 6).map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[#00E5FF]/60 font-mono text-[10px] w-28 flex-shrink-0">{s}</span>
                  <div className="flex-1 h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#00FF41]/60 to-[#00E5FF]/60 w-full" />
                  </div>
                  <span className="text-white/30 text-[10px] w-16 text-right">{totalAccounts} conta{totalAccounts !== 1 ? "s" : ""}</span>
                </div>
              ))}
              {timelineSlots.length < videosPerAccount && (
                <p className="text-white/15 text-[10px]">+ {videosPerAccount - timelineSlots.length} slots restantes...</p>
              )}
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
        body: JSON.stringify({ title: saveTitle.trim() || null, content: content.trim() }),
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
                  <span className={cn("text-[10px] transition-colors", cap.length > MAX_CAPTION_CHARS * 0.9 ? "text-yellow-400" : "text-white/20")}>
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
                    </div>
                  ) : (
                    savedCaptions.map(sc => (
                      <div
                        key={sc.id}
                        className="group flex items-start gap-2 px-4 py-3 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04] last:border-0"
                      >
                        <button onClick={() => inject(sc.content)} className="flex-1 text-left min-w-0">
                          {sc.title && (
                            <p className="text-xs font-medium text-[#00E5FF]/80 truncate mb-0.5">{sc.title}</p>
                          )}
                          <p className="text-xs text-white/55 line-clamp-2 leading-relaxed">{sc.content}</p>
                          <p className="text-[9px] text-white/20 mt-1">Clique para usar</p>
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

// ── CampaignsList ──────────────────────────────────────────────────────────

function CampaignsList({ accounts, onCreateNew }: { accounts: Account[]; onCreateNew: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns");
      const d = await res.json() as { campaigns: Campaign[] };
      setCampaigns(d.campaigns ?? []);
    } catch {/* silent */} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

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
    } finally { setDeletingId(null); }
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
        <p className="text-white/15 text-xs mb-5">Crie sua primeira distribuição</p>
        <button
          onClick={onCreateNew}
          className="px-5 py-2.5 rounded-xl bg-[#00FF41]/10 text-[#00FF41] text-sm font-medium hover:bg-[#00FF41]/20 transition-all border border-[#00FF41]/20"
        >
          Nova Distribuição
        </button>
      </div>
    );
  }

  const running = campaigns.filter(c => c.campaign_status === "running");

  return (
    <div className="max-w-3xl mx-auto">
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

      <div className="space-y-3">
        {campaigns.map(campaign => {
          const progress = campaign.total > 0 ? Math.round((campaign.published / campaign.total) * 100) : 0;
          const isRunning = campaign.campaign_status === "running";
          const isDeleting = deletingId === campaign.campaign_id;
          const isConfirming = confirmDelete === campaign.campaign_id;
          const campAccounts = campaign.account_ids.map(id => accountMap.get(id)).filter(Boolean) as Account[];

          return (
            <motion.div
              key={campaign.campaign_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="glass-card rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn("w-2 h-2 rounded-full flex-shrink-0 mt-0.5", isRunning ? "bg-[#00FF41] shadow-[0_0_6px_rgba(0,255,65,0.8)]" : "bg-white/15")} />
                  <div className="min-w-0">
                    <p className="text-white/60 font-mono text-xs tracking-wider">#{campaign.campaign_id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-white/25 text-[10px] mt-0.5">Criada {formatDatetime(campaign.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn(
                    "px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide border whitespace-nowrap",
                    isRunning ? "bg-[#00FF41]/10 text-[#00FF41] border-[#00FF41]/20" : "bg-white/[0.04] text-white/25 border-white/[0.08]"
                  )}>
                    {isRunning ? "🟢 Executando" : "⚫ Concluída"}
                  </span>
                  <button
                    onClick={() => handleDelete(campaign.campaign_id)}
                    disabled={isDeleting}
                    className={cn(
                      "w-7 h-7 rounded-lg border flex items-center justify-center transition-all text-xs",
                      isConfirming ? "bg-red-500/15 border-red-500/40 text-red-400 font-bold" : "bg-white/[0.04] border-white/[0.08] text-white/25 hover:text-red-400 hover:border-red-400/25 hover:bg-red-400/8",
                      isDeleting && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    {isDeleting ? <Loader2 size={11} className="animate-spin" /> : isConfirming ? "?" : <Trash2 size={11} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/40">{campaign.published} de {campaign.total} posts publicados</span>
                  <span className={cn("font-mono font-bold", progress >= 100 ? "text-[#00FF41]" : isRunning ? "text-[#00E5FF]" : "text-white/30")}>{progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                    className={cn("h-full rounded-full", progress >= 100 ? "bg-[#00FF41]" : "bg-gradient-to-r from-[#00FF41]/70 to-[#00E5FF]/70")}
                  />
                </div>
                {(campaign.failed > 0 || campaign.pending > 0) && (
                  <div className="flex gap-3 text-[10px]">
                    {campaign.pending > 0 && <span className="text-yellow-400/60">{campaign.pending} pendente{campaign.pending !== 1 ? "s" : ""}</span>}
                    {campaign.failed > 0 && <span className="text-red-400/60">{campaign.failed} falha{campaign.failed !== 1 ? "s" : ""}</span>}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-1.5">
                    {campAccounts.slice(0, 5).map(acc => (
                      acc.avatar_url ? (
                        <img key={acc.id} src={acc.avatar_url} alt={acc.username} title={`@${acc.username}`} className="w-5 h-5 rounded-full border border-black object-cover" />
                      ) : (
                        <div key={acc.id} title={`@${acc.username}`} className="w-5 h-5 rounded-full border border-black bg-gradient-to-br from-[#00FF41]/30 to-[#00E5FF]/30" />
                      )
                    ))}
                    {campAccounts.length === 0 && campaign.account_ids.slice(0, 5).map(id => (
                      <div key={id} className="w-5 h-5 rounded-full border border-black bg-white/10" />
                    ))}
                    {campaign.account_ids.length > 5 && (
                      <div className="w-5 h-5 rounded-full border border-black bg-white/10 flex items-center justify-center">
                        <span className="text-[7px] text-white/40">+{campaign.account_ids.length - 5}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-white/25 text-[10px]">{campaign.account_ids.length} conta{campaign.account_ids.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="text-right text-[10px] flex-shrink-0">
                  {isRunning && campaign.next_pending ? (
                    <span className="flex items-center gap-1 text-[#00E5FF]/60"><Clock size={9} />Próximo: {formatDatetime(campaign.next_pending)}</span>
                  ) : (
                    <span className="text-white/20">Encerrada: {formatDatetime(campaign.last_slot)}</span>
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
  const [activeTab, setActiveTab] = useState<"create" | "campaigns">("create");

  // Accounts
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  // Folder
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [folderVideoCount, setFolderVideoCount] = useState<number>(0);
  const [loadingFolderCount, setLoadingFolderCount] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);

  // Distribution
  const [videoCount, setVideoCount] = useState<number>(20);      // -1 = todos
  const [postsPerDay, setPostsPerDay] = useState<number>(2);
  const [startDatetime, setStartDatetime] = useState("");

  // Captions
  const [captions, setCaptions] = useState<string[]>(["", ""]);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    total_posts: number; videos_per_account: number; days: number;
    accounts: number; first_slot: string; last_slot: string;
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

  useEffect(() => {
    setLoadingFolders(true);
    fetch("/api/library/folders")
      .then(r => r.json() as Promise<{ folders: FolderItem[] }>)
      .then(d => setFolders(d.folders ?? []))
      .finally(() => setLoadingFolders(false));
  }, []);

  useEffect(() => {
    if (!selectedFolderId) { setFolderVideoCount(0); return; }
    setLoadingFolderCount(true);
    fetch(`/api/library?folderId=${selectedFolderId}`)
      .then(r => r.json() as Promise<{ videos: { id: string }[] }>)
      .then(d => setFolderVideoCount(d.videos?.length ?? 0))
      .finally(() => setLoadingFolderCount(false));
  }, [selectedFolderId]);

  // ── Computed ───────────────────────────────────────────────────────────────

  const videosPerAccount = videoCount === -1
    ? folderVideoCount
    : Math.min(videoCount, folderVideoCount);

  const validCaptions = captions.filter(c => c.trim().length > 0);
  const selectedFolder = folders.find(f => f.id === selectedFolderId);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleAccount = (id: string) =>
    setSelectedAccountIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleSubmit = async () => {
    if (selectedAccountIds.length === 0) { setSubmitError("Selecione ao menos 1 conta."); return; }
    if (!selectedFolderId) { setSubmitError("Selecione uma pasta de mídia."); return; }
    if (folderVideoCount === 0) { setSubmitError("A pasta selecionada está vazia."); return; }
    if (validCaptions.length === 0) { setSubmitError("Adicione ao menos 1 legenda."); return; }
    if (!startDatetime) { setSubmitError("Defina a data e hora de início."); return; }

    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/posts/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids: selectedAccountIds,
          folder_id: selectedFolderId,
          video_count: videoCount,
          posts_per_day: postsPerDay,
          start_at: new Date(startDatetime).toISOString(),
          captions: validCaptions,
        }),
      });

      const data = await res.json() as {
        success?: boolean; error?: string;
        total_posts?: number; videos_per_account?: number;
        days?: number; accounts?: number; first_slot?: string; last_slot?: string;
      };

      if (!res.ok || data.error) {
        setSubmitError(data.error ?? "Erro ao criar distribuição.");
        return;
      }

      setSelectedAccountIds([]);
      setSelectedFolderId("");
      setFolderVideoCount(0);
      setStartDatetime("");
      setVideoCount(20);
      setPostsPerDay(2);
      setCaptions(["", ""]);

      setSuccess({
        total_posts: data.total_posts ?? 0,
        videos_per_account: data.videos_per_account ?? 0,
        days: data.days ?? 0,
        accounts: data.accounts ?? 0,
        first_slot: data.first_slot ?? "",
        last_slot: data.last_slot ?? "",
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
    setSelectedAccountIds([]);
    setSelectedFolderId("");
    setFolderVideoCount(0);
    setStartDatetime("");
    setVideoCount(20);
    setPostsPerDay(2);
    setCaptions(["", ""]);
    setActiveTab("create");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="page-title">Distribuição de Conteúdo</h1>
        <p className="page-subtitle">Distribua vídeos de uma pasta para múltiplas contas com ordem aleatória única por conta</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.07] mb-6 gap-1">
        {([
          { id: "create", label: "Nova Distribuição", Icon: Film },
          { id: "campaigns", label: "Campanhas Ativas", Icon: BarChart2 },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
              activeTab === id ? "border-[#00FF41] text-[#00FF41]" : "border-transparent text-white/35 hover:text-white/60"
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Success banner */}
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
              <span className="font-semibold">{success.total_posts} posts</span> criados —{" "}
              <span className="font-semibold">{success.videos_per_account} vídeos</span> por conta em{" "}
              <span className="font-semibold">{success.days} dia{success.days !== 1 ? "s" : ""}</span>
              {" · "}Início: {formatDatetime(success.first_slot)}
            </p>
            <button onClick={() => setSuccess(null)} className="text-[#00FF41]/40 hover:text-[#00FF41] transition-colors flex-shrink-0">
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {activeTab === "campaigns" ? (
        <CampaignsList accounts={accounts} onCreateNew={handleReset} />
      ) : (
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* Form */}
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
                    <button onClick={() => setSelectedAccountIds(accounts.map(a => a.id))} className="text-xs text-[#00FF41]/70 hover:text-[#00FF41] transition-colors">
                      Todas
                    </button>
                    <span className="text-white/15 text-xs">·</span>
                    <button onClick={() => setSelectedAccountIds([])} className="text-xs text-white/30 hover:text-white/60 transition-colors">
                      Nenhuma
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
                          isSelected ? "border-[#00FF41]/40 bg-[#00FF41]/5" : "border-white/[0.07] bg-white/[0.02] hover:border-white/15"
                        )}
                      >
                        <div className={cn("w-4 h-4 rounded-[4px] border flex items-center justify-center flex-shrink-0 transition-all", isSelected ? "bg-[#00FF41] border-[#00FF41]" : "border-white/20")}>
                          {isSelected && <Check size={9} className="text-black" strokeWidth={3} />}
                        </div>
                        {acc.avatar_url ? (
                          <img src={acc.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#00FF41]/40 to-[#00E5FF]/40 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">@{acc.username}</p>
                          {acc.display_name && <p className="text-xs text-white/35 truncate">{acc.display_name}</p>}
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

            {/* 2. Pasta + Quantidade */}
            <SectionCard>
              <SectionLabel Icon={FolderOpen}>Pasta de Mídia</SectionLabel>

              {/* Folder selector */}
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
                <div className="relative mb-4">
                  <button
                    onClick={() => setFolderOpen(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 hover:border-white/20 transition-colors"
                  >
                    <span className={cn("text-sm", selectedFolder ? "text-white" : "text-white/30")}>
                      {selectedFolder
                        ? `📁 ${selectedFolder.name} · ${folderVideoCount} vídeos`
                        : "Selecionar pasta..."}
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

              {/* Quantidade */}
              <div>
                <p className="text-xs text-white/40 font-medium mb-3 uppercase tracking-wider">Quantos vídeos postar</p>
                <div className="flex gap-2">
                  {VIDEO_COUNT_PRESETS.map(({ label, value }) => {
                    const isDisabled = value !== -1 && value > folderVideoCount && folderVideoCount > 0;
                    return (
                      <button
                        key={value}
                        onClick={() => !isDisabled && setVideoCount(value)}
                        disabled={isDisabled}
                        className={cn(
                          "flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border",
                          videoCount === value
                            ? "bg-[#00FF41]/15 text-[#00FF41] border-[#00FF41]/30"
                            : isDisabled
                              ? "bg-white/[0.02] text-white/15 border-white/[0.05] cursor-not-allowed"
                              : "bg-white/[0.04] text-white/40 border-white/[0.07] hover:border-white/20 hover:text-white/70"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {selectedFolderId && !loadingFolderCount && folderVideoCount > 0 && (
                  <p className="mt-2 text-[11px] text-white/30">
                    {videosPerAccount === folderVideoCount
                      ? `Todos os ${folderVideoCount} vídeos da pasta serão usados`
                      : `${videosPerAccount} de ${folderVideoCount} vídeos serão usados`}
                  </p>
                )}
                {loadingFolderCount && <p className="mt-2 text-xs text-white/30 flex items-center gap-1.5"><Loader2 size={10} className="animate-spin" /> Contando...</p>}
              </div>
            </SectionCard>

            {/* 3. Cadência */}
            <SectionCard>
              <SectionLabel Icon={CalendarDays}>Cadência</SectionLabel>

              {/* Posts por dia */}
              <div className="mb-5">
                <p className="text-xs text-white/40 font-medium mb-3 uppercase tracking-wider">Posts por dia por conta</p>
                <div className="flex gap-2">
                  {POSTS_PER_DAY_OPTIONS.map(n => (
                    <button
                      key={n}
                      onClick={() => setPostsPerDay(n)}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-sm font-bold transition-all border",
                        postsPerDay === n
                          ? "bg-[#00E5FF]/15 text-[#00E5FF] border-[#00E5FF]/30"
                          : "bg-white/[0.04] text-white/40 border-white/[0.07] hover:border-white/20 hover:text-white/70"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {postsPerDay > 0 && (
                  <p className="mt-2 text-[11px] text-white/30">
                    Intervalo de ~{Math.floor(24 / postsPerDay)}h entre posts
                    {postsPerDay === 1 && " — 1 post por dia"}
                    {postsPerDay === 2 && " — manhã e noite"}
                    {postsPerDay === 3 && " — manhã, tarde e noite"}
                  </p>
                )}
              </div>

              {/* Start datetime */}
              <div>
                <p className="text-xs text-white/40 font-medium mb-3 uppercase tracking-wider">Data e hora do primeiro post</p>
                <input
                  type="datetime-local"
                  value={startDatetime}
                  min={minDatetime}
                  onChange={e => setStartDatetime(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm focus:outline-none focus:border-[#00FF41]/40 focus:ring-1 focus:ring-[#00FF41]/20 transition-all [color-scheme:dark]"
                />
              </div>

              {/* Summary */}
              <AnimatePresence>
                {videosPerAccount > 0 && startDatetime && selectedAccountIds.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="mt-5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]"
                  >
                    {(() => {
                      const days = Math.ceil(videosPerAccount / postsPerDay);
                      const totalPosts = videosPerAccount * selectedAccountIds.length;
                      return (
                        <p className="text-xs text-white/55 leading-relaxed">
                          <span className="text-[#00FF41] font-semibold">{videosPerAccount}</span> vídeos ×{" "}
                          <span className="text-[#00E5FF] font-semibold">{selectedAccountIds.length}</span> conta{selectedAccountIds.length !== 1 ? "s" : ""} ={" "}
                          <span className="text-white font-semibold">{totalPosts}</span> posts ao longo de{" "}
                          <span className="text-white font-semibold">{days}</span> dia{days !== 1 ? "s" : ""}.
                          {" "}Cada conta recebe os vídeos em ordem aleatória única.
                        </p>
                      );
                    })()}
                  </motion.div>
                )}
              </AnimatePresence>
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
                submitting ? "bg-[#00FF41]/50 cursor-not-allowed" : "bg-[#00FF41] hover:bg-[#00FF41]/90 hover:shadow-[0_0_28px_rgba(0,255,65,0.35)]"
              )}
            >
              {submitting ? (
                <><Loader2 size={16} className="animate-spin text-black/70" /> Criando distribuição...</>
              ) : (
                <><Send size={16} /> Criar Distribuição
                  {videosPerAccount > 0 && selectedAccountIds.length > 0 && (
                    <span className="ml-1 opacity-70">
                      ({videosPerAccount * selectedAccountIds.length} posts · {selectedAccountIds.length} conta{selectedAccountIds.length !== 1 ? "s" : ""})
                    </span>
                  )}
                </>
              )}
            </button>
          </div>

          {/* Preview */}
          <div className="w-full lg:w-72 lg:sticky lg:top-8 flex-shrink-0">
            <DistributePreview
              videosPerAccount={videosPerAccount}
              totalAccounts={selectedAccountIds.length}
              postsPerDay={postsPerDay}
              startDatetime={startDatetime}
              captionCount={validCaptions.length}
            />

            <div className="mt-4 glass-card rounded-2xl p-4 space-y-2.5">
              <p className="text-[10px] text-white/25 uppercase tracking-wider">Como funciona</p>
              {[
                { icon: Shuffle, text: "Cada conta recebe os vídeos em uma ordem aleatória diferente" },
                { icon: CalendarDays, text: "Posts distribuídos uniformemente ao longo do dia" },
                { icon: Clock, text: "5 min de stagger entre contas — sem burst simultâneo" },
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
    </div>
  );
}
