import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectOption {
 value: string;
 label: string;
 disabled?: boolean;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
 label?: string;
 hint?: string;
 error?: string;
 options: SelectOption[];
 placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
 ({ className, label, hint, error, options, placeholder, id, ...props }, ref) => {
 const generatedId = React.useId();
 const selectId = id || generatedId;
 const describedBy = [
 error ? `${selectId}-error` : undefined,
 hint ? `${selectId}-hint` : undefined,
 ]
 .filter(Boolean)
 .join(" ") || undefined;

 return (
 <div className="flex flex-col gap-1.5">
 {label && (
 <label
 htmlFor={selectId}
 className="text-[13px] font-medium leading-[18px] text-ink"
 >
 {label}
 </label>
 )}
 <div className="relative">
 <select
 ref={ref}
 id={selectId}
 aria-describedby={describedBy}
 aria-invalid={!!error || undefined}
 className={cn(
 "h-9 w-full appearance-none rounded-md border bg-surface px-3 pr-9 text-sm text-ink transition-colors duration-150 ease-in-out",
 "border-line-control",
 "focus:border-focus focus:outline-2 focus:outline-offset-2 focus:outline-focus",
 "disabled:opacity-40 disabled:pointer-events-none",
 error && "border-danger focus:border-danger focus:outline-danger",
 className
 )}
 {...props}
 >
 {placeholder && (
 <option value="" disabled>
 {placeholder}
 </option>
 )}
 {options.map((opt) => (
 <option key={opt.value} value={opt.value} disabled={opt.disabled}>
 {opt.label}
 </option>
 ))}
 </select>
 <ChevronDown
 size={16}
 className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
 />
 </div>
 {hint && !error && (
 <p id={`${selectId}-hint`} className="text-xs text-ink-3">
 {hint}
 </p>
 )}
 {error && (
 <p id={`${selectId}-error`} className="text-xs text-danger">
 {error}
 </p>
 )}
 </div>
 );
 }
);
Select.displayName = "Select";
