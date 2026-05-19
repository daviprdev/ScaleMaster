"use client";

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
  ChevronRight,
  Layers,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface MetaAppInfo {
  id: string;
  name: string;
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
  return null; // saudável — não exibir chip
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

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Conexão cancelada. Nenhuma conta foi adicionada.",
  state_mismatch: "Erro de segurança (state inválido). Tente novamente.",
  no_code: "Código de autorização ausente. Tente novamente.",
  server_error: "Erro interno ao processar a conexão. Verifique os logs e tente novamente.",
  personal_account: "Sua conta precisa ser Comercial ou de Criador de Conteúdo no Instagram. Acesse as Configurações do Instagram → Conta → Mudar para conta profissional.",
};

// ── Modal de seleção de App Meta ─────────────────────────────
function AppSelectModal({
  apps,
  onSelect,
  onClose,
}: {
  apps: MetaAppInfo[];
  onSelect: (appId: string) => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        key="app-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onClick={onClose}
      >
        <motion.div
          key="app-modal"
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-sm bg-[#0f1117] border border-white/[0.09] rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-violet-600/20 flex items-center justify-center">
                <Layers size={15} className="text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Selecionar App Meta</p>
                <p className="text-[11px] text-white/35">Qual app usar para esta conexão?</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* App list */}
          <div className="p-3 space-y-1.5">
            {apps.map((app, idx) => (
              <button
                key={app.id}
                onClick={() => onSelect(app.id)}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left
                  bg-white/[0.04] border border-white/[0.07]
                  hover:bg-violet-600/[0.12] hover:border-violet-500/30
                  transition-all group"
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/30 to-cyan-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-violet-300">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/85 group-hover:text-white transition-colors truncate">
                    {app.name}
                  </p>
                  <p className="text-[11px] text-white/30 font-mono">{app.id}</p>
                </div>
                <ChevronRight size={14} className="text-white/20 group-hover:text-violet-400 transition-colors flex-shrink-0" />
              </button>
            ))}
          </div>

          <div className="px-5 pb-4 pt-1">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl text-sm text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
            >
              Cancelar
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Chip de métrica ───────────────────────────────────────────
function Metric({
  icon,
  label,
  muted = false,
  blue = false,
}: {
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
  blue?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-1 whitespace-nowrap text-[11px] flex-shrink-0",
      blue ? "text-blue-400" : muted ? "text-white/20" : "text-white/45"
    )}>
      <span className={cn("flex-shrink-0", blue ? "text-blue-400" : muted ? "text-white/15" : "text-white/30")}>
        {icon}
      </span>
      {label}
    </div>
  );
}

// ── Card de conta ─────────────────────────────────────────────
function AccountCard({
  account,
  onRefresh,
  onToggle,
  onDelete,
  onRefreshToken,
  refreshing,
  toggling,
  deleting,
  tokenRefreshing,
}: {
  account: Account;
  onRefresh: (id: string) => void;
  onToggle: (acc: Account) => void;
  onDelete: (id: string) => void;
  onRefreshToken: (id: string) => void;
  refreshing: boolean;
  toggling: boolean;
  deleting: boolean;
  tokenRefreshing: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const proxyImg = (url: string) => `/api/proxy-image?url=${encodeURIComponent(url)}`;
  const busy = refreshing || toggling || deleting || tokenRefreshing;
  const isMetaConnected = !!account.ig_business_account_id;
  const tokenChip = tokenStatusChip(account.token_expires_at, isMetaConnected);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="glass-card rounded-2xl"
    >
      {/* Cabeçalho */}
      <div className="flex items-start gap-3 p-5 pb-4">
        {account.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxyImg(account.avatar_url)}
            alt={account.username}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-2 ring-white/10"
          />
        ) : (
          <div className={cn(
            "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0 ring-2 ring-white/10",
            avatarColor(account.username)
          )}>
            <Instagram size={20} className="text-white" />
          </div>
        )}

        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-bold text-white/90 truncate">@{account.username}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Instagram size={9} className="text-pink-400 flex-shrink-0" />
            <span className="text-[10px] text-white/30">Instagram</span>
            {isMetaConnected && (
              <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide bg-blue-500/15 text-blue-300 flex-shrink-0">
                <span className="w-1 h-1 rounded-full bg-blue-400" />
                META API
              </span>
            )}
            {tokenChip && (
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
            <span className={cn(
              "inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0",
              account.is_active
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-white/[0.05] text-white/20"
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full", account.is_active ? "bg-emerald-400" : "bg-white/20")} />
              {account.is_active ? "ATIVA" : "INATIVA"}
            </span>
          </div>
        </div>

        {/* Menu três pontos */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => !busy && setMenuOpen(o => !o)}
            disabled={busy}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
          >
            {refreshing || deleting || tokenRefreshing
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
                className="absolute right-0 top-full mt-1.5 z-30 min-w-[168px] bg-[#111318] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
              >
                <button
                  onClick={() => { onRefresh(account.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <RefreshCw size={12} className="text-cyan-400" /> Atualizar Dados
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

      <div className="h-px bg-white/[0.05] mx-5" />

      {/* Métricas */}
      <div className="flex items-center gap-3.5 px-5 py-3 overflow-x-auto">
        <Metric icon={<Users size={11} />} label={`${formatNumber(account.followers_count)} seg.`} muted={account.followers_count == null} />
        <Metric icon={<FileText size={11} />} label={`${account.posts_count ?? "—"} posts`} muted={account.posts_count == null} />
        <Metric icon={<Clock size={11} />} label={account.last_post_at ? timeAgo(account.last_post_at) : "—"} muted={!account.last_post_at} />
        <Metric
          icon={<span className={cn("w-1.5 h-1.5 rounded-full inline-block flex-shrink-0", account.profile_refreshed_at ? "bg-emerald-400" : "bg-white/20")} />}
          label={account.profile_refreshed_at ? `online ${timeAgo(account.profile_refreshed_at)}` : "não atualizado"}
          muted={!account.profile_refreshed_at}
        />
        {account.has_active_stories === true && (
          <Metric
            icon={<span className="w-1.5 h-1.5 rounded-full inline-block bg-blue-400 ring-1 ring-blue-400/40 flex-shrink-0" />}
            label="story ativo"
            blue
          />
        )}
      </div>
    </motion.div>
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [metaApps, setMetaApps] = useState<MetaAppInfo[]>([]);
  const [showAppModal, setShowAppModal] = useState(false);

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [tokenRefreshingId, setTokenRefreshingId] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const _togglingRef = useRef<string | null>(null);
  const _deletingRef = useRef<string | null>(null);
  const _refreshingRef = useRef<string | null>(null);
  const _tokenRefreshingRef = useRef<string | null>(null);
  const _autoRefreshDone = useRef(false);

  // Carrega lista de Meta Apps disponíveis
  useEffect(() => {
    fetch("/api/meta/apps")
      .then((r) => r.json())
      .then((d: { apps?: MetaAppInfo[] }) => setMetaApps(d.apps ?? []))
      .catch(() => setMetaApps([]));
  }, []);

  // Abre modal se há múltiplos apps, ou redireciona diretamente se há apenas 1
  const handleConnectClick = useCallback(() => {
    if (metaApps.length > 1) {
      setShowAppModal(true);
    } else {
      const appId = metaApps[0]?.id ?? "app1";
      window.location.href = `/api/instagram/auth?app_id=${appId}`;
    }
  }, [metaApps]);

  const handleAppSelect = useCallback((appId: string) => {
    setShowAppModal(false);
    window.location.href = `/api/instagram/auth?app_id=${appId}`;
  }, []);

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
      setNotification({
        type: "error",
        message: OAUTH_ERROR_MESSAGES[error] ?? "Ocorreu um erro ao conectar. Tente novamente.",
      });
      window.history.replaceState({}, "", "/dashboard/accounts");
    }
  }, []);

  const fetchAccounts = useCallback(async (): Promise<Account[]> => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("instagram_accounts")
        .select(
          "id, username, display_name, avatar_url, is_active, connected_at, followers_count, posts_count, last_post_at, has_active_stories, profile_refreshed_at, ig_business_account_id, token_expires_at"
        )
        .order("connected_at", { ascending: false });
      const fetched = (data ?? []) as unknown as Account[];
      setAccounts(fetched);
      return fetched;
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Auto-renova tokens expirando em < 7 dias na primeira carga da página
  useEffect(() => {
    fetchAccounts().then(async (fetched) => {
      if (_autoRefreshDone.current) return;
      _autoRefreshDone.current = true;

      const expiring = fetched.filter(
        (a) => a.ig_business_account_id && (daysUntilExpiry(a.token_expires_at) ?? 99) <= 7
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
  }, [fetchAccounts]);

  const handleRefresh = useCallback(async (id: string) => {
    if (_refreshingRef.current) return;
    _refreshingRef.current = id;
    setRefreshingId(id);
    try {
      const res = await fetch("/api/accounts/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: id }),
      });
      if (res.ok) await fetchAccounts();
    } finally {
      _refreshingRef.current = null;
      setRefreshingId(null);
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
    } finally {
      _deletingRef.current = null;
      setDeletingId(null);
    }
  };

  const active = accounts.filter(a => a.is_active).length;

  return (
    <div className="space-y-6">
      {/* Modal de seleção de app */}
      {showAppModal && (
        <AppSelectModal
          apps={metaApps}
          onSelect={handleAppSelect}
          onClose={() => setShowAppModal(false)}
        />
      )}

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
            <span className="flex-1">{notification.message}</span>
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
          <h1 className="text-xl font-bold text-white">Contas do Instagram</h1>
          <p className="text-sm text-white/35 mt-0.5">
            {accounts.length} conectada{accounts.length !== 1 ? "s" : ""} · {active} ativa{active !== 1 ? "s" : ""}
          </p>
        </div>
        <motion.button
          onClick={() => { handleConnectClick(); }}
          whileTap={{ scale: 0.97 }}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
        >
          <Plus size={15} />
          Conectar conta
        </motion.button>
      </motion.div>

      {/* Grid de contas */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <AccountSkeleton key={i} />)}
        </div>
      ) : accounts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card rounded-2xl flex flex-col items-center gap-4 py-20 text-center px-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            <Instagram size={24} className="text-white/20" />
          </div>
          <div className="space-y-1">
            <p className="text-white/40 text-sm font-medium">Nenhuma conta conectada</p>
            <p className="text-white/20 text-xs max-w-xs">
              Clique em &quot;Conectar conta&quot; e autorize via Instagram para adicionar sua primeira conta Business ou Creator.
            </p>
          </div>
          <motion.button
            onClick={() => { handleConnectClick(); }}
            whileTap={{ scale: 0.97 }}
            className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2"
          >
            <Plus size={14} /> Conectar primeira conta
          </motion.button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          <AnimatePresence>
            {accounts.map(account => (
              <AccountCard
                key={account.id}
                account={account}
                onRefresh={handleRefresh}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onRefreshToken={handleRefreshToken}
                refreshing={refreshingId === account.id}
                toggling={togglingId === account.id}
                deleting={deletingId === account.id}
                tokenRefreshing={tokenRefreshingId === account.id}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
