import * as React from "react";
import { cn } from "@/lib/utils";

interface RadioCardOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
}

interface RadioCardGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  options: RadioCardOption[];
  value: string;
  onChange: (value: string) => void;
  name?: string;
  columns?: number;
}

export const RadioCardGroup = React.forwardRef<HTMLDivElement, RadioCardGroupProps>(
  ({ className, options, value, onChange, name, columns = 1, ...props }, ref) => {
    const generatedName = React.useId();
    const groupName = name || generatedName;

    return (
      <div
        ref={ref}
        role="radiogroup"
        className={cn(
          "grid gap-3",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-3",
          className
        )}
        {...props}
      >
        {options.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <label
              key={opt.value}
              className={cn(
                "relative flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors duration-150 ease-in-out",
                "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
                isSelected
                  ? "border-accent bg-info-soft"
                  : "border-line bg-surface hover:border-line-control hover:bg-surface-hover",
                opt.disabled && "opacity-40 pointer-events-none"
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={opt.value}
                checked={isSelected}
                disabled={opt.disabled}
                onChange={() => !opt.disabled && onChange(opt.value)}
                className="sr-only"
              />
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                  isSelected
                    ? "border-accent bg-accent"
                    : "border-line-control bg-surface"
                )}
                aria-hidden="true"
              >
                {isSelected && (
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                )}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-medium leading-[18px] text-ink">
                    {opt.label}
                  </span>
                  {opt.badge && (
                    <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      {opt.badge}
                    </span>
                  )}
                </span>
                {opt.description && (
                  <span className="text-xs text-ink-2">{opt.description}</span>
                )}
              </div>
            </label>
          );
        })}
      </div>
    );
  }
);
RadioCardGroup.displayName = "RadioCardGroup";

/** Single radio card for standalone use */
interface RadioCardProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  selected: boolean;
  label: string;
  description?: string;
  badge?: string;
}

export const RadioCard = React.forwardRef<HTMLLabelElement, RadioCardProps>(
  ({ className, selected, label, description, badge, children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "relative flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors duration-150 ease-in-out",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
          selected
            ? "border-accent bg-info-soft"
            : "border-line bg-surface hover:border-line-control hover:bg-surface-hover",
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
            selected
              ? "border-accent bg-accent"
              : "border-line-control bg-surface"
          )}
          aria-hidden="true"
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-medium leading-[18px] text-ink">
              {label}
            </span>
            {badge && (
              <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">
                {badge}
              </span>
            )}
          </span>
          {description && (
            <span className="text-xs text-ink-2">{description}</span>
          )}
          {children}
        </div>
      </label>
    );
  }
);
RadioCard.displayName = "RadioCard";