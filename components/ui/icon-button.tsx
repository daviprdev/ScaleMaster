import * as React from "react";
import { cn } from "@/lib/utils";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md";
  icon: React.ReactNode;
}

const sizeStyles = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", icon, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-transparent text-ink-2 transition-colors duration-150 ease-in-out",
          "hover:bg-surface-hover hover:text-ink",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "disabled:opacity-40 disabled:pointer-events-none",
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {icon}
      </button>
    );
  }
);
IconButton.displayName = "IconButton";