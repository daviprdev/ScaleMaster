"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Main application shell for the dashboard.
 * Provides the persistent sidebar + topbar layout with responsive behavior.
 * - Desktop (≥1024px): fixed sidebar + scrollable content area
 * - Mobile (<1024px): sidebar as overlay sheet, topbar with hamburger menu
 */
export function AppShell({ className, children, ...props }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  // Persist sidebar collapsed state
  React.useEffect(() => {
    const saved = localStorage.getItem("sm-sidebar-collapsed");
    if (saved === "true") setSidebarCollapsed(true);
  }, []);

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem("sm-sidebar-collapsed", String(next));
  };

  const openMobileSidebar = () => setSidebarOpen(true);
  const closeMobileSidebar = () => setSidebarOpen(false);

  return (
    <div className={cn("flex h-screen w-full bg-bg", className)} {...props}>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col border-r border-line bg-surface transition-[width] duration-200 ease-in-out",
          sidebarCollapsed ? "w-[var(--sidebar-collapsed)]" : "w-[var(--sidebar-width)]"
        )}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          variant="desktop"
        />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-overlay transition-opacity duration-200"
            onClick={closeMobileSidebar}
            aria-hidden="true"
          />
          <aside className="absolute left-0 top-0 bottom-0 w-[var(--sidebar-width)] bg-surface shadow-pop animate-in slide-in-from-left duration-200 ease-out">
            <Sidebar
              collapsed={false}
              onClose={closeMobileSidebar}
              variant="mobile"
            />
          </aside>
        </div>
      )}

      {/* Main content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenuClick={openMobileSidebar}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[var(--content-max)] px-4 py-7 sm:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

AppShell.displayName = "AppShell";