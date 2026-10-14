"use client";
import * as React from "react";
import { X, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface GlobalBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  message: string;
  tone?: "info" | "warning" | "danger";
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}

const toneStyles = {
  info: "bg-info-soft text-accent border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

const toneIcons = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertTriangle,
};

export function GlobalBanner({
  className,
  message,
  tone = "info",
  action,
  onDismiss,
}: GlobalBannerProps) {
  const Icon = toneIcons[tone];

  return (
    <div
      role="alert"
      className={cn(
        "flex w-full items-center justify-between gap-3 border-b px-4 py-2.5 text-[13px] font-medium leading-[18px]",
        toneStyles[tone],
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Icon size={16} strokeWidth={1.75} className="shrink-0" />
        <span>{message}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="rounded px-2 py-0.5 text-xs font-semibold underline decoration-current underline-offset-2 opacity-90 hover:opacity-100 transition-opacity"
          >
            {action.label}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Dispensar"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
GlobalBanner.displayName = "GlobalBanner";