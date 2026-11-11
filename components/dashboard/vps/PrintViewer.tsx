"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ExternalLink, X, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PrintItem {
  /** Chave da etapa (nome do arquivo do print). */
  key: string;
  /** Rótulo da etapa como aparece na checklist. */
  label: string;
  status: string | undefined;
  /** Mensagem da etapa: o resultado ou o erro. */
  message: string | null;
}

/** Miniatura clicável do print de uma etapa, no formato da tela do aparelho (9:16). */
export function PrintThumb({ src, label, erro, onOpen }: { src: string; label: string; erro?: boolean; onOpen: () => void }) {
  const [falhou, setFalhou] = React.useState(false);
  if (falhou) return null;
  return (
    <button
      type="button"
      title={`Ver o print: ${label}`}
      aria-label={`Ampliar o print de ${label}`}
      onClick={onOpen}
      className={cn(
        "group relative h-[72px] w-[41px] shrink-0 overflow-hidden rounded-md border bg-surface-raised transition-colors hover:border-accent",
        erro ? "border-danger" : "border-line"
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" className="h-full w-full object-cover object-top" onError={() => setFalhou(true)} />
      <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
        <ZoomIn size={16} className="text-white" />
      </span>
    </button>
  );
}

/**
 * Print ampliado por cima da página: a tela do aparelho grande, com a etapa,
 * o status e a mensagem (o erro em vermelho) ao lado. Setas (e ← →) passam
 * para os prints das outras etapas; Esc, o X ou o fundo fecham.
 */
export function PrintViewer({ itens, atual, src, onChange, onClose }: { itens: PrintItem[]; atual: string; src: (key: string) => string; onChange: (key: string) => void; onClose: () => void }) {
  const pos = Math.max(0, itens.findIndex((i) => i.key === atual));
  const item = itens[pos];
  const anterior = pos > 0 ? itens[pos - 1] : null;
  const proximo = pos < itens.length - 1 ? itens[pos + 1] : null;

  React.useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && anterior) onChange(anterior.key);
      else if (e.key === "ArrowRight" && proximo) onChange(proximo.key);
    };
    window.addEventListener("keydown", tecla);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", tecla);
      document.body.style.overflow = overflow;
    };
  }, [anterior, proximo, onChange, onClose]);

  if (!item || typeof document === "undefined") return null;
  const erro = item.status === "error";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Print da etapa ${item.label}`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col gap-4 overflow-auto rounded-xl border border-line bg-surface p-4 shadow-2xl sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-center gap-2">
          <button
            type="button"
            aria-label="Print anterior"
            disabled={!anterior}
            onClick={() => anterior && onChange(anterior.key)}
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-30"
          >
            <ChevronLeft size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={item.key}
            src={src(item.key)}
            alt={`Tela do aparelho ao fim da etapa ${item.label}`}
            className={cn("max-h-[78vh] w-auto rounded-lg border object-contain", erro ? "border-danger" : "border-line")}
          />
          <button
            type="button"
            aria-label="Próximo print"
            disabled={!proximo}
            onClick={() => proximo && onChange(proximo.key)}
            className="rounded-md p-1.5 text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-ink-3">
                Etapa {pos + 1} de {itens.length} com print
              </p>
              <p className="text-base font-semibold text-ink">{item.label}</p>
            </div>
            <button type="button" aria-label="Fechar" onClick={onClose} className="shrink-0 rounded-md p-1.5 text-ink-2 hover:bg-surface-hover hover:text-ink">
              <X size={18} />
            </button>
          </div>
          <p className={cn("text-sm font-medium", erro ? "text-danger" : item.status === "done" ? "text-success" : "text-ink-2")}>
            {erro ? "Falhou" : item.status === "done" ? "Concluída" : "Sem resultado"}
          </p>
          {item.message && (
            <p className={cn("whitespace-pre-wrap break-words rounded-lg border p-3 text-sm", erro ? "border-danger bg-danger-soft text-danger" : "border-line text-ink")}>
              {item.message}
            </p>
          )}
          <p className="text-xs text-ink-3">Tela do aparelho no fim da etapa. Use ← e → para passar entre as etapas; Esc fecha.</p>
          <a href={src(item.key)} target="_blank" rel="noreferrer noopener" className="inline-flex w-fit items-center gap-1.5 text-xs text-accent hover:underline">
            <ExternalLink size={13} />
            Abrir o print em tamanho real
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}
