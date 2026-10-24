"use client";

import { useEffect, useState } from "react";
import { Link2, Copy, Check, Loader2 } from "lucide-react";

interface WebhookUrls {
  apexvips?: string;
  sharkbot?: string;
  sharkbot_gringa?: string;
}

export default function SalesWebhookCard() {
  const [urls, setUrls] = useState<WebhookUrls | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sales/webhook")
      .then((r) => r.json())
      .then((data: WebhookUrls) => setUrls(data))
      .finally(() => setLoading(false));
  }, []);

  async function copy(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const entries: { key: string; label: string; desc: string }[] = [
    { key: "apexvips", label: "ApexVips", desc: "Cole no campo de Webhook dos bots da ApexVips." },
    { key: "sharkbot", label: "SharkBot", desc: "Cole no campo de Webhook dos bots da conta principal." },
    {
      key: "sharkbot_gringa",
      label: "SharkBot · Gringa",
      desc: "Cole nos bots da conta gringa. Dólar/euro entra convertido em reais.",
    },
  ];

  return (
    <div className="px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-white/30 shrink-0"><Link2 size={16} /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/80">Links de integração de vendas</p>
          <p className="text-xs text-white/40">Use o link correspondente à plataforma do seu bot.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-white/30 pl-7">
          <Loader2 size={12} className="animate-spin" /> Gerando seus links…
        </div>
      ) : urls ? (
        <div className="space-y-2.5 pl-7">
          {entries.map(({ key, label, desc }) => {
            const value = urls[key as keyof WebhookUrls];
            if (!value) return null;
            const isCopied = copiedKey === key;
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-white/60">{label}</span>
                  <span className="text-[10px] text-white/30">{desc}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={value}
                    onFocus={(e) => e.target.select()}
                    className="input-glass text-xs px-3 py-2 flex-1 font-mono text-white/60"
                  />
                  <button
                    type="button"
                    onClick={() => copy(key, value)}
                    className="shrink-0 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/60 hover:bg-white/[0.08] transition-colors"
                  >
                    {isCopied ? <Check size={13} className="text-[#00498D]" /> : <Copy size={13} />}
                    {isCopied ? "Copiado" : "Copiar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-red-400 pl-7">Não foi possível gerar os links. Tente recarregar a página.</p>
      )}
    </div>
  );
}
