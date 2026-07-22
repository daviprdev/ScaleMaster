"use client";
// v2 — move-to-folder button in account context menu

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Instagram,
  Plus,
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
  ChevronRight,
  WifiOff,
  LinkIcon,
  Folder,
  FolderPlus,
  FolderOpen,
  Pencil,
  Settings2,
  Globe,
  Upload,
  ListX,
  Tag,
  Check,
  UserCog,
  Clipboard,
  Download,
  ExternalLink,
  Camera,
  UserSearch,
  ShieldCheck,
  ShieldOff,
  BadgeCheck,
  Lock,
} from "lucide-react";
import MagicLinkModal from "@/components/dashboard/MagicLinkModal";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface UserMetaApp {
  id: string;
  app_name: string;
  ig_app_id: string;
}

interface AccountFolder {
  id: string;
  name: string;
  account_count: number;
  created_at: string;
}

interface CheckerResult {
  username: string;
  status: "active" | "not_found" | "error";
  message: string;
  full_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  followers?: number;
  profile_pic_url?: string;
}

interface Account {
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

interface AccountStoriesData {
  count: number;
  expiring_first_at: string | null;
}

interface AccountLabel {
  text: string;
  color: string;
}

interface ProfileDraft {
  photo_url: string | null;
  bio: string;
  link: string;
  synced_at: string | null;
}

const LABEL_COLORS = [
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#06B6D4", // cyan
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#EC4899", // pink
];


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

function daysUntilExpiry(tokenExpiresAt: string | null): number | null {
  if (!tokenExpiresAt) return null;
  return Math.floor((new Date(tokenExpiresAt).getTime() - Date.now()) / 86_400_000);
}

function tokenStatusChip(tokenExpiresAt: string | null, isMetaAccount: boolean) {
  if (!isMetaAccount || !tokenExpiresAt) return null;
  const days = daysUntilExpiry(tokenExpiresAt);
  if (days === null) return null;
  if (days < 0) return { label: "Token expirado", color: "bg-red-500/15 text-red-400", icon: "danger" } as const;
  if (days <= 7) return { label: `Expira em ${days}d`, color: "bg-red-500/15 text-red-400", icon: "danger" } as const;
  if (days <= 15) return { label: `Expira em ${days}d`, color: "bg-amber-500/15 text-amber-400", icon: "warning" } as const;
  return null;
}

const AVATAR_COLORS = [
  "from-violet-500 to-purple-600",
  "from-pink-500 to-rose-600",
  "from-cyan-500 to-blue-600",
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
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

// Idade da conta desde que foi adicionada no SaaS (connected_at).
// Formato simples "5 dias", "3 semanas" — usado para saber quando aumentar posts/dia.
function accountAge(dateStr: string): string {
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

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Conexão cancelada. Nenhuma conta foi adicionada.",
  state_mismatch: "Erro de segurança (state inválido). Tente novamente.",
  no_code: "Código de autorização ausente. Tente novamente.",
  server_error: "Erro retornado pela Meta API:",
  personal_account: "Conta pessoal detectada. Converta para Comercial ou Criador: Instagram → Configurações → Conta → Mudar para conta profissional.",
  rate_limit: "Limite de requisições da Meta API atingido. Aguarde alguns minutos antes de conectar a próxima conta.",
};


// ── Chip de métrica ───────────────────────────────────────────
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
    <div className={cn(
      "flex items-center gap-1 whitespace-nowrap text-[11px] flex-shrink-0",
      red ? "text-red-400" : amber ? "text-amber-400" : blue ? "text-blue-400" : muted ? "text-white/20" : "text-white/45"
    )}>
      <span className={cn(
        "flex-shrink-0",
        red ? "text-red-400/70" : amber ? "text-amber-400/70" : blue ? "text-blue-400" : muted ? "text-white/15" : "text-white/30"
      )}>
        {icon}
      </span>
      {label}
    </div>
  );
}

// ── Card de conta ─────────────────────────────────────────────
function AccountCard({
  account,
  storiesData,
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
}: {
  account: Account;
  storiesData?: AccountStoriesData;
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
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Label state
  const [labelFormOpen, setLabelFormOpen] = useState(false);
  const [labelText, setLabelText] = useState("");
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[5]); // blue default
  const [savingLabel, setSavingLabel] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const supabaseLabel = useMemo(() => createClient(), []);

  const handleAddLabel = async () => {
    const text = labelText.trim();
    if (!text || savingLabel) return;
    setSavingLabel(true);
    try {
      const newLabels: AccountLabel[] = [...(account.labels ?? []), { text, color: labelColor }];
      await supabaseLabel
        .from("instagram_accounts")
        .update({ labels: newLabels })
        .eq("id", account.id);
      onLabelUpdate(account.id, newLabels);
      setLabelText("");
      setLabelFormOpen(false);
    } finally {
      setSavingLabel(false);
    }
  };

  const handleRemoveLabel = async (index: number) => {
    const newLabels = (account.labels ?? []).filter((_, i) => i !== index);
    await supabaseLabel
      .from("instagram_accounts")
      .update({ labels: newLabels })
      .eq("id", account.id);
    onLabelUpdate(account.id, newLabels);
  };

  useEffect(() => {
    if (labelFormOpen) {
      setTimeout(() => labelInputRef.current?.focus(), 60);
    }
  }, [labelFormOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const proxyImg = (url: string) => `/api/proxy-image?url=${encodeURIComponent(url)}`;
  const busy = refreshing || toggling || deleting || tokenRefreshing || moving;
  const isMetaConnected = !!account.ig_business_account_id;
  const tokenChip = tokenStatusChip(account.token_expires_at, isMetaConnected);
  const accountFell = account.health_status === "error" || account.health_status === "blocked";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onClick={selectMode ? onSelect : undefined}
      style={{ position: "relative", zIndex: menuOpen ? 10 : "auto", cursor: selectMode ? "pointer" : undefined }}
      className={cn(
        "glass-card rounded-2xl transition-all",
        accountFell && "border border-red-500/25",
        selectMode && selected && "border border-[#00FF41]/50 ring-1 ring-[#00FF41]/20",
        selectMode && !selected && "opacity-70",
      )}
    >
      {/* Overlay de seleção */}
      {selectMode && (
        <div className={cn(
          "absolute top-3 left-3 z-20 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
          selected ? "border-[#00FF41] bg-[#00FF41]/20" : "border-white/30 bg-black/40"
        )}>
          {selected && <div className="w-2.5 h-2.5 rounded-full bg-[#00FF41]" />}
        </div>
      )}

      {/* Cabeçalho */}
      <div className="flex items-start gap-3 p-5 pb-4">
        <div className="relative flex-shrink-0">
          {account.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxyImg(account.avatar_url)}
              alt={account.username}
              className={cn(
                "w-12 h-12 rounded-full object-cover ring-2",
                accountFell ? "ring-red-500/40 opacity-60 grayscale" : "ring-white/10"
              )}
            />
          ) : (
            <div className={cn(
              "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center ring-2",
              accountFell
                ? "from-red-900 to-red-800 ring-red-500/30"
                : cn("ring-white/10", avatarColor(account.username))
            )}>
              <Instagram size={20} className={accountFell ? "text-red-400/60" : "text-white"} />
            </div>
          )}
          {accountFell && (
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center ring-2 ring-black">
              <WifiOff size={8} className="text-white" />
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          <p className={cn("text-sm font-bold truncate", accountFell ? "text-white/50" : "text-white/90")}>
            @{account.username}
          </p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Instagram size={9} className={accountFell ? "text-red-400/40 flex-shrink-0" : "text-pink-400 flex-shrink-0"} />
            <span className="text-[10px] text-white/30">Instagram</span>
            {isMetaConnected && !accountFell && (
              <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide bg-blue-500/15 text-blue-300 flex-shrink-0">
                <span className="w-1 h-1 rounded-full bg-blue-400" />
                META API
              </span>
            )}
            {tokenChip && !accountFell && (
              <span className={cn(
                "inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0",
                tokenChip.color
              )}>
                {tokenChip.icon === "danger"
                  ? <AlertTriangle size={8} className="flex-shrink-0" />
                  : <AlertCircle size={8} className="flex-shrink-0" />
                }
                {tokenChip.label}
              </span>
            )}
            {accountFell ? (
              <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-red-500/20 text-red-400 border border-red-500/30 flex-shrink-0 animate-pulse">
                <WifiOff size={8} className="flex-shrink-0" />
                {account.health_status === "blocked" ? "BLOQUEADA" : "DESCONECTADA"}
              </span>
            ) : (
              <span className={cn(
                "inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0",
                account.is_active
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-white/[0.05] text-white/20"
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full", account.is_active ? "bg-emerald-400" : "bg-white/20")} />
                {account.is_active ? "ATIVA" : "INATIVA"}
              </span>
            )}
          </div>
        </div>

        {/* Menu três pontos */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => !busy && setMenuOpen(o => !o)}
            disabled={busy}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
          >
            {(refreshing || deleting || tokenRefreshing || moving)
              ? <Loader2 size={13} className="animate-spin text-cyan-400" />
              : <MoreHorizontal size={15} />
            }
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                key="menu"
                initial={{ opacity: 0, scale: 0.9, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -6 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-full mt-1.5 z-[200] min-w-[180px] bg-[#111318] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
              >
                <button
                  onClick={() => { onRefresh(account.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <RefreshCw size={12} className="text-cyan-400" /> Sincronizar
                </button>
                <button
                  onClick={() => { onEditProfile(account); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <UserCog size={12} className="text-[#00FF41]" /> Editar Perfil Manual
                </button>
                <button
                  onClick={() => { onToggle(account); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <Power size={12} className={account.is_active ? "text-amber-400" : "text-emerald-400"} />
                  {account.is_active ? "Desativar conta" : "Ativar conta"}
                </button>
                {isMetaConnected && (
                  <button
                    onClick={() => { onRefreshToken(account.id); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                  >
                    <KeyRound size={12} className="text-violet-400" /> Renovar Token
                  </button>
                )}

                {/* Mover para pasta — abre modal na página */}
                <button
                  onClick={() => { onMoveClick(account); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <Folder size={12} className="text-violet-400/80" /> Mover para pasta...
                </button>

                {/* Configurar proxy dedicado */}
                <button
                  onClick={() => { onProxyClick(account); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <Globe size={12} className={account.has_proxy ? "text-[#00FF41]" : "text-white/40"} />
                  {account.has_proxy ? "Editar Proxy" : "Configurar Proxy"}
                </button>

                <button
                  onClick={() => { onClearQueueClick(account); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-amber-400/70 hover:bg-amber-500/[0.08] hover:text-amber-400 transition-colors"
                >
                  <ListX size={12} /> Excluir Vídeos Pendentes
                </button>

                <div className="h-px bg-white/[0.06]" />
                <button
                  onClick={() => { onDelete(account.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400/70 hover:bg-red-500/[0.08] hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} /> Remover Conta
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className={cn("h-px mx-5", accountFell ? "bg-red-500/15" : "bg-white/[0.05]")} />

      {accountFell ? (
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/[0.08] border border-red-500/20">
            <WifiOff size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-red-400 uppercase tracking-wide">
                {account.health_status === "blocked"
                  ? "Conta bloqueada pela Meta"
                  : "Token inválido — sessão encerrada"}
              </p>
              <p className="text-[11px] text-red-400/60 mt-0.5 leading-relaxed">
                {account.health_status === "blocked"
                  ? "Sua conta foi bloqueada pela Meta. Acesse o Instagram e siga as instruções de recuperação."
                  : "A sessão desta conta expirou ou a senha foi alterada. Reconecte para voltar a publicar."}
              </p>
            </div>
          </div>
          <button
            onClick={() => { onRefreshToken(account.id); }}
            disabled={tokenRefreshing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold uppercase tracking-wide hover:bg-red-500/25 hover:border-red-500/50 transition-all disabled:opacity-50"
          >
            {tokenRefreshing
              ? <><Loader2 size={12} className="animate-spin" /> Reconectando...</>
              : <><LinkIcon size={12} /> Reconectar Instagram</>
            }
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-5 py-3">
          <div className="whitespace-nowrap text-[11px] flex-shrink-0 text-white/55 font-medium">
            {accountAge(account.connected_at)}
          </div>
          <Metric icon={<Users size={11} />} label={`${formatNumber(account.followers_count)} seg.`} muted={account.followers_count == null} />
          <Metric icon={<FileText size={11} />} label={`${account.posts_count ?? "—"} posts`} muted={account.posts_count == null} />
          <Metric icon={<Clock size={11} />} label={account.last_post_at ? timeAgo(account.last_post_at) : "—"} muted={!account.last_post_at} />
          <Metric
            icon={<span className={cn(
              "w-1.5 h-1.5 rounded-full inline-block flex-shrink-0",
              account.profile_refreshed_at ? "bg-emerald-400" : "bg-white/20"
            )} />}
            label={account.profile_refreshed_at ? `sync ${timeAgo(account.profile_refreshed_at)}` : "não sincronizado"}
            muted={!account.profile_refreshed_at}
          />
          {isMetaConnected && storiesData !== undefined && (
            <Metric
              icon={<Clapperboard size={11} />}
              label={
                storiesData.count > 0
                  ? `${storiesData.count} ${storiesData.count === 1 ? "story" : "stories"} · exp. ${storyCountdown(storiesData.expiring_first_at)}`
                  : "0 stories ativos"
              }
              amber={storiesData.count > 0}
              muted={storiesData.count === 0}
            />
          )}
          <Metric
            icon={<Globe size={11} />}
            label={account.has_proxy ? "proxy ativo" : "sem proxy"}
            blue={account.has_proxy}
            amber={!account.has_proxy}
          />
          {account.meta_app_name && (
            <Metric
              icon={<KeyRound size={11} />}
              label={account.meta_app_name}
              muted={false}
            />
          )}
        </div>
      )}

      {/* ── Etiquetas ─────────────────────────────────────────── */}
      <div className="px-5 pb-4">
        {/* Chips de etiquetas existentes */}
        {(account.labels ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(account.labels ?? []).map((lbl, i) => (
              <div
                key={i}
                className="group/lbl flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-default select-none"
                style={{
                  background: `${lbl.color}18`,
                  border: `0.5px solid ${lbl.color}50`,
                  color: lbl.color,
                }}
              >
                {lbl.text}
                <button
                  onClick={() => handleRemoveLabel(i)}
                  className="opacity-0 group-hover/lbl:opacity-100 transition-opacity ml-0.5 hover:text-white"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Formulário inline de nova etiqueta */}
        <AnimatePresence>
          {labelFormOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div
                className="rounded-xl p-3 mb-2"
                style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.08)" }}
              >
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-2.5">
                  Nova etiqueta para @{account.username}
                </p>
                {/* Input + OK */}
                <div className="flex items-center gap-2 mb-3">
                  <input
                    ref={labelInputRef}
                    value={labelText}
                    onChange={e => setLabelText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddLabel(); if (e.key === "Escape") setLabelFormOpen(false); }}
                    placeholder="Ex: Lote junho"
                    maxLength={32}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm text-white placeholder-white/20 outline-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: `0.5px solid ${labelColor}50` }}
                  />
                  <button
                    onClick={handleAddLabel}
                    disabled={!labelText.trim() || savingLabel}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-black disabled:opacity-40 flex-shrink-0 transition-opacity"
                    style={{ background: labelColor }}
                  >
                    {savingLabel ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    OK
                  </button>
                </div>
                {/* Cores embaixo */}
                <div className="flex items-center gap-2">
                  {LABEL_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setLabelColor(c)}
                      className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-110"
                      style={{
                        background: c,
                        outline: labelColor === c ? `2px solid ${c}` : "none",
                        outlineOffset: "2px",
                        boxShadow: labelColor === c ? `0 0 10px ${c}90` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Botão + etiqueta */}
        <button
          onClick={() => { setLabelFormOpen(o => !o); if (labelFormOpen) { setLabelText(""); } }}
          className="flex items-center gap-1 text-[10px] text-white/25 hover:text-[#00FF41] transition-colors"
        >
          <Tag size={10} />
          {labelFormOpen ? "cancelar" : "+ etiqueta"}
        </button>
      </div>

    </motion.div>
  );
}

// ── Modal Editar Perfil Manual ────────────────────────────────
function EditProfileModal({
  account,
  onClose,
  onSaved,
}: {
  account: Account;
  onClose: () => void;
  onSaved: (id: string, draft: ProfileDraft) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bio, setBio] = useState(account.profile_draft?.bio ?? "");
  const [link, setLink] = useState(account.profile_draft?.link ?? "");
  const [photoUrl, setPhotoUrl] = useState<string | null>(account.profile_draft?.photo_url ?? null);
  const [synced, setSynced] = useState<string | null>(account.profile_draft?.synced_at ?? null);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markingSynced, setMarkingSynced] = useState(false);
  const [copied, setCopied] = useState<"bio" | "link" | null>(null);

  const displayPhoto = photoUrl ?? account.avatar_url ?? null;

  const copyText = async (text: string, type: "bio" | "link") => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `profile-photos/${account.id}.${ext}`;
      const { error } = await supabase.storage
        .from("videos-library")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (!error) {
        const { data: urlData } = supabase.storage.from("videos-library").getPublicUrl(path);
        setPhotoUrl(urlData.publicUrl + `?t=${Date.now()}`);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadPhoto = async () => {
    if (!displayPhoto) return;
    try {
      const res = await fetch(displayPhoto);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `foto_${account.username}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const buildDraft = (): ProfileDraft => ({ photo_url: photoUrl, bio, link, synced_at: synced });

  const handleSave = async () => {
    setSaving(true);
    try {
      const draft = buildDraft();
      await supabase.from("instagram_accounts").update({ profile_draft: draft }).eq("id", account.id);
      onSaved(account.id, draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSynced = async () => {
    setMarkingSynced(true);
    try {
      const now = new Date().toISOString();
      const draft: ProfileDraft = { photo_url: photoUrl, bio, link, synced_at: now };
      await supabase.from("instagram_accounts").update({ profile_draft: draft }).eq("id", account.id);
      setSynced(now);
      onSaved(account.id, draft);
    } finally {
      setMarkingSynced(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.18 }}
        className="glass relative z-10 w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3">
          <div className="min-w-0 pr-4">
            <h2 className="font-bold text-white text-sm">Editar perfil — @{account.username}</h2>
            <p className="text-[11px] text-white/35 mt-1 leading-relaxed">
              A API do Instagram não permite editar bio/foto. Salve aqui o que quer e use os botões para copiar/baixar e colar manualmente.
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white hover:bg-white/[0.06] flex-shrink-0 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-5">
          {/* Foto */}
          <div>
            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-widest mb-3">Foto sugerida</p>
            <div className="flex items-center gap-4">
              {/* Avatar preview */}
              <div className="relative flex-shrink-0">
                {displayPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayPhoto} alt="foto" className="w-16 h-16 rounded-full object-cover ring-2 ring-white/10" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center">
                    <Camera size={22} className="text-white/20" />
                  </div>
                )}
                {uploading && (
                  <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                    <Loader2 size={16} className="animate-spin text-[#00FF41]" />
                  </div>
                )}
              </div>

              {/* Ações de foto */}
              <div className="flex flex-col gap-2 flex-1">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/70 hover:text-white transition-colors disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.09)" }}
                >
                  <Upload size={13} className="text-[#00FF41]" />
                  {uploading ? "Enviando..." : "Enviar foto"}
                </button>
                <button
                  onClick={handleDownloadPhoto}
                  disabled={!displayPhoto}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/70 hover:text-white transition-colors disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.09)" }}
                >
                  <Download size={13} className="text-[#00E5FF]" />
                  Baixar p/ celular
                </button>
              </div>
            </div>
          </div>

          {/* Bio */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-white/50 uppercase tracking-widest">Bio sugerida</p>
              <span className="text-[10px] text-white/25">{bio.length}/150</span>
            </div>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value.slice(0, 150))}
              placeholder="Texto da bio..."
              rows={4}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none resize-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.09)", lineHeight: "1.5" }}
            />
            <button
              onClick={() => copyText(bio, "bio")}
              disabled={!bio}
              className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white transition-colors disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.07)" }}
            >
              {copied === "bio" ? <Check size={12} className="text-emerald-400" /> : <Clipboard size={12} />}
              {copied === "bio" ? "Copiado!" : "Copiar bio"}
            </button>
          </div>

          {/* Link */}
          <div>
            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-widest mb-2">Link da bio</p>
            <input
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="https://..."
              type="url"
              className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.09)" }}
            />
            <button
              onClick={() => copyText(link, "link")}
              disabled={!link}
              className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white transition-colors disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.07)" }}
            >
              {copied === "link" ? <Check size={12} className="text-emerald-400" /> : <Clipboard size={12} />}
              {copied === "link" ? "Copiado!" : "Copiar link"}
            </button>
          </div>

          {synced && (
            <p className="text-[10px] text-emerald-400/70 flex items-center gap-1">
              <CheckCircle2 size={10} />
              Marcado sincronizado em {new Date(synced).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}

          {/* Ações rodapé */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-1.5 px-4 py-2 text-xs font-bold disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              Salvar rascunho
            </button>
            <button
              onClick={() => window.open(`https://instagram.com/${account.username}`, "_blank")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-white/60 hover:text-white transition-colors"
              style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.09)" }}
            >
              <ExternalLink size={12} /> Abrir IG
            </button>
            <button
              onClick={handleMarkSynced}
              disabled={markingSynced}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-colors disabled:opacity-50"
              style={{
                background: synced ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.05)",
                border: synced ? "0.5px solid rgba(16,185,129,0.3)" : "0.5px solid rgba(255,255,255,0.09)",
                color: synced ? "#34d399" : "rgba(255,255,255,0.6)",
              }}
            >
              {markingSynced ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Marcar sincronizado
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="glass-card rounded-2xl animate-pulse">
      <div className="flex items-start gap-3 p-5 pb-4">
        <div className="w-12 h-12 rounded-full bg-white/[0.07] flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3.5 bg-white/[0.07] rounded-full w-28" />
          <div className="h-2.5 bg-white/[0.04] rounded-full w-36" />
        </div>
        <div className="w-7 h-7 rounded-lg bg-white/[0.04]" />
      </div>
      <div className="h-px bg-white/[0.05] mx-5" />
      <div className="flex items-center gap-3 px-5 py-3">
        {[52, 40, 48, 56].map((w, i) => (
          <div key={i} style={{ width: w }} className="h-2.5 bg-white/[0.05] rounded-full flex-shrink-0" />
        ))}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────
export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [userApps, setUserApps] = useState<UserMetaApp[]>([]);
  const [appPickerOpen, setAppPickerOpen] = useState(false);
  const [magicLinkOpen, setMagicLinkOpen] = useState(false);

  // Folder state
  const [folders, setFolders] = useState<AccountFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);

  // New folder modal
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Rename modal
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState(false);

  // Delete folder dialog
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string; count: number } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [folderMenuPos, setFolderMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const [syncingAll, setSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);

  // Limpar fila pendente de uma conta
  const [clearQueueDialog, setClearQueueDialog] = useState<{ id: string; username: string } | null>(null);
  const [clearingQueue, setClearingQueue] = useState(false);

  // Verificador de Perfis
  const [showChecker, setShowChecker] = useState(false);
  const [checkerText, setCheckerText] = useState("");
  const [checkerRunning, setCheckerRunning] = useState(false);
  const [checkerResults, setCheckerResults] = useState<CheckerResult[] | null>(null);
  const [checkerProgress, setCheckerProgress] = useState<{ done: number; total: number } | null>(null);

  // Bulk select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMovePendingFolderId, setBulkMovePendingFolderId] = useState<string | null>(null);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkActivating, setBulkActivating] = useState(false);

  // CSV proxy import
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResults, setCsvResults] = useState<Array<{ username: string; status: string; error?: string }> | null>(null);

  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [tokenRefreshingId, setTokenRefreshingId] = useState<string | null>(null);
  const [movingAccountId, setMovingAccountId] = useState<string | null>(null);
  const [storiesMap, setStoriesMap] = useState<Record<string, AccountStoriesData>>({});
  const [sortMode, setSortMode] = useState<"none" | "followers_desc" | "followers_asc" | "story_expiring">("none");

  // Move-to-folder modal (page-level, outside motion transforms)
  const [moveAccount, setMoveAccount] = useState<Account | null>(null);
  const [movePendingFolderId, setMovePendingFolderId] = useState<string | null>(null);

  // Proxy modal
  const [proxyAccount, setProxyAccount] = useState<Account | null>(null);
  const [proxyInput, setProxyInput] = useState("");
  const [savingProxy, setSavingProxy] = useState(false);

  // Drag-and-drop reorder de pastas
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [folderOrder, setFolderOrder] = useState<string[]>([]);

  const supabase = useMemo(() => createClient(), []);
  const _togglingRef = useRef<string | null>(null);
  const _deletingRef = useRef<string | null>(null);
  const _refreshingRef = useRef<Set<string>>(new Set());
  const _tokenRefreshingRef = useRef<string | null>(null);
  const _autoRefreshDone = useRef(false);
  const _autoSyncDone = useRef(false);
  const _firstLoadDone = useRef(false);

  // Close folder menu on outside click
  useEffect(() => {
    if (!openFolderMenuId) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-folder-menu]")) setOpenFolderMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openFolderMenuId]);

  const fetchUserApps = useCallback(async () => {
    try {
      const res = await fetch("/api/apps");
      if (!res.ok) return;
      const data = await res.json() as { apps?: UserMetaApp[] };
      setUserApps(data.apps ?? []);
    } catch {
      // non-critical
    }
  }, []);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts/folders");
      if (!res.ok) return;
      const data = await res.json() as { folders?: AccountFolder[] };
      setFolders(data.folders ?? []);
      try {
        const saved = localStorage.getItem("folder_order");
        if (saved) setFolderOrder(JSON.parse(saved));
      } catch {}
    } catch { /* silent */ }
  }, []);

  const handleConnectClick = useCallback(async () => {
    await fetchUserApps();
    setAppPickerOpen(true);
  }, [fetchUserApps]);

  // Lê parâmetros de retorno do OAuth (?connected=1 ou ?error=xxx)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected) {
      setNotification({
        type: "success",
        message: `${connected} conta${Number(connected) !== 1 ? "s" : ""} conectada${Number(connected) !== 1 ? "s" : ""} com sucesso!`,
      });
      window.history.replaceState({}, "", "/dashboard/accounts");
    } else if (error) {
      const detail = params.get("detail");
      const base = OAUTH_ERROR_MESSAGES[error] ?? "Ocorreu um erro ao conectar. Tente novamente.";
      setNotification({
        type: "error",
        message: detail ? `${base}\n${detail}` : base,
      });
      window.history.replaceState({}, "", "/dashboard/accounts");
    }
  }, []);

  const fetchAccounts = useCallback(async (): Promise<Account[]> => {
    // Skeleton apenas no primeiro carregamento; refreshes seguintes (sync,
    // auto-refresh 60s) atualizam os dados em cima dos cards já na tela.
    if (!_firstLoadDone.current) setLoading(true);
    try {
      const { data } = await supabase
        .from("instagram_accounts")
        .select(
          "id, username, display_name, avatar_url, is_active, connected_at, followers_count, posts_count, last_post_at, has_active_stories, profile_refreshed_at, ig_business_account_id, token_expires_at, health_status, folder_id, proxy_url, meta_app_id, labels, profile_draft, user_meta_apps(app_name)"
        )
        .order("connected_at", { ascending: false });
      const fetched = ((data ?? []) as unknown as (Account & { proxy_url: string | null; user_meta_apps: { app_name: string } | null })[]).map(
        (row) => ({ ...row, has_proxy: row.proxy_url !== null, meta_app_name: row.user_meta_apps?.app_name ?? null, labels: (row.labels as AccountLabel[]) ?? [], profile_draft: (row.profile_draft as ProfileDraft | null) ?? null })
      ) as Account[];
      setAccounts(fetched);
      return fetched;
    } finally {
      _firstLoadDone.current = true;
      setLoading(false);
    }
  }, [supabase]);

  const fetchStories = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts/stories");
      if (!res.ok) return;
      const data = await res.json() as { stories?: Record<string, AccountStoriesData> };
      if (data.stories) setStoriesMap(data.stories);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchUserApps();
    fetchFolders();
    fetchAccounts().then(async (fetched) => {
      // fetchStories removido do page-load (2026-07-17): era 1 GET à Meta por
      // conta a cada abertura da página. Stories ao vivo agora só no botão
      // manual de sincronizar; a badge simplesmente não aparece sem os dados.
      if (_autoRefreshDone.current) return;
      _autoRefreshDone.current = true;

      const expiring = fetched.filter(
        (a) => a.ig_business_account_id && (daysUntilExpiry(a.token_expires_at) ?? 99) <= 14
      );
      if (expiring.length === 0) return;

      const results = await Promise.allSettled(
        expiring.map((acc) =>
          fetch("/api/meta/refresh-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: acc.id }),
          }).then((r) => r.json() as Promise<{ ok?: boolean; expires_at?: string }>)
        )
      );

      const renewed = results.filter(
        (r) => r.status === "fulfilled" && r.value.ok
      ).length;

      if (renewed > 0) {
        setNotification({
          type: "success",
          message: `${renewed} token${renewed !== 1 ? "s" : ""} Meta renovado${renewed !== 1 ? "s" : ""} automaticamente.`,
        });
        fetchAccounts();
      }
    });
  }, [fetchAccounts, fetchUserApps, fetchFolders]);

  useEffect(() => {
    if (_autoSyncDone.current) return;
    _autoSyncDone.current = true;
    const silentSyncAll = async () => {
      const excludeIds: string[] = [];
      for (let i = 0; i < 15; i++) {
        try {
          const res = await fetch("/api/accounts/sync-all", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ excludeIds }),
            signal: AbortSignal.timeout(55_000),
          });
          const data: { synced?: number; token_errors?: number; processedIds?: string[]; remaining?: number } = await res.json();
          excludeIds.push(...(data.processedIds ?? []));
          if (!data.remaining || data.remaining <= 0) break;
        } catch { break; }
      }
      fetchAccounts();
    };
    silentSyncAll();
  }, [fetchAccounts]);

  // Auto-refresh a cada 60s: atualiza a lista do banco sem chamar a Meta API.
  // Reflete mudanças feitas pelos crons (health_status, followers, etc.) sem precisar recarregar a página.
  useEffect(() => {
    const id = setInterval(() => {
      fetchAccounts();
    }, 60_000);
    return () => clearInterval(id);
  }, [fetchAccounts]);

  const handleSyncAll = useCallback(async () => {
    if (syncingAll) return;
    setSyncingAll(true);
    // Estimativa imediata a partir da lista já carregada no client, para o contador
    // aparecer como "0/N" assim que o botão é clicado (o total exato do servidor só
    // chega na primeira resposta, alguns segundos depois).
    let total = accounts.filter((a) => a.health_status !== "error").length;
    setSyncProgress({ done: 0, total });
    let totalSynced = 0;
    let totalErrors = 0;
    let doneCount = 0;
    const excludeIds: string[] = [];
    try {
      // O endpoint processa em lotes com timeout próprio por chamada e devolve
      // `remaining` quando o orçamento de tempo da função serverless acaba antes
      // de esgotar a fila — nesse caso, chamamos de novo (excluindo as contas já
      // processadas via excludeIds) até zerar, com um teto de segurança para
      // nunca girar para sempre em caso de bug.
      for (let i = 0; i < 15; i++) {
        const res = await fetch("/api/accounts/sync-all?force=true", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ excludeIds }),
          // Nunca deixa o botão girando para sempre caso o servidor não responda
          // dentro do esperado — o handler tem seu próprio orçamento interno (~40s),
          // então 55s aqui dá margem e ainda garante que o cliente sempre se recupera.
          signal: AbortSignal.timeout(55_000),
        });
        // Verifica ok ANTES de res.json() — se servidor retornar HTML (504/500),
        // res.json() lança SyntaxError que cai no catch como "Falha ao sincronizar".
        if (!res.ok) {
          let errMsg = "Falha ao sincronizar contas.";
          try { const d = await res.json() as { error?: string }; if (d.error) errMsg = d.error; } catch { /* HTML */ }
          throw new Error(errMsg);
        }
        let data: {
          synced?: number;
          errors?: number;
          token_errors?: number;
          remaining?: number;
          processed?: number;
          processedIds?: string[];
          cascade?: boolean;
          cascade_message?: string;
        } = {};
        try {
          data = await res.json();
        } catch {
          // Resposta não é JSON válido (ex: Vercel edge truncou o body)
          break;
        }
        const processedThisCall = data.processed ?? 0;
        doneCount += processedThisCall;
        totalSynced += data.synced ?? 0;
        totalErrors += data.errors ?? 0;
        if (i === 0) total = processedThisCall + (data.remaining ?? 0);
        excludeIds.push(...(data.processedIds ?? []));
        setSyncProgress({ done: doneCount, total });
        if (data.cascade) {
          setNotification({ type: "error", message: data.cascade_message ?? "Muitos tokens inválidos ao mesmo tempo — reconecte as contas." });
          break;
        }
        if (!data.remaining || data.remaining <= 0) break;
      }
      await Promise.allSettled([fetchAccounts(), fetchStories()]);
      setNotification((prev) =>
        prev?.type === "error"
          ? prev
          : {
              type: "success",
              message:
                `Sincronização concluída: ${totalSynced} conta${totalSynced !== 1 ? "s" : ""} atualizada${totalSynced !== 1 ? "s" : ""}` +
                (totalErrors > 0 ? `, ${totalErrors} com erro.` : "."),
            }
      );
    } catch (err) {
      // Atualiza a lista mesmo no erro — o servidor pode ter sincronizado antes de falhar
      await Promise.allSettled([fetchAccounts(), fetchStories()]);
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      setNotification({ type: "error", message: isTimeout ? "Timeout: sincronização demorou demais. Tente novamente." : "Falha ao sincronizar contas." });
    } finally {
      setSyncingAll(false);
      setSyncProgress(null);
    }
  }, [syncingAll, accounts, fetchAccounts, fetchStories]);

  const handleRefresh = useCallback(async (id: string) => {
    // Bloqueia apenas clique duplo na MESMA conta — contas diferentes sincronizam em paralelo.
    if (_refreshingRef.current.has(id)) return;
    _refreshingRef.current.add(id);
    setRefreshingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch("/api/accounts/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: id }),
        signal: AbortSignal.timeout(28_000),
      });
      if (res.ok) {
        // fetchStories removido (2026-07-17): era uma varredura de TODAS as
        // contas na Meta para o sync de UMA conta. A rota de refresh já
        // persiste active_stories_count no banco; fetchAccounts reflete.
        await fetchAccounts();
        setNotification({ type: "success", message: "Conta sincronizada com sucesso." });
      } else {
        let errorMsg = "Falha ao sincronizar conta.";
        try {
          const data = await res.json() as { error?: string };
          if (data.error) errorMsg = data.error;
        } catch { /* HTML de erro / sem body */ }
        setNotification({ type: "error", message: errorMsg });
        // Atualiza a lista mesmo no erro — o servidor pode ter marcado a conta como caída
        await fetchAccounts();
      }
    } catch {
      // Timeout ou rede — sem notificação; atualiza a lista para refletir mudanças do servidor
      await fetchAccounts();
    } finally {
      _refreshingRef.current.delete(id);
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [fetchAccounts]);

  const handleRefreshToken = useCallback(async (id: string) => {
    if (_tokenRefreshingRef.current) return;
    _tokenRefreshingRef.current = id;
    setTokenRefreshingId(id);
    try {
      const res = await fetch("/api/meta/refresh-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: id }),
      });
      const data = (await res.json()) as { ok?: boolean; expires_at?: string; error?: string };
      if (data.ok && data.expires_at) {
        setNotification({ type: "success", message: "Token Meta renovado com sucesso!" });
        setAccounts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, token_expires_at: data.expires_at! } : a))
        );
      } else {
        setNotification({ type: "error", message: data.error ?? "Falha ao renovar token." });
      }
    } finally {
      _tokenRefreshingRef.current = null;
      setTokenRefreshingId(null);
    }
  }, []);

  const handleToggle = async (account: Account) => {
    if (_togglingRef.current) return;
    _togglingRef.current = account.id;
    setTogglingId(account.id);
    try {
      await supabase.from("instagram_accounts").update({ is_active: !account.is_active }).eq("id", account.id);
      setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, is_active: !a.is_active } : a));
    } finally {
      _togglingRef.current = null;
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (_deletingRef.current) return;
    _deletingRef.current = id;
    setDeletingId(id);
    try {
      await supabase.from("instagram_accounts").delete().eq("id", id);
      setAccounts(prev => prev.filter(a => a.id !== id));
      // Update folder counts
      setFolders(prev => prev.map(f => {
        const account = accounts.find(a => a.id === id);
        if (account?.folder_id === f.id) return { ...f, account_count: Math.max(0, f.account_count - 1) };
        return f;
      }));
    } finally {
      _deletingRef.current = null;
      setDeletingId(null);
    }
  };

  const handleClearQueue = useCallback(async () => {
    if (!clearQueueDialog || clearingQueue) return;
    setClearingQueue(true);
    try {
      const res = await fetch(`/api/accounts/${clearQueueDialog.id}/clear-queue`, { method: "POST" });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        deleted?: { scheduled_posts: number; pending_containers: number };
      };
      if (!res.ok || !data.success) {
        setNotification({ type: "error", message: data.error ?? "Falha ao limpar a fila." });
      } else {
        const total = (data.deleted?.scheduled_posts ?? 0) + (data.deleted?.pending_containers ?? 0);
        setNotification({
          type: "success",
          message: `Fila de @${clearQueueDialog.username} limpa: ${total} item${total !== 1 ? "s" : ""} removido${total !== 1 ? "s" : ""}.`,
        });
      }
      setClearQueueDialog(null);
    } catch {
      setNotification({ type: "error", message: "Falha ao limpar a fila." });
    } finally {
      setClearingQueue(false);
    }
  }, [clearQueueDialog, clearingQueue]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!confirmBulkDelete) { setConfirmBulkDelete(true); return; }
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      await supabase.from("instagram_accounts").delete().in("id", ids);
      setAccounts(prev => prev.filter(a => !selectedIds.has(a.id)));
      setNotification({
        type: "success",
        message: `${ids.length} conta${ids.length !== 1 ? "s" : ""} excluída${ids.length !== 1 ? "s" : ""} com sucesso.`,
      });
      setSelectedIds(new Set());
      setSelectMode(false);
      setConfirmBulkDelete(false);
    } finally {
      setBulkDeleting(false);
    }
  }, [confirmBulkDelete, selectedIds, supabase]);

  const handleBulkActivate = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkActivating(true);
    try {
      const { error } = await supabase
        .from("instagram_accounts")
        .update({ is_active: true })
        .in("id", ids);
      if (error) {
        setNotification({ type: "error", message: "Falha ao ativar as contas selecionadas." });
        return;
      }
      setAccounts(prev => prev.map(a => (selectedIds.has(a.id) ? { ...a, is_active: true } : a)));
      setNotification({
        type: "success",
        message: `${ids.length} conta${ids.length !== 1 ? "s" : ""} ativada${ids.length !== 1 ? "s" : ""} com sucesso.`,
      });
      setSelectedIds(new Set());
      setSelectMode(false);
    } finally {
      setBulkActivating(false);
    }
  }, [selectedIds, supabase]);

  const handleBulkMove = useCallback(async (folderId: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkMoving(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/accounts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_id: folderId }),
          }).then((r) => (r.ok ? id : Promise.reject(new Error(id))))
        )
      );
      const movedIds = new Set(
        results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value)
      );
      if (movedIds.size > 0) {
        // Recalcula contadores de pasta com base no estado atual das contas movidas.
        setAccounts((prev) => {
          setFolders((fs) =>
            fs.map((f) => {
              let delta = 0;
              for (const acc of prev) {
                if (!movedIds.has(acc.id)) continue;
                if (acc.folder_id === f.id) delta -= 1;
                if (folderId === f.id) delta += 1;
              }
              return delta !== 0 ? { ...f, account_count: Math.max(0, f.account_count + delta) } : f;
            })
          );
          return prev.map((a) => (movedIds.has(a.id) ? { ...a, folder_id: folderId } : a));
        });
        const target = folderId ? folders.find((f) => f.id === folderId)?.name ?? "pasta" : "Sem pasta";
        setNotification({
          type: "success",
          message: `${movedIds.size} conta${movedIds.size !== 1 ? "s" : ""} movida${movedIds.size !== 1 ? "s" : ""} para ${target}.`,
        });
        router.refresh();
      }
      const failed = ids.length - movedIds.size;
      if (failed > 0) {
        setNotification({ type: "error", message: `${failed} conta${failed !== 1 ? "s" : ""} não pôde${failed !== 1 ? "ram" : ""} ser movida${failed !== 1 ? "s" : ""}.` });
      }
      setBulkMoveOpen(false);
      setSelectedIds(new Set());
      setSelectMode(false);
    } finally {
      setBulkMoving(false);
    }
  }, [selectedIds, folders, router]);

  const cancelSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    setBulkMoveOpen(false);
  }, []);

  const handleMoveClick = useCallback((account: Account) => {
    setMoveAccount(account);
    setMovePendingFolderId(account.folder_id);
  }, []);

  const handleProxyClick = useCallback((account: Account) => {
    setProxyAccount(account);
    setProxyInput("");
  }, []);

  const handleCsvImport = useCallback(async () => {
    const lines = csvText.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    const rows = lines.map(line => {
      const comma = line.indexOf(",");
      if (comma === -1) return null;
      const username = line.slice(0, comma).trim();
      const proxy_url = line.slice(comma + 1).trim() || null;
      return { username, proxy_url };
    }).filter(Boolean) as Array<{ username: string; proxy_url: string | null }>;

    if (rows.length === 0) return;
    setCsvImporting(true);
    try {
      const res = await fetch("/api/accounts/bulk-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json() as { results?: typeof csvResults; saved?: number; removed?: number; not_found?: number; errors?: number };
      setCsvResults(data.results ?? null);
      if ((data.saved ?? 0) > 0 || (data.removed ?? 0) > 0) {
        await fetchAccounts();
      }
    } finally {
      setCsvImporting(false);
    }
  }, [csvText, fetchAccounts]);

  const CHECKER_MAX = 60;
  const CHECKER_BATCH = 15;

  const handleCheckProfiles = useCallback(async () => {
    const list = Array.from(
      new Set(
        checkerText
          .split(/[\n,]/)
          .map(s => s.trim().replace(/^@/, ""))
          .filter(Boolean)
      )
    ).slice(0, CHECKER_MAX);

    if (list.length === 0) return;

    setCheckerRunning(true);
    setCheckerResults([]);
    setCheckerProgress({ done: 0, total: list.length });

    const collected: CheckerResult[] = [];
    for (let i = 0; i < list.length; i += CHECKER_BATCH) {
      const chunk = list.slice(i, i + CHECKER_BATCH);
      try {
        const res = await fetch("/api/instagram/checker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames: chunk }),
        });
        const data = (await res.json()) as { results?: CheckerResult[]; error?: string };
        if (data.results) {
          collected.push(...data.results);
        } else {
          collected.push(
            ...chunk.map(u => ({ username: u, status: "error" as const, message: data.error ?? "Falha na requisição" }))
          );
        }
      } catch {
        collected.push(...chunk.map(u => ({ username: u, status: "error" as const, message: "Falha de rede" })));
      }
      setCheckerResults([...collected]);
      setCheckerProgress({ done: Math.min(i + CHECKER_BATCH, list.length), total: list.length });
    }

    setCheckerRunning(false);
  }, [checkerText]);

  const handleSaveProxy = useCallback(async (proxyUrl: string | null) => {
    if (!proxyAccount) return;
    setSavingProxy(true);
    try {
      const res = await fetch(`/api/accounts/${proxyAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy_url: proxyUrl }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setAccounts(prev =>
          prev.map(a => a.id === proxyAccount.id ? { ...a, has_proxy: proxyUrl !== null } : a)
        );
        setNotification({
          type: "success",
          message: proxyUrl ? `Proxy configurado para @${proxyAccount.username}.` : `Proxy removido de @${proxyAccount.username}.`,
        });
        setProxyAccount(null);
      } else {
        setNotification({ type: "error", message: data.error ?? "Erro ao salvar proxy." });
      }
    } finally {
      setSavingProxy(false);
    }
  }, [proxyAccount]);

  const handleMoveAccount = useCallback(async (accountId: string, folderId: string | null) => {
    setMovingAccountId(accountId);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });

      if (res.ok) {
        setAccounts(prev => {
          const movedAcc = prev.find(a => a.id === accountId);
          setFolders(folders => folders.map(f => {
            if (f.id === movedAcc?.folder_id) return { ...f, account_count: Math.max(0, f.account_count - 1) };
            if (f.id === folderId) return { ...f, account_count: f.account_count + 1 };
            return f;
          }));
          return prev.map(a => a.id === accountId ? { ...a, folder_id: folderId } : a);
        });
        router.refresh();
      }
    } finally {
      setMovingAccountId(null);
    }
  }, [router]);

  const handleLabelUpdate = useCallback((id: string, labels: AccountLabel[]) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, labels } : a));
  }, []);

  // Edit profile modal
  const [editProfileAccount, setEditProfileAccount] = useState<Account | null>(null);

  const handleProfileSaved = useCallback((id: string, draft: ProfileDraft) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, profile_draft: draft } : a));
  }, []);

  // ── Folder CRUD ────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/accounts/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      const data = await res.json() as { folder?: AccountFolder; error?: string };
      if (data.folder) {
        setFolders(prev => [...prev, data.folder!]);
        setNewFolderName("");
        setShowNewFolderModal(false);
        setActiveFolderId(data.folder.id);
      } else {
        setNotification({ type: "error", message: data.error ?? "Erro ao criar pasta." });
      }
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameModal || !renameName.trim()) return;
    setRenamingFolder(true);
    try {
      const res = await fetch(`/api/accounts/folders/${renameModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameName.trim() }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setFolders(prev => prev.map(f => f.id === renameModal.id ? { ...f, name: renameName.trim() } : f));
        setRenameModal(null);
      } else {
        setNotification({ type: "error", message: data.error ?? "Erro ao renomear pasta." });
      }
    } finally {
      setRenamingFolder(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deleteDialog) return;
    setDeletingFolder(true);
    try {
      const res = await fetch(`/api/accounts/folders/${deleteDialog.id}`, { method: "DELETE" });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setFolders(prev => prev.filter(f => f.id !== deleteDialog.id));
        if (activeFolderId === deleteDialog.id) setActiveFolderId(null);
        // Unlink accounts from deleted folder in local state
        setAccounts(prev => prev.map(a =>
          a.folder_id === deleteDialog.id ? { ...a, folder_id: null } : a
        ));
        setDeleteDialog(null);
      } else {
        setNotification({ type: "error", message: data.error ?? "Erro ao excluir pasta." });
      }
    } finally {
      setDeletingFolder(false);
    }
  };

  const filteredAccounts = useMemo(() => {
    const base = activeFolderId === null
      ? accounts.filter(a => a.folder_id === null)
      : accounts.filter(a => a.folder_id === activeFolderId);

    if (sortMode === "followers_desc") {
      return [...base].sort((a, b) => (b.followers_count ?? -1) - (a.followers_count ?? -1));
    }
    if (sortMode === "followers_asc") {
      return [...base].sort((a, b) => (a.followers_count ?? Infinity) - (b.followers_count ?? Infinity));
    }
    if (sortMode === "story_expiring") {
      return [...base].sort((a, b) => {
        const ta = storiesMap[a.id]?.expiring_first_at ?? null;
        const tb = storiesMap[b.id]?.expiring_first_at ?? null;
        if (!ta && !tb) return 0;
        if (!ta) return 1;
        if (!tb) return -1;
        return new Date(ta).getTime() - new Date(tb).getTime();
      });
    }
    return base;
  }, [accounts, activeFolderId, sortMode, storiesMap]);

  const sortedFolders = useMemo(() => {
    if (!folderOrder.length) return folders;
    return [...folders].sort((a, b) => {
      const ia = folderOrder.indexOf(a.id);
      const ib = folderOrder.indexOf(b.id);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [folders, folderOrder]);

  const handleFolderDragStart = (folderId: string) => setDraggingFolderId(folderId);

  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    if (folderId !== draggingFolderId) setDragOverFolderId(folderId);
  };

  const handleFolderDrop = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    if (!draggingFolderId || draggingFolderId === targetFolderId) {
      setDraggingFolderId(null);
      setDragOverFolderId(null);
      return;
    }
    const order = sortedFolders.map(f => f.id);
    const fromIdx = order.indexOf(draggingFolderId);
    const toIdx = order.indexOf(targetFolderId);
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, draggingFolderId);
    setFolderOrder(order);
    try { localStorage.setItem("folder_order", JSON.stringify(order)); } catch {}
    setDraggingFolderId(null);
    setDragOverFolderId(null);
  };

  const handleFolderDragEnd = () => {
    setDraggingFolderId(null);
    setDragOverFolderId(null);
  };

  const active = accounts.filter(a => a.is_active).length;
  const unassigned = accounts.filter(a => a.folder_id === null).length;

  return (
    <div className="space-y-6">

      {/* Magic Link modal */}
      <MagicLinkModal open={magicLinkOpen} onClose={() => setMagicLinkOpen(false)} />

      {/* App picker modal */}
      <AnimatePresence>
        {appPickerOpen && (
          <>
            <motion.div
              key="app-picker-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setAppPickerOpen(false)}
            />
            <motion.div
              key="app-picker-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-sm max-h-[85vh] flex flex-col p-6 space-y-4 pointer-events-auto overflow-hidden">
                <div className="flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                      <KeyRound size={13} className="text-violet-400" />
                    </div>
                    <h3 className="text-base font-bold text-white">Conectar Conta</h3>
                  </div>
                  <button
                    onClick={() => setAppPickerOpen(false)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>

                {userApps.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4 overflow-y-auto"
                  >
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-4 space-y-1.5 text-center">
                      <p className="text-sm font-semibold text-amber-300">Nenhum App cadastrado</p>
                      <p className="text-xs text-white/35 leading-relaxed">
                        Você precisa cadastrar um App da Meta antes de adicionar uma conta.
                      </p>
                    </div>
                    <button
                      onClick={() => { setAppPickerOpen(false); router.push("/dashboard/apps"); }}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-sm font-semibold px-4 py-3 hover:bg-blue-600/30 hover:border-blue-500/50 transition-all"
                    >
                      <KeyRound size={14} />
                      Configurar Meu Primeiro App
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3 min-h-0 flex flex-col"
                  >
                    <p className="text-xs text-white/35 flex-shrink-0">
                      Escolha qual App Meta usar para autorizar a conta no Instagram:
                    </p>
                    <div className="space-y-2 overflow-y-auto pr-1">
                      {userApps.map(app => (
                        <button
                          key={app.id}
                          onClick={() => {
                            setAppPickerOpen(false);
                            window.location.href = `/api/instagram/auth?appId=${app.id}`;
                          }}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.07] hover:bg-violet-600/10 hover:border-violet-500/25 transition-all text-left group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                              <KeyRound size={13} className="text-violet-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white/80 truncate group-hover:text-white transition-colors">
                                {app.app_name}
                              </p>
                              <p className="text-[10px] text-white/25 font-mono truncate">
                                ID: {app.ig_app_id}
                              </p>
                            </div>
                          </div>
                          <ChevronRight size={14} className="text-white/20 flex-shrink-0 group-hover:text-violet-400 transition-colors" />
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { setAppPickerOpen(false); router.push("/dashboard/apps"); }}
                      className="w-full text-center text-xs text-white/25 hover:text-violet-400 transition-colors py-1 flex-shrink-0"
                    >
                      + Cadastrar novo app
                    </button>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Nova pasta modal */}
      <AnimatePresence>
        {showNewFolderModal && (
          <>
            <motion.div
              key="new-folder-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => { setShowNewFolderModal(false); setNewFolderName(""); }}
            />
            <motion.div
              key="new-folder-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                      <FolderPlus size={13} className="text-violet-400" />
                    </div>
                    <h3 className="text-sm font-bold text-white">Nova Pasta</h3>
                  </div>
                  <button
                    onClick={() => { setShowNewFolderModal(false); setNewFolderName(""); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); }}
                  placeholder="Ex: Cliente A, Marca XYZ..."
                  maxLength={50}
                  className="input-glass w-full text-sm px-3 py-2.5"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowNewFolderModal(false); setNewFolderName(""); }}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || creatingFolder}
                    className="flex-1 py-2.5 rounded-xl bg-violet-600/25 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-600/35 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    {creatingFolder ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}
                    Criar
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Rename pasta modal */}
      <AnimatePresence>
        {renameModal && (
          <>
            <motion.div
              key="rename-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setRenameModal(null)}
            />
            <motion.div
              key="rename-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                      <Pencil size={13} className="text-amber-400" />
                    </div>
                    <h3 className="text-sm font-bold text-white">Renomear Pasta</h3>
                  </div>
                  <button
                    onClick={() => setRenameModal(null)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <input
                  autoFocus
                  value={renameName}
                  onChange={e => setRenameName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleRenameFolder(); }}
                  maxLength={50}
                  className="input-glass w-full text-sm px-3 py-2.5"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setRenameModal(null)}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleRenameFolder}
                    disabled={!renameName.trim() || renamingFolder}
                    className="flex-1 py-2.5 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-600/30 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    {renamingFolder ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
                    Salvar
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete folder dialog */}
      <AnimatePresence>
        {deleteDialog && (
          <>
            <motion.div
              key="delete-folder-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => !deletingFolder && setDeleteDialog(null)}
            />
            <motion.div
              key="delete-folder-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl border border-red-500/20 w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Trash2 size={15} className="text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Excluir &quot;{deleteDialog.name}&quot;?</h3>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">
                      {deleteDialog.count > 0
                        ? `${deleteDialog.count} conta${deleteDialog.count !== 1 ? "s" : ""} dentro desta pasta será${deleteDialog.count !== 1 ? "ão" : ""} excluída${deleteDialog.count !== 1 ? "s" : ""} permanentemente. Esta ação não pode ser desfeita.`
                        : "A pasta está vazia. Esta ação não pode ser desfeita."
                      }
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteDialog(null)}
                    disabled={deletingFolder}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleDeleteFolder}
                    disabled={deletingFolder}
                    className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-600/30 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    {deletingFolder ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Excluir
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Limpar fila pendente de uma conta */}
      <AnimatePresence>
        {clearQueueDialog && (
          <>
            <motion.div
              key="clear-queue-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => !clearingQueue && setClearQueueDialog(null)}
            />
            <motion.div
              key="clear-queue-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl border border-amber-500/20 w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <ListX size={15} className="text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Excluir vídeos pendentes de @{clearQueueDialog.username}?</h3>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">
                      Remove todos os posts e containers aguardando publicação na fila desta conta (Loop, Postar, Clonar). Posts já publicados no Instagram não são afetados. Esta ação não pode ser desfeita.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setClearQueueDialog(null)}
                    disabled={clearingQueue}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleClearQueue}
                    disabled={clearingQueue}
                    className="flex-1 py-2.5 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-600/30 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    {clearingQueue ? <Loader2 size={12} className="animate-spin" /> : <ListX size={12} />}
                    Excluir
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal: Mover conta para pasta (page-level — fora de qualquer motion transform) */}
      <AnimatePresence>
        {moveAccount && (
          <>
            <motion.div
              key="move-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setMoveAccount(null)}
            />
            <motion.div
              key="move-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                      <Folder size={13} className="text-violet-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Mover para pasta</h3>
                      <p className="text-[11px] text-white/30">@{moveAccount.username}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setMoveAccount(null)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  <button
                    onClick={() => setMovePendingFolderId(null)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs transition-all text-left",
                      movePendingFolderId === null
                        ? "bg-white/[0.07] border-white/20 text-white"
                        : "border-white/[0.05] text-white/45 hover:bg-white/[0.04] hover:text-white/70"
                    )}
                  >
                    <FolderOpen size={12} className="text-white/30 flex-shrink-0" />
                    <span className="flex-1">Sem pasta</span>
                    {moveAccount.folder_id === null && movePendingFolderId !== null && (
                      <span className="text-[9px] text-white/25 flex-shrink-0">atual</span>
                    )}
                    {movePendingFolderId === null && (
                      <CheckCircle2 size={12} className="text-[#00FF41] flex-shrink-0" />
                    )}
                  </button>

                  {folders.length === 0 ? (
                    <p className="text-[11px] text-white/25 text-center py-3">
                      Nenhuma pasta criada. Crie pastas nas abas acima.
                    </p>
                  ) : (
                    folders.map(f => (
                      <button
                        key={f.id}
                        onClick={() => setMovePendingFolderId(f.id)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs transition-all text-left",
                          movePendingFolderId === f.id
                            ? "bg-violet-600/15 border-violet-500/30 text-violet-200"
                            : "border-white/[0.05] text-white/45 hover:bg-white/[0.04] hover:text-white/70"
                        )}
                      >
                        <Folder size={12} className={cn(
                          "flex-shrink-0",
                          movePendingFolderId === f.id ? "text-violet-400" : "text-violet-400/50"
                        )} />
                        <span className="flex-1 truncate">{f.name}</span>
                        {moveAccount.folder_id === f.id && movePendingFolderId !== f.id && (
                          <span className="text-[9px] text-white/25 flex-shrink-0">atual</span>
                        )}
                        {movePendingFolderId === f.id && (
                          <CheckCircle2 size={12} className="text-violet-400 flex-shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setMoveAccount(null)}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      handleMoveAccount(moveAccount.id, movePendingFolderId);
                      setMoveAccount(null);
                    }}
                    disabled={movingAccountId === moveAccount.id || movePendingFolderId === moveAccount.folder_id}
                    className="flex-1 py-2.5 rounded-xl bg-violet-600/25 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-600/35 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                  >
                    {movingAccountId === moveAccount.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Folder size={12} />
                    }
                    Mover
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal: Mover contas selecionadas em massa para pasta */}
      <AnimatePresence>
        {bulkMoveOpen && (
          <>
            <motion.div
              key="bulk-move-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => !bulkMoving && setBulkMoveOpen(false)}
            />
            <motion.div
              key="bulk-move-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                      <Folder size={13} className="text-violet-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Mover para pasta</h3>
                      <p className="text-[11px] text-white/30">
                        {selectedIds.size} conta{selectedIds.size !== 1 ? "s" : ""} selecionada{selectedIds.size !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => !bulkMoving && setBulkMoveOpen(false)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  <button
                    onClick={() => setBulkMovePendingFolderId(null)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs transition-all text-left",
                      bulkMovePendingFolderId === null
                        ? "bg-white/[0.07] border-white/20 text-white"
                        : "border-white/[0.05] text-white/45 hover:bg-white/[0.04] hover:text-white/70"
                    )}
                  >
                    <FolderOpen size={12} className="text-white/30 flex-shrink-0" />
                    <span className="flex-1">Sem pasta</span>
                    {bulkMovePendingFolderId === null && (
                      <CheckCircle2 size={12} className="text-[#00FF41] flex-shrink-0" />
                    )}
                  </button>

                  {folders.length === 0 ? (
                    <p className="text-[11px] text-white/25 text-center py-3">
                      Nenhuma pasta criada. Crie pastas nas abas acima.
                    </p>
                  ) : (
                    folders.map(f => (
                      <button
                        key={f.id}
                        onClick={() => setBulkMovePendingFolderId(f.id)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs transition-all text-left",
                          bulkMovePendingFolderId === f.id
                            ? "bg-violet-600/15 border-violet-500/30 text-violet-200"
                            : "border-white/[0.05] text-white/45 hover:bg-white/[0.04] hover:text-white/70"
                        )}
                      >
                        <Folder size={12} className={cn(
                          "flex-shrink-0",
                          bulkMovePendingFolderId === f.id ? "text-violet-400" : "text-violet-400/50"
                        )} />
                        <span className="flex-1 truncate">{f.name}</span>
                        {bulkMovePendingFolderId === f.id && (
                          <CheckCircle2 size={12} className="text-violet-400 flex-shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => !bulkMoving && setBulkMoveOpen(false)}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleBulkMove(bulkMovePendingFolderId)}
                    disabled={bulkMoving}
                    className="flex-1 py-2.5 rounded-xl bg-violet-600/25 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-600/35 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                  >
                    {bulkMoving
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Folder size={12} />
                    }
                    Mover {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal: Configurar Proxy por conta */}
      <AnimatePresence>
        {proxyAccount && (
          <>
            <motion.div
              key="proxy-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => !savingProxy && setProxyAccount(null)}
            />
            <motion.div
              key="proxy-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-sm p-5 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[#00FF41]/10 border border-[#00FF41]/20 flex items-center justify-center">
                      <Globe size={13} className="text-[#00FF41]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Proxy Dedicado</h3>
                      <p className="text-[10px] text-white/30">@{proxyAccount.username}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setProxyAccount(null)}
                    disabled={savingProxy}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 text-[11px] text-white/35 leading-relaxed">
                  {proxyAccount.has_proxy
                    ? "Esta conta já tem um proxy configurado. Insira uma nova URL para substituir, ou clique em Remover Proxy."
                    : "Insira a URL completa do proxy residencial dedicado a esta conta. A senha será criptografada antes de ser salva."
                  }
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-white/40 uppercase tracking-wide font-semibold">
                    URL do Proxy
                  </label>
                  <input
                    autoFocus
                    value={proxyInput}
                    onChange={e => setProxyInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && proxyInput.trim()) handleSaveProxy(proxyInput.trim()); }}
                    placeholder="http://user:senha@host:porta"
                    className="input-glass w-full text-sm px-3 py-2.5 font-mono"
                  />
                  <p className="text-[10px] text-white/20">
                    Formatos aceitos: http://, https://, socks5://
                  </p>
                </div>

                <div className="flex gap-2">
                  {proxyAccount.has_proxy && (
                    <button
                      onClick={() => handleSaveProxy(null)}
                      disabled={savingProxy}
                      className="px-3 py-2.5 rounded-xl bg-red-600/15 border border-red-500/25 text-red-400 text-xs font-semibold hover:bg-red-600/25 disabled:opacity-50 transition-all flex items-center gap-1.5 flex-shrink-0"
                    >
                      {savingProxy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Remover
                    </button>
                  )}
                  <button
                    onClick={() => setProxyAccount(null)}
                    disabled={savingProxy}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleSaveProxy(proxyInput.trim() || null)}
                    disabled={!proxyInput.trim() || savingProxy}
                    className="flex-1 py-2.5 rounded-xl bg-[#00FF41]/15 border border-[#00FF41]/25 text-[#00FF41] text-xs font-semibold hover:bg-[#00FF41]/25 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                  >
                    {savingProxy ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
                    Salvar
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal: importar proxies via CSV */}
      <AnimatePresence>
        {showCsvImport && (
          <>
            <motion.div
              key="csv-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => { if (!csvImporting) { setShowCsvImport(false); setCsvResults(null); setCsvText(""); } }}
            />
            <motion.div
              key="csv-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-lg p-6 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                      <Upload size={13} className="text-blue-400" />
                    </div>
                    <h3 className="text-base font-bold text-white">Importar Proxies em Massa</h3>
                  </div>
                  <button
                    onClick={() => { setShowCsvImport(false); setCsvResults(null); setCsvText(""); }}
                    disabled={csvImporting}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>

                {!csvResults ? (
                  <>
                    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-1">
                      <p className="text-[11px] text-white/40 font-mono">Formato: <span className="text-[#00FF41]/70">username,http://user:pass@ip:porta</span></p>
                      <p className="text-[11px] text-white/25">Uma conta por linha. Para remover proxy: <span className="text-white/40 font-mono">username,</span></p>
                      <p className="text-[11px] text-white/25">Linhas com # são ignoradas.</p>
                    </div>
                    <textarea
                      value={csvText}
                      onChange={e => setCsvText(e.target.value)}
                      placeholder={"# Cole aqui — uma linha por conta\nconta1,http://user:pass@203.0.113.1:3128\nconta2,http://user:pass@198.51.100.5:3128\nconta3,"}
                      rows={10}
                      className="w-full rounded-xl bg-black/40 border border-white/[0.08] text-xs text-white/70 font-mono placeholder-white/15 px-3 py-2.5 focus:outline-none focus:border-[#00FF41]/40 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowCsvImport(false); setCsvText(""); }}
                        className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleCsvImport}
                        disabled={!csvText.trim() || csvImporting}
                        className="flex-1 py-2.5 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-xs font-semibold hover:bg-blue-600/30 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                      >
                        {csvImporting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        Importar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5 max-h-80 overflow-y-auto">
                      {csvResults.map((r, i) => (
                        <div key={i} className={cn(
                          "flex items-center justify-between px-3 py-2 rounded-lg text-xs",
                          r.status === "saved" && "bg-[#00FF41]/[0.06] border border-[#00FF41]/15",
                          r.status === "removed" && "bg-amber-500/[0.06] border border-amber-500/15",
                          r.status === "not_found" && "bg-white/[0.03] border border-white/[0.06]",
                          r.status === "error" && "bg-red-500/[0.06] border border-red-500/15",
                        )}>
                          <span className={cn(
                            "font-mono",
                            r.status === "saved" && "text-[#00FF41]/80",
                            r.status === "removed" && "text-amber-400/80",
                            r.status === "not_found" && "text-white/30",
                            r.status === "error" && "text-red-400/80",
                          )}>@{r.username.replace(/^@/, "")}</span>
                          <span className={cn(
                            "text-[10px] font-semibold",
                            r.status === "saved" && "text-[#00FF41]/60",
                            r.status === "removed" && "text-amber-400/60",
                            r.status === "not_found" && "text-white/20",
                            r.status === "error" && "text-red-400/60",
                          )}>
                            {r.status === "saved" && "✓ proxy salvo"}
                            {r.status === "removed" && "proxy removido"}
                            {r.status === "not_found" && "conta não encontrada"}
                            {r.status === "error" && (r.error ?? "erro")}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => { setCsvResults(null); }}
                        className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                      >
                        Importar mais
                      </button>
                      <button
                        onClick={() => { setShowCsvImport(false); setCsvResults(null); setCsvText(""); }}
                        className="flex-1 py-2.5 rounded-xl bg-[#00FF41]/15 border border-[#00FF41]/25 text-[#00FF41] text-xs font-semibold hover:bg-[#00FF41]/25 transition-all"
                      >
                        Fechar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal: Verificador de Perfis */}
      <AnimatePresence>
        {showChecker && (
          <>
            <motion.div
              key="checker-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => { if (!checkerRunning) { setShowChecker(false); setCheckerResults(null); setCheckerText(""); setCheckerProgress(null); } }}
            />
            <motion.div
              key="checker-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-lg p-6 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                      <UserSearch size={13} className="text-amber-400" />
                    </div>
                    <h3 className="text-base font-bold text-white">Verificador de Perfis</h3>
                  </div>
                  <button
                    onClick={() => { if (!checkerRunning) { setShowChecker(false); setCheckerResults(null); setCheckerText(""); setCheckerProgress(null); } }}
                    disabled={checkerRunning}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors disabled:opacity-30"
                  >
                    <X size={15} />
                  </button>
                </div>

                {!checkerResults ? (
                  <>
                    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-1">
                      <p className="text-[11px] text-white/40">Cole @usuários do Instagram — um por linha ou separados por vírgula.</p>
                      <p className="text-[11px] text-white/25">
                        Verifica se o perfil está ativo publicamente. Contas banidas, removidas ou que nunca existiram aparecem como &quot;não encontrada&quot; — o Instagram não distingue o motivo publicamente. Até {CHECKER_MAX} por vez.
                      </p>
                    </div>
                    <textarea
                      value={checkerText}
                      onChange={e => setCheckerText(e.target.value)}
                      placeholder={"@conta1\nconta2\nconta3"}
                      rows={8}
                      className="w-full rounded-xl bg-black/40 border border-white/[0.08] text-xs text-white/70 font-mono placeholder-white/15 px-3 py-2.5 focus:outline-none focus:border-amber-500/40 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowChecker(false); setCheckerText(""); }}
                        className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleCheckProfiles}
                        disabled={!checkerText.trim()}
                        className="flex-1 py-2.5 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-600/30 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                      >
                        <UserSearch size={12} />
                        Verificar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {checkerProgress && (
                      <div className="flex items-center justify-between text-[10px] text-white/30 px-0.5">
                        <span>{checkerRunning ? "Verificando…" : "Concluído"}</span>
                        <span className="font-mono tabular-nums">{checkerProgress.done}/{checkerProgress.total}</span>
                      </div>
                    )}
                    <div className="space-y-1.5 max-h-80 overflow-y-auto">
                      {checkerResults.map((r, i) => (
                        <div key={i} className={cn(
                          "flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs",
                          r.status === "active" && "bg-[#00FF41]/[0.06] border border-[#00FF41]/15",
                          r.status === "not_found" && "bg-red-500/[0.06] border border-red-500/15",
                          r.status === "error" && "bg-white/[0.03] border border-white/[0.06]",
                        )}>
                          <span className="flex items-center gap-1.5 min-w-0">
                            {r.status === "active" && <ShieldCheck size={12} className="text-[#00FF41]/80 flex-shrink-0" />}
                            {r.status === "not_found" && <ShieldOff size={12} className="text-red-400/80 flex-shrink-0" />}
                            {r.status === "error" && <AlertTriangle size={12} className="text-amber-400/70 flex-shrink-0" />}
                            <span className={cn(
                              "font-mono truncate",
                              r.status === "active" && "text-[#00FF41]/80",
                              r.status === "not_found" && "text-red-400/80",
                              r.status === "error" && "text-white/40",
                            )}>@{r.username}</span>
                            {r.is_verified && <BadgeCheck size={11} className="text-[#00E5FF]/70 flex-shrink-0" />}
                            {r.is_private && <Lock size={10} className="text-white/25 flex-shrink-0" />}
                          </span>
                          <span className={cn(
                            "text-[10px] font-semibold text-right flex-shrink-0",
                            r.status === "active" && "text-[#00FF41]/60",
                            r.status === "not_found" && "text-red-400/60",
                            r.status === "error" && "text-amber-400/60",
                          )}>
                            {r.status === "active" && typeof r.followers === "number"
                              ? `${r.followers.toLocaleString("pt-BR")} seguidores`
                              : r.message}
                          </span>
                        </div>
                      ))}
                      {checkerRunning && checkerProgress && checkerProgress.done < checkerProgress.total && (
                        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-white/25">
                          <Loader2 size={12} className="animate-spin" />
                          Verificando próximo lote…
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => { setCheckerResults(null); setCheckerProgress(null); }}
                        disabled={checkerRunning}
                        className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-40"
                      >
                        Verificar mais
                      </button>
                      <button
                        onClick={() => { setShowChecker(false); setCheckerResults(null); setCheckerText(""); setCheckerProgress(null); }}
                        disabled={checkerRunning}
                        className="flex-1 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 transition-all disabled:opacity-40"
                      >
                        Fechar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Banner de notificação OAuth */}
      <AnimatePresence>
        {notification && (
          <motion.div
            key="notification"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm",
              notification.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                : "bg-red-500/10 border border-red-500/20 text-red-300"
            )}
          >
            {notification.type === "success"
              ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
              : <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            }
            <span className="flex-1 whitespace-pre-line">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cabeçalho */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Contas do Instagram</h1>
          <p className="text-sm text-white/35 mt-0.5">
            {accounts.length} conectada{accounts.length !== 1 ? "s" : ""} · {active} ativa{active !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!selectMode ? (
            <>
              <button
                onClick={handleSyncAll}
                disabled={syncingAll}
                title="Sincronizar todas as contas"
                className="flex items-center gap-1.5 justify-center p-2.5 rounded-xl border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-all disabled:opacity-50"
              >
                <RefreshCw size={14} className={cn(syncingAll && "animate-spin")} />
                {syncProgress && (
                  <span className="text-xs font-mono tabular-nums text-white/50">
                    {syncProgress.done}/{syncProgress.total}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setShowCsvImport(true); setCsvResults(null); setCsvText(""); }}
                className="flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-xl border border-blue-500/20 text-blue-400/70 hover:text-blue-300 hover:border-blue-500/40 hover:bg-blue-500/[0.06] transition-all"
              >
                <Upload size={14} />
                Proxies
              </button>
              <button
                onClick={() => { setShowChecker(true); setCheckerResults(null); setCheckerProgress(null); setCheckerText(""); }}
                className="flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-xl border border-amber-500/20 text-amber-400/70 hover:text-amber-300 hover:border-amber-500/40 hover:bg-amber-500/[0.06] transition-all"
              >
                <UserSearch size={14} />
                Verificar
              </button>
              <button
                onClick={() => setMagicLinkOpen(true)}
                className="flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-xl border border-[#00FF41]/20 text-[#00FF41]/70 hover:text-[#00FF41] hover:border-[#00FF41]/40 hover:bg-[#00FF41]/[0.06] transition-all"
              >
                <LinkIcon size={14} />
                Link
              </button>
              <motion.button
                onClick={() => { handleConnectClick(); }}
                whileTap={{ scale: 0.97 }}
                className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
              >
                <Plus size={15} />
                Conectar conta
              </motion.button>
            </>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <>
                  <button
                    onClick={handleBulkActivate}
                    disabled={bulkActivating || bulkMoving || bulkDeleting}
                    className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-xl font-semibold transition-all bg-[#00FF41]/10 border border-[#00FF41]/30 text-[#00FF41] hover:bg-[#00FF41]/20 disabled:opacity-40"
                  >
                    {bulkActivating
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Power size={14} />
                    }
                    {`Ativar (${selectedIds.size})`}
                  </button>
                  <button
                    onClick={() => { setBulkMovePendingFolderId(null); setBulkMoveOpen(true); }}
                    disabled={bulkMoving || bulkDeleting || bulkActivating}
                    className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-xl font-semibold transition-all bg-violet-600/15 border border-violet-500/30 text-violet-300 hover:bg-violet-600/25 disabled:opacity-40"
                  >
                    <Folder size={14} />
                    {`Mover para pasta (${selectedIds.size})`}
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting || bulkMoving || bulkActivating}
                    className={cn(
                      "flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-xl font-semibold transition-all disabled:opacity-40",
                      confirmBulkDelete
                        ? "bg-red-600 border border-red-500 text-white hover:bg-red-700"
                        : "bg-red-600/15 border border-red-500/30 text-red-400 hover:bg-red-600/25"
                    )}
                  >
                    {bulkDeleting
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Trash2 size={14} />
                    }
                    {confirmBulkDelete
                      ? `Confirmar exclusão (${selectedIds.size})`
                      : `Excluir selecionadas (${selectedIds.size})`
                    }
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </motion.div>

      {/* ── Pasta tabs ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {/* Tab: Sem Pasta */}
        <button
          onClick={() => { setActiveFolderId(null); setSortMode("none"); }}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all",
            activeFolderId === null
              ? "bg-[#00FF41]/12 text-[#00FF41] border border-[#00FF41]/25"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.05] border border-transparent"
          )}
        >
          <Users size={11} className="flex-shrink-0" />
          Sem Pasta ({unassigned})
        </button>

        {/* Tabs por pasta */}
        {sortedFolders.map(folder => {
          const isActive = activeFolderId === folder.id;
          const menuOpen = openFolderMenuId === folder.id;
          const isDragging = draggingFolderId === folder.id;
          const isOver = dragOverFolderId === folder.id;
          return (
            <div
              key={folder.id}
              className="relative flex items-center flex-shrink-0"
              data-folder-menu
              draggable
              onDragStart={() => handleFolderDragStart(folder.id)}
              onDragOver={e => handleFolderDragOver(e, folder.id)}
              onDrop={e => handleFolderDrop(e, folder.id)}
              onDragEnd={handleFolderDragEnd}
              style={{
                opacity: isDragging ? 0.4 : 1,
                cursor: "grab",
                outline: isOver ? "1px solid rgba(139,92,246,0.5)" : undefined,
                borderRadius: isOver ? "8px" : undefined,
                transition: "opacity 0.15s, outline 0.1s",
              }}
            >
              <button
                onClick={() => { setActiveFolderId(folder.id); setSortMode("none"); }}
                className={cn(
                  "flex items-center gap-1.5 pl-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all rounded-l-lg",
                  isActive ? "pr-1" : "pr-3 rounded-r-lg",
                  isActive
                    ? "bg-violet-500/12 text-violet-300 border border-violet-500/25 border-r-0"
                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.05] border border-transparent"
                )}
              >
                <Folder size={11} className="flex-shrink-0" />
                {folder.name}
                <span className={cn(
                  "text-[9px] px-1 py-0.5 rounded-full",
                  isActive ? "bg-violet-500/20 text-violet-300/70" : "bg-white/[0.06] text-white/25"
                )}>
                  {folder.account_count}
                </span>
              </button>

              {/* Gear button — só visível na pasta ativa */}
              {isActive && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    setFolderMenuPos({ top: rect.bottom + 6, left: rect.left });
                    setOpenFolderMenuId(menuOpen ? null : folder.id);
                  }}
                  className="h-full px-2 flex items-center rounded-r-lg bg-violet-500/12 border border-violet-500/25 border-l-0 text-violet-400/50 hover:text-violet-300 transition-colors"
                >
                  <Settings2 size={11} />
                </button>
              )}

              {/* Folder gear dropdown — fixed para escapar do overflow-x-auto das tabs */}
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -4 }}
                    transition={{ duration: 0.1 }}
                    style={{ position: "fixed", top: folderMenuPos.top, left: folderMenuPos.left }}
                    className="z-[200] min-w-[148px] bg-[#111318] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setRenameModal({ id: folder.id, name: folder.name });
                        setRenameName(folder.name);
                        setOpenFolderMenuId(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                    >
                      <Pencil size={12} className="text-amber-400" /> Renomear Pasta
                    </button>
                    <div className="h-px bg-white/[0.06]" />
                    <button
                      onClick={() => {
                        setDeleteDialog({ id: folder.id, name: folder.name, count: folder.account_count });
                        setOpenFolderMenuId(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400/70 hover:bg-red-500/[0.08] hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} /> Excluir Pasta
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* Nova pasta button */}
        <button
          onClick={() => setShowNewFolderModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 text-white/30 hover:text-violet-400 hover:bg-violet-500/[0.06] border border-transparent hover:border-violet-500/20 transition-all"
        >
          <FolderPlus size={11} className="flex-shrink-0" />
          Nova Pasta
        </button>
      </div>

      {/* Filtros de ordenação + seleção — visíveis quando há contas */}
      {!loading && filteredAccounts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white/25 text-[11px] uppercase tracking-wider font-medium mr-1">Ordenar</span>
          {(
            [
              { key: "followers_desc", label: "Mais seguidores" },
              { key: "followers_asc",  label: "Menos seguidores" },
              { key: "story_expiring", label: "Story expirando" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSortMode(prev => prev === key ? "none" : key)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all",
                sortMode === key
                  ? key === "story_expiring"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-[#00E5FF]/10 border-[#00E5FF]/30 text-[#00E5FF]"
                  : "bg-white/[0.03] border-white/[0.07] text-white/35 hover:text-white/60 hover:border-white/15"
              )}
            >
              {key === "followers_desc" && <span className="text-[10px]">↓</span>}
              {key === "followers_asc"  && <span className="text-[10px]">↑</span>}
              {key === "story_expiring" && <span className="text-[10px]">⏱</span>}
              {label}
            </button>
          ))}
          {/* Divisor */}
          <div className="w-px h-4 bg-white/10 mx-1" />
          {!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border bg-white/[0.03] border-white/[0.07] text-white/35 hover:text-white/60 hover:border-white/15 transition-all"
            >
              <CheckCircle2 size={11} />
              Selecionar
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  const filteredIds = filteredAccounts.map(a => a.id);
                  const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id));
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (allSelected) {
                      filteredIds.forEach(id => next.delete(id));
                    } else {
                      filteredIds.forEach(id => next.add(id));
                    }
                    return next;
                  });
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border bg-[#00FF41]/[0.06] border-[#00FF41]/20 text-[#00FF41]/70 hover:text-[#00FF41] hover:border-[#00FF41]/40 transition-all"
              >
                <CheckCircle2 size={11} />
                {filteredAccounts.length > 0 && filteredAccounts.every(a => selectedIds.has(a.id)) ? "Desmarcar todas" : "Selecionar todas"}
              </button>
              <button
                onClick={cancelSelectMode}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border bg-white/[0.03] border-white/[0.07] text-white/35 hover:text-white/60 hover:border-white/15 transition-all"
              >
                <X size={11} />
                Cancelar
              </button>
            </>
          )}
        </div>
      )}

      {/* Grid de contas */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <AccountSkeleton key={i} />)}
        </div>
      ) : filteredAccounts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card rounded-2xl flex flex-col items-center gap-4 py-20 text-center px-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            {activeFolderId
              ? <Folder size={24} className="text-white/20" />
              : accounts.length === 0
                ? <Instagram size={24} className="text-white/20" />
                : <CheckCircle2 size={24} className="text-[#00FF41]/40" />
            }
          </div>
          <div className="space-y-1">
            {activeFolderId ? (
              <>
                <p className="text-white/40 text-sm font-medium">Pasta vazia</p>
                <p className="text-white/20 text-xs max-w-xs">
                  Mova contas para esta pasta usando o menu ⋯ em cada conta.
                </p>
              </>
            ) : accounts.length === 0 ? (
              <>
                <p className="text-white/40 text-sm font-medium">Nenhuma conta conectada</p>
                <p className="text-white/20 text-xs max-w-xs">
                  Clique em &quot;Conectar conta&quot; e autorize via Instagram para adicionar sua primeira conta Business ou Creator.
                </p>
              </>
            ) : (
              <>
                <p className="text-[#00FF41]/70 text-sm font-semibold">Tudo organizado</p>
                <p className="text-white/20 text-xs max-w-xs">
                  Todas as contas estão dentro de uma pasta. Use as abas acima para gerenciá-las.
                </p>
              </>
            )}
          </div>
          {!activeFolderId && accounts.length === 0 && (
            <motion.button
              onClick={() => { handleConnectClick(); }}
              whileTap={{ scale: 0.97 }}
              className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2"
            >
              <Plus size={14} /> Conectar primeira conta
            </motion.button>
          )}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          <AnimatePresence>
            {filteredAccounts.map(account => (
              <AccountCard
                key={account.id}
                account={account}
                storiesData={storiesMap[account.id]}
                onRefresh={handleRefresh}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onRefreshToken={handleRefreshToken}
                onMoveClick={handleMoveClick}
                onProxyClick={handleProxyClick}
                onClearQueueClick={(acc) => setClearQueueDialog({ id: acc.id, username: acc.username })}
                onLabelUpdate={handleLabelUpdate}
                onEditProfile={setEditProfileAccount}
                refreshing={refreshingIds.has(account.id)}
                toggling={togglingId === account.id}
                deleting={deletingId === account.id}
                tokenRefreshing={tokenRefreshingId === account.id}
                moving={movingAccountId === account.id}
                selectMode={selectMode}
                selected={selectedIds.has(account.id)}
                onSelect={() => toggleSelect(account.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Modal Editar Perfil Manual */}
      <AnimatePresence>
        {editProfileAccount && (
          <EditProfileModal
            account={editProfileAccount}
            onClose={() => setEditProfileAccount(null)}
            onSaved={handleProfileSaved}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
