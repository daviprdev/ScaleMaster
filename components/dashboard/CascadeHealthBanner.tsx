"use client";

import { useState, useEffect } from "react";
import { Zap, X, ExternalLink } from "lucide-react";
import Link from "next/link";

const DISMISS_KEY = "cascadeHealthBannerDismissed_v1";

export function CascadeHealthBanner({ count }: { count: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (count < 4) return;
    if (!sessionStorage.getItem(DISMISS_KEY)) setVisible(true);
  }, [count]);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="relative z-50 shrink-0 border-b border-amber-500/30 bg-amber-950/60 backdrop-blur-sm">
      <div className="px-4 py-2.5 flex items-start gap-3">
        <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-amber-300">
              Queda em cascata detectada
            </span>
            <Link
              href="/dashboard/apps"
              className="flex items-center gap-1 text-[10px] text-amber-400/80 hover:text-amber-300 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Configurações → Apps
            </Link>
          </div>
          <p className="text-[11px] text-amber-400/70 mt-0.5">
            {count} contas caíram na mesma hora — provável problema no nível do App Meta (não nas contas individuais).
            Considere distribuir contas em múltiplos Apps.
          </p>
        </div>

        <button
          onClick={dismiss}
          className="shrink-0 p-0.5 rounded text-amber-500/60 hover:text-amber-300 transition-colors"
          aria-label="Dispensar aviso"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
