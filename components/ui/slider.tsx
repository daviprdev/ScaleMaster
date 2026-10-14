import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  label?: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, label, hint, value, onChange, min = 0, max = 100, step = 1, formatValue, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const percent = ((value - Number(min)) / (Number(max) - Number(min))) * 100;

    return (
      <div className="flex flex-col gap-2">
        {(label || formatValue) && (
          <div className="flex items-center justify-between">
            {label && (
              <label htmlFor={inputId} className="text-[13px] font-medium leading-[18px] text-ink">
                {label}
              </label>
            )}
            {formatValue && (
              <span className="font-mono text-xs tabular-nums text-ink-2">
                {formatValue(value)}
              </span>
            )}
          </div>
        )}
        <div className="relative flex items-center">
          <input
            ref={ref}
            type="range"
            id={inputId}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className={cn(
              "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line outline-none",
              "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus",
              "disabled:opacity-40 disabled:pointer-events-none",
              "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:shadow-sm",
              "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:shadow-sm",
              className
            )}
            style={{
              background: `linear-gradient(to right, var(--primary) ${percent}%, var(--line) ${percent}%)`,
            }}
            {...props}
          />
        </div>
        {hint && <p className="text-xs text-ink-3">{hint}</p>}
      </div>
    );
  }
);
Slider.displayName = "Slider";