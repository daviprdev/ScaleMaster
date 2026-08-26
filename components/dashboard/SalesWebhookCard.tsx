"use client";

import { useEffect, useState } from "react";
import { Link2, Copy, Check, Loader2 } from "lucide-react";

export default function SalesWebhookCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/sales/webhook")
      .then((r) => r.json())
      .then((data: { url?: string }) => {
        if (data.url) setUrl(data.url);
      })
      .finally(() => setLoading(false));
  }, []);

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-white/30 shrink-0"><Link2 size={16} /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/80">Seu link de vendas (ApexVips)</p>
          <p className="text-xs text-white/40">
            Cole essa URL no campo de Webhook de cada bot da ApexVips que você quer rastrear.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-white/30 pl-7">
          <Loader2 size={12} className="animate-spin" /> Gerando seu link…
        </div>
      ) : url ? (
        <div className="flex items-center gap-2 pl-7">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="input-glass text-xs px-3 py-2 flex-1 font-mono text-white/60"
          />
          <button
            type="button"
            onClick={copy}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/60 hover:bg-white/[0.08] transition-colors"
          >
            {copied ? <Check size={13} className="text-[#00FF41]" /> : <Copy size={13} />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-red-400 pl-7">Não foi possível gerar o link. Tente recarregar a página.</p>
      )}
    </div>
  );
}
