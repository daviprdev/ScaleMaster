"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useMemo } from "react";
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

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<ModalStep>("credentials");

  // Step 1 — credentials
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Step 2 — verification code
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [code, setCode] = useState("");

  // Shared
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  // Row actions
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Instância estável do cliente Supabase — sem useMemo causaria re-render infinito
  // pois createClient() retorna novo objeto a cada chamada
  const supabase = useMemo(() => createClient(), []);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("instagram_accounts")
        .select("id, username, display_name, avatar_url, is_active, connected_at")
        .order("connected_at", { ascending: false });
      setAccounts(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // ── Step 1: credenciais ───────────────────────────────────
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

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
      setConnecting(false);
    }
  };

  // ── Step 2: código de verificação ────────────────────────
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !challenge) return;

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
      setConnecting(false);
    }
  };

  const handleToggle = async (account: Account) => {
    if (togglingId) return;
    setTogglingId(account.id);
    try {
      await supabase
        .from("instagram_accounts")
        .update({ is_active: !account.is_active })
        .eq("id", account.id);
      setAccounts(prev =>
        prev.map(a => a.id === account.id ? { ...a, is_active: !a.is_active } : a)
      );
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await supabase.from("instagram_accounts").delete().eq("id", id);
      setAccounts(prev => prev.filter(a => a.id !== id));
    } finally {
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

  const active = accounts.filter(a => a.is_active).length;

  return (
    <div className="space-y-6">

      {/* Header */}
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

      {/* Account list */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="glass-card divide-y divide-white/[0.06]"
      >
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-white/25" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center">
              <Instagram size={22} className="text-white/20" />
            </div>
            <p className="text-white/30 text-sm">Nenhuma conta conectada ainda.</p>
            <button onClick={() => setShowModal(true)} className="btn-primary text-sm px-5 py-2">
              Conectar primeira conta
            </button>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {accounts.map(account => (
              <motion.div
                key={account.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-4 px-5 py-4"
              >
                {account.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={account.avatar_url}
                    alt={account.username}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className={cn(
                    "w-10 h-10 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0",
                    avatarColor(account.username)
                  )}>
                    <Instagram size={16} className="text-white" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white/85">@{account.username}</p>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                      account.is_active
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-white/[0.06] text-white/25"
                    )}>
                      {account.is_active ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                  <p className="text-xs text-white/30 truncate mt-0.5">
                    {account.display_name ?? "—"} · conectada em{" "}
                    {new Date(account.connected_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <motion.button
                    onClick={() => handleToggle(account)}
                    whileTap={{ scale: 0.9 }}
                    disabled={!!togglingId}
                    title={account.is_active ? "Desativar" : "Ativar"}
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50",
                      account.is_active
                        ? "text-emerald-400 hover:bg-emerald-500/10"
                        : "text-white/20 hover:bg-white/5 hover:text-white/50"
                    )}
                  >
                    {togglingId === account.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Power size={14} />}
                  </motion.button>

                  <motion.button
                    onClick={() => handleDelete(account.id)}
                    whileTap={{ scale: 0.9 }}
                    disabled={!!deletingId}
                    title="Remover conta"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white/20 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    {deletingId === account.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Trash2 size={14} />}
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </motion.div>

      {/* Modal — overlay cobre toda a viewport via flex centering */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            key="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            {/* Click-away */}
            <div className="absolute inset-0" onClick={closeModal} />

            {/* Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: "spring", bounce: 0.18, duration: 0.35 }}
              className="relative w-full max-w-md"
            >
              <div className="glass neon-border rounded-2xl p-6">
                <AnimatePresence mode="wait">

                  {/* ─── Step 1: credenciais ─── */}
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
                        <button onClick={closeModal} disabled={connecting} className="text-white/20 hover:text-white/60 transition-colors disabled:opacity-40">
                          <X size={18} />
                        </button>
                      </div>

                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-violet-600/10 border border-violet-500/20 mb-5">
                        <ShieldCheck size={14} className="text-violet-400 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] text-violet-300/80 leading-relaxed">
                          Suas credenciais são usadas apenas para autenticar via <strong>instagrapi</strong> localmente. A senha não é armazenada.
                        </p>
                      </div>

                      <form onSubmit={handleConnect} className="space-y-4">
                        <div>
                          <label className="text-xs font-semibold text-white/50 mb-1.5 block">Usuário do Instagram</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 text-sm">@</span>
                            <input
                              type="text"
                              value={username}
                              onChange={e => setUsername(e.target.value.replace(/^@/, ""))}
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
                              onChange={e => setPassword(e.target.value)}
                              placeholder="••••••••"
                              required disabled={connecting}
                              className="input-glass pr-10 w-full disabled:opacity-50"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(p => !p)}
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
                          <button type="submit" disabled={connecting || !username.trim() || !password.trim()}
                            className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-50">
                            {connecting
                              ? <><Loader2 size={14} className="animate-spin" /> Conectando...</>
                              : <><LogIn size={14} /> Conectar</>}
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}

                  {/* ─── Step 2: código de verificação ─── */}
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
                        <button onClick={closeModal} disabled={connecting} className="text-white/20 hover:text-white/60 transition-colors disabled:opacity-40">
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
                            onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, "").slice(0, 7))}
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
                          <button type="submit" disabled={connecting || code.replace(/\s/g, "").length < 6}
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
