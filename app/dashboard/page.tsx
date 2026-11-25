"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  CalendarCheck,
  ListOrdered,
  UserPlus,
  ShieldAlert,
  Play,
  Clock,
  RefreshCw,
  Trash2,
  Send,
  Repeat2,
  ImagePlay,
  Eye,
  DollarSign,
  TrendingUp,
  Users,
  Sparkles,
  AlertTriangle,
  ArrowRight,
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
  story_views: {
    total: number;
    today: number;
    yesterday: number;
    last_7d: number;
    month: number;
    has_data: boolean;
  };
  videos_published: {
    total: number;
    today: number;
    yesterday: number;
    last_7d: number;
    month: number;
    accounts_synced: number;
  };
  queue: { pending: number; total: number; scheduled: number; loop: number };
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

function formatInt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
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

// ── Period stat card (Visualizações / Views em stories / Reels publicados) ──
type StatPeriod = "today" | "yesterday" | "last_7d" | "month";

// Rótulos curtos: os botões ficam ao lado do ícone, num card de ~205px
// (5 por linha dentro dos 1088px do conteúdo) — "7d" para a barra caber.
const PERIODS: { value: StatPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7d", label: "7d" },
  { value: "month", label: "Mês" },
];

// Complemento do título ("Visualizações …") conforme o botão selecionado.
const PERIOD_TITLES: Record<StatPeriod, string> = {
  today: "hoje",
  yesterday: "ontem",
  last_7d: "últimos 7 dias",
  month: "este mês",
};

// Número grande do período escolhido + total de todas as contas embaixo.
function PeriodStatCard({
  icon,
  title,
  values,
  total,
  loading,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  values: Record<StatPeriod, number> | undefined;
  total: number;
  loading: boolean;
  note?: (period: StatPeriod) => string | null;
}) {
  const [period, setPeriod] = useState<StatPeriod>("today");
  const noteText = loading ? null : note?.(period) ?? null;

  return (
    <div className="glass-card flex flex-col gap-3 p-5">
      {/* Botões ao lado do ícone (card quase quadrado); só em telas estreitas descem para a linha de baixo */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-gradient-primary text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
          {icon}
        </span>
        {!loading && (
          <Segmented
            size="xs"
            options={PERIODS}
            value={period}
            onChange={(v) => setPeriod(v as StatPeriod)}
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[30px] font-semibold leading-[36px] tracking-[-0.02em] tabular-nums text-ink">
          {loading ? "—" : formatInt(Number(values?.[period]) || 0)}
        </span>
        <span className="text-[13px] font-medium text-ink-2">
          {title} {PERIOD_TITLES[period]}
        </span>
      </div>
      {loading ? (
        <Skeleton height="14px" width="55%" />
      ) : (
        <span className="inline-flex items-center gap-1 self-start rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-success">
          <TrendingUp size={12} strokeWidth={2} />
          {formatInt(total)} no total
        </span>
      )}
      {noteText && <p className="text-xs text-ink-3">{noteText}</p>}
    </div>
  );
}

// ── Quick actions ────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: "Postar agora", href: "/dashboard/postar", icon: Send, desc: "Reel, story ou carrossel" },
  { label: "Loop", href: "/dashboard/loop", icon: Repeat2, desc: "Publicação em ciclo contínuo" },
  { label: "Stories", href: "/dashboard/stories", icon: ImagePlay, desc: "Postar e importar" },
  { label: "Inspirações", href: "/dashboard/inspirations", icon: Sparkles, desc: "Reels em alta no nicho" },
] as const;

// Miniaturas (estilo Reel) das próximas postagens
const THUMB_BG = [
  "linear-gradient(160deg,#2f7bff,#3fd0ff)",
  "linear-gradient(160deg,#ffb347,#ff6a5c)",
  "linear-gradient(160deg,#c08cff,#ff6ab0)",
  "linear-gradient(160deg,#2fd39a,#1c7ed6)",
  "linear-gradient(160deg,#5b6bff,#b26bff)",
];

// Ícones dos KPIs: cada um com seu gradiente (Aurora Pro)
const KPI_BG = {
  sales: "linear-gradient(135deg,#2fd39a,#168a70)",
  queue: "linear-gradient(135deg,#ff9a5c,#d6573f)",
};

// ── Page ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [displayName, setDisplayName] = useState<string>("");
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busca display_name via API server-side (bypassa cache JWT do cliente)
  const loadDisplayName = useCallback(async () => {
    try {
      const r = await fetch("/api/profile/display-name", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        if (data.display_name) setDisplayName(data.display_name);
      }
    } catch {
      // Silently ignore — fallback to "Chefe"
    }
  }, []);

  useEffect(() => {
    loadDisplayName();
  }, [loadDisplayName]);

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

  // ── Derivados para o hero e a saúde das contas ──
  const totalAccounts = stats?.accounts.total ?? 0;
  const downAccounts = stats?.accounts_down.total ?? 0;
  const activeAccounts = Math.max(totalAccounts - downAccounts, 0);
  const activePct = totalAccounts > 0 ? Math.round((activeAccounts / totalAccounts) * 100) : 0;
  const nextPost = stats?.upcoming_posts[0];
  const nextPostWhen = nextPost ? formatScheduled(nextPost.scheduled_at) : null;
  const viewsDelta =
    stats && stats.views.yesterday > 0
      ? Math.round(((stats.views.today - stats.views.yesterday) / stats.views.yesterday) * 100)
      : null;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="glass-card relative flex flex-col gap-6 overflow-hidden rounded-2xl p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-36 h-[420px] w-[420px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(63,208,255,.40), transparent 65%)" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 left-[30%] h-[300px] w-[360px] rounded-full"
          style={{ background: "radial-gradient(ellipse, rgba(47,123,255,.35), transparent 65%)" }}
        />

        <div className="relative flex max-w-xl flex-col gap-3">
          <span className="inline-flex items-center gap-2 self-start rounded-full border border-white/[0.12] bg-white/[0.08] px-3 py-1 text-xs text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-2" />
            {getFormattedDate()}
          </span>
          <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[38px]">
            {getGreeting()}, <span className="gradient-text">{displayName || "Chefe"}</span>
          </h1>
          <p className="text-[15px] leading-relaxed text-ink-2">
            {loading ? (
              "Carregando o resumo do dia…"
            ) : (
              <>
                Suas {formatInt(totalAccounts)} contas geraram{" "}
                <b className="font-semibold text-ink">{formatInt(stats?.views.today ?? 0)} views</b> hoje
                {viewsDelta !== null && (
                  <> — {viewsDelta >= 0 ? `${viewsDelta}% acima` : `${Math.abs(viewsDelta)}% abaixo`} de ontem</>
                )}
                .{downAccounts > 0 && ` ${downAccounts} ${downAccounts === 1 ? "conta precisa" : "contas precisam"} de atenção.`}
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2.5 pt-1">
            <Button asChild size="lg" icon={<Send size={16} />}>
              <a href="/dashboard/postar">Nova postagem</a>
            </Button>
            {downAccounts > 0 && (
              <Button asChild size="lg" variant="secondary">
                <a href="/dashboard/accounts">Resolver contas</a>
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              icon={<RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />}
              onClick={() => loadStats(true)}
              disabled={loading || refreshing}
            >
              {refreshing ? "Atualizando…" : "Atualizar"}
            </Button>
          </div>
        </div>

        <div className="relative grid w-full grid-cols-2 gap-3 lg:w-[360px] lg:shrink-0">
          <div className="glass-tile flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] text-ink-3">Próximo post</span>
            <span className="text-xl font-semibold text-ink">
              {loading ? "—" : nextPostWhen ? nextPostWhen.time : "—"}
            </span>
            <span className="truncate text-xs text-ink-2">
              {loading ? "" : nextPost ? `@${nextPost.account_username}` : "Nada agendado"}
            </span>
          </div>
          <div className="glass-tile flex flex-col gap-1 px-4 py-3.5">
            <span className="text-[11px] text-ink-3">Posts hoje</span>
            <span className="text-xl font-semibold text-ink">
              {loading ? "—" : formatInt(stats?.posts_today.published ?? 0)}
            </span>
            <span className="text-xs text-ink-2">
              {loading ? "" : `${formatInt(stats?.posts_today.scheduled ?? 0)} agendados`}
            </span>
          </div>
          <div className="glass-tile col-span-2 flex items-center gap-3 px-4 py-3.5">
            <span className="h-2 w-2 shrink-0 animate-live rounded-full bg-success shadow-[0_0_10px_var(--success)]" />
            <span className="text-xs text-ink-2">
              {loading
                ? "Verificando contas…"
                : `${formatInt(activeAccounts)} de ${formatInt(totalAccounts)} contas ativas`}
            </span>
          </div>
        </div>
      </section>

      {/* ── KPIs ───────────────────────────────────────────────── */}
      {/* 5 cards: 3 por linha no lg, os 5 lado a lado a partir do xl */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Vendas hoje"
          value={loading ? "—" : formatBRL(stats?.sales.today ?? 0)}
          icon={<DollarSign size={17} />}
          iconBg={KPI_BG.sales}
          hint={
            loading ? undefined : (
              <>
                Ontem: {formatBRL(stats?.sales.yesterday ?? 0)}
                <br />
                Mês: {formatBRL(stats?.sales.month ?? 0)}
              </>
            )
          }
        >
          {loading && <Skeleton height="4px" width="60%" />}
        </StatTile>

        <PeriodStatCard
          icon={<Eye size={16} />}
          title="Visualizações"
          values={stats?.views}
          total={stats?.views.total ?? 0}
          loading={loading}
          note={(p) =>
            p === "today" && stats && !stats.views.today_has_data
              ? "A Meta ainda não liberou os dados de hoje."
              : null
          }
        />

        <PeriodStatCard
          icon={<ImagePlay size={16} />}
          title="Views em stories"
          values={stats?.story_views}
          total={stats?.story_views.total ?? 0}
          loading={loading}
        />

        <PeriodStatCard
          icon={<Play size={16} />}
          title="Reels publicados"
          values={stats?.videos_published}
          total={stats?.videos_published.total ?? 0}
          loading={loading}
        />

        <StatTile
          label="Posts na fila"
          value={loading ? "—" : formatInt(stats?.queue.total ?? 0)}
          icon={<ListOrdered size={17} />}
          iconBg={KPI_BG.queue}
          hint={
            loading
              ? undefined
              : `${formatInt(stats?.queue.scheduled ?? 0)} agendados · ${formatInt(stats?.queue.loop ?? 0)} no loop`
          }
        />
      </div>

      {/* ── Saúde das contas + Contas adicionadas ─────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          title="Saúde das contas"
          actions={
            <a href="/dashboard/accounts" className="text-xs font-medium text-link hover:underline">
              Ver todas
            </a>
          }
        >
          {loading ? (
            <div className="flex items-center gap-5">
              <Skeleton width="112px" height="112px" radius="999px" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton height="14px" />
                <Skeleton height="14px" />
                <Skeleton height="14px" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-5">
                <div
                  className="grid h-28 w-28 shrink-0 place-items-center rounded-full shadow-[0_0_40px_var(--glow)]"
                  style={{
                    background:
                      totalAccounts > 0
                        ? `conic-gradient(var(--primary) 0 ${activePct}%, var(--danger) ${activePct}% 100%)`
                        : "rgba(255,255,255,.08)",
                  }}
                >
                  <div className="flex h-[88px] w-[88px] flex-col items-center justify-center rounded-full bg-bg">
                    <span className="text-2xl font-semibold tabular-nums text-ink">{formatInt(totalAccounts)}</span>
                    <span className="text-[11px] text-ink-3">contas</span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2.5 text-[13px]">
                  <div className="flex justify-between">
                    <span className="flex items-center gap-2 text-ink-2">
                      <span className="h-2 w-2 rounded-[3px] bg-primary" />Ativas
                    </span>
                    <b className="tabular-nums text-ink">{formatInt(activeAccounts)}</b>
                  </div>
                  <div className="flex justify-between">
                    <span className="flex items-center gap-2 text-ink-2">
                      <span className="h-2 w-2 rounded-[3px] bg-danger" />Com erro
                    </span>
                    <b className="tabular-nums text-ink">{formatInt(downAccounts)}</b>
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-center">
                    {[
                      { label: "Erros hoje", value: stats?.accounts_down.down_today ?? 0 },
                      { label: "Ontem", value: stats?.accounts_down.down_yesterday ?? 0 },
                      { label: "7 dias", value: stats?.accounts_down.down_7d ?? 0 },
                    ].map((item) => (
                      <div key={item.label} className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold tabular-nums text-ink">{item.value}</span>
                        <span className="text-[11px] text-ink-3">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {downAccounts > 0 && (
                <div className="flex items-center gap-2.5 rounded-[14px] border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px]">
                  <AlertTriangle size={16} className="shrink-0 text-danger" />
                  <span className="flex-1 text-ink">
                    {downAccounts} {downAccounts === 1 ? "conta precisa" : "contas precisam"} de atenção
                  </span>
                  <a href="/dashboard/accounts" className="font-semibold text-danger hover:underline">
                    Resolver
                  </a>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card
          title="Contas adicionadas"
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
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-info-soft text-link">
                  <Users size={20} />
                </span>
                <span className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">
                  {stats?.accounts.added_7d ?? 0}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Hoje", value: stats?.accounts.added_today ?? 0 },
                  { label: "Ontem", value: stats?.accounts.added_yesterday ?? 0 },
                  { label: "7 dias", value: stats?.accounts.added_7d ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="glass-tile flex flex-col items-center gap-0.5 py-3">
                    <span className="text-base font-semibold tabular-nums text-ink">{item.value}</span>
                    <span className="text-[11px] text-ink-3">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Ações rápidas ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map((action) => (
          <a
            key={action.href}
            href={action.href}
            className="glass-card group flex items-center gap-3 rounded-[16px] px-4 py-3.5 transition-colors hover:bg-white/[0.06]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-info-soft text-[#cfe0ff]">
              <action.icon size={16} strokeWidth={1.9} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-ink">{action.label}</span>
              <span className="truncate text-xs text-ink-3">{action.desc}</span>
            </span>
            <ArrowRight size={15} className="shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        ))}
      </div>

      {/* ── Próximas postagens + Atividade ───────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Próximas postagens"
          actions={
            <div className="flex items-center gap-2">
              {!loading && stats && <Badge tone="info">{stats.queue.pending} na fila</Badge>}
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
                  <Skeleton width="36px" height="50px" radius="9px" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton width="100px" height="12px" />
                    <Skeleton width="64px" height="10px" />
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
                    className="flex items-center gap-3 rounded-[14px] p-2 transition-colors hover:bg-white/[0.04]"
                  >
                    <div
                      className="flex h-[50px] w-9 shrink-0 items-center justify-center rounded-[9px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.15)]"
                      style={{ background: THUMB_BG[i % THUMB_BG.length] }}
                    >
                      <Play size={12} fill="currentColor" strokeWidth={0} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">@{post.account_username}</p>
                      <p className="text-xs text-ink-3">Post agendado</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-info-soft px-2.5 py-1 text-xs tabular-nums text-[#cfe0ff]">
                      {label === "Hoje" ? `Hoje ${time}` : `${label} ${time}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Atividade recente">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton width="26px" height="26px" radius="9px" />
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
            <div className="flex flex-col">
              {stats.recent_activity.map((item, i) => (
                <div key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      "mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px]",
                      item.status === "success" ? "bg-success-soft" : "bg-danger-soft"
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        item.status === "success"
                          ? "bg-success shadow-[0_0_10px_var(--success)]"
                          : "bg-danger shadow-[0_0_10px_var(--danger)]"
                      )}
                    />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-sm text-ink">{item.text}</p>
                    <span className="text-xs tabular-nums text-ink-3">{timeAgo(item.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
