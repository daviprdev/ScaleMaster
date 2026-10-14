"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Menu, Search, Bell, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";

interface TopbarProps extends React.HTMLAttributes<HTMLDivElement> {
  onMenuClick: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

/** Map path segments to breadcrumb labels */
const BREADCRUMB_MAP: Record<string, string> = {
  dashboard: "Início",
  accounts: "Contas",
  "contas-leitoras": "Contas leitoras",
  "proxy-test": "Proxies",
  failover: "Failover",
  postar: "Postar",
  loop: "Loop",
  stories: "Stories",
  queue: "Fila",
  publicados: "Publicados",
  inspirations: "Inspirações",
  clone: "Clonar",
  library: "Biblioteca",
  monitor: "Monitor",
  analytics: "Analytics",
  settings: "Configurações",
  apps: "Meu App",
};

export function Topbar({
  className,
  onMenuClick,
  sidebarCollapsed,
  onToggleSidebar,
}: TopbarProps) {
  const pathname = usePathname();

  // Build breadcrumb from pathname
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs = segments.map((seg) => ({
    label: BREADCRUMB_MAP[seg] || seg,
    href: "/" + segments.slice(0, segments.indexOf(seg) + 1).join("/"),
  }));

  return (
    <header
      className={cn(
        "flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-line bg-bg px-4 sm:px-8",
        className
      )}
    >
      {/* Mobile menu button */}
      <button
        type="button"
        onClick={onMenuClick}
        className="lg:hidden -ml-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-hover hover:text-ink transition-colors"
        aria-label="Abrir menu"
      >
        <Menu size={20} strokeWidth={1.75} />
      </button>

      {/* Desktop sidebar toggle (when collapsed) */}
      {sidebarCollapsed && onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-surface-hover hover:text-ink transition-colors"
          aria-label="Expandir sidebar"
        >
          <ChevronRight size={16} strokeWidth={1.75} />
        </button>
      )}

      {/* Breadcrumb */}
      <nav className="hidden sm:flex items-center gap-1 text-sm" aria-label="Breadcrumb">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={crumb.href}>
            {i > 0 && (
              <span className="text-ink-3" aria-hidden="true">
                /
              </span>
            )}
            <span
              className={cn(
                "truncate",
                i === breadcrumbs.length - 1
                  ? "font-medium text-ink"
                  : "text-ink-3"
              )}
            >
              {crumb.label}
            </span>
          </React.Fragment>
        ))}
      </nav>

      {/* Mobile title (first meaningful segment) */}
      <span className="sm:hidden truncate text-sm font-medium text-ink">
        {breadcrumbs[breadcrumbs.length - 1]?.label || "Scale Master"}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search trigger */}
      <button
        type="button"
        className="hidden sm:flex h-8 max-w-[320px] flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 text-[13px] text-ink-3 transition-colors hover:border-line-control hover:bg-surface-hover"
        aria-label="Buscar (Ctrl+K)"
      >
        <Search size={14} strokeWidth={1.75} />
        <span className="truncate">Buscar…</span>
        <span className="ml-auto">
          <Kbd keys={["Ctrl", "K"]} />
        </span>
      </button>

      {/* Notifications bell */}
      <IconButton
        icon={<Bell size={17} strokeWidth={1.75} />}
        aria-label="Notificações"
        className="relative"
      >
        {/* Notification dot placeholder — will be wired in Fase 2/3 */}
      </IconButton>
    </header>
  );
}

Topbar.displayName = "Topbar";