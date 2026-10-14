import * as React from "react";
import { cn } from "@/lib/utils";

interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Key label(s) to display */
  keys?: string[];
}

export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, keys, children, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        className={cn(
          "inline-flex items-center gap-0.5 rounded border border-line bg-surface-hover px-1.5 py-0.5 font-mono text-[11px] font-medium leading-4 text-ink-2",
          className
        )}
        {...props}
      >
        {keys
          ? keys.map((k, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-ink-3">+</span>}
                <span>{k}</span>
              </React.Fragment>
            ))
          : children}
      </kbd>
    );
  }
);
Kbd.displayName = "Kbd";