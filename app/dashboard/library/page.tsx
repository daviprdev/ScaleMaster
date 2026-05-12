"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  FolderOpen,
  UploadCloud,
  Film,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { VideoCard, type LibraryVideo } from "@/components/library/VideoCard";
import { PostModal } from "@/components/library/PostModal";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

export default function LibraryPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const _deletingRef = useRef<string | null>(null);
  const [postingVideo, setPostingVideo] = useState<LibraryVideo | null>(null);

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

  // ── Upload ─────────────────────────────────────────────────
  const processUpload = useCallback(async (item: UploadItem) => {
    const { file } = item;
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-z0-9._-]/gi, "_");
    const storagePath = `videos/upload_${timestamp}_${safeName}`;

    setUploads(prev => prev.map(u => u.id === item.id ? { ...u, status: "uploading" } : u));

    try {
      await new Promise<void>((resolve, reject) => {
        const supabase = createClient();
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) { reject(new Error("Sessão expirada. Faça login novamente.")); return; }

          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 90);
              setUploads(prev => prev.map(u => u.id === item.id ? { ...u, progress: pct } : u));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
            let msg = `HTTP ${xhr.status}`;
            try { msg = (JSON.parse(xhr.responseText) as { message?: string }).message ?? msg; } catch { /* noop */ }
            reject(new Error(msg));
          };
          xhr.onerror = () => reject(new Error("Erro de rede durante o upload."));

          const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/videos-library/${storagePath}`;
          xhr.open("POST", url);
          xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
          xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
          xhr.send(file);
        });
      });

      const res = await fetch("/api/library/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, filename: safeName, fileSize: file.size }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Erro ao salvar registro.");
      }

      setUploads(prev => prev.map(u => u.id === item.id ? { ...u, progress: 100, status: "done" } : u));
      fetchVideos();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido.";
      setUploads(prev => prev.map(u => u.id === item.id ? { ...u, status: "error", error: message } : u));
    }
  }, [fetchVideos]);

  const addFiles = useCallback((files: File[]) => {
    const videoFiles = files.filter(f => f.type.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv)$/i.test(f.name));
    if (!videoFiles.length) return;
    const newItems: UploadItem[] = videoFiles.map(file => ({
      id: crypto.randomUUID(), file, progress: 0, status: "pending",
    }));
    setUploads(prev => [...prev, ...newItems]);
    newItems.forEach(processUpload);
  }, [processUpload]);

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

  const activeUploads = uploads.filter(u => u.status === "uploading" || u.status === "pending").length;
  const clearDoneUploads = () => setUploads(prev => prev.filter(u => u.status !== "done" && u.status !== "error"));

  const handleDelete = async (video: LibraryVideo) => {
    if (_deletingRef.current === video.id) return;
    _deletingRef.current = video.id;
    try {
      const res = await fetch("/api/library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id, storage_path: video.storage_path }),
      });
      if (res.ok) setVideos(prev => prev.filter(v => v.id !== video.id));
    } finally {
      _deletingRef.current = null;
    }
  };

  const handleSchedule = (video: LibraryVideo) => {
    router.push(`/dashboard/schedule?videoId=${video.id}`);
  };

  const handlePost = (video: LibraryVideo) => {
    setPostingVideo(video);
  };

  return (
    <div className="space-y-5 max-w-full">

      {/* Post modal */}
      <AnimatePresence>
        {postingVideo && (
          <PostModal
            video={postingVideo}
            onClose={() => setPostingVideo(null)}
          />
        )}
      </AnimatePresence>

      {/* Upload zone */}
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
        <input ref={fileInputRef} type="file" accept="video/*" multiple className="hidden" onChange={handleFileInput} />
        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-colors", isDragOver ? "bg-violet-600/20" : "bg-white/[0.04]")}>
          <UploadCloud size={22} className={isDragOver ? "text-violet-400" : "text-white/25"} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white/70">
            {isDragOver ? "Solte para fazer upload" : "Arraste vídeos aqui ou clique para selecionar"}
          </p>
          <p className="text-xs text-white/25 mt-0.5">Suporta MP4, MOV, WebM · Múltiplos arquivos</p>
        </div>
      </motion.div>

      {/* Upload queue */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="glass-card overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Film size={14} className="text-violet-400" />
                <span className="text-xs font-semibold text-white/70">
                  {activeUploads > 0 ? `Enviando ${activeUploads} arquivo${activeUploads > 1 ? "s" : ""}...` : "Uploads concluídos"}
                </span>
              </div>
              {activeUploads === 0 && (
                <button onClick={(e) => { e.stopPropagation(); clearDoneUploads(); }} className="text-xs text-white/25 hover:text-white/60 flex items-center gap-1 transition-colors">
                  <X size={12} /> Limpar
                </button>
              )}
            </div>
            <div className="divide-y divide-white/[0.04]">
              <AnimatePresence initial={false}>
                {uploads.map(item => (
                  <motion.div key={item.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="px-4 py-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", item.status === "done" ? "bg-emerald-500/15 text-emerald-400" : item.status === "error" ? "bg-red-500/15 text-red-400" : "bg-violet-600/15 text-violet-400")}>
                        {item.status === "done" ? <CheckCircle2 size={14} /> : item.status === "error" ? <AlertCircle size={14} /> : item.status === "uploading" ? <Loader2 size={13} className="animate-spin" /> : <Film size={13} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white/75 truncate">{item.file.name}</p>
                        {item.status === "error"
                          ? <p className="text-[10px] text-red-400 truncate">{item.error}</p>
                          : <p className="text-[10px] text-white/25">{formatBytes(item.file.size)}</p>}
                      </div>
                      <span className={cn("text-[10px] font-semibold flex-shrink-0", item.status === "done" ? "text-emerald-400" : item.status === "error" ? "text-red-400" : "text-white/35")}>
                        {item.status === "done" ? "Concluído" : item.status === "error" ? "Erro" : item.status === "uploading" ? `${item.progress}%` : "Na fila"}
                      </span>
                    </div>
                    {item.status !== "error" && (
                      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <motion.div className={cn("h-full rounded-full", item.status === "done" ? "bg-emerald-500" : "bg-gradient-to-r from-violet-600 to-cyan-500")} initial={{ width: "0%" }} animate={{ width: `${item.progress}%` }} transition={{ duration: 0.35, ease: "easeOut" }} />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }} className="glass-card animate-pulse">
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
      {!loading && videos.length > 0 && (
        <AnimatePresence mode="popLayout">
          <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map(video => (
              <VideoCard key={video.id} video={video} onSchedule={handleSchedule} onPost={handlePost} onDelete={handleDelete} />
            ))}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Empty state */}
      {!loading && videos.length === 0 && uploads.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 gap-5 text-center">
          <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
            <FolderOpen size={32} className="text-white/15" />
          </div>
          <div>
            <p className="text-white/50 font-medium mb-1">Biblioteca vazia</p>
            <p className="text-white/25 text-sm max-w-xs">Faça upload de qualquer vídeo acima ou baixe Reels na seção Inspirações.</p>
          </div>
        </motion.div>
      )}

    </div>
  );
}
