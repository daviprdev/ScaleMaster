"use client";

import { useState } from "react";
import { Globe, Loader2, CheckCircle2, AlertCircle, RefreshCw, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface ProxyResult {
  id: string;
  username: string;
  session_id: string;
  source: "dedicado" | "template" | "nenhum";
  proxy_label: string | null;
  ip: string | null;
  error: string | null;
}

export default function ProxyTestPage() {
  const [results, setResults] = useState<ProxyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const runCheck = async () => {
    setLoading(true);
    setDone(false);
    setResults([]);
    try {
      const res = await fetch("/api/debug/proxy-check-all");
      const data = await res.json() as { results?: ProxyResult[] };
      setResults(data.results ?? []);
      setDone(true);
    } finally {
      setLoading(false);
    }
  };

  const uniqueIps = new Set(results.filter(r => r.ip).map(r => r.ip)).size;
  const allUnique = done && results.filter(r => r.ip).length > 1 && uniqueIps === results.filter(r => r.ip).length;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Verificar Proxies</h1>
        <p className="text-sm text-white/35 mt-0.5">
          Confirma qual IP cada conta usa ao se comunicar com a Meta API.
        </p>
      </div>

      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#00FF41]/10 border border-[#00FF41]/20 flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-[#00FF41]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Como funciona</p>
            <p className="text-xs text-white/40 mt-0.5 leading-relaxed">
              Cada conta faz uma requisição ao serviço <span className="font-mono text-white/60">api.ipify.org</span> através
              do seu proxy configurado. O IP retornado é o que a Meta API enxerga — deve ser diferente por conta.
            </p>
          </div>
        </div>

        <button
          onClick={runCheck}
          disabled={loading}
          className="btn-primary flex items-center gap-2 text-sm px-5 py-2.5 disabled:opacity-60"
        >
          {loading
            ? <><Loader2 size={14} className="animate-spin" /> Verificando contas...</>
            : <><Globe size={14} /> {done ? "Verificar novamente" : "Verificar IPs"}</>
          }
        </button>
      </div>

      <AnimatePresence>
        {done && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Resumo */}
            <div className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold",
              allUnique
                ? "bg-[#00FF41]/8 border-[#00FF41]/20 text-[#00FF41]"
                : "bg-amber-500/8 border-amber-500/20 text-amber-300"
            )}>
              {allUnique
                ? <CheckCircle2 size={16} className="flex-shrink-0" />
                : <AlertCircle size={16} className="flex-shrink-0" />
              }
              {allUnique
                ? `${uniqueIps} IPs únicos — cada conta tem seu próprio proxy.`
                : `${uniqueIps} IP${uniqueIps !== 1 ? "s" : ""} único${uniqueIps !== 1 ? "s" : ""} entre ${results.filter(r => r.ip).length} contas verificadas.`
              }
            </div>

            {/* Tabela */}
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-0">
                {/* Header */}
                <div className="contents text-[10px] uppercase tracking-wider text-white/25 font-semibold">
                  <div className="px-4 py-2.5 border-b border-white/[0.05]">Conta</div>
                  <div className="px-4 py-2.5 border-b border-white/[0.05]">Session ID</div>
                  <div className="px-4 py-2.5 border-b border-white/[0.05]">IP detectado</div>
                </div>

                {results.map((r, i) => (
                  <div key={r.id} className="contents">
                    <div className={cn(
                      "px-4 py-3 flex items-center gap-2",
                      i < results.length - 1 && "border-b border-white/[0.04]"
                    )}>
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                        r.ip ? "bg-[#00FF41]" : "bg-red-400"
                      )} />
                      <span className="text-sm text-white/80 font-medium">@{r.username}</span>
                      <span className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase",
                        r.source === "dedicado"
                          ? "bg-violet-500/15 text-violet-400"
                          : r.source === "template"
                          ? "bg-blue-500/15 text-blue-400"
                          : "bg-white/[0.05] text-white/25"
                      )}>
                        {r.source}
                      </span>
                    </div>
                    <div className={cn(
                      "px-4 py-3 flex items-center",
                      i < results.length - 1 && "border-b border-white/[0.04]"
                    )}>
                      <span className="text-xs font-mono text-white/40">{r.session_id}</span>
                    </div>
                    <div className={cn(
                      "px-4 py-3 flex items-center",
                      i < results.length - 1 && "border-b border-white/[0.04]"
                    )}>
                      {r.ip ? (
                        <span className="text-xs font-mono text-[#00E5FF]">{r.ip}</span>
                      ) : (
                        <span className="text-xs text-red-400/70">{r.error ?? "erro"}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-white/20 text-center">
              IPs diferentes = proxies únicos por conta. Session ID fixo = mesmo IP por até 12h (life-720).
            </p>
          </motion.div>
        )}

        {done && results.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass-card rounded-2xl p-8 text-center"
          >
            <RefreshCw size={24} className="text-white/20 mx-auto mb-3" />
            <p className="text-sm text-white/40">Nenhuma conta ativa encontrada.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
