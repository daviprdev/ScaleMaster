"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  FolderOpen,
  Search,
  SlidersHorizontal,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  ArrowUpDown,
} from "lucide-react";
import { VideoCard, type LibraryVideo } from "@/components/library/VideoCard";
import { cn } from "@/lib/utils";

type SortKey = "created_at" | "views" | "file_size" | "duration";
type ViewMode = "grid" | "list";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "created_at", label: "Mais recentes" },
  { key: "views", label: "Mais vistos" },
  { key: "file_size", label: "Maior tamanho" },
  { key: "duration", label: "Mais longos" },
];

export default function LibraryPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("created_at");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showSort, setShowSort] = useState(false);

  const fetchVideos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      setVideos(data.videos ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  const handleDelete = async (video: LibraryVideo) => {
    const res = await fetch("/api/library", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: video.id, storage_path: video.storage_path }),
    });
    if (res.ok) {
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
    }
  };

  const handleSchedule = (video: LibraryVideo) => {
    router.push(`/dashboard/schedule?videoId=${video.id}`);
  };

  const filtered = videos
    .filter((v) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        v.filename.toLowerCase().includes(q) ||
        v.owner_username?.toLowerCase().includes(q) ||
        v.caption?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "created_at") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return (b[sortBy] as number) - (a[sortBy] as number);
    });

  return (
    <div className="space-y-5 max-w-full">
      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row gap-3"
      >
        {/* Search */}
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, perfil ou legenda..."
            className="input-glass pl-9 py-2.5 text-sm w-full"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Sort dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSort(!showSort)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm border transition-all",
                showSort
                  ? "bg-violet-600/20 border-violet-500/30 text-violet-300"
                  : "bg-white/5 border-white/10 text-white/50 hover:text-white/80"
              )}
            >
              <ArrowUpDown size={13} />
              <span className="hidden sm:inline">
                {SORT_OPTIONS.find((s) => s.key === sortBy)?.label}
              </span>
            </button>

            <AnimatePresence>
              {showSort && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-44 glass rounded-xl border border-white/10 overflow-hidden z-20 shadow-xl"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => { setSortBy(opt.key); setShowSort(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors",
                        sortBy === opt.key
                          ? "text-violet-300 bg-violet-600/20"
                          : "text-white/50 hover:text-white/80 hover:bg-white/5"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
            {(["grid", "list"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "p-1.5 rounded-lg transition-all",
                  viewMode === mode
                    ? "bg-violet-600/30 text-violet-300"
                    : "text-white/30 hover:text-white/60"
                )}
              >
                {mode === "grid" ? <LayoutGrid size={14} /> : <LayoutList size={14} />}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={fetchVideos}
            className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-white/30 hover:text-white/70 transition-all"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </motion.div>

      {/* Stats bar */}
      {!loading && videos.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-4 text-xs text-white/30"
        >
          <span>
            <span className="text-white/60 font-medium">{filtered.length}</span>
            {" "}vídeo{filtered.length !== 1 ? "s" : ""}
            {search && ` encontrado${filtered.length !== 1 ? "s" : ""}`}
          </span>
          {search && videos.length !== filtered.length && (
            <span>de {videos.length} total</span>
          )}
        </motion.div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className={cn(
          "grid gap-4",
          viewMode === "grid"
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            : "grid-cols-1"
        )}>
          {Array.from({ length: 8 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.04 }}
              className="glass-card animate-pulse"
            >
              <div className="aspect-video bg-white/[0.04] rounded-t-xl" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-white/[0.06] rounded-full w-3/4" />
                <div className="h-2 bg-white/[0.04] rounded-full w-1/2" />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Video grid */}
      {!loading && filtered.length > 0 && (
        <AnimatePresence mode="popLayout">
          <motion.div
            layout
            className={cn(
              "grid gap-4",
              viewMode === "grid"
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "grid-cols-1 max-w-2xl"
            )}
          >
            {filtered.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onSchedule={handleSchedule}
                onDelete={handleDelete}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Empty states */}
      {!loading && videos.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-28 gap-5 text-center"
        >
          <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
            <FolderOpen size={32} className="text-white/15" />
          </div>
          <div>
            <p className="text-white/50 font-medium mb-1">Biblioteca vazia</p>
            <p className="text-white/25 text-sm max-w-xs">
              Baixe Reels na página de Pesquisa e eles aparecerão aqui.
            </p>
          </div>
          <a href="/dashboard/search" className="btn-primary text-sm px-6 py-2.5">
            Ir para Pesquisa
          </a>
        </motion.div>
      )}

      {!loading && videos.length > 0 && filtered.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 gap-3 text-center"
        >
          <Search size={28} className="text-white/15" />
          <p className="text-white/30 text-sm">
            Nenhum vídeo encontrado para &quot;{search}&quot;
          </p>
          <button
            onClick={() => setSearch("")}
            className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
          >
            Limpar busca
          </button>
        </motion.div>
      )}
    </div>
  );
}
