import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
  asChild?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-fg border-transparent hover:bg-primary-hover",
  secondary:
    "bg-transparent text-ink border-line-control hover:bg-surface-hover hover:text-ink",
  ghost:
    "bg-transparent text-ink-2 border-transparent hover:bg-surface-hover hover:text-ink",
  danger:
    "bg-danger text-white border-transparent hover:bg-danger/90",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2.5",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      icon,
      iconRight,
      loading = false,
      asChild = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md border font-medium transition-colors duration-150 ease-in-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "disabled:opacity-40 disabled:pointer-events-none",
          "select-none whitespace-nowrap",
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <Loader2 className="animate-spin" size={size === "sm" ? 14 : 16} />
        ) : (
          icon
        )}
        {/* Com asChild o Slot exige um filho só: o Slottable marca qual é (o
            Link) e os ícones vão para dentro dele. */}
        <Slottable>{children}</Slottable>
        {!loading && iconRight}
      </Comp>
    );
  }
);
Button.displayName = "Button";