"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft, Link2, Copy, Check, MousePointerClick, Calendar, CalendarDays,
  Loader2, AlertCircle, ExternalLink, History, Monitor, Globe2, Tag, ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { publicLinkUrl } from "@/lib/link-base-url";

// ── Tipos ───────────────────────────────────────────────────────────────────

interface ManagedLink {
  id: string;
  slug: string;
  name: string | null;
  destination_url: string;
  status: "active" | "paused" | "archived";
  forward_query_params: boolean;
  click_count: number;
  last_clicked_at: string | null;
  created_at: string;
  instagram_accounts?: { username: string } | null;
  campaign_id: string | null;
}

interface HistoryRow {
  id: string;
  change_type: string;
  old_destination_url: string | null;
  new_destination_url: string | null;
  changed_at: string;
}

interface Bucket { label: string; clicks: number }

interface ClickRow {
  clicked_at: string;
  referrer_host: string | null;
  device_type: string | null;
  browser_family: string | null;
  country: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

interface Analytics {
  window_days: number;
  total_clicks: number;
  clicks_today: number;
  clicks_7d: number;
  clicks_30d: number;
  daily: { day: string; clicks: number }[];
  referrers: Bucket[];
  devices: Bucket[];
  browsers: Bucket[];
  utm_sources: Bucket[];
  recent: ClickRow[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`.replace(".0", "");
  return `${(n / 1_000_000).toFixed(1)}M`.replace(".0", "");
}

function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const CHANGE_LABEL: Record<string, string> = {
  created: "Link criado",
  destination_changed: "Destino alterado",
  activated: "Ativado",
  deactivated: "Pausado",
  archived: "Arquivado",
  renamed: "Nome alterado",
  settings_changed: "Configuração alterada",
};

// ── Blocos ──────────────────────────────────────────────────────────────────

function Metric({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string; color: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/30 font-semibold">
        <Icon size={12} style={{ color }} /> {label}
      </div>
      <p className="mt-2 text-xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

/** Gráfico de barras em SVG puro — sem dependência nova de charting. */
function DailyChart({ data }: { data: { day: string; clicks: number }[] }) {
  if (data.length === 0) {
    return <p className="text-xs text-white/25 py-10 text-center">Nenhum clique no período.</p>;
  }
  const max = Math.max(...data.map((d) => d.clicks), 1);
  return (
    <div className="flex items-end gap-1 h-40 pt-2 overflow-x-auto">
      {data.map((d) => (
        <div key={d.day} className="flex-1 min-w-[14px] flex flex-col items-center gap-1.5 group">
          <span className="text-[9px] text-white/0 group-hover:text-[#00E5FF] transition-colors">
            {d.clicks}
          </span>
          <div
            title={`${dayLabel(d.day)} — ${d.clicks} clique${d.clicks !== 1 ? "s" : ""}`}
            className="w-full rounded-t transition-all"
            style={{
              height: `${Math.max((d.clicks / max) * 100, 3)}%`,
              background: "linear-gradient(180deg,#00FF41,#00E5FF)",
              boxShadow: "0 0 10px rgba(0,255,65,0.25)",
            }}
          />
          <span className="text-[8px] text-white/25 whitespace-nowrap">{dayLabel(d.day)}</span>
        </div>
      ))}
    </div>
  );
}

function Breakdown({ title, icon: Icon, items }: {
  title: string; icon: React.ElementType; items: Bucket[];
}) {
  const total = items.reduce((s, i) => s + i.clicks, 0);
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/30 font-semibold">
        <Icon size={12} /> {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-white/25 mt-4">Sem dados.</p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {items.map((i) => (
            <div key={i.label}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/60 truncate">{i.label}</span>
                <span className="text-white/35 font-mono flex-shrink-0 ml-2">{i.clicks}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${total ? (i.clicks / total) * 100 : 0}%`,
                    background: "linear-gradient(90deg,#00FF41,#00E5FF)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function LinkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [link, setLink] = useState<ManagedLink | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [linkRes, anRes] = await Promise.all([
        fetch(`/api/links/${id}`, { cache: "no-store" }),
        fetch(`/api/links/${id}/analytics?days=${days}`, { cache: "no-store" }),
      ]);

      if (linkRes.status === 404) { setError("Link não encontrado."); return; }
      if (!linkRes.ok) { setError("Não foi possível carregar o link."); return; }

      const linkData = await linkRes.json() as { link: ManagedLink; history: HistoryRow[] };
      setLink(linkData.link);
      setHistory(linkData.history ?? []);

      if (anRes.ok) {
        const anData = await anRes.json() as { analytics: Analytics };
        setAnalytics(anData.analytics);
      }
      setError(null);
    } catch {
      setError("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  }, [id, days]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(publicLinkUrl(link.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* o navegador pode bloquear fora de contexto seguro */ }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/35 py-16 justify-center">
        <Loader2 size={15} className="animate-spin" /> Carregando...
      </div>
    );
  }

  if (error || !link) {
    return (
      <div className="glass-card rounded-2xl p-12 text-center max-w-md mx-auto">
        <AlertCircle size={24} className="text-red-400/60 mx-auto mb-3" />
        <p className="text-sm text-white/50">{error ?? "Link não encontrado."}</p>
        <Link href="/dashboard/links" className="btn-ghost inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-xl text-xs">
          <ArrowLeft size={13} /> Voltar para os links
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/links"
          className="inline-flex items-center gap-1.5 text-xs text-white/35 hover:text-white transition-colors"
        >
          <ArrowLeft size={13} /> Links Gerenciáveis
        </Link>

        <div className="mt-3 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <Link2 size={19} className="text-[#00FF41] flex-shrink-0" />
              <span className="truncate">{link.name || "Sem nome"}</span>
              <span className={cn(
                "text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border flex-shrink-0",
                link.status === "active" ? "bg-[#00FF41]/10 text-[#00FF41] border-[#00FF41]/20"
                  : link.status === "paused" ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                  : "bg-white/[0.05] text-white/35 border-white/10"
              )}>
                {link.status === "active" ? "Ativo" : link.status === "paused" ? "Pausado" : "Arquivado"}
              </span>
            </h1>

            <button
              onClick={handleCopy}
              className="mt-2 flex items-center gap-1.5 text-sm font-mono text-[#00FF41]/80 hover:text-[#00FF41] transition-colors max-w-full"
            >
              <span className="truncate">{publicLinkUrl(link.slug)}</span>
              {copied ? <Check size={13} className="flex-shrink-0" /> : <Copy size={13} className="flex-shrink-0 opacity-50" />}
            </button>

            <div className="mt-1 flex items-center gap-1.5 text-xs text-white/30 min-w-0">
              <ArrowUpRight size={12} className="flex-shrink-0" />
              <span className="truncate font-mono">{link.destination_url}</span>
              <a
                href={link.destination_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex-shrink-0 hover:text-white/60"
              >
                <ExternalLink size={11} />
              </a>
            </div>
          </div>

          {/* Janela */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  "text-xs px-3 py-2 rounded-xl font-semibold border transition-all",
                  days === d
                    ? "bg-[#00E5FF]/10 border-[#00E5FF]/25 text-[#00E5FF]"
                    : "bg-white/[0.02] border-white/[0.06] text-white/40 hover:text-white/70"
                )}
              >
                {d} dias
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric icon={MousePointerClick} label="Cliques totais" color="#00FF41"
          value={compact(analytics?.total_clicks ?? link.click_count)} />
        <Metric icon={Calendar} label="Hoje" color="#00E5FF"
          value={compact(analytics?.clicks_today ?? 0)} />
        <Metric icon={CalendarDays} label="7 dias" color="#00E5FF"
          value={compact(analytics?.clicks_7d ?? 0)} />
        <Metric icon={CalendarDays} label="30 dias" color="#00E5FF"
          value={compact(analytics?.clicks_30d ?? 0)} />
      </div>

      {/* Gráfico */}
      <div className="glass-card rounded-2xl p-5">
        <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">
          Cliques por dia — últimos {analytics?.window_days ?? days} dias
        </p>
        <DailyChart data={analytics?.daily ?? []} />
      </div>

      {/* Quebras */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Breakdown title="Origem" icon={Globe2} items={analytics?.referrers ?? []} />
        <Breakdown title="Dispositivo" icon={Monitor} items={analytics?.devices ?? []} />
        <Breakdown title="Navegador" icon={Globe2} items={analytics?.browsers ?? []} />
        <Breakdown title="utm_source" icon={Tag} items={analytics?.utm_sources ?? []} />
      </div>

      {/* Cliques recentes */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">
            Cliques recentes (últimos 50)
          </p>
          <p className="text-[11px] text-white/25 mt-1">
            Sem IP e sem User-Agent completo — só categoria de dispositivo, navegador e o host de origem.
          </p>
        </div>

        {(analytics?.recent.length ?? 0) === 0 ? (
          <p className="text-xs text-white/25 px-5 py-8 text-center">Nenhum clique registrado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-white/25">
                  <th className="text-left font-semibold px-5 py-2.5">Data/hora</th>
                  <th className="text-left font-semibold px-5 py-2.5">Origem</th>
                  <th className="text-left font-semibold px-5 py-2.5">Dispositivo</th>
                  <th className="text-left font-semibold px-5 py-2.5">Navegador</th>
                  <th className="text-left font-semibold px-5 py-2.5">País</th>
                  <th className="text-left font-semibold px-5 py-2.5">UTM</th>
                </tr>
              </thead>
              <tbody>
                {(analytics?.recent ?? []).map((c, i) => (
                  <tr key={`${c.clicked_at}-${i}`} className="border-t border-white/[0.04]">
                    <td className="px-5 py-2.5 text-white/55 whitespace-nowrap">{formatDatetime(c.clicked_at)}</td>
                    <td className="px-5 py-2.5 text-white/45">{c.referrer_host ?? "direto"}</td>
                    <td className="px-5 py-2.5 text-white/45">{c.device_type ?? "—"}</td>
                    <td className="px-5 py-2.5 text-white/45">{c.browser_family ?? "—"}</td>
                    <td className="px-5 py-2.5 text-white/45">{c.country ?? "—"}</td>
                    <td className="px-5 py-2.5 text-white/35 font-mono">
                      {[c.utm_source, c.utm_medium, c.utm_campaign].filter(Boolean).join(" / ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Histórico */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/30 font-semibold">
          <History size={12} /> Histórico de alterações
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-white/25 mt-4">Sem alterações registradas.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {history.map((h) => (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex gap-3"
              >
                <div className="flex flex-col items-center flex-shrink-0 pt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41]" />
                  <span className="flex-1 w-px bg-white/[0.07] mt-1" />
                </div>
                <div className="min-w-0 pb-1">
                  <p className="text-xs font-semibold text-white/70">
                    {CHANGE_LABEL[h.change_type] ?? h.change_type}
                    <span className="ml-2 text-[10px] font-normal text-white/25">
                      {formatDatetime(h.changed_at)}
                    </span>
                  </p>
                  {h.change_type === "destination_changed" && (
                    <p className="text-[11px] text-white/35 mt-1 font-mono break-all">
                      <span className="line-through text-white/20">{h.old_destination_url}</span>
                      {" → "}
                      <span className="text-[#00E5FF]/70">{h.new_destination_url}</span>
                    </p>
                  )}
                  {h.change_type === "created" && h.new_destination_url && (
                    <p className="text-[11px] text-white/30 mt-1 font-mono break-all">{h.new_destination_url}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
