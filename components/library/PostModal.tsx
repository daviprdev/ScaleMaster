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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryVideo } from "./VideoCard";
import type { PostResult } from "@/app/api/posts/publish/route";
import { CaptionModeSelector, OriginalCaptionText } from "@/components/dashboard/CaptionModeSelector";
import { hasOriginalCaption, type CaptionMode } from "@/lib/reel-captions";

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  ig_business_account_id: string | null;
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
  // Padrão histórico deste modal: a caixa de texto vinha pré-preenchida com
  // a legenda do vídeo e era ela que ia para a Meta — ou seja, "custom".
  // Manter isso e deixar o modo Original como escolha explícita.
  const [captionMode, setCaptionMode] = useState<CaptionMode>("custom");
  const temOriginal = hasOriginalCaption(video.caption);
  const [posting, setPosting] = useState(false);
  const [results, setResults] = useState<PostResult[] | null>(null);

  useEffect(() => {
    fetch("/api/accounts/list")
      .then(r => r.json())
      .then(data => {
        const accs: Account[] = (data.accounts ?? []).filter((a: Account) => a.is_active);
        setAccounts(accs);
        setSelectedIds(accs.filter(a => a.ig_business_account_id).map(a => a.id));
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
          // Em modo original o servidor busca a legenda no banco e ignora
          // o texto acima — o cliente não decide o conteúdo.
          caption_mode: captionMode,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
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
            <div className="w-7 h-7 rounded-lg bg-gradient-primary flex items-center justify-center">
              <Instagram size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">Postar agora</p>
              <p className="text-[10px] text-ink-3 truncate max-w-[200px]">
                {video.filename.replace(/_clean_\d+\.mp4$/, "")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] flex items-center justify-center text-ink-3 hover:text-ink-2 transition-all"
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
                  ? "bg-success-soft border border-success/20 text-success"
                  : "bg-warning-soft border border-warning/20 text-warning"
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
                        ? "bg-success-soft border-success/15 text-success"
                        : "bg-danger-soft border-danger/15 text-danger"
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
                className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-ink-2 hover:text-ink hover:bg-white/8 text-sm font-medium transition-all"
              >
                Fechar
              </button>
            </div>
          )}

          {/* Form view */}
          {!allDone && (
            <>
                  {/* Account selector */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider">
                  Contas
                </p>

                {loadingAccounts ? (
                  <div className="flex items-center gap-2 py-4 text-ink-3 text-sm">
                    <Loader2 size={14} className="animate-spin" />
                    Carregando contas...
                  </div>
                ) : accounts.length === 0 ? (
                  <p className="text-sm text-ink-3 py-2">
                    Nenhuma conta conectada. Vá em Contas para adicionar.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {accounts.map(acc => {
                      const isSelected = selectedIds.includes(acc.id);
                      const isMeta = !!acc.ig_business_account_id;
                      const hasSession = isMeta;
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
                                ? "bg-info-soft border-primary/35"
                                : "bg-white/[0.03] border-white/[0.07] hover:border-white/15 hover:bg-white/[0.06]"
                          )}
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center flex-shrink-0">
                            <Instagram size={14} className="text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={cn("text-sm font-medium truncate", isSelected ? "text-link" : "text-ink-2")}>
                                @{acc.username}
                              </p>
                              {isMeta && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide bg-primary/20 text-link border border-primary/25">
                                  META
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-ink-3">
                              {!hasSession ? "Reconecte para postar" : acc.display_name ?? ""}
                            </p>
                          </div>
                          <div className={cn(
                            "w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0",
                            isSelected ? "border-primary bg-primary" : "border-white/20"
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
                <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider">
                  Legenda
                </p>

                <CaptionModeSelector
                  value={captionMode}
                  onChange={setCaptionMode}
                  showStripToggles={false}
                  originalHint={
                    temOriginal
                      ? <>Publica a legenda capturada junto do Reel, sem alterações.</>
                      : <>Este vídeo não tem legenda original disponível. Escolha{" "}
                          <strong>Personalizada</strong> ou <strong>Sem legenda</strong>.</>
                  }
                />

                {captionMode === "original" && (
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 max-h-32 overflow-y-auto">
                    <OriginalCaptionText caption={video.caption} />
                  </div>
                )}

                {captionMode === "custom" && (
                  <>
                    <textarea
                      value={caption}
                      onChange={e => setCaption(e.target.value)}
                      placeholder="Escreva a legenda do post..."
                      rows={3}
                      className="w-full input-glass rounded-xl px-3.5 py-3 text-sm resize-none"
                    />
                    <p className="text-[10px] text-ink-3 text-right">{caption.length} caracteres</p>
                  </>
                )}
              </div>

              {/* Post button */}
              <motion.button
                onClick={handlePost}
                disabled={posting || !selectedIds.length}
                whileTap={posting || !selectedIds.length ? {} : { scale: 0.97 }}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all",
                  posting || !selectedIds.length
                    ? "bg-white/5 border border-white/10 text-ink-3 cursor-not-allowed"
                    : "bg-gradient-primary hover:from-primary-hover hover:to-primary text-white hover:shadow-glow"
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
