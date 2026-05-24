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
  FolderPlus,
  Folder,
  ChevronRight,
  Trash2,
  FolderInput,
  Pencil,
  CheckSquare,
  Square,
  ChevronDown,
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

export interface LibraryFolder {
  id: string;
  name: string;
  created_at: string;
  video_count?: number;
}

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

export default function LibraryPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const _deletingRef = useRef<string | null>(null);
  const [postingVideo, setPostingVideo] = useState<LibraryVideo | null>(null);

  // ── Multi-select ─────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // ── Pastas ──────────────────────────────────────────────────
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<LibraryFolder | null>(null);

  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [movingVideo, setMovingVideo] = useState<LibraryVideo | null>(null);
  const [movingTo, setMovingTo] = useState<string | null>("__root__");
  const [movingLoading, setMovingLoading] = useState(false);

  const [deletingFolder, setDeletingFolder] = useState<LibraryFolder | null>(null);

  const [renamingFolder, setRenamingFolder] = useState<LibraryFolder | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingLoading, setRenamingLoading] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────
  const fetchFolders = useCallback(async () => {
    const res = await fetch("/api/library/folders");
    const data = await res.json() as { folders: LibraryFolder[] };
    setFolders(data.folders ?? []);
  }, []);

  const fetchVideos = useCallback(async (
    folderId: string | null | undefined,
    targetPage: number,
    append: boolean
  ) => {
    if (targetPage === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set("folderId", folderId ? folderId : "root");
      params.set("page", String(targetPage));
      const res = await fetch(`/api/library?${params}`);
      const data = await res.json() as { videos: LibraryVideo[]; hasMore: boolean };
      const fetched = data.videos ?? [];
      setVideos(prev => append ? [...prev, ...fetched] : fetched);
      setHasMore(data.hasMore ?? false);
      setPage(targetPage);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchFolders();
    fetchVideos(null, 0, false);
  }, [fetchFolders, fetchVideos]);

  const navigateToFolder = useCallback((folder: LibraryFolder | null) => {
    setCurrentFolder(folder);
    setSelectedIds(new Set());
    fetchVideos(folder?.id ?? null, 0, false);
  }, [fetchVideos]);

  const handleLoadMore = useCallback(() => {
    fetchVideos(currentFolder?.id ?? null, page + 1, true);
  }, [fetchVideos, currentFolder, page]);

  // ── Multi-select handlers ────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(videos.map(v => v.id)));
  }, [videos]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    setBulkError(null);
    try {
      const items = videos
        .filter(v => selectedIds.has(v.id))
        .map(v => ({ id: v.id, storage_path: v.storage_path }));

      const res = await fetch("/api/library/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (res.ok) {
        // Remove from local state only after confirmed server-side deletion
        setVideos(prev => prev.filter(v => !selectedIds.has(v.id)));
        setSelectedIds(new Set());
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setBulkError(data.error ?? `Erro ao excluir (HTTP ${res.status}). Tente novamente.`);
      }
    } catch {
      setBulkError("Falha de rede ao excluir. Verifique sua conexão e tente novamente.");
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedIds, videos, bulkDeleting]);

  // ── Upload ────────────────────────────────────────────────────
  const currentFolderRef = useRef<LibraryFolder | null>(null);
  currentFolderRef.current = currentFolder;

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

      const folderId = currentFolderRef.current?.id ?? null;
      const res = await fetch("/api/library/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, filename: safeName, fileSize: file.size, folderId }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Erro ao salvar registro.");
      }

      setUploads(prev => prev.map(u => u.id === item.id ? { ...u, progress: 100, status: "done" } : u));
      fetchVideos(currentFolderRef.current?.id ?? null, 0, false);
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

  // ── Ações de vídeo ───────────────────────────────────────────
  const handleDelete = async (video: LibraryVideo) => {
    if (_deletingRef.current === video.id) return;
    _deletingRef.current = video.id;
    try {
      const res = await fetch("/api/library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id, storage_path: video.storage_path }),
      });
      if (res.ok) {
        setVideos(prev => prev.filter(v => v.id !== video.id));
        setSelectedIds(prev => { const n = new Set(prev); n.delete(video.id); return n; });
      }
    } finally {
      _deletingRef.current = null;
    }
  };

  const handleSchedule = (video: LibraryVideo) => router.push(`/dashboard/schedule?videoId=${video.id}`);
  const handlePost = (video: LibraryVideo) => setPostingVideo(video);
  const handleMoveOpen = (video: LibraryVideo) => {
    setMovingVideo(video);
    setMovingTo(video.folder_id ?? "__root__");
  };

  const handleMoveConfirm = async () => {
    if (!movingVideo) return;
    setMovingLoading(true);
    try {
      const folder_id = movingTo === "__root__" ? null : movingTo;
      const res = await fetch("/api/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: movingVideo.id, folder_id }),
      });
      if (res.ok) {
        setVideos(prev => prev.filter(v => v.id !== movingVideo.id));
        setMovingVideo(null);
      }
    } finally {
      setMovingLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/library/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      if (res.ok) {
        await fetchFolders();
        setShowNewFolder(false);
        setNewFolderName("");
      }
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renamingFolder || !renameValue.trim() || renamingLoading) return;
    setRenamingLoading(true);
    try {
      const res = await fetch(`/api/library/folders/${renamingFolder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (res.ok) {
        setFolders(prev =>
          prev.map(f => f.id === renamingFolder.id ? { ...f, name: renameValue.trim() } : f)
        );
        if (currentFolder?.id === renamingFolder.id) {
          setCurrentFolder(prev => prev ? { ...prev, name: renameValue.trim() } : null);
        }
        setRenamingFolder(null);
      }
    } finally {
      setRenamingLoading(false);
    }
  };

  const handleDeleteFolder = async (folder: LibraryFolder) => {
    const res = await fetch(`/api/library/folders/${folder.id}`, { method: "DELETE" });
    if (res.ok) {
      await fetchFolders();
      if (currentFolder?.id === folder.id) navigateToFolder(null);
      setDeletingFolder(null);
    }
  };

  const allSelected = videos.length > 0 && selectedIds.size === videos.length;

  return (
    <div className="space-y-5 max-w-full pb-28">

      {/* Post modal */}
      <AnimatePresence>
        {postingVideo && (
          <PostModal video={postingVideo} onClose={() => setPostingVideo(null)} />
        )}
      </AnimatePresence>

      {/* Modal Nova Pasta */}
      <AnimatePresence>
        {showNewFolder && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", duration: 0.35 }}
              onClick={e => e.stopPropagation()}
              className="glass w-full max-w-sm rounded-2xl p-6 space-y-5 border border-white/10"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center">
                  <FolderPlus size={18} className="text-violet-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Nova Pasta</h3>
                  <p className="text-xs text-white/40">Organize seus vídeos por tema ou campanha</p>
                </div>
              </div>
              <input
                autoFocus type="text" placeholder="Ex: Reels Fitness, Travel Vibes..."
                value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreateFolder()}
                className="input-glass w-full text-sm"
              />
              <div className="flex gap-3">
                <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="btn-ghost flex-1 text-sm py-2.5">Cancelar</button>
                <button onClick={handleCreateFolder} disabled={!newFolderName.trim() || creatingFolder} className="btn-primary flex-1 text-sm py-2.5 disabled:opacity-50">
                  {creatingFolder ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Criar Pasta"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Mover Vídeo */}
      <AnimatePresence>
        {movingVideo && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setMovingVideo(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", duration: 0.35 }}
              onClick={e => e.stopPropagation()}
              className="glass w-full max-w-sm rounded-2xl p-6 space-y-4 border border-white/10"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                  <FolderInput size={18} className="text-cyan-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">Mover vídeo</h3>
                  <p className="text-xs text-white/40 truncate">{movingVideo.filename.slice(0, 36)}</p>
                </div>
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                <button
                  onClick={() => setMovingTo("__root__")}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                    movingTo === "__root__"
                      ? "bg-violet-600/20 border border-violet-500/40 text-white"
                      : "border border-transparent text-white/50 hover:bg-white/[0.05] hover:text-white/80"
                  )}
                >
                  <FolderOpen size={15} className="flex-shrink-0" />
                  <span>Raiz (sem pasta)</span>
                  {movingTo === "__root__" && <CheckMark />}
                </button>
                {folders.map(f => (
                  <button
                    key={f.id} onClick={() => setMovingTo(f.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                      movingTo === f.id
                        ? "bg-violet-600/20 border border-violet-500/40 text-white"
                        : "border border-transparent text-white/50 hover:bg-white/[0.05] hover:text-white/80"
                    )}
                  >
                    <Folder size={15} className="flex-shrink-0 text-violet-400" />
                    <span className="truncate">{f.name}</span>
                    {movingTo === f.id && <CheckMark />}
                  </button>
                ))}
                {folders.length === 0 && (
                  <p className="text-xs text-white/30 text-center py-4">Nenhuma pasta criada ainda</p>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setMovingVideo(null)} className="btn-ghost flex-1 text-sm py-2.5">Cancelar</button>
                <button onClick={handleMoveConfirm} disabled={movingLoading} className="btn-primary flex-1 text-sm py-2.5 disabled:opacity-50">
                  {movingLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Mover"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal confirmar exclusão de pasta */}
      <AnimatePresence>
        {deletingFolder && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setDeletingFolder(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", duration: 0.35 }}
              onClick={e => e.stopPropagation()}
              className="glass w-full max-w-sm rounded-2xl p-6 space-y-4 border border-red-500/20"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                  <Trash2 size={18} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Excluir pasta</h3>
                  <p className="text-xs text-white/40">Os vídeos serão movidos para a raiz</p>
                </div>
              </div>
              <p className="text-sm text-white/60">
                Tem certeza que deseja excluir <span className="text-white font-medium">&ldquo;{deletingFolder.name}&rdquo;</span>?
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeletingFolder(null)} className="btn-ghost flex-1 text-sm py-2.5">Cancelar</button>
                <button
                  onClick={() => handleDeleteFolder(deletingFolder)}
                  className="flex-1 text-sm py-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-all duration-200"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Renomear Pasta */}
      <AnimatePresence>
        {renamingFolder && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setRenamingFolder(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", duration: 0.35 }}
              onClick={e => e.stopPropagation()}
              className="glass w-full max-w-sm rounded-2xl p-6 space-y-5 border border-white/10"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center">
                  <Pencil size={18} className="text-violet-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Renomear Pasta</h3>
                  <p className="text-xs text-white/40">Escolha um novo nome para a pasta</p>
                </div>
              </div>
              <input
                autoFocus type="text" placeholder="Novo nome da pasta..."
                value={renameValue} onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRenameFolder()}
                className="input-glass w-full text-sm"
              />
              <div className="flex gap-3">
                <button onClick={() => setRenamingFolder(null)} className="btn-ghost flex-1 text-sm py-2.5">Cancelar</button>
                <button onClick={handleRenameFolder} disabled={!renameValue.trim() || renamingLoading} className="btn-primary flex-1 text-sm py-2.5 disabled:opacity-50">
                  {renamingLoading ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Salvar"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header: breadcrumbs + botão Nova Pasta */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-sm">
          <button
            onClick={() => navigateToFolder(null)}
            className={cn(
              "transition-colors duration-150",
              currentFolder ? "text-white/40 hover:text-white/70" : "text-white/70 cursor-default"
            )}
          >
            Biblioteca
          </button>
          {currentFolder && (
            <>
              <ChevronRight size={13} className="text-white/25" />
              <span className="text-white font-medium">{currentFolder.name}</span>
            </>
          )}
        </div>

        {!currentFolder && (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-white/60 hover:text-white/90 hover:bg-white/[0.09] hover:border-white/20 text-xs font-medium transition-all duration-200 flex-shrink-0"
          >
            <FolderPlus size={14} />
            Nova Pasta
          </motion.button>
        )}
      </div>

      {/* Upload zone */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
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
            {isDragOver
              ? `Solte para enviar${currentFolder ? ` para "${currentFolder.name}"` : ""}`
              : "Arraste vídeos aqui ou clique para selecionar"}
          </p>
          <p className="text-xs text-white/25 mt-0.5">
            {currentFolder
              ? `Os vídeos serão salvos em "${currentFolder.name}"`
              : "Suporta MP4, MOV, WebM · Múltiplos arquivos"}
          </p>
        </div>
      </motion.div>

      {/* Upload queue */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
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

      {/* ── Seção de Pastas (só na raiz) ─────────────────────── */}
      <AnimatePresence>
        {!currentFolder && folders.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="space-y-3"
          >
            <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">Pastas</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {folders.map((folder, i) => (
                <FolderCard
                  key={folder.id} folder={folder} index={i}
                  onClick={() => navigateToFolder(folder)}
                  onDelete={() => setDeletingFolder(folder)}
                  onRename={() => { setRenamingFolder(folder); setRenameValue(folder.name); }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!currentFolder && folders.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/[0.06]" />
          <span className="text-xs text-white/25">Vídeos na raiz</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>
      )}

      {/* ── Barra de controle: contagem + selecionar todos ──── */}
      {!loading && videos.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/30">
            {videos.length} vídeo{videos.length !== 1 ? "s" : ""} carregado{videos.length !== 1 ? "s" : ""}
            {hasMore && " (mais disponíveis)"}
          </p>
          <button
            onClick={allSelected ? clearSelection : selectAll}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            {allSelected
              ? <><CheckSquare size={13} className="text-[#00FF41]" /> Desmarcar todos</>
              : <><Square size={13} /> Selecionar todos</>
            }
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
              className="rounded-2xl animate-pulse"
              style={{ aspectRatio: "9/16", background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.06)" }}
            />
          ))}
        </div>
      )}

      {/* Video grid */}
      {!loading && videos.length > 0 && (
        <AnimatePresence mode="popLayout">
          <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {videos.map(video => (
              <VideoCard
                key={video.id}
                video={video}
                onSchedule={handleSchedule}
                onPost={handlePost}
                onDelete={handleDelete}
                onMove={handleMoveOpen}
                selected={selectedIds.has(video.id)}
                onSelect={toggleSelect}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Load more */}
      {!loading && hasMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl border border-white/[0.08] text-sm text-white/50 hover:text-white/80 hover:bg-white/[0.05] hover:border-white/[0.14] transition-all disabled:opacity-50"
          >
            {loadingMore
              ? <><Loader2 size={14} className="animate-spin" /> Carregando...</>
              : <><ChevronDown size={14} /> Carregar mais</>
            }
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && videos.length === 0 && uploads.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 gap-5 text-center">
          <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
            {currentFolder
              ? <Folder size={32} className="text-white/15" />
              : <FolderOpen size={32} className="text-white/15" />}
          </div>
          <div>
            <p className="text-white/50 font-medium mb-1">
              {currentFolder ? `A pasta "${currentFolder.name}" está vazia` : "Biblioteca vazia"}
            </p>
            <p className="text-white/25 text-sm max-w-xs">
              {currentFolder
                ? "Faça upload de vídeos acima ou mova arquivos da raiz para cá."
                : "Faça upload de qualquer vídeo acima ou baixe Reels na seção Inspirações."}
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Bulk delete error toast ──────────────────────────── */}
      <AnimatePresence>
        {bulkError && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl"
            style={{
              background: "rgba(20,6,6,0.95)",
              border: "1px solid rgba(255,59,48,0.4)",
              backdropFilter: "blur(16px)",
              maxWidth: "min(90vw, 420px)",
            }}
          >
            <AlertCircle size={15} style={{ color: "rgba(255,80,70,0.9)", flexShrink: 0 }} />
            <span className="text-xs text-red-300 flex-1">{bulkError}</span>
            <button
              onClick={() => setBulkError(null)}
              className="flex-shrink-0 text-white/30 hover:text-white/60 transition-colors"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating selection bar ────────────────────────────── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl"
              style={{
                background: "rgba(8,8,12,0.92)",
                border: "1px solid rgba(0,255,65,0.2)",
                backdropFilter: "blur(20px)",
                boxShadow: "0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,255,65,0.1)",
              }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(0,255,65,0.12)", border: "1px solid rgba(0,255,65,0.25)" }}
              >
                <CheckSquare size={14} style={{ color: "#00FF41" }} />
              </div>
              <span className="text-sm font-semibold text-white/80 whitespace-nowrap">
                {selectedIds.size} vídeo{selectedIds.size !== 1 ? "s" : ""} selecionado{selectedIds.size !== 1 ? "s" : ""}
              </span>

              <div className="w-px h-4 bg-white/[0.12]" />

              <button
                onClick={clearSelection}
                className="text-xs text-white/40 hover:text-white/70 transition-colors whitespace-nowrap"
              >
                Cancelar
              </button>

              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-50 whitespace-nowrap"
                style={{
                  background: "rgba(255,59,48,0.15)",
                  border: "1px solid rgba(255,59,48,0.35)",
                  color: "rgba(255,100,90,0.95)",
                }}
              >
                {bulkDeleting
                  ? <><Loader2 size={12} className="animate-spin" /> Excluindo...</>
                  : <><Trash2 size={12} /> Excluir {selectedIds.size}</>
                }
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function CheckMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className="ml-auto text-violet-400">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── FolderCard ────────────────────────────────────────────────

const FOLDER_GRADIENTS = [
  { bg: "from-violet-600/20 to-purple-700/10", icon: "text-violet-400", border: "border-violet-500/20 hover:border-violet-500/40", glow: "hover:shadow-[0_4px_20px_rgba(139,92,246,0.2)]" },
  { bg: "from-cyan-500/20 to-blue-700/10", icon: "text-cyan-400", border: "border-cyan-500/20 hover:border-cyan-500/40", glow: "hover:shadow-[0_4px_20px_rgba(6,182,212,0.2)]" },
  { bg: "from-pink-500/20 to-rose-700/10", icon: "text-pink-400", border: "border-pink-500/20 hover:border-pink-500/40", glow: "hover:shadow-[0_4px_20px_rgba(236,72,153,0.2)]" },
  { bg: "from-emerald-500/20 to-teal-700/10", icon: "text-emerald-400", border: "border-emerald-500/20 hover:border-emerald-500/40", glow: "hover:shadow-[0_4px_20px_rgba(16,185,129,0.2)]" },
  { bg: "from-amber-500/20 to-orange-700/10", icon: "text-amber-400", border: "border-amber-500/20 hover:border-amber-500/40", glow: "hover:shadow-[0_4px_20px_rgba(245,158,11,0.2)]" },
  { bg: "from-indigo-500/20 to-violet-700/10", icon: "text-indigo-400", border: "border-indigo-500/20 hover:border-indigo-500/40", glow: "hover:shadow-[0_4px_20px_rgba(99,102,241,0.2)]" },
];

interface FolderCardProps {
  folder: LibraryFolder;
  index: number;
  onClick: () => void;
  onDelete: () => void;
  onRename: () => void;
}

function FolderCard({ folder, index, onClick, onDelete, onRename }: FolderCardProps) {
  const [hovered, setHovered] = useState(false);
  const style = FOLDER_GRADIENTS[index % FOLDER_GRADIENTS.length];
  const count = folder.video_count ?? 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -3, scale: 1.02 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={cn(
        "relative rounded-xl border bg-gradient-to-br p-4 cursor-pointer transition-all duration-200 group",
        style.bg, style.border, style.glow
      )}
      onClick={onClick}
    >
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            className="absolute top-2 right-2 flex gap-1"
          >
            <button
              onClick={e => { e.stopPropagation(); onRename(); }}
              className="w-6 h-6 rounded-lg bg-black/40 border border-white/20 flex items-center justify-center text-white/50 hover:text-white/90 hover:bg-white/10 transition-colors"
            >
              <Pencil size={9} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="w-6 h-6 rounded-lg bg-black/40 border border-red-500/30 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <X size={10} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn("w-10 h-10 mb-3 flex items-center justify-center", style.icon)}>
        <Folder size={36} strokeWidth={1.5} />
      </div>

      <p className="text-xs font-semibold text-white/80 truncate leading-tight">{folder.name}</p>
      <p className="text-[10px] text-white/35 mt-0.5">
        {count === 0 ? "Vazia" : `${count} vídeo${count !== 1 ? "s" : ""}`}
      </p>
    </motion.div>
  );
}
