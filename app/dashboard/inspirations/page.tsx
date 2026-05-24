"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import {
  Search,
  AtSign,
  Loader2,
  AlertCircle,
  SlidersHorizontal,
  TrendingUp,
  Clock,
  Heart,
  MessageCircle,
  Download,
  CheckCircle2,
  Trash2,
  ArrowLeft,
  Film,
  Sparkles,
  Instagram,
  Eye,
  Plus,
} from "lucide-react";
import { InspirationGrid } from "@/components/inspirations/InspirationGrid";
import type { InspirationReel } from "@/components/inspirations/InspirationCard";

type SortKey = "views" | "likes" | "comments" | "duration";

interface ScrapedProfile {
  id: string;
  username: string;
  full_name: string;
  profile_pic_url: string | null;
  video_count: number;
  scraped_at: string;
  videos_data: InspirationReel[];
}

const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ElementType }[] = [
  { key: "views",    label: "Mais vistos",     icon: TrendingUp    },
  { key: "likes",    label: "Mais curtidos",   icon: Heart         },
  { key: "comments", label: "Mais comentados", icon: MessageCircle },
  { key: "duration", label: "Mais longos",     icon: Clock         },
];

// ── Mock card data — shown before any search ──────────────────────
const MOCK_CARDS = [
  { label: "Aguardando busca", views: "—", likes: "—" },
  { label: "Aguardando busca", views: "—", likes: "—" },
  { label: "Aguardando busca", views: "—", likes: "—" },
  { label: "Aguardando busca", views: "—", likes: "—" },
  { label: "Aguardando busca", views: "—", likes: "—" },
  { label: "Aguardando busca", views: "—", likes: "—" },
];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

// ── Importing Modal ───────────────────────────────────────────────
function ImportingModal({ username, done }: { username: string; done: boolean }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (done) { setProgress(100); return; }
    const id = setInterval(() => {
      setProgress((p) => { const next = p + Math.random() * 2.5 + 0.5; return next >= 95 ? 95 : next; });
    }, 350);
    return () => clearInterval(id);
  }, [done]);

  return (
    <motion.div
      key="importing-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.80)", backdropFilter: "blur(12px)" }}
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.93, opacity: 0, y: 12 }}
        transition={{ type: "spring", bounce: 0.18, duration: 0.38 }}
        className="glass ticks w-full max-w-sm mx-4 p-8"
      >
        {/* Animated ring */}
        <div className="flex justify-center mb-6">
          <div className="relative w-16 h-16">
            <div
              className={`w-16 h-16 rounded-full border-2 transition-all duration-500 ${
                done ? "border-[#00FF41]/40" : "border-[#00E5FF]/20 border-t-[#00E5FF] animate-spin"
              }`}
            />
            {done && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <CheckCircle2 size={28} style={{ color: "var(--matrix)" }} />
              </motion.div>
            )}
          </div>
        </div>

        <h3 className="font-bold text-center text-base mb-1" style={{ color: "var(--text-primary)" }}>
          Importando <span className="gradient-text">@{username}</span>
        </h3>
        <p className="text-xs text-center mb-6" style={{ color: "var(--text-muted)" }}>
          Buscando todos os vídeos via Apify...
        </p>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
            <span>Progresso</span>
            <span className="metric-value text-[11px]">{Math.round(progress)}%</span>
          </div>
          <div className="h-[3px] rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, var(--matrix), var(--electric))" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {[
            { label: "Buscando posts via Apify API", done: done || progress > 50 },
            { label: "Processando dados dos vídeos", done: done || progress > 80 },
            { label: "Salvando no histórico", done },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              {step.done ? (
                <CheckCircle2 size={14} style={{ color: "var(--matrix)" }} className="flex-shrink-0" />
              ) : (
                <Loader2 size={14} style={{ color: "var(--electric)" }} className="animate-spin flex-shrink-0" />
              )}
              <span className="text-sm" style={{ color: step.done ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.75)" }}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Mock placeholder card ─────────────────────────────────────────
function MockCard({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="glass-card ticks relative overflow-hidden group"
      style={{ minHeight: 220 }}
    >
      {/* Shimmer overlay */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(135deg, rgba(0,255,65,0.02) 0%, transparent 60%, rgba(0,229,255,0.02) 100%)" }} />

      {/* Fake thumbnail area */}
      <div className="relative h-32 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.35)", borderBottom: "0.5px solid rgba(255,255,255,0.07)" }}>
        <Film size={28} style={{ color: "rgba(255,255,255,0.08)" }} />
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider"
          style={{ background: "rgba(0,255,65,0.08)", color: "rgba(0,255,65,0.4)", border: "0.5px solid rgba(0,255,65,0.15)" }}>
          REEL
        </div>
      </div>

      {/* Card body */}
      <div className="p-4 space-y-3">
        {/* Placeholder lines */}
        <div className="space-y-1.5">
          <div className="h-2 rounded-full animate-pulse" style={{ background: "rgba(255,255,255,0.05)", width: "75%" }} />
          <div className="h-2 rounded-full animate-pulse" style={{ background: "rgba(255,255,255,0.03)", width: "50%" }} />
        </div>

        {/* Fake stats */}
        <div className="flex items-center gap-3 text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
          <span className="flex items-center gap-1"><Eye size={10} />—</span>
          <span className="flex items-center gap-1"><Heart size={10} />—</span>
          <span className="flex items-center gap-1"><MessageCircle size={10} />—</span>
        </div>

        {/* CTA button */}
        <button
          disabled
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-not-allowed"
          style={{
            background: "rgba(0,255,65,0.06)",
            border: "0.5px solid rgba(0,255,65,0.18)",
            color: "rgba(0,255,65,0.35)",
          }}
        >
          <Plus size={12} />
          Adicionar à Biblioteca
        </button>
      </div>
    </motion.div>
  );
}

// ── History profile card ──────────────────────────────────────────
function HistoryCard({
  profile,
  onView,
  onDelete,
}: {
  profile: ScrapedProfile;
  onView: (p: ScrapedProfile) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const initial = profile.username.charAt(0).toUpperCase();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.22 }}
      className="glass-card ticks p-4 flex flex-col gap-3 relative group"
    >
      {/* Ambient glow on hover */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-300"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,255,65,0.04) 0%, transparent 70%)" }} />

      {/* Delete */}
      <button
        onClick={(e) => onDelete(profile.id, e)}
        className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10"
        style={{ background: "rgba(255,59,48,0.08)", border: "0.5px solid rgba(255,59,48,0.2)", color: "rgba(255,100,90,0.7)" }}
      >
        <Trash2 size={11} />
      </button>

      {/* Avatar + username */}
      <div className="flex items-center gap-3 pr-7 relative z-10">
        <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #00FF41, #00E5FF)", boxShadow: "0 0 10px rgba(0,255,65,0.2)" }}>
          {profile.profile_pic_url && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/proxy-image?url=${encodeURIComponent(profile.profile_pic_url)}`}
              alt={profile.username}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-black text-sm font-bold">{initial}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "rgba(255,255,255,0.85)" }}>@{profile.username}</p>
          {profile.full_name && profile.full_name !== profile.username && (
            <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.3)" }}>{profile.full_name}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 relative z-10">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
          style={{ background: "rgba(0,255,65,0.05)", border: "0.5px solid rgba(0,255,65,0.12)" }}>
          <Film size={10} style={{ color: "var(--matrix)" }} />
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.55)" }}>{profile.video_count} reels</span>
        </div>
        <span className="text-[11px] ml-auto" style={{ color: "rgba(255,255,255,0.22)" }}>{timeAgo(profile.scraped_at)}</span>
      </div>

      {/* CTA */}
      <button
        onClick={() => onView(profile)}
        className="relative z-10 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
        style={{
          background: "rgba(0,255,65,0.07)",
          border: "0.5px solid rgba(0,255,65,0.22)",
          color: "rgba(0,255,65,0.8)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,255,65,0.14)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 14px rgba(0,255,65,0.1)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,255,65,0.07)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
        }}
      >
        <Eye size={11} />
        Ver Reels
      </button>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function InspiracoesPage() {
  const [view, setView] = useState<"history" | "grid">("history");
  const [history, setHistory] = useState<ScrapedProfile[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [username, setUsername] = useState("");
  const [activeUsername, setActiveUsername] = useState("");
  const [reels, setReels] = useState<InspirationReel[]>([]);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("views");
  const [showFilters, setShowFilters] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [modalDone, setModalDone] = useState(false);

  const [bulkProgress, setBulkProgress] = useState<{ done: number; errors: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ saved: number; errors: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const _searchingRef = useRef(false);
  const _bulkRef = useRef(false);

  useEffect(() => {
    fetch("/api/inspirations/history", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 401) { window.location.href = "/auth/login"; return; }
        setHistory(data.profiles ?? []);
        setHistoryLoading(false);
      })
      .catch(() => setHistoryLoading(false));
  }, []);

  const refreshHistory = () => {
    fetch("/api/inspirations/history", { cache: "no-store" })
      .then(async (r) => { const data = await r.json(); setHistory(data.profiles ?? []); })
      .catch(() => {});
  };

  const handleSearch = async (query?: string) => {
    if (_searchingRef.current) return;
    const target = (query ?? username).replace(/^@/, "").trim();
    if (!target) return;
    _searchingRef.current = true;
    setUsername(target);
    setError("");
    setBulkProgress(null);
    setBulkResult(null);
    setModalDone(false);
    setShowModal(true);
    try {
      const res = await fetch("/api/inspirations/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao buscar Reels.");

      const fetchedReels = (data.reels ?? []) as InspirationReel[];
      // Defesa extra: API retornou 200 mas com lista vazia — tratar como bloqueio
      if (fetchedReels.length === 0) {
        throw new Error(
          `Nenhum Reel encontrado para @${target}. ` +
          `O perfil pode ser privado, inexistente, não ter Reels ou ` +
          `o Instagram está bloqueando temporariamente. Tente novamente.`
        );
      }

      setModalDone(true);
      setTimeout(() => {
        setShowModal(false);
        setActiveUsername(target);
        setReels(fetchedReels);
        setView("grid");
        refreshHistory();
      }, 700);
    } catch (err) {
      setShowModal(false);
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      _searchingRef.current = false;
    }
  };

  const handleViewProfile = (profile: ScrapedProfile) => {
    setActiveUsername(profile.username);
    setReels(profile.videos_data);
    setBulkResult(null);
    setBulkProgress(null);
    setError("");
    setView("grid");
  };

  const handleDeleteProfile = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory((prev) => prev.filter((p) => p.id !== id));
    try { await fetch(`/api/inspirations/history/${id}`, { method: "DELETE" }); } catch { refreshHistory(); }
  };

  const handleBack = () => {
    setView("history");
    setActiveUsername("");
    setReels([]);
    setBulkResult(null);
    setBulkProgress(null);
    setShowFilters(false);
  };

  const sortedReels = [...reels].sort((a, b) => b[sortBy] - a[sortBy]);

  // Individual download.
  //
  // WHY we don't use fetch → blob → createObjectURL:
  //   `await res.blob()` on a 30-80 MB video can take 15-60 s on typical connections.
  //   Chrome and Safari expire the "user-gesture context" after ~5 s of async work,
  //   so `a.click()` called after the blob resolves is silently blocked — nothing saves
  //   to disk even though the blob is in memory.
  //
  // FIX:
  //   1. Run a fast HEAD request to validate the URL (resolves in <500 ms — well inside
  //      the gesture window and cheap since no body is transferred).
  //   2. Trigger `a.click()` SYNCHRONOUSLY right after the HEAD resolves — no large
  //      await between the gesture and the click.
  //   3. The proxy already sends `Content-Disposition: attachment`, so the browser's
  //      native download manager takes over and shows real progress in the download bar.
  const handleProcess = async (reel: InspirationReel) => {
    const videoUrl = reel.videoUrl?.trim();
    if (!videoUrl || videoUrl === "undefined") {
      throw new Error("URL do vídeo indisponível para este reel.");
    }

    const filename = `autoscale_reel_${reel.id || Date.now()}.mp4`;
    const encoded  = `url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(filename)}`;
    // HEAD uses the lightweight proxy (no FFmpeg) — resolves in <500 ms
    const headUrl  = `/api/proxy-download?${encoded}`;
    // GET uses the sanitizing route — double-pass FFmpeg before delivery
    const proxyUrl = `/api/proxy-sanitize-download?${encoded}`;

    console.log(`[download] ${filename} ← ${videoUrl.slice(0, 80)}…`);

    // Step 1 — Fast HEAD: validate the URL is accessible (no body downloaded).
    let check: Response;
    try {
      check = await fetch(headUrl, { method: "HEAD" });
    } catch (networkErr) {
      throw new Error(`Erro de rede: ${String(networkErr)}`);
    }

    if (!check.ok) {
      console.error(`[download] HEAD ${check.status} for ${videoUrl.slice(0, 60)}`);
      throw new Error(
        check.status === 403 || check.status === 502
          ? "URL do vídeo expirada ou bloqueada pelo CDN. Refaça a busca para obter URLs novas."
          : `Vídeo indisponível (HTTP ${check.status}).`
      );
    }

    // Step 2 — Trigger native browser Save-As via the sanitized endpoint.
    // The server runs double-pass FFmpeg before sending; the browser's native
    // download bar shows progress without any blob in JS memory.
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = proxyUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Bulk download — processes each visible reel one at a time.
  // A 700 ms gap between triggers prevents Chrome/Safari from blocking
  // rapid consecutive file downloads.
  // Every reel has its own try/catch so a single broken URL never aborts the batch.
  const handleBulkDownload = async () => {
    if (_bulkRef.current || sortedReels.length === 0) return;
    _bulkRef.current = true;
    setBulkResult(null);

    const total = sortedReels.length;
    let downloaded = 0;
    let errors = 0;

    for (let i = 0; i < total; i++) {
      // Show "Baixando X de Y" BEFORE starting this item
      setBulkProgress({ done: i, errors, total });

      try {
        await handleProcess(sortedReels[i]);
        downloaded++;
      } catch (err) {
        errors++;
        console.warn(
          `[bulk] reel ${i + 1}/${total} falhou:`,
          err instanceof Error ? err.message : err
        );
      }

      // Delay between triggers — browser blocks if you fire downloads too fast
      if (i < total - 1) {
        await new Promise<void>(r => setTimeout(r, 700));
      }
    }

    setBulkProgress(null);
    setBulkResult({ saved: downloaded, errors });
    _bulkRef.current = false;
  };

  const isSearching = showModal && !modalDone;

  return (
    <>
      <AnimatePresence>
        {showModal && <ImportingModal username={username} done={modalDone} />}
      </AnimatePresence>

      <div className="space-y-6 max-w-full">

        {/* ── Page Header ────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex items-start gap-3"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, rgba(0,255,65,0.15), rgba(0,229,255,0.1))", border: "0.5px solid rgba(0,255,65,0.25)", boxShadow: "0 0 18px rgba(0,255,65,0.12)" }}>
            <Sparkles size={18} style={{ color: "var(--matrix)" }} />
          </div>
          <div>
            <h1 className="page-title">Inspirações e Scraper</h1>
            <p className="page-subtitle">Encontre conteúdos virais para modelar e adicionar à sua biblioteca.</p>
          </div>
        </motion.div>

        {/* ── Search bar ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="ticks relative rounded-2xl overflow-hidden"
          style={{
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(22px) saturate(160%)",
            WebkitBackdropFilter: "blur(22px) saturate(160%)",
            border: "0.5px solid rgba(255,255,255,0.09)",
          }}
        >
          {/* Accent gradient */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "linear-gradient(135deg, rgba(0,255,65,0.04) 0%, transparent 50%, rgba(0,229,255,0.03) 100%)" }} />

          <div className="relative p-6">
            {/* Label */}
            <div className="flex items-center gap-2 mb-1">
              <Instagram size={14} style={{ color: "rgba(255,100,150,0.75)" }} />
              <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>
                Buscar inspirações no Instagram
              </span>
            </div>
            <p className="text-xs mb-5" style={{ color: "rgba(255,255,255,0.28)" }}>
              Digite o @ de qualquer perfil público para visualizar os Reels e preparar downloads
            </p>

            {/* Input row */}
            <div className="flex gap-3">
              <div className="relative flex-1">
                <AtSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--matrix)" }} />
                <input
                  ref={inputRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="nome_do_perfil"
                  className="input-glass pl-10 pr-4 py-3.5 text-sm w-full rounded-xl"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <motion.button
                onClick={() => handleSearch()}
                whileTap={{ scale: 0.96 }}
                disabled={isSearching || !username.trim()}
                className="btn-primary px-6 py-3.5 rounded-xl"
              >
                {isSearching ? (
                  <><Loader2 size={15} className="animate-spin" />Buscando...</>
                ) : (
                  <><Search size={15} />Buscar Reels</>
                )}
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* ── Error toast ────────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
              style={{ background: "rgba(255,59,48,0.08)", border: "0.5px solid rgba(255,59,48,0.2)", color: "rgba(255,100,90,0.9)" }}
            >
              <AlertCircle size={15} />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError("")} style={{ color: "rgba(255,255,255,0.3)" }} className="hover:text-white/60 transition-colors">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Grid view (after search) ───────────────────────────────── */}
        {view === "grid" && (
          <>
            {/* Subheader */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                  style={{ border: "0.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
                >
                  <ArrowLeft size={12} />Voltar
                </button>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
                    <span className="metric-value text-sm">{reels.length}</span> Reels encontrados
                  </p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>de @{activeUsername}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  onClick={handleBulkDownload}
                  disabled={bulkProgress !== null}
                  whileTap={bulkProgress !== null ? {} : { scale: 0.96 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                  style={
                    bulkProgress !== null
                      ? { background: "rgba(0,229,255,0.06)", border: "0.5px solid rgba(0,229,255,0.15)", color: "rgba(0,229,255,0.4)", cursor: "not-allowed" }
                      : { background: "rgba(0,229,255,0.08)", border: "0.5px solid rgba(0,229,255,0.2)", color: "rgba(0,229,255,0.8)" }
                  }
                >
                  {bulkProgress !== null ? (
                    <><Loader2 size={11} className="animate-spin" />Baixando {Math.min(bulkProgress.done + 1, bulkProgress.total)} de {bulkProgress.total}...</>
                  ) : (
                    <><Download size={11} />Baixar todos</>
                  )}
                </motion.button>

                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                  style={
                    showFilters
                      ? { background: "rgba(0,255,65,0.1)", border: "0.5px solid rgba(0,255,65,0.25)", color: "rgba(0,255,65,0.85)" }
                      : { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }
                  }
                >
                  <SlidersHorizontal size={11} />Ordenar
                </button>
              </div>
            </motion.div>

            {/* Bulk result banner */}
            <AnimatePresence>
              {bulkResult && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
                  style={
                    bulkResult.saved === 0
                      ? { background: "rgba(255,59,48,0.08)", border: "0.5px solid rgba(255,59,48,0.2)", color: "rgba(255,100,90,0.9)" }
                      : { background: "rgba(0,255,65,0.07)", border: "0.5px solid rgba(0,255,65,0.2)", color: "rgba(0,255,65,0.9)" }
                  }
                >
                  {bulkResult.saved === 0 ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
                  {bulkResult.saved === 0
                    ? "Nenhum vídeo foi baixado. Verifique as URLs dos reels."
                    : bulkResult.errors > 0
                    ? `${bulkResult.saved} vídeos salvos no dispositivo (${bulkResult.errors} erros).`
                    : `${bulkResult.saved} vídeos salvos no seu dispositivo!`}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Sort chips */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 overflow-hidden"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setSortBy(opt.key)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                      style={
                        sortBy === opt.key
                          ? { background: "rgba(0,255,65,0.1)", border: "0.5px solid rgba(0,255,65,0.25)", color: "rgba(0,255,65,0.85)" }
                          : { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)" }
                      }
                    >
                      <opt.icon size={10} />{opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Reels grid */}
            {reels.length > 0 && <InspirationGrid reels={sortedReels} onProcess={handleProcess} />}
            {reels.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center py-20 gap-4 text-center"
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(255,59,48,0.07)", border: "0.5px solid rgba(255,59,48,0.2)" }}>
                  <AlertCircle size={26} style={{ color: "rgba(255,100,90,0.5)" }} />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.45)" }}>
                    Nenhum Reel encontrado para @{activeUsername}
                  </p>
                  <p className="text-xs max-w-sm mx-auto leading-relaxed" style={{ color: "rgba(255,255,255,0.2)" }}>
                    O perfil pode ser privado, inexistente, não ter Reels ou o Instagram
                    pode estar bloqueando temporariamente a coleta.
                  </p>
                </div>
                <button
                  onClick={() => { handleBack(); }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(0,255,65,0.07)", border: "0.5px solid rgba(0,255,65,0.2)", color: "rgba(0,255,65,0.7)" }}
                >
                  <ArrowLeft size={11} />
                  Voltar e buscar outro perfil
                </button>
              </motion.div>
            )}
          </>
        )}

        {/* ── History / empty state ──────────────────────────────────── */}
        {view === "history" && (
          <>
            {historyLoading ? (
              /* Skeleton loaders */
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="glass-card h-44 animate-pulse" style={{ animationDelay: `${i * 70}ms` }} />
                ))}
              </div>
            ) : history.length > 0 ? (
              /* Real history */
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
                    Histórico de pesquisas
                    <span className="ml-2 font-normal" style={{ color: "rgba(255,255,255,0.22)" }}>
                      ({history.length})
                    </span>
                  </p>
                </div>
                <AnimatePresence mode="popLayout">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {history.map((profile) => (
                      <HistoryCard key={profile.id} profile={profile} onView={handleViewProfile} onDelete={handleDeleteProfile} />
                    ))}
                  </div>
                </AnimatePresence>
              </motion.div>
            ) : (
              /* Empty state — show mock cards */
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                {/* Info banner */}
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(0,229,255,0.05)", border: "0.5px solid rgba(0,229,255,0.12)" }}>
                  <Sparkles size={14} style={{ color: "var(--electric)" }} className="flex-shrink-0" />
                  <p className="text-xs" style={{ color: "rgba(0,229,255,0.7)" }}>
                    Pesquise um perfil acima para ver os Reels. Seu histórico ficará salvo aqui.
                  </p>
                </div>

                {/* Mock preview grid */}
                <div>
                  <p className="text-xs font-semibold mb-3 tracking-wider uppercase"
                    style={{ color: "rgba(255,255,255,0.18)" }}>
                    Preview — aguardando busca
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {MOCK_CARDS.map((_, i) => <MockCard key={i} index={i} />)}
                  </div>
                </div>
              </motion.div>
            )}
          </>
        )}
      </div>
    </>
  );
}
