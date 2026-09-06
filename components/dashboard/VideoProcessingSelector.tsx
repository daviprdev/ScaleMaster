"use client";

/**
 * VideoProcessingSelector — seletor de "Processamento do vídeo".
 *
 * Usado em todas as telas que configuram publicação (Postar, Loop, Automatizar,
 * Clonar, Stories). O valor selecionado é persistido junto com a publicação —
 * não vive só no estado do React.
 *
 * Conceito separado dos EFEITOS CRIATIVOS do Loop (espelho, zoom, blur, ruído…),
 * que têm pipeline próprio e re-encodam por definição.
 */

import { Check, FileVideo, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

export type VideoProcessingMode = "original" | "clean_metadata";

interface OptionSpec {
  value: VideoProcessingMode;
  title: string;
  badge?: string;
  description: string;
  Icon: React.ElementType;
  accent: string;
}

const OPTIONS: OptionSpec[] = [
  {
    value: "original",
    title: "Sem limpeza",
    badge: "RECOM.",
    description:
      "Envia o vídeo original exatamente como está armazenado. Sem FFmpeg, remux ou alteração de qualidade.",
    Icon: FileVideo,
    accent: "var(--matrix)",
  },
  {
    value: "clean_metadata",
    title: "Limpeza de metadados",
    description:
      "Cria uma versão limpa do arquivo usando stream copy, sem reencodar vídeo ou áudio.",
    Icon: Eraser,
    accent: "var(--electric)",
  },
];

export function VideoProcessingSelector({
  value,
  onChange,
  className,
  compact = false,
}: {
  value: VideoProcessingMode;
  onChange: (mode: VideoProcessingMode) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={className}>
      {!compact && (
        <p className="text-[11px] text-white/35 mb-3">
          Escolha como o arquivo será preparado antes da publicação.
        </p>
      )}

      <div
        className="grid gap-2.5 sm:grid-cols-2"
        role="radiogroup"
        aria-label="Processamento do vídeo"
      >
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={cn(
                "group relative text-left p-3.5 rounded-xl border transition-all",
                "bg-white/[0.02] hover:bg-white/[0.04]",
                selected ? "border-transparent" : "border-white/[0.07]"
              )}
              style={
                selected
                  ? {
                      borderColor: opt.accent,
                      boxShadow: `0 0 0 1px ${opt.accent}, 0 0 18px -6px ${opt.accent}`,
                    }
                  : undefined
              }
            >
              <div className="flex items-start gap-2.5">
                {/* radio */}
                <span
                  className={cn(
                    "mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors",
                    selected ? "border-transparent" : "border-white/20"
                  )}
                  style={selected ? { backgroundColor: opt.accent } : undefined}
                >
                  {selected && <Check size={11} className="text-black" strokeWidth={3} />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <opt.Icon
                      size={12}
                      style={{ color: selected ? opt.accent : undefined }}
                      className={selected ? undefined : "text-white/35"}
                    />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        selected ? "text-white" : "text-white/70"
                      )}
                    >
                      {opt.title}
                    </span>
                    {opt.badge && (
                      <span
                        className="px-1.5 py-[1px] rounded text-[9px] font-bold tracking-wider"
                        style={{
                          color: opt.accent,
                          backgroundColor: `color-mix(in srgb, ${opt.accent} 14%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${opt.accent} 30%, transparent)`,
                        }}
                      >
                        {opt.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                    {opt.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default VideoProcessingSelector;
