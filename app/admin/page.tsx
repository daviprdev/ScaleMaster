"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Instagram,
  Clock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  TrendingUp,
  Megaphone,
  Send,
  Trash2,
  CheckCheck,
  DollarSign,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

interface Stats {
  totalUsers: number;
  usersByStatus: { pending: number; approved: number; banned: number };
  totalAccounts: number;
  totalScheduled: number;
  totalPublished: number;
  userGrowth: { date: string; users: number }[];
}

interface Announcement {
  id: string;
  message: string;
  created_at: string;
}

interface SaleRow {
  id: string;
  amount: number | null;
  currency: string;
  customer: string | null;
  planName: string | null;
  source: string;
  createdAt: string;
}

interface SalesData {
  totals: { today: number; week: number; month: number; allTime: number; count: number };
  sales: SaleRow[];
}

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDay(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [annMsg, setAnnMsg] = useState("");
  const [annLoading, setAnnLoading] = useState(false);
  const [annSaved, setAnnSaved] = useState(false);

  const [sales, setSales] = useState<SalesData | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/stats").then((r) => r.json()),
      fetch("/api/admin/announcements").then((r) => r.json()),
      fetch("/api/admin/sales").then((r) => r.json()),
    ])
      .then(([statsData, annData, salesData]) => {
        if (statsData.error) throw new Error(statsData.error);
        setStats(statsData);
        if (annData.announcement) {
          setAnnouncement(annData.announcement);
          setAnnMsg(annData.announcement.message);
        }
        if (!salesData.error) setSales(salesData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function saveAnnouncement() {
    if (!annMsg.trim() || annLoading) return;
    setAnnLoading(true);
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: annMsg }),
    });
    const data = await res.json() as { announcement?: Announcement };
    if (res.ok && data.announcement) {
      setAnnouncement(data.announcement);
      setAnnSaved(true);
      setTimeout(() => setAnnSaved(false), 3000);
    }
    setAnnLoading(false);
  }

  async function clearAnnouncement() {
    if (annLoading) return;
    setAnnLoading(true);
    await fetch("/api/admin/announcements", { method: "DELETE" });
    setAnnouncement(null);
    setAnnMsg("");
    setAnnLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-white/40 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-[#00498D]" />
        <span className="text-sm">Carregando painel…</span>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-400">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {error ?? "Erro ao carregar dados"}
      </div>
    );
  }

  const totalNewUsers = stats.userGrowth.reduce((s, d) => s + d.users, 0);

  const kpiCards = [
    {
      label: "Usuários cadastrados",
      value: stats.totalUsers,
      icon: Users,
      color: "text-[#00498D]",
      border: "border-[#00498D]/20",
      breakdown: [
        { label: "Aprovados", value: stats.usersByStatus?.approved ?? 0, color: "text-emerald-400" },
        { label: "Pendentes", value: stats.usersByStatus?.pending  ?? 0, color: "text-amber-400" },
        { label: "Banidos",   value: stats.usersByStatus?.banned   ?? 0, color: "text-red-400" },
      ],
    },
    {
      label: "Contas Meta conectadas",
      value: stats.totalAccounts,
      icon: Instagram,
      color: "text-[#85B9E9]",
      border: "border-[#85B9E9]/20",
      breakdown: null,
    },
    {
      label: "Posts pendentes",
      value: stats.totalScheduled,
      icon: Clock,
      color: "text-amber-400",
      border: "border-amber-500/20",
      breakdown: null,
    },
    {
      label: "Posts publicados",
      value: stats.totalPublished,
      icon: CheckCircle2,
      color: "text-emerald-400",
      border: "border-emerald-500/20",
      breakdown: null,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Visão Geral</h1>
        <p className="page-subtitle mt-1">Resumo da plataforma em tempo real</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map(({ label, value, icon: Icon, color, border, breakdown }) => (
          <div
            key={label}
            className={cn(
              "glass-card ticks rounded-2xl p-5",
              border
            )}
          >
            <div className="flex items-start gap-4">
              <div className={cn("mt-0.5", color)}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-bold text-white metric-value">{value.toLocaleString("pt-BR")}</p>
                <p className="text-xs text-white/40 mt-0.5">{label}</p>
              </div>
            </div>
            {breakdown && (
              <div className="mt-3 pt-3 border-t border-white/[0.06] flex gap-3 flex-wrap">
                {breakdown.map((b) => (
                  <span key={b.label} className="text-[11px] text-white/40">
                    <span className={cn("font-semibold", b.color)}>{b.value}</span>{" "}{b.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Growth Chart */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#00498D]" />
              <h2 className="text-sm font-semibold text-white">Crescimento de usuários</h2>
            </div>
            <p className="text-xs text-white/40 mt-0.5">Últimos 30 dias</p>
          </div>
          <span className="text-xs text-white/30">+{totalNewUsers} novos usuários</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={stats.userGrowth} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00498D" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#00498D" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff06" vertical={false} />
            <XAxis
              dataKey="date" tickFormatter={formatDay}
              tick={{ fontSize: 11, fill: "#ffffff25" }}
              axisLine={false} tickLine={false} interval={4}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "#ffffff25" }}
              axisLine={false} tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(0,0,0,0.88)",
                border: "1px solid rgba(0,73,141,0.15)",
                borderRadius: 12,
                fontSize: 12,
                color: "#fff",
              }}
              labelFormatter={(l) => formatDay(String(l))}
              formatter={(v) => [v, "novos usuários"]}
            />
            <Area
              type="monotone" dataKey="users"
              stroke="#00498D" strokeWidth={2}
              fill="url(#gradUsers)" dot={false}
              activeDot={{ r: 4, fill: "#00498D", stroke: "#000", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Vendas (ApexVips + SharkBot) */}
      {sales && (
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-4 h-4 text-[#00498D]" />
            <h2 className="text-sm font-semibold text-white">Vendas</h2>
            <span className="text-xs text-white/30">ApexVips · SharkBot</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Hoje", value: sales.totals.today },
              { label: "Últimos 7 dias", value: sales.totals.week },
              { label: "Últimos 30 dias", value: sales.totals.month },
              { label: "Total geral", value: sales.totals.allTime },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <p className="text-lg font-bold text-white metric-value">{formatBRL(c.value)}</p>
                <p className="text-[11px] text-white/40 mt-0.5">{c.label}</p>
              </div>
            ))}
          </div>

          {sales.sales.length === 0 ? (
            <p className="text-sm text-white/30 text-center py-6">Nenhuma venda registrada ainda.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-white/30 text-xs border-b border-white/[0.06]">
                    <th className="px-2 py-2 font-medium">Cliente</th>
                    <th className="px-2 py-2 font-medium">Plano</th>
                    <th className="px-2 py-2 font-medium">Valor</th>
                    <th className="px-2 py-2 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.sales.map((s) => (
                    <tr key={s.id} className="border-b border-white/[0.03] last:border-0">
                      <td className="px-2 py-2.5 text-white/70">{s.customer ?? "—"}</td>
                      <td className="px-2 py-2.5 text-white/50">{s.planName ?? "—"}</td>
                      <td className="px-2 py-2.5 text-[#00498D] font-medium">
                        {s.amount != null ? formatBRL(s.amount) : "—"}
                      </td>
                      <td className="px-2 py-2.5 text-white/40">
                        {new Date(s.createdAt).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Announcement broadcaster */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <Megaphone className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Central de Avisos</h2>
          {announcement && (
            <span className="ml-1 inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 font-medium">
              Aviso ativo
            </span>
          )}
        </div>
        <p className="text-xs text-white/40 mb-4">
          Digite uma mensagem e clique em Disparar para exibir um banner para todos os usuários logados.
          Clique em Limpar para remover o banner.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={annMsg}
            onChange={(e) => setAnnMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveAnnouncement()}
            placeholder="Ex: Manutenção programada às 23h hoje…"
            className="input-glass flex-1 text-sm"
          />
          <button
            onClick={saveAnnouncement}
            disabled={annLoading || !annMsg.trim()}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all shrink-0",
              annSaved
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            {annLoading ? <Loader2 className="w-4 h-4 animate-spin" />
              : annSaved   ? <CheckCheck className="w-4 h-4" />
              : <Send className="w-4 h-4" />}
            {annSaved ? "Disparado!" : "Disparar Aviso"}
          </button>
          {announcement && (
            <button
              onClick={clearAnnouncement}
              disabled={annLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/20 transition-all shrink-0 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
              Limpar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
