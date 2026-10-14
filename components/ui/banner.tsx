import * as React from "react";
import { X, AlertCircle, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type BannerTone = "info" | "success" | "warning" | "danger";

interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: BannerTone;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  onClose?: () => void;
}

const toneStyles: Record<BannerTone, string> = {
  info: "bg-info-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

const defaultIcons: Record<BannerTone, React.ElementType> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  ({ className, tone = "info", icon, action, onClose, children, ...props }, ref) => {
    const DefaultIcon = defaultIcons[tone];
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
          toneStyles[tone],
          className
        )}
        {...props}
      >
        <span className="shrink-0 mt-0.5">
          {icon || <DefaultIcon size={16} strokeWidth={1.75} />}
        </span>
        <div className="flex-1">{children}</div>
        {action && <div className="shrink-0">{action}</div>}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Fechar"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>
    );
  }
);
Banner.displayName = "Banner";