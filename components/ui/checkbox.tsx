import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <div className="flex items-center gap-2">
        <div className="relative flex items-center justify-center">
          <input
            ref={ref}
            type="checkbox"
            id={inputId}
            className="peer sr-only"
            {...props}
          />
          <div
            className={cn(
              "h-4 w-4 rounded border transition-colors duration-150 ease-in-out",
              "border-line-control bg-surface",
              "peer-checked:border-primary peer-checked:bg-primary",
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
              "peer-disabled:opacity-40",
              className
            )}
            aria-hidden="true"
          >
            <Check
              size={12}
              className="absolute inset-0 m-auto text-white opacity-0 peer-checked:opacity-100"
              strokeWidth={3}
            />
          </div>
        </div>
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm text-ink cursor-pointer select-none"
          >
            {label}
          </label>
        )}
      </div>
    );
  }
);
Checkbox.displayName = "Checkbox";
