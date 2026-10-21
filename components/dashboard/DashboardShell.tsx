"use client";

import { useState, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { QueueInsightsLauncher } from "./queue-insights/QueueInsightsLauncher";

/**
 * Client shell that owns the mobile-sidebar open/close state and wires
 * the hamburger button in the Header to the slide-in drawer in the Sidebar.
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const openMenu  = useCallback(() => setMobileOpen(true),  []);
  const closeMenu = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="relative flex flex-1 min-h-0 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={closeMenu} />

      <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMobileMenuToggle={openMenu} />

        <main className="flex-1 overflow-y-auto pl-safe pr-safe">
          {/* pb-24: o fim da página rola para fora do botão flutuante do Raio-X */}
          <div className="max-w-6xl mx-auto w-full px-4 pt-5 pb-24 sm:px-6 sm:pt-7 lg:px-8 lg:pt-10">
            {children}
          </div>
        </main>
      </div>

      <QueueInsightsLauncher />
    </div>
  );
}
