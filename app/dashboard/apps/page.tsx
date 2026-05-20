"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import {
  KeyRound,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Check,
  X,
  AlertCircle,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface UserApp {
  id: string;
  app_name: string;
  ig_app_id: string;
  created_at: string;
  updated_at: string;
}

const CALLBACK_URL = "https://autoscale-ia.vercel.app/api/instagram/callback";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors"
    >
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
      {copied ? "Copiado!" : "Copiar"}
    </button>
  );
}

function AppCard({
  app,
  onEdit,
  onDelete,
  deleting,
}: {
  app: UserApp;
  onEdit: (app: UserApp) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showId, setShowId] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="glass-card rounded-2xl p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
            <KeyRound size={18} className="text-violet-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white/90 truncate">{app.app_name}</p>
            <p className="text-[10px] text-white/30 mt-0.5">
              Criado em {new Date(app.created_at).toLocaleDateString("pt-BR")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => onEdit(app)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
          >
            <Edit2 size={14} />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { onDelete(app.id); setConfirmDelete(false); }}
                disabled={deleting}
                className="text-[11px] text-red-400 hover:text-red-300 font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : "Confirmar"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/[0.07] transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="h-px bg-white/[0.05]" />

      {/* App ID */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-white/25 uppercase tracking-widest">App ID</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs text-violet-300 font-mono truncate">
            {showId ? app.ig_app_id : "•".repeat(Math.min(app.ig_app_id.length, 20))}
          </code>
          <button
            onClick={() => setShowId(v => !v)}
            className="text-white/25 hover:text-white/50 transition-colors flex-shrink-0"
          >
            {showId ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <CopyButton text={app.ig_app_id} />
        </div>
      </div>

      {/* App Secret */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-white/25 uppercase tracking-widest">App Secret</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs text-white/20 font-mono">••••••••••••••••••••</code>
          <span className="text-[10px] text-white/20 italic">criptografado</span>
        </div>
      </div>
    </motion.div>
  );
}

interface FormState {
  app_name: string;
  ig_app_id: string;
  ig_app_secret: string;
}

function AppForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
  error,
  isEdit,
}: {
  initial?: Partial<FormState>;
  onSubmit: (data: FormState) => void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
  isEdit: boolean;
}) {
  const [form, setForm] = useState<FormState>({
    app_name: initial?.app_name ?? "",
    ig_app_id: initial?.ig_app_id ?? "",
    ig_app_secret: "",
  });
  const [showSecret, setShowSecret] = useState(false);
  const [callbackOpen, setCallbackOpen] = useState(false);

  function set(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="glass rounded-2xl p-6 space-y-5 neon-border"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">
          {isEdit ? "Editar App" : "Novo App Meta"}
        </h2>
        <button onClick={onCancel} className="text-white/30 hover:text-white/60 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Callback URL notice */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.06] p-3 space-y-2">
        <button
          onClick={() => setCallbackOpen(v => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <p className="text-[11px] font-semibold text-blue-300 uppercase tracking-wide">
            URL de Callback — configure no Meta Developers
          </p>
          <ChevronDown size={14} className={cn("text-blue-400 transition-transform", callbackOpen ? "rotate-180" : "")} />
        </button>
        <AnimatePresence>
          {callbackOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-2"
            >
              <code className="block text-[11px] text-blue-200 font-mono break-all">
                {CALLBACK_URL}
              </code>
              <div className="flex items-center gap-3">
                <CopyButton text={CALLBACK_URL} />
                <a
                  href="https://developers.facebook.com/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors"
                >
                  <ExternalLink size={10} /> Abrir Meta Developers
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold text-white/35 uppercase tracking-widest">
            Nome do App *
          </label>
          <input
            value={form.app_name}
            onChange={e => set("app_name", e.target.value)}
            placeholder="ex: Meu App de Produção"
            className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/80 placeholder:text-white/20 text-sm px-4 py-2.5 outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold text-white/35 uppercase tracking-widest">
            Instagram App ID *
          </label>
          <input
            value={form.ig_app_id}
            onChange={e => set("ig_app_id", e.target.value)}
            placeholder="ex: 1234567890"
            className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/80 placeholder:text-white/20 text-sm px-4 py-2.5 outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold text-white/35 uppercase tracking-widest">
            Instagram App Secret {isEdit && <span className="normal-case tracking-normal text-white/20">(deixe em branco para manter)</span>}
          </label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={form.ig_app_secret}
              onChange={e => set("ig_app_secret", e.target.value)}
              placeholder={isEdit ? "••••••••••••••••" : "ex: abcdef1234567890..."}
              className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/80 placeholder:text-white/20 text-sm px-4 py-2.5 pr-10 outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all font-mono"
            />
            <button
              type="button"
              onClick={() => setShowSecret(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors"
            >
              {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
        >
          <AlertCircle size={13} className="flex-shrink-0" />
          {error}
        </motion.div>
      )}

      <div className="flex gap-2.5">
        <button
          onClick={() => onSubmit(form)}
          disabled={submitting}
          className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm py-2.5 disabled:opacity-60"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? "Salvar alterações" : "Criar App"}
        </button>
        <button
          onClick={onCancel}
          className="btn-ghost px-4 text-sm text-white/40 hover:text-white/70"
        >
          Cancelar
        </button>
      </div>
    </motion.div>
  );
}

export default function AppsPage() {
  const [apps, setApps] = useState<UserApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingApp, setEditingApp] = useState<UserApp | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const fetchApps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/apps");
      const data = await res.json() as { apps?: UserApp[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao carregar apps");
      setApps(data.apps ?? []);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchApps(); }, [fetchApps]);

  async function handleCreate(form: { app_name: string; ig_app_id: string; ig_app_secret: string }) {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { app?: UserApp; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar app");
      setApps(prev => [data.app!, ...prev]);
      setShowForm(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(form: { app_name: string; ig_app_id: string; ig_app_secret: string }) {
    if (!editingApp) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const body: Record<string, string> = {
        app_name: form.app_name,
        ig_app_id: form.ig_app_id,
      };
      if (form.ig_app_secret.trim()) body.ig_app_secret = form.ig_app_secret;

      const res = await fetch(`/api/apps/${editingApp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { app?: UserApp; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao editar app");
      setApps(prev => prev.map(a => a.id === editingApp.id ? data.app! : a));
      setEditingApp(null);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/apps/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Erro ao remover app");
      }
      setApps(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Erro ao remover app");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Meus Apps Meta</h1>
          <p className="text-sm text-white/35 mt-0.5">
            Cadastre suas credenciais do Meta Developers para conectar contas do Instagram.
          </p>
        </div>
        {!showForm && !editingApp && (
          <motion.button
            onClick={() => { setShowForm(true); setFormError(null); }}
            whileTap={{ scale: 0.97 }}
            className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
          >
            <Plus size={15} />
            Novo App
          </motion.button>
        )}
      </motion.div>

      {/* How-to info */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-1.5"
      >
        <p className="text-xs font-semibold text-white/45">Como funciona o BYOC?</p>
        <p className="text-xs text-white/25 leading-relaxed">
          Você cria seu próprio App no{" "}
          <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">
            Meta Developers
          </a>
          , adiciona o produto <strong className="text-white/40">Instagram</strong>, cadastra a URL de callback, e coloca as credenciais aqui. O AutoScale usará suas credenciais para o fluxo OAuth — suas contas ficam vinculadas ao seu próprio app Meta.
        </p>
      </motion.div>

      {/* Page error */}
      <AnimatePresence>
        {pageError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3"
          >
            <AlertCircle size={15} className="flex-shrink-0" />
            <span className="flex-1">{pageError}</span>
            <button onClick={() => setPageError(null)} className="text-white/25 hover:text-white/50">
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <AppForm
            isEdit={false}
            onSubmit={handleCreate}
            onCancel={() => { setShowForm(false); setFormError(null); }}
            submitting={submitting}
            error={formError}
          />
        )}
      </AnimatePresence>

      {/* Edit form */}
      <AnimatePresence>
        {editingApp && (
          <AppForm
            key={editingApp.id}
            isEdit
            initial={{ app_name: editingApp.app_name, ig_app_id: editingApp.ig_app_id }}
            onSubmit={handleEdit}
            onCancel={() => { setEditingApp(null); setFormError(null); }}
            submitting={submitting}
            error={formError}
          />
        )}
      </AnimatePresence>

      {/* App list */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="glass-card rounded-2xl p-5 animate-pulse space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/[0.07]" />
                <div className="space-y-2 flex-1">
                  <div className="h-3.5 bg-white/[0.07] rounded-full w-32" />
                  <div className="h-2.5 bg-white/[0.04] rounded-full w-24" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : apps.length === 0 && !showForm ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card rounded-2xl flex flex-col items-center gap-4 py-16 text-center px-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            <KeyRound size={24} className="text-white/20" />
          </div>
          <div className="space-y-1">
            <p className="text-white/40 text-sm font-medium">Nenhum app cadastrado</p>
            <p className="text-white/20 text-xs max-w-xs">
              Crie seu app no Meta Developers e adicione as credenciais aqui para conectar suas contas do Instagram.
            </p>
          </div>
          <motion.button
            onClick={() => { setShowForm(true); setFormError(null); }}
            whileTap={{ scale: 0.97 }}
            className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2"
          >
            <Plus size={14} /> Cadastrar primeiro app
          </motion.button>
        </motion.div>
      ) : (
        <motion.div layout className="space-y-4">
          <AnimatePresence>
            {apps.map(app => (
              <AppCard
                key={app.id}
                app={app}
                onEdit={(a) => { setEditingApp(a); setFormError(null); setShowForm(false); }}
                onDelete={handleDelete}
                deleting={deletingId === app.id}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
