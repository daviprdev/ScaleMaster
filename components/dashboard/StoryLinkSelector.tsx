"use client";

import { useState, useEffect, useCallback } from "react";
import NextLink from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Link2, Copy, Check, Loader2, ExternalLink, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { publicLinkUrl } from "@/lib/link-base-url";

export type StoryLinkMode = "none" | "direct" | "managed";

export interface StoryLinkValue {
  mode: StoryLinkMode;
  /** URL digitada, quando o modo é "direct". */
  directUrl: string;
  /** Id do link gerenciado, quando o modo é "managed". */
  managedLinkId: string | null;
}

export const EMPTY_STORY_LINK: StoryLinkValue = {
  mode: "none", directUrl: "", managedLinkId: null,
};

interface ManagedLinkOption {
  id: string;
  slug: string;
  name: string | null;
  destination_url: string;
  status: string;
}

/**
 * Seletor de link do Story.
 *
 * LIMITAÇÃO REAL, DITA NA CARA DO USUÁRIO: a Content Publishing API do
 * Instagram não aceita link sticker — o mesmo motivo pelo qual Stories também
 * não aceitam legenda por API. O que este seletor faz é registrar QUAL link
 * está sendo divulgado com aquela leva de Stories e deixá-lo pronto para
 * copiar. Prometer que o sticker aparece sozinho seria mentira.
 *
 * Escolher um link gerenciado guarda a URL PÚBLICA (`/r/{slug}`), nunca o
 * `destination_url` — é justamente o que permite trocar o destino depois sem
 * refazer nada.
 */
export function StoryLinkSelector({
  value, onChange,
}: {
  value: StoryLinkValue;
  onChange: (v: StoryLinkValue) => void;
}) {
  const [links, setLinks] = useState<ManagedLinkOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/links?status=active", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { links?: ManagedLinkOption[] };
      setLinks(data.links ?? []);
    } catch { /* sem links a lista fica vazia e o empty state explica */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (value.mode === "managed" && links.length === 0 && !loading) loadLinks();
  }, [value.mode, links.length, loading, loadLinks]);

  const selected = links.find((l) => l.id === value.managedLinkId) ?? null;
  const previewUrl =
    value.mode === "managed" && selected ? publicLinkUrl(selected.slug)
    : value.mode === "direct" ? value.directUrl.trim()
    : "";

  const handleCopy = async () => {
    if (!previewUrl) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* contexto não seguro */ }
  };

  const MODES: { key: StoryLinkMode; label: string }[] = [
    { key: "none", label: "Sem link" },
    { key: "direct", label: "Link direto" },
    { key: "managed", label: "Link gerenciado" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange({ ...value, mode: m.key })}
            className={cn(
              "px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all",
              value.mode === m.key
                ? "bg-[#00FF41]/10 border-[#00FF41]/25 text-[#00FF41]"
                : "bg-white/[0.02] border-white/[0.06] text-white/40 hover:text-white/70"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {value.mode === "direct" && (
          <motion.div
            key="direct"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <input
              value={value.directUrl}
              onChange={(e) => onChange({ ...value, directUrl: e.target.value })}
              placeholder="https://destino.com/pagina"
              className="input-glass w-full px-3.5 py-2.5 rounded-xl text-sm font-mono"
            />
          </motion.div>
        )}

        {value.mode === "managed" && (
          <motion.div
            key="managed"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden space-y-2"
          >
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-white/30 py-2">
                <Loader2 size={12} className="animate-spin" /> Carregando links...
              </div>
            ) : links.length === 0 ? (
              <div className="px-3.5 py-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <p className="text-xs text-white/40">Nenhum link ativo ainda.</p>
                <NextLink
                  href="/dashboard/links"
                  className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-semibold text-[#00FF41] hover:underline"
                >
                  <Link2 size={11} /> Criar um link gerenciado <ExternalLink size={10} />
                </NextLink>
              </div>
            ) : (
              <select
                value={value.managedLinkId ?? ""}
                onChange={(e) => onChange({ ...value, managedLinkId: e.target.value || null })}
                className="input-glass w-full px-3 py-2.5 rounded-xl text-sm"
              >
                <option value="">Selecione um link...</option>
                {links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name ? `${l.name} — /r/${l.slug}` : `/r/${l.slug}`}
                  </option>
                ))}
              </select>
            )}

            {selected && (
              <p className="text-[11px] text-white/30 leading-relaxed">
                Destino atual: <span className="font-mono text-white/50">{selected.destination_url}</span>.
                Trocar o destino depois não muda o link divulgado.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {previewUrl && (
        <button
          type="button"
          onClick={handleCopy}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#00FF41]/[0.05] border border-[#00FF41]/20 text-left"
        >
          <span className="flex-1 min-w-0 text-xs font-mono text-[#00FF41] truncate">{previewUrl}</span>
          {copied
            ? <Check size={13} className="text-[#00FF41] flex-shrink-0" />
            : <Copy size={13} className="text-[#00FF41]/50 flex-shrink-0" />}
        </button>
      )}

      {value.mode !== "none" && (
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/15">
          <Info size={13} className="text-amber-400/70 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-white/40 leading-relaxed">
            A API do Instagram <span className="text-amber-300/80 font-medium">não permite anexar o sticker de link</span> ao
            publicar um Story — a mesma limitação que impede legenda. O link fica registrado aqui para você
            acompanhar os cliques e copiar quando for adicionar o sticker no app.
          </p>
        </div>
      )}
    </div>
  );
}
