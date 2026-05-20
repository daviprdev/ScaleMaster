"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  Play,
  CalendarClock,
  Trash2,
  Eye,
  Heart,
  Clock,
  HardDrive,
  Loader2,
  Send,
  FolderInput,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface LibraryVideo {
  id: string;
  filename: string;
  public_url: string;
  storage_path: string;
  owner_username: string | null;
  caption: string | null;
  views: number;
  likes: number;
  duration: number;
  file_size: number;
  created_at: string;
  folder_id?: string | null;
  gradient?: string;
}

interface VideoCardProps {
  video: LibraryVideo;
  onSchedule: (video: LibraryVideo) => void;
  onPost: (video: LibraryVideo) => void;
  onDelete: (video: LibraryVideo) => Promise<void>;
  onMove?: (video: LibraryVideo) => void;
}

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "há poucos minutos";
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}

export function VideoCard({ video, onSchedule, onPost, onDelete, onMove }: VideoCardProps) {
  const [hovered, setHovered] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(video);
    } finally {
      setDeleting(false);
    }
  };

  const gradient = video.gradient ?? "from-violet-600 to-purple-800";
  const shortName = video.filename.replace(/_clean_\d+\.mp4$/, "").slice(0, 28);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.25 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="glass-card overflow-hidden group hover:border-white/20 hover:shadow-[0_8px_30px_rgba(139,92,246,0.15)] transition-all duration-300"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden">
        <div className={cn("absolute inset-0 bg-gradient-to-br", gradient)} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

        {/* Duration badge */}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/75 text-[10px] text-white/80">
          <Clock size={9} />
          {formatDuration(video.duration)}
        </div>

        {/* Play icon */}
        <AnimatePresence>
          {!hovered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="w-11 h-11 rounded-full bg-white/15 border border-white/20 flex items-center justify-center">
                <Play size={18} className="text-white ml-0.5" fill="white" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hover overlay — actions */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-black/82 flex flex-col items-center justify-center gap-2.5 p-4"
            >
              <motion.button
                onClick={() => onPost(video)}
                whileTap={{ scale: 0.95 }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                  bg-gradient-to-r from-pink-600 to-violet-600
                  hover:from-pink-500 hover:to-violet-500
                  text-white text-sm font-semibold
                  hover:shadow-[0_0_15px_rgba(219,39,119,0.45)]
                  transition-all duration-200"
              >
                <Send size={14} />
                Postar agora
              </motion.button>

              <div className="w-full grid grid-cols-2 gap-2">
                <motion.button
                  onClick={() => onSchedule(video)}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl
                    border border-white/15 bg-white/[0.05]
                    text-white/60 hover:bg-white/[0.10] hover:text-white/80
                    text-xs font-medium transition-all duration-200"
                >
                  <CalendarClock size={12} />
                  Agendar
                </motion.button>

                <motion.button
                  onClick={() => onMove?.(video)}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl
                    border border-cyan-500/25 bg-cyan-500/10
                    text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/40
                    text-xs font-medium transition-all duration-200"
                >
                  <FolderInput size={12} />
                  Mover
                </motion.button>
              </div>

              <motion.button
                onClick={handleDelete}
                whileTap={{ scale: 0.95 }}
                disabled={deleting}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl
                  border border-red-500/30 bg-red-500/10
                  text-red-400 hover:bg-red-500/20 hover:border-red-500/50
                  text-sm font-medium transition-all duration-200
                  disabled:opacity-50"
              >
                {deleting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {deleting ? "Excluindo..." : "Excluir"}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div>
          <p className="text-xs font-semibold text-white/80 truncate" title={video.filename}>
            {shortName}
          </p>
          {video.owner_username && (
            <p className="text-[10px] text-violet-400">@{video.owner_username}</p>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-[10px] text-white/30">
          <span className="flex items-center gap-1">
            <Eye size={9} />
            {formatNumber(video.views)}
          </span>
          <span className="flex items-center gap-1">
            <Heart size={9} />
            {formatNumber(video.likes)}
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <HardDrive size={9} />
            {formatBytes(video.file_size)}
          </span>
        </div>

        <p className="text-[10px] text-white/20">{timeAgo(video.created_at)}</p>
      </div>
    </motion.div>
  );
}
