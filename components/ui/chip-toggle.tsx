import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChipToggleProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  selected?: boolean;
  onChange?: (selected: boolean) => void;
  icon?: React.ReactNode;
  count?: number;
}

export const ChipToggle = React.forwardRef<HTMLButtonElement, ChipToggleProps>(
  ({ className, selected = false, onChange, icon, count, children, onClick, ...props }, ref) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onChange?.(!selected);
      onClick?.(e);
    };

    return (
      <button
        ref={ref}
        type="button"
        role="option"
        aria-selected={selected}
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium leading-[18px] transition-colors duration-150 ease-in-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "disabled:opacity-40 disabled:pointer-events-none",
          selected
            ? "border-accent bg-info-soft text-accent"
            : "border-line-control bg-surface text-ink-2 hover:border-line-control hover:bg-surface-hover hover:text-ink",
          className
        )}
        {...props}
      >
        {selected && <Check size={12} strokeWidth={2.5} />}
        {!selected && icon && <span className="text-ink-3">{icon}</span>}
        {children}
        {count !== undefined && (
          <span className="font-mono text-xs tabular-nums opacity-70">{count}</span>
        )}
      </button>
    );
  }
);
ChipToggle.displayName = "ChipToggle";