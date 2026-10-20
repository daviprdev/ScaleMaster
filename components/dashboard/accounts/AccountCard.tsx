"use client";
import * as React from "react";
import {
  Instagram,
  Trash2,
  Power,
  Loader2,
  AlertCircle,
  MoreHorizontal,
  RefreshCw,
  Users,
  FileText,
  Clock,
  CheckCircle2,
  X,
  KeyRound,
  AlertTriangle,
  Clapperboard,
  WifiOff,
  LinkIcon,
  Folder,
  Globe,
  ListX,
  Tag,
  Check,
  UserCog,
  PauseCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, IconButton } from "@/components/ui";

// ── Types ────────────────────────────────────────────────────────
export interface AccountLabel {
  text: string;
  color: string;
}

export interface ProfileDraft {
  photo_url: string | null;
  bio: string;
  link: string;
  synced_at: string | null;
}

export interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  connected_at: string;
  followers_count: number | null;
  posts_count: number | null;
  last_post_at: string | null;
  has_active_stories: boolean | null;
  active_stories_count: number | null;
  active_stories_expiring_first_at: string | null;
  profile_refreshed_at: string | null;
  ig_business_account_id: string | null;
  token_expires_at: string | null;
  health_status: "online" | "error" | "blocked";
  folder_id: string | null;
  has_proxy: boolean;
  meta_app_id: string | null;
  meta_app_name: string | null;
  labels: AccountLabel[];
  profile_draft: ProfileDraft | null;
}

export const LABEL_COLORS = [
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#06B6D4", // cyan
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#EC4899", // pink
];

// ── Helpers ──────────────────────────────────────────────────────
function storyCountdown(timestamp: string | null): string {
  if (!timestamp) return "";
  const expiresAt = new Date(timestamp).getTime() + 24 * 60 * 60 * 1000;
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expirando";
  const totalMins = Math.floor(diff / 60_000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

export function storiesDisplay(account: Account): {
  label: string;
  amber: boolean;
  muted: boolean;
} | null {
  if (
    account.active_stories_count === null ||
    account.active_stories_count === undefined
  )
    return null;
  if (account.active_stories_count === 0) {
    return { label: "0 stories ativos", amber: false, muted: true };
  }
  const expiresAt = account.active_stories_expiring_first_at
    ? new Date(account.active_stories_expiring_first_at).getTime() +
      24 * 60 * 60 * 1000
    : 0;
  if (expiresAt <= Date.now()) {
    return {
      label: "stories desatualizados · sincronize",
      amber: false,
      muted: true,
    };
  }
  return {
    label: `${account.active_stories_count} ${account.active_stories_count === 1 ? "story" : "stories"} · exp. ${storyCountdown(account.active_stories_expiring_first_at)}`,
    amber: true,
    muted: false,
  };
}

function daysUntilExpiry(tokenExpiresAt: string | null): number | null {
  if (!tokenExpiresAt) return null;
  return Math.floor(
    (new Date(tokenExpiresAt).getTime() - Date.now()) / 86_400_000,
  );
}

function tokenStatusChip(
  tokenExpiresAt: string | null,
  isMetaAccount: boolean,
) {
  if (!isMetaAccount || !tokenExpiresAt) return null;
  const days = daysUntilExpiry(tokenExpiresAt);
  if (days === null) return null;
  if (days < 0)
    return {
      label: "Token expirado",
      tone: "danger" as const,
      icon: "danger" as const,
    };
  if (days <= 7)
    return {
      label: `Expira em ${days}d`,
      tone: "danger" as const,
      icon: "danger" as const,
    };
  if (days <= 15)
    return {
      label: `Expira em ${days}d`,
      tone: "warning" as const,
      icon: "warning" as const,
    };
  return null;
}

const AVATAR_COLORS = [
  "from-[#00498D] to-[#00346D]",
  "from-pink-500 to-rose-600",
  "from-[#85B9E9] to-[#00498D]",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-fuchsia-500 to-purple-600",
];

function avatarColor(username: string) {
  let hash = 0;
  for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d atrás`;
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function accountAge(dateStr: string): string {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (d < 1) return "hoje";
  if (d === 1) return "1 dia";
  if (d < 7) return `${d} dias`;
  if (d < 14) return "1 semana";
  if (d < 30) return `${Math.floor(d / 7)} semanas`;
  if (d < 60) return "1 mês";
  if (d < 365) return `${Math.floor(d / 30)} meses`;
  const y = Math.floor(d / 365);
  return y === 1 ? "1 ano" : `${y} anos`;
}

// ── Metric chip ──────────────────────────────────────────────────
function Metric({
  icon,
  label,
  muted = false,
  blue = false,
  amber = false,
  red = false,
}: {
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
  blue?: boolean;
  amber?: boolean;
  red?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]",
        red
          ? "text-danger"
          : amber
            ? "text-warning"
            : blue
              ? "text-accent"
              : muted
                ? "text-ink-4"
                : "text-ink-3",
      )}
    >
      <span
        className={cn(
          "shrink-0",
          red
            ? "text-danger/70"
            : amber
              ? "text-warning/70"
              : blue
                ? "text-accent"
                : muted
                  ? "text-ink-4"
                  : "text-ink-3",
        )}
      >
        {icon}
      </span>
      {label}
    </div>
  );
}

// ── AccountCard ──────────────────────────────────────────────────
interface AccountCardProps {
  account: Account;
  onRefresh: (id: string) => void;
  onToggle: (acc: Account) => void;
  onDelete: (id: string) => void;
  onRefreshToken: (id: string) => void;
  onMoveClick: (account: Account) => void;
  onProxyClick: (account: Account) => void;
  onClearQueueClick: (account: Account) => void;
  onLabelUpdate: (id: string, labels: AccountLabel[]) => void;
  onEditProfile: (account: Account) => void;
  refreshing: boolean;
  toggling: boolean;
  deleting: boolean;
  tokenRefreshing: boolean;
  moving: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** Pausada pelo limite de publicação da Meta (lib/publish-limits). */
  publishPause?: { until: string; reason: string } | null;
}

export function AccountCard({
  account,
  onRefresh,
  onToggle,
  onDelete,
  onRefreshToken,
  onMoveClick,
  onProxyClick,
  onClearQueueClick,
  onLabelUpdate,
  onEditProfile,
  refreshing,
  toggling,
  deleting,
  tokenRefreshing,
  moving,
  selectMode,
  selected,
  onSelect,
  publishPause,
}: AccountCardProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Label state
  const [labelFormOpen, setLabelFormOpen] = React.useState(false);
  const [labelText, setLabelText] = React.useState("");
  const [labelColor, setLabelColor] = React.useState(LABEL_COLORS[5]);
  const [savingLabel, setSavingLabel] = React.useState(false);
  const labelInputRef = React.useRef<HTMLInputElement>(null);

  const handleAddLabel = async () => {
    const text = labelText.trim();
    if (!text || savingLabel) return;
    setSavingLabel(true);
    try {
      const newLabels: AccountLabel[] = [
        ...(account.labels ?? []),
        { text, color: labelColor },
      ];
      // Optimistic update — parent persists via onLabelUpdate
      onLabelUpdate(account.id, newLabels);
      setLabelText("");
      setLabelFormOpen(false);
    } finally {
      setSavingLabel(false);
    }
  };

  const handleRemoveLabel = (index: number) => {
    const newLabels = (account.labels ?? []).filter((_, i) => i !== index);
    onLabelUpdate(account.id, newLabels);
  };

  React.useEffect(() => {
    if (labelFormOpen) {
      setTimeout(() => labelInputRef.current?.focus(), 60);
    }
  }, [labelFormOpen]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const proxyImg = (url: string) =>
    `/api/proxy-image?url=${encodeURIComponent(url)}`;
  const busy =
    refreshing || toggling || deleting || tokenRefreshing || moving;
  const isMetaConnected = !!account.ig_business_account_id;
  const tokenChip = tokenStatusChip(
    account.token_expires_at,
    isMetaConnected,
  );
  const accountFell =
    account.health_status === "error" || account.health_status === "blocked";
  const storiesInfo = storiesDisplay(account);

  return (
    <div
      onClick={selectMode ? onSelect : undefined}
      className={cn(
        "relative rounded-xl border bg-surface p-5 transition-all duration-200",
        accountFell
          ? "border-danger/30 bg-danger-soft/5"
          : "border-line hover:border-line-control",
        selectMode && selected && "ring-2 ring-accent/40 border-accent/50",
        selectMode && !selected && "opacity-70",
        selectMode && "cursor-pointer",
      )}
    >
      {/* Selection overlay */}
      {selectMode && (
        <div
          className={cn(
            "absolute left-3 top-3 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all",
            selected
              ? "border-accent bg-accent/20"
              : "border-ink-4 bg-bg/60",
          )}
        >
          {selected && <div className="h-2.5 w-2.5 rounded-full bg-accent" />}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3 pb-4">
        <div className="relative shrink-0">
          {account.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxyImg(account.avatar_url)}
              alt={account.username}
              className={cn(
                "h-12 w-12 rounded-full object-cover ring-2",
                accountFell
                  ? "grayscale opacity-60 ring-danger/40"
                  : "ring-line",
              )}
            />
          ) : (
            <div
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ring-2",
                accountFell
                  ? "from-red-900 to-red-800 ring-danger/30"
                  : cn("ring-line", avatarColor(account.username)),
              )}
            >
              <Instagram
                size={20}
                className={accountFell ? "text-danger/60" : "text-white"}
              />
            </div>
          )}
          {accountFell && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger ring-2 ring-surface">
              <WifiOff size={8} className="text-white" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 pt-0.5">
          <p
            className={cn(
              "truncate text-sm font-bold",
              accountFell ? "text-ink-4" : "text-ink",
            )}
          >
            @{account.username}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Instagram
              size={9}
              className={
                accountFell ? "shrink-0 text-danger/40" : "shrink-0 text-accent"
              }
            />
            <span className="text-[10px] text-ink-4">Instagram</span>
            {isMetaConnected && !accountFell && (
              <Badge tone="info" className="px-1.5 py-0 text-[9px] leading-3">
                META API
              </Badge>
            )}
            {tokenChip && !accountFell && (
              <Badge tone={tokenChip.tone} className="px-1.5 py-0 text-[9px] leading-3">
                {tokenChip.icon === "danger" ? (
                  <AlertTriangle size={8} className="mr-0.5" />
                ) : (
                  <AlertCircle size={8} className="mr-0.5" />
                )}
                {tokenChip.label}
              </Badge>
            )}
            {accountFell ? (
              <Badge tone="danger" className="animate-pulse px-1.5 py-0 text-[9px] leading-3">
                <WifiOff size={8} className="mr-0.5" />
                {account.health_status === "blocked"
                  ? "BLOQUEADA"
                  : "DESCONECTADA"}
              </Badge>
            ) : (
              <Badge
                tone={account.is_active ? "success" : "neutral"}
                className="px-1.5 py-0 text-[9px] leading-3"
              >
                <span
                  className={cn(
                    "mr-1 h-1.5 w-1.5 rounded-full",
                    account.is_active ? "bg-success" : "bg-ink-4",
                  )}
                />
                {account.is_active ? "ATIVA" : "INATIVA"}
              </Badge>
            )}
            {publishPause && !accountFell && (
              <Badge
                tone="warning"
                title={publishPause.reason}
                className="px-1.5 py-0 text-[9px] leading-3"
              >
                <PauseCircle size={8} className="mr-0.5" />
                {`PAUSADA ATÉ ${new Date(publishPause.until).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`}
              </Badge>
            )}
          </div>
        </div>

        {/* Context menu */}
        <div ref={menuRef} className="relative shrink-0">
          <IconButton
            icon={
              busy ? (
                <Loader2 size={14} className="animate-spin text-accent" />
              ) : (
                <MoreHorizontal size={15} />
              )
            }
            aria-label="Ações da conta"
            onClick={() => !busy && setMenuOpen((o) => !o)}
            disabled={busy}
            size="sm"
          />

          {menuOpen && (
            <div className="absolute right-0 top-full z-[200] mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-line bg-surface-raised shadow-pop animate-in fade-in zoom-in-95 duration-150 ease-out origin-top-right">
              <button
                onClick={() => {
                  onRefresh(account.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <RefreshCw size={12} className="text-accent" /> Sincronizar
              </button>
              <button
                onClick={() => {
                  onEditProfile(account);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <UserCog size={12} className="text-accent" /> Editar Perfil
              </button>
              <button
                onClick={() => {
                  onToggle(account);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <Power
                  size={12}
                  className={account.is_active ? "text-warning" : "text-success"}
                />
                {account.is_active ? "Desativar conta" : "Ativar conta"}
              </button>
              {isMetaConnected && (
                <button
                  onClick={() => {
                    onRefreshToken(account.id);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <KeyRound size={12} className="text-accent" /> Renovar Token
                </button>
              )}
              <button
                onClick={() => {
                  onMoveClick(account);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <Folder size={12} className="text-accent/80" /> Mover para
                pasta...
              </button>
              <button
                onClick={() => {
                  onProxyClick(account);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <Globe
                  size={12}
                  className={account.has_proxy ? "text-accent" : "text-ink-4"}
                />
                {account.has_proxy ? "Editar Proxy" : "Configurar Proxy"}
              </button>
              <button
                onClick={() => {
                  onClearQueueClick(account);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-warning/70 transition-colors hover:bg-warning-soft hover:text-warning"
              >
                <ListX size={12} /> Excluir Vídeos Pendentes
              </button>
              <div className="h-px bg-line" />
              <button
                onClick={() => {
                  onDelete(account.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-danger/70 transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={12} /> Remover Conta
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className={cn("mx-0 h-px", accountFell ? "bg-danger/15" : "bg-line")}
      />

      {accountFell ? (
        <div className="space-y-3 py-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-soft p-3">
            <WifiOff size={14} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-danger">
                {account.health_status === "blocked"
                  ? "Conta bloqueada pela Meta"
                  : "Token inválido — sessão encerrada"}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-danger/60">
                {account.health_status === "blocked"
                  ? "Sua conta foi bloqueada pela Meta. Acesse o Instagram e siga as instruções de recuperação."
                  : "A sessão desta conta expirou ou a senha foi alterada. Reconecte para voltar a publicar."}
              </p>
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            className="w-full"
            icon={
              tokenRefreshing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <LinkIcon size={12} />
              )
            }
            onClick={() => onRefreshToken(account.id)}
            disabled={tokenRefreshing}
          >
            {tokenRefreshing ? "Reconectando..." : "Reconectar Instagram"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-3">
          <div className="shrink-0 whitespace-nowrap text-[11px] font-medium text-ink-3">
            {accountAge(account.connected_at)}
          </div>
          <Metric
            icon={<Users size={11} />}
            label={`${formatNumber(account.followers_count)} seg.`}
            muted={account.followers_count == null}
          />
          <Metric
            icon={<FileText size={11} />}
            label={`${account.posts_count ?? "—"} posts`}
            muted={account.posts_count == null}
          />
          <Metric
            icon={<Clock size={11} />}
            label={account.last_post_at ? timeAgo(account.last_post_at) : "—"}
            muted={!account.last_post_at}
          />
          <Metric
            icon={
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  account.profile_refreshed_at ? "bg-success" : "bg-ink-4",
                )}
              />
            }
            label={
              account.profile_refreshed_at
                ? `sync ${timeAgo(account.profile_refreshed_at)}`
                : "não sincronizado"
            }
            muted={!account.profile_refreshed_at}
          />
          {isMetaConnected && storiesInfo && (
            <Metric
              icon={<Clapperboard size={11} />}
              label={storiesInfo.label}
              amber={storiesInfo.amber}
              muted={storiesInfo.muted}
            />
          )}
          <Metric
            icon={<Globe size={11} />}
            label={account.has_proxy ? "proxy ativo" : "sem proxy"}
            blue={account.has_proxy}
            amber={!account.has_proxy}
          />
          {account.meta_app_name && (
            <Metric icon={<KeyRound size={11} />} label={account.meta_app_name} />
          )}
        </div>
      )}

      {/* Labels section */}
      <div className="pb-1 pt-2">
        {(account.labels ?? []).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(account.labels ?? []).map((lbl, i) => (
              <div
                key={i}
                className="group/lbl flex cursor-default select-none items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background: `${lbl.color}18`,
                  border: `0.5px solid ${lbl.color}50`,
                  color: lbl.color,
                }}
              >
                {lbl.text}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveLabel(i);
                  }}
                  className="ml-0.5 opacity-0 transition-opacity hover:text-white group-hover/lbl:opacity-100"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        {labelFormOpen && (
          <div className="mb-2 overflow-hidden rounded-xl border border-line bg-surface-hover p-3 animate-in fade-in slide-in-from-top-1 duration-150">
            <p className="mb-2.5 text-[9px] font-bold uppercase tracking-widest text-ink-4">
              Nova etiqueta para @{account.username}
            </p>
            <div className="mb-3 flex items-center gap-2">
              <input
                ref={labelInputRef}
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddLabel();
                  if (e.key === "Escape") setLabelFormOpen(false);
                }}
                placeholder="Ex: Lote junho"
                maxLength={32}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder-ink-4 outline-none focus:border-accent"
              />
              <button
                onClick={handleAddLabel}
                disabled={!labelText.trim() || savingLabel}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-opacity disabled:opacity-40"
                style={{ background: labelColor }}
              >
                {savingLabel ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Check size={11} />
                )}
                OK
              </button>
            </div>
            <div className="flex items-center gap-2">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setLabelColor(c)}
                  className="h-5 w-5 shrink-0 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: labelColor === c ? `2px solid ${c}` : "none",
                    outlineOffset: "2px",
                    boxShadow:
                      labelColor === c ? `0 0 10px ${c}90` : "none",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => {
            setLabelFormOpen((o) => !o);
            if (labelFormOpen) setLabelText("");
          }}
          className="flex items-center gap-1 text-[10px] text-ink-4 transition-colors hover:text-accent"
        >
          <Tag size={10} />
          {labelFormOpen ? "cancelar" : "+ etiqueta"}
        </button>
      </div>
    </div>
  );
}

AccountCard.displayName = "AccountCard";
