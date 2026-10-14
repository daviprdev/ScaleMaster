"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  BookUser,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Globe,
  ShieldCheck,
  KeyRound,
  RefreshCw,
  X,
  Users,
} from "lucide-react";

interface ReaderAccount {
  id: string;
  username: string;
  ig_user_id: string | null;
  full_name: string | null;
  followers_count: number | null;
  media_count: number | null;
  status: "unverified" | "online" | "error";
  last_error: string | null;
  last_login_at: string | null;
  last_scrape_at: string | null;
  created_at: string;
  has_proxy: boolean;
  has_totp: boolean;
  verifying: boolean;
  verify_error: string | null;
  verify_retry_at: string | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "nunca";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

const STATUS_META: Record<ReaderAccount["status"], { label: string; color: string; dot: string }> = {
  online:     { label: "Conectada",     color: "rgba(0,73,141,0.9)",  dot: "#00498D" },
  error:      { label: "Erro",          color: "rgba(255,100,90,0.9)", dot: "#FF3B30" },
  unverified: { label: "Não conectada", color: "rgba(255,255,255,0.4)", dot: "#888" },
};

export default function ContasLeitorasPage() {
  const [accounts, setAccounts] = useState<ReaderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", totp_secret: "", proxy: "" });
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ password: "", totp_secret: "", proxy: "" });
  const [editSaving, setEditSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const _firstLoad = useRef(false);

  const load = useCallback(async () => {
    if (!_firstLoad.current) setLoading(true);
    try {
      const res = await fetch("/api/reader-accounts", { cache: "no-store" });
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch {
      /* mantém o estado anterior */
    } finally {
      _firstLoad.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh enquanto alguma conta está verificando.
  useEffect(() => {
    if (!accounts.some((a) => a.verifying)) return;
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [accounts, load]);

  const handleAdd = async () => {
    if (saving) return;
    if (!form.username.trim() || !form.password.trim()) {
      setError("Usuário e senha são obrigatórios.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/reader-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao adicionar.");
      setForm({ username: "", password: "", totp_secret: "", proxy: "" });
      setShowAdd(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro desconhecido.");
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async (id: string) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, verifying: true } : a)));
    try {
      const res = await fetch(`/api/reader-accounts/${id}/verify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha ao conectar.");
        setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, verifying: false } : a)));
      }
    } catch {
      setError("Erro de rede ao conectar.");
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, verifying: false } : a)));
    }
  };

  const handleDelete = async (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    setConfirmDelete(null);
    try {
      await fetch(`/api/reader-accounts?id=${id}`, { method: "DELETE" });
    } catch {
      load();
    }
  };

  const openEdit = (a: ReaderAccount) => {
    setEditId(a.id);
    setEditForm({ password: "", totp_secret: "", proxy: "" });
  };

  const handleEditSave = async () => {
    if (!editId || editSaving) return;
    const payload: Record<string, string> = {};
    if (editForm.password.trim()) payload.password = editForm.password.trim();
    if (editForm.totp_secret.trim()) payload.totp_secret = editForm.totp_secret.trim();
    if (editForm.proxy.trim()) payload.proxy = editForm.proxy.trim();
    if (Object.keys(payload).length === 0) { setEditId(null); return; }

    setEditSaving(true);
    try {
      const res = await fetch("/api/reader-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar.");
      setEditId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, rgba(0,73,141,0.15), rgba(133,185,233,0.1))", border: "0.5px solid rgba(0,73,141,0.25)", boxShadow: "0 0 18px rgba(0,73,141,0.12)" }}>
            <BookUser size={18} className="text-brand-blue" />
          </div>
          <div>
            <h1 className="page-title">Contas Leitoras</h1>
            <p className="page-subtitle">Contas dedicadas à raspagem de conteúdo — isoladas das contas de postagem.</p>
          </div>
        </div>
        <motion.button
          onClick={() => setShowAdd((v) => !v)}
          whileTap={{ scale: 0.96 }}
          className="btn-primary px-4 py-2.5 rounded-xl flex-shrink-0"
        >
          <Plus size={15} />Nova conta leitora
        </motion.button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
        style={{ background: "rgba(133,185,233,0.05)", border: "0.5px solid rgba(133,185,233,0.12)" }}>
        <ShieldCheck size={15} style={{ color: "var(--electric)" }} className="flex-shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed" style={{ color: "rgba(133,185,233,0.7)" }}>
          Estas contas só <strong>leem</strong> conteúdo (raspam reels de perfis) e nunca postam.
          Cada uma precisa de um <strong>proxy dedicado</strong> para operar. Perfis privados só são
          acessíveis se a conta leitora já os seguir de verdade.
        </p>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
            style={{ background: "rgba(255,59,48,0.08)", border: "0.5px solid rgba(255,59,48,0.2)", color: "rgba(255,100,90,0.9)" }}
          >
            <AlertCircle size={15} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="hover:text-ink-2">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="glass-card ticks p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Usuário</label>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="nome_da_conta_leitora" autoComplete="off"
                    className="input-glass w-full mt-1 px-3 py-2.5 text-sm rounded-lg" />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Senha</label>
                  <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                    type="password" placeholder="••••••••" autoComplete="new-password"
                    className="input-glass w-full mt-1 px-3 py-2.5 text-sm rounded-lg" />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Chave 2FA (TOTP) — opcional</label>
                  <input value={form.totp_secret} onChange={(e) => setForm({ ...form, totp_secret: e.target.value })}
                    placeholder="chave secreta do autenticador" autoComplete="off"
                    className="input-glass w-full mt-1 px-3 py-2.5 text-sm rounded-lg" />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Proxy dedicado</label>
                  <input value={form.proxy} onChange={(e) => setForm({ ...form, proxy: e.target.value })}
                    placeholder="user:pass@host:porta" autoComplete="off"
                    className="input-glass w-full mt-1 px-3 py-2.5 text-sm rounded-lg font-mono" />
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setShowAdd(false)} className="px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
                  Cancelar
                </button>
                <button onClick={handleAdd} disabled={saving} className="btn-primary px-4 py-2 rounded-lg text-xs disabled:opacity-60">
                  {saving ? <><Loader2 size={13} className="animate-spin" />Salvando...</> : <><Plus size={13} />Adicionar</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card h-40 animate-pulse" style={{ animationDelay: `${i * 70}ms` }} />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(0,73,141,0.06)", border: "0.5px solid rgba(0,73,141,0.18)" }}>
            <Users size={26} style={{ color: "rgba(0,73,141,0.4)" }} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Nenhuma conta leitora ainda</p>
            <p className="text-xs max-w-sm mx-auto" style={{ color: "rgba(255,255,255,0.25)" }}>
              Adicione uma conta dedicada + proxy para raspar reels completos de qualquer perfil nas Inspirações.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {accounts.map((a) => {
              const sm = STATUS_META[a.status];
              return (
                <motion.div key={a.id} layout
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                  className="glass-card ticks p-4 flex flex-col gap-3 relative group"
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sm.dot, boxShadow: `0 0 8px ${sm.dot}` }} />
                      <span className="text-sm font-semibold truncate" style={{ color: "rgba(255,255,255,0.85)" }}>@{a.username}</span>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md flex-shrink-0"
                      style={{ color: sm.color, background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.08)" }}>
                      {a.verifying ? "conectando…" : sm.label}
                    </span>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                      style={a.has_proxy
                        ? { background: "rgba(133,185,233,0.08)", color: "rgba(133,185,233,0.75)", border: "0.5px solid rgba(133,185,233,0.2)" }
                        : { background: "rgba(255,180,0,0.08)", color: "rgba(255,200,0,0.8)", border: "0.5px solid rgba(255,180,0,0.2)" }}>
                      <Globe size={9} />{a.has_proxy ? "proxy" : "sem proxy"}
                    </span>
                    {a.has_totp && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(0,73,141,0.06)", color: "rgba(0,73,141,0.7)", border: "0.5px solid rgba(0,73,141,0.15)" }}>
                        <KeyRound size={9} />2FA
                      </span>
                    )}
                    {a.followers_count != null && (
                      <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {a.followers_count.toLocaleString("pt-BR")} seg.
                      </span>
                    )}
                  </div>

                  {a.verifying && (
                    <p className="text-[11px] leading-snug px-2 py-1.5 rounded"
                      style={{ background: "rgba(255,184,0,0.06)", color: "rgba(255,200,90,0.85)" }}>
                      {a.verify_error
                        ? `Falhou, nova tentativa ${a.verify_retry_at ? `às ${new Date(a.verify_retry_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "em breve"}: ${a.verify_error.slice(0, 140)}`
                        : "Na fila: a conexão começa em até 5 minutos."}
                    </p>
                  )}

                  {a.status === "error" && a.last_error && (
                    <p className="text-[11px] leading-snug px-2 py-1.5 rounded"
                      style={{ background: "rgba(255,59,48,0.06)", color: "rgba(255,120,110,0.8)" }}>
                      {a.last_error.slice(0, 160)}
                    </p>
                  )}

                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    última raspagem: {timeAgo(a.last_scrape_at)}
                  </p>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-auto pt-1">
                    <button onClick={() => handleVerify(a.id)} disabled={a.verifying || !a.has_proxy}
                      title={!a.has_proxy ? "Configure um proxy primeiro" : undefined}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all disabled:cursor-not-allowed"
                      style={a.verifying || !a.has_proxy
                        ? { background: "rgba(0,73,141,0.05)", border: "0.5px solid rgba(0,73,141,0.12)", color: "rgba(0,73,141,0.4)" }
                        : { background: "rgba(0,73,141,0.1)", border: "0.5px solid rgba(0,73,141,0.3)", color: "rgba(0,73,141,0.9)" }}>
                      {a.verifying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      {a.status === "online" ? "Revalidar" : "Conectar"}
                    </button>
                    <button onClick={() => openEdit(a)}
                      className="px-2.5 py-2 rounded-lg text-xs"
                      style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
                      <Globe size={12} />
                    </button>
                    {confirmDelete === a.id ? (
                      <button onClick={() => handleDelete(a.id)}
                        className="px-2.5 py-2 rounded-lg text-xs font-semibold"
                        style={{ background: "rgba(255,59,48,0.15)", border: "0.5px solid rgba(255,59,48,0.4)", color: "rgba(255,100,90,0.95)" }}>
                        Confirmar
                      </button>
                    ) : (
                      <button onClick={() => { setConfirmDelete(a.id); setTimeout(() => setConfirmDelete((c) => c === a.id ? null : c), 3000); }}
                        className="px-2.5 py-2 rounded-lg text-xs"
                        style={{ background: "rgba(255,59,48,0.06)", border: "0.5px solid rgba(255,59,48,0.18)", color: "rgba(255,100,90,0.7)" }}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Edit modal */}
      <AnimatePresence>
        {editId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)" }}
            onClick={() => setEditId(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 12 }}
              className="glass ticks w-full max-w-md p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base" style={{ color: "var(--text-primary)" }}>Atualizar credenciais</h3>
                <button onClick={() => setEditId(null)} style={{ color: "rgba(255,255,255,0.3)" }}><X size={16} /></button>
              </div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Deixe em branco o que não quiser alterar. Trocar a senha reinicia a sessão salva.
              </p>
              <div className="space-y-3">
                <input value={editForm.proxy} onChange={(e) => setEditForm({ ...editForm, proxy: e.target.value })}
                  placeholder="Proxy — user:pass@host:porta" autoComplete="off"
                  className="input-glass w-full px-3 py-2.5 text-sm rounded-lg font-mono" />
                <input value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  type="password" placeholder="Nova senha" autoComplete="new-password"
                  className="input-glass w-full px-3 py-2.5 text-sm rounded-lg" />
                <input value={editForm.totp_secret} onChange={(e) => setEditForm({ ...editForm, totp_secret: e.target.value })}
                  placeholder="Nova chave 2FA (TOTP)" autoComplete="off"
                  className="input-glass w-full px-3 py-2.5 text-sm rounded-lg" />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setEditId(null)} className="px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
                  Cancelar
                </button>
                <button onClick={handleEditSave} disabled={editSaving} className="btn-primary px-4 py-2 rounded-lg text-xs disabled:opacity-60">
                  {editSaving ? <><Loader2 size={13} className="animate-spin" />Salvando...</> : <><CheckCircle2 size={13} />Salvar</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
