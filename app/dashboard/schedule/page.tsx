"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarClock,
  Play,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Clock,
  AlignLeft,
  Send,
  FolderOpen,
} from "lucide-react";
import {
  AccountSelector,
  type InstagramAccount,
} from "@/components/schedule/AccountSelector";
import type { LibraryVideo } from "@/components/library/VideoCard";
import { cn } from "@/lib/utils";

// ── Contas mock para desenvolvimento ─────────────────────────
const MOCK_ACCOUNTS: InstagramAccount[] = [
  {
    id: "acc_1",
    username: "minha_marca",
    display_name: "Minha Marca Oficial",
    avatar_color: "bg-gradient-to-br from-violet-500 to-purple-600",
    followers: 12400,
    is_active: true,
  },
  {
    id: "acc_2",
    username: "loja_oficial",
    display_name: "Loja Oficial",
    avatar_color: "bg-gradient-to-br from-pink-500 to-rose-600",
    followers: 8900,
    is_active: true,
  },
  {
    id: "acc_3",
    username: "canal_conteudo",
    display_name: "Canal de Conteúdo",
    avatar_color: "bg-gradient-to-br from-cyan-500 to-blue-600",
    followers: 31200,
    is_active: false,
  },
];

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

// ── Stepper ───────────────────────────────────────────────────
const STEPS = ["Vídeo", "Contas", "Detalhes", "Confirmar"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300",
                i < current
                  ? "bg-violet-600 border-violet-600 text-white"
                  : i === current
                  ? "bg-violet-600/20 border-violet-500 text-violet-300"
                  : "bg-white/[0.04] border-white/10 text-white/25"
              )}
            >
              {i < current ? <CheckCircle2 size={14} /> : i + 1}
            </div>
            <span
              className={cn(
                "text-[10px] font-medium whitespace-nowrap",
                i === current ? "text-violet-300" : "text-white/25"
              )}
            >
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                "w-12 h-px mb-4 mx-1 transition-all duration-500",
                i < current ? "bg-violet-600" : "bg-white/10"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Mini VideoCard para seleção ───────────────────────────────
function MiniVideoCard({
  video,
  selected,
  onClick,
}: {
  video: LibraryVideo;
  selected: boolean;
  onClick: () => void;
}) {
  const gradient = video.gradient ?? "from-violet-600 to-purple-800";
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "relative rounded-xl overflow-hidden border-2 transition-all duration-200 text-left",
        selected
          ? "border-violet-500 shadow-[0_0_15px_rgba(139,92,246,0.4)]"
          : "border-white/[0.07] hover:border-white/20"
      )}
    >
      <div
        className={cn("aspect-video bg-gradient-to-br", gradient)}
      />
      {selected && (
        <div className="absolute inset-0 bg-violet-600/20 flex items-center justify-center">
          <CheckCircle2 size={24} className="text-violet-300" />
        </div>
      )}
      {/* Duration */}
      <div className="absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-black/60 text-white/70 flex items-center gap-0.5">
        <Clock size={8} />
        {formatDuration(video.duration)}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80">
        <p className="text-[10px] text-white/70 truncate">
          @{video.owner_username ?? "desconhecido"}
        </p>
      </div>
    </motion.button>
  );
}

// ── Componente principal ──────────────────────────────────────
function SchedulePageInner() {
  const searchParams = useSearchParams();
  const preselectedVideoId = searchParams.get("videoId");

  const [step, setStep] = useState(0);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(
    preselectedVideoId
  );
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const fetchVideos = useCallback(async () => {
    setLoadingVideos(true);
    try {
      const res = await fetch("/api/library");
      const data = await res.json();
      setVideos(data.videos ?? []);
    } finally {
      setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // Se veio com ?videoId, pula direto para o passo de contas
  useEffect(() => {
    if (preselectedVideoId && !loadingVideos) {
      setStep(1);
    }
  }, [preselectedVideoId, loadingVideos]);

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) ?? null;

  const canNext = [
    !!selectedVideoId,
    selectedAccounts.length > 0,
    !!scheduledAt,
    true,
  ][step];

  const handleSubmit = async () => {
    if (!selectedVideoId || !selectedAccounts.length) return;
    setSubmitting(true);
    try {
      await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: selectedVideoId,
          account_ids: selectedAccounts,
          caption,
          scheduled_at: new Date(scheduledAt).toISOString(),
        }),
      });
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Tela de sucesso ───────────────────────────────────────
  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-24 gap-6 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", bounce: 0.5, delay: 0.1 }}
          className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center"
        >
          <CheckCircle2 size={36} className="text-emerald-400" />
        </motion.div>
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">
            Postagem agendada!
          </h2>
          <p className="text-white/40 text-sm max-w-sm">
            Agendada para{" "}
            <span className="text-violet-300">
              {selectedAccounts.length} conta
              {selectedAccounts.length > 1 ? "s" : ""}
            </span>{" "}
            em {new Date(scheduledAt).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setDone(false);
              setStep(0);
              setSelectedVideoId(null);
              setSelectedAccounts([]);
              setCaption("");
            }}
            className="btn-ghost text-sm px-6 py-2.5"
          >
            Novo agendamento
          </button>
          <a href="/dashboard" className="btn-primary text-sm px-6 py-2.5">
            Ir para o Dashboard
          </a>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Stepper */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-5 flex justify-center"
      >
        <StepIndicator current={step} />
      </motion.div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        {/* ── Step 0: Escolher vídeo ─────────────────────── */}
        {step === 0 && (
          <motion.div
            key="step-0"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card p-5 space-y-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <Play size={16} className="text-violet-400" />
              <h2 className="font-semibold text-white/80">
                Escolha o vídeo da Biblioteca
              </h2>
            </div>

            {loadingVideos ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-video rounded-xl bg-white/[0.04] animate-pulse" />
                ))}
              </div>
            ) : videos.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <FolderOpen size={32} className="text-white/15" />
                <p className="text-white/30 text-sm">
                  Biblioteca vazia. Baixe Reels primeiro na página de Pesquisa.
                </p>
                <a href="/dashboard/search" className="btn-primary text-sm px-5 py-2">
                  Ir para Pesquisa
                </a>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {videos.map((video) => (
                  <MiniVideoCard
                    key={video.id}
                    video={video}
                    selected={selectedVideoId === video.id}
                    onClick={() => setSelectedVideoId(video.id)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Step 1: Selecionar contas ──────────────────── */}
        {step === 1 && (
          <motion.div
            key="step-1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
          >
            {/* Vídeo selecionado (preview) */}
            {selectedVideo && (
              <div className="glass-card p-4 space-y-3">
                <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">
                  Vídeo selecionado
                </p>
                <div
                  className={cn(
                    "w-full aspect-video rounded-xl bg-gradient-to-br",
                    selectedVideo.gradient ?? "from-violet-600 to-purple-800"
                  )}
                />
                <p className="text-xs text-white/60 truncate">
                  @{selectedVideo.owner_username}
                </p>
              </div>
            )}

            {/* Account selector */}
            <div className="glass-card p-5">
              <AccountSelector
                accounts={MOCK_ACCOUNTS}
                selected={selectedAccounts}
                onChange={setSelectedAccounts}
              />
            </div>
          </motion.div>
        )}

        {/* ── Step 2: Detalhes (legenda + data) ─────────── */}
        {step === 2 && (
          <motion.div
            key="step-2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card p-5 space-y-5"
          >
            {/* Caption */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-semibold text-white/60 mb-2">
                <AlignLeft size={14} />
                Legenda
              </label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Escreva a legenda do post (opcional)..."
                rows={5}
                className="input-glass w-full resize-none text-sm leading-relaxed"
              />
              <p className="text-[10px] text-white/20 mt-1 text-right">
                {caption.length} / 2200 caracteres
              </p>
            </div>

            {/* Date & time */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-semibold text-white/60 mb-2">
                <Clock size={14} />
                Data e horário de publicação
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="input-glass w-full sm:w-64 text-sm [color-scheme:dark]"
              />
            </div>
          </motion.div>
        )}

        {/* ── Step 3: Confirmação ────────────────────────── */}
        {step === 3 && (
          <motion.div
            key="step-3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card p-6 space-y-5"
          >
            <h2 className="font-semibold text-white/80">
              Confirmar agendamento
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Video summary */}
              <div className="space-y-2">
                <p className="text-xs text-white/30 uppercase tracking-widest font-semibold">
                  Vídeo
                </p>
                {selectedVideo && (
                  <div className="flex gap-3 items-center">
                    <div
                      className={cn(
                        "w-16 aspect-video rounded-lg bg-gradient-to-br flex-shrink-0",
                        selectedVideo.gradient ?? "from-violet-600 to-purple-800"
                      )}
                    />
                    <div>
                      <p className="text-sm text-white/70 truncate">
                        @{selectedVideo.owner_username}
                      </p>
                      <p className="text-xs text-white/30">
                        {formatDuration(selectedVideo.duration)}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Accounts summary */}
              <div className="space-y-2">
                <p className="text-xs text-white/30 uppercase tracking-widest font-semibold">
                  Contas ({selectedAccounts.length})
                </p>
                <div className="space-y-1">
                  {MOCK_ACCOUNTS.filter((a) =>
                    selectedAccounts.includes(a.id)
                  ).map((a) => (
                    <div key={a.id} className="flex items-center gap-2 text-sm text-white/60">
                      <div className={cn("w-5 h-5 rounded-full", a.avatar_color)} />
                      @{a.username}
                    </div>
                  ))}
                </div>
              </div>

              {/* Date summary */}
              <div className="space-y-1">
                <p className="text-xs text-white/30 uppercase tracking-widest font-semibold">
                  Publicação
                </p>
                <p className="text-sm text-white/70 flex items-center gap-1.5">
                  <CalendarClock size={14} className="text-violet-400" />
                  {new Date(scheduledAt).toLocaleString("pt-BR", {
                    dateStyle: "full",
                    timeStyle: "short",
                  })}
                </p>
              </div>

              {/* Caption summary */}
              {caption && (
                <div className="space-y-1">
                  <p className="text-xs text-white/30 uppercase tracking-widest font-semibold">
                    Legenda
                  </p>
                  <p className="text-sm text-white/50 line-clamp-3 leading-relaxed">
                    {caption}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation buttons */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-between"
      >
        <button
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
          className="btn-ghost flex items-center gap-1.5 text-sm px-5 py-2.5 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowLeft size={15} />
          Voltar
        </button>

        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext}
            className="btn-primary flex items-center gap-1.5 text-sm px-6 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Próximo
            <ArrowRight size={15} />
          </button>
        ) : (
          <motion.button
            onClick={handleSubmit}
            disabled={submitting}
            whileTap={{ scale: 0.97 }}
            className="btn-primary flex items-center gap-2 px-8 py-3 text-sm disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Agendando...
              </>
            ) : (
              <>
                <Send size={15} />
                Agendar postagem
              </>
            )}
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}

// Wrapper com Suspense (necessário por causa de useSearchParams)
export default function SchedulePage() {
  return (
    <Suspense>
      <SchedulePageInner />
    </Suspense>
  );
}
