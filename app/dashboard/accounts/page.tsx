"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
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

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  // Row actions
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const supabase = createClient();

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("instagram_accounts")
      .select("id, username, display_name, avatar_url, is_active, connected_at")
      .order("connected_at", { ascending: false });
    setAccounts(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

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

      const data = await res.json() as { success?: boolean; error?: string; warning?: string };

      if (!res.ok || !data.success) {
        setError(data.error ?? "Falha ao conectar a conta.");
        return;
      }

      setUsername("");
      setPassword("");
      setShowModal(false);
      fetchAccounts();
    } catch {
      setError("Erro de rede. Verifique sua conexão e tente novamente.");
    } finally {
      setConnecting(false);
    }
  };

  const handleToggle = async (account: Account) => {
    setTogglingId(account.id);
    await supabase
      .from("instagram_accounts")
      .update({ is_active: !account.is_active })
      .eq("id", account.id);
    setAccounts(prev =>
      prev.map(a => a.id === account.id ? { ...a, is_active: !a.is_active } : a)
    );
    setTogglingId(null);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await supabase.from("instagram_accounts").delete().eq("id", id);
    setAccounts(prev => prev.filter(a => a.id !== id));
    setDeletingId(null);
  };

  const closeModal = () => {
    if (connecting) return;
    setShowModal(false);
    setUsername("");
    setPassword("");
    setError("");
    setShowPassword(false);
  };

  const active = accounts.filter(a => a.is_active).length;

  return (
    <div className="max-w-3xl space-y-6">

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
                {/* Avatar */}
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

                {/* Info */}
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

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <motion.button
                    onClick={() => handleToggle(account)}
                    whileTap={{ scale: 0.9 }}
                    disabled={togglingId === account.id}
                    title={account.is_active ? "Desativar" : "Ativar"}
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
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
                    disabled={deletingId === account.id}
                    title="Remover conta"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white/20 hover:bg-red-500/10 hover:text-red-400 transition-colors"
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

      {/* Connect modal */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4"
            >
              <div className="glass neon-border rounded-2xl p-6">
                {/* Modal header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <LogIn size={18} className="text-violet-400" />
                    <h2 className="font-semibold text-white">Conectar conta do Instagram</h2>
                  </div>
                  <button onClick={closeModal} disabled={connecting} className="text-white/20 hover:text-white/60 transition-colors disabled:opacity-40">
                    <X size={18} />
                  </button>
                </div>

                {/* Security notice */}
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-violet-600/10 border border-violet-500/20 mb-5">
                  <ShieldCheck size={14} className="text-violet-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-violet-300/80 leading-relaxed">
                    Suas credenciais são usadas apenas para autenticar via <strong>instagrapi</strong> localmente. A senha não é armazenada.
                  </p>
                </div>

                <form onSubmit={handleConnect} className="space-y-4">
                  {/* Username */}
                  <div>
                    <label className="text-xs font-semibold text-white/50 mb-1.5 block">
                      Usuário do Instagram
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 text-sm">@</span>
                      <input
                        type="text"
                        value={username}
                        onChange={e => setUsername(e.target.value.replace(/^@/, ""))}
                        placeholder="seu_perfil"
                        required
                        autoFocus
                        disabled={connecting}
                        className="input-glass pl-7 w-full disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <label className="text-xs font-semibold text-white/50 mb-1.5 block">
                      Senha
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        disabled={connecting}
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

                  {/* Error */}
                  {error && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                      <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  {/* Loading hint */}
                  {connecting && (
                    <p className="text-[11px] text-white/30 text-center">
                      Conectando ao Instagram… pode levar até 30 segundos.
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={connecting}
                      className="btn-ghost flex-1 text-sm py-2.5 disabled:opacity-40"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={connecting || !username.trim() || !password.trim()}
                      className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {connecting
                        ? <><Loader2 size={14} className="animate-spin" /> Conectando...</>
                        : <><LogIn size={14} /> Conectar</>}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
