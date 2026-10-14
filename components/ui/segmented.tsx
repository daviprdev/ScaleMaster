import * as React from "react";
import { cn } from "@/lib/utils";

interface SegmentedOption {
 value: string;
 label: string;
 disabled?: boolean;
}

interface SegmentedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
 options: SegmentedOption[];
 value: string;
 onChange: (value: string) => void;
 name?: string;
}

export const Segmented = React.forwardRef<HTMLDivElement, SegmentedProps>(
 ({ className, options, value, onChange, name, ...props }, ref) => {
 const generatedName = React.useId();
 const groupName = name || generatedName;

 return (
 <div
 ref={ref}
 role="radiogroup"
 className={cn(
 "inline-flex items-center rounded-lg border border-line bg-surface p-0.5",
 className
 )}
 {...props}
 >
 {options.map((opt) => {
 const isActive = value === opt.value;
 return (
 <button
 key={opt.value}
 type="button"
 role="radio"
 aria-checked={isActive}
 disabled={opt.disabled}
 onClick={() => !opt.disabled && onChange(opt.value)}
 className={cn(
 "relative rounded-md px-3 py-1.5 text-[13px] font-medium leading-[18px] transition-colors duration-150 ease-in-out",
 "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
 "disabled:opacity-40 disabled:pointer-events-none",
 isActive
 ? "bg-surface-hover text-ink shadow-sm"
 : "text-ink-2 hover:text-ink"
 )}
 >
 {opt.label}
 </button>
 );
 })}
 </div>
 );
 }
);
Segmented.displayName = "Segmented";
