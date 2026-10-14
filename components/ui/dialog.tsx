import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  /** Prevent closing on overlay click or Escape */
  preventClose?: boolean;
}

export const Dialog = React.forwardRef<HTMLDivElement, DialogProps>(
  ({ className, open, onClose, title, description, preventClose, children, ...props }, ref) => {
    // Close on Escape
    React.useEffect(() => {
      if (!open || preventClose) return;
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", handleEsc);
      return () => document.removeEventListener("keydown", handleEsc);
    }, [open, onClose, preventClose]);

    // Lock body scroll when open
    React.useEffect(() => {
      if (open) {
        document.body.style.overflow = "hidden";
        return () => {
          document.body.style.overflow = "";
        };
      }
    }, [open]);

    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Overlay */}
        <div
          className="absolute inset-0 bg-overlay transition-opacity duration-200"
          onClick={preventClose ? undefined : onClose}
          aria-hidden="true"
        />
        {/* Panel */}
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? "dialog-title" : undefined}
          aria-describedby={description ? "dialog-desc" : undefined}
          className={cn(
            "relative w-full max-w-md rounded-xl border border-line bg-surface-raised p-6 shadow-pop",
            "animate-in fade-in zoom-in-95 duration-200 ease-out",
            className
          )}
          {...props}
        >
          {(title || !preventClose) && (
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex flex-col gap-1">
                {title && (
                  <h2
                    id="dialog-title"
                    className="text-[17px] font-semibold leading-[24px] text-ink tracking-[-0.01em]"
                  >
                    {title}
                  </h2>
                )}
                {description && (
                  <p id="dialog-desc" className="text-sm text-ink-2">
                    {description}
                  </p>
                )}
              </div>
              {!preventClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded-md p-1 text-ink-3 hover:bg-surface-hover hover:text-ink transition-colors"
                  aria-label="Fechar"
                >
                  <X size={18} strokeWidth={1.75} />
                </button>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }
);
Dialog.displayName = "Dialog";

/** Confirm dialog for destructive actions */
interface ConfirmDialogProps extends Omit<DialogProps, "children"> {
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: "danger" | "primary";
  loading?: boolean;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  variant = "danger",
  loading = false,
  children,
  ...dialogProps
}: ConfirmDialogProps) {
  const btnClass =
    variant === "danger"
      ? "bg-danger text-white hover:bg-danger/90"
      : "bg-primary text-primary-fg hover:bg-primary-hover";

  return (
    <Dialog {...dialogProps}>
      <div className="flex flex-col gap-4">
        {children}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={dialogProps.onClose}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center rounded-md border border-line-control px-4 text-[13px] font-medium text-ink-2 hover:bg-surface-hover hover:text-ink transition-colors disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "inline-flex h-9 items-center justify-center rounded-md px-4 text-[13px] font-medium transition-colors disabled:opacity-40",
              btnClass
            )}
          >
            {loading ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
ConfirmDialog.displayName = "ConfirmDialog";