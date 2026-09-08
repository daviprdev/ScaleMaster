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
  Lock,
  RefreshCw,
  FileText,
  FolderPlus,
} from "lucide-react";

export interface InspirationReel {
  id: string;
  shortCode: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  /** Legenda para exibição ("" quando não há). */
  caption: string;
  /** Forma crua: null = o Apify não trouxe o campo; "" = Reel sem legenda. */
  originalCaption?: string | null;
  /** Permalink da publicação original. */
  sourceUrl?: string | null;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string;
  gradient?: string;
}

type ProcessState = "idle" | "downloading" | "done" | "error";
type RefetchState = "idle" | "loading" | "error";

interface InspirationCardProps {
  reel: InspirationReel;
  onProcess: (reel: InspirationReel) => Promise<void>;
  onVideoUrlRecovered?: (id: string, videoUrl: string) => void;
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

export function InspirationCard({ reel, onProcess, onVideoUrlRecovered }: InspirationCardProps) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [processState, setProcessState] = useState<ProcessState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [refetchState, setRefetchState] = useState<RefetchState>("idle");
  const [refetchError, setRefetchError] = useState("");
  const [currentVideoUrl, setCurrentVideoUrl] = useState(reel.videoUrl);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  const temLegenda = typeof reel.caption === "string" && reel.caption !== "";

  const hasVideo = !!currentVideoUrl && currentVideoUrl !== "undefined";

  const isUrlExpiredError = (msg: string) =>
    msg.includes("expirada") || msg.includes("bloqueada") || msg.includes("403") || msg.includes("502");

  // Salvar na Biblioteca: leva o vídeo E a legenda original juntos. É o
  // caminho que faz `videos_library.caption` existir — sem ele, um Reel
  // raspado só entra na Biblioteca via download + upload manual, e aí a
  // legenda se perde no meio.
  const handleSaveToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (saveState === "saving" || saveState === "done") return;
    setSaveState("saving");
    setSaveError("");
    try {
      const res = await fetch("/api/inspirations/save-to-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reels: [{
            id: reel.id,
            shortCode: reel.shortCode,
            videoUrl: currentVideoUrl,
            caption: reel.caption,
            originalCaption: reel.originalCaption,
            sourceUrl: reel.sourceUrl,
            views: reel.views,
            likes: reel.likes,
            comments: reel.comments,
            duration: reel.duration,
            owner: reel.owner,
          }],
        }),
      });
      const data = await res.json() as { saved?: number; errors?: number; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao salvar.");
      if (!data.saved) throw new Error("O CDN recusou o vídeo. Refaça a busca.");
      setSaveState("done");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erro ao salvar.");
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 5000);
    }
  };

  const handleProcess = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (processState !== "idle" && processState !== "error") return;

    setProcessState("downloading");
    setErrorMsg("");

    try {
      await onProcess({ ...reel, videoUrl: currentVideoUrl });
      setProcessState("done");
      setTimeout(() => setProcessState("idle"), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro no download";
      setErrorMsg(msg);
      setProcessState("error");
    }
  };

  const handleRefetch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (refetchState === "loading" || !reel.shortCode) return;

    setRefetchState("loading");
    setRefetchError("");

    try {
      const text = await fetch("/api/inspirations/refetch-reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortCode: reel.shortCode }),
      }).then((r) => r.text());

      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch {
        throw new Error("Timeout ao re-buscar. Tente novamente.");
      }

      if (!data.videoUrl) throw new Error((data.error as string) || "URL não encontrada.");

      setCurrentVideoUrl(data.videoUrl as string);
      setRefetchState("idle");
      setProcessState("idle");
      setErrorMsg("");
      onVideoUrlRecovered?.(reel.id, data.videoUrl as string);
    } catch (err) {
      setRefetchError(err instanceof Error ? err.message : "Erro ao buscar URL.");
      setRefetchState("error");
    }
  };

  const busy = processState === "downloading";
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
        border: hasVideo
          ? "0.5px solid rgba(255,255,255,0.08)"
          : "0.5px solid rgba(255,180,0,0.25)",
        transition: "border-color 0.3s, box-shadow 0.3s",
        ...(hovered && hasVideo ? {
          borderColor: "rgba(0,255,65,0.35)",
          boxShadow: "0 0 0 0.5px rgba(0,229,255,0.12), 0 8px 32px rgba(0,255,65,0.14)",
        } : hovered && !hasVideo ? {
          borderColor: "rgba(255,200,0,0.45)",
          boxShadow: "0 0 0 0.5px rgba(255,180,0,0.15), 0 8px 24px rgba(255,150,0,0.12)",
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

      {/* ── Lock badge (no video URL) ── */}
      {!hasVideo && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center py-1.5 pointer-events-none"
          style={{ background: "rgba(200,120,0,0.75)", backdropFilter: "blur(4px)" }}>
          <Lock size={10} style={{ color: "rgba(255,220,100,0.95)" }} className="mr-1" />
          <span className="text-[10px] font-semibold tracking-wide" style={{ color: "rgba(255,220,100,0.95)" }}>
            URL não disponível
          </span>
        </div>
      )}

      {/* ── Owner + Duration badges (top) ── */}
      <div className={`absolute left-2.5 right-2.5 flex items-center justify-between z-10 pointer-events-none ${!hasVideo ? "top-8" : "top-2.5"}`}>
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
        {hovered && !hasVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 flex flex-col justify-between p-3.5 z-20"
            style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(4px)" }}
          >
            <div className="space-y-2">
              <StatRow icon={Eye} value={fmt(reel.views)} label="Views" accent="electric" />
              <StatRow icon={Heart} value={fmt(reel.likes)} label="Curtidas" accent="matrix" />
              <StatRow icon={MessageCircle} value={fmt(reel.comments)} label="Comentários" accent="muted" />
            </div>

            <div className="space-y-2.5">
              <p className="text-[11px] line-clamp-3 leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
                {reel.caption || `Reel de @${reel.owner}`}
              </p>

              {refetchState === "error" && (
                <p className="text-[10px] flex items-center gap-1" style={{ color: "rgba(255,160,60,0.9)" }}>
                  <AlertCircle size={10} />{refetchError}
                </p>
              )}

              <motion.button
                onClick={handleRefetch}
                whileTap={refetchState === "loading" ? {} : { scale: 0.96 }}
                disabled={refetchState === "loading"}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all duration-200"
                style={
                  refetchState === "loading" ? {
                    background: "rgba(255,180,0,0.06)",
                    border: "0.5px solid rgba(255,180,0,0.2)",
                    color: "rgba(255,180,0,0.4)",
                    cursor: "not-allowed",
                  } : {
                    background: "rgba(255,180,0,0.1)",
                    border: "0.5px solid rgba(255,180,0,0.35)",
                    color: "rgba(255,200,60,0.9)",
                    boxShadow: "0 0 14px rgba(255,150,0,0.1)",
                  }
                }
              >
                {refetchState === "loading"
                  ? <><Loader2 size={13} className="animate-spin" />Buscando URL...</>
                  : <><RefreshCw size={13} />Re-buscar URL do vídeo</>
                }
              </motion.button>
            </div>
          </motion.div>
        )}

        {hovered && hasVideo && (
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

              {/* Inline toast */}
              <AnimatePresence>
                {busy && (
                  <motion.div
                    key="toast-downloading"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px]"
                    style={{
                      background: "rgba(0,229,255,0.07)",
                      border: "0.5px solid rgba(0,229,255,0.2)",
                      color: "rgba(0,229,255,0.8)",
                    }}
                  >
                    <Loader2 size={10} className="animate-spin flex-shrink-0" />
                    Iniciando download…
                  </motion.div>
                )}
                {processState === "done" && (
                  <motion.div
                    key="toast-done"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px]"
                    style={{
                      background: "rgba(0,255,65,0.07)",
                      border: "0.5px solid rgba(0,255,65,0.2)",
                      color: "rgba(0,255,65,0.85)",
                    }}
                  >
                    <CheckCircle2 size={10} className="flex-shrink-0" />
                    Download iniciado!
                  </motion.div>
                )}
              </AnimatePresence>

              {processState === "error" && (
                <p className="text-[10px] flex items-center gap-1" style={{ color: "rgba(255,100,90,0.9)" }}>
                  <AlertCircle size={10} />{errorMsg || "Erro ao processar"}
                </p>
              )}

              {/* URL expired/blocked → show Re-buscar instead of retry */}
              {processState === "error" && isUrlExpiredError(errorMsg) ? (
                <>
                  {refetchState === "error" && (
                    <p className="text-[10px] flex items-center gap-1" style={{ color: "rgba(255,160,60,0.9)" }}>
                      <AlertCircle size={10} />{refetchError}
                    </p>
                  )}
                  <motion.button
                    onClick={handleRefetch}
                    whileTap={refetchState === "loading" ? {} : { scale: 0.96 }}
                    disabled={refetchState === "loading"}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all duration-200"
                    style={
                      refetchState === "loading" ? {
                        background: "rgba(255,180,0,0.06)",
                        border: "0.5px solid rgba(255,180,0,0.2)",
                        color: "rgba(255,180,0,0.4)",
                        cursor: "not-allowed",
                      } : {
                        background: "rgba(255,180,0,0.1)",
                        border: "0.5px solid rgba(255,180,0,0.35)",
                        color: "rgba(255,200,60,0.9)",
                        boxShadow: "0 0 14px rgba(255,150,0,0.1)",
                      }
                    }
                  >
                    {refetchState === "loading"
                      ? <><Loader2 size={13} className="animate-spin" />Buscando nova URL...</>
                      : <><RefreshCw size={13} />Re-buscar URL do vídeo</>
                    }
                  </motion.button>
                </>
              ) : (
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
                  {processState === "done" && <><CheckCircle2 size={13} />Download concluído!</>}
                  {processState === "error" && <><Download size={13} />Tentar novamente</>}
                  {processState === "idle" && <><Download size={13} />Baixar vídeo</>}
                </motion.button>
              )}

              {hasVideo && (
                <button
                  type="button"
                  onClick={handleSaveToLibrary}
                  disabled={saveState === "saving" || saveState === "done"}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-70"
                  style={{
                    background: "rgba(0,229,255,0.08)",
                    border: "1px solid rgba(0,229,255,0.22)",
                    color: "rgba(0,229,255,0.9)",
                  }}
                >
                  {saveState === "saving" && <><Loader2 size={12} className="animate-spin" />Salvando...</>}
                  {saveState === "done" && <><CheckCircle2 size={12} />Na Biblioteca</>}
                  {saveState === "error" && <><AlertCircle size={12} />Tentar de novo</>}
                  {saveState === "idle" && <><FolderPlus size={12} />Salvar na Biblioteca</>}
                </button>
              )}

              {saveState === "error" && saveError && (
                <p className="text-[10px]" style={{ color: "rgba(255,120,120,0.9)" }}>{saveError}</p>
              )}

              {temLegenda && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setCaptionOpen(v => !v); }}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium text-white/40 hover:text-white/70 transition-colors"
                >
                  <FileText size={11} />{captionOpen ? "Ocultar legenda" : "Ver legenda"}
                </button>
              )}

              <AnimatePresence>
                {captionOpen && temLegenda && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    {/* Conteúdo externo: só texto. Nunca dangerouslySetInnerHTML. */}
                    <p className="max-h-28 overflow-y-auto text-[10px] leading-relaxed whitespace-pre-wrap break-words px-2 py-2 rounded-lg"
                      style={{ color: "rgba(255,255,255,0.6)", background: "rgba(0,0,0,0.5)" }}>
                      {reel.caption}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
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
