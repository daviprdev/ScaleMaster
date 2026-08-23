"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, ArrowUp, ArrowDown, RefreshCw, CheckCircle2,
  XCircle, AlertTriangle, ChevronRight, Wifi, Activity,
  KeyRound, Ban, Zap, User, HelpCircle, Clock, TrendingUp,
} from "lucide-react";

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  is_active: boolean;
  health_status: "online" | "error" | "blocked";
  failover_priority: number;
}

interface FailoverLog {
  id: string;
  error_reason: string | null;
  created_at: string;
  failed_account: { id: string; username: string; display_name: string | null } | null;
  backup_account: { id: string; username: string; display_name: string | null } | null;
}

function HealthBadge({ status }: { status: string }) {
  if (status === "online")
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        Online
      </span>
    );
  if (status === "error")
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Erro
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      Bloqueada
    </span>
  );
}

function PriorityLabel({ index }: { index: number }) {
  if (index === 0)
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-violet-500/15 border border-violet-500/30 text-violet-300">
        PRINCIPAL
      </span>
    );
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-white/[0.05] border border-white/[0.08] text-white/40">
      RESERVA {index}
    </span>
  );
}

function AccountAvatar({ username }: { username: string }) {
  const initials = username.slice(0, 2).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
      {initials}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagnóstico types
// ---------------------------------------------------------------------------

type ErrorCategory = "token" | "blocked" | "rate_limit" | "personal" | "transient" | "unknown";

interface DiagCategory {
  category: ErrorCategory;
  label: string;
  color: string;
  count: number;
  percentage: number;
}

interface DiagTimelinePoint {
  hour: string;
  label: string;
  count: number;
}

interface DiagErrorAccount {
  id: string;
  username: string;
  category: string;
  categoryLabel: string;
  categoryColor: string;
  lastError: string | null;
  lastDropAt: string | null;
  tokenExpiresAt: string | null;
  hasToken: boolean;
}

interface DiagExpiringToken {
  id: string;
  username: string;
  token_expires_at: string;
  days_left: number;
}

interface DiagTopError {
  message: string;
  count: number;
  accounts: string[];
  category: { category: string; label: string; color: string };
}

interface DiagData {
  summary: {
    total_drops_7d: number;
    accounts_in_error: number;
    accounts_online: number;
    tokens_expiring_soon: number;
    thundering_herd: boolean;
    max_drops_in_one_hour: number;
  };
  categories: DiagCategory[];
  timeline: DiagTimelinePoint[];
  error_accounts: DiagErrorAccount[];
  expiring_tokens: DiagExpiringToken[];
  top_errors: DiagTopError[];
}

// ---------------------------------------------------------------------------
// Category icon + color helpers
// ---------------------------------------------------------------------------

function categoryIcon(cat: string) {
  if (cat === "token")     return <KeyRound size={12} />;
  if (cat === "blocked")   return <Ban size={12} />;
  if (cat === "rate_limit")return <Zap size={12} />;
  if (cat === "personal")  return <User size={12} />;
  if (cat === "transient") return <Activity size={12} />;
  return <HelpCircle size={12} />;
}

function categoryStyle(color: string): string {
  const map: Record<string, string> = {
    red:    "bg-red-500/10 border-red-500/20 text-red-400",
    orange: "bg-orange-500/10 border-orange-500/20 text-orange-400",
    amber:  "bg-amber-500/10 border-amber-500/20 text-amber-400",
    violet: "bg-violet-500/10 border-violet-500/20 text-violet-400",
    blue:   "bg-blue-500/10 border-blue-500/20 text-blue-400",
    gray:   "bg-white/[0.05] border-white/[0.08] text-white/40",
  };
  return map[color] ?? map.gray;
}

function barColor(color: string): string {
  const map: Record<string, string> = {
    red: "bg-red-500", orange: "bg-orange-500", amber: "bg-amber-400",
    violet: "bg-violet-500", blue: "bg-blue-500", gray: "bg-white/20",
  };
  return map[color] ?? "bg-white/20";
}

// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export default function FailoverPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<FailoverLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"failover" | "diagnostico">("failover");
  const [diag, setDiag] = useState<DiagData | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, logRes] = await Promise.all([
        fetch("/api/failover/accounts"),
        fetch("/api/failover/logs"),
      ]);
      const accData = await accRes.json();
      const logData = await logRes.json();
      if (accData.error) throw new Error(accData.error);
      setAccounts(accData.accounts ?? []);
      setLogs(logData.logs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDiag = useCallback(async () => {
    setDiagLoading(true);
    try {
      const res = await fetch("/api/diagnostics/drops");
      const data = await res.json();
      setDiag(data);
    } catch {
      // silencioso
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "diagnostico" && !diag) loadDiag();
  }, [activeTab, diag, loadDiag]);

  useEffect(() => {
    load();
  }, [load]);

  const savePriorities = useCallback(async (arr: Account[], previous: Account[]) => {
    setSaving(true);
    try {
      const res = await fetch("/api/failover/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: arr.map((a, i) => ({ id: a.id, failover_priority: i })),
        }),
      });
      if (!res.ok) throw new Error("PATCH falhou");
    } catch {
      // Reverte a reordenação local — o servidor não confirmou a nova ordem
      setAccounts(previous);
      setError("Não foi possível salvar a nova ordem. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    const swap = idx + dir;
    if (swap < 0 || swap >= accounts.length) return;
    const previous = accounts;
    const arr = [...accounts];
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    setAccounts(arr);
    savePriorities(arr, previous);
  };

  const cleanupErrorAccounts = async () => {
    if (!cleanupConfirm) { setCleanupConfirm(true); return; }
    setCleanupLoading(true);
    setCleanupConfirm(false);
    setCleanupResult(null);
    try {
      const res = await fetch("/api/failover/remove-from-loops", { method: "POST" });
      const data = await res.json() as { removed?: number; usernames?: string[]; error?: string };
      if (data.error) throw new Error(data.error);
      setCleanupResult(`${data.removed ?? 0} conta(s) removidas de todos os loops.`);
      load();
    } catch (e) {
      setCleanupResult(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCleanupLoading(false);
    }
  };

  const restore = async (id: string) => {
    setRestoringId(id);
    await fetch("/api/failover/accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setRestoringId(null);
    load();
  };

  const healthCounts = accounts.reduce(
    (acc, a) => {
      acc[a.health_status] = (acc[a.health_status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={20} className="text-violet-400" />
            <h1 className="text-xl font-bold text-white">Failover de Contas</h1>
          </div>
          <p className="text-sm text-white/40">
            Redundância automática — quando uma conta falha, a próxima assume.
          </p>
        </div>
        <button
          onClick={activeTab === "failover" ? load : loadDiag}
          disabled={activeTab === "failover" ? loading : diagLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08] text-sm transition-colors disabled:opacity-40"
        >
          <RefreshCw size={14} className={(loading || diagLoading) ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit">
        {(["failover", "diagnostico"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab
                ? "bg-white/[0.08] text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {tab === "failover" ? <Shield size={13} /> : <Activity size={13} />}
            {tab === "failover" ? "Failover" : "Diagnóstico"}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* ── Aba Diagnóstico ─────────────────────────────────────────────────── */}
      {activeTab === "diagnostico" && (
        <div className="space-y-5">
          {diagLoading && (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-white/[0.03] animate-pulse" />)}
            </div>
          )}
          {!diagLoading && !diag && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Activity size={28} className="text-white/10" />
              <p className="text-sm text-white/30">Nenhum dado de diagnóstico disponível.</p>
            </div>
          )}
          {!diagLoading && diag && (
            <div className="space-y-5">

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { label: "Quedas 7d", value: diag.summary.total_drops_7d, color: "text-red-400" },
                  { label: "Em erro", value: diag.summary.accounts_in_error, color: "text-red-400" },
                  { label: "Online", value: diag.summary.accounts_online, color: "text-green-400" },
                  { label: "Token expirando", value: diag.summary.tokens_expiring_soon, color: "text-amber-400" },
                  { label: "Pico/hora", value: diag.summary.max_drops_in_one_hour, color: diag.summary.thundering_herd ? "text-orange-400" : "text-white/60" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="glass-card rounded-xl p-4 text-center">
                    <div className={`text-2xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-white/40 mt-1">{label}</div>
                  </div>
                ))}
              </div>

              {/* Thundering herd alert */}
              {diag.summary.thundering_herd && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-orange-500/10 border border-orange-500/25">
                  <AlertTriangle size={15} className="text-orange-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-orange-300">Queda em cascata detectada</p>
                    <p className="text-xs text-white/40 mt-0.5 leading-relaxed">
                      {diag.summary.max_drops_in_one_hour} contas caíram na mesma hora — provável problema no nível do App Meta (não nas contas individuais). Considere distribuir contas em múltiplos Apps (<span className="text-white/60">Configurações → Apps</span>).
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Distribuição de erros */}
                <div className="glass-card rounded-2xl p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-white/80">Tipo de Erro (7 dias)</h2>
                  {diag.categories.length === 0 ? (
                    <div className="flex items-center gap-2 py-8 justify-center text-white/30 text-sm">
                      <CheckCircle2 size={16} className="text-green-500/40" /> Nenhuma queda registrada
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {diag.categories.map(cat => (
                        <div key={cat.category}>
                          <div className="flex items-center justify-between mb-1">
                            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border ${categoryStyle(cat.color)}`}>
                              {categoryIcon(cat.category)}
                              {cat.label}
                            </div>
                            <span className="text-xs text-white/40">{cat.count}× ({cat.percentage}%)</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/[0.05]">
                            <div
                              className={`h-full rounded-full ${barColor(cat.color)} transition-all`}
                              style={{ width: `${cat.percentage}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Timeline 48h */}
                <div className="glass-card rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white/80">Quedas por Hora (48h)</h2>
                    <span className="text-xs text-white/30 flex items-center gap-1">
                      <Clock size={11} /> últimas 48h
                    </span>
                  </div>
                  {diag.timeline.every(t => t.count === 0) ? (
                    <div className="flex items-center gap-2 py-8 justify-center text-white/30 text-sm">
                      <CheckCircle2 size={16} className="text-green-500/40" /> Nenhuma queda neste período
                    </div>
                  ) : (
                    <div className="flex items-end gap-0.5 h-24 overflow-x-auto pb-1">
                      {(() => {
                        const max = Math.max(...diag.timeline.map(t => t.count), 1);
                        // Mostra apenas as últimas 36 horas para caber na tela
                        const visible = diag.timeline.slice(-36);
                        return visible.map((t, i) => (
                          <div key={i} className="flex flex-col items-center gap-0.5 flex-1 min-w-[6px]" title={`${t.hour}: ${t.count} quedas`}>
                            <div
                              className={`w-full rounded-sm transition-all ${t.count > 0 ? (t.count >= 4 ? "bg-orange-500" : "bg-red-500/70") : "bg-white/[0.05]"}`}
                              style={{ height: `${Math.max(4, (t.count / max) * 80)}px` }}
                            />
                            {i % 6 === 0 && (
                              <span className="text-[8px] text-white/20 truncate">{t.label}</span>
                            )}
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                  <p className="text-[11px] text-white/25">
                    Barras laranja = 4+ quedas na mesma hora (thundering herd).
                  </p>
                </div>
              </div>

              {/* Contas em erro */}
              {diag.error_accounts.length > 0 && (
                <div className="glass-card rounded-2xl p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-white/80">
                    Contas em Erro ({diag.error_accounts.length})
                  </h2>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                    {diag.error_accounts.map(acc => (
                      <div key={acc.id} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500/40 to-red-700/40 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                          {acc.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-semibold text-white/80">@{acc.username}</span>
                            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${categoryStyle(acc.categoryColor)}`}>
                              {categoryIcon(acc.category as ErrorCategory)}
                              {acc.categoryLabel}
                            </span>
                          </div>
                          {acc.lastError && (
                            <p className="text-[11px] text-white/30 truncate">{acc.lastError}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1">
                            {acc.lastDropAt && (
                              <span className="text-[11px] text-white/20">{timeAgo(acc.lastDropAt)}</span>
                            )}
                            {!acc.hasToken && (
                              <span className="text-[10px] text-amber-400/70">sem token</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top erros */}
              {diag.top_errors.length > 0 && (
                <div className="glass-card rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-white/40" />
                    <h2 className="text-sm font-semibold text-white/80">Mensagens de Erro Mais Frequentes</h2>
                  </div>
                  <div className="space-y-2">
                    {diag.top_errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                        <span className="text-xs font-bold text-white/25 mt-0.5 w-5 shrink-0">#{i+1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white/60 break-words mb-1">{e.message}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-white/30">{e.count}× —</span>
                            {e.accounts.map(u => (
                              <span key={u} className="text-[10px] text-white/40">@{u}</span>
                            ))}
                            {e.accounts.length < e.count && (
                              <span className="text-[10px] text-white/20">+{e.count - e.accounts.length} outros</span>
                            )}
                          </div>
                        </div>
                        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${categoryStyle(e.category.color)}`}>
                          {categoryIcon(e.category.category as ErrorCategory)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tokens expirando */}
              {diag.expiring_tokens.length > 0 && (
                <div className="glass-card rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <KeyRound size={14} className="text-amber-400" />
                    <h2 className="text-sm font-semibold text-white/80">Tokens Expirando em Breve</h2>
                  </div>
                  <div className="space-y-2">
                    {diag.expiring_tokens.map(t => (
                      <div key={t.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/15">
                        <span className="text-sm text-white/70">@{t.username}</span>
                        <span className={`text-xs font-semibold ${t.days_left <= 1 ? "text-red-400" : t.days_left <= 3 ? "text-orange-400" : "text-amber-400"}`}>
                          {t.days_left === 0 ? "hoje" : `${t.days_left}d restantes`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/25 leading-relaxed">
                    Tokens próximos de expirar são renovados automaticamente pelo cron. Se a renovação falhar, a conta cai. Considere reconectar manualmente as mais críticas.
                  </p>
                </div>
              )}

            </div>
          )}
        </div>
      )}

      {/* ── Aba Failover (conteúdo original) ───────────────────────────────── */}
      {activeTab === "failover" && (
        <div className="space-y-6">

      {/* Cleanup banner — aparece quando há contas em erro */}
      {!loading && (healthCounts.error ?? 0) > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/20">
          <div className="flex items-start gap-3">
            <XCircle size={15} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-300">
                {healthCounts.error} conta(s) com erro ainda dentro dos loops
              </p>
              <p className="text-xs text-white/40 mt-0.5">
                Contas mortas continuam sendo tentadas pelo cron e consomem rate-limit das contas saudáveis.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {cleanupResult && (
              <span className="text-xs text-green-400">{cleanupResult}</span>
            )}
            <button
              onClick={cleanupErrorAccounts}
              disabled={cleanupLoading}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-40 ${
                cleanupConfirm
                  ? "bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"
                  : "bg-white/[0.06] border border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.1]"
              }`}
            >
              {cleanupLoading ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <XCircle size={13} />
              )}
              {cleanupConfirm ? "Confirmar remoção" : "Remover dos loops"}
            </button>
            {cleanupConfirm && (
              <button
                onClick={() => setCleanupConfirm(false)}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Summary chips */}
      {!loading && accounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {healthCounts.online > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium">
              <CheckCircle2 size={12} /> {healthCounts.online} online
            </span>
          )}
          {healthCounts.error > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
              <XCircle size={12} /> {healthCounts.error} com erro
            </span>
          )}
          {healthCounts.blocked > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
              <AlertTriangle size={12} /> {healthCounts.blocked} bloqueada
            </span>
          )}
          {saving && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium">
              <RefreshCw size={12} className="animate-spin" /> Salvando ordem…
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Grupo de Failover */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white/80 mb-0.5">Grupo de Failover</h2>
            <p className="text-xs text-white/30">
              Use as setas para definir a ordem de prioridade das contas.
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-[60px] rounded-xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Wifi size={28} className="text-white/10" />
              <p className="text-sm text-white/30">Nenhuma conta conectada.</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {accounts.map((acc, idx) => (
                <motion.div
                  key={acc.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.18 }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                    idx === 0
                      ? "bg-violet-500/[0.06] border-violet-500/20"
                      : acc.health_status !== "online"
                      ? "bg-red-500/[0.04] border-red-500/15"
                      : "bg-white/[0.03] border-white/[0.06]"
                  }`}
                >
                  {/* Avatar */}
                  <AccountAvatar username={acc.username} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-white/90 truncate">
                        @{acc.username}
                      </span>
                      <PriorityLabel index={idx} />
                    </div>
                    <HealthBadge status={acc.health_status} />
                  </div>

                  {/* Restore button */}
                  {acc.health_status !== "online" && (
                    <button
                      onClick={() => restore(acc.id)}
                      disabled={restoringId === acc.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.1] text-xs transition-colors disabled:opacity-40"
                    >
                      {restoringId === acc.id ? (
                        <RefreshCw size={11} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={11} />
                      )}
                      Restaurar
                    </button>
                  )}

                  {/* Reorder arrows */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="p-1 rounded-md hover:bg-white/[0.08] text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === accounts.length - 1}
                      className="p-1 rounded-md hover:bg-white/[0.08] text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Histórico de Failover */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white/80 mb-0.5">Histórico de Failover</h2>
            <p className="text-xs text-white/30">Últimos 50 eventos de troca automática de conta.</p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[52px] rounded-xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle2 size={28} className="text-green-500/30" />
              <p className="text-sm text-white/30">Nenhum evento de failover registrado.</p>
              <p className="text-xs text-white/20">
                Isso é ótimo — significa que suas contas estão saudáveis.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1 custom-scrollbar">
              <AnimatePresence>
                {logs.map((log, idx) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.05] transition-colors"
                  >
                    {/* Event icon */}
                    <div className="mt-0.5 p-1.5 rounded-lg bg-red-500/10 border border-red-500/15 shrink-0">
                      <XCircle size={12} className="text-red-400" />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="text-xs font-semibold text-white/80">
                          @{log.failed_account?.username ?? "conta removida"}
                        </span>
                        <ChevronRight size={10} className="text-white/20 shrink-0" />
                        <span
                          className={`text-xs font-semibold ${
                            log.backup_account ? "text-cyan-400" : "text-white/30"
                          }`}
                        >
                          {log.backup_account
                            ? `@${log.backup_account.username}`
                            : "sem backup"}
                        </span>
                        {log.backup_account && (
                          <span className="text-[10px] text-green-400/70">(assumiu)</span>
                        )}
                      </div>
                      {log.error_reason && (
                        <p className="text-[11px] text-white/30 truncate">
                          {log.error_reason.length > 80
                            ? log.error_reason.slice(0, 80) + "…"
                            : log.error_reason}
                        </p>
                      )}
                    </div>

                    {/* Time */}
                    <span className="text-[11px] text-white/25 shrink-0 mt-0.5">
                      {timeAgo(log.created_at)}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Info box */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-violet-500/[0.06] border border-violet-500/15">
        <Shield size={14} className="text-violet-400 mt-0.5 shrink-0" />
        <p className="text-xs text-white/40 leading-relaxed">
          Quando uma conta recebe um erro crítico da Meta API (token inválido, conta restrita ou
          bloqueada), o sistema marca-a automaticamente como{" "}
          <span className="text-red-400/80">Erro</span> e tenta publicar com a próxima conta{" "}
          <span className="text-green-400/80">Online</span> na lista de prioridade. O registro de
          cada troca fica visível no histórico acima.
        </p>
      </div>
        </div>
      )}
    </div>
  );
}
