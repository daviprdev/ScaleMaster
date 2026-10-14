import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressBarSegment {
  value: number;
  tone?: "success" | "warning" | "danger" | "neutral";
  label?: string;
}

interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Single value (0-100) for simple bar */
  value?: number;
  /** Segments for multi-color bar */
  segments?: ProgressBarSegment[];
  /** Total for segment calculation */
  total?: number;
  /** Height variant */
  size?: "sm" | "md";
  /** Show percentage label */
  showLabel?: boolean;
}

const toneColors = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-primary",
};

export const ProgressBar = React.forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ className, value, segments, total, size = "md", showLabel, ...props }, ref) => {
    const heightClass = size === "sm" ? "h-1.5" : "h-2.5";

    // Simple single-value bar
    if (value !== undefined && !segments) {
      const clampedValue = Math.min(100, Math.max(0, value));
      return (
        <div className={cn("flex flex-col gap-1", className)} {...props}>
          <div
            ref={ref}
            role="progressbar"
            aria-valuenow={clampedValue}
            aria-valuemin={0}
            aria-valuemax={100}
            className={cn("w-full overflow-hidden rounded-full bg-line", heightClass)}
          >
            <div
              className={cn("h-full rounded-full bg-primary transition-all duration-300 ease-out")}
              style={{ width: `${clampedValue}%` }}
            />
          </div>
          {showLabel && (
            <span className="text-xs font-mono tabular-nums text-ink-3">
              {Math.round(clampedValue)}%
            </span>
          )}
        </div>
      );
    }

    // Segmented bar
    if (segments && segments.length > 0) {
      const segTotal = total ?? segments.reduce((sum, s) => sum + s.value, 0);
      return (
        <div className={cn("flex flex-col gap-1", className)} {...props}>
          <div
            ref={ref}
            role="progressbar"
            className={cn("flex w-full overflow-hidden rounded-full bg-line", heightClass)}
          >
            {segments.map((seg, i) => {
              const pct = segTotal > 0 ? (seg.value / segTotal) * 100 : 0;
              return (
                <div
                  key={i}
                  className={cn(
                    "h-full transition-all duration-300 ease-out first:rounded-l-full last:rounded-r-full",
                    toneColors[seg.tone ?? "neutral"]
                  )}
                  style={{ width: `${pct}%` }}
                  title={seg.label ? `${seg.label}: ${seg.value}` : undefined}
                />
              );
            })}
          </div>
          {showLabel && segTotal > 0 && (
            <div className="flex gap-3 text-xs text-ink-3">
              {segments.map((seg, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span
                    className={cn("h-2 w-2 rounded-full", toneColors[seg.tone ?? "neutral"])}
                  />
                  {seg.label && <span>{seg.label}</span>}
                  <span className="font-mono tabular-nums">{seg.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    // Empty fallback
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={0}
        className={cn("w-full overflow-hidden rounded-full bg-line", heightClass, className)}
        {...props}
      />
    );
  }
);
ProgressBar.displayName = "ProgressBar";