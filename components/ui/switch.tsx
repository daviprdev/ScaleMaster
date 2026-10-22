import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
 label?: string;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
 ({ className, label, id, checked, ...props }, ref) => {
 const generatedId = React.useId();
 const inputId = id || generatedId;

 return (
 <div className="flex items-center gap-3">
 <label htmlFor={inputId} className="relative inline-flex cursor-pointer items-center">
 <input
 ref={ref}
 type="checkbox"
 id={inputId}
 className="peer sr-only"
 checked={checked}
 {...props}
 />
 <div
 className={cn(
 "h-5 w-9 rounded-full border transition-colors duration-150 ease-in-out",
 "border-line-control bg-surface-hover",
 "peer-checked:border-primary peer-checked:bg-primary",
 "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
 "peer-disabled:opacity-40",
 className
 )}
 aria-hidden="true"
 />
 {/* Irmão do input (não filho do trilho): peer-checked só alcança irmãos. */}
 <div
 className={cn(
 "pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-in-out",
 "peer-checked:translate-x-4 peer-disabled:opacity-60"
 )}
 aria-hidden="true"
 />
 </label>
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
Switch.displayName = "Switch";
