import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, action, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line bg-surface py-16 text-center",
          className
        )}
        {...props}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-ink-3">
          {icon}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-semibold leading-[22px] text-ink">
            {title}
          </h3>
          {description && (
            <p className="max-w-xs text-sm text-ink-2">{description}</p>
          )}
        </div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  }
);
EmptyState.displayName = "EmptyState";