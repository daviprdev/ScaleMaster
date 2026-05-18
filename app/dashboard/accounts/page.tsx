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
  ExternalLink,
  X,
  Key,
  Copy,
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
      <span
        className={cn(
          "flex-shrink-0",
          blue ? "text-blue-400" : muted ? "text-white/15" : "text-white/30"
        )}
      >
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
      {/* ── Cabeçalho ── */}
      <div className="flex items-start gap-3 p-5 pb-4">
        {account.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxyImg(account.avatar_url)}
            alt={account.username}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-2 ring-white/10"
          />
        ) : (
          <div
            className={cn(
              "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0 ring-2 ring-white/10",
              avatarColor(account.username)
            )}
          >
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
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0",
                account.is_active
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-white/[0.05] text-white/20"
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  account.is_active ? "bg-emerald-400" : "bg-white/20"
                )}
              />
              {account.is_active ? "ATIVA" : "INATIVA"}
            </span>
          </div>
        </div>

        {/* Menu três pontos */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => !busy && setMenuOpen((o) => !o)}
            disabled={busy}
            title="Opções"
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
                <button
                  onClick={() => {
                    onRefresh(account.id);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <RefreshCw size={12} className="text-cyan-400" />
                  Atualizar Dados
                </button>
                <button
                  onClick={() => {
                    onToggle(account);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <Power
                    size={12}
                    className={account.is_active ? "text-amber-400" : "text-emerald-400"}
                  />
                  {account.is_active ? "Desativar conta" : "Ativar conta"}
                </button>
                <div className="h-px bg-white/[0.06]" />
                <button
                  onClick={() => {
                    onDelete(account.id);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400/70 hover:bg-red-500/[0.08] hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                  Remover Conta
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Divisor ── */}
      <div className="h-px bg-white/[0.05] mx-5" />

      {/* ── Métricas ── */}
      <div className="flex items-center gap-3.5 px-5 py-3 overflow-x-auto">
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
                "w-1.5 h-1.5 rounded-full inline-block flex-shrink-0",
                account.profile_refreshed_at ? "bg-emerald-400" : "bg-white/20"
              )}
            />
          }
          label={
            account.profile_refreshed_at
              ? `online ${timeAgo(account.profile_refreshed_at)}`
              : "não atualizado"
          }
          muted={!account.profile_refreshed_at}
        />
        {account.has_active_stories === true && (
          <Metric
            icon={
              <span className="w-1.5 h-1.5 rounded-full inline-block bg-blue-400 ring-1 ring-blue-400/40 flex-shrink-0" />
            }
            label="story ativo"
            blue
          />
        )}
      </div>
    </motion.div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────
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

// ── Modal: conectar com Access Token ─────────────────────────
function TokenConnectModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (n: number) => void }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!token.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/connect-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token.trim() }),
      });
      const data = await res.json() as { success?: boolean; connected?: number; usernames?: string[]; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Erro ao conectar conta.");
      onSuccess(data.connected ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  };

  const EXPLORER_URL =
    "https://developers.facebook.com/tools/explorer/?method=GET&path=me%2Faccounts&version=v19.0";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="glass w-full max-w-lg rounded-2xl border border-white/[0.08] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
              <Key size={13} className="text-white" />
            </div>
            <p className="text-sm font-semibold text-white/85">Conectar com Access Token</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] flex items-center justify-center text-white/40 hover:text-white/70 transition-all">
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Passos */}
          <div className="space-y-2.5">
            {[
              {
                n: 1,
                text: "Abra o Graph API Explorer",
                action: (
                  <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors">
                    abrir <ExternalLink size={10} />
                  </a>
                ),
              },
              {
                n: 2,
                text: 'Selecione o app "AutoScale" no menu superior direito',
              },
              {
                n: 3,
                text: 'Clique em "Gerar token de acesso" e marque as permissões:',
                extra: (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"].map(p => (
                      <span key={p} className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.09] text-[10px] font-mono text-white/50">
                        {p}
                      </span>
                    ))}
                  </div>
                ),
              },
              { n: 4, text: "Copie o token gerado e cole no campo abaixo" },
            ].map(({ n, text, action, extra }) => (
              <div key={n} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {n}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/60 leading-relaxed">
                    {text} {action}
                  </p>
                  {extra}
                </div>
              </div>
            ))}
          </div>

          {/* Input do token */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">
              Access Token
            </label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxx..."
              rows={3}
              className="w-full input-glass rounded-xl px-3.5 py-3 text-xs font-mono resize-none placeholder:text-white/20"
            />
          </div>

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/8 border border-red-500/15 text-red-400 text-xs">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-2.5 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white/70 text-sm font-medium transition-all">
              Cancelar
            </button>
            <motion.button
              onClick={handleConnect}
              disabled={!token.trim() || loading}
              whileTap={token.trim() && !loading ? { scale: 0.97 } : {}}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all",
                !token.trim() || loading
                  ? "bg-white/5 border border-white/10 text-white/30 cursor-not-allowed"
                  : "bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white"
              )}
            >
              {loading ? <><Loader2 size={14} className="animate-spin" /> Conectando...</> : <><ChevronRight size={14} /> Conectar</>}
            </motion.button>
          </div>
        </div>
      </motion.div>
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
  const [tokenModalOpen, setTokenModalOpen] = useState(false);

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const _togglingRef = useRef<string | null>(null);
  const _deletingRef = useRef<string | null>(null);
  const _refreshingRef = useRef<string | null>(null);

  // Processa parâmetros de retorno do OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected) {
      const count = parseInt(connected, 10);
      setNotification({
        type: "success",
        message: `${count} conta${count !== 1 ? "s" : ""} conectada${count !== 1 ? "s" : ""} com sucesso via Meta Graph API!`,
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

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("instagram_accounts")
        .select(
          "id, username, display_name, avatar_url, is_active, connected_at, followers_count, posts_count, last_post_at, has_active_stories, profile_refreshed_at, ig_business_account_id"
        )
        .order("connected_at", { ascending: false });
      setAccounts((data ?? []) as unknown as Account[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleRefresh = useCallback(
    async (id: string) => {
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
      } catch (e) {
        console.error("[accounts/refresh]", e);
      } finally {
        _refreshingRef.current = null;
        setRefreshingId(null);
      }
    },
    [fetchAccounts]
  );

  const handleToggle = async (account: Account) => {
    if (_togglingRef.current) return;
    _togglingRef.current = account.id;
    setTogglingId(account.id);
    try {
      await supabase
        .from("instagram_accounts")
        .update({ is_active: !account.is_active })
        .eq("id", account.id);
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, is_active: !a.is_active } : a))
      );
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
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } finally {
      _deletingRef.current = null;
      setDeletingId(null);
    }
  };

  const active = accounts.filter((a) => a.is_active).length;

  return (
    <div className="space-y-6">

      {/* Modal de token manual */}
      <AnimatePresence>
        {tokenModalOpen && (
          <TokenConnectModal
            key="token-modal"
            onClose={() => setTokenModalOpen(false)}
            onSuccess={(n) => {
              setTokenModalOpen(false);
              setNotification({ type: "success", message: `${n} conta${n !== 1 ? "s" : ""} conectada${n !== 1 ? "s" : ""} com sucesso!` });
              fetchAccounts();
            }}
          />
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
            {notification.type === "success" ? (
              <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            )}
            <span className="flex-1">{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cabeçalho da página */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-xl font-bold text-white">Contas do Instagram</h1>
          <p className="text-sm text-white/35 mt-0.5">
            {accounts.length} conectada{accounts.length !== 1 ? "s" : ""} · {active} ativa
            {active !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTokenModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white/70 hover:bg-white/[0.07] text-xs font-medium transition-all"
          >
            <Key size={13} />
            Token manual
          </button>
          <motion.button
            onClick={() => { window.location.href = "/api/meta/auth"; }}
            whileTap={{ scale: 0.97 }}
            className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
          >
            <Plus size={15} />
            Conectar conta
          </motion.button>
        </div>
      </motion.div>

      {/* Banner informativo — Meta Graph API */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
        className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-blue-500/[0.07] border border-blue-500/20"
      >
        <div className="w-7 h-7 rounded-lg bg-blue-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-blue-400 font-bold text-sm leading-none">f</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-blue-200/80 leading-relaxed">
            <strong className="text-blue-200">Conexão oficial via Meta Graph API.</strong>{" "}
            Conecte contas <strong>Business</strong> ou <strong>Creator</strong> do Instagram
            vinculadas a uma Página do Facebook. O fluxo é 100% OAuth — nenhuma senha é armazenada.
          </p>
        </div>
        <a
          href="https://developers.facebook.com/docs/instagram-api/"
          target="_blank"
          rel="noopener noreferrer"
          title="Documentação da Meta Graph API"
          className="flex-shrink-0 text-blue-400/50 hover:text-blue-300 transition-colors mt-1"
        >
          <ExternalLink size={12} />
        </a>
      </motion.div>

      {/* Grid de cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <AccountSkeleton key={i} />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card rounded-2xl flex flex-col items-center gap-3 py-20 text-center px-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            <Instagram size={24} className="text-white/20" />
          </div>
          <p className="text-white/30 text-sm">Nenhuma conta conectada ainda.</p>
          <button
            onClick={() => { window.location.href = "/api/meta/auth"; }}
            className="btn-primary text-sm px-5 py-2"
          >
            Conectar primeira conta
          </button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          <AnimatePresence>
            {accounts.map((account) => (
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
