"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  ExternalLink,
  X,
  Key,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
  no_ig_accounts:
    "Nenhuma conta Business ou Creator do Instagram foi encontrada vinculada a este Facebook. " +
    "Certifique-se de que sua conta IG está vinculada a uma Página do Facebook.",
  server_error: "Erro interno ao salvar a conta. Verifique o console e tente novamente.",
};

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
    <div
      className={cn(
        "flex items-center gap-1 whitespace-nowrap text-[11px] flex-shrink-0",
        blue ? "text-blue-400" : muted ? "text-white/20" : "text-white/45"
      )}
    >
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
  refreshing,
  toggling,
  deleting,
}: {
  account: Account;
  onRefresh: (id: string) => void;
  onToggle: (acc: Account) => void;
  onDelete: (id: string) => void;
  refreshing: boolean;
  toggling: boolean;
  deleting: boolean;
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
  const busy = refreshing || toggling || deleting;
  const isMetaConnected = !!account.ig_business_account_id;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="glass-card rounded-2xl"
    >
      <div className="flex items-start gap-3 p-5 pb-4">
        {account.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxyImg(account.avatar_url)}
            alt={account.username}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-2 ring-white/10"
          />
        ) : (
          <div className={cn("w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0 ring-2 ring-white/10", avatarColor(account.username))}>
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
            <span className={cn(
              "inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0",
              account.is_active ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.05] text-white/20"
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full", account.is_active ? "bg-emerald-400" : "bg-white/20")} />
              {account.is_active ? "ATIVA" : "INATIVA"}
            </span>
          </div>
        </div>

        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => !busy && setMenuOpen((o) => !o)}
            disabled={busy}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
          >
            {refreshing || deleting ? (
              <Loader2 size={13} className="animate-spin text-cyan-400" />
            ) : (
              <MoreHorizontal size={15} />
            )}
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
                <button onClick={() => { onRefresh(account.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors">
                  <RefreshCw size={12} className="text-cyan-400" /> Atualizar Dados
                </button>
                <button onClick={() => { onToggle(account); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors">
                  <Power size={12} className={account.is_active ? "text-amber-400" : "text-emerald-400"} />
                  {account.is_active ? "Desativar conta" : "Ativar conta"}
                </button>
                <div className="h-px bg-white/[0.06]" />
                <button onClick={() => { onDelete(account.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400/70 hover:bg-red-500/[0.08] hover:text-red-400 transition-colors">
                  <Trash2 size={12} /> Remover Conta
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="h-px bg-white/[0.05] mx-5" />

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
          <Metric icon={<span className="w-1.5 h-1.5 rounded-full inline-block bg-blue-400 ring-1 ring-blue-400/40 flex-shrink-0" />} label="story ativo" blue />
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
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Token manual
  const [rawToken, setRawToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const _togglingRef = useRef<string | null>(null);
  const _deletingRef = useRef<string | null>(null);
  const _refreshingRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      setNotification({ type: "success", message: `${connected} conta(s) conectada(s) via OAuth!` });
      window.history.replaceState({}, "", "/dashboard/accounts");
    } else if (error) {
      setNotification({ type: "error", message: OAUTH_ERROR_MESSAGES[error] ?? "Erro ao conectar." });
      window.history.replaceState({}, "", "/dashboard/accounts");
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, username, display_name, avatar_url, is_active, connected_at, followers_count, posts_count, last_post_at, has_active_stories, profile_refreshed_at, ig_business_account_id")
        .order("connected_at", { ascending: false });
      setAccounts((data ?? []) as unknown as Account[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleTokenConnect = async () => {
    if (!rawToken.trim() || connecting) return;
    setConnecting(true);
    setTokenError(null);
    try {
      const res = await fetch("/api/meta/connect-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: rawToken.trim() }),
      });
      const data = await res.json() as { success?: boolean; connected?: number; usernames?: string[]; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Erro ao conectar conta.");
      setRawToken("");
      setNotification({ type: "success", message: `${data.connected} conta(s) conectada(s): ${data.usernames?.map(u => "@" + u).join(", ")}` });
      await fetchAccounts();
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setConnecting(false);
    }
  };

  const handleRefresh = useCallback(async (id: string) => {
    if (_refreshingRef.current) return;
    _refreshingRef.current = id;
    setRefreshingId(id);
    try {
      const res = await fetch("/api/accounts/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: id }) });
      if (res.ok) await fetchAccounts();
    } finally {
      _refreshingRef.current = null;
      setRefreshingId(null);
    }
  }, [fetchAccounts]);

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

      {/* Banner de notificação */}
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
            {notification.type === "success" ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />}
            <span className="flex-1">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cabeçalho */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-white">Contas do Instagram</h1>
        <p className="text-sm text-white/35 mt-0.5">
          {accounts.length} conectada{accounts.length !== 1 ? "s" : ""} · {active} ativa{active !== 1 ? "s" : ""}
        </p>
      </motion.div>

      {/* Card de conexão via token */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass-card rounded-2xl p-5 space-y-4"
      >
        {/* Título do card */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/30 to-blue-500/30 border border-violet-500/20 flex items-center justify-center">
              <Key size={15} className="text-violet-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white/85">Adicionar conta</p>
              <p className="text-[11px] text-white/30">Cole um Access Token do Graph API Explorer</p>
            </div>
          </div>
          <a
            href="https://developers.facebook.com/tools/explorer/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
          >
            Abrir Explorer <ExternalLink size={11} />
          </a>
        </div>

        {/* Instruções rápidas */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <span className="text-[10px] text-white/35 leading-relaxed">
            No Graph API Explorer: selecione o app <strong className="text-white/50">AutoScale</strong> → clique em{" "}
            <strong className="text-white/50">Gerar token</strong> → marque{" "}
            <code className="text-violet-400/80 font-mono">instagram_basic</code>,{" "}
            <code className="text-violet-400/80 font-mono">instagram_content_publish</code>,{" "}
            <code className="text-violet-400/80 font-mono">pages_show_list</code> → copie e cole abaixo.
          </span>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <textarea
            value={rawToken}
            onChange={e => { setRawToken(e.target.value); setTokenError(null); }}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleTokenConnect(); }}
            placeholder="EAAxxxxxxxxxxxxxxx..."
            rows={2}
            className="w-full input-glass rounded-xl px-3.5 py-3 text-xs font-mono resize-none placeholder:text-white/15"
          />
          {tokenError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-[11px]"
            >
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              {tokenError}
            </motion.div>
          )}
        </div>

        {/* Botões */}
        <div className="flex items-center gap-3">
          <motion.button
            onClick={handleTokenConnect}
            disabled={!rawToken.trim() || connecting}
            whileTap={rawToken.trim() && !connecting ? { scale: 0.97 } : {}}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all",
              !rawToken.trim() || connecting
                ? "bg-white/5 border border-white/10 text-white/30 cursor-not-allowed"
                : "bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white hover:shadow-[0_0_18px_rgba(139,92,246,0.35)]"
            )}
          >
            {connecting ? (
              <><Loader2 size={14} className="animate-spin" /> Conectando...</>
            ) : (
              <><ChevronRight size={14} /> Conectar conta</>
            )}
          </motion.button>
          <span className="text-white/15 text-xs">ou</span>
          <button
            onClick={() => { window.location.href = "/api/meta/auth"; }}
            className="text-xs text-white/30 hover:text-white/55 transition-colors"
          >
            Usar fluxo OAuth →
          </button>
        </div>
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
          className="glass-card rounded-2xl flex flex-col items-center gap-3 py-16 text-center px-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            <Instagram size={24} className="text-white/20" />
          </div>
          <p className="text-white/30 text-sm">Nenhuma conta conectada ainda.</p>
          <p className="text-white/20 text-xs max-w-xs">Cole um Access Token do Graph API Explorer no campo acima para adicionar sua primeira conta.</p>
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
                refreshing={refreshingId === account.id}
                toggling={togglingId === account.id}
                deleting={deletingId === account.id}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
