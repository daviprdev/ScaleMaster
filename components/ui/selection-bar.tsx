import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  count: number;
  onClear: () => void;
  children?: React.ReactNode;
}

export const SelectionBar = React.forwardRef<HTMLDivElement, SelectionBarProps>(
  ({ className, count, onClear, children, ...props }, ref) => {
    if (count === 0) return null;

    return (
      <div
        ref={ref}
        className={cn(
          "fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface-raised px-5 py-2.5 shadow-pop",
          "animate-in fade-in slide-in-from-bottom-4 duration-200 ease-out",
          className
        )}
        role="toolbar"
        aria-label={`${count} itens selecionados`}
        {...props}
      >
        <span className="font-mono text-[13px] font-medium tabular-nums text-ink">
          {count} selecionado{count !== 1 ? "s" : ""}
        </span>

        <span className="h-4 w-px bg-line" aria-hidden="true" />

        <div className="flex items-center gap-2">{children}</div>

        <button
          type="button"
          onClick={onClear}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-surface-hover hover:text-ink transition-colors"
          aria-label="Limpar seleção"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    );
  }
);
SelectionBar.displayName = "SelectionBar";