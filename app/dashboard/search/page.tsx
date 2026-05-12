"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef } from "react";
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
} from "lucide-react";
import {
  InspirationGrid,
  InspirationGridSkeleton,
} from "@/components/inspirations/InspirationGrid";
import type { InspirationReel } from "@/components/inspirations/InspirationCard";

type SortKey = "views" | "likes" | "comments" | "duration";

const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ElementType }[] =
  [
    { key: "views", label: "Mais vistos", icon: TrendingUp },
    { key: "likes", label: "Mais curtidos", icon: Heart },
    { key: "comments", label: "Mais comentados", icon: MessageCircle },
    { key: "duration", label: "Mais longos", icon: Clock },
  ];

const RECENT_SEARCHES = [
  "fitness_brasil",
  "travel_vibes",
  "receitas_faceis",
  "moda_masculina",
];

export default function InspiracoesPage() {
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [reels, setReels] = useState<InspirationReel[]>([]);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("views");
  const [showFilters, setShowFilters] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const _searchingRef = useRef(false);
  const _bulkRef = useRef(false);

  // Bulk download state
  const [bulkProgress, setBulkProgress] = useState<{ done: number; errors: number; total: number } | null>(null);
  const [bulkDone, setBulkDone] = useState(false);

  const handleSearch = async (query?: string) => {
    if (_searchingRef.current) return;
    const target = (query ?? username).replace(/^@/, "").trim();
    if (!target) return;

    _searchingRef.current = true;
    setUsername(target);
    setStatus("loading");
    setError("");
    setReels([]);
    setBulkProgress(null);
    setBulkDone(false);

    try {
      const res = await fetch("/api/inspirations/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: target }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? "Erro ao buscar Reels.");

      setReels(data.reels as InspirationReel[]);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setStatus("error");
    } finally {
      _searchingRef.current = false;
    }
  };

  const sortedReels = [...reels].sort((a, b) => b[sortBy] - a[sortBy]);

  const handleBulkDownload = async () => {
    if (_bulkRef.current || sortedReels.length === 0) return;
    _bulkRef.current = true;

    setBulkDone(false);
    setBulkProgress({ done: 0, errors: 0, total: sortedReels.length });

    let done = 0;
    let errors = 0;

    for (const reel of sortedReels) {
      try {
        await handleProcess(reel);
      } catch {
        errors++;
      }
      done++;
      setBulkProgress({ done, errors, total: sortedReels.length });
    }

    setBulkProgress(null);
    setBulkDone(true);
    _bulkRef.current = false;
  };

  const handleProcess = async (reel: InspirationReel) => {
    const res = await fetch("/api/video/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoUrl: reel.videoUrl,
        filename: `reel_${reel.owner}_${reel.shortCode}`,
        reelData: {
          caption: reel.caption,
          views: reel.views,
          likes: reel.likes,
          comments: reel.comments,
          duration: reel.duration,
          owner: reel.owner,
        },
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "Erro ao processar vídeo.");
    }
  };

  return (
    <div className="space-y-6 max-w-full">
      {/* Search hero */}
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
            Digite o @ de qualquer perfil público para visualizar os Reels e
            preparar downloads
          </p>

          {/* Input row */}
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
              disabled={status === "loading" || !username.trim()}
              className="btn-primary flex items-center gap-2 px-6 py-3.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {status === "loading" ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search size={16} />
                  Buscar Reels
                </>
              )}
            </motion.button>
          </div>

          {/* Recent searches */}
          {status === "idle" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 mt-4 flex-wrap"
            >
              <span className="text-[11px] text-white/25">Recentes:</span>
              {RECENT_SEARCHES.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSearch(s)}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/40 hover:text-white/70 hover:border-violet-500/30 hover:bg-violet-600/10 transition-all"
                >
                  @{s}
                </button>
              ))}
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Error state */}
      <AnimatePresence>
        {status === "error" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
          >
            <AlertCircle size={16} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results header */}
      <AnimatePresence>
        {status === "done" && reels.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between gap-3"
          >
            <div>
              <p className="text-sm font-semibold text-white/80">
                {reels.length} Reels encontrados
              </p>
              <p className="text-xs text-white/30">de @{username}</p>
            </div>

            <div className="flex items-center gap-2">
              {/* Bulk download button */}
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
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    {bulkProgress.done}/{bulkProgress.total} baixados
                  </>
                ) : (
                  <>
                    <Download size={11} />
                    Baixar todos
                  </>
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
        )}
      </AnimatePresence>

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
        {showFilters && status === "done" && (
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

      {/* Grid */}
      {status === "loading" && <InspirationGridSkeleton />}

      {status === "done" && reels.length > 0 && (
        <InspirationGrid reels={sortedReels} onProcess={handleProcess} />
      )}

      {/* Idle state */}
      {status === "idle" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-24 gap-4 text-center"
        >
          <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
            <Search size={32} className="text-white/15" />
          </div>
          <p className="text-white/30 text-sm max-w-xs">
            Digite o nome de um perfil do Instagram para buscar Reels e se
            inspirar
          </p>
        </motion.div>
      )}

      {/* Empty state */}
      {status === "done" && reels.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-24 gap-4 text-center"
        >
          <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
            <Instagram size={32} className="text-white/15" />
          </div>
          <p className="text-white/30 text-sm">
            Nenhum Reel encontrado para @{username}
          </p>
        </motion.div>
      )}
    </div>
  );
}
