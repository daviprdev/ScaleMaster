import * as React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "positive" | "negative" | "neutral";

interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string;
  delta?: string;
  tone?: StatTone;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** Fundo do quadrado do ícone (CSS background). Padrão: gradiente primário. */
  iconBg?: string;
  /** @deprecated A sparkline foi removida no redesign Aurora Pro; a prop é ignorada. */
  spark?: number[];
  children?: React.ReactNode;
}

const tonePill: Record<StatTone, string> = {
  positive: "bg-success-soft text-success",
  negative: "bg-danger-soft text-danger",
  neutral: "bg-white/[0.08] text-ink-2",
};

const ToneIcon = {
  positive: TrendingUp,
  negative: TrendingDown,
  neutral: Minus,
};

/**
 * KPI card — Aurora Pro.
 * Ícone em quadrado com gradiente + rótulo, pílula de variação à direita,
 * valor grande e dica. Sem sparkline.
 */
export const StatTile = React.forwardRef<HTMLDivElement, StatTileProps>(
  (
    {
      className,
      label,
      value,
      delta,
      tone = "neutral",
      hint,
      icon,
      iconBg,
      spark: _spark,
      children,
      ...props
    },
    ref
  ) => {
    const DeltaIcon = ToneIcon[tone];

    return (
      <div
        ref={ref}
        className={cn("glass-card flex flex-col gap-3 p-5", className)}
        {...props}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
                style={{ background: iconBg ?? "var(--gradient-primary)" }}
              >
                {icon}
              </span>
            )}
            <span className="truncate text-[13px] font-medium leading-[18px] text-ink-2">
              {label}
            </span>
          </div>
          {delta && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                tonePill[tone]
              )}
            >
              <DeltaIcon size={11} strokeWidth={2.25} />
              {delta}
            </span>
          )}
        </div>

        <span className="text-[30px] font-semibold leading-[36px] tracking-[-0.02em] tabular-nums text-ink">
          {value}
        </span>

        {hint && <p className="text-xs text-ink-3">{hint}</p>}

        {children}
      </div>
    );
  }
);
StatTile.displayName = "StatTile";
