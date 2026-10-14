import * as React from "react";
import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fixed width (e.g. "100%", "200px") */
  width?: string;
  /** Fixed height (e.g. "20px", "1rem") */
  height?: string;
  /** Border radius override */
  radius?: string;
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, width, height, radius, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn("animate-pulse rounded-md bg-surface-hover", className)}
        style={{
          width: width ?? "100%",
          height: height ?? "1rem",
          borderRadius: radius,
          ...style,
        }}
        {...props}
      />
    );
  }
);
Skeleton.displayName = "Skeleton";