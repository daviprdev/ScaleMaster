import * as React from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropzoneProps extends React.HTMLAttributes<HTMLDivElement> {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
}

export const Dropzone = React.forwardRef<HTMLDivElement, DropzoneProps>(
  ({ className, onFiles, accept, multiple = false, disabled = false, label, hint, ...props }, ref) => {
    const [dragging, setDragging] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    };

    const handleClick = () => {
      if (!disabled) inputRef.current?.click();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) onFiles(files);
      // Reset so same file can be selected again
      e.target.value = "";
    };

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-disabled={disabled || undefined}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-150 ease-in-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          dragging
            ? "border-accent bg-info-soft"
            : "border-line bg-surface hover:border-line-control hover:bg-surface-hover",
          disabled && "opacity-40 pointer-events-none",
          className
        )}
        {...props}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleChange}
          className="sr-only"
          tabIndex={-1}
        />
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-ink-3">
          <Upload size={20} strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium leading-[18px] text-ink">
            {label || "Arraste arquivos ou clique para selecionar"}
          </span>
          {hint && <span className="text-xs text-ink-3">{hint}</span>}
        </div>
      </div>
    );
  }
);
Dropzone.displayName = "Dropzone";