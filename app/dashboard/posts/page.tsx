"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarRange,
  Check,
  CheckCircle2,
  Clock,
  Instagram,
  Layers,
  Loader2,
  Play,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ── Tipos ─────────────────────────────────────────────────────
interface Video {
  id: string;
  filename: string;
  public_url: string;
  owner_username: string | null;
  caption: string | null;
  duration: number | null;
  views: number;
  created_at: string;
}

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  followers_count: number | null;
}

// ── Helpers ───────────────────────────────────────────────────
const GRADIENTS = [
  "from-[#00498D] to-[#00346D]",
  "from-[#85B9E9] to-[#00498D]",
  "from-pink-500 to-rose-700",
  "from-emerald-500 to-teal-700",
  "from-amber-500 to-orange-700",
  "from-[#00346D] to-[#00498D]",
  "from-red-500 to-pink-700",
  "from-teal-500 to-cyan-700",
  "from-fuchsia-500 to-purple-700",
  "from-lime-500 to-green-700",
];

const AVATAR_COLORS = [
  "from-[#00498D] to-[#00346D]",
  "from-pink-500 to-rose-600",
  "from-[#85B9E9] to-[#00498D]",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-fuchsia-500 to-purple-600",
];

function strHash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return Math.abs(h);
}

function videoGradient(id: string) { return GRADIENTS[strHash(id) % GRADIENTS.length]; }
function avatarColor(u: string) { return AVATAR_COLORS[strHash(u) % AVATAR_COLORS.length]; }

function formatDuration(s: number | null): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatNumber(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function defaultDatetime(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString().slice(0, 16);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ── Componentes auxiliares ────────────────────────────────────
function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={cn(
      "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 transition-colors",
      done ? "bg-[#00498D] text-white" : "bg-line-control/20 text-ink-3"
    )}>
      {done ? <Check size={11} /> : n}
    </span>
  );
}

function SectionCard({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-card rounded-2xl p-5"
    >
      {children}
    </motion.div>
  );
}

// ── Skeleton loaders ──────────────────────────────────────────
function VideosSkeleton() {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="aspect-[9/16] rounded-xl bg-surface-raised animate-pulse" />
      ))}
    </div>
  );
}

function AccountsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-14 rounded-xl bg-surface-raised animate-pulse" />
      ))}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────
export default function PostsPage() {
  const supabase = useMemo(() => createClient(), []);

  // Dados
  const [videos, setVideos] = useState<Video[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // Seleções
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());

  // Legendas
  const [captions, setCaptions] = useState<string[]>([""]);

  // Config de lote
  const [startDatetime, setStartDatetime] = useState(defaultDatetime);
  const [videosPerBatch, setVideosPerBatch] = useState(3);
  const [intervalHours, setIntervalHours] = useState(3);

  // Estado de ação
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{
    count: number;
    batches: number;
    endDate: string | null;
  } | null>(null);

  // ── Fetch ─────────────────────────────────────────────────
  const fetchVideos = useCallback(async () => {
    setLoadingVideos(true);
    try {
      const { data } = await supabase
        .from("videos_library")
        .select("id, filename, public_url, owner_username, caption, duration, views, created_at")
        .order("created_at", { ascending: false });
      setVideos((data ?? []) as unknown as Video[]);
    } finally {
      setLoadingVideos(false);
    }
  }, [supabase]);

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, username, display_name, avatar_url, is_active, followers_count")
        .eq("is_active", true)
        .order("connected_at", { ascending: false });
      setAccounts((data ?? []) as unknown as Account[]);
    } finally {
      setLoadingAccounts(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchVideos();
    fetchAccounts();
  }, [fetchVideos, fetchAccounts]);

  // ── Seleção de vídeos ─────────────────────────────────────
  const toggleVideo = (id: string) =>
    setSelectedVideoIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAllVideos = () => setSelectedVideoIds(new Set(videos.map(v => v.id)));
  const clearVideos = () => setSelectedVideoIds(new Set());

  // ── Seleção de contas ─────────────────────────────────────
  const toggleAccount = (id: string) =>
    setSelectedAccountIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAllAccounts = () => setSelectedAccountIds(new Set(accounts.map(a => a.id)));
  const clearAccounts = () => setSelectedAccountIds(new Set());

  // ── Legendas ──────────────────────────────────────────────
  const addCaption = () => setCaptions(prev => [...prev, ""]);
  const removeCaption = (i: number) => setCaptions(prev => prev.filter((_, idx) => idx !== i));
  const updateCaption = (i: number, val: string) =>
    setCaptions(prev => prev.map((c, idx) => (idx === i ? val : c)));

  // ── Cálculo do preview ────────────────────────────────────
  const totalPosts = selectedVideoIds.size * selectedAccountIds.size;
  const batchesPerAccount =
    selectedVideoIds.size > 0
      ? Math.ceil(selectedVideoIds.size / Math.max(1, videosPerBatch))
      : 0;
  const endDate =
    startDatetime && batchesPerAccount > 1
      ? new Date(
          new Date(startDatetime).getTime() +
            (batchesPerAccount - 1) * intervalHours * 3_600_000
        )
      : null;

  const canSchedule =
    selectedVideoIds.size > 0 &&
    selectedAccountIds.size > 0 &&
    captions.some(c => c.trim()) &&
    !!startDatetime &&
    !scheduling;

  // ── Agendar ───────────────────────────────────────────────
  const handleSchedule = async () => {
    if (!canSchedule) return;
    setError("");
    setScheduling(true);
    try {
      const res = await fetch("/api/posts/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_ids: [...selectedVideoIds],
          account_ids: [...selectedAccountIds],
          captions: captions.filter(c => c.trim()),
          start_datetime: new Date(startDatetime).toISOString(),
          videos_per_batch: Math.max(1, videosPerBatch),
          interval_hours: Math.max(0, intervalHours),
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string; count?: number };
      if (!res.ok || !data.success) {
        setError(data.error ?? "Erro ao agendar posts.");
        return;
      }
      setSuccess({
        count: data.count ?? totalPosts,
        batches: batchesPerAccount,
        endDate: endDate ? fmtDate(endDate) : null,
      });
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setScheduling(false);
    }
  };

  const resetForm = () => {
    setSelectedVideoIds(new Set());
    setSelectedAccountIds(new Set());
    setCaptions([""]);
    setStartDatetime(defaultDatetime());
    setVideosPerBatch(3);
    setIntervalHours(3);
    setSuccess(null);
    setError("");
  };

  // ── Tela de sucesso ───────────────────────────────────────
  if (success) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center min-h-[60vh] text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", bounce: 0.4, delay: 0.1 }}
          className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mb-6"
        >
          <CheckCircle2 size={36} className="text-emerald-400" />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-2xl font-bold text-white mb-2"
        >
          {success.count} posts agendados!
        </motion.h2>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="space-y-1 mb-8"
        >
          <p className="text-ink-3 text-sm">
            {selectedAccountIds.size} conta{selectedAccountIds.size !== 1 ? "s" : ""} ·{" "}
            {success.batches} lote{success.batches !== 1 ? "s" : ""} por conta ·{" "}
            {selectedVideoIds.size} vídeo{selectedVideoIds.size !== 1 ? "s" : ""}
          </p>
          {success.endDate && (
            <p className="text-ink-3 text-xs">
              Último lote em {success.endDate}
            </p>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex gap-3"
        >
          <button onClick={resetForm} className="btn-ghost text-sm px-6 py-2.5">
            Agendar Mais
          </button>
          <a href="/dashboard/schedule" className="btn-primary text-sm px-6 py-2.5 flex items-center gap-2">
            <CalendarRange size={14} />
            Ver Agendamentos
          </a>
        </motion.div>
      </motion.div>
    );
  }

  // ── Formulário principal ──────────────────────────────────
  return (
    <div className="space-y-5 pb-28">

      {/* Cabeçalho */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold tracking-tight text-white">Agendamento em Massa</h1>
        <p className="text-sm text-ink-3 mt-0.5">
          Distribua vídeos para múltiplas contas em lotes automáticos e embaralhados
        </p>
      </motion.div>

      {/* ── 1. Seleção de Vídeos ── */}
      <SectionCard delay={0.04}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <StepBadge n={1} done={selectedVideoIds.size > 0} />
            <h2 className="font-semibold text-ink text-sm">Selecionar Vídeos</h2>
            {selectedVideoIds.size > 0 && (
              <span className="text-[10px] bg-[#00498D]/20 text-[#AFBDD0] px-2 py-0.5 rounded-full font-medium">
                {selectedVideoIds.size} selecionado{selectedVideoIds.size !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {selectedVideoIds.size < videos.length && videos.length > 0 && (
              <button
                onClick={selectAllVideos}
                className="text-[11px] text-[#85B9E9] hover:text-[#AFBDD0] transition-colors"
              >
                Todos
              </button>
            )}
            {selectedVideoIds.size > 0 && (
              <button
                onClick={clearVideos}
                className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {loadingVideos ? (
          <VideosSkeleton />
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-12">
            <div className="w-12 h-12 rounded-2xl bg-surface-raised flex items-center justify-center">
              <Play size={20} className="text-ink-3/50" />
            </div>
            <p className="text-ink-3 text-sm">Nenhum vídeo na biblioteca.</p>
            <a
              href="/dashboard/library"
              className="text-xs text-[#85B9E9] hover:text-[#AFBDD0] transition-colors"
            >
              Ir para a Biblioteca →
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-72 overflow-y-auto pr-0.5">
            {videos.map(video => {
              const sel = selectedVideoIds.has(video.id);
              return (
                <button
                  key={video.id}
                  onClick={() => toggleVideo(video.id)}
                  className={cn(
                    "relative rounded-xl overflow-hidden transition-all text-left group",
                    "border-2",
                    sel
                      ? "border-[#00498D] ring-2 ring-[#00498D]/20 scale-[0.98]"
                      : "border-transparent hover:border-line-control"
                  )}
                >
                  <div
                    className={cn(
                      "aspect-[9/16] w-full bg-gradient-to-br",
                      videoGradient(video.id)
                    )}
                  >
                    {video.duration != null && (
                      <span className="absolute bottom-1 right-1 text-[9px] bg-black/60 text-ink-2 px-1 py-0.5 rounded leading-tight">
                        {formatDuration(video.duration)}
                      </span>
                    )}
                    {sel && (
                      <div className="absolute inset-0 bg-[#00498D]/15 flex items-start justify-start p-1.5">
                        <div className="w-4 h-4 rounded-full bg-[#00498D] flex items-center justify-center shadow-lg">
                          <Check size={9} className="text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="px-1 py-1 bg-black/25">
                    <p className="text-[9px] text-ink-3 truncate leading-tight">
                      @{video.owner_username ?? "—"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── 2. Seleção de Contas ── */}
      <SectionCard delay={0.08}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <StepBadge n={2} done={selectedAccountIds.size > 0} />
            <h2 className="font-semibold text-ink text-sm">Selecionar Contas</h2>
            {selectedAccountIds.size > 0 && (
              <span className="text-[10px] bg-[#00498D]/20 text-[#AFBDD0] px-2 py-0.5 rounded-full font-medium">
                {selectedAccountIds.size} selecionada{selectedAccountIds.size !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {selectedAccountIds.size < accounts.length && accounts.length > 0 && (
              <button
                onClick={selectAllAccounts}
                className="text-[11px] text-[#85B9E9] hover:text-[#AFBDD0] transition-colors"
              >
                Todas
              </button>
            )}
            {selectedAccountIds.size > 0 && (
              <button
                onClick={clearAccounts}
                className="text-[11px] text-ink-3 hover:text-ink-2 transition-colors"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {loadingAccounts ? (
          <AccountsSkeleton />
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-10">
            <div className="w-12 h-12 rounded-2xl bg-surface-raised flex items-center justify-center">
              <Instagram size={20} className="text-ink-3/50" />
            </div>
            <p className="text-ink-3 text-sm">Nenhuma conta ativa conectada.</p>
            <a
              href="/dashboard/accounts"
              className="text-xs text-[#85B9E9] hover:text-[#AFBDD0] transition-colors"
            >
              Conectar contas →
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {accounts.map(account => {
              const sel = selectedAccountIds.has(account.id);
              return (
                <button
                  key={account.id}
                  onClick={() => toggleAccount(account.id)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left",
                    sel
                      ? "border-[#00498D] bg-[#00498D]/[0.07]"
                      : "border-line bg-surface hover:border-line-control hover:bg-surface-raised"
                  )}
                >
                  {account.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/proxy-image?url=${encodeURIComponent(account.avatar_url)}`}
                      alt={account.username}
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0",
                        avatarColor(account.username)
                      )}
                    >
                      <Instagram size={13} className="text-white" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-ink truncate">
                      @{account.username}
                    </p>
                    {account.followers_count != null && (
                      <p className="text-[10px] text-ink-3">
                        {formatNumber(account.followers_count)} seg.
                      </p>
                    )}
                  </div>

                  {sel && <Check size={14} className="text-[#85B9E9] flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ── 3. Variações de Legenda ── */}
      <SectionCard delay={0.12}>
        <div className="flex items-center gap-2.5 mb-4">
          <StepBadge n={3} done={captions.some(c => c.trim())} />
          <h2 className="font-semibold text-ink text-sm">Variações de Legenda</h2>
          <span className="text-[10px] text-ink-3 hidden sm:inline">
            (distribuídas aleatoriamente entre os posts)
          </span>
        </div>

        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {captions.map((caption, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="flex gap-2 items-start"
              >
                <div className="flex-1">
                  <textarea
                    value={caption}
                    onChange={e => updateCaption(i, e.target.value)}
                    placeholder={
                      i === 0
                        ? "Legenda principal (obrigatória)..."
                        : `Variação ${i + 1}...`
                    }
                    rows={2}
                    maxLength={2200}
                    className="input-glass w-full text-sm resize-none py-2.5 leading-relaxed"
                  />
                  <p className="text-[10px] text-ink-3/50 mt-0.5 text-right">
                    {caption.length}/2200
                  </p>
                </div>
                {captions.length > 1 && (
                  <button
                    onClick={() => removeCaption(i)}
                    className="mt-1.5 w-7 h-7 rounded-lg flex items-center justify-center text-ink-3/50 hover:bg-red-500/10 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <X size={13} />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <button
          onClick={addCaption}
          disabled={captions.length >= 10}
          className="mt-3 flex items-center gap-2 text-xs text-[#85B9E9] hover:text-[#AFBDD0] transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
        >
          <Plus size={13} />
          Adicionar Variação de Legenda
          {captions.length >= 10 && (
            <span className="text-ink-3 ml-1">(máx. 10)</span>
          )}
        </button>
      </SectionCard>

      {/* ── 4. Configurações de Lote ── */}
      <SectionCard delay={0.16}>
        <div className="flex items-center gap-2.5 mb-5">
          <StepBadge n={4} done={!!startDatetime} />
          <h2 className="font-semibold text-ink text-sm">Configurações de Lote</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Data de início */}
          <div>
            <label className="text-xs font-semibold text-ink-3 mb-1.5 block">
              Data e Hora de Início
            </label>
            <input
              type="datetime-local"
              value={startDatetime}
              onChange={e => setStartDatetime(e.target.value)}
              className="input-glass w-full text-sm"
              style={{ colorScheme: "dark" }}
            />
          </div>

          {/* Vídeos por lote */}
          <div>
            <label className="text-xs font-semibold text-ink-3 mb-1.5 block">
              Vídeos por Lote
            </label>
            <input
              type="number"
              value={videosPerBatch}
              onChange={e =>
                setVideosPerBatch(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
              }
              min={1}
              max={20}
              className="input-glass w-full text-sm"
            />
            <p className="text-[10px] text-ink-3 mt-1.5">posts por janela de tempo</p>
          </div>

          {/* Intervalo */}
          <div>
            <label className="text-xs font-semibold text-ink-3 mb-1.5 block">
              Intervalo entre Lotes (h)
            </label>
            <input
              type="number"
              value={intervalHours}
              onChange={e =>
                setIntervalHours(Math.max(0, Number(e.target.value) || 0))
              }
              min={0}
              step={0.5}
              className="input-glass w-full text-sm"
            />
            <p className="text-[10px] text-ink-3 mt-1.5">horas entre cada lote</p>
          </div>
        </div>

        {/* Preview de distribuição */}
        {totalPosts > 0 && startDatetime && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 flex flex-wrap gap-x-5 gap-y-2 pt-4 border-t border-line"
          >
            <div className="flex items-center gap-1.5 text-xs text-ink-3">
              <Sparkles size={11} className="text-[#85B9E9]" />
              <span>
                <span className="text-white font-semibold">{totalPosts}</span> posts no total
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-ink-3">
              <Layers size={11} className="text-[#85B9E9]" />
              <span>
                <span className="text-white font-semibold">{batchesPerAccount}</span>{" "}
                lote{batchesPerAccount !== 1 ? "s" : ""} por conta
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-ink-3">
              <Clock size={11} className="text-pink-400" />
              <span>
                início em{" "}
                <span className="text-white font-semibold">
                  {fmtDate(new Date(startDatetime))}
                </span>
              </span>
            </div>
            {endDate && intervalHours > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-ink-3">
                <CalendarRange size={11} className="text-amber-400" />
                <span>
                  último lote em{" "}
                  <span className="text-white font-semibold">{fmtDate(endDate)}</span>
                </span>
              </div>
            )}
          </motion.div>
        )}
      </SectionCard>

      {/* ── Barra de ação sticky ── */}
      <div className="sticky bottom-0 -mx-6 px-6 pb-5 pt-4 bg-gradient-to-t from-[#030712] via-[#030712]/80 to-transparent pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
          className="glass-card rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 pointer-events-auto shadow-2xl"
        >
          {/* Resumo */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {totalPosts > 0 ? (
              <>
                <span className="text-xs text-ink-3">
                  <span className="text-white font-semibold">{totalPosts}</span> posts
                </span>
                <span className="text-xs text-ink-3">
                  <span className="text-white font-semibold">{selectedAccountIds.size}</span>{" "}
                  conta{selectedAccountIds.size !== 1 ? "s" : ""}
                </span>
                <span className="text-xs text-ink-3">
                  <span className="text-white font-semibold">{batchesPerAccount}</span>{" "}
                  lote{batchesPerAccount !== 1 ? "s" : ""} por conta
                </span>
              </>
            ) : (
              <span className="text-xs text-ink-3">
                Selecione vídeos e contas para começar
              </span>
            )}
          </div>

          {/* Erro inline */}
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 max-w-xs">
              <AlertCircle size={12} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Botão */}
          <motion.button
            onClick={handleSchedule}
            disabled={!canSchedule}
            whileTap={canSchedule ? { scale: 0.97 } : undefined}
            className="btn-primary flex items-center gap-2 text-sm px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {scheduling ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Agendando...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Agendar{totalPosts > 0 ? ` ${totalPosts}` : ""} Posts
              </>
            )}
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}
