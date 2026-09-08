"use client";

/**
 * CaptionModeSelector — de onde sai o texto da publicação.
 *
 * Mesmo padrão visual de ReelPlacementSelector e VideoProcessingSelector.
 *
 * O modo NÃO é apenas estado do React: é persistido na configuração
 * (`loops.caption_mode`, `distribute_campaigns.caption_mode`) e o texto
 * resolvido vira snapshot no post concreto.
 */

import { Check, FileText, PenLine, Ban, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CaptionMode } from "@/lib/reel-captions";

interface OptionSpec {
  value: CaptionMode;
  title: string;
  description: string;
  Icon: React.ElementType;
  accent: string;
}

const OPTIONS: OptionSpec[] = [
  {
    value: "original",
    title: "Original",
    description: "Usa a legenda capturada junto do Reel.",
    Icon: FileText,
    accent: "var(--matrix)",
  },
  {
    value: "custom",
    title: "Personalizada",
    description: "Use sua própria legenda.",
    Icon: PenLine,
    accent: "var(--electric)",
  },
  {
    value: "none",
    title: "Sem legenda",
    description: "Publica sem texto na descrição.",
    Icon: Ban,
    accent: "rgba(255,255,255,0.45)",
  },
];

export function CaptionModeSelector({
  value,
  onChange,
  stripHashtags = false,
  stripMentions = false,
  onStripHashtagsChange,
  onStripMentionsChange,
  /** Aviso extra do modo "original" — o Loop explica o caso de pasta mista. */
  originalHint,
  /** Só exibe os toggles de remoção quando o fluxo os persiste. */
  showStripToggles = true,
  className,
}: {
  value: CaptionMode;
  onChange: (mode: CaptionMode) => void;
  stripHashtags?: boolean;
  stripMentions?: boolean;
  onStripHashtagsChange?: (v: boolean) => void;
  onStripMentionsChange?: (v: boolean) => void;
  originalHint?: React.ReactNode;
  showStripToggles?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        className="grid gap-2.5 sm:grid-cols-3"
        role="radiogroup"
        aria-label="Legenda da publicação"
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
                  <div className="flex items-center gap-1.5">
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
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-white/35">
                    {opt.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {value === "original" && (
        <div className="mt-3 space-y-3">
          {originalHint && (
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/15">
              <AlertTriangle size={13} className="text-amber-400/70 mt-0.5 flex-shrink-0" />
              <div className="text-[11px] text-white/45 leading-relaxed">{originalHint}</div>
            </div>
          )}

          {showStripToggles && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold">
                Ajustes na legenda original
              </p>
              <StripToggle
                label="Remover hashtags"
                hint="Tira #tags do texto. Funciona com acento e outros alfabetos (#ação, #日本語)."
                checked={stripHashtags}
                onChange={onStripHashtagsChange}
              />
              <StripToggle
                label="Remover @menções"
                hint="Tira @perfis do texto — inclusive créditos ao criador original."
                checked={stripMentions}
                onChange={onStripMentionsChange}
              />
              <p className="text-[10px] text-white/25 leading-relaxed">
                Desligados, a legenda vai exatamente como estava no Reel original.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StripToggle({
  label, hint, checked, onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={!onChange}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all",
        checked
          ? "bg-[#00E5FF]/[0.06] border-[#00E5FF]/25"
          : "bg-white/[0.02] border-white/[0.06] hover:border-white/15",
        !onChange && "opacity-40 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all",
          checked ? "bg-[#00E5FF] border-[#00E5FF]" : "border-white/20"
        )}
      >
        {checked && <Check size={11} className="text-black" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-white/80">{label}</span>
        <span className="block text-[10px] text-white/35 leading-snug mt-0.5">{hint}</span>
      </span>
    </button>
  );
}

/**
 * Exibição de legenda original vinda de fonte externa.
 *
 * Renderiza como TEXTO. Nada de `dangerouslySetInnerHTML`: a legenda vem do
 * Instagram e pode conter qualquer coisa — `<script>alert(1)</script>` tem de
 * aparecer literalmente na tela, nunca ser interpretado. O React já escapa o
 * conteúdo de `{children}`, e `whitespace-pre-wrap` preserva as quebras de
 * linha originais sem precisar converter nada para HTML.
 */
export function OriginalCaptionText({
  caption,
  className,
}: {
  caption: string | null | undefined;
  className?: string;
}) {
  if (caption === null || caption === undefined) {
    return (
      <p className={cn("text-[11px] text-white/25 italic", className)}>
        Legenda original indisponível.
      </p>
    );
  }
  if (caption === "") {
    return (
      <p className={cn("text-[11px] text-white/25 italic", className)}>
        Este Reel não tinha legenda.
      </p>
    );
  }
  return (
    <p className={cn("text-[11px] text-white/60 whitespace-pre-wrap break-words", className)}>
      {caption}
    </p>
  );
}
