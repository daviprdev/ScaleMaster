"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Shield,
  Shuffle,
  Send,
  RefreshCw,
  FileText,
  CalendarClock,
  ListChecks,
  CheckSquare,
  Sparkles,
  Copy,
  FolderOpen,
  Activity,
  BarChart3,
  Settings,
  Smartphone,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  count?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Início",
    items: [
      { label: "Visão geral", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Contas",
    items: [
      { label: "Contas", href: "/dashboard/accounts", icon: Users },
      { label: "Contas leitoras", href: "/dashboard/contas-leitoras", icon: UserCheck },
      { label: "Proxies", href: "/dashboard/proxy-test", icon: Shield },
      { label: "Failover", href: "/dashboard/failover", icon: Shuffle },
    ],
  },
  {
    title: "Publicar",
    items: [
      { label: "Postar", href: "/dashboard/postar", icon: Send },
      { label: "Loop", href: "/dashboard/loop", icon: RefreshCw },
      { label: "Stories", href: "/dashboard/stories", icon: FileText },
      { label: "Fila", href: "/dashboard/queue", icon: ListChecks },
      { label: "Publicados", href: "/dashboard/publicados", icon: CheckSquare },
    ],
  },
  {
    title: "Conteúdo",
    items: [
      { label: "Inspirações", href: "/dashboard/inspirations", icon: Sparkles },
      { label: "Clonar", href: "/dashboard/clone", icon: Copy },
      { label: "Biblioteca", href: "/dashboard/library", icon: FolderOpen },
    ],
  },
  {
    title: "Dados",
    items: [
      { label: "Monitor", href: "/dashboard/monitor", icon: Activity },
      { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
    ],
  },
];

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
  variant?: "desktop" | "mobile";
}

export function Sidebar({
  className,
  collapsed = false,
  onToggleCollapse,
  onClose,
  variant = "desktop",
}: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  return (
    <div
      className={cn(
        "flex h-full flex-col justify-between bg-surface",
        className
      )}
    >
      {/* Logo area */}
      <div className="flex h-[var(--topbar-height)] items-center gap-3 border-b border-line px-4">
        <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
          <div className="relative h-[26px] w-[26px] shrink-0 overflow-hidden rounded-[7px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/scale-master-logo.jpg"
              alt="Scale Master"
              width={26}
              height={26}
              className="h-full w-full object-contain"
            />
          </div>
          {!collapsed && (
            <span className="truncate text-[15px] font-semibold tracking-tight text-wordmark">
              Scale Master
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 custom-scrollbar">
        <div className="flex flex-col gap-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-1">
              {!collapsed && (
                <span className="mb-1 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
                  {group.title}
                </span>
              )}
              {group.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={variant === "mobile" ? onClose : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group relative flex h-[34px] items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors duration-150 ease-in-out",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                      active
                        ? "bg-surface-hover text-ink"
                        : "text-ink-2 hover:bg-surface-hover hover:text-ink"
                    )}
                  >
                    {/* Active indicator bar */}
                    {active && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />
                    )}
                    <Icon
                      size={17}
                      strokeWidth={1.75}
                      className={cn(
                        "shrink-0 transition-colors duration-150",
                        active ? "text-accent" : "text-ink-3 group-hover:text-ink-2"
                      )}
                    />
                    {!collapsed && (
                      <>
                        <span className="truncate">{item.label}</span>
                        {item.count !== undefined && (
                          <span className="ml-auto font-mono text-xs tabular-nums text-ink-3">
                            {item.count}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* Footer — user menu trigger + collapse toggle */}
      <div className="border-t border-line p-2">
        {/* Collapse toggle (desktop only) */}
        {variant === "desktop" && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mb-1 flex h-8 w-full items-center justify-center rounded-md text-ink-3 hover:bg-surface-hover hover:text-ink transition-colors"
            aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}

        {/* User section */}
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover",
            collapsed && "justify-center px-0"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-medium text-ink-2">
            U
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium text-ink">Usuário</span>
              <span className="truncate text-[11px] text-ink-3">Configurações e conta</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

Sidebar.displayName = "Sidebar";