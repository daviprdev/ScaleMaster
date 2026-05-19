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

interface Stats {
  totalUsers: number;
  totalAccounts: number;
  totalScheduled: number;
  totalPublished: number;
  userGrowth: { date: string; users: number }[];
}

function formatDay(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

const KPI_CARDS = (s: Stats) => [
  {
    label: "Usuários cadastrados",
    value: s.totalUsers,
    icon: Users,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    label: "Contas Meta conectadas",
    value: s.totalAccounts,
    icon: Instagram,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/20",
  },
  {
    label: "Posts pendentes",
    value: s.totalScheduled,
    icon: Clock,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  {
    label: "Posts publicados",
    value: s.totalPublished,
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStats(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-white/40 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Carregando painel…</span>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {error ?? "Erro ao carregar dados"}
      </div>
    );
  }

  const totalNewUsers = stats.userGrowth.reduce((s, d) => s + d.users, 0);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Visão Geral</h1>
        <p className="mt-1 text-sm text-white/40">
          Resumo da plataforma em tempo real
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS(stats).map(({ label, value, icon: Icon, color, bg }) => (
          <div
            key={label}
            className={`rounded-xl border p-5 flex items-start gap-4 ${bg}`}
          >
            <div className={`mt-0.5 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{value.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-white/40 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Growth Chart */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-white">
                Crescimento de usuários
              </h2>
            </div>
            <p className="text-xs text-white/40 mt-0.5">Últimos 30 dias</p>
          </div>
          <span className="text-xs text-white/30">
            +{totalNewUsers} novos usuários
          </span>
        </div>

        <ResponsiveContainer width="100%" height={240}>
          <AreaChart
            data={stats.userGrowth}
            margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDay}
              tick={{ fontSize: 11, fill: "#ffffff30" }}
              axisLine={false}
              tickLine={false}
              interval={4}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "#ffffff30" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#111827",
                border: "1px solid #ffffff15",
                borderRadius: 8,
                fontSize: 12,
                color: "#fff",
              }}
              labelFormatter={(label) => formatDay(String(label))}
              formatter={(v) => [v, "novos usuários"]}
            />
            <Area
              type="monotone"
              dataKey="users"
              stroke="#8B5CF6"
              strokeWidth={2}
              fill="url(#gradUsers)"
              dot={false}
              activeDot={{ r: 4, fill: "#8B5CF6" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
