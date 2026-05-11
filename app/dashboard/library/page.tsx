"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  FolderOpen,
  Search,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  ArrowUpDown,
  UploadCloud,
  Film,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { VideoCard, type LibraryVideo } from "@/components/library/VideoCard";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────
interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

type SortKey = "created_at" | "views" | "file_size" | "duration";
type ViewMode = "grid" | "list";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "created_at", label: "Mais recentes" },
  { key: "views", label: "Mais vistos" },
  { key: "file_size", label: "Maior tamanho" },
  { key: "duration", label: "Mais longos" },
];

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

// ── Page ─────────────────────────────────────────────────────
export default function LibraryPage() {
  const router = useRouter();

  // Library state
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("created_at");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showSort, setShowSort] = useState(false);

  // Upload state
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch videos ───────────────────────────────────────────
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

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  // ── Upload logic ───────────────────────────────────────────
  const processUpload = useCallback(async (item: UploadItem) => {
    const { file } = item;
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-z0-9._-]/gi, "_");
    const storagePath = `videos/upload_${timestamp}_${safeName}`;

    setUploads(prev =>
      prev.map(u => u.id === item.id ? { ...u, status: "uploading" } : u)
    );

    try {
      // Upload direto ao Supabase Storage via XHR (suporta progresso real)
      // e não passa pelo limite de 4.5 MB da Vercel
      await new Promise<void>((resolve, reject) => {
        const supabase = createClient();

        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) { reject(new Error("Sessão expirada. Faça login novamente.")); return; }

          const xhr = new XMLHttpRequest();

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 90);
              setUploads(prev =>
                prev.map(u => u.id === item.id ? { ...u, progress: pct } : u)
              );
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              let msg = `HTTP ${xhr.status}`;
              try { msg = (JSON.parse(xhr.responseText) as { message?: string }).message ?? msg; } catch { /* noop */ }
              reject(new Error(msg));
            }
          };

          xhr.onerror = () => reject(new Error("Erro de rede durante o upload."));

          const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/videos-library/${storagePath}`;
          xhr.open("POST", url);
          xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
          xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
          xhr.send(file);
        });
      });

      // Salva registro no banco (payload pequeno, sem limite de tamanho)
      const res = await fetch("/api/library/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, filename: safeName, fileSize: file.size }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Erro ao salvar registro.");
      }

      setUploads(prev =>
        prev.map(u => u.id === item.id ? { ...u, progress: 100, status: "done" } : u)
      );

      fetchVideos();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido.";
      setUploads(prev =>
        prev.map(u => u.id === item.id ? { ...u, status: "error", error: message } : u)
      );
    }
  }, [fetchVideos]);

  const addFiles = useCallback((files: File[]) => {
    const videoFiles = files.filter(f => f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv)$/i.test(f.name));
    if (!videoFiles.length) return;

    const newItems: UploadItem[] = videoFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: "pending",
    }));

    setUploads(prev => [...prev, ...newItems]);
    newItems.forEach(processUpload);
  }, [processUpload]);

  // Drag-and-drop handlers
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const clearDoneUploads = () => {
    setUploads(prev => prev.filter(u => u.status !== "done" && u.status !== "error"));
  };

  const activeUploads = uploads.filter(u => u.status === "uploading" || u.status === "pending").length;

  // ── Library filters ────────────────────────────────────────
  const handleDelete = async (video: LibraryVideo) => {
    const res = await fetch("/api/library", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: video.id, storage_path: video.storage_path }),
    });
    if (res.ok) setVideos(prev => prev.filter(v => v.id !== video.id));
  };

  const handleSchedule = (video: LibraryVideo) => {
    router.push(`/dashboard/schedule?videoId=${video.id}`);
  };

  const filtered = videos
    .filter(v => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        v.filename.toLowerCase().includes(q) ||
        v.owner_username?.toLowerCase().includes(q) ||
        v.caption?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "created_at") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return (b[sortBy] as number) - (a[sortBy] as number);
    });

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-full">

      {/* ── Upload zone ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "relative rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer",
          "flex flex-col items-center justify-center gap-3 py-10 px-6 text-center",
          isDragOver
            ? "border-violet-500/60 bg-violet-600/10 scale-[1.01]"
            : "border-white/[0.10] bg-white/[0.02] hover:border-violet-500/30 hover:bg-violet-600/5"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />

        <div className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
          isDragOver ? "bg-violet-600/20" : "bg-white/[0.04]"
        )}>
          <UploadCloud size={22} className={isDragOver ? "text-violet-400" : "text-white/25"} />
        </div>

        <div>
          <p className="text-sm font-semibold text-white/70">
            {isDragOver ? "Solte para fazer upload" : "Arraste vídeos aqui ou clique para selecionar"}
          </p>
          <p className="text-xs text-white/25 mt-0.5">
            Suporta MP4, MOV, WebM · Múltiplos arquivos
          </p>
        </div>
      </motion.div>

      {/* ── Upload queue ── */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="glass-card overflow-hidden"
          >
            {/* Queue header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Film size={14} className="text-violet-400" />
                <span className="text-xs font-semibold text-white/70">
                  {activeUploads > 0
                    ? `Enviando ${activeUploads} arquivo${activeUploads > 1 ? "s" : ""}...`
                    : "Uploads concluídos"}
                </span>
              </div>
              {activeUploads === 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); clearDoneUploads(); }}
                  className="text-xs text-white/25 hover:text-white/60 flex items-center gap-1 transition-colors"
                >
                  <X size={12} />
                  Limpar
                </button>
              )}
            </div>

            {/* Queue items */}
            <div className="divide-y divide-white/[0.04]">
              <AnimatePresence initial={false}>
                {uploads.map(item => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="px-4 py-3 space-y-2"
                  >
                    {/* File info row */}
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs",
                        item.status === "done" ? "bg-emerald-500/15 text-emerald-400" :
                        item.status === "error" ? "bg-red-500/15 text-red-400" :
                        "bg-violet-600/15 text-violet-400"
                      )}>
                        {item.status === "done" ? <CheckCircle2 size={14} /> :
                         item.status === "error" ? <AlertCircle size={14} /> :
                         item.status === "uploading" ? <Loader2 size={13} className="animate-spin" /> :
                         <Film size={13} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white/75 truncate">
                          {item.file.name}
                        </p>
                        {item.status === "error" ? (
                          <p className="text-[10px] text-red-400 truncate">{item.error}</p>
                        ) : (
                          <p className="text-[10px] text-white/25">
                            {formatBytes(item.file.size)}
                          </p>
                        )}
                      </div>

                      <span className={cn(
                        "text-[10px] font-semibold flex-shrink-0",
                        item.status === "done" ? "text-emerald-400" :
                        item.status === "error" ? "text-red-400" :
                        "text-white/35"
                      )}>
                        {item.status === "done" ? "Concluído" :
                         item.status === "error" ? "Erro" :
                         item.status === "uploading" ? `${item.progress}%` :
                         "Na fila"}
                      </span>
                    </div>

                    {/* Progress bar */}
                    {item.status !== "error" && (
                      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <motion.div
                          className={cn(
                            "h-full rounded-full",
                            item.status === "done"
                              ? "bg-emerald-500"
                              : "bg-gradient-to-r from-violet-600 to-cyan-500"
                          )}
                          initial={{ width: "0%" }}
                          animate={{ width: `${item.progress}%` }}
                          transition={{ duration: 0.35, ease: "easeOut" }}
                        />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Top bar ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex flex-col sm:flex-row gap-3"
      >
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
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
                {SORT_OPTIONS.find(s => s.key === sortBy)?.label}
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
                  {SORT_OPTIONS.map(opt => (
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
            {(["grid", "list"] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "p-1.5 rounded-lg transition-all",
                  viewMode === mode ? "bg-violet-600/30 text-violet-300" : "text-white/30 hover:text-white/60"
                )}
              >
                {mode === "grid" ? <LayoutGrid size={14} /> : <LayoutList size={14} />}
              </button>
            ))}
          </div>

          {/* Sort options icon (alternative) */}
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
            {filtered.map(video => (
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

      {/* Empty state */}
      {!loading && videos.length === 0 && uploads.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 gap-5 text-center"
        >
          <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
            <FolderOpen size={32} className="text-white/15" />
          </div>
          <div>
            <p className="text-white/50 font-medium mb-1">Biblioteca vazia</p>
            <p className="text-white/25 text-sm max-w-xs">
              Faça upload de qualquer vídeo acima ou baixe Reels na seção Inspirações.
            </p>
          </div>
        </motion.div>
      )}

      {/* No results */}
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
