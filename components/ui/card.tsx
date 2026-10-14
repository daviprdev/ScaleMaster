import * as React from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
 title?: string;
 description?: string;
 actions?: React.ReactNode;
 flush?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
 ({ className, title, description, actions, flush = false, children, ...props }, ref) => {
 return (
 <div
 ref={ref}
 className={cn(
 "rounded-xl border border-line bg-surface",
 !flush && "p-5",
 className
 )}
 {...props}
 >
 {(title || description || actions) && (
 <div className="flex items-start justify-between gap-4 mb-4">
 <div className="flex flex-col gap-1">
 {title && (
 <h3 className="text-[15px] font-semibold leading-[22px] text-ink tracking-[-0.01em]">
 {title}
 </h3>
 )}
 {description && (
 <p className="text-sm text-ink-2">{description}</p>
 )}
 </div>
 {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
 </div>
 )}
 {children}
 </div>
 );
 }
);
Card.displayName = "Card";