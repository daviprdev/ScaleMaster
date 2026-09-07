"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Link2, Plus, Copy, Check, Pencil, BarChart3, Pause, Play, Archive,
  Trash2, Loader2, X, ExternalLink, MousePointerClick, Calendar,
  AlertCircle, Instagram, Megaphone, ArchiveRestore, Globe, ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { publicLinkUrl, redirectBase, hasConfiguredDomain } from "@/lib/link-base-url";

// ── Tipos ───────────────────────────────────────────────────────────────────

type LinkStatus = "active" | "paused" | "archived";

interface ManagedLink {
  id: string;
  slug: string;
  name: string | null;
  destination_url: string;
  status: LinkStatus;
  forward_query_params: boolean;
  instagram_account_id: string | null;
  campaign_id: string | null;
  click_count: number;
  last_clicked_at: string | null;
  created_at: string;
  instagram_accounts?: { username: string } | null;
}

interface Overview {
  total_links: number;
  active_links: number;
  paused_links: number;
  archived_links: number;
  total_clicks: number;
  clicks_today: number;
  clicks_window: number;
  window_days: number;
  top_link: { id: string; slug: string; name: string | null; click_count: number } | null;
}

interface AccountOption { id: string; username: string }

interface CampaignOption {
  campaign_id: string;
  total: number;
  first_slot: string;
  clone_source_profile: string | null;
  is_clone: boolean;
}

// ── Helpers de exibição ─────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "agora";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} dia${d > 1 ? "s" : ""} atrás`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`.replace(".0", "");
  return `${(n / 1_000_000).toFixed(1)}M`.replace(".0", "");
}

function campaignLabel(c: CampaignOption): string {
  if (c.is_clone && c.clone_source_profile) return `Clone @${c.clone_source_profile}`;
  return `Campanha de ${formatDate(c.first_slot)} (${c.total} posts)`;
}

const STATUS_META: Record<LinkStatus, { label: string; className: string }> = {
  active:   { label: "Ativo",      className: "bg-[#00FF41]/10 text-[#00FF41] border-[#00FF41]/20" },
  paused:   { label: "Pausado",    className: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  archived: { label: "Arquivado",  className: "bg-white/[0.05] text-white/35 border-white/10" },
};

// ── Card de métrica ─────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ElementType; label: string; value: string;
  sub?: string; accent: "matrix" | "electric" | "amber";
}) {
  const color = accent === "matrix" ? "#00FF41" : accent === "electric" ? "#00E5FF" : "#FBBF24";
  return (
    <div className="glass-card ticks rounded-2xl p-5 relative overflow-hidden">
      <div
        className="absolute -top-16 -right-16 w-40 h-40 rounded-full pointer-events-none opacity-40"
        style={{ background: `radial-gradient(circle, ${color}22 0%, transparent 70%)` }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">{label}</p>
          <p className="mt-2 text-2xl font-bold" style={{ color }}>{value}</p>
          {sub && <p className="mt-1 text-[11px] text-white/30 truncate">{sub}</p>}
        </div>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border"
          style={{ background: `${color}14`, borderColor: `${color}33` }}
        >
          <Icon size={15} style={{ color }} />
        </div>
      </div>
    </div>
  );
}

// ── Modal de criação/edição ─────────────────────────────────────────────────

interface FormState {
  name: string;
  destination_url: string;
  custom_slug: string;
  forward_query_params: boolean;
  instagram_account_id: string;
  campaign_id: string;
}

const EMPTY_FORM: FormState = {
  name: "", destination_url: "", custom_slug: "",
  forward_query_params: false, instagram_account_id: "", campaign_id: "",
};

function LinkModal({
  editing, accounts, campaigns, onClose, onSaved,
}: {
  editing: ManagedLink | null;
  accounts: AccountOption[];
  campaigns: CampaignOption[];
  onClose: () => void;
  onSaved: (link: ManagedLink, isNew: boolean) => void;
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          name: editing.name ?? "",
          destination_url: editing.destination_url,
          custom_slug: "",
          forward_query_params: editing.forward_query_params,
          instagram_account_id: editing.instagram_account_id ?? "",
          campaign_id: editing.campaign_id ?? "",
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSlug, setShowSlug] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const previewSlug = editing ? editing.slug : (form.custom_slug.trim().toLowerCase() || "x8K2pA9");

  const handleSubmit = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        destination_url: form.destination_url,
        forward_query_params: form.forward_query_params,
        instagram_account_id: form.instagram_account_id || null,
        campaign_id: form.campaign_id || null,
      };
      if (!editing && form.custom_slug.trim()) payload.custom_slug = form.custom_slug.trim();

      const res = await fetch(editing ? `/api/links/${editing.id}` : "/api/links", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { link?: ManagedLink; error?: string };
      if (!res.ok || !data.link) {
        setError(data.error ?? "Não foi possível salvar o link.");
        return;
      }
      onSaved(data.link, !editing);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 12 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-lg rounded-2xl border border-white/10 overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00FF41]/10 border border-[#00FF41]/20 flex items-center justify-center">
              <Link2 size={14} className="text-[#00FF41]" />
            </div>
            <p className="text-sm font-semibold text-white">
              {editing ? "Editar link" : "Novo link"}
            </p>
          </div>
          <button onClick={onClose} className="text-white/25 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-white/35">Nome</label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Oferta de setembro"
              maxLength={120}
              className="input-glass w-full mt-1.5 px-3.5 py-2.5 rounded-xl text-sm"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-white/35">
              URL de destino <span className="text-[#00FF41]">*</span>
            </label>
            <input
              value={form.destination_url}
              onChange={(e) => set("destination_url", e.target.value)}
              placeholder="https://destino-final.com/pagina"
              className="input-glass w-full mt-1.5 px-3.5 py-2.5 rounded-xl text-sm font-mono"
            />
            {editing && (
              <p className="mt-1.5 text-[11px] text-white/30">
                Trocar o destino não muda o link público — quem já recebeu{" "}
                <span className="font-mono text-white/50">/r/{editing.slug}</span> passa a cair no novo endereço.
              </p>
            )}
          </div>

          {!editing && (
            <div>
              <button
                type="button"
                onClick={() => setShowSlug((v) => !v)}
                className="text-[11px] font-semibold text-[#00E5FF]/70 hover:text-[#00E5FF] transition-colors"
              >
                {showSlug ? "− usar slug automático" : "+ personalizar o slug"}
              </button>
              {showSlug && (
                <input
                  value={form.custom_slug}
                  onChange={(e) => set("custom_slug", e.target.value)}
                  placeholder="oferta-setembro"
                  maxLength={50}
                  className="input-glass w-full mt-2 px-3.5 py-2.5 rounded-xl text-sm font-mono"
                />
              )}
            </div>
          )}

          {/* Preview */}
          <div className="px-3.5 py-3 rounded-xl bg-[#00FF41]/[0.04] border border-[#00FF41]/15">
            <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Link público</p>
            <p className="mt-1 text-sm font-mono text-[#00FF41] break-all">
              {redirectBase()}/r/{previewSlug}
            </p>
            {!editing && !form.custom_slug.trim() && (
              <p className="mt-1 text-[10px] text-white/25">O slug final é gerado no servidor.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-white/35">Conta (opcional)</label>
              <select
                value={form.instagram_account_id}
                onChange={(e) => set("instagram_account_id", e.target.value)}
                className="input-glass w-full mt-1.5 px-3 py-2.5 rounded-xl text-sm"
              >
                <option value="">Nenhuma</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>@{a.username}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-white/35">Campanha (opcional)</label>
              <select
                value={form.campaign_id}
                onChange={(e) => set("campaign_id", e.target.value)}
                className="input-glass w-full mt-1.5 px-3 py-2.5 rounded-xl text-sm"
              >
                <option value="">Nenhuma</option>
                {campaigns.map((c) => (
                  <option key={c.campaign_id} value={c.campaign_id}>{campaignLabel(c)}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => set("forward_query_params", !form.forward_query_params)}
            className={cn(
              "w-full flex items-start gap-3 px-3.5 py-3 rounded-xl border text-left transition-all",
              form.forward_query_params
                ? "bg-[#00E5FF]/[0.06] border-[#00E5FF]/25"
                : "bg-white/[0.02] border-white/[0.06] hover:border-white/15"
            )}
          >
            <div className={cn(
              "mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all",
              form.forward_query_params ? "bg-[#00E5FF] border-[#00E5FF]" : "border-white/20"
            )}>
              {form.forward_query_params && <Check size={11} className="text-black" strokeWidth={3} />}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white/80">Repassar parâmetros para o destino</p>
              <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">
                {form.forward_query_params
                  ? "utm_source e afins da URL pública são anexados ao destino. Parâmetro que já existe no destino tem precedência."
                  : "A query da URL pública fica só no analytics e não altera o destino."}
              </p>
            </div>
          </button>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-start gap-2 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs"
              >
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /> {error}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="px-5 py-4 border-t border-white/[0.06] flex gap-2.5">
          <button
            onClick={onClose}
            className="btn-ghost flex-1 py-2.5 rounded-xl text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.destination_url.trim()}
            className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-40"
          >
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Salvando...</>
              : editing ? "Salvar alterações" : "Criar link"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Card de link ────────────────────────────────────────────────────────────

function LinkCard({
  link, onCopy, copied, onEdit, onToggleStatus, onArchive, onDelete, busy, confirmDelete, onAskDelete,
}: {
  link: ManagedLink;
  copied: boolean;
  busy: boolean;
  confirmDelete: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onAskDelete: () => void;
}) {
  const meta = STATUS_META[link.status];
  const publicUrl = publicLinkUrl(link.slug);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="glass-card rounded-2xl p-4 sm:p-5"
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Identidade */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white truncate">
              {link.name || "Sem nome"}
            </p>
            <span className={cn("text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border", meta.className)}>
              {meta.label}
            </span>
            {link.forward_query_params && (
              <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#00E5FF]/10 text-[#00E5FF]/80 border border-[#00E5FF]/20">
                repassa params
              </span>
            )}
          </div>

          <button
            onClick={onCopy}
            title="Copiar link público"
            className="mt-1.5 flex items-center gap-1.5 text-xs font-mono text-[#00FF41]/80 hover:text-[#00FF41] transition-colors max-w-full"
          >
            <span className="truncate">{publicUrl}</span>
            {copied ? <Check size={12} className="flex-shrink-0" /> : <Copy size={12} className="flex-shrink-0 opacity-50" />}
          </button>

          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/30 min-w-0">
            <ArrowUpRight size={11} className="flex-shrink-0" />
            <span className="truncate font-mono">{link.destination_url}</span>
            <a
              href={link.destination_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex-shrink-0 hover:text-white/60 transition-colors"
              title="Abrir destino"
            >
              <ExternalLink size={10} />
            </a>
          </div>

          {(link.instagram_accounts?.username || link.campaign_id) && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {link.instagram_accounts?.username && (
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] text-white/45 border border-white/[0.06]">
                  <Instagram size={9} /> @{link.instagram_accounts.username}
                </span>
              )}
              {link.campaign_id && (
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] text-white/45 border border-white/[0.06]">
                  <Megaphone size={9} /> campanha {link.campaign_id.slice(0, 8)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Números */}
        <div className="flex items-center gap-5 lg:gap-6 flex-shrink-0">
          <div className="text-left lg:text-right">
            <p className="text-[9px] uppercase tracking-widest text-white/25 font-semibold">Cliques</p>
            <p className="text-lg font-bold text-[#00E5FF]">{compact(link.click_count)}</p>
          </div>
          <div className="text-left lg:text-right">
            <p className="text-[9px] uppercase tracking-widest text-white/25 font-semibold">Último</p>
            <p className="text-xs text-white/50 mt-1">{timeAgo(link.last_clicked_at)}</p>
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
          <Link
            href={`/dashboard/links/${link.id}`}
            title="Analytics"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-[#00E5FF] hover:bg-[#00E5FF]/10 transition-all"
          >
            <BarChart3 size={14} />
          </Link>
          <button
            onClick={onEdit}
            title="Editar"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white hover:bg-white/[0.06] transition-all"
          >
            <Pencil size={14} />
          </button>
          {link.status !== "archived" && (
            <button
              onClick={onToggleStatus}
              disabled={busy}
              title={link.status === "active" ? "Pausar" : "Ativar"}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-amber-300 hover:bg-amber-500/10 transition-all disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" />
                : link.status === "active" ? <Pause size={14} /> : <Play size={14} />}
            </button>
          )}
          <button
            onClick={onArchive}
            disabled={busy}
            title={link.status === "archived" ? "Reativar" : "Arquivar"}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-40"
          >
            {link.status === "archived" ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
          <button
            onClick={confirmDelete ? onDelete : onAskDelete}
            disabled={busy}
            title="Excluir definitivamente (apaga o analytics)"
            className={cn(
              "h-8 flex items-center justify-center rounded-lg transition-all disabled:opacity-40",
              confirmDelete
                ? "px-2.5 gap-1 bg-red-500/15 text-red-400 text-[10px] font-bold"
                : "w-8 text-white/30 hover:text-red-400 hover:bg-red-500/10"
            )}
          >
            <Trash2 size={14} />
            {confirmDelete && "Confirmar?"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function LinksPage() {
  const [links, setLinks] = useState<ManagedLink[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"todos" | LinkStatus>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedLink | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const status = filter === "todos" ? "all" : filter;
      const res = await fetch(`/api/links?status=${status}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { links: ManagedLink[]; overview: Overview | null };
      setLinks(data.links ?? []);
      setOverview(data.overview);
    } catch {
      setNotice({ type: "error", message: "Não foi possível carregar os links." });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const [accRes, campRes] = await Promise.all([
          fetch("/api/accounts/list", { cache: "no-store" }),
          fetch("/api/campaigns", { cache: "no-store" }),
        ]);
        if (accRes.ok) {
          const d = await accRes.json() as { accounts?: { id: string; username: string }[] };
          setAccounts((d.accounts ?? []).map((a) => ({ id: a.id, username: a.username })));
        }
        if (campRes.ok) {
          const d = await campRes.json() as { campaigns?: CampaignOption[] };
          setCampaigns((d.campaigns ?? []).slice(0, 50));
        }
      } catch { /* vínculos são opcionais — a criação funciona sem eles */ }
    })();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const t = setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => clearTimeout(t);
  }, [confirmDeleteId]);

  const handleCopy = async (link: ManagedLink) => {
    const url = publicLinkUrl(link.slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(link.id);
      setNotice({ type: "success", message: "Link copiado." });
      setTimeout(() => setCopiedId((c) => (c === link.id ? null : c)), 2000);
    } catch {
      setNotice({ type: "error", message: "O navegador bloqueou a cópia. Selecione e copie manualmente." });
    }
  };

  const patchLink = async (link: ManagedLink, patch: Record<string, unknown>, successMsg: string) => {
    setBusyId(link.id);
    try {
      const res = await fetch(`/api/links/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json() as { link?: ManagedLink; error?: string };
      if (!res.ok || !data.link) {
        setNotice({ type: "error", message: data.error ?? "Não foi possível atualizar o link." });
        return;
      }
      // Só atualiza o state depois que o servidor confirmou.
      setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, ...data.link! } : l)));
      setNotice({ type: "success", message: successMsg });
      load();
    } catch {
      setNotice({ type: "error", message: "Erro de conexão." });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (link: ManagedLink) => {
    setBusyId(link.id);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/links/${link.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setNotice({ type: "error", message: data.error ?? "Não foi possível excluir." });
        return;
      }
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      setNotice({ type: "success", message: "Link excluído." });
      load();
    } catch {
      setNotice({ type: "error", message: "Erro de conexão." });
    } finally {
      setBusyId(null);
    }
  };

  const visible = useMemo(
    () => (filter === "todos" ? links.filter((l) => l.status !== "archived") : links),
    [links, filter]
  );

  const counts = useMemo(() => ({
    todos: links.filter((l) => l.status !== "archived").length,
    active: links.filter((l) => l.status === "active").length,
    paused: links.filter((l) => l.status === "paused").length,
    archived: links.filter((l) => l.status === "archived").length,
  }), [links]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Link2 size={20} className="text-[#00FF41]" />
            Links Gerenciáveis
          </h1>
          <p className="text-sm text-white/35 mt-0.5">
            Crie links curtos, altere destinos e acompanhe cliques.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="btn-primary flex items-center justify-center gap-2 px-5 py-2.5 text-sm"
        >
          <Plus size={15} /> Novo Link
        </button>
      </div>

      {/* Aviso de domínio não configurado */}
      {!hasConfiguredDomain() && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
          <Globe size={14} className="text-amber-400/70 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-white/45 leading-relaxed">
            <span className="text-amber-300/90 font-medium">Domínio de redirect não configurado.</span>{" "}
            Os links usam <span className="font-mono text-white/60">{redirectBase()}</span>. Defina{" "}
            <span className="font-mono text-white/60">NEXT_PUBLIC_REDIRECT_BASE_URL</span> (ex.{" "}
            <span className="font-mono text-white/60">https://go.seudominio.com</span>) para divulgar o domínio definitivo.
            Links já criados continuam funcionando — só o slug importa.
          </p>
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          icon={Link2} accent="matrix" label="Links ativos"
          value={String(overview?.active_links ?? 0)}
          sub={overview ? `${overview.total_links} no total` : undefined}
        />
        <MetricCard
          icon={MousePointerClick} accent="electric" label="Cliques totais"
          value={compact(overview?.total_clicks ?? 0)}
          sub="desde a criação"
        />
        <MetricCard
          icon={Calendar} accent="electric" label="Cliques hoje"
          value={compact(overview?.clicks_today ?? 0)}
          sub={overview ? `${compact(overview.clicks_window)} em ${overview.window_days} dias` : undefined}
        />
        <MetricCard
          icon={BarChart3} accent="amber" label="Mais acessado"
          value={overview?.top_link ? compact(overview.top_link.click_count) : "—"}
          sub={overview?.top_link ? (overview.top_link.name || `/r/${overview.top_link.slug}`) : "sem cliques ainda"}
        />
      </div>

      {/* Notificação */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={cn(
              "flex items-center gap-2 px-4 py-3 rounded-xl border text-sm",
              notice.type === "success"
                ? "bg-[#00FF41]/[0.06] border-[#00FF41]/20 text-[#00FF41]"
                : "bg-red-500/10 border-red-500/20 text-red-400"
            )}
          >
            {notice.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
            {notice.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          ["todos", `Todos (${counts.todos})`],
          ["active", `Ativos (${counts.active})`],
          ["paused", `Pausados (${counts.paused})`],
          ["archived", `Arquivados (${counts.archived})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key as "todos" | LinkStatus)}
            className={cn(
              "text-xs px-3.5 py-2 rounded-xl font-semibold border transition-all",
              filter === key
                ? "bg-[#00FF41]/10 border-[#00FF41]/25 text-[#00FF41]"
                : "bg-white/[0.02] border-white/[0.06] text-white/40 hover:text-white/70"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card rounded-2xl h-28 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <Link2 size={26} className="text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40">
            {filter === "todos" ? "Nenhum link criado ainda." : "Nenhum link com esse status."}
          </p>
          {filter === "todos" && (
            <button
              onClick={() => { setEditing(null); setModalOpen(true); }}
              className="btn-primary inline-flex items-center gap-2 mt-4 px-4 py-2 text-xs"
            >
              <Plus size={13} /> Criar o primeiro link
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {visible.map((link) => (
              <LinkCard
                key={link.id}
                link={link}
                copied={copiedId === link.id}
                busy={busyId === link.id}
                confirmDelete={confirmDeleteId === link.id}
                onCopy={() => handleCopy(link)}
                onEdit={() => { setEditing(link); setModalOpen(true); }}
                onToggleStatus={() => patchLink(
                  link,
                  { status: link.status === "active" ? "paused" : "active" },
                  link.status === "active" ? "Link pausado." : "Link ativado."
                )}
                onArchive={() => patchLink(
                  link,
                  { status: link.status === "archived" ? "active" : "archived" },
                  link.status === "archived" ? "Link reativado." : "Link arquivado."
                )}
                onAskDelete={() => setConfirmDeleteId(link.id)}
                onDelete={() => handleDelete(link)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {modalOpen && (
          <LinkModal
            editing={editing}
            accounts={accounts}
            campaigns={campaigns}
            onClose={() => { setModalOpen(false); setEditing(null); }}
            onSaved={(link, isNew) => {
              setModalOpen(false);
              setEditing(null);
              setNotice({ type: "success", message: isNew ? "Link criado." : "Link atualizado." });
              if (isNew) setLinks((prev) => [link, ...prev]);
              else setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, ...link } : l)));
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
