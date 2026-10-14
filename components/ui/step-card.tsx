import * as React from "react";
import { cn } from "@/lib/utils";

interface StepCardProps extends React.HTMLAttributes<HTMLDivElement> {
  step: string | number;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export const StepCard = React.forwardRef<HTMLDivElement, StepCardProps>(
  ({ className, step, title, description, actions, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border border-line bg-surface p-5",
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[15px] font-semibold leading-[22px] text-accent tabular-nums">
              {String(step).padStart(2, "0")}
            </span>
            <div className="flex flex-col gap-0.5">
              <h3 className="text-[15px] font-semibold leading-[22px] text-ink tracking-[-0.01em]">
                {title}
              </h3>
              {description && (
                <p className="text-sm text-ink-2">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {children}
      </div>
    );
  }
);
StepCard.displayName = "StepCard";