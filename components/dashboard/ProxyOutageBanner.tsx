"use client";

import { useState, useEffect } from "react";
import { WifiOff, X, ExternalLink, Repeat, Loader2, CheckCircle2 } from "lucide-react";
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
  const [swapping, setSwapping] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const dismissedAt = Number(sessionStorage.getItem(DISMISS_KEY) ?? 0);
    if (Date.now() - dismissedAt > DISMISS_MS) setVisible(true);
  }, [count]);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function handleSwap() {
    setSwapping(true);
    setResult(null);
    try {
      const res = await fetch("/api/proxy-pool/swap-failed", { method: "POST" });
      const data = await res.json() as {
        swapped?: number; no_stock?: number; candidates?: number; error?: string;
      };
      if (!res.ok) {
        setResult(data.error ?? "Falha ao trocar proxies.");
        return;
      }
      const parts = [`${data.swapped ?? 0} proxy${(data.swapped ?? 0) !== 1 ? "es" : ""} trocado${(data.swapped ?? 0) !== 1 ? "s" : ""}`];
      if (data.no_stock) parts.push(`${data.no_stock} sem substituto no estoque`);
      setResult(parts.join(" · ") + ".");
    } catch {
      setResult("Falha ao trocar proxies.");
    } finally {
      setSwapping(false);
    }
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
            <button
              onClick={handleSwap}
              disabled={swapping}
              className="flex items-center gap-1 text-[10px] font-semibold text-amber-300 hover:text-amber-200 transition-colors disabled:opacity-50"
            >
              {swapping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Repeat className="w-3 h-3" />}
              Trocar proxies agora
            </button>
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
            provedor. Clique em &quot;Trocar proxies agora&quot; para descartar os que estão
            falhando e atribuir substitutos do estoque em Contas → Proxies automaticamente.
          </p>
          {result && (
            <p className="text-[11px] text-amber-300/90 mt-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              {result}
            </p>
          )}
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
