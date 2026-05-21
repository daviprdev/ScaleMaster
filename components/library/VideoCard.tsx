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
  Film,
} from "lucide-react";

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
  const [videoError, setVideoError] = useState(false);

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

  const displayName = video.filename
    .replace(/_clean_\d+\.mp4$/, "")
    .replace(/^reel_/, "")
    .slice(0, 22);

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
      className="relative rounded-2xl overflow-hidden cursor-pointer ticks"
      style={{
        aspectRatio: "9/16",
        border: "0.5px solid rgba(255,255,255,0.08)",
        transition: "border-color 0.3s, box-shadow 0.3s",
        ...(hovered ? {
          borderColor: "rgba(0,255,65,0.32)",
          boxShadow: "0 0 0 0.5px rgba(0,229,255,0.1), 0 8px 28px rgba(0,255,65,0.12)",
        } : {}),
      }}
    >
      {/* ── Thumbnail: video first frame or gradient fallback ── */}
      {!videoError && video.public_url ? (
        <video
          src={video.public_url}
          className="absolute inset-0 w-full h-full object-cover"
          preload="metadata"
          muted
          playsInline
          onError={() => setVideoError(true)}
        />
      ) : (
        /* Gradient fallback */
        <div className="absolute inset-0 flex items-center justify-center"
          style={{ background: "linear-gradient(160deg, rgba(0,255,65,0.07) 0%, rgba(0,0,0,0.55) 50%, rgba(0,229,255,0.05) 100%)" }}>
          <Film size={28} style={{ color: "rgba(0,255,65,0.18)" }} />
        </div>
      )}

      {/* ── Persistent overlay: bottom gradient for text legibility ── */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.15) 70%, transparent 100%)" }} />

      {/* ── Top badges: owner + duration ── */}
      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10 pointer-events-none">
        {video.owner_username ? (
          <div className="px-2 py-0.5 rounded-full text-[10px] font-medium truncate max-w-[60%]"
            style={{ background: "rgba(0,0,0,0.70)", color: "rgba(0,255,65,0.8)", backdropFilter: "blur(4px)" }}>
            @{video.owner_username}
          </div>
        ) : <div />}
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
          style={{ background: "rgba(0,0,0,0.70)", color: "rgba(255,255,255,0.7)", backdropFilter: "blur(4px)" }}>
          <Clock size={9} />
          {formatDuration(video.duration)}
        </div>
      </div>

      {/* ── Play button (idle) ── */}
      <AnimatePresence>
        {!hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          >
            <div className="w-11 h-11 rounded-full flex items-center justify-center"
              style={{
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.20)",
                boxShadow: "0 0 14px rgba(0,255,65,0.16)",
                backdropFilter: "blur(6px)",
              }}>
              <Play size={17} className="ml-0.5" fill="white" style={{ color: "white" }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom info bar (idle) ── */}
      <AnimatePresence>
        {!hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-0 left-0 right-0 p-3 z-10 pointer-events-none"
          >
            {/* Caption */}
            <p className="text-[11px] leading-snug line-clamp-2 overflow-hidden mb-1.5"
              style={{ color: "rgba(255,255,255,0.62)" }}>
              {video.caption || displayName}
            </p>
            {/* Stats row */}
            <div className="flex items-center gap-3 text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>
              <span className="flex items-center gap-1">
                <Eye size={9} />{formatNumber(video.views)}
              </span>
              <span className="flex items-center gap-1">
                <Heart size={9} />{formatNumber(video.likes)}
              </span>
              <span className="flex items-center gap-1 ml-auto">
                <HardDrive size={9} />{formatBytes(video.file_size)}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hover overlay: action buttons ── */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 flex flex-col justify-between p-3.5 z-20"
            style={{ background: "rgba(0,0,0,0.84)", backdropFilter: "blur(4px)" }}
          >
            {/* Top: filename + added date */}
            <div className="space-y-0.5">
              <p className="text-xs font-semibold truncate" style={{ color: "rgba(255,255,255,0.8)" }}>
                {displayName}
              </p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>
                {timeAgo(video.created_at)}
              </p>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              {/* Postar agora */}
              <motion.button
                onClick={() => onPost(video)}
                whileTap={{ scale: 0.95 }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                style={{
                  background: "rgba(0,255,65,0.1)",
                  border: "0.5px solid rgba(0,255,65,0.3)",
                  color: "rgba(0,255,65,0.9)",
                  boxShadow: "0 0 12px rgba(0,255,65,0.1)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,255,65,0.18)";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(0,255,65,0.2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,255,65,0.1)";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 12px rgba(0,255,65,0.1)";
                }}
              >
                <Send size={13} />
                Postar agora
              </motion.button>

              {/* Agendar + Mover */}
              <div className="grid grid-cols-2 gap-2">
                <motion.button
                  onClick={() => onSchedule(video)}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all duration-200"
                  style={{
                    border: "0.5px solid rgba(0,229,255,0.2)",
                    background: "rgba(0,229,255,0.06)",
                    color: "rgba(0,229,255,0.75)",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,229,255,0.12)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,229,255,0.06)"; }}
                >
                  <CalendarClock size={11} />
                  Agendar
                </motion.button>

                <motion.button
                  onClick={() => onMove?.(video)}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all duration-200"
                  style={{
                    border: "0.5px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.04)",
                    color: "rgba(255,255,255,0.45)",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.09)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}
                >
                  <FolderInput size={11} />
                  Mover
                </motion.button>
              </div>

              {/* Excluir */}
              <motion.button
                onClick={handleDelete}
                whileTap={{ scale: 0.95 }}
                disabled={deleting}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50"
                style={{
                  border: "0.5px solid rgba(255,59,48,0.25)",
                  background: "rgba(255,59,48,0.07)",
                  color: "rgba(255,100,90,0.85)",
                }}
                onMouseEnter={(e) => { if (!deleting) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,59,48,0.14)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,59,48,0.07)"; }}
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {deleting ? "Excluindo..." : "Excluir"}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
