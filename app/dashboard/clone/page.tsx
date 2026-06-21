"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Users, Play, Heart, Eye, TrendingUp,
  CheckCircle2, Copy, ChevronRight, Calendar, Zap, X,
  AlertCircle, Loader2, Sparkles, Download, Clock, Trash2,
  BarChart2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReelItem {
  id:           string;
  shortCode:    string;
  thumbnailUrl: string | null;
  videoUrl:     string;
  caption:      string;
  views:        number;
  likes:        number;
  comments:     number;
  duration:     number;
}

interface ProfileData {
  username:       string;
  fullName:       string;
  profilePicUrl:  string | null;
  bio:            string | null;
  followersCount: number;
}

interface Stats {
  reelCount:      number;
  avgViews:       number;
  avgLikes:       number;
  avgComments:    number;
  engagementRate: number;
}

interface AccountRow {
  id:              string;
  username:        string;
  display_name:    string | null;
  avatar_url:      string | null;
  health_status:   string;
  folder_id:       string | null;
  account_folders: { name: string } | null;
}

interface CloneRecord {
  campaign_id:      string;
  profile_username: string;
  profile_pic_url:  string | null;
  account_ids:      string[];
  created_at:       string;
}

interface CampaignData {
  campaign_id:       string;
  total:             number;
  published:         number;
  pending:           number;
  failed:            number;
  cancelled:         number;
  first_slot:        string;
  last_slot:         string;
  next_pending:      string | null;
  account_ids:       string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function localISOWithOffset(): string {
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}T${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}${sign}${hh}:${mm}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.floor(diff / 60_000);
  if (min < 1)   return "agora";
  if (min < 60)  return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24)    return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

const REEL_COUNT_OPTIONS = [
  { label: "10",    value: 10 },
  { label: "20",    value: 20 },
  { label: "50",    value: 50 },
  { label: "100",   value: 100 },
  { label: "Todos", value: -1 },
];

const PPD_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24, 48];

const AUTO_CAPTION_TYPES_CLONE = [
  { id: "curiosidades-gerais", label: "Curiosidades Gerais", emoji: "💡", desc: "Fatos do dia a dia" },
  { id: "curiosidades-tops",   label: "Curiosidades Tops",   emoji: "🏆", desc: "Fatos virais" },
  { id: "fatos-complexos",     label: "Fatos Complexos",     emoji: "🔬", desc: "Ciência acessível" },
] as const;

const AUTO_CAPTION_PREVIEWS_CLONE: Record<string, string> = {
  "curiosidades-gerais": "🍯 O mel nunca estraga. Arqueólogos encontraram potes com mais de 3.000 anos nas pirâmides do Egito — e ainda estavam comestíveis!",
  "curiosidades-tops":   "🤯 INACREDITÁVEL: Você existe porque TODOS os seus ancestrais sobreviveram e tiveram filhos desde o início da vida na Terra!",
  "fatos-complexos":     "🧠 A memória humana não funciona como um HD. Cada vez que você se lembra de algo, reconstrói a memória do zero — e a modifica.",
};

const HISTORY_KEY = "clone_history_v1";

// ── Main Component ────────────────────────────────────────────────────────────

export default function ClonePage() {
  // Search
  const [query, setQuery]             = useState("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [searchError, setSearchError] = useState("");
  const [runMeta, setRunMeta]         = useState<{ runId: string; username: string; fallback: boolean; limit: number } | null>(null);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);

  // Results
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats]     = useState<Stats | null>(null);
  const [reels, setReels]     = useState<ReelItem[]>([]);

  // Config
  const [reelCount, setReelCount]     = useState<number>(20);
  const [postsPerDay, setPostsPerDay] = useState<number>(3);
  const [startAt, setStartAt]         = useState(localISOWithOffset().slice(0, 16));

  // Accounts
  const [accounts, setAccounts]         = useState<AccountRow[]>([]);
  const [selectedAccounts, setSelected] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpanded]  = useState<Set<string>>(new Set());

  // Auto captions
  const [autoCaptionEnabled, setAutoCaptionEnabled] = useState(false);
  const [autoCaptionType, setAutoCaptionType]       = useState("curiosidades-gerais");

  // Submit
  const [submitting, setSubmitting]   = useState(false);
  const [success, setSuccess]         = useState<{ total_posts: number; days: number; first_slot: string } | null>(null);
  const [submitError, setSubmitError] = useState("");

  // History
  const [cloneRecords, setCloneRecords] = useState<CloneRecord[]>([]);
  const [campaigns, setCampaigns]       = useState<CampaignData[]>([]);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancellingId, setCancellingId]   = useState<string | null>(null);
  const historyRefTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load accounts & history on mount ────────────────────────────────────────

  useEffect(() => {
    fetch("/api/accounts/list")
      .then(r => r.json())
      .then(d => {
        const list: AccountRow[] = (d.accounts ?? []).filter((a: AccountRow) => a.health_status !== "error");
        setAccounts(list);
        const folders = new Set(list.map(a => a.folder_id ?? "__none__"));
        setExpanded(folders);
      })
      .catch(() => {});

    // Load localStorage records
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setCloneRecords(JSON.parse(raw));
    } catch {}

    loadCampaigns();
  }, []);

  // Auto-refresh history every 30s when there are active clones
  useEffect(() => {
    if (historyRefTimer.current) clearInterval(historyRefTimer.current);
    const hasActive = campaigns.some(c => c.pending > 0);
    if (hasActive) {
      historyRefTimer.current = setInterval(loadCampaigns, 30_000);
    }
    return () => { if (historyRefTimer.current) clearInterval(historyRefTimer.current); };
  }, [campaigns]);

  const loadCampaigns = async () => {
    try {
      const res = await fetch("/api/campaigns");
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns ?? []);
      }
    } catch {}
  };

  // ── Account grouping ─────────────────────────────────────────────────────────

  const accountsByFolder = useMemo(() => {
    const map = new Map<string, { name: string; accounts: AccountRow[] }>();
    for (const a of accounts) {
      const key  = a.folder_id ?? "__none__";
      const name = a.account_folders?.name ?? "Sem pasta";
      if (!map.has(key)) map.set(key, { name, accounts: [] });
      map.get(key)!.accounts.push(a);
    }
    return Array.from(map.entries())
      .sort(([ka], [kb]) => (ka === "__none__" ? 1 : kb === "__none__" ? -1 : 0));
  }, [accounts]);

  const toggleFolder = (key: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  };

  const toggleFolderSelect = (e: React.MouseEvent, folderAccounts: AccountRow[]) => {
    e.stopPropagation();
    const ids    = folderAccounts.map(a => a.id);
    const allSel = ids.every(id => selectedAccounts.has(id));
    setSelected(prev => {
      const s = new Set(prev);
      ids.forEach(id => allSel ? s.delete(id) : s.add(id));
      return s;
    });
  };

  const toggleAccount = (id: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  // ── Search / Poll ─────────────────────────────────────────────────────────────

  const startPolling = useCallback((runId: string, username: string, fallback: boolean, limit: number) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const params = new URLSearchParams({ runId, username, fallback: String(fallback), limit: String(limit) });
        const res  = await fetch(`/api/clone/search/poll?${params}`);
        const data = await res.json();

        if (data.status === "running") {
          if (data.runId && data.runId !== runId) {
            if (pollRef.current) clearInterval(pollRef.current);
            setRunMeta({ runId: data.runId, username, fallback: true, limit });
            startPolling(data.runId, username, true, limit);
          }
          return;
        }

        if (pollRef.current) clearInterval(pollRef.current);

        if (data.status === "done") {
          setProfile(data.profile);
          setStats(data.stats);
          setReels(data.reels);
          setSearchState("done");
        } else {
          setSearchError(data.error ?? "Erro ao buscar perfil.");
          setSearchState("error");
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
        setSearchError("Erro de rede ao buscar resultados.");
        setSearchState("error");
      }
    }, 4000);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleSearch = async () => {
    const username = query.replace(/^@/, "").trim();
    if (!username) return;

    setSearchState("loading");
    setSearchError("");
    setProfile(null);
    setStats(null);
    setReels([]);
    setSuccess(null);
    setSubmitError("");

    try {
      const res  = await fetch("/api/clone/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, limit: 100 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error ?? "Erro ao iniciar busca.");
        setSearchState("error");
        return;
      }
      const meta = { runId: data.runId, username, fallback: false, limit: 100 };
      setRunMeta(meta);
      startPolling(meta.runId, meta.username, meta.fallback, meta.limit);
    } catch {
      setSearchError("Erro de rede.");
      setSearchState("error");
    }
  };

  // ── Clone ─────────────────────────────────────────────────────────────────────

  const handleClone = async () => {
    if (!reels.length || !selectedAccounts.size) return;
    setSubmitting(true);
    setSubmitError("");
    setSuccess(null);

    try {
      const res  = await fetch("/api/clone/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_ids:       Array.from(selectedAccounts),
          reels:             reels.map(r => ({ videoUrl: r.videoUrl, caption: r.caption, thumbnailUrl: r.thumbnailUrl })),
          reel_count:        reelCount,
          posts_per_day:     postsPerDay,
          start_at:          startAt,
          auto_caption_type: autoCaptionEnabled ? autoCaptionType : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Erro ao criar agendamentos.");
      } else {
        setSuccess({ total_posts: data.total_posts, days: data.days, first_slot: data.first_slot });

        // Save to localStorage history
        const record: CloneRecord = {
          campaign_id:      data.campaign_id,
          profile_username: profile?.username ?? query.replace(/^@/, "").trim(),
          profile_pic_url:  profile?.profilePicUrl ?? null,
          account_ids:      Array.from(selectedAccounts),
          created_at:       new Date().toISOString(),
        };
        const existing: CloneRecord[] = (() => {
          try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
        })();
        const updated = [record, ...existing].slice(0, 30);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
        setCloneRecords(updated);

        await loadCampaigns();
      }
    } catch {
      setSubmitError("Erro de rede.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Cancel campaign ────────────────────────────────────────────────────────────

  const handleCancel = async (campaignId: string) => {
    if (confirmCancel !== campaignId) {
      setConfirmCancel(campaignId);
      setTimeout(() => setConfirmCancel(c => c === campaignId ? null : c), 3000);
      return;
    }
    setConfirmCancel(null);
    setCancellingId(campaignId);
    try {
      await fetch(`/api/campaigns?campaign_id=${campaignId}`, { method: "DELETE" });
      await loadCampaigns();
    } catch {}
    setCancellingId(null);
  };

  // ── Computed ──────────────────────────────────────────────────────────────────

  const usedCount   = reelCount === -1 ? reels.length : Math.min(reelCount, reels.length);
  const totalPosts  = usedCount * selectedAccounts.size;
  const daysEst     = postsPerDay > 0 ? Math.ceil(usedCount / postsPerDay) : 0;
  const intervalMin = postsPerDay > 0 ? Math.floor(1440 / postsPerDay) : 0;

  // Merge localStorage records with live campaign data
  const historyItems = useMemo(() => {
    return cloneRecords
      .map(record => ({
        record,
        campaign: campaigns.find(c => c.campaign_id === record.campaign_id) ?? null,
      }))
      .filter(item => item.campaign !== null || true); // show all; null = completed
  }, [cloneRecords, campaigns]);

  // Map account_id → AccountRow
  const accountMap = useMemo(() => {
    const m = new Map<string, AccountRow>();
    accounts.forEach(a => m.set(a.id, a));
    return m;
  }, [accounts]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">

      {/* Header */}
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Copy size={20} style={{ color: "var(--matrix)" }} />
          Clonar Perfil
        </h1>
        <p className="page-subtitle">Puxe Reels de um perfil e agende direto nas suas contas — sem passar pela Biblioteca.</p>
      </div>

      {/* Search bar */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              type="text"
              placeholder="@username ou nome do perfil..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              className="input-glass w-full pl-9 pr-4 py-3 text-sm rounded-xl"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searchState === "loading" || !query.trim()}
            className="btn-primary px-6 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
          >
            {searchState === "loading" ? (
              <><Loader2 size={15} className="animate-spin" /> Buscando…</>
            ) : (
              <><Search size={15} /> Pesquisar</>
            )}
          </button>
        </div>

        <AnimatePresence>
          {searchState === "loading" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 overflow-hidden"
            >
              <div className="flex items-center gap-2 text-sm text-white/40">
                <Loader2 size={14} className="animate-spin" style={{ color: "var(--matrix)" }} />
                Raspando Reels de @{query.replace(/^@/, "").trim()}…
              </div>
              <div className="mt-2 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                <motion.div
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                  className="h-full w-1/3 rounded-full"
                  style={{ background: "linear-gradient(90deg, transparent, var(--matrix), transparent)" }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {searchState === "error" && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="mt-3 flex items-center gap-2 text-sm text-red-400"
            >
              <AlertCircle size={14} className="flex-shrink-0" />
              {searchError}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Main layout: results (left) + config (right, always visible) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">

        {/* ── Left: search results ── */}
        <div className="space-y-5">
          <AnimatePresence mode="wait">
            {searchState === "done" && profile && stats ? (
              <motion.div key="results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

                {/* Profile card */}
                <div className="glass-card p-5 rounded-2xl ticks">
                  <div className="flex items-start gap-4">
                    <div className="relative flex-shrink-0 group">
                      {profile.profilePicUrl ? (
                        <img
                          src={profile.profilePicUrl}
                          alt={profile.username}
                          className="w-16 h-16 rounded-full object-cover border-2 border-matrix/30 shadow-[0_0_16px_rgba(0,255,65,0.2)]"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold"
                          style={{ background: "linear-gradient(135deg,#00FF41,#00E5FF)", color: "#000" }}>
                          {profile.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {profile.profilePicUrl && (
                        <a
                          href={profile.profilePicUrl}
                          download={`${profile.username}_foto.jpg`}
                          className="absolute inset-0 rounded-full flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Download size={16} className="text-white" />
                        </a>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-bold text-white text-lg leading-tight">{profile.fullName}</h2>
                        <span className="text-sm text-white/40">@{profile.username}</span>
                      </div>
                      {profile.bio && (
                        <p className="text-sm text-white/50 mt-1 line-clamp-2">{profile.bio}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                      { label: "Seguidores",  value: profile.followersCount > 0 ? fmt(profile.followersCount) : "—", icon: Users },
                      { label: "Reels",       value: String(stats.reelCount),     icon: Play },
                      { label: "Views (avg)", value: fmt(stats.avgViews),         icon: Eye },
                      { label: "Likes (avg)", value: fmt(stats.avgLikes),         icon: Eye },
                      { label: "Engajamento", value: stats.engagementRate > 0 ? `${stats.engagementRate}%` : "—", icon: TrendingUp },
                    ].map(({ label, value, icon: Icon }) => (
                      <div key={label} className="rounded-xl p-3 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <Icon size={14} className="mx-auto mb-1 text-white/25" />
                        <div className="font-bold text-base" style={{ color: "var(--electric)" }}>{value}</div>
                        <div className="text-[10px] text-white/35 mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reels grid */}
                <div className="glass-card p-4 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-white/35">
                      Reels encontrados ({reels.length})
                    </p>
                    <p className="text-[11px] text-white/30">{usedCount} serão agendados</p>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2 max-h-[560px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    {reels.map((reel, i) => {
                      const used = reelCount === -1 || i < reelCount;
                      return (
                        <div
                          key={reel.id}
                          className={cn(
                            "relative rounded-xl overflow-hidden aspect-[9/16] transition-all",
                            !used && "opacity-30 grayscale"
                          )}
                          style={{ border: used ? "1px solid rgba(0,255,65,0.15)" : "1px solid rgba(255,255,255,0.05)" }}
                        >
                          {reel.thumbnailUrl ? (
                            <img src={reel.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                              <Play size={20} className="text-white/20" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1.5">
                            <div className="flex items-center gap-0.5 text-[9px] text-white/70">
                              <Eye size={8} />{fmt(reel.views)}
                            </div>
                            <div className="flex items-center gap-0.5 text-[9px] text-white/70">
                              <Eye size={8} />{fmt(reel.likes)}
                            </div>
                          </div>
                          <div className="absolute top-1.5 right-1.5 text-[9px] font-bold rounded px-1 py-0.5"
                            style={{ background: "rgba(0,0,0,0.6)", color: used ? "var(--matrix)" : "rgba(255,255,255,0.3)" }}>
                            #{i + 1}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 text-center glass-card rounded-2xl">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(0,255,65,0.06)", border: "1px solid rgba(0,255,65,0.12)" }}>
                  <Copy size={28} style={{ color: "var(--matrix)" }} />
                </div>
                <h3 className="text-lg font-semibold text-white/60 mb-1">Busque um perfil para começar</h3>
                <p className="text-sm text-white/30 max-w-sm">
                  Digite o username no campo acima. Configure as opções ao lado e clique em Clonar Perfil.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right: config panel (always visible) ── */}
        <div className="space-y-4">

          {/* Quantidade de posts */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-white/35">Quantidade de posts</p>
            <div className="flex flex-wrap gap-2">
              {REEL_COUNT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setReelCount(opt.value)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                    reelCount === opt.value
                      ? "border-matrix/60 text-matrix"
                      : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/20"
                  )}
                  style={reelCount === opt.value ? { background: "rgba(0,255,65,0.08)" } : {}}
                >
                  {opt.label}
                  {opt.value !== -1 && stats && opt.value > stats.reelCount && (
                    <span className="ml-1 text-white/20">(máx {stats.reelCount})</span>
                  )}
                </button>
              ))}
            </div>
            {reels.length > 0 && (
              <p className="text-[11px] text-white/30">
                {usedCount} reel{usedCount !== 1 ? "s" : ""} serão agendados por conta
              </p>
            )}
          </div>

          {/* Posts por dia */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-white/35">Posts por dia</p>
            <div className="flex flex-wrap gap-2">
              {PPD_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => setPostsPerDay(n)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                    postsPerDay === n
                      ? "border-electric/60 text-electric"
                      : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/20"
                  )}
                  style={postsPerDay === n ? { background: "rgba(0,229,255,0.08)" } : {}}
                >
                  {n}
                </button>
              ))}
            </div>
            {intervalMin > 0 && (
              <p className="text-[11px] text-white/30">Intervalo: 1 post a cada {intervalMin} min</p>
            )}
          </div>

          {/* Data/hora início */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-white/35">Data e hora de início</p>
            <input
              type="datetime-local"
              value={startAt}
              onChange={e => setStartAt(e.target.value)}
              className="input-glass w-full px-3 py-2.5 text-sm rounded-xl"
            />
          </div>

          {/* Legendas Automáticas */}
          <div className="glass-card p-4 rounded-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={13} style={{ color: "var(--matrix)" }} />
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-white/50">Legendas Automáticas</p>
                  <p className="text-[10px] text-white/30 mt-0.5">Substitui legendas originais por curiosidades PT-BR</p>
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
                    {AUTO_CAPTION_TYPES_CLONE.map(t => (
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
                        {AUTO_CAPTION_PREVIEWS_CLONE[autoCaptionType]}
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Account selector */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-white/35">Contas de destino</p>
              <div className="flex gap-2">
                <button onClick={() => setSelected(new Set(accounts.map(a => a.id)))} className="text-[10px] text-matrix/70 hover:text-matrix transition-colors">Todas</button>
                <span className="text-white/20 text-[10px]">/</span>
                <button onClick={() => setSelected(new Set())} className="text-[10px] text-white/30 hover:text-white/60 transition-colors">Nenhuma</button>
              </div>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {accountsByFolder.map(([key, { name, accounts: fas }]) => {
                const allSel  = fas.every(a => selectedAccounts.has(a.id));
                const someSel = fas.some(a => selectedAccounts.has(a.id));
                const expanded = expandedFolders.has(key);

                return (
                  <div key={key}>
                    <div
                      onClick={() => toggleFolder(key)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/[0.03] transition-colors group"
                    >
                      <ChevronRight size={12} className={cn("text-white/30 transition-transform flex-shrink-0", expanded && "rotate-90")} />
                      <span className="text-xs font-semibold text-white/50 flex-1 truncate">{name}</span>
                      <span className={cn("text-[10px]", someSel ? "text-matrix/70" : "text-white/20")}>
                        {fas.filter(a => selectedAccounts.has(a.id)).length}/{fas.length}
                      </span>
                      <button
                        onClick={e => toggleFolderSelect(e, fas)}
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-all",
                          allSel ? "text-matrix/70 bg-matrix/10" : "text-white/40 bg-white/[0.05]"
                        )}
                      >
                        {allSel ? "Desmarcar" : "Selecionar"}
                      </button>
                    </div>

                    <AnimatePresence>
                      {expanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden pl-5"
                        >
                          <div className="py-1 space-y-0.5">
                            {fas.map(acc => {
                              const sel = selectedAccounts.has(acc.id);
                              return (
                                <div
                                  key={acc.id}
                                  onClick={() => toggleAccount(acc.id)}
                                  className={cn(
                                    "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all text-xs",
                                    sel ? "text-white" : "text-white/40 hover:text-white/70"
                                  )}
                                  style={sel ? { background: "rgba(0,255,65,0.05)", border: "1px solid rgba(0,255,65,0.15)" } : { border: "1px solid transparent" }}
                                >
                                  {acc.avatar_url ? (
                                    <img src={acc.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full flex-shrink-0 text-[9px] font-bold flex items-center justify-center"
                                      style={{ background: "linear-gradient(135deg,#00FF41,#00E5FF)", color: "#000" }}>
                                      {acc.username.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <span className="truncate flex-1">@{acc.username}</span>
                                  {sel && <CheckCircle2 size={12} style={{ color: "var(--matrix)", flexShrink: 0 }} />}
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
              {accounts.length === 0 && (
                <p className="text-xs text-white/30 text-center py-4">Nenhuma conta conectada.</p>
              )}
            </div>

            {selectedAccounts.size > 0 && (
              <p className="text-[11px] text-white/40">
                {selectedAccounts.size} conta{selectedAccounts.size !== 1 ? "s" : ""} selecionada{selectedAccounts.size !== 1 ? "s" : ""}
              </p>
            )}
          </div>

          {/* Summary + Clone button */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            {selectedAccounts.size > 0 && usedCount > 0 && (
              <>
                <p className="text-xs font-bold uppercase tracking-widest text-white/35">Resumo</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-white/50">
                    <span>Total de posts</span>
                    <span className="text-white font-semibold">{totalPosts.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-white/50">
                    <span>Duração estimada</span>
                    <span className="text-white font-semibold">{daysEst} dia{daysEst !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex justify-between text-white/50">
                    <span>Contas</span>
                    <span className="text-white font-semibold">{selectedAccounts.size}</span>
                  </div>
                  <div className="flex justify-between text-white/50">
                    <span>Reels por conta</span>
                    <span className="text-white font-semibold">{usedCount}</span>
                  </div>
                </div>
              </>
            )}

            <button
              onClick={handleClone}
              disabled={submitting || selectedAccounts.size === 0 || usedCount === 0 || !reels.length}
              className="btn-primary w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {submitting ? (
                <><Loader2 size={15} className="animate-spin" /> Agendando…</>
              ) : !reels.length ? (
                <><Search size={15} /> Busque um perfil primeiro</>
              ) : selectedAccounts.size === 0 ? (
                <><Zap size={15} /> Selecione contas de destino</>
              ) : (
                <><Zap size={15} /> Clonar Perfil ({totalPosts} posts)</>
              )}
            </button>

            {submitError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle size={12} /> {submitError}
              </p>
            )}

            <AnimatePresence>
              {success && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="rounded-xl border border-matrix/25 p-3 space-y-1.5"
                  style={{ background: "rgba(0,255,65,0.04)" }}
                >
                  <div className="flex items-center gap-2 text-matrix font-semibold text-sm">
                    <CheckCircle2 size={15} />
                    Agendamentos criados!
                  </div>
                  <p className="text-xs text-white/50">
                    {success.total_posts.toLocaleString()} posts ao longo de {success.days} dia{success.days !== 1 ? "s" : ""}. Primeiro disparo: {new Date(success.first_slot).toLocaleString("pt-BR")}.
                  </p>
                  <div className="flex gap-2">
                    <a href="/dashboard/monitor" className="text-xs text-electric underline">Ver Monitor</a>
                    <span className="text-white/20">·</span>
                    <button onClick={() => setSuccess(null)} className="text-xs text-white/30 hover:text-white/60">Fechar</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Clone History ──────────────────────────────────────────────────────── */}
      {historyItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BarChart2 size={15} style={{ color: "var(--electric)" }} />
            <h2 className="text-sm font-bold uppercase tracking-widest text-white/50">Histórico de Clones</h2>
            <button
              onClick={loadCampaigns}
              className="ml-auto text-[11px] text-white/25 hover:text-white/50 transition-colors flex items-center gap-1"
            >
              <Loader2 size={11} /> Atualizar
            </button>
          </div>

          <div className="space-y-3">
            {historyItems.map(({ record, campaign }) => {
              const pct       = campaign && campaign.total > 0 ? Math.round((campaign.published / campaign.total) * 100) : (campaign ? 100 : null);
              const isDone    = !campaign || (campaign.pending === 0 && campaign.cancelled === 0);
              const isCancelled = campaign && campaign.cancelled > 0 && campaign.pending === 0 && campaign.published === 0;
              const accRows   = record.account_ids.map(id => accountMap.get(id)).filter(Boolean) as AccountRow[];

              return (
                <motion.div
                  key={record.campaign_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card p-4 rounded-2xl"
                  style={campaign && campaign.pending > 0 ? { border: "1px solid rgba(0,255,65,0.12)" } : {}}
                >
                  <div className="flex items-start gap-4">

                    {/* Profile avatar */}
                    <div className="flex-shrink-0">
                      {record.profile_pic_url ? (
                        <img
                          src={record.profile_pic_url}
                          alt={record.profile_username}
                          className="w-12 h-12 rounded-full object-cover border border-white/10"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
                          style={{ background: "linear-gradient(135deg,#00FF41,#00E5FF)", color: "#000" }}>
                          {record.profile_username.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Middle content */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Top row: username + status + time */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-sm">@{record.profile_username}</span>
                        {campaign && campaign.pending > 0 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(0,255,65,0.12)", color: "var(--matrix)", border: "1px solid rgba(0,255,65,0.2)" }}>
                            Ativo
                          </span>
                        ) : isCancelled ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full text-white/30 font-semibold" style={{ background: "rgba(255,255,255,0.05)" }}>
                            Cancelado
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(0,229,255,0.08)", color: "var(--electric)", border: "1px solid rgba(0,229,255,0.15)" }}>
                            Concluído
                          </span>
                        )}
                        <span className="text-[11px] text-white/25 flex items-center gap-1 ml-auto">
                          <Clock size={10} /> {timeAgo(record.created_at)}
                        </span>
                      </div>

                      {/* Progress bar */}
                      {campaign && (
                        <div>
                          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct ?? 0}%` }}
                              transition={{ duration: 0.6, ease: "easeOut" }}
                              className="h-full rounded-full"
                              style={{
                                background: campaign.pending > 0
                                  ? "linear-gradient(90deg, var(--matrix), var(--electric))"
                                  : "rgba(255,255,255,0.2)"
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Account mini-avatars */}
                      {accRows.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] text-white/25">Contas:</span>
                          <div className="flex items-center">
                            {accRows.slice(0, 8).map((acc, i) => (
                              <div
                                key={acc.id}
                                title={`@${acc.username}`}
                                className="w-5 h-5 rounded-full border border-black/50 flex-shrink-0 -ml-1 first:ml-0"
                                style={{ zIndex: 10 - i }}
                              >
                                {acc.avatar_url ? (
                                  <img src={acc.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                                ) : (
                                  <div className="w-full h-full rounded-full flex items-center justify-center text-[7px] font-bold"
                                    style={{ background: "linear-gradient(135deg,#00FF41,#00E5FF)", color: "#000" }}>
                                    {acc.username.charAt(0).toUpperCase()}
                                  </div>
                                )}
                              </div>
                            ))}
                            {accRows.length > 8 && (
                              <span className="text-[10px] text-white/30 ml-1.5">+{accRows.length - 8}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right: stats + cancel */}
                    <div className="flex-shrink-0 flex flex-col items-end gap-2">
                      {/* Post counts */}
                      <div className="flex items-center gap-3 text-right">
                        <div className="text-center">
                          <div className="text-sm font-bold text-white">{campaign?.total.toLocaleString() ?? "—"}</div>
                          <div className="text-[9px] text-white/25 uppercase tracking-wider">Total</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold" style={{ color: "var(--matrix)" }}>{campaign?.published.toLocaleString() ?? "0"}</div>
                          <div className="text-[9px] text-white/25 uppercase tracking-wider">Publicados</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-white/50">{campaign?.pending.toLocaleString() ?? "0"}</div>
                          <div className="text-[9px] text-white/25 uppercase tracking-wider">Pendentes</div>
                        </div>
                        {campaign && campaign.failed > 0 && (
                          <div className="text-center">
                            <div className="text-sm font-bold text-red-400">{campaign.failed.toLocaleString()}</div>
                            <div className="text-[9px] text-white/25 uppercase tracking-wider">Falhas</div>
                          </div>
                        )}
                      </div>

                      {/* Cancel button — only if active */}
                      {campaign && campaign.pending > 0 && (
                        <button
                          onClick={() => handleCancel(record.campaign_id)}
                          disabled={cancellingId === record.campaign_id}
                          className={cn(
                            "flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border transition-all",
                            confirmCancel === record.campaign_id
                              ? "border-red-500/50 text-red-400 bg-red-500/10"
                              : "border-white/10 text-white/30 hover:text-red-400 hover:border-red-500/30"
                          )}
                        >
                          {cancellingId === record.campaign_id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Trash2 size={11} />
                          )}
                          {confirmCancel === record.campaign_id ? "Confirmar cancelamento" : "Cancelar"}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
