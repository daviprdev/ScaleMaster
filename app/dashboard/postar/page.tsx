"use client";

import { useState, useEffect, useCallback, useRef, DragEvent, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Film, Type, CalendarDays, Send, Upload,
  FolderOpen, X, Check, ChevronDown, Loader2,
  AlertCircle, CheckCircle2, Heart, MessageCircle,
  Share2, MoreHorizontal, Smartphone, Zap, Clock,
  Clapperboard, Image as ImageIcon, Hash,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
}

interface LibraryItem {
  id: string;
  filename: string;
  public_url: string;
  created_at: string;
}

interface PublishResult {
  account_id: string;
  username: string;
  status: "published" | "failed";
  media_id?: string;
  error?: string;
}

const MAX_CHARS = 2200;

const POST_TYPES = [
  { value: "reel" as const, label: "Reel", Icon: Film, desc: "Vídeo vertical" },
  { value: "feed" as const, label: "Feed", Icon: ImageIcon, desc: "Post no perfil" },
  { value: "story" as const, label: "Story", Icon: Clock, desc: "24 horas" },
];

// ── AccountsSelect ─────────────────────────────────────────────────────────

function AccountsSelect({
  accounts,
  selected,
  onChange,
}: {
  accounts: Account[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const selectedAccounts = accounts.filter(a => selected.includes(a.id));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 hover:border-white/20 transition-colors text-left"
      >
        <div className="flex flex-wrap items-center gap-2 min-h-6 flex-1">
          {selectedAccounts.length === 0 ? (
            <span className="text-white/30 text-sm">Selecionar contas...</span>
          ) : selectedAccounts.map(a => (
            <span
              key={a.id}
              className="flex items-center gap-1.5 bg-violet-500/15 border border-violet-500/25 rounded-lg px-2.5 py-0.5 text-xs text-violet-300"
            >
              {a.avatar_url && (
                <img src={a.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
              )}
              @{a.username}
              <button
                onClick={e => { e.stopPropagation(); toggle(a.id); }}
                className="text-violet-400/50 hover:text-violet-300 transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <ChevronDown size={16} className={cn("text-white/40 flex-shrink-0 ml-2 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute z-30 top-full left-0 right-0 mt-1.5 bg-[#111827] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
          >
            {accounts.length === 0 ? (
              <div className="px-4 py-8 text-center text-white/30 text-sm">
                Nenhuma conta conectada
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                {accounts.map(acc => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => toggle(acc.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.06] transition-colors text-left"
                  >
                    {acc.avatar_url ? (
                      <img src={acc.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">@{acc.username}</div>
                      {acc.display_name && (
                        <div className="text-xs text-white/40 truncate">{acc.display_name}</div>
                      )}
                    </div>
                    {selected.includes(acc.id) && (
                      <Check size={16} className="text-violet-400 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── LibraryModal ──────────────────────────────────────────────────────────

function LibraryModal({
  onSelect,
  onClose,
}: {
  onSelect: (url: string, filename: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/library")
      .then(r => r.json() as Promise<{ videos: LibraryItem[] }>)
      .then(d => setItems(d.videos ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={e => e.stopPropagation()}
        className="bg-[#0d111b] border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col"
        style={{ maxHeight: "80vh" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
          <h2 className="text-white font-semibold">Escolher da Biblioteca</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-white/50 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={28} className="animate-spin text-violet-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-white/30 text-sm">
              Nenhum vídeo na biblioteca
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.public_url, item.filename)}
                  className="group relative aspect-[9/16] rounded-xl overflow-hidden bg-black/50 border border-white/10 hover:border-violet-500/60 transition-all"
                >
                  <video
                    src={item.public_url}
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Check size={28} className="text-white drop-shadow" />
                    </div>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                    <p className="text-white text-[10px] truncate">{item.filename}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── PhoneMockup ────────────────────────────────────────────────────────────

function PhoneMockup({
  mediaUrl,
  caption,
  firstComment,
  accountName,
  postType,
}: {
  mediaUrl: string | null;
  caption: string;
  firstComment: string;
  accountName: string | null;
  postType: "reel" | "feed" | "story";
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2 text-white/30 text-xs">
        <Smartphone size={13} />
        <span>Preview · Instagram</span>
      </div>

      {/* Phone shell */}
      <div className="relative" style={{ width: 248, height: 508 }}>
        {/* Side buttons */}
        <div className="absolute right-[-5px] top-[90px] w-[5px] h-8 bg-gray-700 rounded-r-sm" />
        <div className="absolute left-[-5px] top-[78px] w-[5px] h-6 bg-gray-700 rounded-l-sm" />
        <div className="absolute left-[-5px] top-[110px] w-[5px] h-10 bg-gray-700 rounded-l-sm" />
        <div className="absolute left-[-5px] top-[128px] w-[5px] h-10 bg-gray-700 rounded-l-sm" />

        {/* Phone frame */}
        <div className="absolute inset-0 rounded-[44px] border-[7px] border-gray-700 bg-black overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.8)]">
          {/* Dynamic island */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[88px] h-[26px] rounded-full bg-black z-20" />

          {/* Screen area */}
          <div className="absolute inset-0 rounded-[37px] overflow-hidden">
            {/* Media background */}
            {mediaUrl ? (
              <video
                src={mediaUrl}
                className="absolute inset-0 w-full h-full object-cover"
                muted
                loop
                autoPlay
                playsInline
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-b from-gray-900 to-gray-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <Film size={36} className="text-white/10" />
                  <p className="text-white/15 text-[10px] text-center leading-relaxed px-6">
                    Selecione um vídeo para ver o preview
                  </p>
                </div>
              </div>
            )}

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80 pointer-events-none" />

            {/* Story bar (only for story type) */}
            {postType === "story" && (
              <div className="absolute top-10 inset-x-3 flex gap-1">
                <div className="flex-1 h-0.5 rounded-full bg-white/80" />
                <div className="flex-1 h-0.5 rounded-full bg-white/30" />
                <div className="flex-1 h-0.5 rounded-full bg-white/30" />
              </div>
            )}

            {/* Top bar label (for reels) */}
            {postType === "reel" && (
              <div className="absolute top-10 inset-x-0 flex items-center justify-between px-4">
                <span className="text-white text-[11px] font-bold tracking-widest opacity-80">REELS</span>
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-white/20" />
                  <div className="w-5 h-5 rounded-full bg-white/20" />
                </div>
              </div>
            )}

            {/* Right action buttons */}
            <div className="absolute right-2 bottom-[72px] flex flex-col items-center gap-4">
              <div className="flex flex-col items-center gap-0.5">
                <Heart size={22} className="text-white" fill="white" />
                <span className="text-white text-[9px]">1.2K</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <MessageCircle size={22} className="text-white" />
                <span className="text-white text-[9px]">48</span>
              </div>
              <Share2 size={22} className="text-white" />
              <MoreHorizontal size={22} className="text-white" />
            </div>

            {/* Bottom info */}
            <div className="absolute bottom-[52px] left-3 right-12">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex-shrink-0 border border-white/30" />
                <span className="text-white text-[11px] font-semibold drop-shadow">
                  {accountName ? `@${accountName}` : "@sua_conta"}
                </span>
                <span className="text-[9px] text-white/70 border border-white/40 rounded px-1.5 py-px">
                  Seguir
                </span>
              </div>

              {caption ? (
                <p className="text-white text-[10px] leading-relaxed line-clamp-2 drop-shadow">
                  {caption}
                </p>
              ) : (
                <p className="text-white/25 text-[10px] italic">Sua legenda aparece aqui...</p>
              )}

              {firstComment && (
                <p className="text-white/50 text-[9px] mt-1 flex items-center gap-1">
                  <Hash size={8} />
                  <span className="truncate">{firstComment.slice(0, 40)}{firstComment.length > 40 && "…"}</span>
                </p>
              )}
            </div>

            {/* Bottom nav bar */}
            <div className="absolute bottom-0 inset-x-0 h-[48px] bg-black/90 border-t border-white/[0.07] flex items-center justify-around px-3">
              {[0, 1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className={cn(
                    "w-5 h-5 rounded-sm",
                    i === 4 ? "rounded-full bg-gradient-to-br from-violet-500 to-cyan-500" : "bg-white/20"
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Post type label */}
      <span className="text-white/25 text-xs">
        {POST_TYPES.find(t => t.value === postType)?.label} · {POST_TYPES.find(t => t.value === postType)?.desc}
      </span>
    </div>
  );
}

// ── SectionCard ────────────────────────────────────────────────────────────

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glass-card p-5 rounded-2xl", className)}>
      {children}
    </div>
  );
}

function SectionLabel({ Icon, children }: { Icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={15} className="text-white/40" />
      <span className="text-xs font-semibold uppercase tracking-widest text-white/40">{children}</span>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function PostarPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // Form state
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaFilename, setMediaFilename] = useState("");
  const [caption, setCaption] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [postType, setPostType] = useState<"reel" | "feed" | "story">("reel");
  const [publishNow, setPublishNow] = useState(true);
  const [scheduledFor, setScheduledFor] = useState("");

  // Upload state
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Library modal
  const [showLibrary, setShowLibrary] = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<PublishResult[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Minimum datetime for scheduling (now + 5 min)
  const minDatetime = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  // ── Fetch accounts ──────────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/accounts/list");
      const data = await res.json() as { accounts: Account[] };
      setAccounts((data.accounts ?? []).filter(a => a.is_active));
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // ── File upload ─────────────────────────────────────────────────
  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) {
      setUploadError("Apenas arquivos de vídeo são aceitos.");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setUploadError("Arquivo muito grande. Limite: 500 MB.");
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(0);

    const supabase = createClient();
    const ext = file.name.split(".").pop() ?? "mp4";
    const path = `posts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    // Simulate progress since Supabase SDK doesn't provide upload progress
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + 8, 88));
    }, 300);

    try {
      const { error: uploadErr } = await supabase.storage
        .from("videos-library")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });

      clearInterval(progressInterval);

      if (uploadErr) throw new Error(uploadErr.message);

      const { data: { publicUrl } } = supabase.storage
        .from("videos-library")
        .getPublicUrl(path);

      setUploadProgress(100);
      setMediaUrl(publicUrl);
      setMediaFilename(file.name);
    } catch (err) {
      clearInterval(progressInterval);
      setUploadError(err instanceof Error ? err.message : "Falha no upload.");
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  const clearMedia = () => {
    setMediaUrl(null);
    setMediaFilename("");
    setUploadProgress(0);
    setUploadError(null);
  };

  // ── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!mediaUrl) { setSubmitError("Selecione ou faça upload de um vídeo."); return; }
    if (accountIds.length === 0) { setSubmitError("Selecione ao menos uma conta."); return; }
    if (!publishNow && !scheduledFor) { setSubmitError("Defina a data e hora para agendamento."); return; }

    setSubmitError(null);
    setResults(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/posts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_url: mediaUrl,
          caption,
          first_comment: firstComment,
          post_type: postType,
          scheduled_for: publishNow ? null : new Date(scheduledFor).toISOString(),
          account_ids: accountIds,
        }),
      });

      const data = await res.json() as {
        success: boolean;
        scheduled?: boolean;
        results?: PublishResult[];
        error?: string;
      };

      if (!res.ok || data.error) {
        setSubmitError(data.error ?? "Erro ao processar post.");
        return;
      }

      if (data.scheduled) {
        setScheduled(true);
      } else if (data.results) {
        setResults(data.results);
      }
    } catch {
      setSubmitError("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setResults(null);
    setScheduled(false);
    setSubmitError(null);
    setMediaUrl(null);
    setMediaFilename("");
    setCaption("");
    setFirstComment("");
    setAccountIds([]);
    setPublishNow(true);
    setScheduledFor("");
  };

  const firstSelectedAccount = accounts.find(a => a.id === accountIds[0]);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="page-title">Novo Post</h1>
        <p className="page-subtitle">Publique agora ou agende para uma data específica</p>
      </div>

      {/* Success state */}
      <AnimatePresence>
        {(results || scheduled) && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="mb-6"
          >
            {scheduled ? (
              <div className="glass-card p-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                  <CalendarDays size={20} className="text-cyan-400" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-semibold text-sm">Post agendado com sucesso!</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    Será publicado em {new Date(scheduledFor).toLocaleString("pt-BR")}
                  </p>
                </div>
                <button onClick={handleReset} className="btn-ghost text-xs px-4 py-2">
                  Novo post
                </button>
              </div>
            ) : results && (
              <div className="glass-card p-5 rounded-2xl">
                <p className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                  {results.every(r => r.status === "published") ? (
                    <><CheckCircle2 size={16} className="text-green-400" /> Publicado com sucesso!</>
                  ) : results.some(r => r.status === "published") ? (
                    <><AlertCircle size={16} className="text-yellow-400" /> Publicado parcialmente</>
                  ) : (
                    <><AlertCircle size={16} className="text-red-400" /> Falha na publicação</>
                  )}
                </p>
                <div className="space-y-2">
                  {results.map(r => (
                    <div key={r.account_id} className="flex items-center gap-3 text-sm">
                      {r.status === "published" ? (
                        <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                      )}
                      <span className="text-white/70">@{r.username}</span>
                      {r.error && <span className="text-red-400/60 text-xs truncate">{r.error}</span>}
                    </div>
                  ))}
                </div>
                <button onClick={handleReset} className="mt-4 btn-ghost text-xs px-4 py-2">
                  Criar novo post
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main layout */}
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* ── Left: Form ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* 1. Contas */}
          <SectionCard>
            <SectionLabel Icon={Users}>Para quais contas</SectionLabel>
            {loadingAccounts ? (
              <div className="flex items-center gap-2 text-white/30 text-sm">
                <Loader2 size={16} className="animate-spin" /> Carregando contas...
              </div>
            ) : (
              <AccountsSelect accounts={accounts} selected={accountIds} onChange={setAccountIds} />
            )}
          </SectionCard>

          {/* 2. Mídia */}
          <SectionCard>
            <SectionLabel Icon={Film}>Mídia</SectionLabel>

            {/* D&D zone */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !mediaUrl && !isUploading && fileInputRef.current?.click()}
              className={cn(
                "relative rounded-xl border-2 border-dashed transition-all",
                isDragOver ? "border-violet-500 bg-violet-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20",
                (!mediaUrl && !isUploading) && "cursor-pointer",
                isUploading && "pointer-events-none"
              )}
            >
              <AnimatePresence mode="wait">
                {!mediaUrl && !isUploading && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-10 flex flex-col items-center gap-3"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center">
                      <Upload size={22} className="text-white/25" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-white/50">
                        Arraste um vídeo ou <span className="text-violet-400 underline underline-offset-2">clique para selecionar</span>
                      </p>
                      <p className="text-xs text-white/20 mt-1">MP4, MOV, WebM · até 500 MB</p>
                    </div>
                  </motion.div>
                )}

                {isUploading && (
                  <motion.div
                    key="uploading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-8 flex flex-col items-center gap-4 px-8"
                  >
                    <Loader2 size={28} className="text-violet-400 animate-spin" />
                    <p className="text-sm text-white/60">Enviando... {uploadProgress}%</p>
                    <div className="w-full h-1.5 rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-500"
                        animate={{ width: `${uploadProgress}%` }}
                        transition={{ ease: "easeOut" }}
                      />
                    </div>
                  </motion.div>
                )}

                {mediaUrl && !isUploading && (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="p-4 flex items-center gap-4"
                  >
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/50 flex-shrink-0 border border-white/10">
                      <video src={mediaUrl} className="w-full h-full object-cover" muted preload="metadata" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{mediaFilename || "Vídeo selecionado"}</p>
                      <p className="text-xs text-green-400 mt-0.5 flex items-center gap-1">
                        <CheckCircle2 size={11} /> Pronto para publicar
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); clearMedia(); }}
                      className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-white/40 hover:text-white transition-colors flex-shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Upload error */}
            {uploadError && (
              <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle size={12} /> {uploadError}
              </p>
            )}

            {/* Library button */}
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-white/50 text-sm hover:border-white/20 hover:text-white/70 transition-all"
            >
              <FolderOpen size={15} />
              Escolher da Biblioteca
            </button>

            <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileChange} className="sr-only" />
          </SectionCard>

          {/* 3. Conteúdo */}
          <SectionCard>
            <SectionLabel Icon={Type}>Conteúdo</SectionLabel>

            {/* Caption */}
            <div className="relative mb-4">
              <label className="block text-xs text-white/40 mb-2">Legenda</label>
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value.slice(0, MAX_CHARS))}
                rows={4}
                placeholder="Escreva uma legenda envolvente..."
                className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm placeholder-white/25 resize-none focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all leading-relaxed"
              />
              <span className={cn(
                "absolute bottom-3 right-3 text-[10px] transition-colors",
                caption.length > MAX_CHARS * 0.9 ? "text-yellow-400" : "text-white/20"
              )}>
                {caption.length}/{MAX_CHARS}
              </span>
            </div>

            {/* First comment */}
            <div className="relative">
              <label className="block text-xs text-white/40 mb-2 flex items-center gap-1.5">
                <Hash size={11} /> Primeiro comentário
                <span className="text-white/20 font-normal normal-case">(opcional · ideal para hashtags)</span>
              </label>
              <textarea
                value={firstComment}
                onChange={e => setFirstComment(e.target.value.slice(0, MAX_CHARS))}
                rows={2}
                placeholder="#hashtags #engajamento #conteudo"
                className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm placeholder-white/25 resize-none focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all leading-relaxed"
              />
              <span className={cn(
                "absolute bottom-3 right-3 text-[10px] transition-colors",
                firstComment.length > MAX_CHARS * 0.9 ? "text-yellow-400" : "text-white/20"
              )}>
                {firstComment.length}/{MAX_CHARS}
              </span>
            </div>
          </SectionCard>

          {/* 4. Tipo de post */}
          <SectionCard>
            <SectionLabel Icon={Clapperboard}>Tipo de post</SectionLabel>
            <div className="grid grid-cols-3 gap-3">
              {POST_TYPES.map(({ value, label, Icon, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPostType(value)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                    postType === value
                      ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                      : "border-white/10 bg-white/[0.02] text-white/40 hover:border-white/20 hover:text-white/60"
                  )}
                >
                  <Icon size={20} />
                  <div className="text-center">
                    <p className="text-xs font-semibold">{label}</p>
                    <p className="text-[10px] opacity-60 mt-0.5">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>

          {/* 5. Publicação */}
          <SectionCard>
            <SectionLabel Icon={CalendarDays}>Publicação</SectionLabel>

            {/* Toggle now / schedule */}
            <div className="flex rounded-xl overflow-hidden border border-white/10 mb-4">
              <button
                type="button"
                onClick={() => setPublishNow(true)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all",
                  publishNow
                    ? "bg-violet-600/90 text-white"
                    : "bg-white/[0.03] text-white/40 hover:text-white/60"
                )}
              >
                <Zap size={15} /> Publicar agora
              </button>
              <button
                type="button"
                onClick={() => setPublishNow(false)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all",
                  !publishNow
                    ? "bg-cyan-600/90 text-white"
                    : "bg-white/[0.03] text-white/40 hover:text-white/60"
                )}
              >
                <Clock size={15} /> Agendar
              </button>
            </div>

            <AnimatePresence>
              {!publishNow && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <label className="block text-xs text-white/40 mb-2">Data e hora</label>
                  <input
                    type="datetime-local"
                    value={scheduledFor}
                    min={minDatetime}
                    onChange={e => setScheduledFor(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all [color-scheme:dark]"
                  />
                  <p className="mt-1.5 text-xs text-white/25">
                    Horário local · mínimo 5 minutos a partir de agora
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </SectionCard>

          {/* Submit error */}
          {submitError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
            >
              <AlertCircle size={15} className="flex-shrink-0" />
              {submitError}
            </motion.div>
          )}

          {/* Submit button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || isUploading}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-white text-sm transition-all",
              publishNow
                ? "bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 hover:shadow-[0_0_24px_rgba(139,92,246,0.4)]"
                : "bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 hover:shadow-[0_0_24px_rgba(6,182,212,0.4)]",
              (submitting || isUploading) && "opacity-60 cursor-not-allowed"
            )}
          >
            {submitting ? (
              <><Loader2 size={18} className="animate-spin" />
                {publishNow ? "Publicando..." : "Agendando..."}</>
            ) : (
              <><Send size={18} />
                {publishNow
                  ? `Publicar agora${accountIds.length > 1 ? ` (${accountIds.length} contas)` : ""}`
                  : "Agendar post"
                }</>
            )}
          </button>
        </div>

        {/* ── Right: Phone Preview ── */}
        <div className="lg:sticky lg:top-8 w-full lg:w-[300px] flex-shrink-0 flex justify-center">
          <PhoneMockup
            mediaUrl={mediaUrl}
            caption={caption}
            firstComment={firstComment}
            accountName={firstSelectedAccount?.username ?? null}
            postType={postType}
          />
        </div>
      </div>

      {/* Library modal */}
      <AnimatePresence>
        {showLibrary && (
          <LibraryModal
            onSelect={(url, name) => {
              setMediaUrl(url);
              setMediaFilename(name);
              setShowLibrary(false);
            }}
            onClose={() => setShowLibrary(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
