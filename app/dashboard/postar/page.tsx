"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Film, CalendarDays, Send, FolderOpen, X, Check,
  Loader2, AlertCircle, CheckCircle2, Plus, Trash2, Clock,
  Shuffle, Zap, List, Library, Save, BookMarked, BarChart2,
  RefreshCw, ChevronDown, Sparkles,
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
  last_published_at: string | null;
  last_error_message: string | null;
  account_ids: string[];
  campaign_status: "running" | "completed";
  created_at: string;
}

// ── Campaign helpers ────────────────────────────────────────────────────────

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

const VIDEO_COUNT_PRESETS = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "Todos", value: -1 },
];

const POSTS_PER_DAY_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24, 36, 48, 72];

const MAX_CAPTION_CHARS = 2200;

const AUTO_CAPTION_TYPES_POSTAR = [
  { id: "curiosidades-gerais", label: "Curiosidades Gerais", emoji: "💡", desc: "Fatos do dia a dia" },
  { id: "curiosidades-tops",   label: "Curiosidades Tops",   emoji: "🏆", desc: "Fatos virais e surpreendentes" },
  { id: "fatos-complexos",     label: "Fatos Complexos",     emoji: "🔬", desc: "Ciência acessível" },
] as const;

const AUTO_CAPTION_PREVIEWS_POSTAR: Record<string, string> = {
  "curiosidades-gerais": "🍯 O mel nunca estraga. Arqueólogos encontraram potes com mais de 3.000 anos nas pirâmides do Egito — e ainda estavam comestíveis!",
  "curiosidades-tops":   "🤯 INACREDITÁVEL: Você existe porque TODOS os seus ancestrais sobreviveram e tiveram filhos desde o início da vida na Terra. Você é um milagre de bilhões de anos!",
  "fatos-complexos":     "🧠 A memória humana não funciona como um HD. Cada vez que você se lembra de algo, reconstrói a memória do zero — e a modifica sutilmente.",
};

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
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const fetchCampaigns = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/campaigns");
      const d = await res.json() as { campaigns: Campaign[] };
      setCampaigns(d.campaigns ?? []);
    } catch {/* silent */} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  // Auto-refresh every 15s when there are running campaigns
  useEffect(() => {
    const hasRunning = campaigns.some(c => c.campaign_status === "running");
    if (!hasRunning) return;
    const interval = setInterval(() => fetchCampaigns(true), 15_000);
    return () => clearInterval(interval);
  }, [campaigns, fetchCampaigns]);

  // Tick every 10s so time displays stay fresh between API calls
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 10_000);
    return () => clearInterval(t);
  }, []);

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
      await fetch(`/api/campaigns?id=${encodeURIComponent(campaignId)}&hard=true`, { method: "DELETE" });
      await fetchCampaigns(true);
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
        <button onClick={onCreateNew} className="px-5 py-2.5 rounded-xl bg-[#00FF41]/10 text-[#00FF41] text-sm font-medium hover:bg-[#00FF41]/20 transition-all border border-[#00FF41]/20">
          Nova Distribuição
        </button>
      </div>
    );
  }

  const running = campaigns.filter(c => c.campaign_status === "running");

  // Suppress lint warning — tick is read to force re-render for live time displays
  void tick;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4 text-xs text-white/30">
          {running.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41] shadow-[0_0_4px_#00FF41] animate-pulse" />
              <span className="text-[#00FF41]/70">{running.length} executando</span>
            </span>
          )}
          <span>{campaigns.length} campanha{campaigns.length !== 1 ? "s" : ""}</span>
        </div>
        <button
          onClick={() => fetchCampaigns(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/40 hover:text-[#00E5FF] hover:border-[#00E5FF]/20 transition-all disabled:opacity-40"
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Atualizando…" : "Atualizar"}
        </button>
      </div>

      <div className="space-y-4">
        {campaigns.map(campaign => {
          const progress     = campaign.total > 0 ? Math.round((campaign.published / campaign.total) * 100) : 0;
          const isRunning    = campaign.campaign_status === "running";
          const isDeleting   = deletingId === campaign.campaign_id;
          const isConfirming = confirmDelete === campaign.campaign_id;
          const campAccounts = campaign.account_ids.map(id => accountMap.get(id)).filter(Boolean) as Account[];
          const hasFailed    = campaign.failed > 0;
          const isOverdue    = isRunning && campaign.next_pending != null && new Date(campaign.next_pending) < new Date();
          const recentPub    = campaign.last_published_at && (Date.now() - new Date(campaign.last_published_at).getTime()) < 30 * 60_000;
          const errExpanded  = expandedError === campaign.campaign_id;

          // Dynamic status
          let statusLabel: string, statusCls: string, statusBorder: string, dotCls: string, dotPulse = false;
          if (!isRunning) {
            statusLabel = "Concluída"; statusCls = "bg-[#00FF41]/10 text-[#00FF41]"; statusBorder = "border-[#00FF41]/20"; dotCls = "bg-[#00FF41]";
          } else if (isOverdue) {
            statusLabel = "Atrasada"; statusCls = "bg-amber-500/10 text-amber-400"; statusBorder = "border-amber-500/20"; dotCls = "bg-amber-400"; dotPulse = true;
          } else if (recentPub) {
            statusLabel = "Publicando"; statusCls = "bg-[#00FF41]/10 text-[#00FF41]"; statusBorder = "border-[#00FF41]/20"; dotCls = "bg-[#00FF41]"; dotPulse = true;
          } else {
            statusLabel = "Na Fila"; statusCls = "bg-[#00E5FF]/10 text-[#00E5FF]"; statusBorder = "border-[#00E5FF]/20"; dotCls = "bg-[#00E5FF]";
          }

          const cardBorder = isOverdue
            ? "border-amber-500/15"
            : hasFailed && !isRunning
              ? "border-red-500/15"
              : isRunning
                ? "border-[#00E5FF]/10"
                : "border-white/[0.08]";

          return (
            <motion.div
              key={campaign.campaign_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn("glass-card rounded-2xl p-5 space-y-4 border", cardBorder)}
            >
              {/* ── Header ── */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn("w-2 h-2 rounded-full shrink-0 mt-0.5", dotCls, dotPulse && "animate-pulse")} />
                  <div className="min-w-0">
                    <p className="text-white/60 font-mono text-xs tracking-wider">#{campaign.campaign_id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-white/25 text-[10px] mt-0.5">Criada {formatDatetime(campaign.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border whitespace-nowrap", statusCls, statusBorder)}>
                    {statusLabel === "Concluída"  && <CheckCircle2 size={9} />}
                    {statusLabel === "Na Fila"    && <Clock size={9} />}
                    {statusLabel === "Publicando" && <Loader2 size={9} className="animate-spin" />}
                    {statusLabel === "Atrasada"   && <AlertCircle size={9} />}
                    {statusLabel}
                  </span>
                  <button
                    onClick={() => handleDelete(campaign.campaign_id)}
                    disabled={isDeleting}
                    className={cn(
                      "w-7 h-7 rounded-lg border flex items-center justify-center transition-all",
                      isConfirming ? "bg-red-500/15 border-red-500/40 text-red-400" : "bg-white/[0.04] border-white/[0.08] text-white/25 hover:text-red-400 hover:border-red-400/25",
                      isDeleting && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    {isDeleting ? <Loader2 size={11} className="animate-spin" /> : isConfirming ? <Check size={11} /> : <Trash2 size={11} />}
                  </button>
                </div>
              </div>

              {/* ── Progress ── */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/40 tabular-nums">{campaign.published} de {campaign.total} posts publicados</span>
                  <span className={cn("font-bold tabular-nums", progress >= 100 ? "text-[#00FF41]" : isRunning ? "text-[#00E5FF]" : "text-white/30")}>{progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                    className={cn("h-full rounded-full", hasFailed && !isRunning ? "bg-red-500/50" : "bg-gradient-to-r from-[#00FF41]/70 to-[#00E5FF]/70")}
                  />
                </div>
              </div>

              {/* ── Stats row ── */}
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <span className="text-white/25 text-[9px] uppercase tracking-wider">Fila</span>
                  <span className={cn("font-bold tabular-nums", campaign.pending > 0 ? "text-[#00E5FF]" : "text-white/20")}>{campaign.pending}</span>
                </div>
                <div className={cn("flex flex-col gap-0.5 px-3 py-2 rounded-xl border", hasFailed ? "bg-red-500/[0.04] border-red-500/15" : "bg-white/[0.03] border-white/[0.04]")}>
                  <span className="text-white/25 text-[9px] uppercase tracking-wider">Falhas</span>
                  <span className={cn("font-bold tabular-nums", hasFailed ? "text-red-400" : "text-white/20")}>{campaign.failed}</span>
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <span className="text-white/25 text-[9px] uppercase tracking-wider">Cancelados</span>
                  <span className="font-bold tabular-nums text-white/25">{campaign.cancelled}</span>
                </div>
              </div>

              {/* ── Timing row ── */}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <span className="text-white/25 text-[9px] uppercase tracking-wider">Último publicado</span>
                  <span className={cn("font-medium", campaign.last_published_at ? "text-[#00FF41]" : "text-white/20")}>
                    {campTimeAgo(campaign.last_published_at)}
                  </span>
                </div>
                <div className={cn("flex flex-col gap-0.5 px-3 py-2 rounded-xl border", isOverdue ? "bg-amber-500/[0.04] border-amber-500/15" : "bg-white/[0.03] border-white/[0.04]")}>
                  <span className="text-white/25 text-[9px] uppercase tracking-wider">
                    {isRunning ? "Próximo" : "Encerrada em"}
                  </span>
                  {isRunning ? (
                    <span className={cn("font-medium", isOverdue ? "text-amber-400" : "text-[#00E5FF]")}>
                      {isOverdue ? "⏱ " : ""}{campTimeIn(campaign.next_pending)}
                    </span>
                  ) : (
                    <span className="font-medium text-white/25 text-[10px]">{formatDatetime(campaign.last_slot)}</span>
                  )}
                </div>
              </div>

              {/* ── Overdue warning ── */}
              {isOverdue && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/[0.05] border border-amber-500/15">
                  <AlertCircle size={11} className="text-amber-400/80 shrink-0" />
                  <span className="text-[10px] text-amber-400/80">Post atrasado — o cron publicará na próxima execução (≤1 min)</span>
                </div>
              )}

              {/* ── Error message ── */}
              {hasFailed && campaign.last_error_message && (
                <div
                  className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/[0.05] border border-red-500/15 cursor-pointer"
                  onClick={() => setExpandedError(errExpanded ? null : campaign.campaign_id)}
                >
                  <AlertCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[10px] text-red-400/80 leading-relaxed break-all", !errExpanded && "line-clamp-1")}>
                      {campaign.last_error_message}
                    </p>
                    {campaign.last_error_message.length > 55 && (
                      <p className="text-[9px] text-red-500/50 mt-0.5">{errExpanded ? "▲ ocultar" : "▼ ver tudo"}</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Footer: accounts ── */}
              <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
                <div className="flex -space-x-1.5">
                  {campAccounts.slice(0, 6).map(acc => (
                    acc.avatar_url
                      ? <img key={acc.id} src={acc.avatar_url} alt={acc.username} title={`@${acc.username}`} className="w-5 h-5 rounded-full border border-black object-cover" />
                      : <div key={acc.id} title={`@${acc.username}`} className="w-5 h-5 rounded-full border border-black bg-gradient-to-br from-[#00FF41]/30 to-[#00E5FF]/30 flex items-center justify-center"><span className="text-[7px] font-bold text-black">{acc.username.charAt(0).toUpperCase()}</span></div>
                  ))}
                  {campAccounts.length === 0 && campaign.account_ids.slice(0, 6).map(id => (
                    <div key={id} className="w-5 h-5 rounded-full border border-black bg-white/10" />
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [accountsWithCampaign, setAccountsWithCampaign] = useState<Set<string>>(new Set());

  // Folder
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [folderVideoCount, setFolderVideoCount] = useState<number>(0);
  const [folderOpen, setFolderOpen] = useState(false);

  // Distribution
  const [videoCount, setVideoCount] = useState<number>(20);      // -1 = todos
  const [postsPerDay, setPostsPerDay] = useState<number>(2);
  const [startDatetime, setStartDatetime] = useState("");

  // Captions
  const [captions, setCaptions] = useState<string[]>(["", ""]);
  const [autoCaptionEnabled, setAutoCaptionEnabled] = useState(false);
  const [autoCaptionType, setAutoCaptionType] = useState("curiosidades-gerais");

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
    fetch("/api/campaigns")
      .then(r => r.json() as Promise<{ campaigns: Campaign[] }>)
      .then(d => {
        const ids = new Set<string>();
        (d.campaigns ?? [])
          .filter(c => c.campaign_status === "running")
          .forEach(c => c.account_ids.forEach(id => ids.add(id)));
        setAccountsWithCampaign(ids);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoadingFolders(true);
    fetch("/api/library/folders")
      .then(r => r.json() as Promise<{ folders: FolderItem[] }>)
      .then(d => setFolders(d.folders ?? []))
      .finally(() => setLoadingFolders(false));
  }, []);

  useEffect(() => {
    const folder = folders.find(f => f.id === selectedFolderId);
    setFolderVideoCount(folder?.video_count ?? 0);
  }, [selectedFolderId, folders]);

  // ── Computed ───────────────────────────────────────────────────────────────

  const videosPerAccount = videoCount === -1
    ? folderVideoCount
    : Math.min(videoCount, folderVideoCount);

  const validCaptions = captions.filter(c => c.trim().length > 0);
  const selectedFolder = folders.find(f => f.id === selectedFolderId);
  const accountsWithoutCampaign = accounts.filter(a => !accountsWithCampaign.has(a.id));

  // Agrupa contas por pasta — sem pasta fica no final
  const accountsByFolder = useMemo(() => {
    const folderMap = new Map<string, { name: string; accounts: Account[] }>();
    const noFolder: Account[] = [];
    for (const acc of accounts) {
      if (acc.folder_id && acc.account_folders) {
        if (!folderMap.has(acc.folder_id)) {
          folderMap.set(acc.folder_id, { name: acc.account_folders.name, accounts: [] });
        }
        folderMap.get(acc.folder_id)!.accounts.push(acc);
      } else {
        noFolder.push(acc);
      }
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
    if (allSelected) {
      setSelectedAccountIds(prev => prev.filter(id => !ids.includes(id)));
    } else {
      setSelectedAccountIds(prev => [...new Set([...prev, ...ids])]);
    }
  };

  const toggleExpand = (folderId: string) =>
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });

  const handleSubmit = async () => {
    if (selectedAccountIds.length === 0) { setSubmitError("Selecione ao menos 1 conta."); return; }
    if (!selectedFolderId) { setSubmitError("Selecione uma pasta de mídia."); return; }
    if (folderVideoCount === 0) { setSubmitError("A pasta selecionada está vazia."); return; }
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
          captions: autoCaptionEnabled ? [] : validCaptions,
          auto_caption_type: autoCaptionEnabled ? autoCaptionType : undefined,
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setSelectedAccountIds(accounts.map(a => a.id))} className="text-xs text-[#00FF41]/70 hover:text-[#00FF41] transition-colors">
                      Todas
                    </button>
                    <span className="text-white/15 text-xs">·</span>
                    <button onClick={() => setSelectedAccountIds([])} className="text-xs text-white/30 hover:text-white/60 transition-colors">
                      Nenhuma
                    </button>
                    {accountsWithCampaign.size > 0 && accountsWithoutCampaign.length > 0 && (
                      <>
                        <span className="text-white/15 text-xs">·</span>
                        <button
                          onClick={() => setSelectedAccountIds(accountsWithoutCampaign.map(a => a.id))}
                          className="text-xs text-red-400/80 hover:text-red-400 transition-colors font-medium"
                        >
                          Novas ({accountsWithoutCampaign.length})
                        </button>
                      </>
                    )}
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
                <div className="space-y-1.5">
                  {accountsByFolder.map(group => {
                    const groupIds = group.accounts.map(a => a.id);
                    const allSelected = groupIds.length > 0 && groupIds.every(id => selectedAccountIds.includes(id));
                    const someSelected = groupIds.some(id => selectedAccountIds.includes(id));
                    const isExpanded = expandedFolders.has(group.id);
                    const isNoFolder = group.id === "__no_folder__";
                    return (
                      <div key={group.id}>
                        {/* Folder header — clique expande/fecha */}
                        <div
                          className={cn(
                            "flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all cursor-pointer group",
                            isExpanded
                              ? allSelected ? "border-[#00FF41]/30 bg-[#00FF41]/5" : someSelected ? "border-[#00E5FF]/20 bg-[#00E5FF]/3" : "border-white/12 bg-white/[0.03]"
                              : allSelected ? "border-[#00FF41]/25 bg-[#00FF41]/4" : someSelected ? "border-[#00E5FF]/15 bg-[#00E5FF]/[0.02]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/12"
                          )}
                          onClick={() => toggleExpand(group.id)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ChevronDown
                              size={13}
                              className={cn("flex-shrink-0 transition-transform duration-200 text-white/30", isExpanded && "rotate-180")}
                            />
                            <span className="text-sm leading-none">{isNoFolder ? "📂" : "📁"}</span>
                            <span className={cn("text-sm font-medium truncate", allSelected ? "text-[#00FF41]" : someSelected ? "text-[#00E5FF]" : "text-white/60 group-hover:text-white/80")}>
                              {group.name}
                            </span>
                            <span className="text-xs text-white/25 font-mono flex-shrink-0">({group.accounts.length})</span>
                            {someSelected && (
                              <span className="text-[10px] text-white/30 flex-shrink-0">
                                · {groupIds.filter(id => selectedAccountIds.includes(id)).length} sel.
                              </span>
                            )}
                          </div>
                          {/* Botão selecionar pasta — stopPropagation para não fechar */}
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); toggleFolder(group.accounts); }}
                            className={cn(
                              "flex-shrink-0 text-[10px] px-2.5 py-1 rounded-lg border transition-all ml-2",
                              allSelected
                                ? "border-[#00FF41]/30 text-[#00FF41]/70 hover:bg-[#00FF41]/10"
                                : "border-white/[0.08] text-white/30 hover:border-[#00FF41]/30 hover:text-[#00FF41]/60"
                            )}
                          >
                            {allSelected ? "desmarcar" : "selecionar"}
                          </button>
                        </div>

                        {/* Chips — visíveis só quando expandido */}
                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.18 }}
                              className="overflow-hidden"
                            >
                              <div className="flex flex-wrap gap-1.5 pt-2 pl-2 pb-1">
                                {group.accounts.map(acc => {
                                  const isSelected = selectedAccountIds.includes(acc.id);
                                  const hasCampaign = accountsWithCampaign.has(acc.id);
                                  const isNew = !hasCampaign && accountsWithCampaign.size > 0;
                                  return (
                                    <button
                                      key={acc.id}
                                      type="button"
                                      onClick={() => toggleAccount(acc.id)}
                                      className={cn(
                                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all relative",
                                        isSelected
                                          ? "border-[#00FF41]/40 bg-[#00FF41]/8 text-[#00FF41]"
                                          : isNew
                                            ? "border-red-500/30 bg-red-500/[0.05] text-white/70 hover:border-red-400/50"
                                            : "border-white/[0.08] bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white/80"
                                      )}
                                    >
                                      {isNew && !isSelected && (
                                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400/80" />
                                      )}
                                      {acc.avatar_url ? (
                                        <img src={acc.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                                      ) : (
                                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#00FF41]/40 to-[#00E5FF]/40 flex-shrink-0 flex items-center justify-center">
                                          <span className="text-[8px] font-bold text-black">{acc.username.charAt(0).toUpperCase()}</span>
                                        </div>
                                      )}
                                      <span className="text-xs font-medium leading-none">@{acc.username}</span>
                                      {isSelected && <Check size={9} className="text-[#00FF41] flex-shrink-0" strokeWidth={3} />}
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
                {selectedFolderId && folderVideoCount > 0 && (
                  <p className="mt-2 text-[11px] text-white/30">
                    {videosPerAccount === folderVideoCount
                      ? `Todos os ${folderVideoCount} vídeos da pasta serão usados`
                      : `${videosPerAccount} de ${folderVideoCount} vídeos serão usados`}
                  </p>
                )}
              </div>
            </SectionCard>

            {/* 3. Cadência */}
            <SectionCard>
              <SectionLabel Icon={CalendarDays}>Cadência</SectionLabel>

              {/* Posts por dia */}
              <div className="mb-5">
                <p className="text-xs text-white/40 font-medium mb-3 uppercase tracking-wider">Posts por dia por conta</p>
                <div className="flex flex-wrap gap-2">
                  {POSTS_PER_DAY_OPTIONS.map(n => {
                    const mins = Math.floor((24 * 60) / n);
                    const hint = mins >= 60
                      ? `${Math.floor(mins / 60)}h`
                      : `${mins}min`;
                    return (
                      <button
                        key={n}
                        onClick={() => setPostsPerDay(n)}
                        title={`Intervalo: ~${hint} entre posts`}
                        className={cn(
                          "flex flex-col items-center px-3.5 py-2 rounded-xl border transition-all",
                          postsPerDay === n
                            ? "bg-[#00E5FF]/15 text-[#00E5FF] border-[#00E5FF]/30"
                            : "bg-white/[0.04] text-white/40 border-white/[0.07] hover:border-white/20 hover:text-white/70"
                        )}
                      >
                        <span className="text-sm font-bold leading-none">{n}</span>
                        <span className="text-[9px] opacity-50 mt-0.5 leading-none">{hint}</span>
                      </button>
                    );
                  })}
                </div>
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

              {/* Toggle Legendas Automáticas */}
              <div className="mb-3 p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Sparkles size={13} style={{ color: "var(--matrix)" }} />
                    <div>
                      <p className="text-sm font-medium text-white/80">Legendas Automáticas</p>
                      <p className="text-[10px] text-white/35">Curiosidades únicas em PT-BR por post</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoCaptionEnabled(v => !v)}
                    className={cn(
                      "relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
                      autoCaptionEnabled ? "bg-[#00FF41]/80" : "bg-white/10"
                    )}
                  >
                    <span className={cn(
                      "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                      autoCaptionEnabled ? "translate-x-5" : "translate-x-0"
                    )} />
                  </button>
                </div>
                <AnimatePresence>
                  {autoCaptionEnabled && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        {AUTO_CAPTION_TYPES_POSTAR.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setAutoCaptionType(t.id)}
                            className={cn(
                              "p-2.5 rounded-xl border text-left transition-all",
                              autoCaptionType === t.id
                                ? "border-[#00FF41]/40 bg-[#00FF41]/[0.06]"
                                : "border-white/[0.07] hover:border-white/20"
                            )}
                          >
                            <span className="text-sm">{t.emoji}</span>
                            <p className="text-[10px] font-medium text-white/80 mt-1 leading-tight">{t.label}</p>
                            <p className="text-[9px] text-white/35 mt-0.5 leading-tight">{t.desc}</p>
                          </button>
                        ))}
                      </div>
                      {autoCaptionType && (
                        <div className="mt-2.5 p-2.5 rounded-lg bg-black/30 border border-white/[0.05]">
                          <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1">Exemplo — cada post recebe uma diferente</p>
                          <p className="text-[10px] text-white/50 leading-relaxed italic">
                            {AUTO_CAPTION_PREVIEWS_POSTAR[autoCaptionType]}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {!autoCaptionEnabled && (
                <CaptionEditor captions={captions} onChange={setCaptions} />
              )}
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
