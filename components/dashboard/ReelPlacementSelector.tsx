"use client";

/**
 * ReelPlacementSelector — onde o Reel fica visível no perfil.
 *
 * Mapeia direto para o parâmetro `share_to_feed` da Meta Content Publishing API
 * (POST /{ig-user-id}/media), documentado assim na referência oficial:
 *   "When true, indicates that the reel can appear in both the Feed and Reels
 *    tabs. When false, indicates the reel can only appear in the Reels tab."
 *
 * Só se aplica a media_type=REELS — não aparece em Stories.
 */

import { Check, LayoutGrid, Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptionSpec {
  value: boolean;
  title: string;
  badge?: string;
  description: string;
  Icon: React.ElementType;
  accent: string;
}

const OPTIONS: OptionSpec[] = [
  {
    value: true,
    title: "Reels + grade",
    badge: "RECOM.",
    description: "Exibe o Reel na grade/feed do perfil e também na aba Reels.",
    Icon: LayoutGrid,
    accent: "var(--matrix)",
  },
  {
    value: false,
    title: "Somente Reels",
    description: "Exibe o conteúdo apenas na aba Reels do perfil.",
    Icon: Clapperboard,
    accent: "var(--electric)",
  },
];

export function ReelPlacementSelector({
  value,
  onChange,
  className,
  compact = false,
}: {
  value: boolean;
  onChange: (shareToFeed: boolean) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={className}>
      {!compact && (
        <p className="text-[11px] text-white/35 mb-3">
          Escolha onde o Reel ficará visível no Instagram.
        </p>
      )}

      <div
        className="grid gap-2.5 sm:grid-cols-2"
        role="radiogroup"
        aria-label="Exibição do Reel"
      >
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={String(opt.value)}
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

export default ReelPlacementSelector;
