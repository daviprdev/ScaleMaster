import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, eyebrow, title, description, actions, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}
        {...props}
      >
        <div className="flex flex-col gap-1">
          {eyebrow && (
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
              {eyebrow}
            </span>
          )}
          <h1 className="text-[22px] font-semibold leading-[28px] tracking-[-0.02em] text-ink">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-ink-2">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    );
  }
);
PageHeader.displayName = "PageHeader";