"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import {
  Search,
  Instagram,
  AtSign,
  Loader2,
  AlertCircle,
  SlidersHorizontal,
  TrendingUp,
  Clock,
  Heart,
  MessageCircle,
  Download,
  CheckCircle2,
  Trash2,
  ArrowLeft,
  Film,
} from "lucide-react";
import { InspirationGrid } from "@/components/inspirations/InspirationGrid";
import type { InspirationReel } from "@/components/inspirations/InspirationCard";

// ── Types ─────────────────────────────────────────────────────────
type SortKey = "views" | "likes" | "comments" | "duration";

interface ScrapedProfile {
  id: string;
  username: string;
  full_name: string;
  profile_pic_url: string | null;
  video_count: number;
  scraped_at: string;
  videos_data: InspirationReel[];
}

const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ElementType }[] = [
  { key: "views",    label: "Mais vistos",     icon: TrendingUp    },
  { key: "likes",    label: "Mais curtidos",   icon: Heart         },
  { key: "comments", label: "Mais comentados", icon: MessageCircle },
  { key: "duration", label: "Mais longos",     icon: Clock         },
];

// ── Helpers ───────────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

// ── Loading Modal ─────────────────────────────────────────────────
function ImportingModal({ username, done }: { username: string; done: boolean }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (done) {
      setProgress(100);
      return;
    }
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 2.5 + 0.5;
        return next >= 95 ? 95 : next;
      });
    }, 350);
    return () => clearInterval(id);
  }, [done]);

  return (
    <motion.div
      key="importing-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.93, opacity: 0, y: 12 }}
        transition={{ type: "spring", bounce: 0.18, duration: 0.38 }}
        className="bg-[#080808] border border-white/10 rounded-2xl p-8 w-full max-w-sm mx-4 shadow-2xl"
      >
        <div className="flex justify-center mb-6">
          <div
            className={`w-14 h-14 rounded-full border-[3px] transition-colors duration-500 ${
              done
                ? "border-emerald-500/30 border-t-emerald-400"
                : "border-cyan-500/20 border-t-cyan-400 animate-spin"
            }`}
          />
        </div>
        <h3 className="text-white font-semibold text-center text-base mb-1">
          Importando @{username}
        </h3>
        <p className="text-white/35 text-sm text-center mb-6">
          Buscando todos os vídeos e posts...
        </p>
        <div className="mb-6">
          <div className="flex justify-between text-[11px] text-white/25 mb-2">
            <span>Progresso</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {done ? (
              <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
            ) : (
              <Loader2 size={15} className="text-cyan-400 animate-spin flex-shrink-0" />
            )}
            <span className={`text-sm transition-colors ${done ? "text-white/45" : "text-white/70"}`}>
              Buscando posts via API
            </span>
          </div>
          <div className="flex items-center gap-3">
            {done ? (
              <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
            ) : (
              <div className="w-[15px] h-[15px] rounded-full border border-white/20 flex-shrink-0" />
            )}
            <span className={`text-sm transition-colors ${done ? "text-white/70" : "text-white/30"}`}>
              Salvando no histórico
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── History Card ──────────────────────────────────────────────────
function HistoryCard({
  profile,
  onView,
  onDelete,
}: {
  profile: ScrapedProfile;
  onView: (p: ScrapedProfile) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const initial = profile.username.charAt(0).toUpperCase();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="glass-card p-4 flex flex-col gap-3 hover:border-violet-500/20 transition-all relative group"
    >
      {/* Delete */}
      <button
        onClick={(e) => onDelete(profile.id, e)}
        className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 bg-white/5 border border-white/10 text-white/30 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-all z-10"
      >
        <Trash2 size={12} />
      </button>

      {/* Avatar + username */}
      <div className="flex items-center gap-3 pr-7">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {profile.profile_pic_url && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.profile_pic_url}
              alt={profile.username}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="text-white text-sm font-bold">{initial}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white/85 truncate">@{profile.username}</p>
          {profile.full_name && profile.full_name !== profile.username && (
            <p className="text-xs text-white/35 truncate">{profile.full_name}</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.05] border border-white/[0.08]">
          <Film size={10} className="text-violet-400" />
          <span className="text-[11px] text-white/60">{profile.video_count} reels</span>
        </div>
        <span className="text-[11px] text-white/25 ml-auto">{timeAgo(profile.scraped_at)}</span>
      </div>

      {/* CTA */}
      <button
        onClick={() => onView(profile)}
        className="w-full py-2 px-3 rounded-lg bg-violet-600/15 border border-violet-500/25 text-violet-300 text-xs font-medium hover:bg-violet-600/25 hover:border-violet-500/40 transition-all"
      >
        Ver Vídeos
      </button>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function InspiracoesPage() {
  const [view, setView] = useState<"history" | "grid">("history");
  const [history, setHistory] = useState<ScrapedProfile[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [username, setUsername] = useState("");
  const [activeUsername, setActiveUsername] = useState("");
  const [reels, setReels] = useState<InspirationReel[]>([]);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("views");
  const [showFilters, setShowFilters] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [modalDone, setModalDone] = useState(false);

  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    errors: number;
    total: number;
  } | null>(null);
  const [bulkDone, setBulkDone] = useState(false);

  const inputRef      = useRef<HTMLInputElement>(null);
  const _searchingRef = useRef(false);
  const _bulkRef      = useRef(false);

  useEffect(() => {
    fetch("/api/inspirations/history")
      .then((r) => r.json())
      .then((data) => {
        setHistory(data.profiles ?? []);
        setHistoryLoading(false);
      })
      .catch(() => setHistoryLoading(false));
  }, []);

  const refreshHistory = () => {
    fetch("/api/inspirations/history")
      .then((r) => r.json())
      .then((data) => setHistory(data.profiles ?? []))
      .catch(() => {});
  };

  const handleSearch = async (query?: string) => {
    if (_searchingRef.current) return;
    const target = (query ?? username).replace(/^@/, "").trim();
    if (!target) return;

    _searchingRef.current = true;
    setUsername(target);
    setError("");
    setBulkProgress(null);
    setBulkDone(false);
    setModalDone(false);
    setShowModal(true);

    try {
      const res = await fetch("/api/inspirations/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: target }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao buscar Reels.");

      setModalDone(true);
      setTimeout(() => {
        setShowModal(false);
        setActiveUsername(target);
        setReels(data.reels as InspirationReel[]);
        setView("grid");
        refreshHistory();
      }, 700);
    } catch (err) {
      setShowModal(false);
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      _searchingRef.current = false;
    }
  };

  const handleViewProfile = (profile: ScrapedProfile) => {
    setActiveUsername(profile.username);
    setReels(profile.videos_data);
    setBulkDone(false);
    setBulkProgress(null);
    setError("");
    setView("grid");
  };

  const handleDeleteProfile = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory((prev) => prev.filter((p) => p.id !== id));
    try {
      await fetch(`/api/inspirations/history/${id}`, { method: "DELETE" });
    } catch {
      refreshHistory();
    }
  };

  const handleBack = () => {
    setView("history");
    setActiveUsername("");
    setReels([]);
    setBulkDone(false);
    setBulkProgress(null);
    setShowFilters(false);
  };

  const sortedReels = [...reels].sort((a, b) => b[sortBy] - a[sortBy]);

  const handleProcess = async (reel: InspirationReel) => {
    const res = await fetch("/api/video/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoUrl: reel.videoUrl,
        filename: `reel_${reel.owner}_${reel.shortCode}`,
        reelData: {
          caption:  reel.caption,
          views:    reel.views,
          likes:    reel.likes,
          comments: reel.comments,
          duration: reel.duration,
          owner:    reel.owner,
        },
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "Erro ao processar vídeo.");
    }
  };

  const handleBulkDownload = async () => {
    if (_bulkRef.current || sortedReels.length === 0) return;
    _bulkRef.current = true;
    setBulkDone(false);
    setBulkProgress({ done: 0, errors: 0, total: sortedReels.length });

    let done = 0, errors = 0;
    for (const reel of sortedReels) {
      try { await handleProcess(reel); } catch { errors++; }
      done++;
      setBulkProgress({ done, errors, total: sortedReels.length });
    }
    setBulkProgress(null);
    setBulkDone(true);
    _bulkRef.current = false;
  };

  const isSearching = showModal && !modalDone;

  return (
    <>
      <AnimatePresence>
        {showModal && <ImportingModal username={username} done={modalDone} />}
      </AnimatePresence>

      <div className="space-y-6 max-w-full">
        {/* Search card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 via-transparent to-cyan-600/5 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <Instagram size={16} className="text-pink-400" />
              <span className="text-sm font-semibold text-white/70">
                Buscar inspirações no Instagram
              </span>
            </div>
            <p className="text-xs text-white/30 mb-5">
              Digite o @ de qualquer perfil público para visualizar os Reels e preparar downloads
            </p>

            <div className="flex gap-3">
              <div className="relative flex-1">
                <AtSign
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-violet-400"
                />
                <input
                  ref={inputRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="nome_do_perfil"
                  className="input-glass pl-10 pr-4 py-3.5 text-sm w-full rounded-xl"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <motion.button
                onClick={() => handleSearch()}
                whileTap={{ scale: 0.96 }}
                disabled={isSearching || !username.trim()}
                className="btn-primary flex items-center gap-2 px-6 py-3.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isSearching ? (
                  <><Loader2 size={16} className="animate-spin" />Buscando...</>
                ) : (
                  <><Search size={16} />Buscar Reels</>
                )}
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Error toast */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
            >
              <AlertCircle size={16} />
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError("")}
                className="text-white/30 hover:text-white/60 transition-colors"
              >
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Grid view ─────────────────────────────────────────────── */}
        {view === "grid" && (
          <>
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-white/40 hover:text-white/70 hover:border-white/20 transition-all"
                >
                  <ArrowLeft size={13} />
                  Voltar
                </button>
                <div>
                  <p className="text-sm font-semibold text-white/80">
                    {reels.length} Reels encontrados
                  </p>
                  <p className="text-xs text-white/30">de @{activeUsername}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  onClick={handleBulkDownload}
                  disabled={bulkProgress !== null}
                  whileTap={bulkProgress !== null ? {} : { scale: 0.96 }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    bulkProgress !== null
                      ? "bg-violet-600/10 border-violet-500/20 text-violet-400/60 cursor-not-allowed"
                      : "bg-violet-600/15 border-violet-500/25 text-violet-300 hover:bg-violet-600/25 hover:border-violet-500/40"
                  }`}
                >
                  {bulkProgress !== null ? (
                    <><Loader2 size={11} className="animate-spin" />{bulkProgress.done}/{bulkProgress.total} baixados</>
                  ) : (
                    <><Download size={11} />Baixar todos</>
                  )}
                </motion.button>

                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    showFilters
                      ? "bg-violet-600/20 border-violet-500/30 text-violet-300"
                      : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"
                  }`}
                >
                  <SlidersHorizontal size={12} />
                  Ordenar
                </button>
              </div>
            </motion.div>

            {/* Bulk done banner */}
            <AnimatePresence>
              {bulkDone && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm"
                >
                  <CheckCircle2 size={16} />
                  Todos os vídeos foram salvos na biblioteca!
                </motion.div>
              )}
            </AnimatePresence>

            {/* Filter chips */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 overflow-hidden"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setSortBy(opt.key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                        sortBy === opt.key
                          ? "bg-violet-600/20 border-violet-500/30 text-violet-300"
                          : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"
                      }`}
                    >
                      <opt.icon size={11} />
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Reels grid */}
            {reels.length > 0 && (
              <InspirationGrid reels={sortedReels} onProcess={handleProcess} />
            )}

            {reels.length === 0 && (
              <div className="flex flex-col items-center py-20 gap-4 text-center">
                <Instagram size={32} className="text-white/15" />
                <p className="text-white/30 text-sm">
                  Nenhum Reel encontrado para @{activeUsername}
                </p>
              </div>
            )}
          </>
        )}

        {/* ── History view ──────────────────────────────────────────── */}
        {view === "history" && (
          <>
            {historyLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="glass-card p-4 h-44 animate-pulse"
                    style={{ animationDelay: `${i * 60}ms` }}
                  />
                ))}
              </div>
            ) : history.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-24 gap-4 text-center"
              >
                <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
                  <Search size={32} className="text-white/15" />
                </div>
                <p className="text-white/30 text-sm max-w-xs">
                  Pesquise um perfil acima para ver os Reels. Seu histórico ficará salvo aqui para
                  não precisar buscar novamente.
                </p>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-white/60">
                    Histórico de pesquisas
                    <span className="ml-2 text-white/25 font-normal">
                      ({history.length})
                    </span>
                  </p>
                </div>

                <AnimatePresence mode="popLayout">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {history.map((profile) => (
                      <HistoryCard
                        key={profile.id}
                        profile={profile}
                        onView={handleViewProfile}
                        onDelete={handleDeleteProfile}
                      />
                    ))}
                  </div>
                </AnimatePresence>
              </motion.div>
            )}
          </>
        )}
      </div>
    </>
  );
}
