import * as React from "react";
import { cn } from "@/lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg";
  status?: "online" | "offline" | "error";
}

const sizeStyles = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

const statusColors = {
  online: "bg-success",
  offline: "bg-ink-3",
  error: "bg-danger",
};

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, alt = "", fallback, size = "md", status, ...props }, ref) => {
    const [imgError, setImgError] = React.useState(false);
    const showImage = src && !imgError;
    const initials = fallback || alt.slice(0, 2).toUpperCase() || "?";

    return (
      <div
        ref={ref}
        className={cn("relative inline-flex shrink-0", className)}
        {...props}
      >
        <div
          className={cn(
            "flex items-center justify-center overflow-hidden rounded-full bg-surface-hover font-medium text-ink-2",
            sizeStyles[size]
          )}
        >
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              onError={() => setImgError(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden="true">{initials}</span>
          )}
        </div>
        {status && (
          <span
            className={cn(
              "absolute bottom-0 right-0 block rounded-full border-2 border-surface",
              size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5",
              statusColors[status]
            )}
            aria-label={`Status: ${status}`}
          />
        )}
      </div>
    );
  }
);
Avatar.displayName = "Avatar";