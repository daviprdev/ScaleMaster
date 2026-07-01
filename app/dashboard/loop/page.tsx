"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Repeat2, Plus, Play, Pause, Trash2, Edit3, X,
  Folder, Users, Clock, Infinity, Hash, Type,
  ImageIcon, FlipHorizontal, Contrast, Check,
  Loader2, AlertCircle, ChevronDown, Info, Film, AlertTriangle,
  BarChart2, Heart, MessageCircle, Eye, Crown, TrendingUp, ChevronUp,
  Save, Library, BookMarked, Shuffle, CheckCircle2,
  ZoomIn, Waves, Droplets, Shield, Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  health_status?: "online" | "error" | "blocked";
  folder_id?: string | null;
  account_folders?: { name: string } | null;
}

interface Folder {
  id: string;
  name: string;
}

interface AccountFolder {
  id: string;
  name: string;
  account_count?: number;
}

interface LoopAccountData {
  account_id: string;
  instagram_accounts?: Account | null;
}

interface Loop {
  id: string;
  name: string;
  folder_id: string | null;
  account_folder_id: string | null;
  is_infinite: boolean;
  cycles: number;
  interval_minutes: number;
  media_limit: number | null;
  captions: string[];
  cover_image_url: string | null;
  effect_mirror:   boolean;
  effect_invert:   boolean;
  auto_caption_enabled?: boolean;
  auto_caption_type?: string | null;
  effect_zoom:     boolean;
  effect_blur:     boolean;
  effect_noise:    boolean;
  effect_anti_ai:  boolean;
  status: "active" | "paused";
  created_at: string;
  loop_accounts?: LoopAccountData[];
  library_folders?: Folder | null;
}

interface FormData {
  name: string;
  accountMode: "folder" | "specific";
  accountFolderId: string;
  accountIds: string[];
  folderId: string;
  isInfinite: boolean;
  cycles: number;
  intervalMinutes: number;
  mediaLimit: number | null;
  captions: string[];
  coverFile: File | null;
  coverPreviewUrl: string | null;
  effectMirror:  boolean;
  effectInvert:  boolean;
  effectZoom:    boolean;
  effectBlur:    boolean;
  effectNoise:   boolean;
  effectAntiAi:  boolean;
  autoCaptionEnabled: boolean;
  autoCaptionType: string;
  accountStaggerSeconds: number | null;
}

interface SavedCaption {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
}

const AUTO_CAPTION_TYPES = [
  { id: "curiosidades-gerais", label: "Curiosidades Gerais", emoji: "💡", desc: "Fatos do dia a dia" },
  { id: "curiosidades-tops",   label: "Curiosidades Tops",   emoji: "🏆", desc: "Fatos virais e surpreendentes" },
  { id: "fatos-complexos",     label: "Fatos Complexos",     emoji: "🔬", desc: "Ciência acessível" },
] as const;

const AUTO_CAPTION_PREVIEWS: Record<string, string> = {
  "curiosidades-gerais": "🍯 O mel nunca estraga. Arqueólogos encontraram potes com mais de 3.000 anos nas pirâmides do Egito — e ainda estavam comestíveis!",
  "curiosidades-tops":   "🤯 INACREDITÁVEL: Você existe porque TODOS os seus ancestrais sobreviveram e tiveram filhos desde o início da vida na Terra. Você é um milagre de bilhões de anos!",
  "fatos-complexos":     "🧠 A memória humana não funciona como um HD. Cada vez que você se lembra de algo, reconstrói a memória do zero — e a modifica sutilmente.",
};

const DEFAULT_FORM: FormData = {
  name: "",
  accountMode: "folder",
  accountFolderId: "",
  accountIds: [],
  folderId: "",
  isInfinite: true,
  cycles: 1,
  intervalMinutes: 30,
  mediaLimit: null,
  captions: [""],
  coverFile: null,
  coverPreviewUrl: null,
  effectMirror: false,
  effectInvert: false,
  effectZoom:   false,
  effectBlur:   false,
  effectNoise:  false,
  effectAntiAi: true,
  autoCaptionEnabled: false,
  autoCaptionType: "curiosidades-gerais",
  accountStaggerSeconds: null,
};

// ── Analytics types ───────────────────────────────────────────

interface LoopAnalytics {
  loop: { id: string; name: string; cycles_done: number; created_at: string };
  progress: {
    total_videos: number;       // vídeos_na_pasta × contas (denominador real de 1 ciclo)
    videos_in_folder: number;
    accounts_count: number;
    published: number;
    errors: number;
    pending: number;
    remaining: number;
  };
  engagement: {
    total_likes: number;
    total_comments: number;
    total_plays: number;
    total_reach: number;
  };
  account_ranking: Array<{
    account_id: string;
    username: string;
    avatar_url: string | null;
    followers_count: number | null;
    posts_count: number;
    total_likes: number;
    total_comments: number;
    total_plays: number;
    engagement_score: number;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatInterval(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}min`;
}

// ── Toggle component ──────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex w-11 h-6 rounded-full transition-all duration-200 focus:outline-none flex-shrink-0",
        checked
          ? "bg-violet-600 shadow-[0_0_10px_rgba(139,92,246,0.4)]"
          : "bg-white/10"
      )}
    >
      <span className={cn(
        "inline-block w-4 h-4 mt-1 rounded-full bg-white shadow-sm transition-transform duration-200",
        checked ? "translate-x-6" : "translate-x-1"
      )} />
    </button>
  );
}

// ── SectionLabel ─────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={13} className="text-violet-400/80" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">{label}</span>
    </div>
  );
}

// ── LoopAnalyticsPanel ────────────────────────────────────────

function LoopAnalyticsPanel({ loopId }: { loopId: string }) {
  const [data, setData] = useState<LoopAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/loops/${loopId}/analytics`)
      .then(r => r.json())
      .then((d: LoopAnalytics & { error?: string }) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(() => setError("Falha ao carregar analytics."))
      .finally(() => setLoading(false));
  }, [loopId]);

  if (loading) {
    return (
      <div className="pt-3 space-y-3 animate-pulse">
        <div className="h-2 bg-white/[0.05] rounded-full w-full" />
        <div className="h-2 bg-white/[0.04] rounded-full w-3/4" />
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3].map(i => <div key={i} className="h-10 bg-white/[0.04] rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="pt-3 text-center py-4">
        <p className="text-xs text-white/25">{error ?? "Nenhum dado ainda."}</p>
        <p className="text-[11px] text-white/15 mt-1">Os dados aparecem após a primeira publicação.</p>
      </div>
    );
  }

  const { progress, engagement, account_ranking } = data;
  const totalTracked = progress.total_videos || 1;
  const publishedPct = Math.min(100, (progress.published / totalTracked) * 100);
  const errorPct     = Math.min(100, (progress.errors    / totalTracked) * 100);

  const proxyImg = (url: string) => `/api/proxy-image?url=${encodeURIComponent(url)}`;

  return (
    <div className="pt-3 space-y-4">

      {/* ── Barra de progresso ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-white/40 font-medium uppercase tracking-wide">Progresso da Fila</span>
          <span className="text-white/35">
            {progress.published}/{progress.total_videos} posts
            {progress.videos_in_folder > 0 && progress.accounts_count > 1 && (
              <span className="text-white/20 ml-1">
                ({progress.videos_in_folder}v × {progress.accounts_count}c)
              </span>
            )}
          </span>
        </div>
        {/* Barra segmentada */}
        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
          {publishedPct > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${publishedPct}%` }}
            />
          )}
          {errorPct > 0 && (
            <div
              className="h-full bg-red-500/70 transition-all duration-700"
              style={{ width: `${errorPct}%` }}
            />
          )}
        </div>
        {/* Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {progress.published} publicado{progress.published !== 1 ? "s" : ""}
          </span>
          {progress.errors > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              {progress.errors} erro{progress.errors !== 1 ? "s" : ""}
            </span>
          )}
          {progress.pending > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {progress.pending} em fila
            </span>
          )}
          {progress.remaining > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-white/30">
              <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
              {progress.remaining} restante{progress.remaining !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Engajamento total ── */}
      {(engagement.total_plays > 0 || engagement.total_likes > 0 || engagement.total_comments > 0) ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center gap-0.5 p-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <Eye size={12} className="text-cyan-400/70" />
            <span className="text-sm font-bold text-white/80">{formatNumber(engagement.total_plays)}</span>
            <span className="text-[9px] text-white/25 uppercase tracking-wide">Views</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 p-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <Heart size={12} className="text-pink-400/70" />
            <span className="text-sm font-bold text-white/80">{formatNumber(engagement.total_likes)}</span>
            <span className="text-[9px] text-white/25 uppercase tracking-wide">Curtidas</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 p-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <MessageCircle size={12} className="text-violet-400/70" />
            <span className="text-sm font-bold text-white/80">{formatNumber(engagement.total_comments)}</span>
            <span className="text-[9px] text-white/25 uppercase tracking-wide">Comentários</span>
          </div>
        </div>
      ) : (
        progress.published > 0 && (
          <p className="text-[11px] text-white/20 text-center py-1">
            Insights ainda sendo coletados da Meta API…
          </p>
        )
      )}

      {/* ── Ranking de contas ── */}
      {account_ranking.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-white/30 uppercase tracking-wide mb-2">
            <TrendingUp size={10} />
            Ranking de Curtidas
          </div>
          <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-1.5 pr-0.5">
          {account_ranking.map((acc, idx) => {
            const isChampion = idx === 0 && acc.total_likes > 0;
            const engagementLabel = acc.total_likes > 0
              ? `${formatNumber(acc.total_likes)} curtidas`
              : `${acc.posts_count} post${acc.posts_count !== 1 ? "s" : ""}`;

            return (
              <div
                key={acc.account_id}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all",
                  isChampion
                    ? "bg-amber-500/[0.06] border-amber-500/20"
                    : "bg-white/[0.02] border-white/[0.05]"
                )}
              >
                {/* Rank number */}
                <span className={cn(
                  "text-[10px] font-bold w-4 flex-shrink-0 text-center",
                  isChampion ? "text-amber-400" : "text-white/25"
                )}>
                  {isChampion ? <Crown size={12} className="text-amber-400" /> : `#${idx + 1}`}
                </span>

                {/* Avatar */}
                {acc.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={proxyImg(acc.avatar_url)}
                    alt={acc.username}
                    className={cn(
                      "w-6 h-6 rounded-full object-cover flex-shrink-0",
                      isChampion ? "ring-1 ring-amber-400/50" : "ring-1 ring-white/10"
                    )}
                  />
                ) : (
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0",
                    isChampion
                      ? "bg-gradient-to-br from-amber-400 to-orange-500"
                      : "bg-gradient-to-br from-violet-500 to-cyan-500"
                  )}>
                    {acc.username.charAt(0).toUpperCase()}
                  </div>
                )}

                {/* Username + followers */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-xs font-semibold truncate",
                    isChampion ? "text-amber-300" : "text-white/70"
                  )}>
                    @{acc.username}
                  </p>
                  {acc.followers_count != null && acc.followers_count > 0 && (
                    <p className="text-[9px] text-white/20">
                      {formatNumber(acc.followers_count)} seguidores
                    </p>
                  )}
                </div>

                {/* Score */}
                <span className={cn(
                  "text-[10px] font-bold flex-shrink-0",
                  isChampion ? "text-amber-400" : "text-white/35"
                )}>
                  {engagementLabel}
                </span>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LoopCard ──────────────────────────────────────────────────

function LoopCard({
  loop,
  accountFolders,
  onToggleStatus,
  onEdit,
  onDelete,
}: {
  loop: Loop;
  accountFolders: AccountFolder[];
  onToggleStatus: (loop: Loop) => void;
  onEdit: (loop: Loop) => void;
  onDelete: (loop: Loop) => void;
}) {
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const accounts = loop.loop_accounts?.map(la => la.instagram_accounts).filter(Boolean) as Account[] ?? [];
  const accountFolder = accountFolders.find(f => f.id === loop.account_folder_id);
  const isActive = loop.status === "active";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="glass-card p-5 space-y-4 hover:border-white/15 transition-all duration-200"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
            isActive
              ? "bg-violet-600/20 shadow-[0_0_12px_rgba(139,92,246,0.25)]"
              : "bg-white/[0.04]"
          )}>
            <Repeat2 size={16} className={isActive ? "text-violet-400" : "text-white/25"} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/90 truncate">{loop.name}</p>
            <p className="text-[11px] text-white/30 mt-0.5">
              {loop.library_folders?.name ?? "Sem pasta"}
            </p>
          </div>
        </div>
        {/* Status badge */}
        <span className={cn(
          "flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
          isActive
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-white/[0.04] text-white/30 border-white/[0.07]"
        )}>
          {isActive ? "Ativo" : "Pausado"}
        </span>
      </div>

      {/* Info row */}
      <div className="flex items-center gap-4 text-[11px] text-white/35">
        <span className="flex items-center gap-1.5">
          {loop.is_infinite
            ? <><Infinity size={11} /> Infinito</>
            : <><Hash size={11} /> {loop.cycles} ciclo{loop.cycles !== 1 ? "s" : ""}</>}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock size={11} />
          {formatInterval(loop.interval_minutes)}
        </span>
        {(loop.effect_mirror || loop.effect_invert || loop.effect_zoom || loop.effect_blur || loop.effect_noise || loop.effect_anti_ai) && (
          <span className="flex items-center gap-1">
            {loop.effect_mirror   && <FlipHorizontal size={10} className="text-cyan-400/60" />}
            {loop.effect_invert   && <Contrast       size={10} className="text-cyan-400/60" />}
            {loop.effect_zoom     && <ZoomIn         size={10} className="text-cyan-400/60" />}
            {loop.effect_blur     && <Droplets       size={10} className="text-cyan-400/60" />}
            {loop.effect_noise    && <Waves          size={10} className="text-cyan-400/60" />}
            {loop.effect_anti_ai  && <Shield         size={10} className="text-cyan-400/60" />}
          </span>
        )}
      </div>

      {/* Accounts / Account Folder */}
      {loop.account_folder_id ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-violet-500/20 bg-violet-600/[0.07]">
            <Folder size={11} className="text-violet-400/70 flex-shrink-0" />
            <span className="text-[11px] text-violet-300/80 font-medium">{accountFolder?.name ?? "Pasta"}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-600/20 text-violet-400 font-semibold uppercase tracking-wide">Auto</span>
          </div>
          <span className="text-[10px] text-white/25">novas contas entram automaticamente</span>
        </div>
      ) : accounts.length > 0 ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {accounts.slice(0, 5).map(acc => {
            const fell = acc.health_status === "error" || acc.health_status === "blocked";
            return (
              <div
                key={acc.id}
                title={fell
                  ? `@${acc.username} — ${acc.health_status === "blocked" ? "conta bloqueada" : "token inválido, reconectar"}`
                  : `@${acc.username}`}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded-lg border",
                  fell
                    ? "bg-red-500/[0.07] border-red-500/20"
                    : "bg-white/[0.04] border-white/[0.07]"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0",
                  fell ? "bg-red-500/40" : "bg-gradient-to-br from-violet-500 to-cyan-500"
                )}>
                  {acc.username.charAt(0).toUpperCase()}
                </div>
                <span className={cn("text-[10px]", fell ? "text-red-400/80" : "text-white/50")}>
                  @{acc.username}
                </span>
                {fell && <AlertCircle size={9} className="text-red-400 flex-shrink-0" />}
              </div>
            );
          })}
          {accounts.length > 5 && (
            <span className="text-[10px] text-white/25">+{accounts.length - 5}</span>
          )}
        </div>
      ) : null}

      {/* Analytics expandable panel */}
      <AnimatePresence initial={false}>
        {analyticsOpen && (
          <motion.div
            key="analytics"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden border-t border-white/[0.05]"
          >
            <LoopAnalyticsPanel loopId={loop.id} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-white/[0.05]">
        <button
          onClick={() => onToggleStatus(loop)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
            isActive
              ? "bg-white/[0.05] text-white/50 hover:bg-amber-500/10 hover:text-amber-400 border border-transparent hover:border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
          )}
        >
          {isActive ? <Pause size={11} /> : <Play size={11} />}
          {isActive ? "Pausar" : "Retomar"}
        </button>
        <button
          onClick={() => onEdit(loop)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-all duration-150"
        >
          <Edit3 size={11} />
          Editar
        </button>
        {/* Analytics toggle */}
        <button
          onClick={() => setAnalyticsOpen(o => !o)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
            analyticsOpen
              ? "bg-violet-600/15 text-violet-300 border border-violet-500/25"
              : "text-white/35 hover:text-violet-400 hover:bg-violet-600/10"
          )}
        >
          <BarChart2 size={11} />
          Analytics
          {analyticsOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
        <button
          onClick={() => onDelete(loop)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/25 hover:text-red-400 hover:bg-red-500/[0.07] transition-all duration-150"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </motion.div>
  );
}

// ── MediaLimitSelector ────────────────────────────────────────

const LIMIT_PRESETS = [null, 5, 10, 20] as const;

function MediaLimitSelector({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const isCustom = value !== null && !(LIMIT_PRESETS as readonly (number | null)[]).includes(value);
  const [customStr, setCustomStr] = useState(() => (isCustom ? String(value) : ""));

  const activateCustom = () => {
    const n = Math.max(1, Number(customStr) || 1);
    setCustomStr(String(n));
    onChange(n);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { label: "Toda a pasta", v: null as number | null | "custom" },
            { label: "5 vídeos", v: 5 as number | null | "custom" },
            { label: "10 vídeos", v: 10 as number | null | "custom" },
            { label: "20 vídeos", v: 20 as number | null | "custom" },
            { label: "Personalizado", v: "custom" as number | null | "custom" },
          ] as { label: string; v: number | null | "custom" }[]
        ).map(({ label, v }) => {
          const active = v === "custom" ? isCustom : value === v;
          return (
            <button
              key={String(v)}
              type="button"
              onClick={() => (v === "custom" ? activateCustom() : onChange(v as number | null))}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150",
                active
                  ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
                  : "bg-white/[0.03] border-white/[0.08] text-white/50 hover:text-white/80 hover:border-white/20"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {isCustom && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.07] bg-white/[0.03]">
              <label className="text-xs text-white/50 flex-shrink-0">Quantidade exata:</label>
              <input
                type="number"
                min={1}
                max={999}
                value={customStr}
                onChange={e => {
                  setCustomStr(e.target.value);
                  const n = Math.max(1, Number(e.target.value) || 1);
                  onChange(n);
                }}
                className="input-glass text-sm w-24 text-center py-1.5"
              />
              <span className="text-xs text-white/30">vídeos</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[11px] text-white/25 flex items-start gap-1.5">
        <Info size={10} className="flex-shrink-0 mt-0.5" />
        O loop rotacionará apenas dentro dos vídeos selecionados, ignorando o restante da pasta.
      </p>
    </div>
  );
}

// ── AccountsMultiSelect ───────────────────────────────────────

function AccountsMultiSelect({
  accounts,
  selected,
  onChange,
}: {
  accounts: Account[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; accounts: Account[] }>();
    for (const acc of accounts) {
      if (!acc.folder_id) continue; // ignora contas sem pasta
      const key = acc.folder_id;
      const name = acc.account_folders?.name ?? "";
      if (!map.has(key)) map.set(key, { name, accounts: [] });
      map.get(key)!.accounts.push(acc);
    }
    const result: Array<{ folderId: string; folderName: string; accounts: Account[] }> = [];
    for (const [folderId, { name, accounts: accs }] of map) {
      result.push({ folderId, folderName: name, accounts: accs });
    }
    result.sort((a, b) => a.folderName.localeCompare(b.folderName));
    return result;
  }, [accounts]);

  const healthyIds = (accs: Account[]) =>
    accs.filter(a => a.health_status !== "error" && a.health_status !== "blocked").map(a => a.id);

  const isFolderFullySelected = (accs: Account[]) => {
    const ids = healthyIds(accs);
    return ids.length > 0 && ids.every(id => selected.includes(id));
  };

  const isFolderPartial = (accs: Account[]) => {
    const ids = healthyIds(accs);
    return ids.some(id => selected.includes(id)) && !ids.every(id => selected.includes(id));
  };

  const toggleFolder = (accs: Account[]) => {
    const ids = healthyIds(accs);
    const allSel = ids.every(id => selected.includes(id));
    if (allSel) onChange(selected.filter(id => !ids.includes(id)));
    else onChange([...selected, ...ids.filter(id => !selected.includes(id))]);
  };

  // Só contas que estão em uma pasta
  const accountsInFolders = accounts.filter(a => a.folder_id);

  if (accountsInFolders.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center text-xs text-white/30">
        Nenhuma conta em pasta. Crie pastas e mova suas contas na aba Contas.
      </div>
    );
  }

  const allHealthy = accountsInFolders.filter(a => a.health_status !== "error" && a.health_status !== "blocked");
  const allSelected = allHealthy.length > 0 && allHealthy.every(a => selected.includes(a.id));

  return (
    <div className="space-y-3">
      {/* Ações globais */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(allHealthy.map(a => a.id))}
          className={cn(
            "text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all",
            allSelected
              ? "bg-[#00FF41]/10 border-[#00FF41]/25 text-[#00FF41]"
              : "border-white/[0.08] text-white/35 hover:text-[#00FF41] hover:border-[#00FF41]/20 hover:bg-[#00FF41]/[0.05]"
          )}
        >
          {allSelected ? <><Check size={10} className="inline mr-1" />Todas selecionadas</> : "Selecionar todas"}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-white/[0.06] text-white/25 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/[0.05] transition-all"
          >
            Limpar
          </button>
        )}
        {selected.length > 0 && (
          <span className="ml-auto text-[11px] text-white/35">
            {selected.length} selecionada{selected.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Grupos por pasta */}
      <div className="space-y-2">
        {groups.map(({ folderId, folderName, accounts: groupAccounts }) => {
          const fullySel = isFolderFullySelected(groupAccounts);
          const partial = isFolderPartial(groupAccounts);

          return (
            <div key={folderId} className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              {/* Cabeçalho da pasta — clicável para selecionar toda a pasta */}
              <button
                type="button"
                onClick={() => toggleFolder(groupAccounts)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                  fullySel
                    ? "bg-violet-600/10"
                    : "hover:bg-white/[0.03]"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all",
                  fullySel
                    ? "bg-violet-600 border-violet-600"
                    : partial
                      ? "bg-violet-600/30 border-violet-500/40"
                      : "border-white/20"
                )}>
                  {fullySel && <Check size={9} className="text-white" />}
                  {partial && <div className="w-1.5 h-1.5 rounded-sm bg-violet-400" />}
                </div>
                <Folder size={11} className="flex-shrink-0 text-violet-400/70" />
                <span className={cn(
                  "text-xs font-semibold flex-1 truncate",
                  fullySel ? "text-violet-200" : partial ? "text-white/60" : "text-white/45"
                )}>
                  {folderName}
                </span>
                <span className="text-[10px] text-white/25 flex-shrink-0">
                  {healthyIds(groupAccounts).length} conta{healthyIds(groupAccounts).length !== 1 ? "s" : ""}
                </span>
              </button>

              {/* Contas da pasta — chips compactos */}
              <div className="flex flex-wrap gap-1.5 px-3 pb-2.5 pt-1">
                {groupAccounts.map(acc => {
                  const isSel = selected.includes(acc.id);
                  const fell = acc.health_status === "error" || acc.health_status === "blocked";
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => !fell && toggle(acc.id)}
                      disabled={fell}
                      title={fell ? `@${acc.username} está desconectada` : `@${acc.username}`}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-all",
                        fell
                          ? "border-red-500/15 bg-red-500/[0.06] text-red-400/50 cursor-not-allowed"
                          : isSel
                            ? "border-violet-500/40 bg-violet-600/15 text-violet-200 cursor-pointer hover:bg-violet-600/25"
                            : "border-white/[0.07] bg-white/[0.03] text-white/40 cursor-pointer hover:text-white/70 hover:border-white/15"
                      )}
                    >
                      {fell && <AlertTriangle size={8} className="flex-shrink-0 text-red-400/60" />}
                      {isSel && !fell && <Check size={8} className="flex-shrink-0 text-violet-400" />}
                      <span className="font-medium">@{acc.username}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── LoopCaptionEditor ─────────────────────────────────────────

function LoopCaptionEditor({
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
    next[i] = val.slice(0, 2200);
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
    <div className="space-y-2.5">
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
                <div className="absolute top-3 left-3 flex items-center gap-1 pointer-events-none z-10">
                  <span className="text-[10px] font-mono text-[#00FF41]/50 bg-[#00FF41]/10 rounded-md px-1.5 py-0.5">
                    #{i + 1}
                  </span>
                </div>
                <textarea
                  rows={2}
                  placeholder={`Variação ${i + 1}...`}
                  value={cap}
                  onChange={e => update(i, e.target.value)}
                  className="w-full pl-14 pr-10 pt-3 pb-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm placeholder-white/20 resize-none focus:outline-none focus:border-[#00FF41]/40 focus:ring-1 focus:ring-[#00FF41]/20 transition-all leading-relaxed"
                  maxLength={2200}
                />
                <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] transition-colors",
                    cap.length > 1980 ? "text-yellow-400" : "text-white/20"
                  )}>
                    {cap.length}/2200
                  </span>
                  {captions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-white/25 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>

              {/* Save-to-library inline */}
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
                          type="button"
                          onClick={() => handleSave(i)}
                          disabled={savingApi}
                          className="px-3 py-1.5 rounded-lg bg-[#00FF41]/15 text-[#00FF41] text-xs font-medium hover:bg-[#00FF41]/25 transition-all disabled:opacity-50 flex items-center gap-1"
                        >
                          {savingApi ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => { setSavingFor(null); setSaveTitle(""); }}
                          className="w-6 h-6 flex items-center justify-center text-white/25 hover:text-white/60 transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
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

      {/* Bottom actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={add}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-white/15 text-white/40 text-sm hover:border-[#00FF41]/40 hover:text-[#00FF41]/60 transition-all"
        >
          <Plus size={14} />
          Adicionar variação
        </button>

        <div ref={libraryRef} className="relative">
          <button
            type="button"
            onClick={() => setShowLibrary(v => !v)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all",
              showLibrary
                ? "border-[#00E5FF]/40 bg-[#00E5FF]/[0.08] text-[#00E5FF]"
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
                  <button type="button" onClick={() => setShowLibrary(false)} className="text-white/25 hover:text-white/60 transition-colors">
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
                      <p className="text-white/15 text-[10px] mt-1">Use &ldquo;Salvar esta legenda&rdquo; abaixo de qualquer variação.</p>
                    </div>
                  ) : (
                    savedCaptions.map(sc => (
                      <div
                        key={sc.id}
                        className="group flex items-start gap-2 px-4 py-3 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04] last:border-0"
                      >
                        <button
                          type="button"
                          onClick={() => inject(sc.content)}
                          className="flex-1 text-left min-w-0"
                        >
                          {sc.title && (
                            <p className="text-xs font-medium text-[#00E5FF]/80 truncate mb-0.5">{sc.title}</p>
                          )}
                          <p className="text-xs text-white/55 line-clamp-2 leading-relaxed">{sc.content}</p>
                          <p className="text-[9px] text-white/20 mt-1">Clique para adicionar</p>
                        </button>
                        <button
                          type="button"
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
                    <p className="text-[9px] text-white/20 text-center">Clique em uma legenda para adicioná-la ao loop</p>
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
          Legendas sorteadas aleatoriamente por post
        </p>
      )}
    </div>
  );
}

// ── LoopFormModal ─────────────────────────────────────────────

function LoopFormModal({
  editingLoop,
  accounts,
  folders,
  accountFolders,
  onSave,
  onClose,
}: {
  editingLoop: Loop | null;
  accounts: Account[];
  folders: Folder[];
  accountFolders: AccountFolder[];
  onSave: (form: FormData, loopId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormData>(() => {
    if (editingLoop) {
      return {
        name: editingLoop.name,
        accountMode: editingLoop.account_folder_id ? "folder" : "specific",
        accountFolderId: editingLoop.account_folder_id ?? "",
        accountIds: editingLoop.loop_accounts?.map(la => la.account_id) ?? [],
        folderId: editingLoop.folder_id ?? "",
        isInfinite: editingLoop.is_infinite,
        cycles: editingLoop.cycles,
        intervalMinutes: editingLoop.interval_minutes,
        mediaLimit: editingLoop.media_limit ?? null,
        captions: Array.isArray(editingLoop.captions) && editingLoop.captions.length > 0 ? editingLoop.captions : [""],
        coverFile: null,
        coverPreviewUrl: editingLoop.cover_image_url,
        effectMirror: editingLoop.effect_mirror,
        effectInvert: editingLoop.effect_invert,
        effectZoom:   editingLoop.effect_zoom   ?? false,
        effectBlur:   editingLoop.effect_blur   ?? false,
        effectNoise:  editingLoop.effect_noise  ?? false,
        effectAntiAi: editingLoop.effect_anti_ai ?? true,
        autoCaptionEnabled: editingLoop.auto_caption_enabled ?? false,
        autoCaptionType: editingLoop.auto_caption_type ?? "curiosidades-gerais",
        accountStaggerSeconds: (editingLoop as any).account_stagger_seconds ?? null,
      };
    }
    return DEFAULT_FORM;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setForm(prev => ({ ...prev, coverFile: file, coverPreviewUrl: previewUrl }));
    e.target.value = "";
  };

  const removeCover = () => setForm(prev => ({ ...prev, coverFile: null, coverPreviewUrl: null }));

  const sliderPct = ((form.intervalMinutes - 10) / (1440 - 10)) * 100;

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError("Dê um nome ao loop."); return; }
    if (form.accountMode === "folder" && !form.accountFolderId) { setError("Selecione uma pasta de contas."); return; }
    if (form.accountMode === "specific" && form.accountIds.length === 0) { setError("Selecione pelo menos uma conta."); return; }
    if (!form.folderId) { setError("Selecione uma pasta da biblioteca."); return; }
    if (form.autoCaptionEnabled && !form.autoCaptionType) { setError("Selecione um tipo de legenda automática."); return; }
    setError(null);
    setSaving(true);
    try {
      await onSave(form, editingLoop?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.93, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="glass w-full max-w-2xl rounded-2xl border border-white/10 flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-600/20 flex items-center justify-center">
              <Repeat2 size={16} className="text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {editingLoop ? "Editar Loop" : "Novo Loop"}
              </h2>
              <p className="text-xs text-white/35">Configure a publicação automática em ciclo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.05] transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

          {/* Nome */}
          <div>
            <SectionLabel icon={Type} label="Identificação" />
            <input
              type="text"
              placeholder="Ex: Reels Fitness — Contas Principais"
              value={form.name}
              onChange={e => update("name", e.target.value)}
              className="input-glass w-full text-sm"
              maxLength={80}
            />
          </div>

          {/* Contas */}
          <div>
            <SectionLabel icon={Users} label="Contas do Instagram" />
            {/* Mode toggle */}
            <div className="flex rounded-xl border border-white/[0.08] overflow-hidden mb-4">
              <button
                type="button"
                onClick={() => update("accountMode", "folder")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-all",
                  form.accountMode === "folder"
                    ? "bg-violet-600/20 text-violet-200 border-r border-violet-500/20"
                    : "text-white/40 hover:text-white/70 border-r border-white/[0.05]"
                )}
              >
                <Folder size={12} />
                Pasta de contas
              </button>
              <button
                type="button"
                onClick={() => update("accountMode", "specific")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-all",
                  form.accountMode === "specific"
                    ? "bg-violet-600/20 text-violet-200"
                    : "text-white/40 hover:text-white/70"
                )}
              >
                <Users size={12} />
                Contas específicas
              </button>
            </div>

            {form.accountMode === "folder" ? (
              <div className="space-y-3">
                <select
                  value={form.accountFolderId}
                  onChange={e => update("accountFolderId", e.target.value)}
                  className="input-glass w-full text-sm"
                >
                  <option value="">Selecione uma pasta de contas...</option>
                  {accountFolders.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.account_count !== undefined ? ` (${f.account_count} conta${f.account_count !== 1 ? "s" : ""})` : ""}
                    </option>
                  ))}
                </select>
                {accountFolders.length === 0 && (
                  <p className="text-xs text-amber-400/60 flex items-center gap-1.5">
                    <AlertCircle size={11} />
                    Nenhuma pasta de contas encontrada. Crie pastas na aba Contas primeiro.
                  </p>
                )}
                {form.accountFolderId && (
                  <p className="text-[11px] text-white/30 flex items-start gap-1.5">
                    <Info size={10} className="flex-shrink-0 mt-0.5" />
                    Novas contas adicionadas a esta pasta entrarão automaticamente neste loop.
                  </p>
                )}
              </div>
            ) : (
              <AccountsMultiSelect
                accounts={accounts}
                selected={form.accountIds}
                onChange={ids => update("accountIds", ids)}
              />
            )}
          </div>

          {/* Pasta */}
          <div>
            <SectionLabel icon={Folder} label="Pasta da Biblioteca" />
            <select
              value={form.folderId}
              onChange={e => update("folderId", e.target.value)}
              className="input-glass w-full text-sm"
            >
              <option value="">Selecione uma pasta...</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            {folders.length === 0 && (
              <p className="text-xs text-amber-400/60 mt-2 flex items-center gap-1.5">
                <AlertCircle size={11} />
                Nenhuma pasta encontrada. Crie pastas na Biblioteca primeiro.
              </p>
            )}
          </div>

          {/* Limite de mídias */}
          <div>
            <SectionLabel icon={Film} label="Quantidade de mídias por ciclo" />
            <MediaLimitSelector
              value={form.mediaLimit}
              onChange={v => update("mediaLimit", v)}
            />
          </div>

          {/* Ciclos */}
          <div>
            <SectionLabel icon={Hash} label="Ciclos" />
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div>
                  <p className="text-sm text-white/80 font-medium">Loop infinito</p>
                  <p className="text-xs text-white/30 mt-0.5">Repete indefinidamente enquanto ativo</p>
                </div>
                <Toggle checked={form.isInfinite} onChange={v => update("isInfinite", v)} />
              </div>

              <AnimatePresence>
                {!form.isInfinite && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                      <label className="text-sm text-white/60 flex-shrink-0">Quantidade de ciclos:</label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={form.cycles}
                        onChange={e => update("cycles", Math.max(1, Number(e.target.value)))}
                        className="input-glass text-sm w-24 text-center py-1.5"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Intervalo */}
          <div>
            <SectionLabel icon={Clock} label="Intervalo entre postagens" />
            <div className="space-y-3 p-4 rounded-xl border border-white/[0.07] bg-white/[0.03]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">10 min</span>
                <span className="text-base font-bold text-violet-300">
                  {formatInterval(form.intervalMinutes)}
                </span>
                <span className="text-xs text-white/40">24h</span>
              </div>
              <input
                type="range"
                min={10}
                max={1440}
                step={5}
                value={form.intervalMinutes}
                onChange={e => update("intervalMinutes", Number(e.target.value))}
                className="range-slider"
                style={{
                  background: `linear-gradient(to right, rgb(124,58,237) 0%, rgb(124,58,237) ${sliderPct}%, rgba(255,255,255,0.08) ${sliderPct}%, rgba(255,255,255,0.08) 100%)`
                }}
              />
              <p className="text-[11px] text-amber-400/50 flex items-center gap-1.5">
                <AlertCircle size={10} />
                Mínimo 10 minutos para evitar bloqueios automáticos do Instagram.
              </p>
            </div>
          </div>

          {/* Stagger entre contas */}
          <div>
            <SectionLabel icon={Clock} label="Intervalo entre contas" />
            <div className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.03] space-y-3">
              <p className="text-[11px] text-white/40">
                Tempo mínimo em segundos entre cada conta ao postar num ciclo. Deixe vazio para cálculo automático.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={5}
                  max={3600}
                  placeholder="Auto"
                  value={form.accountStaggerSeconds ?? ""}
                  onChange={e => {
                    const v = e.target.value;
                    update("accountStaggerSeconds", v === "" ? null : Math.max(5, Number(v)));
                  }}
                  className="input-glass w-28 text-center text-sm"
                />
                <span className="text-xs text-white/40">segundos por conta</span>
                {form.accountStaggerSeconds !== null && (
                  <button
                    type="button"
                    onClick={() => update("accountStaggerSeconds", null)}
                    className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    Limpar
                  </button>
                )}
              </div>
              {form.accountStaggerSeconds === null ? (
                <p className="text-[11px] text-white/30 italic">
                  Auto: {form.intervalMinutes * 60} s ÷ nº contas (ajustado no ciclo)
                </p>
              ) : (
                <p className="text-[11px]" style={{ color: "var(--matrix)" }}>
                  {form.accountStaggerSeconds}s entre cada conta — {Math.round(form.accountStaggerSeconds / 60 * 10) / 10} min de espaçamento
                </p>
              )}
            </div>
          </div>

          {/* Legendas */}
          <div>
            <SectionLabel icon={Type} label="Legendas Dinâmicas" />

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
                <Toggle checked={form.autoCaptionEnabled} onChange={v => update("autoCaptionEnabled", v)} />
              </div>
              <AnimatePresence>
                {form.autoCaptionEnabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {AUTO_CAPTION_TYPES.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => update("autoCaptionType", t.id)}
                          className={cn(
                            "p-2.5 rounded-xl border text-left transition-all",
                            form.autoCaptionType === t.id
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
                    {form.autoCaptionType && (
                      <div className="mt-2.5 p-2.5 rounded-lg bg-black/30 border border-white/[0.05]">
                        <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1">Exemplo — cada post recebe uma diferente</p>
                        <p className="text-[10px] text-white/50 leading-relaxed italic">
                          {AUTO_CAPTION_PREVIEWS[form.autoCaptionType]}
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Editor manual — oculto quando auto está ativo */}
            {!form.autoCaptionEnabled && (
              <>
                <LoopCaptionEditor
                  captions={form.captions}
                  onChange={caps => update("captions", caps)}
                />
                <p className="text-[11px] text-white/25 flex items-start gap-1.5 mt-2">
                  <Info size={10} className="flex-shrink-0 mt-0.5" />
                  O sistema sorteará uma legenda por post para evitar padrões de spam.
                </p>
              </>
            )}
          </div>

          {/* Capa */}
          <div>
            <SectionLabel icon={ImageIcon} label="Capa do Reel (opcional)" />
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleCoverSelect}
            />
            {form.coverPreviewUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-white/10 group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.coverPreviewUrl}
                  alt="Capa"
                  className="w-full h-32 object-cover"
                />
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors"
                  >
                    Trocar
                  </button>
                  <button
                    type="button"
                    onClick={removeCover}
                    className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30 transition-colors"
                  >
                    Remover
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="w-full h-24 rounded-xl border-2 border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-2 text-white/30 hover:text-white/60 hover:border-violet-500/25 transition-all duration-150"
              >
                <ImageIcon size={20} />
                <span className="text-xs">Clique para adicionar uma capa</span>
                <span className="text-[10px] text-white/20">Aplica em todos os vídeos · JPG, PNG · Sem capa = frame automático</span>
              </button>
            )}
          </div>

          {/* Efeitos */}
          <div>
            <SectionLabel icon={Contrast} label="Efeitos de Vídeo" />
            <div className="space-y-2.5">
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <FlipHorizontal size={15} className="text-cyan-400/60" />
                  <div>
                    <p className="text-sm text-white/80 font-medium">Espelhar</p>
                    <p className="text-xs text-white/30">Inverte horizontalmente o vídeo</p>
                  </div>
                </div>
                <Toggle checked={form.effectMirror} onChange={v => update("effectMirror", v)} />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <Contrast size={15} className="text-cyan-400/60" />
                  <div>
                    <p className="text-sm text-white/80 font-medium">Inverter cores</p>
                    <p className="text-xs text-white/30">Estilo negativo fotográfico</p>
                  </div>
                </div>
                <Toggle checked={form.effectInvert} onChange={v => update("effectInvert", v)} />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <ZoomIn size={15} className="text-cyan-400/60" />
                  <div>
                    <p className="text-sm text-white/80 font-medium">Zoom Sutil (+15%)</p>
                    <p className="text-xs text-white/30">Recorta bordas e amplia o frame central</p>
                  </div>
                </div>
                <Toggle checked={form.effectZoom} onChange={v => update("effectZoom", v)} />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <Droplets size={15} className="text-cyan-400/60" />
                  <div>
                    <p className="text-sm text-white/80 font-medium">Desfoque Leve</p>
                    <p className="text-xs text-white/30">Filtro de privacidade imperceptível</p>
                  </div>
                </div>
                <Toggle checked={form.effectBlur} onChange={v => update("effectBlur", v)} />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <Waves size={15} className="text-cyan-400/60" />
                  <div>
                    <p className="text-sm text-white/80 font-medium">Grão Digital</p>
                    <p className="text-xs text-white/30">Ruído frame-a-frame, imperceptível</p>
                  </div>
                </div>
                <Toggle checked={form.effectNoise} onChange={v => update("effectNoise", v)} />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <Shield size={15} className="text-cyan-400/60" />
                  <div>
                    <p className="text-sm text-white/80 font-medium">Anti-IA</p>
                    <p className="text-xs text-white/30">Variação de cor única por conta</p>
                  </div>
                </div>
                <Toggle checked={form.effectAntiAi} onChange={v => update("effectAntiAi", v)} />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
            >
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </motion.div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-white/[0.07] flex-shrink-0">
          <button onClick={onClose} className="btn-ghost text-sm py-2.5 px-5">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Salvando...</>
              : editingLoop
                ? <><Check size={14} /> Salvar alterações</>
                : <><Repeat2 size={14} /> Criar Loop</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function LoopPage() {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [accountFolders, setAccountFolders] = useState<AccountFolder[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingLoop, setEditingLoop] = useState<Loop | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchLoops = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/loops");
      const data = await res.json() as { loops: Loop[] };
      setLoops(data.loops ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetchLoops(),
      fetch("/api/library/folders").then(r => r.json() as Promise<{ folders: Folder[] }>),
      fetch("/api/accounts/list").then(r => r.json() as Promise<{ accounts: Account[] }>),
      fetch("/api/accounts/folders").then(r => r.json() as Promise<{ folders: AccountFolder[] }>),
    ]).then(([, foldersData, accountsData, accountFoldersData]) => {
      setFolders(foldersData.folders ?? []);
      setAccounts(accountsData.accounts ?? []);
      setAccountFolders(accountFoldersData.folders ?? []);
    });
  }, [fetchLoops]);

  const openNewForm = () => { setEditingLoop(null); setShowForm(true); };
  const openEditForm = (loop: Loop) => { setEditingLoop(loop); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingLoop(null); };

  const uploadCover = async (file: File): Promise<string | null> => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `covers/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("videos-library")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return null;
    return supabase.storage.from("videos-library").getPublicUrl(path).data.publicUrl;
  };

  const handleSave = async (form: FormData, loopId?: string) => {
    let coverImageUrl: string | null = null;

    if (form.coverFile) {
      coverImageUrl = await uploadCover(form.coverFile);
    } else if (form.coverPreviewUrl && !form.coverPreviewUrl.startsWith("blob:")) {
      coverImageUrl = form.coverPreviewUrl;
    }

    const payload = {
      name: form.name,
      folder_id: form.folderId || null,
      account_folder_id: form.accountMode === "folder" ? (form.accountFolderId || null) : null,
      is_infinite: form.isInfinite,
      cycles: form.cycles,
      interval_minutes: form.intervalMinutes,
      media_limit: form.mediaLimit,
      captions: form.captions.filter(c => c.trim()),
      cover_image_url: coverImageUrl,
      effect_mirror:  form.effectMirror,
      effect_invert:  form.effectInvert,
      effect_zoom:    form.effectZoom,
      effect_blur:    form.effectBlur,
      effect_noise:   form.effectNoise,
      effect_anti_ai: form.effectAntiAi,
      auto_caption_enabled: form.autoCaptionEnabled,
      auto_caption_type: form.autoCaptionEnabled ? form.autoCaptionType : null,
      account_stagger_seconds: form.accountStaggerSeconds,
      account_ids: form.accountMode === "folder" ? [] : form.accountIds,
    };

    const url = loopId ? `/api/loops/${loopId}` : "/api/loops";
    const method = loopId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error ?? "Erro ao salvar.");
    }

    closeForm();
    fetchLoops();
  };

  const handleToggleStatus = async (loop: Loop) => {
    const newStatus = loop.status === "active" ? "paused" : "active";
    setLoops(prev => prev.map(l => l.id === loop.id ? { ...l, status: newStatus } : l));
    await fetch(`/api/loops/${loop.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  const handleDelete = async (loop: Loop) => {
    if (deletingId === loop.id) return;
    setDeletingId(loop.id);
    try {
      const res = await fetch(`/api/loops/${loop.id}`, { method: "DELETE" });
      if (res.ok) setLoops(prev => prev.filter(l => l.id !== loop.id));
    } finally {
      setDeletingId(null);
    }
  };

  const activeCount = loops.filter(l => l.status === "active").length;

  return (
    <div className="space-y-6 max-w-full">

      <AnimatePresence>
        {showForm && (
          <LoopFormModal
            editingLoop={editingLoop}
            accounts={accounts}
            folders={folders}
            accountFolders={accountFolders}
            onSave={handleSave}
            onClose={closeForm}
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Loop</h1>
          <p className="page-subtitle">
            {loops.length === 0
              ? "Publique em ciclo automático a partir das suas pastas"
              : `${activeCount} ativo${activeCount !== 1 ? "s" : ""} · ${loops.length} loop${loops.length !== 1 ? "s" : ""} total`}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={openNewForm}
          className="btn-primary flex items-center gap-2 text-sm py-2.5 px-4 flex-shrink-0"
        >
          <Plus size={15} />
          Novo Loop
        </motion.button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card p-5 animate-pulse space-y-3">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/[0.04]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-white/[0.06] rounded-full w-2/3" />
                  <div className="h-2.5 bg-white/[0.04] rounded-full w-1/3" />
                </div>
              </div>
              <div className="h-2 bg-white/[0.04] rounded-full w-full" />
              <div className="h-2 bg-white/[0.04] rounded-full w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Loops grid */}
      {!loading && loops.length > 0 && (
        <AnimatePresence mode="popLayout">
          <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {loops.map(loop => (
              <LoopCard
                key={loop.id}
                loop={loop}
                accountFolders={accountFolders}
                onToggleStatus={handleToggleStatus}
                onEdit={openEditForm}
                onDelete={handleDelete}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Empty state */}
      {!loading && loops.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-24 gap-6 text-center"
        >
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
              <Repeat2 size={36} className="text-white/10" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
              <Infinity size={12} className="text-violet-400" />
            </div>
          </div>
          <div>
            <p className="text-white/50 font-semibold text-lg mb-1.5">Nenhum loop configurado</p>
            <p className="text-white/25 text-sm max-w-sm">
              Crie um loop para publicar automaticamente os vídeos de uma pasta
              em ciclos nas suas contas do Instagram.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={openNewForm}
            className="btn-primary flex items-center gap-2 text-sm py-2.5 px-6"
          >
            <Plus size={14} />
            Criar primeiro Loop
          </motion.button>
        </motion.div>
      )}

    </div>
  );
}
