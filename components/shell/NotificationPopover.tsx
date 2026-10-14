"use client";
import * as React from "react";
import { Bell, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";

interface Notification {
  id: string;
  tone: "info" | "success" | "warning" | "danger";
  title: string;
  description?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

interface NotificationPopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  notifications: Notification[];
  onDismiss?: (id: string) => void;
}

const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
};

const toneColors = {
  info: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export function NotificationPopover({
  className,
  notifications,
  onDismiss,
}: NotificationPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  const hasUnread = notifications.length > 0;

  return (
    <div className={cn("relative", className)}>
      <div ref={triggerRef}>
        <IconButton
          icon={<Bell size={17} strokeWidth={1.75} />}
          aria-label="Notificações"
          onClick={() => setOpen((v) => !v)}
          className="relative"
        />
      </div>

      {/* Dot indicator */}
      {hasUnread && (
        <span
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-bg"
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface-raised shadow-pop animate-in fade-in zoom-in-95 duration-200 ease-out origin-top-right"
          role="dialog"
          aria-label="Notificações"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold text-ink">Alertas</h3>
            <span className="font-mono text-xs tabular-nums text-ink-3">
              {notifications.length}
            </span>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-3">
                Nenhum alerta pendente
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {notifications.map((notif) => {
                  const Icon = toneIcons[notif.tone];
                  return (
                    <div
                      key={notif.id}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.75}
                        className={cn("mt-0.5 shrink-0", toneColors[notif.tone])}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="text-[13px] font-medium leading-[18px] text-ink">
                          {notif.title}
                        </p>
                        {notif.description && (
                          <p className="text-xs text-ink-2">{notif.description}</p>
                        )}
                        {notif.action && (
                          <button
                            type="button"
                            onClick={() => {
                              notif.action?.onClick?.();
                              if (notif.action?.href) {
                                window.location.href = notif.action.href;
                              }
                            }}
                            className="self-start text-xs font-medium text-accent hover:underline"
                          >
                            {notif.action.label}
                          </button>
                        )}
                      </div>
                      {onDismiss && (
                        <button
                          type="button"
                          onClick={() => onDismiss(notif.id)}
                          className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink transition-colors"
                          aria-label="Dispensar"
                        >
                          <X size={14} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

NotificationPopover.displayName = "NotificationPopover";