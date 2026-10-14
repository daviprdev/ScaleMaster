"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Globe, Loader2, CheckCircle2, AlertCircle, RefreshCw, Shield,
  Database, Plus, Trash2, X, Zap,
} from "lucide-react";
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

interface PoolItem {
  id: string;
  display: string;
  assigned_username: string | null;
  created_at: string;
}

interface PoolData {
  items: PoolItem[];
  total: number;
  free: number;
  in_use: number;
}

// ── Estoque de Proxies ──────────────────────────────────────────────────────
function ProxyPoolSection() {
  const [pool, setPool] = useState<PoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addText, setAddText] = useState("");
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadPool = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pool", { cache: "no-store" });
      if (!res.ok) return;
      setPool(await res.json() as PoolData);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPool(); }, [loadPool]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const handleAdd = async () => {
    const urls = addText.split("\n").map(l => l.trim()).filter(Boolean);
    if (urls.length === 0) return;
    setAdding(true);
    try {
      const res = await fetch("/api/proxy-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json() as {
        added?: number; duplicates?: number; invalid?: number;
        invalid_samples?: string[]; error?: string;
      };
      if (!res.ok) {
        setNotice({ type: "error", message: data.error ?? "Falha ao adicionar proxies." });
        return;
      }
      const parts = [`${data.added ?? 0} adicionado${(data.added ?? 0) !== 1 ? "s" : ""}`];
      if (data.duplicates) parts.push(`${data.duplicates} duplicado${data.duplicates !== 1 ? "s" : ""} ignorado${data.duplicates !== 1 ? "s" : ""}`);
      if (data.invalid) parts.push(`${data.invalid} inválido${data.invalid !== 1 ? "s" : ""}`);
      let msg = parts.join(" · ") + ".";
      if ((data.added ?? 0) === 0 && data.invalid && data.invalid_samples?.length) {
        msg += ` Ex. de linha não reconhecida: "${data.invalid_samples[0]}"`;
      }
      setNotice({ type: (data.added ?? 0) > 0 ? "success" : "error", message: msg });
      if ((data.added ?? 0) > 0) {
        setAddText("");
        setShowAdd(false);
      }
      loadPool();
    } finally {
      setAdding(false);
    }
  };

  const handleAssignAll = async () => {
    setAssigning(true);
    try {
      const res = await fetch("/api/proxy-pool/assign", { method: "POST" });
      const data = await res.json() as { assigned?: number; out_of_stock?: number; message?: string };
      if (data.message) {
        setNotice({ type: "success", message: data.message });
      } else {
        const msg = `${data.assigned ?? 0} conta${(data.assigned ?? 0) !== 1 ? "s" : ""} recebeu proxy do estoque` +
          ((data.out_of_stock ?? 0) > 0 ? ` — estoque acabou, ${data.out_of_stock} conta${data.out_of_stock !== 1 ? "s" : ""} ficou sem.` : ".");
        setNotice({ type: (data.out_of_stock ?? 0) > 0 ? "error" : "success", message: msg });
      }
      loadPool();
    } finally {
      setAssigning(false);
    }
  };

  const handleSwapFailed = async () => {
    setSwapping(true);
    try {
      const res = await fetch("/api/proxy-pool/swap-failed", { method: "POST" });
      const data = await res.json() as {
        candidates?: number; swapped?: number; no_stock?: number; message?: string; error?: string;
      };
      if (!res.ok) {
        setNotice({ type: "error", message: data.error ?? "Falha ao trocar proxies." });
        return;
      }
      if (data.message) {
        setNotice({ type: "success", message: data.message });
      } else {
        const msg = `${data.swapped ?? 0} proxy${(data.swapped ?? 0) !== 1 ? "es" : ""} trocado${(data.swapped ?? 0) !== 1 ? "s" : ""} de ${data.candidates ?? 0} conta${(data.candidates ?? 0) !== 1 ? "s" : ""} com falha` +
          ((data.no_stock ?? 0) > 0 ? ` — estoque insuficiente para ${data.no_stock} conta${data.no_stock !== 1 ? "s" : ""}.` : ".");
        setNotice({ type: (data.no_stock ?? 0) > 0 ? "error" : "success", message: msg });
      }
      loadPool();
    } finally {
      setSwapping(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/proxy-pool?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setPool(prev => prev ? {
          ...prev,
          items: prev.items.filter(i => i.id !== id),
          total: prev.total - 1,
        } : prev);
        loadPool();
      } else {
        const data = await res.json() as { error?: string };
        setNotice({ type: "error", message: data.error ?? "Falha ao remover." });
      }
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#85B9E9]/10 border border-[#85B9E9]/20 flex items-center justify-center flex-shrink-0">
            <Database size={16} className="text-[#85B9E9]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Estoque de Proxies</p>
            <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">
              Proxies armazenados aqui são atribuídos automaticamente a cada conta nova no momento
              da conexão. Ao excluir uma conta (ou trocar o proxy dela), a entrada volta ao estoque
              como <span className="text-ink-2">livre</span> — antes de reatribuí-la a outra
              conta, verificamos se o proxy ainda responde; se estiver morto, ele é descartado.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-[#85B9E9]/25 text-[#85B9E9]/80 hover:text-[#85B9E9] hover:border-[#85B9E9]/45 hover:bg-[#85B9E9]/[0.06] transition-all flex-shrink-0"
        >
          {showAdd ? <X size={13} /> : <Plus size={13} />}
          {showAdd ? "Fechar" : "Adicionar"}
        </button>
      </div>

      {/* Contadores */}
      {pool && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { label: "Total", value: pool.total, cls: "text-ink-2" },
            { label: "Livres", value: pool.free, cls: "text-[#00498D]" },
            { label: "Em uso", value: pool.in_use, cls: "text-[#85B9E9]" },
          ].map(c => (
            <div key={c.label} className="rounded-xl border border-line bg-surface px-3 py-2.5">
              <p className={cn("text-lg font-bold tabular-nums", c.cls)}>{c.value}</p>
              <p className="text-[10px] uppercase tracking-wider text-ink-3 font-semibold">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Notificação inline */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-medium",
              notice.type === "success"
                ? "bg-[#00498D]/8 border-[#00498D]/20 text-[#00498D]"
                : "bg-red-500/8 border-red-500/25 text-red-300"
            )}
          >
            {notice.type === "success" ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {notice.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form de adição */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-1">
              <textarea
                value={addText}
                onChange={e => setAddText(e.target.value)}
                placeholder={"Um proxy por linha — qualquer um destes formatos:\nip:porta:usuario:senha\nusuario:senha@ip:porta\nhttp://usuario:senha@ip:porta\nip:porta"}
                rows={6}
                className="w-full input-glass rounded-xl px-3.5 py-3 text-xs font-mono resize-y"
              />
              <button
                onClick={handleAdd}
                disabled={adding || !addText.trim()}
                className="btn-primary flex items-center gap-2 text-sm px-4 py-2 disabled:opacity-50"
              >
                {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Adicionar ao estoque
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ações em massa */}
      {pool && pool.total > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleAssignAll}
            disabled={assigning || pool.free === 0}
            className="flex items-center gap-1.5 text-xs px-3.5 py-2.5 rounded-xl font-semibold bg-[#00498D]/10 border border-[#00498D]/25 text-[#00498D] hover:bg-[#00498D]/20 transition-all disabled:opacity-40"
          >
            {assigning ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            Atribuir às contas sem proxy
          </button>
          <button
            onClick={handleSwapFailed}
            disabled={swapping}
            title="Descarta o proxy das contas com falha nos últimos 30min e atribui um substituto livre do estoque"
            className="flex items-center gap-1.5 text-xs px-3.5 py-2.5 rounded-xl font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/20 transition-all disabled:opacity-40"
          >
            {swapping ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Trocar proxies com falha
          </button>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-ink-3 py-2">
          <Loader2 size={13} className="animate-spin" /> Carregando estoque...
        </div>
      ) : pool && pool.items.length > 0 ? (
        <div className="rounded-xl border border-line overflow-hidden max-h-80 overflow-y-auto">
          {pool.items.map((item, i) => (
            <div
              key={item.id}
              className={cn(
                "flex items-center gap-3 px-3.5 py-2.5",
                i < pool.items.length - 1 && "border-b border-line"
              )}
            >
              <span className={cn(
                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                item.assigned_username ? "bg-[#85B9E9]" : "bg-[#00498D]"
              )} />
              <span className="text-xs font-mono text-ink-2 flex-1 truncate">{item.display}</span>
              {item.assigned_username ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#85B9E9]/10 text-[#85B9E9] font-semibold">
                  @{item.assigned_username}
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00498D]/10 text-[#00498D] font-semibold">
                  livre
                </span>
              )}
              {!item.assigned_username && (
                <button
                  onClick={() => handleRemove(item.id)}
                  disabled={removingId === item.id}
                  title="Remover do estoque"
                  className="text-ink-3/50 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  {removingId === item.id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Trash2 size={12} />
                  }
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-3 py-1">
          Estoque vazio — adicione proxies para que contas novas os recebam automaticamente ao conectar.
        </p>
      )}
    </div>
  );
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
        <h1 className="text-2xl font-bold tracking-tight text-white">Proxies</h1>
        <p className="text-sm text-ink-3 mt-0.5">
          Estoque com atribuição automática e verificação do IP real de cada conta.
        </p>
      </div>

      <ProxyPoolSection />

      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#00498D]/10 border border-[#00498D]/20 flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-[#00498D]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Verificar IPs</p>
            <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">
              Cada conta faz uma requisição ao serviço <span className="font-mono text-ink-2">api.ipify.org</span> através
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
                ? "bg-[#00498D]/8 border-[#00498D]/20 text-[#00498D]"
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
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 sm:gap-0">
                {/* Header */}
                <div className="contents text-[10px] uppercase tracking-wider text-ink-3 font-semibold">
                  <div className="px-4 py-2.5 border-b border-line">Conta</div>
                  <div className="px-4 py-2.5 border-b border-line">Session ID</div>
                  <div className="px-4 py-2.5 border-b border-line">IP detectado</div>
                </div>

                {results.map((r, i) => (
                  <div key={r.id} className="contents">
                    <div className={cn(
                      "px-4 py-3 flex items-center gap-2",
                      i < results.length - 1 && "border-b border-line"
                    )}>
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                        r.ip ? "bg-[#00498D]" : "bg-red-400"
                      )} />
                      <span className="text-sm text-ink font-medium">@{r.username}</span>
                      <span className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase",
                        r.source === "dedicado"
                          ? "bg-[#00498D]/15 text-[#85B9E9]"
                          : r.source === "template"
                          ? "bg-blue-500/15 text-blue-400"
                          : "bg-surface-raised text-ink-3"
                      )}>
                        {r.source}
                      </span>
                    </div>
                    <div className={cn(
                      "px-4 py-3 flex items-center",
                      i < results.length - 1 && "border-b border-line"
                    )}>
                      <span className="text-xs font-mono text-ink-3">{r.session_id}</span>
                    </div>
                    <div className={cn(
                      "px-4 py-3 flex items-center",
                      i < results.length - 1 && "border-b border-line"
                    )}>
                      {r.ip ? (
                        <span className="text-xs font-mono text-[#85B9E9]">{r.ip}</span>
                      ) : (
                        <span className="text-xs text-red-400/70">{r.error ?? "erro"}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-ink-3/50 text-center">
              IPs diferentes = proxies únicos por conta. Cada conta usa um proxy fixo e dedicado — sem rotação de sessão.
            </p>
          </motion.div>
        )}

        {done && results.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass-card rounded-2xl p-8 text-center"
          >
            <RefreshCw size={24} className="text-ink-3/50 mx-auto mb-3" />
            <p className="text-sm text-ink-3">Nenhuma conta ativa encontrada.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
