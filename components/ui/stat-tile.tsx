import * as React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "positive" | "negative" | "neutral";

interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
 label: string;
 value: string;
 delta?: string;
 tone?: StatTone;
 hint?: string;
 icon?: React.ReactNode;
 spark?: number[];
 children?: React.ReactNode;
}

const toneStyles: Record<StatTone, string> = {
 positive: "text-success",
 negative: "text-danger",
 neutral: "text-ink-3",
};

const ToneIcon = {
 positive: TrendingUp,
 negative: TrendingDown,
 neutral: Minus,
};

/** Simple polyline sparkline — 96×28 in accent color */
function Sparkline({ data }: { data: number[] }) {
 if (data.length < 2) return null;
 const max = Math.max(...data);
 const min = Math.min(...data);
 const range = max - min || 1;
 const w = 96;
 const h = 28;
 const points = data
 .map((v, i) => {
 const x = (i / (data.length - 1)) * w;
 const y = h - ((v - min) / range) * h;
 return `${x.toFixed(1)},${y.toFixed(1)}`;
 })
 .join(" ");

 return (
 <svg
 width={w}
 height={h}
 viewBox={`0 0 ${w} ${h}`}
 className="shrink-0"
 aria-hidden="true"
 >
 <polyline
 points={points}
 fill="none"
 stroke="var(--accent)"
 strokeWidth="1.75"
 strokeLinecap="round"
 strokeLinejoin="round"
 />
 </svg>
 );
}

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
 spark,
 children,
 ...props
 },
 ref
 ) => {
 const DeltaIcon = ToneIcon[tone];

 return (
 <div
 ref={ref}
 className={cn(
 "flex flex-col gap-2 rounded-xl border border-line bg-surface p-5",
 className
 )}
 {...props}
 >
 <div className="flex items-start justify-between gap-2">
 <span className="text-[13px] font-medium leading-[18px] text-ink-2">
 {label}
 </span>
 {icon && <span className="text-ink-3">{icon}</span>}
 </div>

 <div className="flex items-end gap-3">
 <span className="font-mono text-[28px] font-medium leading-[32px] tracking-[-0.02em] tabular-nums text-ink">
 {value}
 </span>
 {delta && (
 <span
 className={cn(
 "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
 toneStyles[tone]
 )}
 >
 <DeltaIcon size={12} strokeWidth={2} />
 {delta}
 </span>
 )}
 </div>

 {hint && <p className="text-xs text-ink-3">{hint}</p>}

 {spark && spark.length >= 2 && <Sparkline data={spark} />}

 {children}
 </div>
 );
 }
);
StatTile.displayName = "StatTile";