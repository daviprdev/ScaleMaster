"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Instagram,
  Plus,
  Trash2,
  Power,
  X,
  Loader2,
  LogIn,
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  KeyRound,
  ArrowLeft,
  Smartphone,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Users,
  FileText,
  Clock,
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

type ModalStep = "credentials" | "verify_code";
type ChallengeType = "2fa" | "checkpoint";
type VerificationMethod = "authenticator" | "sms" | "email";

interface PendingChallenge {
  challengeType: ChallengeType;
  verificationMethod: VerificationMethod;
  sessionToken: string;
  twoFactorIdentifier: string;
  username: string;
}

const METHOD_LABEL: Record<VerificationMethod, string> = {
  authenticator: "app autenticador (TOTP)",
  sms: "SMS no número cadastrado",
  email: "e-mail cadastrado",
};

const METHOD_ICON: Record<VerificationMethod, React.ReactNode> = {
  authenticator: <KeyRound size={14} />,
  sms: <Smartphone size={14} />,
  email: <Mail size={14} />,
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
    <div className={cn(
      "flex items-center gap-1 whitespace-nowrap text-[11px] flex-shrink-0",
      blue ? "text-blue-400" : muted ? "text-white/20" : "text-white/45"
    )}>
      <span className={cn(
        "flex-shrink-0",
        blue ? "text-blue-400" : muted ? "text-white/15" : "text-white/30"
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
          <div className={cn(
            "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0 ring-2 ring-white/10",
            avatarColor(account.username)
          )}>
            <Instagram size={20} className="text-white" />
          </div>
        )}

        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-bold text-white/90 truncate">@{account.username}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <Instagram size={9} className="text-pink-400 flex-shrink-0" />
            <span className="text-[10px] text-white/30">Instagram</span>
            <span className={cn(
              "inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0",
              account.is_active
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-white/[0.05] text-white/20"
            )}>
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                account.is_active ? "bg-emerald-400" : "bg-white/20"
              )} />
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
            {(refreshing || deleting) ? (
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
                  onClick={() => { onRefresh(account.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <RefreshCw size={12} className="text-cyan-400" />
                  Atualizar Dados
                </button>
                <button
                  onClick={() => { onToggle(account); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <Power size={12} className={account.is_active ? "text-amber-400" : "text-emerald-400"} />
                  {account.is_active ? "Desativar conta" : "Ativar conta"}
                </button>
                <div className="h-px bg-white/[0.06]" />
                <button
                  onClick={() => { onDelete(account.id); setMenuOpen(false); }}
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
            <span className={cn(
              "w-1.5 h-1.5 rounded-full inline-block flex-shrink-0",
              account.profile_refreshed_at ? "bg-emerald-400" : "bg-white/20"
            )} />
          }
          label={account.profile_refreshed_at
            ? `online ${timeAgo(account.profile_refreshed_at)}`
            : "não atualizado"}
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

// ── Página principal ──────────────────────────────────────────
export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<ModalStep>("credentials");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [code, setCode] = useState("");

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const _connectingRef = useRef(false);
  const _togglingRef = useRef<string | null>(null);
  const _deletingRef = useRef<string | null>(null);
  const _refreshingRef = useRef<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, username, display_name, avatar_url, is_active, connected_at, followers_count, posts_count, last_post_at, has_active_stories, profile_refreshed_at")
        .order("connected_at", { ascending: false });
      setAccounts((data ?? []) as unknown as Account[]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

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
    } catch (e) {
      console.error("[accounts/refresh]", e);
    } finally {
      _refreshingRef.current = null;
      setRefreshingId(null);
    }
  }, [fetchAccounts]);

  // ── Credenciais ───────────────────────────────────────────
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (_connectingRef.current || !username.trim() || !password.trim()) return;
    _connectingRef.current = true;
    setConnecting(true);
    setError("");

    try {
      const res = await fetch("/api/accounts/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json() as {
        success?: boolean;
        error?: string;
        requires_code?: boolean;
        challenge_type?: ChallengeType;
        verification_method?: VerificationMethod;
        session_token?: string;
        two_factor_identifier?: string;
        username?: string;
      };

      if (data.requires_code) {
        setChallenge({
          challengeType: data.challenge_type ?? "2fa",
          verificationMethod: data.verification_method ?? "authenticator",
          sessionToken: data.session_token ?? "",
          twoFactorIdentifier: data.two_factor_identifier ?? "",
          username: data.username ?? username.trim(),
        });
        setStep("verify_code");
        setError("");
        return;
      }

      if (!res.ok || !data.success) {
        setError(data.error ?? "Falha ao conectar a conta.");
        return;
      }

      resetAndClose();
      fetchAccounts();
    } catch {
      setError("Erro de rede. Verifique sua conexão e tente novamente.");
    } finally {
      _connectingRef.current = false;
      setConnecting(false);
    }
  };

  // ── Código de verificação ─────────────────────────────────
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (_connectingRef.current || !code.trim() || !challenge) return;
    _connectingRef.current = true;
    setConnecting(true);
    setError("");

    try {
      const res = await fetch("/api/accounts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: challenge.username,
          code: code.replace(/\s/g, ""),
          challenge_type: challenge.challengeType,
          session_token: challenge.sessionToken,
          two_factor_identifier: challenge.twoFactorIdentifier,
        }),
      });

      const data = await res.json() as { success?: boolean; error?: string };

      if (!res.ok || !data.success) {
        setError(data.error ?? "Código inválido. Tente novamente.");
        return;
      }

      resetAndClose();
      fetchAccounts();
    } catch {
      setError("Erro de rede. Verifique sua conexão e tente novamente.");
    } finally {
      _connectingRef.current = false;
      setConnecting(false);
    }
  };

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
        prev.map((a) => a.id === account.id ? { ...a, is_active: !a.is_active } : a)
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

  const resetAndClose = () => {
    setShowModal(false);
    setStep("credentials");
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setCode("");
    setError("");
    setChallenge(null);
  };

  const closeModal = () => { if (!connecting) resetAndClose(); };
  const backToCredentials = () => { setStep("credentials"); setCode(""); setError(""); };

  const active = accounts.filter((a) => a.is_active).length;

  return (
    <div className="space-y-6">

      {/* Cabeçalho da página */}
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
          onClick={() => setShowModal(true)}
          whileTap={{ scale: 0.97 }}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
        >
          <Plus size={15} />
          Conectar conta
        </motion.button>
      </motion.div>

      {/* Grid de cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <AccountSkeleton key={i} />)}
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
          <button onClick={() => setShowModal(true)} className="btn-primary text-sm px-5 py-2">
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

      {/* Modal de conexão */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            key="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          >
            <div className="absolute inset-0" onClick={closeModal} />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: "spring", bounce: 0.18, duration: 0.35 }}
              className="relative w-full max-w-md"
            >
              <div className="glass neon-border rounded-2xl p-6">
                <AnimatePresence mode="wait">

                  {/* Step 1 — credenciais */}
                  {step === "credentials" && (
                    <motion.div
                      key="step-credentials"
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <LogIn size={18} className="text-violet-400" />
                          <h2 className="font-semibold text-white">Conectar conta do Instagram</h2>
                        </div>
                        <button onClick={closeModal} disabled={connecting}
                          className="text-white/20 hover:text-white/60 transition-colors disabled:opacity-40">
                          <X size={18} />
                        </button>
                      </div>

                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-violet-600/10 border border-violet-500/20 mb-5">
                        <ShieldCheck size={14} className="text-violet-400 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] text-violet-300/80 leading-relaxed">
                          Suas credenciais são usadas apenas para autenticar via{" "}
                          <strong>instagrapi</strong> localmente. A senha não é armazenada.
                        </p>
                      </div>

                      <form onSubmit={handleConnect} className="space-y-4">
                        <div>
                          <label className="text-xs font-semibold text-white/50 mb-1.5 block">
                            Usuário do Instagram
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 text-sm">@</span>
                            <input
                              type="text"
                              value={username}
                              onChange={(e) => setUsername(e.target.value.replace(/^@/, ""))}
                              placeholder="seu_perfil"
                              required autoFocus disabled={connecting}
                              className="input-glass pl-7 w-full disabled:opacity-50"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-white/50 mb-1.5 block">Senha</label>
                          <div className="relative">
                            <input
                              type={showPassword ? "text" : "password"}
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="••••••••"
                              required disabled={connecting}
                              className="input-glass pr-10 w-full disabled:opacity-50"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((p) => !p)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors"
                            >
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                        </div>

                        {error && (
                          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                            {error}
                          </div>
                        )}

                        {connecting && (
                          <p className="text-[11px] text-white/30 text-center">
                            Conectando ao Instagram… pode levar até 30 segundos.
                          </p>
                        )}

                        <div className="flex gap-3 pt-1">
                          <button type="button" onClick={closeModal} disabled={connecting}
                            className="btn-ghost flex-1 text-sm py-2.5 disabled:opacity-40">
                            Cancelar
                          </button>
                          <button type="submit"
                            disabled={connecting || !username.trim() || !password.trim()}
                            className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-50">
                            {connecting
                              ? <><Loader2 size={14} className="animate-spin" /> Conectando...</>
                              : <><LogIn size={14} /> Conectar</>}
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}

                  {/* Step 2 — código de verificação */}
                  {step === "verify_code" && challenge && (
                    <motion.div
                      key="step-verify"
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {METHOD_ICON[challenge.verificationMethod]}
                          <h2 className="font-semibold text-white">Verificação de segurança</h2>
                        </div>
                        <button onClick={closeModal} disabled={connecting}
                          className="text-white/20 hover:text-white/60 transition-colors disabled:opacity-40">
                          <X size={18} />
                        </button>
                      </div>

                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-violet-600/10 border border-violet-500/20 mb-5">
                        <ShieldCheck size={14} className="text-violet-400 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] text-violet-300/80 leading-relaxed">
                          O Instagram solicitou verificação para{" "}
                          <strong>@{challenge.username}</strong>. Digite o código de 6 dígitos enviado via{" "}
                          <strong>{METHOD_LABEL[challenge.verificationMethod]}</strong>.
                        </p>
                      </div>

                      <form onSubmit={handleVerifyCode} className="space-y-4">
                        <div>
                          <label className="text-xs font-semibold text-white/50 mb-1.5 block">
                            Código de verificação
                          </label>
                          <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, "").slice(0, 7))}
                            placeholder="000 000"
                            required autoFocus disabled={connecting}
                            maxLength={7}
                            inputMode="numeric"
                            className="input-glass w-full text-center text-lg tracking-[0.3em] disabled:opacity-50"
                          />
                        </div>

                        {error && (
                          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                            {error}
                          </div>
                        )}

                        {connecting && (
                          <p className="text-[11px] text-white/30 text-center">Verificando código…</p>
                        )}

                        <div className="flex gap-3 pt-1">
                          <button type="button" onClick={backToCredentials} disabled={connecting}
                            className="btn-ghost flex items-center justify-center gap-1.5 px-4 text-sm py-2.5 disabled:opacity-40">
                            <ArrowLeft size={13} /> Voltar
                          </button>
                          <button type="submit"
                            disabled={connecting || code.replace(/\s/g, "").length < 6}
                            className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-50">
                            {connecting
                              ? <><Loader2 size={14} className="animate-spin" /> Verificando...</>
                              : <><KeyRound size={14} /> Confirmar</>}
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
