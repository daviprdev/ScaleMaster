"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Film, CalendarDays, Send, FolderOpen, X, Check,
  Loader2, AlertCircle, CheckCircle2, Plus, Trash2, Clock,
  Shuffle, Zap, List, Library, Save, BookMarked, BarChart2,
  RefreshCw, ChevronDown, Sparkles, Pencil, SlidersHorizontal, LayoutGrid,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VideoProcessingSelector, type VideoProcessingMode } from "@/components/dashboard/VideoProcessingSelector";
import { ReelPlacementSelector } from "@/components/dashboard/ReelPlacementSelector";
import { CaptionModeSelector } from "@/components/dashboard/CaptionModeSelector";
import { ProxyPoolToggle } from "@/components/dashboard/ProxyPoolToggle";
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Tabs,
  Banner,
  Skeleton,
  EmptyState,
  Slider,
  Dialog,
  ProgressBar,
  Switch,
} from "@/components/ui";
import {
  validateInstagramCaption,
  INSTAGRAM_CAPTION_MAX_LENGTH,
  INSTAGRAM_CAPTION_MAX_HASHTAGS,
  INSTAGRAM_CAPTION_MAX_MENTIONS,
  type CaptionMode,
} from "@/lib/reel-captions";

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

interface AccountEngagement {
  account_id: string;
  username: string;
  avatar_url: string | null;
  total_plays: number;
  total_likes: number;
  total_comments: number;
  total_reach: number;
  published_count: number;
  synced_posts: number;
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
  is_clone?: boolean;
  is_automation?: boolean;
  is_synced?: boolean;
  synced_folder_names?: string[];
  account_engagement?: AccountEngagement[];
  total_plays?: number;
  total_likes?: number;
  total_comments?: number;
  total_reach?: number;
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

// Limites centralizados em lib/reel-captions.ts — o número não é repetido
// aqui nem em nenhuma rota.
const MAX_CAPTION_CHARS = INSTAGRAM_CAPTION_MAX_LENGTH;

// Valor fixo enviado como auto_caption_type — não há mais seleção de categoria,
// o pool em lib/auto-captions.ts é único e cobre temas livres.
const AUTO_CAPTION_TYPE_VALUE = "curiosidades-gerais";

const AUTO_CAPTION_PREVIEW_POSTAR =
  "3 atitudes de quem tem produtividade real:\n\n1️⃣ Priorizar, não preencher agenda.\n2️⃣ Dormir antes de trabalhar.\n3️⃣ Eliminar antes de delegar.\n\nSalva pra reler quando precisar.\n\n#produtividade #foco #rotina";

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
        <Zap size={14} className="text-[#85B9E9]" />
        <span className="text-xs font-semibold uppercase tracking-widest text-ink-3">Resumo</span>
      </div>

      {!isReady ? (
        <p className="text-ink-3 text-xs text-center py-4">
          Preencha os campos para ver o resumo
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Vídeos/conta", value: videosPerAccount, color: "text-brand-navy" },
              { label: "Contas", value: totalAccounts, color: "text-accent" },
              { label: "Total de posts", value: totalPosts, color: "text-ink" },
              { label: "Duração", value: `${days}d`, color: "text-ink" },
              { label: "Posts/dia", value: postsPerDay, color: "text-ink-2" },
              { label: "Legendas", value: captionCount, color: "text-ink-2" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface-raised rounded-xl px-3 py-2.5 border border-line">
                <p className="text-ink-3 text-[10px] uppercase tracking-wider">{label}</p>
                <p className={cn("font-mono font-semibold text-base mt-0.5", color)}>{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-ink-3 uppercase tracking-wider">Início</span>
              <span className="text-brand-blue font-mono">{formatDatetime(startDatetime)}</span>
            </div>
            {lastSlotIso && (
              <div className="flex justify-between text-[10px]">
                <span className="text-ink-3 uppercase tracking-wider">Fim estimado</span>
                <span className="text-accent font-mono">{formatDatetime(lastSlotIso)}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-blue/5 border border-brand-blue/20">
            <Shuffle size={12} className="text-brand-blue flex-shrink-0" />
            <p className="text-[10px] text-brand-blue/80">
              Cada conta recebe os vídeos em ordem aleatória única
            </p>
          </div>

          {timelineSlots.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-ink-3 uppercase tracking-wider">
                Horários por conta (Conta 1)
              </p>
              {timelineSlots.slice(0, 6).map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-accent/60 font-mono text-[10px] w-28 flex-shrink-0">{s}</span>
                  <div className="flex-1 h-[3px] rounded-full bg-line overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-blue/60 to-accent/60 w-full" />
                  </div>
                  <span className="text-ink-3 text-[10px] w-16 text-right">{totalAccounts} conta{totalAccounts !== 1 ? "s" : ""}</span>
                </div>
              ))}
              {timelineSlots.length < videosPerAccount && (
                <p className="text-ink-3/50 text-[10px]">+ {videosPerAccount - timelineSlots.length} slots restantes...</p>
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
    // Sem `.slice()`: colar uma legenda longa não pode descartar o excedente
    // em silêncio. O contador fica vermelho e o servidor recusa — a política
    // é validar, não truncar.
    const next = [...captions];
    next[i] = val;
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
                  <span className="text-[10px] font-mono text-[#00498D]/50 bg-[#00498D]/10 rounded-md px-1.5 py-0.5">
                    #{i + 1}
                  </span>
                </div>
                <textarea
                  value={cap}
                  onChange={e => update(i, e.target.value)}
                  rows={3}
                  placeholder={`Legenda ${i + 1}...`}
                  className="w-full pl-14 pr-10 pt-3 pb-3 rounded-xl bg-surface-raised border border-line-control text-ink text-sm placeholder-ink-3 resize-none focus:outline-none focus:border-brand-blue/40 focus:ring-1 focus:ring-brand-blue/20 transition-all leading-relaxed"
                />
                <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2">
                  {(() => {
                    const v = validateInstagramCaption(cap);
                    const cor = (excedeu: boolean, perto: boolean) =>
                      excedeu ? "text-danger" : perto ? "text-warning" : "text-ink-3";
                    return (
                      <span className="flex items-center gap-2 text-[10px] transition-colors">
                        <span className={cor(
                          v.length > INSTAGRAM_CAPTION_MAX_LENGTH,
                          v.length > INSTAGRAM_CAPTION_MAX_LENGTH * 0.9
                        )}>
                          {v.length}/{INSTAGRAM_CAPTION_MAX_LENGTH}
                        </span>
                        {v.hashtagCount > 0 && (
                          <span className={cor(
                            v.hashtagCount > INSTAGRAM_CAPTION_MAX_HASHTAGS,
                            v.hashtagCount > INSTAGRAM_CAPTION_MAX_HASHTAGS * 0.9
                          )}>
                            {v.hashtagCount}/{INSTAGRAM_CAPTION_MAX_HASHTAGS} #
                          </span>
                        )}
                        {v.mentionCount > 0 && (
                          <span className={cor(
                            v.mentionCount > INSTAGRAM_CAPTION_MAX_MENTIONS,
                            v.mentionCount > INSTAGRAM_CAPTION_MAX_MENTIONS * 0.9
                          )}>
                            {v.mentionCount}/{INSTAGRAM_CAPTION_MAX_MENTIONS} @
                          </span>
                        )}
                      </span>
                    );
                  })()}
                  {captions.length > 1 && (
                    <button
                      onClick={() => remove(i)}
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-ink-3 hover:text-danger hover:bg-danger/10 transition-colors"
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
                        <CheckCircle2 size={11} className="text-[#00498D]" />
                        <span className="text-[10px] text-[#00498D]">Salva na biblioteca!</span>
                      </div>
                    ) : savingFor === i ? (
                      <div className="flex items-center gap-2 px-1 pt-1.5 pb-0.5">
                        <input
                          autoFocus
                          value={saveTitle}
                          onChange={e => setSaveTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleSave(i); if (e.key === "Escape") { setSavingFor(null); setSaveTitle(""); } }}
                          placeholder="Nome da legenda (opcional)..."
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-raised border border-line-control text-ink text-xs placeholder-ink-3 focus:outline-none focus:border-brand-blue/40 transition-all"
                        />
                        <button
                          onClick={() => handleSave(i)}
                          disabled={savingApi}
                          className="px-3 py-1.5 rounded-lg bg-[#00498D]/15 text-[#00498D] text-xs font-medium hover:bg-[#00498D]/25 transition-all disabled:opacity-50 flex items-center gap-1"
                        >
                          {savingApi ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                          Salvar
                        </button>
                        <button
                          onClick={() => { setSavingFor(null); setSaveTitle(""); }}
                          className="w-6 h-6 flex items-center justify-center text-ink-3 hover:text-ink-2 transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setSavingFor(i); setSaveTitle(""); }}
                        className="flex items-center gap-1.5 px-1 pt-1.5 pb-0.5 text-[10px] text-ink-3 hover:text-brand-blue/60 transition-colors group"
                      >
                        <Save size={9} className="group-hover:text-[#00498D]/60 transition-colors" />
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
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-line-control text-ink-3 text-sm hover:border-brand-blue/40 hover:text-brand-blue/60 transition-all"
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
                ? "border-[#85B9E9]/40 bg-[#85B9E9]/8 text-[#85B9E9]"
                : "border-line-control text-ink-3 hover:border-accent/40 hover:text-accent/70"
            )}
          >
            <Library size={14} />
            Usar Salva
            {savedCaptions.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#85B9E9]/15 text-[#85B9E9] text-[9px] font-mono">
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
                className="absolute z-30 bottom-full mb-2 right-0 w-80 bg-surface-raised border border-line rounded-2xl shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-line">
                  <div className="flex items-center gap-2">
                    <BookMarked size={13} className="text-[#85B9E9]" />
                    <span className="text-xs font-semibold text-ink-2">Biblioteca de Legendas</span>
                  </div>
                  <button onClick={() => setShowLibrary(false)} className="text-ink-3 hover:text-ink-2 transition-colors">
                    <X size={13} />
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto">
                  {loadingSaved ? (
                    <div className="flex items-center justify-center py-8 gap-2 text-ink-3 text-xs">
                      <Loader2 size={13} className="animate-spin" /> Carregando...
                    </div>
                  ) : savedCaptions.length === 0 ? (
                    <div className="py-8 text-center">
                      <BookMarked size={20} className="text-ink-3/40 mx-auto mb-2" />
                      <p className="text-ink-3 text-xs">Nenhuma legenda salva ainda.</p>
                    </div>
                  ) : (
                    savedCaptions.map(sc => (
                      <div
                        key={sc.id}
                        className="group flex items-start gap-2 px-4 py-3 hover:bg-surface-hover transition-colors border-b border-line last:border-0"
                      >
                        <button onClick={() => inject(sc.content)} className="flex-1 text-left min-w-0">
                          {sc.title && (
                            <p className="text-xs font-medium text-accent/80 truncate mb-0.5">{sc.title}</p>
                          )}
                          <p className="text-xs text-ink-2 line-clamp-2 leading-relaxed">{sc.content}</p>
                          <p className="text-[9px] text-ink-3 mt-1">Clique para usar</p>
                        </button>
                        <button
                          onClick={() => removeFromLibrary(sc.id)}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-ink-3 hover:text-danger transition-all flex-shrink-0 mt-0.5"
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
        <p className="text-[10px] text-ink-3 flex items-center gap-1.5">
          <Shuffle size={9} />
          Legendas sorteadas aleatoriamente em cada post
        </p>
      )}
    </div>
  );
}

// ── SectionCard / SectionLabel ─────────────────────────────────────────────

function SectionCard({ children, className, title, description, actions }: { children: React.ReactNode; className?: string; title?: string; description?: string; actions?: React.ReactNode }) {
  if (title) {
    return (
      <Card title={title} description={description} actions={actions} className={className}>
        {children}
      </Card>
    );
  }
  return <div className={cn("rounded-xl border border-line bg-surface p-5", className)}>{children}</div>;
}

function SectionLabel({ Icon, children }: { Icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={14} className="text-ink-3" />
      <span className="text-xs font-semibold uppercase tracking-widest text-ink-3">{children}</span>
    </div>
  );
}

// ── EditCampaignModal ────────────────────────────────────────────────────────
// Edita legendas (manual ou automática) e cadência de uma campanha ativa
// criada no Postar. Só afeta posts ainda 'pending' — o horário deles é
// recalculado a partir de agora com a nova cadência; posts já publicados
// não são tocados. Ao abrir, busca em /api/campaigns/edit-info a config
// exata usada na criação (campanhas sincronizadas com pasta) ou, na
// ausência dela, reconstrói a melhor estimativa a partir dos posts já criados.

function EditCampaignModal({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [captionMode, setCaptionMode] = useState<"manual" | "auto">("manual");
  const [captionsText, setCaptionsText] = useState("");
  const [postsPerDay, setPostsPerDay] = useState(4);
  const [staggerSeconds, setStaggerSeconds] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaign) return;
    let cancelled = false;
    setError(null);
    setLoadingInfo(true);
    fetch(`/api/campaigns/edit-info?campaign_id=${encodeURIComponent(campaign.campaign_id)}`)
      .then(res => res.json())
      .then((d: {
        caption_mode?: "manual" | "auto";
        captions?: string[];
        posts_per_day?: number;
        account_stagger_seconds?: number | null;
        error?: string;
      }) => {
        if (cancelled) return;
        if (d.error) { setError(d.error); return; }
        setCaptionMode(d.caption_mode ?? "manual");
        setCaptionsText((d.captions ?? []).join("\n"));
        setPostsPerDay(d.posts_per_day ?? 4);
        setStaggerSeconds(d.account_stagger_seconds ?? null);
      })
      .catch(() => { if (!cancelled) setError("Não foi possível carregar a configuração atual."); })
      .finally(() => { if (!cancelled) setLoadingInfo(false); });
    return () => { cancelled = true; };
  }, [campaign?.campaign_id]);

  if (!campaign) return null;

  const intervalHint = (n: number) => {
    const mins = Math.max(1, Math.floor((24 * 60) / n));
    return mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}min`;
  };

  const handleSave = async () => {
    setError(null);
    const captions = captionsText.split("\n").map(c => c.trim()).filter(Boolean);
    if (captionMode === "manual" && captions.length === 0) {
      setError("Informe ao menos uma legenda.");
      return;
    }
    if (!postsPerDay || postsPerDay < 1 || postsPerDay > 1440) {
      setError("Posts por dia deve ser entre 1 e 1440.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaign.campaign_id,
          caption_mode: captionMode,
          captions: captionMode === "manual" ? captions : undefined,
          auto_caption_type: captionMode === "auto" ? AUTO_CAPTION_TYPE_VALUE : undefined,
          posts_per_day: postsPerDay,
          account_stagger_seconds: staggerSeconds,
        }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Erro ao salvar edição.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar edição.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {campaign && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="glass relative w-full max-w-lg rounded-2xl border border-line p-6 z-10 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-ink">Editar campanha</h2>
              <button onClick={onClose} className="text-ink-3 hover:text-ink transition-colors">
                <X size={18} />
              </button>
            </div>
            <p className="text-[11px] text-ink-3 mb-5 font-mono">#{campaign.campaign_id.slice(0, 8).toUpperCase()}</p>

            {loadingInfo ? (
              <div className="flex items-center justify-center py-16 gap-2 text-ink-3 text-sm">
                <Loader2 size={16} className="animate-spin" /> Carregando configuração atual...
              </div>
            ) : (
              <div className="space-y-5">
                {campaign.pending === 0 ? (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-warning-soft border border-warning/20 text-warning text-xs">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    Essa campanha não tem posts pendentes — nada será reagendado, mas a configuração é salva para futuras contas sincronizadas.
                  </div>
                ) : (
                  <p className="text-[11px] text-ink-3 leading-relaxed">
                    As mudanças abaixo valem só para os{" "}
                    <span className="text-ink-2 font-medium">{campaign.pending} posts pendentes</span> desta campanha —
                    posts já publicados não mudam. Os horários são recalculados a partir de agora com a nova cadência.
                  </p>
                )}

                {/* Cadência */}
                <div>
                  <label className="block text-xs text-ink-2 mb-2 font-medium uppercase tracking-wider">Posts por dia por conta</label>
                  <div className="flex flex-wrap gap-2">
                    {POSTS_PER_DAY_OPTIONS.map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPostsPerDay(n)}
                        title={`Intervalo: ~${intervalHint(n)} entre posts`}
                        className={cn(
                          "flex flex-col items-center px-3.5 py-2 rounded-xl border transition-all",
                          postsPerDay === n
                            ? "bg-accent/15 text-accent border-accent/30"
                            : "bg-surface-raised text-ink-3 border-line hover:border-line-control hover:text-ink-2"
                        )}
                      >
                        <span className="text-sm font-bold leading-none">{n}</span>
                        <span className="text-[9px] opacity-50 mt-0.5 leading-none">{intervalHint(n)}</span>
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={postsPerDay}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 1) setPostsPerDay(Math.min(v, 1440));
                      }}
                      className="w-20 px-3 py-2 rounded-xl bg-surface-raised border border-line-control text-ink text-sm text-center focus:outline-none focus:border-accent/40 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>

                {/* Stagger entre contas */}
                <div>
                  <label className="block text-xs text-ink-2 mb-2 font-medium uppercase tracking-wider">Intervalo entre contas</label>
                  <div className="space-y-2.5 p-3.5 rounded-xl border border-line bg-surface-raised">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-3">Auto</span>
                      <span className={cn("text-sm font-bold", staggerSeconds ? "text-brand-blue" : "text-ink-3")}>
                        {staggerSeconds ? `${staggerSeconds}s` : "Automático"}
                      </span>
                      <span className="text-xs text-ink-3">5 min</span>
                    </div>
                    <input
                      type="range" min={0} max={300} step={5}
                      value={staggerSeconds ?? 0}
                      onChange={e => { const v = Number(e.target.value); setStaggerSeconds(v === 0 ? null : v); }}
                      className="range-slider"
                      style={{
                        background: staggerSeconds
                          ? `linear-gradient(to right, var(--brand-blue) 0%, var(--brand-blue) ${(staggerSeconds / 300) * 100}%, var(--line) ${(staggerSeconds / 300) * 100}%, var(--line) 100%)`
                          : `linear-gradient(to right, var(--line) 0%, var(--line) 100%)`
                      }}
                    />
                  </div>
                </div>

                {/* Legendas */}
                <div className="p-3.5 rounded-xl border border-line bg-surface">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Sparkles size={13} className="text-brand-blue" />
                      <div>
                        <p className="text-sm font-medium text-ink">Legendas Automáticas</p>
                        <p className="text-[10px] text-ink-3">Curiosidades únicas em PT-BR por post</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCaptionMode(m => m === "auto" ? "manual" : "auto")}
                      className={cn("relative w-11 h-6 rounded-full transition-all flex-shrink-0", captionMode === "auto" ? "bg-brand-blue" : "bg-line-control/30")}
                    >
                      <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", captionMode === "auto" ? "left-[22px]" : "left-0.5")} />
                    </button>
                  </div>

                  <AnimatePresence initial={false} mode="wait">
                    {captionMode === "auto" ? (
                      <motion.div key="auto" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                        <div className="mt-3 p-2.5 rounded-lg bg-surface-raised border border-line">
                          <p className="text-[9px] text-ink-3 uppercase tracking-wider mb-1">Exemplo (cada post recebe uma legenda diferente)</p>
                          <p className="text-[10px] text-ink-2 leading-relaxed italic whitespace-pre-line">
                            {AUTO_CAPTION_PREVIEW_POSTAR}
                          </p>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div key="manual" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                        <textarea
                          value={captionsText}
                          onChange={e => setCaptionsText(e.target.value)}
                          rows={5}
                          placeholder={"Uma legenda por linha...\nSorteada aleatoriamente em cada post."}
                          className="w-full mt-3 px-3 py-2.5 rounded-xl bg-surface-raised border border-line-control text-ink text-sm placeholder-ink-3 resize-none focus:outline-none focus:border-brand-blue/40 focus:ring-1 focus:ring-brand-blue/20 transition-all leading-relaxed"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {error && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-danger-soft border border-danger/20 text-danger text-xs">
                    <AlertCircle size={13} className="flex-shrink-0" />
                    {error}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {saving ? "Salvando..." : "Salvar edição"}
                  </button>
                  <button
                    onClick={onClose}
                    disabled={saving}
                    className="px-5 py-3 rounded-xl text-sm btn-ghost disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
  const [expandedEngagement, setExpandedEngagement] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);

  const fetchCampaigns = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/campaigns");
      const d = await res.json() as { campaigns: Campaign[] };
      // Automações e clones têm abas próprias (Automatizar / Clonar Perfil) — aqui só campanhas criadas no Postar
      setCampaigns((d.campaigns ?? []).filter(c => !c.is_automation && !c.is_clone));
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
        <Loader2 size={24} className="animate-spin text-[#00498D]" />
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-surface-raised border border-line flex items-center justify-center mb-4">
          <BarChart2 size={24} className="text-ink-3/40" />
        </div>
        <p className="text-ink-3 text-sm mb-1">Nenhuma campanha encontrada</p>
        <p className="text-ink-3/50 text-xs mb-5">Crie sua primeira distribuição</p>
        <button onClick={onCreateNew} className="px-5 py-2.5 rounded-xl bg-[#00498D]/10 text-[#00498D] text-sm font-medium hover:bg-[#00498D]/20 transition-all border border-[#00498D]/20">
          Nova Distribuição
        </button>
      </div>
    );
  }

  const running = campaigns.filter(c => c.campaign_status === "running");

  // Suppress lint warning — tick is read to force re-render for live time displays
  void tick;

  return (
    <>
    <div className="max-w-3xl mx-auto">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4 text-xs text-ink-3">
          {running.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00498D] shadow-[0_0_4px_#00498D] animate-pulse" />
              <span className="text-[#00498D]/70">{running.length} executando</span>
            </span>
          )}
          <span>{campaigns.length} campanha{campaigns.length !== 1 ? "s" : ""}</span>
        </div>
        <button
          onClick={() => fetchCampaigns(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface-raised text-xs text-ink-3 hover:text-accent hover:border-accent/20 transition-all disabled:opacity-40"
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
            statusLabel = "Concluída"; statusCls = "bg-[#00498D]/10 text-[#00498D]"; statusBorder = "border-[#00498D]/20"; dotCls = "bg-[#00498D]";
          } else if (isOverdue) {
            statusLabel = "Atrasada"; statusCls = "bg-amber-500/10 text-amber-400"; statusBorder = "border-amber-500/20"; dotCls = "bg-amber-400"; dotPulse = true;
          } else if (recentPub) {
            statusLabel = "Publicando"; statusCls = "bg-[#00498D]/10 text-[#00498D]"; statusBorder = "border-[#00498D]/20"; dotCls = "bg-[#00498D]"; dotPulse = true;
          } else {
            statusLabel = "Na Fila"; statusCls = "bg-[#85B9E9]/10 text-[#85B9E9]"; statusBorder = "border-[#85B9E9]/20"; dotCls = "bg-[#85B9E9]";
          }

          const cardBorder = isOverdue
            ? "border-amber-500/15"
            : hasFailed && !isRunning
              ? "border-red-500/15"
              : isRunning
                ? "border-[#85B9E9]/10"
                : "border-line";

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
                    <p className="text-ink-2 font-mono text-xs tracking-wider">#{campaign.campaign_id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-ink-3 text-[10px] mt-0.5">Criada {formatDatetime(campaign.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {campaign.is_synced && (
                    <span
                      title={`Contas novas em ${(campaign.synced_folder_names ?? []).join(", ")} entram automaticamente`}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border whitespace-nowrap bg-[#85B9E9]/10 text-[#85B9E9] border-[#85B9E9]/20"
                    >
                      <RefreshCw size={9} />
                      Sincronizada
                    </span>
                  )}
                  <span className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border whitespace-nowrap", statusCls, statusBorder)}>
                    {statusLabel === "Concluída"  && <CheckCircle2 size={9} />}
                    {statusLabel === "Na Fila"    && <Clock size={9} />}
                    {statusLabel === "Publicando" && <Loader2 size={9} className="animate-spin" />}
                    {statusLabel === "Atrasada"   && <AlertCircle size={9} />}
                    {statusLabel}
                  </span>
                  <button
                    onClick={() => setEditCampaign(campaign)}
                    title="Editar legendas e cadência"
                    className="w-7 h-7 rounded-lg border flex items-center justify-center transition-all bg-surface-raised border-line text-ink-3 hover:text-accent hover:border-accent/25"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => handleDelete(campaign.campaign_id)}
                    disabled={isDeleting}
                    className={cn(
                      "w-7 h-7 rounded-lg border flex items-center justify-center transition-all",
                      isConfirming ? "bg-danger-soft border-danger/40 text-danger" : "bg-surface-raised border-line text-ink-3 hover:text-danger hover:border-danger/25",
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
                  <span className="text-ink-3 tabular-nums">{campaign.published} de {campaign.total} posts publicados</span>
                  <span className={cn("font-bold tabular-nums", progress >= 100 ? "text-brand-blue" : isRunning ? "text-accent" : "text-ink-3")}>{progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-line overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                    className={cn("h-full rounded-full", hasFailed && !isRunning ? "bg-red-500/50" : "bg-gradient-to-r from-[#00498D]/70 to-[#85B9E9]/70")}
                  />
                </div>
              </div>

              {/* ── Stats row ── */}
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-surface-raised border border-line">
                  <span className="text-ink-3 text-[9px] uppercase tracking-wider">Fila</span>
                  <span className={cn("font-bold tabular-nums", campaign.pending > 0 ? "text-accent" : "text-ink-3")}>{campaign.pending}</span>
                </div>
                <div className={cn("flex flex-col gap-0.5 px-3 py-2 rounded-xl border", hasFailed ? "bg-danger-soft border-danger/15" : "bg-surface-raised border-line")}>
                  <span className="text-ink-3 text-[9px] uppercase tracking-wider">Falhas</span>
                  <span className={cn("font-bold tabular-nums", hasFailed ? "text-danger" : "text-ink-3")}>{campaign.failed}</span>
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-surface-raised border border-line">
                  <span className="text-ink-3 text-[9px] uppercase tracking-wider">Cancelados</span>
                  <span className="font-bold tabular-nums text-ink-3">{campaign.cancelled}</span>
                </div>
              </div>

              {/* ── Engagement por conta (collapsible) ── */}
              {campaign.account_engagement && campaign.account_engagement.length > 0 && (
                <div className="space-y-1.5">
                  <button
                    onClick={() => setExpandedEngagement(prev => {
                      const next = new Set(prev);
                      if (next.has(campaign.campaign_id)) next.delete(campaign.campaign_id);
                      else next.add(campaign.campaign_id);
                      return next;
                    })}
                    className="flex items-center justify-between w-full px-1 py-1 rounded-lg hover:bg-surface-hover transition-colors group"
                  >
                    <div className="flex items-center gap-1.5">
                      <ChevronDown size={12} className={cn("text-ink-3 transition-transform duration-200", expandedEngagement.has(campaign.campaign_id) ? "rotate-0" : "-rotate-90")} />
                      <span className="text-[9px] uppercase tracking-wider text-ink-3 group-hover:text-ink-2 transition-colors">Engagement por conta</span>
                    </div>
                    {(campaign.total_plays ?? 0) > 0 && (
                      <span className="text-[9px] tabular-nums text-[#85B9E9]/60">{(campaign.total_plays ?? 0).toLocaleString("pt-BR")} views totais</span>
                    )}
                  </button>
                  {expandedEngagement.has(campaign.campaign_id) && (
                    <>
                      <div className="space-y-1">
                        {campaign.account_engagement.map((eng, idx) => (
                          <div key={eng.account_id} className={cn(
                            "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10px]",
                            idx === 0 ? "bg-warning-soft border-warning/10" : "bg-surface border-line"
                          )}>
                            <span className={cn("w-3 text-center font-bold tabular-nums", idx === 0 ? "text-warning" : "text-ink-3")}>{idx + 1}</span>
                            {eng.avatar_url
                              ? <img src={eng.avatar_url} alt={eng.username} className="w-4 h-4 rounded-full object-cover" />
                              : <div className="w-4 h-4 rounded-full bg-line-control/30 flex items-center justify-center"><span className="text-[6px] font-bold text-ink-3">{eng.username.charAt(0).toUpperCase()}</span></div>
                            }
                            <span className="flex-1 truncate text-ink-2">@{eng.username}</span>
                            <div className="flex items-center gap-2.5 tabular-nums">
                              <span className={cn("font-bold", eng.total_plays > 0 ? "text-accent" : "text-ink-3/40")} title="Views">{eng.total_plays > 0 ? eng.total_plays.toLocaleString("pt-BR") : "—"}</span>
                              <span className={cn("font-medium", eng.total_likes > 0 ? "text-pink-400" : "text-ink-3/40")} title="Likes">{eng.total_likes > 0 ? eng.total_likes.toLocaleString("pt-BR") : "—"}</span>
                              <span className={cn("font-medium", eng.total_comments > 0 ? "text-warning" : "text-ink-3/40")} title="Comentários">{eng.total_comments > 0 ? eng.total_comments.toLocaleString("pt-BR") : "—"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {campaign.published > 0 && (campaign.account_engagement.every(e => e.synced_posts === 0)) && (
                        <p className="text-[9px] text-ink-3 px-1">Sincronizando métricas…</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Timing row ── */}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="flex flex-col gap-0.5 px-3 py-2 rounded-xl bg-surface-raised border border-line">
                  <span className="text-ink-3 text-[9px] uppercase tracking-wider">Último publicado</span>
                  <span className={cn("font-medium", campaign.last_published_at ? "text-brand-blue" : "text-ink-3")}>
                    {campTimeAgo(campaign.last_published_at)}
                  </span>
                </div>
                <div className={cn("flex flex-col gap-0.5 px-3 py-2 rounded-xl border", isOverdue ? "bg-warning-soft border-warning/15" : "bg-surface-raised border-line")}>
                  <span className="text-ink-3 text-[9px] uppercase tracking-wider">
                    {isRunning ? "Próximo" : "Encerrada em"}
                  </span>
                  {isRunning ? (
                    <span className={cn("font-medium", isOverdue ? "text-warning" : "text-accent")}>
                      {isOverdue ? "⏱ " : ""}{campTimeIn(campaign.next_pending)}
                    </span>
                  ) : (
                    <span className="font-medium text-ink-3 text-[10px]">{formatDatetime(campaign.last_slot)}</span>
                  )}
                </div>
              </div>

              {/* ── Overdue warning ── */}
              {isOverdue && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-warning-soft border border-warning/15">
                  <AlertCircle size={11} className="text-warning/80 shrink-0" />
                  <span className="text-[10px] text-warning/80">Post atrasado — o cron publicará na próxima execução (≤1 min)</span>
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
              <div className="flex items-center gap-2 pt-1 border-t border-line">
                <div className="flex -space-x-1.5">
                  {campAccounts.slice(0, 6).map(acc => (
                    acc.avatar_url
                      ? <img key={acc.id} src={acc.avatar_url} alt={acc.username} title={`@${acc.username}`} className="w-5 h-5 rounded-full border border-bg object-cover" />
                      : <div key={acc.id} title={`@${acc.username}`} className="w-5 h-5 rounded-full border border-bg bg-gradient-to-br from-brand-blue/30 to-accent/30 flex items-center justify-center"><span className="text-[7px] font-bold text-ink">{acc.username.charAt(0).toUpperCase()}</span></div>
                  ))}
                  {campAccounts.length === 0 && campaign.account_ids.slice(0, 6).map(id => (
                    <div key={id} className="w-5 h-5 rounded-full border border-bg bg-line-control/30" />
                  ))}
                  {campaign.account_ids.length > 6 && (
                    <div className="w-5 h-5 rounded-full border border-bg bg-line-control/30 flex items-center justify-center">
                      <span className="text-[7px] text-ink-3">+{campaign.account_ids.length - 6}</span>
                    </div>
                  )}
                </div>
                <span className="text-ink-3 text-[10px]">{campaign.account_ids.length} conta{campaign.account_ids.length !== 1 ? "s" : ""}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
    <EditCampaignModal
      campaign={editCampaign}
      onClose={() => setEditCampaign(null)}
      onSaved={() => { setEditCampaign(null); fetchCampaigns(true); }}
    />
    </>
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
  const [syncFolders, setSyncFolders] = useState(false);

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
  const [accountStaggerSeconds, setAccountStaggerSeconds] = useState<number | null>(null);
  const [burstMode, setBurstMode] = useState(false);             // Modo Ciclo: postar tudo de uma vez

  // Estratégia de prioridade: "views" (default), "least_usage" ou "random".
  // Persistida na campanha para que sync-distribute-accounts use a mesma política.
  const [priorityStrategy, setPriorityStrategy] = useState<"views" | "least_usage" | "random">("views");

  // Captions
  const [captions, setCaptions] = useState<string[]>(["", ""]);
  const [autoCaptionEnabled, setAutoCaptionEnabled] = useState(false);

  // Processamento do video (opt-in) - padrao: arquivo original, zero FFmpeg
  const [videoProcessingMode, setVideoProcessingMode] = useState<VideoProcessingMode>("original");

  // Onde o Reel aparece no perfil (share_to_feed da Meta). Padrão: Reels + grade.
  const [shareToFeed, setShareToFeed] = useState(true);

  // Proxy do estoque para publicação (opt-in) — padrão: desligado (fluxo atual).
  const [useProxyPool, setUseProxyPool] = useState(false);
  // "custom" preserva o comportamento histórico desta aba (pool digitado
  // ou legenda automática). Só muda se o usuário escolher outro modo.
  const [captionMode, setCaptionMode] = useState<CaptionMode>("custom");
  const [stripHashtags, setStripHashtags] = useState(false);
  const [stripMentions, setStripMentions] = useState(false);

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

  // Pastas com TODAS as contas atualmente selecionadas — só essas podem ser
  // sincronizadas (contas novas nelas entram sozinhas na campanha depois).
  const fullySelectedFolders = useMemo(() => {
    return accountsByFolder.filter(g => {
      if (g.id === "__no_folder__" || g.accounts.length === 0) return false;
      return g.accounts.every(a => selectedAccountIds.includes(a.id));
    });
  }, [accountsByFolder, selectedAccountIds]);

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
    if (!burstMode && !startDatetime) { setSubmitError("Defina a data e hora de início."); return; }

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
          start_at: burstMode ? new Date().toISOString() : new Date(startDatetime).toISOString(),
          captions: autoCaptionEnabled ? [] : validCaptions,
          auto_caption_type: autoCaptionEnabled ? AUTO_CAPTION_TYPE_VALUE : undefined,
          account_stagger_seconds: accountStaggerSeconds,
          burst_mode: burstMode,
          sync_folder_ids: syncFolders ? fullySelectedFolders.map(g => g.id) : [],
          video_processing_mode: videoProcessingMode,
          share_to_feed: shareToFeed,
          caption_mode: captionMode,
          caption_strip_hashtags: stripHashtags,
          caption_strip_mentions: stripMentions,
          priority_strategy: priorityStrategy,
          use_proxy_pool: useProxyPool,
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
      setAccountStaggerSeconds(null);
      setBurstMode(false);
      setSyncFolders(false);

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
    setAccountStaggerSeconds(null);
    setBurstMode(false);
    setSyncFolders(false);
    setActiveTab("create");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-[var(--content-max)] px-4 py-7 sm:px-8">
      <PageHeader
        eyebrow="Postar"
        title="Distribuição de Conteúdo"
        description="Distribua vídeos de uma pasta para múltiplas contas com ordem aleatória única por conta"
      />

      {/* Tabs */}
      <Tabs
        tabs={[
          { value: "create", label: "Nova Distribuição" },
          { value: "campaigns", label: "Campanhas Ativas" },
        ]}
        value={activeTab}
        onChange={(v) => setActiveTab(v as "create" | "campaigns")}
        className="mb-6"
      />

      {/* Success banner */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="mb-5"
          >
            <Banner tone="success" onClose={() => setSuccess(null)}>
              <span className="font-semibold">{success.total_posts} posts</span> criados —{" "}
              <span className="font-semibold">{success.videos_per_account} vídeos</span> por conta em{" "}
              <span className="font-semibold">{success.days} dia{success.days !== 1 ? "s" : ""}</span>
              {" · "}Início: {formatDatetime(success.first_slot)}
            </Banner>
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
                  <Users size={14} className="text-ink-3" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-ink-3">Contas</span>
                </div>
                {accounts.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setSelectedAccountIds(accounts.map(a => a.id))} className="text-xs text-accent/70 hover:text-accent transition-colors">
                      Todas
                    </button>
                    <span className="text-line text-xs">·</span>
                    <button onClick={() => setSelectedAccountIds([])} className="text-xs text-ink-3 hover:text-ink-2 transition-colors">
                      Nenhuma
                    </button>
                    {accountsWithCampaign.size > 0 && accountsWithoutCampaign.length > 0 && (
                      <>
                        <span className="text-line text-xs">·</span>
                        <button
                          onClick={() => setSelectedAccountIds(accountsWithoutCampaign.map(a => a.id))}
                          className="text-xs text-danger/80 hover:text-danger transition-colors font-medium"
                        >
                          Novas ({accountsWithoutCampaign.length})
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {loadingAccounts ? (
                <div className="flex items-center gap-2 text-ink-3 text-sm py-2">
                  <Loader2 size={14} className="animate-spin" /> Carregando contas...
                </div>
              ) : accounts.length === 0 ? (
                <EmptyState
                  icon={<Users size={24} />}
                  title="Nenhuma conta conectada"
                  description={
                    <>
                      Conecte uma conta Instagram para começar.{" "}
                      <a href="/dashboard/accounts" className="text-accent hover:underline">Conectar conta</a>
                    </>
                  }
                />
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
                              ? allSelected ? "border-brand-blue/30 bg-brand-blue/5" : someSelected ? "border-accent/20 bg-accent/3" : "border-line bg-surface-raised"
                              : allSelected ? "border-brand-blue/25 bg-brand-blue/4" : someSelected ? "border-accent/15 bg-accent/[0.02]" : "border-line bg-surface hover:border-line-control"
                          )}
                          onClick={() => toggleExpand(group.id)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ChevronDown
                              size={13}
                              className={cn("flex-shrink-0 transition-transform duration-200 text-ink-3", isExpanded && "rotate-180")}
                            />
                            <span className="text-sm leading-none">{isNoFolder ? "📂" : "📁"}</span>
                            <span className={cn("text-sm font-medium truncate", allSelected ? "text-brand-blue" : someSelected ? "text-accent" : "text-ink-2 group-hover:text-ink")}>
                              {group.name}
                            </span>
                            <span className="text-xs text-ink-3 font-mono flex-shrink-0">({group.accounts.length})</span>
                            {someSelected && (
                              <span className="text-[10px] text-ink-3 flex-shrink-0">
                                · {groupIds.filter(id => selectedAccountIds.includes(id)).length} sel.
                              </span>
                            )}
                          </div>
                          {/* Botões selecionar pasta / todas as pastas — stopPropagation para não fechar */}
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); toggleFolder(group.accounts); }}
                              className={cn(
                                "text-[10px] px-2.5 py-1 rounded-lg border transition-all whitespace-nowrap",
                                allSelected
                                  ? "border-[#00498D]/30 text-[#00498D]/70 hover:bg-[#00498D]/10"
                                  : "border-line text-ink-3 hover:border-brand-blue/30 hover:text-brand-blue/60"
                              )}
                            >
                              {allSelected ? "desmarcar" : "selecionar"}
                            </button>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setSelectedAccountIds(accounts.map(a => a.id)); }}
                              title="Selecionar todas as contas de todas as pastas"
                              className="text-[10px] px-2.5 py-1 rounded-lg border border-line text-ink-3 hover:border-accent/30 hover:text-accent/70 transition-all whitespace-nowrap"
                            >
                              todas as pastas
                            </button>
                          </div>
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
                                          ? "border-brand-blue/40 bg-brand-blue/8 text-brand-blue"
                                          : isNew
                                            ? "border-danger/30 bg-danger-soft text-ink-2 hover:border-danger/50"
                                            : "border-line bg-surface text-ink-2 hover:border-line-control hover:text-ink"
                                      )}
                                    >
                                      {isNew && !isSelected && (
                                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400/80" />
                                      )}
                                      {acc.avatar_url ? (
                                        <img src={acc.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                                      ) : (
                                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#00498D]/40 to-[#85B9E9]/40 flex-shrink-0 flex items-center justify-center">
                                          <span className="text-[8px] font-bold text-black">{acc.username.charAt(0).toUpperCase()}</span>
                                        </div>
                                      )}
                                      <span className="text-xs font-medium leading-none">@{acc.username}</span>
                                      {isSelected && <Check size={9} className="text-[#00498D] flex-shrink-0" strokeWidth={3} />}
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
                <p className="mt-3 text-xs text-[#00498D]/60 font-mono">
                  {selectedAccountIds.length} conta{selectedAccountIds.length !== 1 ? "s" : ""} selecionada{selectedAccountIds.length !== 1 ? "s" : ""}
                </p>
              )}

              {fullySelectedFolders.length > 0 && (
                <div className="mt-3 p-3.5 rounded-xl border border-line bg-surface">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <RefreshCw size={13} className="text-accent flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">Sincronizar com a pasta</p>
                        <p className="text-[10px] text-ink-3 truncate">
                          Contas adicionadas depois em {fullySelectedFolders.map(g => g.name).join(", ")} entram na fila sozinhas
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSyncFolders(v => !v)}
                      className={cn(
                        "relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
                        syncFolders ? "bg-accent/80" : "bg-line-control/30"
                      )}
                    >
                      <span className={cn(
                        "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                        syncFolders ? "translate-x-5" : "translate-x-0"
                      )} />
                    </button>
                  </div>
                </div>
              )}
            </SectionCard>

            {/* 2. Pasta + Quantidade */}
            {/* z-30 quando o dropdown está aberto — .glass-card cria stacking context (backdrop-filter) e o card seguinte pintava por cima da lista */}
            <SectionCard className={folderOpen ? "relative z-30" : undefined}>
              <SectionLabel Icon={FolderOpen}>Pasta de Mídia</SectionLabel>

              {/* Folder selector */}
              {loadingFolders ? (
                <div className="flex items-center gap-2 text-ink-3 text-sm py-2">
                  <Loader2 size={14} className="animate-spin" /> Carregando pastas...
                </div>
              ) : folders.length === 0 ? (
                <p className="text-ink-3 text-sm py-4 text-center">
                  Nenhuma pasta criada.{" "}
                  <a href="/dashboard/library" className="text-accent hover:underline">Criar pasta</a>
                </p>
              ) : (
                <div className="relative mb-4">
                  <button
                    onClick={() => setFolderOpen(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-surface-raised border border-line-control hover:border-line-control transition-colors"
                  >
                    <span className={cn("text-sm", selectedFolder ? "text-ink" : "text-ink-3")}>
                      {selectedFolder
                        ? `📁 ${selectedFolder.name} · ${folderVideoCount} vídeos`
                        : "Selecionar pasta..."}
                    </span>
                    <ChevronDown size={14} className={cn("text-ink-3 transition-transform", folderOpen && "rotate-180")} />
                  </button>

                  <AnimatePresence>
                    {folderOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.12 }}
                        className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface-raised border border-line rounded-xl shadow-2xl overflow-y-auto max-h-72"
                      >
                        {folders.map(f => (
                          <button
                            key={f.id}
                            onClick={() => { setSelectedFolderId(f.id); setFolderOpen(false); }}
                            className={cn(
                              "w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-surface-hover transition-colors",
                              selectedFolderId === f.id && "bg-brand-blue/5 text-brand-blue"
                            )}
                          >
                            <span className="text-ink">📁 {f.name}</span>
                            <span className="text-ink-3 text-xs">{f.video_count} vídeos</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Quantidade */}
              {burstMode ? (
                <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-accent/[0.04] border border-accent/15">
                  <Zap size={12} className="text-accent flex-shrink-0" />
                  <p className="text-[11px] text-ink-2">
                    Modo Ciclo ativo — quantidade definida na seção Cadência:{" "}
                    <span className="text-accent font-semibold">{videoCount === -1 ? "todos os" : videoCount} vídeos por conta</span>
                  </p>
                </div>
              ) : (
              <div>
                <p className="text-xs text-ink-3 font-medium mb-3 uppercase tracking-wider">Quantos vídeos postar</p>
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
                            ? "bg-brand-blue/15 text-brand-blue border-brand-blue/30"
                            : isDisabled
                              ? "bg-surface text-ink-3/40 border-line cursor-not-allowed"
                              : "bg-surface-raised text-ink-3 border-line hover:border-line-control hover:text-ink-2"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {selectedFolderId && folderVideoCount > 0 && (
                  <p className="mt-2 text-[11px] text-ink-3">
                    {videosPerAccount === folderVideoCount
                      ? `Todos os ${folderVideoCount} vídeos da pasta serão usados`
                      : `${videosPerAccount} de ${folderVideoCount} vídeos serão usados`}
                  </p>
                )}
              </div>
              )}
            </SectionCard>

            {/* 3. Cadência */}
            <SectionCard>
              <SectionLabel Icon={CalendarDays}>Cadência</SectionLabel>

              {/* Toggle Modo Ciclo */}
              <div className="mb-5 rounded-xl border border-line bg-surface p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Zap size={13} className="text-accent" />
                    <div>
                      <p className="text-sm font-medium text-ink">Modo Ciclo</p>
                      <p className="text-[10px] text-ink-3">Cada conta posta seu lote de vídeos de uma vez, uma conta após a outra</p>
                    </div>
                  </div>
                  <Switch
                    checked={burstMode}
                    onChange={() => {
                      if (!burstMode && (videoCount === -1 || videoCount > 50)) setVideoCount(5);
                      setBurstMode(v => !v);
                    }}
                  />
                </div>
                <AnimatePresence>
                  {burstMode && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      {/* Quantidade de vídeos por conta */}
                      <div className="mt-3">
                        <p className="text-[10px] text-ink-3 font-medium mb-2 uppercase tracking-wider">Quantos vídeos por conta</p>
                        <div className="flex items-center gap-2">
                          {[1, 3, 5, 10, 20].map(n => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setVideoCount(n)}
                              className={cn(
                                "px-3.5 py-2 rounded-xl text-sm font-bold border transition-all",
                                videoCount === n
                                  ? "bg-[#85B9E9]/15 text-[#85B9E9] border-[#85B9E9]/30"
                                  : "bg-surface-raised text-ink-3 border-line hover:border-line-control hover:text-ink-2"
                              )}
                            >
                              {n}
                            </button>
                          ))}
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={videoCount === -1 ? "" : videoCount}
                            onChange={e => {
                              const v = parseInt(e.target.value, 10);
                              if (!isNaN(v) && v >= 1) setVideoCount(Math.min(v, 999));
                            }}
                            placeholder="Outro"
                            className="w-20 px-3 py-2 rounded-xl bg-surface-raised border border-line-control text-ink text-sm text-center focus:outline-none focus:border-accent/40 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                        {selectedFolderId && folderVideoCount > 0 && videoCount > folderVideoCount && (
                          <p className="mt-1.5 text-[10px] text-amber-400/70">
                            A pasta tem só {folderVideoCount} vídeos — cada conta receberá {folderVideoCount}.
                          </p>
                        )}
                      </div>

                      {/* Estratégia de prioridade */}
                      <div className="mt-3">
                        <p className="text-[10px] text-ink-3 font-medium mb-2 uppercase tracking-wider">Ordem de distribuição</p>
                        <div className="flex flex-wrap gap-2">
                          {([
                            { value: "views", label: "Mais visualizados" },
                            { value: "least_usage", label: "Menor uso" },
                            { value: "random", label: "Aleatório" },
                          ] as const).map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setPriorityStrategy(opt.value)}
                              className={cn(
                                "px-3.5 py-2 rounded-xl text-sm font-bold border transition-all",
                                priorityStrategy === opt.value
                                  ? "bg-[#85B9E9]/15 text-[#85B9E9] border-[#85B9E9]/30"
                                  : "bg-surface-raised text-ink-3 border-line hover:border-line-control hover:text-ink-2"
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <p className="mt-1.5 text-[10px] text-ink-3">
                          {priorityStrategy === "views"
                            ? "Prioriza os Reels com mais views da origem e varia a atribuição entre contas."
                            : priorityStrategy === "least_usage"
                            ? "Distribui primeiro os vídeos menos usados historicamente (comportamento anterior)."
                            : "Sorteia os vídeos sem considerar views nem histórico."}
                        </p>
                      </div>

                      <p className="mt-3 text-[11px] text-[#85B9E9]/70 leading-relaxed">
                        Vídeos sorteados aleatoriamente da pasta, sem repetir entre as contas. A conta 1 posta
                        o lote inteiro de uma vez, depois a conta 2, depois a conta 3... começando agora,
                        sem agendamento e sem distribuição por dias.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Posts por dia + data de início — ocultos no Modo Ciclo */}
              <AnimatePresence initial={false}>
                {!burstMode && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    {/* Posts por dia */}
                    <div className="mb-5">
                      <p className="text-xs text-ink-3 font-medium mb-3 uppercase tracking-wider">Posts por dia por conta</p>
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
                                  ? "bg-[#85B9E9]/15 text-[#85B9E9] border-[#85B9E9]/30"
                                  : "bg-surface-raised text-ink-3 border-line hover:border-line-control hover:text-ink-2"
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
                      <p className="text-xs text-ink-3 font-medium mb-3 uppercase tracking-wider">Data e hora do primeiro post</p>
                      <input
                        type="datetime-local"
                        value={startDatetime}
                        min={minDatetime}
                        onChange={e => setStartDatetime(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-surface-raised border border-line-control text-ink text-sm focus:outline-none focus:border-brand-blue/40 focus:ring-1 focus:ring-brand-blue/20 transition-all [color-scheme:dark]"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Stagger entre contas */}
              <div className="mt-5">
                <p className="text-xs text-ink-3 font-medium mb-3 uppercase tracking-wider">Intervalo entre contas</p>
                <div className="space-y-3 p-4 rounded-xl border border-line bg-surface-raised">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-3">Auto</span>
                    <span className={cn(
                      "text-base font-bold",
                      accountStaggerSeconds ? "text-brand-blue" : "text-ink-3"
                    )}>
                      {accountStaggerSeconds ? `${accountStaggerSeconds}s` : "Automático"}
                    </span>
                    <span className="text-xs text-ink-3">5 min</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={300}
                    step={5}
                    value={accountStaggerSeconds ?? 0}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setAccountStaggerSeconds(v === 0 ? null : v);
                    }}
                    className="range-slider"
                    style={{
                      background: accountStaggerSeconds
                        ? `linear-gradient(to right, var(--brand-blue) 0%, var(--brand-blue) ${(accountStaggerSeconds / 300) * 100}%, var(--line) ${(accountStaggerSeconds / 300) * 100}%, var(--line) 100%)`
                        : `linear-gradient(to right, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.08) 100%)`
                    }}
                  />
                  {accountStaggerSeconds ? (
                    <p className="text-[11px] text-brand-blue">
                      {accountStaggerSeconds}s entre cada conta — arraste até o início para automático
                    </p>
                  ) : burstMode ? (
                    <p className="text-[11px] text-ink-3 italic">
                      Blocos em sequência imediata — use o slider para dar uma folga extra entre contas
                    </p>
                  ) : (
                    <p className="text-[11px] text-ink-3 italic">
                      Proporcional ao intervalo ÷ número de contas (máx. 5 min)
                    </p>
                  )}
                </div>
              </div>

              {/* Summary */}
              <AnimatePresence>
                {videosPerAccount > 0 && (burstMode || startDatetime) && selectedAccountIds.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="mt-5 rounded-xl border border-line bg-surface-hover p-4"
                  >
                    {(() => {
                      const days = Math.ceil(videosPerAccount / postsPerDay);
                      const totalPosts = videosPerAccount * selectedAccountIds.length;
                      return burstMode ? (
                        <p className="text-xs text-ink-2 leading-relaxed">
                          <span className="text-accent font-semibold">{videosPerAccount}</span> vídeos por conta ×{" "}
                          <span className="text-accent font-semibold">{selectedAccountIds.length}</span> conta{selectedAccountIds.length !== 1 ? "s" : ""} ={" "}
                          <span className="text-ink font-semibold">{totalPosts}</span> posts.
                          {" "}Cada conta posta seu lote <span className="text-accent font-semibold">de uma vez</span>, em sequência:
                          {" "}conta 1 → conta 2 → conta 3... com vídeos sorteados sem repetição entre elas.
                        </p>
                      ) : (
                        <p className="text-xs text-ink-2 leading-relaxed">
                          <span className="text-accent font-semibold">{videosPerAccount}</span> vídeos ×{" "}
                          <span className="text-accent font-semibold">{selectedAccountIds.length}</span> conta{selectedAccountIds.length !== 1 ? "s" : ""} ={" "}
                          <span className="text-ink font-semibold">{totalPosts}</span> posts ao longo de{" "}
                          <span className="text-ink font-semibold">{days}</span> dia{days !== 1 ? "s" : ""}.
                          {" "}Cada conta recebe os vídeos em ordem aleatória única.
                        </p>
                      );
                    })()}
                  </motion.div>
                )}
              </AnimatePresence>
            </SectionCard>

            {/* 4. Legenda */}
            <SectionCard>
              <SectionLabel Icon={List}>Legenda</SectionLabel>

              <CaptionModeSelector
                className="mb-4"
                value={captionMode}
                onChange={setCaptionMode}
                stripHashtags={stripHashtags}
                stripMentions={stripMentions}
                onStripHashtagsChange={setStripHashtags}
                onStripMentionsChange={setStripMentions}
                originalHint={
                  <>
                    Cada vídeo usará a legenda capturada junto do próprio Reel.{" "}
                    <span className="text-amber-300/80">
                      Vídeos sem legenda original serão publicados sem legenda.
                    </span>
                  </>
                }
              />

              {/* Legendas automáticas só existem dentro do modo Personalizada */}
              {captionMode === "custom" && (
              <div className="mb-3 p-3.5 rounded-xl border border-line bg-surface">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Sparkles size={13} className="text-brand-blue" />
                    <div>
                      <p className="text-sm font-medium text-ink">Legendas Automáticas</p>
                      <p className="text-[10px] text-ink-3">Curiosidades únicas em PT-BR por post</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoCaptionEnabled(v => !v)}
                    className={cn(
                      "relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
                      autoCaptionEnabled ? "bg-brand-blue/80" : "bg-line-control/30"
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
                      <div className="mt-3 p-2.5 rounded-lg bg-surface-raised border border-line">
                        <p className="text-[9px] text-ink-3 uppercase tracking-wider mb-1">Exemplo (cada post recebe uma legenda diferente)</p>
                        <p className="text-[10px] text-ink-2 leading-relaxed italic whitespace-pre-line">
                          {AUTO_CAPTION_PREVIEW_POSTAR}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              )}

              {captionMode === "custom" && !autoCaptionEnabled && (
                <CaptionEditor captions={captions} onChange={setCaptions} />
              )}
            </SectionCard>

            {/* 5. Exibição do Reel */}
            <SectionCard>
              <SectionLabel Icon={LayoutGrid}>Exibição do Reel</SectionLabel>
              <ReelPlacementSelector value={shareToFeed} onChange={setShareToFeed} />
            </SectionCard>

            {/* 6. Processamento do video */}
            <SectionCard>
              <SectionLabel Icon={SlidersHorizontal}>Processamento do vídeo</SectionLabel>
              <VideoProcessingSelector
                value={videoProcessingMode}
                onChange={setVideoProcessingMode}
              />
            </SectionCard>

            {/* 7. Proxy do estoque (opt-in) */}
            <SectionCard>
              <SectionLabel Icon={ShieldCheck}>Rota de publicação</SectionLabel>
              <ProxyPoolToggle
                value={useProxyPool}
                onChange={setUseProxyPool}
              />
            </SectionCard>

            {/* Error */}
            <AnimatePresence>
              {submitError && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <Banner tone="danger">{submitError}</Banner>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting}
              icon={submitting ? <Loader2 size={16} className="animate-spin" /> : burstMode ? <Zap size={16} /> : <Send size={16} />}
            >
              {submitting
                ? (burstMode ? "Postando agora..." : "Criando distribuição...")
                : (
                  <>
                    {burstMode ? "Postar Tudo Agora" : "Criar Distribuição"}
                    {videosPerAccount > 0 && selectedAccountIds.length > 0 && (
                      <span className="ml-1 opacity-70">
                        ({videosPerAccount * selectedAccountIds.length} posts · {selectedAccountIds.length} conta{selectedAccountIds.length !== 1 ? "s" : ""})
                      </span>
                    )}
                  </>
                )}
            </Button>
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
              <p className="text-[10px] text-ink-3 uppercase tracking-wider">Como funciona</p>
              {[
                { icon: Shuffle, text: "Cada conta recebe os vídeos em uma ordem aleatória diferente" },
                { icon: CalendarDays, text: "Posts distribuídos uniformemente ao longo do dia" },
                { icon: Clock, text: accountStaggerSeconds ? `${accountStaggerSeconds}s de stagger entre contas` : "Stagger automático entre contas — sem burst simultâneo" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-2">
                  <Icon size={10} className="text-[#00498D]/50 mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] text-ink-3 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
