"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock, Plus, Eye, EyeOff, Copy, Check,
  Pencil, Trash2, X, KeyRound, Mail, User,
  Shield, AlertTriangle, RefreshCw, ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────
type Login = {
  id: string;
  profile_name: string;
  username: string;
  password_hash: string;
  recovery_email: string | null;
  two_factor_key: string | null;
  created_at: string;
  updated_at: string;
};

type FormData = {
  profile_name: string;
  username: string;
  password_hash: string;
  recovery_email: string;
  two_factor_key: string;
};

const EMPTY_FORM: FormData = {
  profile_name: "",
  username: "",
  password_hash: "",
  recovery_email: "",
  two_factor_key: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", year: "2-digit",
  });
}

function useCopyFeedback() {
  const [key, setKey] = useState<string | null>(null);
  const copy = useCallback(async (text: string, k: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setKey(k);
      setTimeout(() => setKey(null), 2200);
    } catch { /* noop */ }
  }, []);
  return { copiedKey: key, copy };
}

// ─── SecretField — row with reveal + copy ─────────────────────────────────
function SecretField({
  label, value, icon: Icon, fieldKey, copiedKey, revealed, onReveal, onCopy,
}: {
  label: string; value: string; icon: React.ElementType;
  fieldKey: string; copiedKey: string | null;
  revealed: boolean; onReveal: () => void; onCopy: () => void;
}) {
  const isCopied = copiedKey === fieldKey;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon size={12} className="text-white/25 flex-shrink-0" />
      <span className="text-[11px] text-white/35 w-10 flex-shrink-0 leading-none">{label}</span>
      <span
        className="text-[13px] font-mono flex-1 text-white/65 truncate"
        style={{ letterSpacing: revealed ? "normal" : "0.12em" }}
      >
        {revealed ? value : "•".repeat(Math.min(value.length, 14))}
      </span>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={onReveal}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
          style={{ color: revealed ? "var(--matrix)" : "rgba(255,255,255,0.28)" }}
          title={revealed ? "Ocultar" : "Revelar"}
        >
          {revealed ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
        <button
          onClick={onCopy}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-all"
          style={{
            color: isCopied ? "var(--matrix)" : "rgba(255,255,255,0.28)",
            background: isCopied ? "rgba(0,255,65,0.1)" : "transparent",
          }}
          title="Copiar"
        >
          {isCopied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
    </div>
  );
}

// ─── LoginCard ─────────────────────────────────────────────────────────────
function LoginCard({
  login, onEdit, onDelete,
}: {
  login: Login;
  onEdit: (l: Login) => void;
  onDelete: (id: string) => void;
}) {
  const [revPw,  setRevPw]  = useState(false);
  const [revTfa, setRevTfa] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const { copiedKey, copy } = useCopyFeedback();

  const startDelete = useCallback(() => {
    if (confirmDel) {
      onDelete(login.id);
    } else {
      setConfirmDel(true);
      setTimeout(() => setConfirmDel(false), 3500);
    }
  }, [confirmDel, login.id, onDelete]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.22 }}
      className="glass-card ticks flex flex-col gap-4 p-5"
      style={{ position: "relative" }}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: "rgba(0,255,65,0.07)",
              border: "0.5px solid rgba(0,255,65,0.28)",
              boxShadow: "0 0 10px rgba(0,255,65,0.08)",
            }}
          >
            <Lock size={14} style={{ color: "var(--matrix)" }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/90 leading-tight truncate">
              {login.profile_name}
            </p>
            <p className="text-[10px] text-white/28 leading-tight mt-0.5">
              {fmtDate(login.updated_at)}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => onEdit(login)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ color: "rgba(0,229,255,0.45)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--electric)";
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,229,255,0.08)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(0,229,255,0.45)";
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
            title="Editar"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={startDelete}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all text-[11px] font-bold"
            style={{
              color: confirmDel ? "rgb(248 113 113)" : "rgba(255,255,255,0.22)",
              background: confirmDel ? "rgba(239,68,68,0.1)" : "transparent",
              border: confirmDel ? "0.5px solid rgba(239,68,68,0.3)" : "0.5px solid transparent",
            }}
            title={confirmDel ? "Clique para confirmar" : "Excluir"}
          >
            {confirmDel ? <Check size={12} /> : <Trash2 size={12} />}
          </button>
        </div>
      </div>

      {/* Hairline divider */}
      <div style={{ height: "0.5px", background: "rgba(255,255,255,0.06)" }} />

      {/* Credential fields */}
      <div className="space-y-2.5 min-w-0">
        {/* Username */}
        <div className="flex items-center gap-2 min-w-0">
          <User size={12} className="text-white/25 flex-shrink-0" />
          <span className="text-[11px] text-white/35 w-10 flex-shrink-0">Login</span>
          <span className="text-[13px] text-white/70 flex-1 truncate">{login.username}</span>
          <button
            onClick={() => copy(login.username, `u-${login.id}`)}
            className="w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center transition-all"
            style={{
              color: copiedKey === `u-${login.id}` ? "var(--matrix)" : "rgba(255,255,255,0.25)",
              background: copiedKey === `u-${login.id}` ? "rgba(0,255,65,0.1)" : "transparent",
            }}
            title="Copiar"
          >
            {copiedKey === `u-${login.id}` ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>

        {/* Password */}
        <SecretField
          label="Senha"
          value={login.password_hash}
          icon={KeyRound}
          fieldKey={`pw-${login.id}`}
          copiedKey={copiedKey}
          revealed={revPw}
          onReveal={() => setRevPw((v) => !v)}
          onCopy={() => copy(login.password_hash, `pw-${login.id}`)}
        />

        {/* Recovery email */}
        {login.recovery_email && (
          <div className="flex items-center gap-2 min-w-0">
            <Mail size={12} className="text-white/25 flex-shrink-0" />
            <span className="text-[11px] text-white/35 w-10 flex-shrink-0">Email</span>
            <span className="text-[13px] text-white/70 flex-1 truncate">
              {login.recovery_email}
            </span>
            <button
              onClick={() => copy(login.recovery_email!, `em-${login.id}`)}
              className="w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center transition-all"
              style={{
                color: copiedKey === `em-${login.id}` ? "var(--matrix)" : "rgba(255,255,255,0.25)",
                background: copiedKey === `em-${login.id}` ? "rgba(0,255,65,0.1)" : "transparent",
              }}
              title="Copiar email"
            >
              {copiedKey === `em-${login.id}` ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>
        )}

        {/* 2FA key */}
        {login.two_factor_key && (
          <SecretField
            label="2FA"
            value={login.two_factor_key}
            icon={Shield}
            fieldKey={`tfa-${login.id}`}
            copiedKey={copiedKey}
            revealed={revTfa}
            onReveal={() => setRevTfa((v) => !v)}
            onCopy={() => copy(login.two_factor_key!, `tfa-${login.id}`)}
          />
        )}
      </div>
    </motion.div>
  );
}

// ─── Field input with label ─────────────────────────────────────────────────
function FormField({
  label, id, required, type = "text", placeholder, value, onChange, icon: Icon,
}: {
  label: string; id: string; required?: boolean; type?: string;
  placeholder?: string; value: string;
  onChange: (v: string) => void; icon?: React.ElementType;
}) {
  const [showPw, setShowPw] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold text-white/50 uppercase tracking-widest">
        {label}{required && <span className="text-matrix ml-0.5">*</span>}
      </label>
      <div className="relative">
        {Icon && (
          <Icon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
        )}
        <input
          id={id}
          type={isPassword ? (showPw ? "text" : "password") : type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete="off"
          className="input-glass"
          style={{
            paddingLeft: Icon ? "2.25rem" : undefined,
            paddingRight: isPassword ? "2.5rem" : undefined,
            fontFamily: isPassword && !showPw ? "monospace" : undefined,
            letterSpacing: isPassword && !showPw ? "0.12em" : undefined,
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
          >
            {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────
function LoginModal({
  editing, onClose, onSave, saving, formError,
}: {
  editing: Login | null;
  onClose: () => void;
  onSave: (data: FormData) => Promise<void>;
  saving: boolean;
  formError: string | null;
}) {
  const [form, setForm] = useState<FormData>(
    editing
      ? {
          profile_name: editing.profile_name,
          username: editing.username,
          password_hash: editing.password_hash,
          recovery_email: editing.recovery_email ?? "",
          two_factor_key: editing.two_factor_key ?? "",
        }
      : EMPTY_FORM,
  );

  const set = (k: keyof FormData) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <AnimatePresence>
      <motion.div
        key="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "1rem",
        }}
        onClick={onClose}
      >
        <motion.div
          key="modal-content"
          initial={{ opacity: 0, scale: 0.94, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 18 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
          className="glass ticks w-full"
          style={{ maxWidth: 480 }}
        >
          {/* Modal header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{
                  background: "rgba(0,255,65,0.08)",
                  border: "0.5px solid rgba(0,255,65,0.3)",
                }}
              >
                <Lock size={14} style={{ color: "var(--matrix)" }} />
              </div>
              <div>
                <p className="text-sm font-bold text-white">
                  {editing ? "Editar Login" : "Novo Login"}
                </p>
                <p className="text-[11px] text-white/35 leading-tight">
                  Credencial protegida por RLS
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/30
                hover:text-white hover:bg-white/[0.06] transition-all"
            >
              <X size={15} />
            </button>
          </div>

          <div style={{ height: "0.5px", background: "rgba(255,255,255,0.07)" }} />

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <FormField
              id="profile_name" label="Nome do Perfil" required
              placeholder="Ex: @minhaconta ou 'Conta Pessoal'"
              value={form.profile_name} onChange={set("profile_name")}
              icon={User}
            />
            <FormField
              id="username" label="Usuário / Email de Login" required
              placeholder="username ou email"
              value={form.username} onChange={set("username")}
              icon={User}
            />
            <FormField
              id="password_hash" label="Senha" required type="password"
              placeholder="••••••••••••"
              value={form.password_hash} onChange={set("password_hash")}
              icon={KeyRound}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                id="recovery_email" label="Email de Recuperação"
                placeholder="backup@exemplo.com"
                value={form.recovery_email} onChange={set("recovery_email")}
                icon={Mail}
              />
              <FormField
                id="two_factor_key" label="Chave 2FA / TOTP"
                placeholder="JBSWY3DPEHPK3PXP"
                value={form.two_factor_key} onChange={set("two_factor_key")}
                icon={Shield}
              />
            </div>

            {formError && (
              <div
                className="flex items-center gap-2 text-[12px] text-red-400 rounded-xl px-3 py-2.5"
                style={{ background: "rgba(239,68,68,0.07)", border: "0.5px solid rgba(239,68,68,0.2)" }}
              >
                <AlertTriangle size={13} className="flex-shrink-0" />
                {formError}
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost flex-1 py-2.5 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary flex-1 py-2.5 text-sm"
              >
                {saving ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  editing ? "Salvar Alterações" : "Adicionar Login"
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────
function EmptyVault({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
        style={{
          background: "rgba(0,255,65,0.05)",
          border: "0.5px solid rgba(0,255,65,0.18)",
          boxShadow: "0 0 30px rgba(0,255,65,0.06)",
        }}
      >
        <Lock size={32} style={{ color: "var(--matrix)", opacity: 0.6 }} />
      </div>
      <h3 className="text-base font-bold text-white/70 mb-1.5">Cofre vazio</h3>
      <p className="text-sm text-white/30 max-w-xs mb-8">
        Adicione credenciais ao cofre para acessá-las com rapidez e segurança.
      </p>
      <button onClick={onAdd} className="btn-primary gap-2">
        <Plus size={15} />
        Adicionar Primeiro Login
      </button>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function LoginsPage() {
  const [logins, setLogins]         = useState<Login[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [showModal, setShowModal]   = useState(false);
  const [editing, setEditing]       = useState<Login | null>(null);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [notice, setNotice]         = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/logins");
      if (!res.ok) throw new Error((await res.json()).error ?? "Erro ao carregar");
      const { logins: data } = await res.json();
      setLogins(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    setFormError(null);
    setShowModal(true);
  };
  const openEdit = (l: Login) => {
    setEditing(l);
    setFormError(null);
    setShowModal(true);
  };
  const closeModal = () => {
    if (!saving) setShowModal(false);
  };

  const handleSave = async (form: FormData) => {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/logins", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...form } : form),
      });
      if (!res.ok) {
        const { error: msg } = await res.json();
        setFormError(msg ?? "Erro ao salvar");
        return;
      }
      setShowModal(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/logins?id=${id}`, { method: "DELETE" });
      setLogins((prev) => prev.filter((l) => l.id !== id));
    } catch { /* noop */ }
  };

  return (
    <div className="space-y-6">
      {/* Security notice */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-start gap-3 rounded-2xl px-4 py-3.5"
            style={{
              background: "rgba(0,255,65,0.04)",
              border: "0.5px solid rgba(0,255,65,0.18)",
            }}
          >
            <Shield size={15} className="flex-shrink-0 mt-0.5" style={{ color: "var(--matrix)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white/70">
                Cofre protegido por Row Level Security
              </p>
              <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">
                Apenas você pode ver, inserir ou modificar estas credenciais.
                A política RLS bloqueia qualquer acesso externo no nível do banco de dados.
              </p>
            </div>
            <button
              onClick={() => setNotice(false)}
              className="text-white/25 hover:text-white/60 transition-colors flex-shrink-0 mt-0.5"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Page actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-white/30">
          <span className="text-sm">
            {loading ? "Carregando…" : `${logins.length} credential${logins.length !== 1 ? "s" : ""} no cofre`}
          </span>
          {!loading && (
            <button
              onClick={load}
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:text-white/60 transition-colors"
              title="Atualizar"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
        <button onClick={openAdd} className="btn-primary gap-2">
          <Plus size={14} />
          <span>Adicionar Login</span>
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
          style={{
            background: "rgba(239,68,68,0.06)",
            border: "0.5px solid rgba(239,68,68,0.2)",
          }}
        >
          <AlertTriangle size={15} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400 flex-1">{error}</p>
          <button onClick={load} className="text-[12px] text-white/40 hover:text-white/70 transition-colors">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="glass-card h-52 animate-pulse"
              style={{ animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && logins.length === 0 && (
        <EmptyVault onAdd={openAdd} />
      )}

      {/* Grid */}
      {!loading && logins.length > 0 && (
        <motion.div
          layout
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          <AnimatePresence mode="popLayout">
            {logins.map((login) => (
              <LoginCard
                key={login.id}
                login={login}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Stats footer */}
      {!loading && logins.length > 0 && (
        <div
          className="flex items-center justify-between text-[11px] text-white/20 rounded-xl px-4 py-2.5"
          style={{ border: "0.5px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)" }}
        >
          <div className="flex items-center gap-1.5">
            <Lock size={10} />
            <span>{logins.length} logins armazenados</span>
          </div>
          <div className="flex items-center gap-1 text-white/15">
            <Shield size={10} />
            <span>RLS ativo</span>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <LoginModal
          editing={editing}
          onClose={closeModal}
          onSave={handleSave}
          saving={saving}
          formError={formError}
        />
      )}
    </div>
  );
}
