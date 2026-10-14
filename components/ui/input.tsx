import * as React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
 label?: string;
 hint?: string;
 error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
 ({ className, label, hint, error, id, ...props }, ref) => {
 const generatedId = React.useId();
 const inputId = id || generatedId;
 const describedBy = [
 error ? `${inputId}-error` : undefined,
 hint ? `${inputId}-hint` : undefined,
 ]
 .filter(Boolean)
 .join(" ") || undefined;

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
 <input
 ref={ref}
 id={inputId}
 aria-describedby={describedBy}
 aria-invalid={!!error || undefined}
 className={cn(
 "h-9 w-full rounded-md border bg-surface px-3 text-sm text-ink transition-colors duration-150 ease-in-out",
 "border-line-control placeholder:text-ink-3",
 "focus:border-focus focus:outline-2 focus:outline-offset-2 focus:outline-focus",
 "disabled:opacity-40 disabled:pointer-events-none",
 error && "border-danger focus:border-danger focus:outline-danger",
 className
 )}
 {...props}
 />
 {hint && !error && (
 <p id={`${inputId}-hint`} className="text-xs text-ink-3">
 {hint}
 </p>
 )}
 {error && (
 <p id={`${inputId}-error`} className="text-xs text-danger">
 {error}
 </p>
 )}
 </div>
 );
 }
);
Input.displayName = "Input";
