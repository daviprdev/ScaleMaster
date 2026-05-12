"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import {
  X,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Instagram,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryVideo } from "./VideoCard";
import type { PostResult } from "@/app/api/posts/publish/route";

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  access_token: string | null;
}

interface PostModalProps {
  video: LibraryVideo;
  onClose: () => void;
}

export function PostModal({ video, onClose }: PostModalProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [caption, setCaption] = useState(video.caption ?? "");
  const [posting, setPosting] = useState(false);
  const [results, setResults] = useState<PostResult[] | null>(null);

  useEffect(() => {
    fetch("/api/accounts/list")
      .then(r => r.json())
      .then(data => {
        const accs: Account[] = (data.accounts ?? []).filter((a: Account) => a.is_active);
        setAccounts(accs);
        // Pré-seleciona todas as contas com sessão salva
        setSelectedIds(accs.filter(a => a.access_token).map(a => a.id));
      })
      .finally(() => setLoadingAccounts(false));
  }, []);

  const toggleAccount = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handlePost = async () => {
    if (!selectedIds.length || posting) return;
    setPosting(true);
    setResults(null);

    try {
      const res = await fetch("/api/posts/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: video.id,
          account_ids: selectedIds,
          caption,
        }),
      });
      const data = await res.json() as { results?: PostResult[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao publicar.");
      setResults(data.results ?? []);
    } catch (err) {
      setResults([{
        account_id: "",
        username: "",
        status: "error",
        error: err instanceof Error ? err.message : "Erro desconhecido.",
      }]);
    } finally {
      setPosting(false);
    }
  };

  const allDone = results !== null;
  const allOk = results?.every(r => r.status === "ok");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="glass w-full max-w-md rounded-2xl border border-white/[0.08] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center">
              <Instagram size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white/85">Postar agora</p>
              <p className="text-[10px] text-white/30 truncate max-w-[200px]">
                {video.filename.replace(/_clean_\d+\.mp4$/, "")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] flex items-center justify-center text-white/40 hover:text-white/70 transition-all"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Results view */}
          {allDone && (
            <div className="space-y-3">
              <div className={cn(
                "flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-medium",
                allOk
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
              )}>
                {allOk ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                {allOk
                  ? "Publicado com sucesso em todas as contas!"
                  : "Publicado com erros em algumas contas."}
              </div>

              <div className="space-y-2">
                {results!.map((r, i) => (
                  <div
                    key={r.account_id || i}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs",
                      r.status === "ok"
                        ? "bg-emerald-500/8 border-emerald-500/15 text-emerald-300"
                        : "bg-red-500/8 border-red-500/15 text-red-400"
                    )}
                  >
                    {r.status === "ok"
                      ? <CheckCircle2 size={13} className="flex-shrink-0" />
                      : <AlertCircle size={13} className="flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      {r.username && <span className="font-medium">@{r.username}</span>}
                      {r.status === "error" && r.error && (
                        <p className="text-[10px] opacity-70 truncate mt-0.5">{r.error}</p>
                      )}
                      {r.status === "ok" && r.media_id && (
                        <p className="text-[10px] opacity-50 mt-0.5">ID: {r.media_id}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white/80 hover:bg-white/8 text-sm font-medium transition-all"
              >
                Fechar
              </button>
            </div>
          )}

          {/* Form view */}
          {!allDone && (
            <>
              {/* Warning */}
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/15 text-amber-400/80 text-[11px]">
                <Info size={12} className="flex-shrink-0 mt-0.5" />
                Postagem via instagrapi funciona apenas localmente. A sessão precisa estar salva (reconecte a conta se necessário).
              </div>

              {/* Account selector */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  Contas
                </p>

                {loadingAccounts ? (
                  <div className="flex items-center gap-2 py-4 text-white/30 text-sm">
                    <Loader2 size={14} className="animate-spin" />
                    Carregando contas...
                  </div>
                ) : accounts.length === 0 ? (
                  <p className="text-sm text-white/30 py-2">
                    Nenhuma conta conectada. Vá em Contas para adicionar.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {accounts.map(acc => {
                      const isSelected = selectedIds.includes(acc.id);
                      const hasSession = !!acc.access_token;
                      return (
                        <button
                          key={acc.id}
                          onClick={() => hasSession && toggleAccount(acc.id)}
                          disabled={!hasSession}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-150 text-left",
                            !hasSession
                              ? "opacity-40 cursor-not-allowed border-white/[0.05] bg-white/[0.02]"
                              : isSelected
                                ? "bg-violet-600/15 border-violet-500/35"
                                : "bg-white/[0.03] border-white/[0.07] hover:border-white/15 hover:bg-white/[0.06]"
                          )}
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 flex items-center justify-center flex-shrink-0">
                            <Instagram size={14} className="text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-sm font-medium truncate", isSelected ? "text-violet-200" : "text-white/70")}>
                              @{acc.username}
                            </p>
                            <p className="text-[10px] text-white/25">
                              {!hasSession ? "Reconecte para postar" : acc.display_name ?? ""}
                            </p>
                          </div>
                          <div className={cn(
                            "w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0",
                            isSelected ? "border-violet-500 bg-violet-500" : "border-white/20"
                          )}>
                            {isSelected && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Caption */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                  Legenda
                </p>
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  placeholder="Escreva a legenda do post..."
                  rows={3}
                  className="w-full input-glass rounded-xl px-3.5 py-3 text-sm resize-none"
                />
                <p className="text-[10px] text-white/20 text-right">{caption.length} caracteres</p>
              </div>

              {/* Post button */}
              <motion.button
                onClick={handlePost}
                disabled={posting || !selectedIds.length}
                whileTap={posting || !selectedIds.length ? {} : { scale: 0.97 }}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all",
                  posting || !selectedIds.length
                    ? "bg-white/5 border border-white/10 text-white/30 cursor-not-allowed"
                    : "bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500 text-white hover:shadow-[0_0_20px_rgba(219,39,119,0.35)]"
                )}
              >
                {posting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Publicando em {selectedIds.length} conta{selectedIds.length > 1 ? "s" : ""}...
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    Postar agora
                    {selectedIds.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-white/15 text-[10px] font-bold">
                        {selectedIds.length}
                      </span>
                    )}
                  </>
                )}
              </motion.button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
