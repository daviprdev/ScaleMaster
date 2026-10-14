import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
 tone?: BadgeTone;
 dot?: boolean;
}

const toneStyles: Record<BadgeTone, string> = {
 neutral: "bg-surface-hover text-ink-2 border-line",
 info: "bg-info-soft text-accent border-transparent",
 success: "bg-success-soft text-success border-transparent",
 warning: "bg-warning-soft text-warning border-transparent",
 danger: "bg-danger-soft text-danger border-transparent",
};

const dotColors: Record<BadgeTone, string> = {
 neutral: "bg-ink-3",
 info: "bg-accent",
 success: "bg-success",
 warning: "bg-warning",
 danger: "bg-danger",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
 ({ className, tone = "neutral", dot = false, children, ...props }, ref) => {
 return (
 <span
 ref={ref}
 className={cn(
 "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4 whitespace-nowrap",
 toneStyles[tone],
 className
 )}
 {...props}
 >
 {dot && (
 <span
 className={cn("h-1.5 w-1.5 rounded-full", dotColors[tone])}
 aria-hidden="true"
 />
 )}
 {children}
 </span>
 );
 }
);
Badge.displayName = "Badge";