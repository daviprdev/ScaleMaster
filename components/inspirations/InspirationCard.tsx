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
  Film,
} from "lucide-react";

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
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

export function InspirationCard({ reel, onProcess }: InspirationCardProps) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [processState, setProcessState] = useState<ProcessState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleProcess = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (processState !== "idle" && processState !== "error") return;

    setProcessState("downloading");
    setErrorMsg("");

    const downloadTimer = setTimeout(() => setProcessState("processing"), 1500);

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

  const busy = processState === "downloading" || processState === "processing";
  const hasThumbnail = !!reel.thumbnailUrl && !imgError;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.22 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative rounded-2xl overflow-hidden cursor-pointer ticks"
      style={{
        aspectRatio: "9/16",
        border: "0.5px solid rgba(255,255,255,0.08)",
        transition: "border-color 0.3s, box-shadow 0.3s",
        ...(hovered ? {
          borderColor: "rgba(0,255,65,0.35)",
          boxShadow: "0 0 0 0.5px rgba(0,229,255,0.12), 0 8px 32px rgba(0,255,65,0.14)",
        } : {}),
      }}
    >
      {/* ── Background: thumbnail or gradient fallback ── */}
      {hasThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/proxy-image?url=${encodeURIComponent(reel.thumbnailUrl!)}`}
          alt={reel.caption || `Reel de @${reel.owner}`}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        /* Gradient fallback with matrix accent */
        <div className="absolute inset-0 flex items-center justify-center"
          style={{ background: "linear-gradient(160deg, rgba(0,255,65,0.08) 0%, rgba(0,0,0,0.6) 50%, rgba(0,229,255,0.06) 100%)" }}>
          <Film size={28} style={{ color: "rgba(0,255,65,0.2)" }} />
        </div>
      )}

      {/* ── Persistent bottom-to-top dark gradient ── */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.18) 70%, transparent 100%)" }} />

      {/* ── Owner + Duration badges (top) ── */}
      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10 pointer-events-none">
        <div className="px-2 py-0.5 rounded-full text-[10px] font-medium truncate max-w-[55%]"
          style={{ background: "rgba(0,0,0,0.70)", color: "rgba(255,255,255,0.6)", backdropFilter: "blur(4px)" }}>
          @{reel.owner}
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
          style={{ background: "rgba(0,0,0,0.70)", color: "rgba(255,255,255,0.75)", backdropFilter: "blur(4px)" }}>
          <Clock size={9} />
          {fmtDur(reel.duration)}
        </div>
      </div>

      {/* ── Play button (idle state) ── */}
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
                border: "1px solid rgba(255,255,255,0.22)",
                boxShadow: "0 0 14px rgba(0,255,65,0.18)",
                backdropFilter: "blur(6px)",
              }}>
              <Play size={17} className="ml-0.5" fill="white" style={{ color: "white" }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Caption bar (idle state, bottom) ── */}
      <AnimatePresence>
        {!hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-0 left-0 right-0 p-3 z-10 pointer-events-none"
          >
            <p className="text-[11px] leading-snug line-clamp-2 overflow-hidden"
              style={{ color: "rgba(255,255,255,0.65)" }}>
              {reel.caption || `Reel de @${reel.owner}`}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hover overlay ── */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 flex flex-col justify-between p-3.5 z-20"
            style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(4px)" }}
          >
            {/* Metrics */}
            <div className="space-y-2">
              <StatRow icon={Eye} value={fmt(reel.views)} label="Views" accent="electric" />
              <StatRow icon={Heart} value={fmt(reel.likes)} label="Curtidas" accent="matrix" />
              <StatRow icon={MessageCircle} value={fmt(reel.comments)} label="Comentários" accent="muted" />
            </div>

            {/* Caption + CTA */}
            <div className="space-y-2.5">
              <p className="text-[11px] line-clamp-3 leading-relaxed overflow-hidden"
                style={{ color: "rgba(255,255,255,0.5)" }}>
                {reel.caption || `Reel de @${reel.owner}`}
              </p>

              {processState === "error" && (
                <p className="text-[10px] flex items-center gap-1" style={{ color: "rgba(255,100,90,0.9)" }}>
                  <AlertCircle size={10} />{errorMsg || "Erro ao processar"}
                </p>
              )}

              <motion.button
                onClick={handleProcess}
                whileTap={busy ? {} : { scale: 0.96 }}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all duration-200"
                style={
                  processState === "done" ? {
                    background: "rgba(0,255,65,0.1)",
                    border: "0.5px solid rgba(0,255,65,0.35)",
                    color: "rgba(0,255,65,0.9)",
                  } : processState === "error" ? {
                    background: "rgba(255,59,48,0.08)",
                    border: "0.5px solid rgba(255,59,48,0.3)",
                    color: "rgba(255,100,90,0.9)",
                  } : busy ? {
                    background: "rgba(255,255,255,0.04)",
                    border: "0.5px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.35)",
                    cursor: "not-allowed",
                  } : {
                    background: "rgba(0,255,65,0.1)",
                    border: "0.5px solid rgba(0,255,65,0.3)",
                    color: "rgba(0,255,65,0.9)",
                    boxShadow: "0 0 14px rgba(0,255,65,0.12)",
                  }
                }
                onMouseEnter={(e) => {
                  if (!busy && processState === "idle") {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,255,65,0.18)";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 22px rgba(0,255,65,0.22)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!busy && processState === "idle") {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,255,65,0.1)";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 14px rgba(0,255,65,0.12)";
                  }
                }}
              >
                {processState === "downloading" && <><Loader2 size={13} className="animate-spin" />Baixando...</>}
                {processState === "processing" && <><Loader2 size={13} className="animate-spin" />Processando...</>}
                {processState === "done" && <><CheckCircle2 size={13} />Salvo na biblioteca</>}
                {processState === "error" && <><Download size={13} />Tentar novamente</>}
                {processState === "idle" && <><Download size={13} />Adicionar à Biblioteca</>}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StatRow({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: React.ElementType;
  value: string;
  label: string;
  accent: "matrix" | "electric" | "muted";
}) {
  const styles = {
    matrix:   { icon: "rgba(0,255,65,0.85)",  bg: "rgba(0,255,65,0.08)",  val: "rgba(0,255,65,0.9)"  },
    electric: { icon: "rgba(0,229,255,0.85)", bg: "rgba(0,229,255,0.08)", val: "rgba(0,229,255,0.9)" },
    muted:    { icon: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.04)", val: "rgba(255,255,255,0.8)" },
  }[accent];

  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: styles.bg }}>
        <Icon size={13} style={{ color: styles.icon }} />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] leading-none" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</p>
        <p className="text-sm font-bold leading-snug" style={{ color: styles.val }}>{value}</p>
      </div>
    </div>
  );
}
