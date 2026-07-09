"use client";

import { useState, useEffect } from "react";
import { WifiOff, X, ExternalLink } from "lucide-react";
import Link from "next/link";

// Dismiss temporário (30 min) — se a queda continuar, o banner reaparece.
// Diferente dos outros banners (dismiss por sessão): queda de proxy paralisa
// TODO o pipeline de postagem em silêncio, então não pode ficar oculta.
const DISMISS_KEY = "proxyOutageBannerDismissedAt_v1";
const DISMISS_MS = 30 * 60 * 1000;

export function ProxyOutageBanner({
  count,
  sinceLabel,
}: {
  count: number;
  sinceLabel: string | null;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissedAt = Number(sessionStorage.getItem(DISMISS_KEY) ?? 0);
    if (Date.now() - dismissedAt > DISMISS_MS) setVisible(true);
  }, [count]);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="relative z-50 shrink-0 border-b border-red-500/40 bg-red-950/70 backdrop-blur-sm">
      <div className="px-4 py-2.5 flex items-start gap-3">
        <WifiOff className="w-4 h-4 text-red-400 shrink-0 mt-0.5 animate-pulse" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-red-300">
              Proxies fora do ar — postagens paralisadas
            </span>
            <Link
              href="/dashboard/proxy-test"
              className="flex items-center gap-1 text-[10px] text-red-400/80 hover:text-red-300 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Testar proxies
            </Link>
          </div>
          <p className="text-[11px] text-red-400/70 mt-0.5">
            {count} conta{count > 1 ? "s" : ""} com falha de proxy nos últimos 30 minutos
            {sinceLabel ? ` (desde ${sinceLabel})` : ""}. Provável queda ou expiração do
            provedor — verifique o painel do fornecedor e reimporte a lista atual em
            Contas → Proxies. As postagens pendentes retomam sozinhas quando os proxies voltarem.
          </p>
        </div>

        <button
          onClick={dismiss}
          className="shrink-0 p-0.5 rounded text-red-500/60 hover:text-red-300 transition-colors"
          aria-label="Dispensar aviso por 30 minutos"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
