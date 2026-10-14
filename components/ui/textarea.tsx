import * as React from "react";
import { cn } from "@/lib/utils";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  maxLength?: number;
  showCounter?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, error, maxLength, showCounter, id, value, onChange, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const [charCount, setCharCount] = React.useState(
      typeof value === "string" ? value.length : 0
    );

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCharCount(e.target.value.length);
      onChange?.(e);
    };

    const describedBy = [
      error ? `${inputId}-error` : undefined,
      hint ? `${inputId}-hint` : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

    const counterTone =
      maxLength && charCount > maxLength * 0.9
        ? charCount > maxLength
          ? "text-danger"
          : "text-warning"
        : "text-ink-3";

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[13px] font-medium leading-[18px] text-ink"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={!!error || undefined}
          maxLength={maxLength}
          value={value}
          onChange={handleChange}
          className={cn(
            "min-h-[80px] w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink transition-colors duration-150 ease-in-out",
            "border-line-control placeholder:text-ink-3",
            "focus:border-focus focus:outline-2 focus:outline-offset-2 focus:outline-focus",
            "disabled:opacity-40 disabled:pointer-events-none",
            error && "border-danger focus:border-danger focus:outline-danger",
            className
          )}
          {...props}
        />
        <div className="flex items-center justify-between">
          {hint && !error ? (
            <p id={`${inputId}-hint`} className="text-xs text-ink-3">
              {hint}
            </p>
          ) : (
            <span />
          )}
          {showCounter && maxLength && (
            <span className={cn("text-xs tabular-nums", counterTone)}>
              {charCount}/{maxLength}
            </span>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";
