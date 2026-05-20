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
  BookOpen,
  Lock,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface UserApp {
  id: string;
  app_name: string;
  ig_app_id: string;
  created_at: string;
  updated_at: string;
}

interface FormState {
  app_name: string;
  ig_app_id: string;
  ig_app_secret: string;
}

type Tab = "apps" | "guide";

const CALLBACK_URL = "https://autoscale-ia.vercel.app/api/instagram/callback";

// ── CopyButton ────────────────────────────────────────────────
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
      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      {copied ? "Copiado!" : "Copiar"}
    </button>
  );
}

// ── AppFormModal ──────────────────────────────────────────────
function AppFormModal({
  initial,
  onSubmit,
  onClose,
  submitting,
  error,
  isEdit,
}: {
  initial?: Partial<FormState>;
  onSubmit: (data: FormState) => void;
  onClose: () => void;
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

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/65 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 14 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
      >
        <div className="glass rounded-2xl neon-border w-full max-w-md p-6 space-y-5 pointer-events-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                <KeyRound size={13} className="text-violet-400" />
              </div>
              <h2 className="text-base font-bold text-white">
                {isEdit ? "Editar App" : "Cadastrar Novo App"}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Callback URL */}
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.06] p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-blue-300 uppercase tracking-wide">
              URL de Callback — adicione no Meta Developers
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] text-blue-200 font-mono break-all">
                {CALLBACK_URL}
              </code>
              <CopyButton text={CALLBACK_URL} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-semibold text-white/35 uppercase tracking-widest">
                Nome do App *
              </label>
              <input
                value={form.app_name}
                onChange={(e) => set("app_name", e.target.value)}
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
                onChange={(e) => set("ig_app_id", e.target.value)}
                placeholder="ex: 1234567890"
                className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/80 placeholder:text-white/20 text-sm px-4 py-2.5 outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-semibold text-white/35 uppercase tracking-widest">
                App Secret{" "}
                {isEdit && (
                  <span className="normal-case tracking-normal text-white/20">
                    (vazio = mantém atual)
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={form.ig_app_secret}
                  onChange={(e) => set("ig_app_secret", e.target.value)}
                  placeholder={isEdit ? "••••••••••••••••" : "Cole o App Secret aqui"}
                  className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/80 placeholder:text-white/20 text-sm px-4 py-2.5 pr-10 outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors"
                >
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
              >
                <AlertCircle size={13} className="flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-2.5">
            <button
              onClick={() => onSubmit(form)}
              disabled={submitting}
              className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm py-2.5 disabled:opacity-60"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? "Salvar alterações" : "Cadastrar App"}
            </button>
            <button
              onClick={onClose}
              className="btn-ghost px-4 text-sm text-white/40 hover:text-white/70"
            >
              Cancelar
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── AppsTable ─────────────────────────────────────────────────
function AppsTable({
  apps,
  onEdit,
  onDelete,
  deletingId,
}: {
  apps: UserApp[];
  onEdit: (app: UserApp) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[2fr_2fr_1.5fr_160px] gap-0 px-6 py-3 bg-white/[0.03] border-b border-white/[0.06]">
        <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
          Nome do App
        </span>
        <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
          IG App ID
        </span>
        <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest">
          App Secret
        </span>
        <span className="text-[10px] font-semibold text-white/30 uppercase tracking-widest text-right">
          Ações
        </span>
      </div>

      {/* Rows */}
      <AnimatePresence initial={false}>
        {apps.map((app, idx) => {
          const revealed = revealedIds.has(app.id);
          const isDeleting = deletingId === app.id;
          const confirmingDelete = confirmDeleteId === app.id;

          return (
            <motion.div
              key={app.id}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -24, transition: { duration: 0.15 } }}
              transition={{ duration: 0.18, delay: idx * 0.04 }}
              className={cn(
                "grid grid-cols-[2fr_2fr_1.5fr_160px] gap-0 items-center px-6 py-4 group",
                idx < apps.length - 1 ? "border-b border-white/[0.04]" : "",
                "hover:bg-white/[0.025] transition-colors"
              )}
            >
              {/* Nome */}
              <div className="flex items-center gap-3 min-w-0 pr-6">
                <div className="w-9 h-9 rounded-xl bg-violet-500/[0.12] border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                  <KeyRound size={14} className="text-violet-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/85 truncate">
                    {app.app_name}
                  </p>
                  <p className="text-[10px] text-white/25 mt-0.5">
                    {new Date(app.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </div>

              {/* App ID */}
              <div className="flex items-center gap-2 pr-6 min-w-0">
                <code className="text-xs text-violet-300 font-mono truncate">
                  {revealed
                    ? app.ig_app_id
                    : `${app.ig_app_id.slice(0, 4)}${"•".repeat(
                        Math.max(0, app.ig_app_id.length - 4)
                      )}`}
                </code>
                <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => toggleReveal(app.id)}
                    className="text-white/25 hover:text-white/60 transition-colors"
                    title={revealed ? "Ocultar" : "Revelar"}
                  >
                    {revealed ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                  <CopyButton text={app.ig_app_id} />
                </div>
              </div>

              {/* Secret */}
              <div className="flex items-center gap-2 pr-6">
                <Lock size={11} className="text-white/20 flex-shrink-0" />
                <span className="text-[11px] text-white/20 font-mono tracking-widest">
                  ••••••••••••••
                </span>
                <span className="text-[9px] text-white/15 italic hidden sm:block">
                  cifrado
                </span>
              </div>

              {/* Ações */}
              <div className="flex items-center justify-end gap-1">
                {confirmingDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onDelete(app.id);
                        setConfirmDeleteId(null);
                      }}
                      disabled={isDeleting}
                      className="text-[11px] text-red-400 hover:text-red-300 font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {isDeleting ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        "Confirmar"
                      )}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => onEdit(app)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white/25 hover:text-violet-400 hover:bg-violet-500/10 transition-colors"
                      title="Editar"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(app.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/[0.08] transition-colors"
                      title="Excluir"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── TableSkeleton ─────────────────────────────────────────────
function TableSkeleton() {
  return (
    <div className="rounded-2xl border border-white/[0.07] overflow-hidden animate-pulse">
      <div className="grid grid-cols-4 gap-4 px-6 py-3 bg-white/[0.03] border-b border-white/[0.06]">
        {[40, 35, 30, 20].map((w, i) => (
          <div key={i} style={{ width: `${w}%` }} className="h-2 bg-white/[0.07] rounded-full" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-4 gap-4 px-6 py-4 border-b border-white/[0.04] last:border-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/[0.06] flex-shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="h-2.5 bg-white/[0.07] rounded-full w-3/4" />
              <div className="h-2 bg-white/[0.04] rounded-full w-1/2" />
            </div>
          </div>
          {[60, 50, 30].map((w, j) => (
            <div key={j} style={{ width: `${w}%` }} className="h-2.5 bg-white/[0.05] rounded-full self-center" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── HowToGuide ────────────────────────────────────────────────
const GUIDE_STEPS = [
  {
    num: "01",
    title: "Crie uma conta no Meta Developers",
    body: "Acesse developers.facebook.com e faça login com seu Facebook/Meta. Se ainda não tiver uma conta de desenvolvedor, crie gratuitamente.",
    link: { label: "Abrir Meta Developers", url: "https://developers.facebook.com/apps" },
    accent: "border-blue-500/25 bg-blue-500/[0.05]",
    numColor: "text-blue-400",
  },
  {
    num: "02",
    title: "Crie um novo App",
    body: "Clique em 'My Apps' → 'Create App'. Selecione o tipo Business ou Consumer e preencha o nome. Anote o App ID gerado automaticamente.",
    accent: "border-violet-500/25 bg-violet-500/[0.05]",
    numColor: "text-violet-400",
  },
  {
    num: "03",
    title: "Adicione o produto Instagram",
    body: "No painel do app, vá em 'Add a Product' e selecione Instagram. Escolha 'Instagram API with Instagram Login' (não o Instagram Basic Display legado).",
    accent: "border-pink-500/25 bg-pink-500/[0.05]",
    numColor: "text-pink-400",
  },
  {
    num: "04",
    title: "Configure a URL de Callback",
    body: "Em Instagram → Configurações → Valid OAuth Redirect URIs, adicione a URL abaixo. Sem ela, o fluxo de autorização será rejeitado pelo Meta.",
    extra: CALLBACK_URL,
    accent: "border-cyan-500/25 bg-cyan-500/[0.05]",
    numColor: "text-cyan-400",
  },
  {
    num: "05",
    title: "Copie o App ID e App Secret",
    body: "Em 'App Settings' → 'Basic', copie o App ID visível e clique em 'Show' ao lado do App Secret. Guarde esses valores — o secret é sensível.",
    accent: "border-amber-500/25 bg-amber-500/[0.05]",
    numColor: "text-amber-400",
  },
  {
    num: "06",
    title: "Cadastre no AutoScale",
    body: "Na aba 'Meus Apps', clique em 'Novo App', informe o nome, App ID e App Secret. O secret é criptografado com AES-256 antes de ser salvo.",
    accent: "border-emerald-500/25 bg-emerald-500/[0.05]",
    numColor: "text-emerald-400",
  },
] as const;

function HowToGuide() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 max-w-3xl"
    >
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-5 py-4 flex items-start gap-3">
        <Info size={15} className="text-violet-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-white/45 leading-relaxed">
          O modelo{" "}
          <strong className="text-white/70">BYOC (Bring Your Own Credentials)</strong> permite usar
          suas próprias credenciais do Meta Developers — total controle sobre dados e permissões das
          suas contas Instagram.
        </p>
      </div>

      <div className="space-y-3">
        {GUIDE_STEPS.map((step, i) => (
          <motion.div
            key={step.num}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className={cn("rounded-xl border p-5 space-y-2", step.accent)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={cn("text-xs font-black font-mono tracking-wider", step.numColor)}>
                  {step.num}
                </span>
                <h3 className="text-sm font-bold text-white/90">{step.title}</h3>
              </div>
              {"link" in step && step.link && (
                <a
                  href={step.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
                >
                  <ExternalLink size={10} />
                  {step.link.label}
                </a>
              )}
            </div>
            <p className="text-xs text-white/45 leading-relaxed pl-9">{step.body}</p>
            {"extra" in step && step.extra && (
              <div className="ml-9 flex items-center gap-2 rounded-lg bg-black/25 border border-white/[0.06] px-3 py-2">
                <code className="flex-1 text-[11px] text-cyan-300 font-mono break-all">
                  {step.extra}
                </code>
                <CopyButton text={step.extra} />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function AppsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("apps");
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
      const data = (await res.json()) as { apps?: UserApp[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao carregar apps");
      setApps(data.apps ?? []);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  async function handleCreate(form: FormState) {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { app?: UserApp; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar app");
      setApps((prev) => [data.app!, ...prev]);
      setShowForm(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(form: FormState) {
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
      const data = (await res.json()) as { app?: UserApp; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao editar app");
      setApps((prev) => prev.map((a) => (a.id === editingApp.id ? data.app! : a)));
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
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erro ao remover app");
      }
      setApps((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Erro ao remover");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Meus Apps Meta</h1>
          <p className="text-sm text-white/35 mt-1">
            Gerencie as credenciais do Meta Developers para conectar suas contas Instagram.
          </p>
        </div>
        <AnimatePresence>
          {activeTab === "apps" && (
            <motion.button
              key="add-btn"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={() => {
                setShowForm(true);
                setFormError(null);
              }}
              whileTap={{ scale: 0.97 }}
              className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
            >
              <Plus size={15} />
              Novo App
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06 }}
        className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] w-fit"
      >
        {(
          [
            { id: "apps", label: "Meus Apps", icon: KeyRound },
            { id: "guide", label: "Como configurar", icon: BookOpen },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              activeTab === tab.id
                ? "bg-violet-600/25 text-violet-300 border border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
            )}
          >
            <tab.icon size={14} className="flex-shrink-0" />
            {tab.label}
          </button>
        ))}
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
            <button
              onClick={() => setPageError(null)}
              className="text-white/25 hover:text-white/50 transition-colors"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {activeTab === "apps" ? (
          <motion.div
            key="tab-apps"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {loading ? (
              <TableSkeleton />
            ) : apps.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass-card rounded-2xl flex flex-col items-center gap-4 py-20 text-center px-6"
              >
                <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
                  <KeyRound size={24} className="text-white/20" />
                </div>
                <div className="space-y-1">
                  <p className="text-white/50 text-sm font-semibold">Nenhum app cadastrado</p>
                  <p className="text-white/25 text-xs max-w-xs leading-relaxed">
                    Cadastre as credenciais do seu app Meta para conectar contas Instagram.
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-center">
                  <motion.button
                    onClick={() => {
                      setShowForm(true);
                      setFormError(null);
                    }}
                    whileTap={{ scale: 0.97 }}
                    className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2"
                  >
                    <Plus size={14} /> Cadastrar primeiro app
                  </motion.button>
                  <button
                    onClick={() => setActiveTab("guide")}
                    className="btn-ghost text-sm px-4 py-2.5 flex items-center gap-2 text-white/50"
                  >
                    <BookOpen size={14} /> Como configurar
                  </button>
                </div>
              </motion.div>
            ) : (
              <AppsTable
                apps={apps}
                onEdit={(a) => {
                  setEditingApp(a);
                  setFormError(null);
                  setShowForm(false);
                }}
                onDelete={handleDelete}
                deletingId={deletingId}
              />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="tab-guide"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <HowToGuide />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form modals */}
      <AnimatePresence>
        {showForm && (
          <AppFormModal
            key="create"
            isEdit={false}
            onSubmit={handleCreate}
            onClose={() => {
              setShowForm(false);
              setFormError(null);
            }}
            submitting={submitting}
            error={formError}
          />
        )}
        {editingApp && (
          <AppFormModal
            key={`edit-${editingApp.id}`}
            isEdit
            initial={{ app_name: editingApp.app_name, ig_app_id: editingApp.ig_app_id }}
            onSubmit={handleEdit}
            onClose={() => {
              setEditingApp(null);
              setFormError(null);
            }}
            submitting={submitting}
            error={formError}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
