import * as React from "react";
import { cn } from "@/lib/utils";

interface Tab {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  tabs: Tab[];
  value: string;
  onChange: (value: string) => void;
}

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, tabs, value, onChange, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="tablist"
        className={cn("flex items-center gap-6 border-b border-line", className)}
        {...props}
      >
        {tabs.map((tab) => {
          const isActive = value === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onChange(tab.value)}
              className={cn(
                "relative pb-3 text-[13px] font-medium leading-[18px] transition-colors duration-150 ease-in-out",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                "disabled:opacity-40 disabled:pointer-events-none",
                isActive ? "text-ink" : "text-ink-3 hover:text-ink-2"
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {tab.count !== undefined && (
                  <span className="font-mono text-xs tabular-nums text-ink-3">
                    {tab.count}
                  </span>
                )}
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    );
  }
);
Tabs.displayName = "Tabs";