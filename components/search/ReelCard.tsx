"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  Download,
  Eye,
  Heart,
  MessageCircle,
  Play,
  Clock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Reel {
  id: string;
  shortCode: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string;
  gradient?: string;
}

interface ReelCardProps {
  reel: Reel;
  onDownload: (reel: Reel) => Promise<void>;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function ReelCard({ reel, onDownload }: ReelCardProps) {
  const [hovered, setHovered] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading || downloaded) return;
    setDownloading(true);
    try {
      await onDownload(reel);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 3000);
    } finally {
      setDownloading(false);
    }
  };

  const gradient = reel.gradient ?? "from-[#00498D] to-[#00346D]";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.25 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative rounded-2xl overflow-hidden cursor-pointer group
        border border-white/[0.07] hover:border-white/20
        transition-all duration-300
        hover:shadow-[0_8px_30px_rgba(139,92,246,0.2)]"
      style={{ aspectRatio: "9/16" }}
    >
      {/* Thumbnail / Gradient placeholder */}
      {reel.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/proxy-image?url=${encodeURIComponent(reel.thumbnailUrl)}`}
          alt={reel.caption}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div
          className={cn(
            "absolute inset-0 bg-gradient-to-br",
            gradient
          )}
        />
      )}

      {/* Base dark gradient (bottom) */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />

      {/* Play icon (default visible) */}
      <AnimatePresence>
        {!hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
              <Play size={20} className="text-white ml-0.5" fill="white" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Duration badge */}
      <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-[10px] text-white/80">
        <Clock size={9} />
        {formatDuration(reel.duration)}
      </div>

      {/* Hover overlay — metrics */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/75 backdrop-blur-[2px] flex flex-col justify-between p-4"
          >
            {/* Metrics */}
            <div className="space-y-2.5">
              <MetricRow
                icon={Eye}
                label="Views"
                value={formatNumber(reel.views)}
                color="text-[#85B9E9]"
              />
              <MetricRow
                icon={Heart}
                label="Curtidas"
                value={formatNumber(reel.likes)}
                color="text-pink-400"
              />
              <MetricRow
                icon={MessageCircle}
                label="Comentários"
                value={formatNumber(reel.comments)}
                color="text-[#85B9E9]"
              />
            </div>

            {/* Caption */}
            <div className="space-y-3">
              <p className="text-[11px] text-white/60 line-clamp-3 leading-relaxed">
                {reel.caption || "Sem legenda"}
              </p>

              {/* Download button */}
              <motion.button
                onClick={handleDownload}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200",
                  downloaded
                    ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400"
                    : "bg-gradient-to-r from-[#00498D] to-[#85B9E9] hover:from-[#075BA6] hover:to-[#85B9E9] text-white hover:shadow-[0_0_15px_rgba(0,73,141,0.4)]"
                )}
              >
                {downloading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Baixando...
                  </>
                ) : downloaded ? (
                  <>✓ Salvo na biblioteca</>
                ) : (
                  <>
                    <Download size={14} />
                    Baixar (Limpar Metadados)
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom bar — always visible */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <AnimatePresence>
          {!hovered && (
            <motion.p
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="text-[11px] text-white/70 line-clamp-2 leading-tight"
            >
              {reel.caption || `Reel de @${reel.owner}`}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function MetricRow({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0",
          color
        )}
      >
        <Icon size={15} />
      </div>
      <div>
        <p className="text-xs text-white/40 leading-none">{label}</p>
        <p className="text-base font-bold text-white leading-tight">{value}</p>
      </div>
    </div>
  );
}
