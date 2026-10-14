import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
}

export const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  ({ className, content, side = "top", children, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

    const show = () => {
      timeoutRef.current = setTimeout(() => setVisible(true), 300);
    };
    const hide = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setVisible(false);
    };

    React.useEffect(() => {
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }, []);

    const positionStyles: Record<string, string> = {
      top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
      bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
      left: "right-full top-1/2 -translate-y-1/2 mr-2",
      right: "left-full top-1/2 -translate-y-1/2 ml-2",
    };

    return (
      <div
        ref={ref}
        className={cn("relative inline-flex", className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        {...props}
      >
        {children}
        {visible && (
          <div
            role="tooltip"
            className={cn(
              "absolute z-50 whitespace-nowrap rounded-md bg-surface-raised px-2.5 py-1.5 text-xs text-ink shadow-pop border border-line",
              "animate-in fade-in zoom-in-95 duration-150",
              positionStyles[side]
            )}
          >
            {content}
          </div>
        )}
      </div>
    );
  }
);
Tooltip.displayName = "Tooltip";