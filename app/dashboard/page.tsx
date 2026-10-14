"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  CalendarCheck,
  ListOrdered,
  UserPlus,
  ShieldAlert,
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Send,
  Repeat2,
  ImagePlay,
  Eye,
  DollarSign,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import {
  PageHeader,
  StatTile,
  Card,
  Button,
  Badge,
  Skeleton,
  EmptyState,
  Segmented,
} from "@/components/ui";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────
interface DashboardStats {
  sales: { today: number; yesterday: number; month: number; prev_month: number };
  accounts: {
    total: number;
    added_today: number;
    added_yesterday: number;
    added_7d: number;
  };
  accounts_down: {
    total: number;
    down_today: number;
    down_yesterday: number;
    down_7d: number;
  };
  posts_today: { published: number; scheduled: number; loop: number };
  views: {
    total: number;
    today: number;
    yesterday: number;
    last_7d: number;
    last_30d: number;
    month: number;
    prev_month: number;
    today_has_data: boolean;
    accounts_total: number;
    accounts_synced: number;
    last_synced_at: string | null;
  };
  videos_published: { total: number; today: number; yesterday: number };
  accounts_active_today: number;
  queue: { pending: number };
  recent_activity: {
    type: "download" | "schedule";
    text: string;
    status: "success" | "error";
    created_at: string;
  }[];
  upcoming_posts: {
    account_username: string;
    scheduled_at: string;
    gradient: string;
  }[];
}

// ── Helpers ──────────────────────────────────────────────────────
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).toUpperCase();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora mesmo";
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return `há ${Math.floor(hrs / 24)}d`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatScheduled(dateStr: string): { label: string; time: string } {
  const d = new Date(dateStr);
  const now = new Date();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return { label: "Hoje", time };
  const tmr = new Date(now);
  tmr.setDate(now.getDate() + 1);
  if (d.toDateString() === tmr.toDateString()) return { label: "Amanhã", time };
  return { label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), time };
}

// ── Views period selector ────────────────────────────────────────
type ViewsPeriod = "today" | "yesterday" | "last_7d" | "last_30d" | "month";

const VIEWS_PERIODS: { value: ViewsPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "7 dias" },
  { value: "last_30d", label: "30 dias" },
  { value: "month", label: "Este mês" },
];

const VIEWS_HINTS: Record<ViewsPeriod, string> = {
  today: "Dia atual — zera às 21h (Brasília)",
  yesterday: "Dia anterior completo",
  last_7d: "Últimos 7 dias, incluindo hoje",
  last_30d: "Últimos 30 dias, incluindo hoje",
  month: "Desde o dia 1º — zera todo mês",
};

// ── Quick actions ────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: "Postar", href: "/dashboard/postar", icon: Send, desc: "Distribuição de conteúdo" },
  { label: "Loop", href: "/dashboard/loop", icon: Repeat2, desc: "Ciclo contínuo" },
  { label: "Stories", href: "/dashboard/stories", icon: ImagePlay, desc: "Postar e importar" },
] as const;

// ── Page ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [displayName, setDisplayName] = useState<string>("");
  const [viewsPeriod, setViewsPeriod] = useState<ViewsPeriod>("yesterday");
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set initial views period based on data availability
  useEffect(() => {
    if (stats?.views.today_has_data) setViewsPeriod("today");
  }, [stats?.views.today_has_data]);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setDisplayName(
          user.user_metadata?.display_name ||
            user.user_metadata?.full_name ||
            user.email?.split("@")[0] ||
            ""
        );
      }
    });
  }, []);

  const loadStats = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await fetch("/api/dashboard/stats", { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      if (!data.error) setStats(data);
    } catch {
      // Network/JSON error — silently ignore, next tick (60s) retries
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const id = setInterval(() => loadStats(true), 60_000);
    return () => clearInterval(id);
  }, [loadStats]);

  const handleClearQueue = useCallback(async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      clearTimer.current = setTimeout(() => setClearConfirm(false), 3500);
      return;
    }
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setClearConfirm(false);
    setClearing(true);
    try {
      await fetch("/api/posts/clear-pending", { method: "POST" });
      await loadStats(true);
    } finally {
      setClearing(false);
    }
  }, [clearConfirm, loadStats]);

  // ── Derived data ───────────────────────────────────────────────
  const viewsValue = stats ? Number(stats.views[viewsPeriod]) || 0 : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header — saudação dinâmica */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-bold leading-[32px] tracking-[-0.02em] text-ink">
            {getGreeting()},{" "}
            <span className="text-[#85B9E9]">
              {displayName || "Chefe"}
            </span>
          </h1>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-3">
            {getFormattedDate()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />}
            onClick={() => loadStats(true)}
            disabled={loading || refreshing}
          >
            {refreshing ? "Atualizando…" : "Atualizar"}
          </Button>
        </div>
      </div>

      {/* ── Stat tiles row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Sales */}
        <StatTile
          label="Vendas Hoje"
          value={loading ? "—" : formatBRL(stats?.sales.today ?? 0)}
          icon={<DollarSign size={18} />}
          hint={
            loading
              ? undefined
              : `Ontem: ${formatBRL(stats?.sales.yesterday ?? 0)} · Mês: ${formatBRL(stats?.sales.month ?? 0)}`
          }
        >
          {loading && <Skeleton height="4px" width="60%" />}
        </StatTile>

        {/* Views */}
        <StatTile
          label="Visualizações"
          value={loading ? "—" : formatCompact(viewsValue)}
          icon={<Eye size={18} />}
          hint={loading ? undefined : VIEWS_HINTS[viewsPeriod]}
        >
          {!loading && (
            <Segmented
              options={VIEWS_PERIODS}
              value={viewsPeriod}
              onChange={(v) => setViewsPeriod(v as ViewsPeriod)}
              className="mt-1"
            />
          )}
        </StatTile>

        {/* Videos published */}
        <StatTile
          label="Vídeos Publicados"
          value={loading ? "—" : String(stats?.videos_published.total ?? 0)}
          icon={<Play size={18} />}
          hint={
            loading
              ? undefined
              : `Hoje: ${stats?.videos_published.today ?? 0} · Ontem: ${stats?.videos_published.yesterday ?? 0}`
          }
        />

        {/* Active accounts */}
        <StatTile
          label="Contas Ativas Hoje"
          value={loading ? "—" : String(stats?.accounts_active_today ?? 0)}
          icon={<CheckCircle2 size={18} />}
          tone="positive"
          hint={
            loading
              ? undefined
              : `${stats?.accounts.total ?? 0} total conectadas`
          }
        />
      </div>

      {/* ── Breakdown cards ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Accounts added */}
        <Card
          title="Contas Adicionadas"
          description={loading ? undefined : `${stats?.accounts.added_7d ?? 0} novas em 7 dias`}
        >
          {loading ? (
            <div className="flex flex-col gap-3">
              <Skeleton height="24px" width="80px" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} height="32px" />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[28px] font-medium leading-[32px] tracking-[-0.02em] tabular-nums text-ink">
                {stats?.accounts.added_7d ?? 0}
              </span>
              <div className="grid grid-cols-3 gap-2 border-t border-line pt-3">
                {[
                  { label: "Hoje", value: stats?.accounts.added_today ?? 0 },
                  { label: "Ontem", value: stats?.accounts.added_yesterday ?? 0 },
                  { label: "7 dias", value: stats?.accounts.added_7d ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-0.5">
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                      {item.value}
                    </span>
                    <span className="text-[11px] text-ink-3">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Accounts down */}
        <Card
          title="Contas Caídas"
          description={loading ? undefined : `${stats?.accounts_down.total ?? 0} com erro agora`}
        >
          {loading ? (
            <div className="flex flex-col gap-3">
              <Skeleton height="24px" width="80px" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} height="32px" />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[28px] font-medium leading-[32px] tracking-[-0.02em] tabular-nums text-danger">
                {stats?.accounts_down.total ?? 0}
              </span>
              <div className="grid grid-cols-3 gap-2 border-t border-line pt-3">
                {[
                  { label: "Hoje", value: stats?.accounts_down.down_today ?? 0 },
                  { label: "Ontem", value: stats?.accounts_down.down_yesterday ?? 0 },
                  { label: "7 dias", value: stats?.accounts_down.down_7d ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-0.5">
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                      {item.value}
                    </span>
                    <span className="text-[11px] text-ink-3">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Two-column: Activity + Upcoming ────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent activity */}
        <Card title="Atividade Recente" className="lg:col-span-2">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton width="28px" height="28px" radius="var(--radius-md)" />
                  <Skeleton height="14px" className="flex-1" />
                  <Skeleton width="48px" height="10px" />
                </div>
              ))}
            </div>
          ) : !stats || stats.recent_activity.length === 0 ? (
            <EmptyState
              icon={<Clock size={24} />}
              title="Nenhuma atividade recente"
              description="As atividades de download e agendamento aparecerão aqui."
            />
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {stats.recent_activity.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:bg-surface-hover first:pt-0 last:pb-0"
                >
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                      item.status === "success"
                        ? "bg-success-soft border-transparent text-success"
                        : "bg-danger-soft border-transparent text-danger"
                    )}
                  >
                    {item.status === "success" ? (
                      <CheckCircle2 size={13} strokeWidth={2} />
                    ) : (
                      <AlertCircle size={13} strokeWidth={2} />
                    )}
                  </div>
                  <p className="flex-1 truncate text-sm text-ink-2">{item.text}</p>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-ink-3">
                    <Clock size={10} />
                    {timeAgo(item.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Upcoming posts */}
        <Card
          title="Próximas Postagens"
          actions={
            <div className="flex items-center gap-2">
              {!loading && stats && (
                <Badge tone="info">{stats.queue.pending} na fila</Badge>
              )}
              {!loading && stats && stats.queue.pending > 0 && (
                <Button
                  variant={clearConfirm ? "danger" : "ghost"}
                  size="sm"
                  icon={clearing ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  onClick={handleClearQueue}
                  disabled={clearing}
                >
                  {clearConfirm ? "Confirmar?" : "Limpar"}
                </Button>
              )}
            </div>
          }
        >
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton width="36px" height="36px" radius="var(--radius-md)" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton width="80px" height="12px" />
                    <Skeleton width="56px" height="10px" />
                  </div>
                </div>
              ))}
            </div>
          ) : !stats || stats.upcoming_posts.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck size={24} />}
              title="Nenhuma agendada"
              description="Posts agendados aparecerão aqui com data e horário."
            />
          ) : (
            <div className="flex flex-col gap-1">
              {stats.upcoming_posts.map((post, i) => {
                const { label, time } = formatScheduled(post.scheduled_at);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-surface-hover"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-accent">
                      <Play size={13} strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">
                        @{post.account_username}
                      </p>
                      <p className="text-[11px] text-ink-3">
                        {label} às {time}
                      </p>
                    </div>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Quick actions ──────────────────────────────────────── */}
      <Card title="Ações Rápidas">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {QUICK_ACTIONS.map((action) => (
            <a
              key={action.href}
              href={action.href}
              className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface p-4 text-center transition-colors duration-150 hover:border-line-control hover:bg-surface-hover"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-accent">
                <action.icon size={18} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-xs font-medium text-ink">{action.label}</p>
                <p className="mt-0.5 text-[11px] text-ink-3">{action.desc}</p>
              </div>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}