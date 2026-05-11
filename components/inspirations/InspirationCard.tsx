"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  Eye,
  Heart,
  MessageCircle,
  Play,
  Clock,
  Download,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface InspirationReel {
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

type ProcessState = "idle" | "downloading" | "processing" | "done" | "error";

interface InspirationCardProps {
  reel: InspirationReel;
  onProcess: (reel: InspirationReel) => Promise<void>;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function InspirationCard({ reel, onProcess }: InspirationCardProps) {
  const [hovered, setHovered] = useState(false);
  const [processState, setProcessState] = useState<ProcessState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleProcess = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (processState !== "idle" && processState !== "error") return;

    setProcessState("downloading");
    setErrorMsg("");

    // Simula fase de download antes do FFmpeg reportar progresso
    const downloadTimer = setTimeout(() => {
      setProcessState("processing");
    }, 1500);

    try {
      await onProcess(reel);
      clearTimeout(downloadTimer);
      setProcessState("done");
      setTimeout(() => setProcessState("idle"), 4000);
    } catch (err) {
      clearTimeout(downloadTimer);
      setErrorMsg(err instanceof Error ? err.message : "Erro ao processar");
      setProcessState("error");
    }
  };

  const gradient = reel.gradient ?? "from-violet-600 to-purple-800";
  const busy = processState === "downloading" || processState === "processing";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.22 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative rounded-2xl overflow-hidden cursor-pointer
        border border-white/[0.07] hover:border-violet-500/30
        transition-colors duration-300
        hover:shadow-[0_8px_32px_rgba(139,92,246,0.22)]"
      style={{ aspectRatio: "9/16" }}
    >
      {/* Thumbnail / gradient placeholder */}
      {reel.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reel.thumbnailUrl}
          alt={reel.caption}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className={cn("absolute inset-0 bg-gradient-to-br", gradient)} />
      )}

      {/* Persistent dark gradient at bottom */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />

      {/* Play icon — visible when not hovered */}
      <AnimatePresence>
        {!hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
              <Play size={18} className="text-white ml-0.5" fill="white" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Duration badge */}
      <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-[10px] text-white/80 font-medium">
        <Clock size={9} />
        {fmtDur(reel.duration)}
      </div>

      {/* Owner badge */}
      <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-[10px] text-white/60 font-medium max-w-[45%] truncate">
        @{reel.owner}
      </div>

      {/* Hover overlay */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-[3px] flex flex-col justify-between p-4"
          >
            {/* Metrics */}
            <div className="space-y-2">
              <Metric icon={Eye} value={fmt(reel.views)} label="Views" color="cyan" />
              <Metric icon={Heart} value={fmt(reel.likes)} label="Curtidas" color="pink" />
              <Metric icon={MessageCircle} value={fmt(reel.comments)} label="Comentários" color="violet" />
            </div>

            {/* Caption + CTA */}
            <div className="space-y-3">
              <p className="text-[11px] text-white/55 line-clamp-3 leading-relaxed">
                {reel.caption || `Reel de @${reel.owner}`}
              </p>

              {/* Error message */}
              {processState === "error" && (
                <p className="text-[10px] text-red-400 flex items-center gap-1">
                  <AlertCircle size={10} />
                  {errorMsg || "Erro ao processar"}
                </p>
              )}

              <motion.button
                onClick={handleProcess}
                whileTap={busy ? {} : { scale: 0.96 }}
                disabled={busy}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200",
                  processState === "done"
                    ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400"
                    : processState === "error"
                    ? "bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                    : busy
                    ? "bg-white/5 border border-white/10 text-white/50 cursor-not-allowed"
                    : "bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white hover:shadow-[0_0_18px_rgba(139,92,246,0.45)]"
                )}
              >
                {processState === "downloading" && (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Baixando...
                  </>
                )}
                {processState === "processing" && (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Processando...
                  </>
                )}
                {processState === "done" && (
                  <>
                    <CheckCircle2 size={14} />
                    Salvo na biblioteca
                  </>
                )}
                {processState === "error" && (
                  <>
                    <Download size={14} />
                    Tentar novamente
                  </>
                )}
                {processState === "idle" && (
                  <>
                    <Download size={14} />
                    Preparar Download
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Caption bar — visible when not hovered */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <AnimatePresence>
          {!hovered && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="text-[11px] text-white/65 line-clamp-2 leading-tight"
            >
              {reel.caption || `Reel de @${reel.owner}`}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Metric({
  icon: Icon,
  value,
  label,
  color,
}: {
  icon: React.ElementType;
  value: string;
  label: string;
  color: "cyan" | "pink" | "violet";
}) {
  const colorMap = {
    cyan: "text-cyan-400 bg-cyan-400/10",
    pink: "text-pink-400 bg-pink-400/10",
    violet: "text-violet-400 bg-violet-400/10",
  };

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
          colorMap[color]
        )}
      >
        <Icon size={14} />
      </div>
      <div>
        <p className="text-[10px] text-white/35 leading-none">{label}</p>
        <p className="text-sm font-bold text-white leading-snug">{value}</p>
      </div>
    </div>
  );
}
