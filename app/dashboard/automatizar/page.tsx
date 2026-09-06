"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Bot, Pencil, Trash2, X, ChevronDown, ChevronUp,
  Folder, Film, Clock, Loader2, AlertCircle, Sparkles, Users, Search, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VideoProcessingSelector, type VideoProcessingMode } from "@/components/dashboard/VideoProcessingSelector";

// Valor fixo enviado como auto_caption_type — não há mais seleção de categoria,
// o pool em lib/auto-captions.ts é único e cobre temas livres.
const AUTO_CAPTION_TYPE_VALUE = "curiosidades-gerais";

const AUTO_CAPTION_PREVIEW =
  "3 atitudes de quem tem produtividade real:\n\n1️⃣ Priorizar, não preencher agenda.\n2️⃣ Dormir antes de trabalhar.\n3️⃣ Eliminar antes de delegar.\n\nSalva pra reler quando precisar.\n\n#produtividade #foco #rotina";

interface AccountFolder { id: string; name: string; account_count?: number; }
interface VideoFolder   { id: string; name: string; video_count?: number; }
interface Automation {
  id: string;
  name: string;
  posts_per_day: number;
  offset_seconds: number;
  active: boolean;
  captions: string[];
  auto_caption_enabled: boolean;
  auto_caption_type: string | null;
  video_processing_mode?: string | null;
  account_folders: { id: string; name: string }[];
  video_folders: { id: string; name: string }[];
  account_count: number;
  pending_posts: number;
  published_today: number;
  next_post_at: string | null;
  created_at: string;
}

interface AccountDetail {
  id: string;
  username: string;
  avatar_url: string | null;
  health_status: string;
  is_active: boolean;
  published_today: number;
  last_published_at: string | null;
  pending: number;
  next_scheduled_at: string | null;
  failed_today: number;
  last_error: string | null;
  status: "publicado" | "na_fila" | "erro_conta" | "inativa" | "falhou" | "sem_atividade";
}

const ACCOUNT_STATUS_LABEL: Record<AccountDetail["status"], { label: string; color: string; bg: string }> = {
  publicado:      { label: "Publicou hoje", color: "#00FF41", bg: "rgba(0,255,65,0.08)" },
  na_fila:        { label: "Na fila",        color: "#00E5FF", bg: "rgba(0,229,255,0.08)" },
  falhou:         { label: "Falhou hoje",    color: "#f87171", bg: "rgba(248,113,113,0.08)" },
  erro_conta:     { label: "Conta com erro", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
  inativa:        { label: "Inativa",        color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.04)" },
  sem_atividade:  { label: "Sem atividade",  color: "rgba(255,255,255,0.5)", bg: "rgba(255,255,255,0.04)" },
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const past = diffMs < 0;
  const diffMin = Math.round(Math.abs(diffMs) / 60000);
  let label: string;
  if (diffMin < 1) label = "agora";
  else if (diffMin < 60) label = `${diffMin} min`;
  else {
    const h = Math.floor(diffMin / 60);
    const rem = diffMin % 60;
    label = `${h}h${rem > 0 ? ` ${rem}min` : ""}`;
  }
  if (label === "agora") return "agora";
  return past ? `há ${label}` : `em ${label}`;
}

function formatNextPost(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "em breve";
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "em breve";
  if (diffMin < 60) return `em ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  const rem = diffMin % 60;
  return `em ${diffH}h${rem > 0 ? ` ${rem}min` : ""}`;
}

const DEFAULT_FORM = {
  name: "Nova automação",
  posts_per_day: 12,
  offset_seconds: 30,
  active: false,
  captions: "",
  auto_caption_enabled: false,
  auto_caption_type: AUTO_CAPTION_TYPE_VALUE as string,
  video_processing_mode: "original" as VideoProcessingMode,
  account_folder_ids: [] as string[],
  video_folder_ids: [] as string[],
};

function gapLabel(ppd: number) {
  const min = Math.floor(1440 / ppd);
  return min >= 60 ? `~${(min / 60).toFixed(1).replace(".0", "")}h` : `~${min} min`;
}

function AutomationModal({
  open, onClose, editing, accountFolders, videoFolders, onSaved,
}: {
  open: boolean; onClose: () => void;
  editing: Automation | null;
  accountFolders: AccountFolder[]; videoFolders: VideoFolder[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      if (editing) {
        setForm({
          name: editing.name,
          posts_per_day: editing.posts_per_day,
          offset_seconds: editing.offset_seconds,
          active: editing.active,
          captions: editing.captions?.join("\n") ?? "",
          auto_caption_enabled: editing.auto_caption_enabled ?? false,
          auto_caption_type: editing.auto_caption_type ?? AUTO_CAPTION_TYPE_VALUE,
          video_processing_mode:
            editing.video_processing_mode === "clean_metadata" ? "clean_metadata" : "original",
          account_folder_ids: editing.account_folders.map((f) => f.id),
          video_folder_ids: editing.video_folders.map((f) => f.id),
        });
      } else {
        setForm({ ...DEFAULT_FORM });
      }
      setError("");
    }
  }, [open, editing]);

  const toggleFolder = (id: string, type: "account" | "video") => {
    const key = type === "account" ? "account_folder_ids" : "video_folder_ids";
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(id) ? prev[key].filter((x) => x !== id) : [...prev[key], id],
    }));
  };

  const toggleAllFolders = (type: "account" | "video", allIds: string[]) => {
    const key = type === "account" ? "account_folder_ids" : "video_folder_ids";
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].length === allIds.length ? [] : allIds,
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Nome é obrigatório."); return; }
    if (!form.account_folder_ids.length) { setError("Selecione ao menos uma pasta de contas."); return; }
    if (!form.video_folder_ids.length) { setError("Selecione ao menos uma pasta de vídeos."); return; }
    setSaving(true); setError("");
    try {
      const body = {
        name: form.name.trim(),
        posts_per_day: form.posts_per_day,
        offset_seconds: form.offset_seconds,
        active: form.active,
        captions: form.auto_caption_enabled ? [] : form.captions.split("\n").map((c) => c.trim()).filter(Boolean),
        auto_caption_enabled: form.auto_caption_enabled,
        auto_caption_type: form.auto_caption_enabled ? form.auto_caption_type : null,
        video_processing_mode: form.video_processing_mode,
        account_folder_ids: form.account_folder_ids,
        video_folder_ids: form.video_folder_ids,
      };
      const url  = editing ? `/api/automations/${editing.id}` : "/api/automations";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro ao salvar"); }
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="glass relative w-full max-w-lg rounded-2xl border border-white/10 p-6 z-10 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">
                {editing ? "Editar automação" : "Nova automação"}
              </h2>
              <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              {/* Nome */}
              <div>
                <label className="block text-xs text-white/50 mb-1.5 font-medium">Nome</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="input-glass w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20"
                  placeholder="Nome da automação"
                />
              </div>

              {/* Pastas de contas */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs text-white/50 font-medium">
                    Pastas de contas ({form.account_folder_ids.length})
                  </label>
                  {accountFolders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleAllFolders("account", accountFolders.map((f) => f.id))}
                      className="text-[11px] text-[#00FF41]/70 hover:text-[#00FF41] transition-colors"
                    >
                      {form.account_folder_ids.length === accountFolders.length ? "Limpar" : "Selecionar todas"}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {accountFolders.length === 0 && (
                    <p className="text-xs text-white/25 col-span-2">Nenhuma pasta de contas criada.</p>
                  )}
                  {accountFolders.map((f) => {
                    const sel = form.account_folder_ids.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        onClick={() => toggleFolder(f.id, "account")}
                        className={cn(
                          "px-3 py-2 rounded-xl text-xs font-medium border transition-all text-left",
                          sel
                            ? "bg-[#00FF41]/10 border-[#00FF41]/40 text-[#00FF41]"
                            : "bg-white/[0.03] border-white/[0.08] text-white/50 hover:text-white/80 hover:border-white/20"
                        )}
                      >
                        {f.name}
                        {f.account_count !== undefined && (
                          <span className="ml-1 opacity-50">({f.account_count})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pastas de vídeos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs text-white/50 font-medium">
                    Pastas de vídeos ({form.video_folder_ids.length})
                  </label>
                  {videoFolders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleAllFolders("video", videoFolders.map((f) => f.id))}
                      className="text-[11px] text-[#00E5FF]/70 hover:text-[#00E5FF] transition-colors"
                    >
                      {form.video_folder_ids.length === videoFolders.length ? "Limpar" : "Selecionar todas"}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {videoFolders.length === 0 && (
                    <p className="text-xs text-white/25 col-span-2">Nenhuma pasta de vídeos criada.</p>
                  )}
                  {videoFolders.map((f) => {
                    const sel = form.video_folder_ids.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        onClick={() => toggleFolder(f.id, "video")}
                        className={cn(
                          "px-3 py-2 rounded-xl text-xs font-medium border transition-all text-left",
                          sel
                            ? "bg-[#00E5FF]/10 border-[#00E5FF]/40 text-[#00E5FF]"
                            : "bg-white/[0.03] border-white/[0.08] text-white/50 hover:text-white/80 hover:border-white/20"
                        )}
                      >
                        {f.name}
                        {f.video_count !== undefined && (
                          <span className="ml-1 opacity-50">({f.video_count})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Posts/dia + Offset */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/50 mb-1.5 font-medium">Posts por dia / conta</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={1} max={144}
                      value={form.posts_per_day}
                      onChange={(e) => setForm((p) => ({ ...p, posts_per_day: Math.max(1, Math.min(144, +e.target.value)) }))}
                      className="input-glass w-full px-3 py-2.5 rounded-xl text-sm text-white text-center"
                    />
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => setForm((p) => ({ ...p, posts_per_day: Math.min(144, p.posts_per_day + 1) }))}
                        className="w-6 h-5 flex items-center justify-center rounded text-white/40 hover:text-white bg-white/[0.04] hover:bg-white/[0.08]">
                        <ChevronUp size={10} />
                      </button>
                      <button onClick={() => setForm((p) => ({ ...p, posts_per_day: Math.max(1, p.posts_per_day - 1) }))}
                        className="w-6 h-5 flex items-center justify-center rounded text-white/40 hover:text-white bg-white/[0.04] hover:bg-white/[0.08]">
                        <ChevronDown size={10} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-white/30 mt-1">Gap derivado: {gapLabel(form.posts_per_day)}</p>
                </div>

                <div>
                  <label className="block text-xs text-white/50 mb-1.5 font-medium">Offset entre contas (s)</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={0} max={3600}
                      value={form.offset_seconds}
                      onChange={(e) => setForm((p) => ({ ...p, offset_seconds: Math.max(0, +e.target.value) }))}
                      className="input-glass w-full px-3 py-2.5 rounded-xl text-sm text-white text-center"
                    />
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => setForm((p) => ({ ...p, offset_seconds: p.offset_seconds + 5 }))}
                        className="w-6 h-5 flex items-center justify-center rounded text-white/40 hover:text-white bg-white/[0.04] hover:bg-white/[0.08]">
                        <ChevronUp size={10} />
                      </button>
                      <button onClick={() => setForm((p) => ({ ...p, offset_seconds: Math.max(0, p.offset_seconds - 5) }))}
                        className="w-6 h-5 flex items-center justify-center rounded text-white/40 hover:bg-white/[0.08] bg-white/[0.04]">
                        <ChevronDown size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Toggle ativa */}
              <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                <div>
                  <p className="text-sm text-white font-medium">Automação ativa</p>
                  <p className="text-[11px] text-white/35 mt-0.5">
                    Quando ligada, o motor enfileira sozinho a cada 1 min.
                  </p>
                </div>
                <button
                  onClick={() => setForm((p) => ({ ...p, active: !p.active }))}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-all flex-shrink-0",
                    form.active ? "bg-[#00FF41]" : "bg-white/10"
                  )}
                >
                  <span className={cn(
                    "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
                    form.active ? "left-[22px]" : "left-0.5"
                  )} />
                </button>
              </div>

              {/* Legendas Automáticas */}
              <div className="p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Sparkles size={13} style={{ color: "var(--matrix)" }} />
                    <div>
                      <p className="text-sm font-medium text-white/80">Legendas Automáticas</p>
                      <p className="text-[10px] text-white/35">Curiosidades únicas em PT-BR por post</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setForm((p) => ({ ...p, auto_caption_enabled: !p.auto_caption_enabled }))}
                    className={cn(
                      "relative w-11 h-6 rounded-full transition-all flex-shrink-0",
                      form.auto_caption_enabled ? "bg-[#00FF41]" : "bg-white/10"
                    )}
                  >
                    <span className={cn(
                      "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
                      form.auto_caption_enabled ? "left-[22px]" : "left-0.5"
                    )} />
                  </button>
                </div>
                <AnimatePresence>
                  {form.auto_caption_enabled && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 p-2.5 rounded-lg bg-black/30 border border-white/[0.05]">
                        <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1">Exemplo (cada post recebe uma legenda diferente)</p>
                        <p className="text-[10px] text-white/50 leading-relaxed italic whitespace-pre-line">
                          {AUTO_CAPTION_PREVIEW}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Captions manuais — ocultas quando auto está ativo */}
              {!form.auto_caption_enabled && (
                <div>
                  <label className="block text-xs text-white/50 mb-1.5 font-medium">
                    Captions (uma por linha — opcional)
                  </label>
                  <textarea
                    value={form.captions}
                    onChange={(e) => setForm((p) => ({ ...p, captions: e.target.value }))}
                    rows={4}
                    placeholder="Deixe vazio para postar sem legenda"
                    className="input-glass w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 resize-none"
                  />
                </div>
              )}

              {/* Processamento do vídeo */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <SlidersHorizontal size={13} className="text-white/35" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-white/35">
                    Processamento do vídeo
                  </span>
                </div>
                <VideoProcessingSelector
                  value={form.video_processing_mode}
                  onChange={(v) => setForm((p) => ({ ...p, video_processing_mode: v }))}
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle size={12} /> {error}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm text-white/40 hover:text-white border border-white/10 hover:border-white/20 transition-all">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className="btn-primary flex items-center gap-2 px-5 py-2 text-sm font-semibold disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const ACCOUNT_FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "publicado", label: "Publicaram" },
  { id: "na_fila", label: "Na fila" },
  { id: "sem_atividade", label: "Sem atividade" },
  { id: "erro_conta", label: "Com erro" },
] as const;

function AccountsDetailModal({
  open, onClose, automationId, automationName,
}: {
  open: boolean; onClose: () => void;
  automationId: string | null; automationName: string;
}) {
  const [accounts, setAccounts] = useState<AccountDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<typeof ACCOUNT_FILTERS[number]["id"]>("todas");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open || !automationId) return;
    setLoading(true);
    fetch(`/api/automations/${automationId}/accounts`)
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []))
      .finally(() => setLoading(false));
  }, [open, automationId]);

  const filtered = accounts.filter((a) => {
    if (filter !== "todas" && a.status !== filter) return false;
    if (search && !a.username.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    todas: accounts.length,
    publicado: accounts.filter((a) => a.status === "publicado").length,
    na_fila: accounts.filter((a) => a.status === "na_fila").length,
    sem_atividade: accounts.filter((a) => a.status === "sem_atividade").length,
    erro_conta: accounts.filter((a) => a.status === "erro_conta" || a.status === "inativa" || a.status === "falhou").length,
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="glass relative w-full max-w-2xl rounded-2xl border border-white/10 p-6 z-10 max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">Contas — {automationName}</h2>
                <p className="text-xs text-white/35 mt-0.5">
                  {counts.publicado} publicaram hoje · {counts.na_fila} na fila · {counts.sem_atividade} sem atividade
                </p>
              </div>
              <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar @usuário..."
                  className="input-glass w-full pl-8 pr-3 py-2 rounded-xl text-xs text-white placeholder-white/20"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 mb-4 flex-wrap">
              {ACCOUNT_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                    filter === f.id
                      ? "bg-[#00FF41]/10 border-[#00FF41]/40 text-[#00FF41]"
                      : "bg-white/[0.03] border-white/[0.08] text-white/45 hover:text-white/70"
                  )}
                >
                  {f.label} ({counts[f.id]})
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 -mx-2 px-2 space-y-1.5">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={20} className="animate-spin text-white/30" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-xs text-white/25 py-16">Nenhuma conta encontrada.</p>
              ) : (
                filtered.map((a) => {
                  const s = ACCOUNT_STATUS_LABEL[a.status];
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {a.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-white/10 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white truncate">@{a.username}</p>
                          <p className="text-[10px] text-white/30 mt-0.5">
                            {a.status === "publicado" && `último post ${formatRelative(a.last_published_at)}`}
                            {a.status === "na_fila" && `próximo ${formatRelative(a.next_scheduled_at)}`}
                            {a.status === "falhou" && (a.last_error ? a.last_error.slice(0, 50) : "falha recente")}
                            {a.status === "erro_conta" && "reconecte a conta"}
                            {a.status === "inativa" && "ative na aba Contas"}
                            {a.status === "sem_atividade" && "ainda não entrou no ciclo"}
                          </p>
                        </div>
                      </div>
                      <span
                        className="text-[10px] font-semibold px-2 py-1 rounded-md flex-shrink-0"
                        style={{ color: s.color, background: s.bg }}
                      >
                        {s.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AutomationCard({
  automation, onEdit, onDelete, onToggle, onShowAccounts,
}: {
  automation: Automation;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onShowAccounts: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    await onToggle();
    setToggling(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "glass-card rounded-2xl p-5 border transition-all",
        automation.active
          ? "border-[#00FF41]/25 shadow-[0_0_20px_rgba(0,255,65,0.06)]"
          : "border-white/[0.07]"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className={cn(
              "w-2 h-2 rounded-full flex-shrink-0",
              automation.active ? "bg-[#00FF41] shadow-[0_0_6px_rgba(0,255,65,0.8)]" : "bg-white/20"
            )} />
            <h3 className="font-bold text-white text-sm truncate">{automation.name}</h3>
          </div>
          <p className="text-[11px] text-white/30">
            {automation.active ? "Ativa" : "Pausada"} · {automation.account_count} conta{automation.account_count !== 1 ? "s" : ""} · {automation.pending_posts} post{automation.pending_posts !== 1 ? "s" : ""} na fila
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={onShowAccounts}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.06] transition-all">
            <Users size={13} />
          </button>
          <button onClick={handleToggle} disabled={toggling}
            className={cn(
              "relative w-10 h-5.5 rounded-full transition-all",
              automation.active ? "bg-[#00FF41]" : "bg-white/10",
              "flex items-center"
            )}
            style={{ height: 22, width: 40 }}
          >
            <span className={cn(
              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
              automation.active ? "left-[22px]" : "left-0.5"
            )} />
          </button>
          <button onClick={onEdit}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.06] transition-all">
            <Pencil size={13} />
          </button>
          <button
            onClick={() => { if (confirmDelete) { onDelete(); setConfirmDelete(false); } else setConfirmDelete(true); }}
            onBlur={() => setTimeout(() => setConfirmDelete(false), 200)}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
              confirmDelete
                ? "bg-red-600/20 border border-red-500/40 text-red-400"
                : "text-white/35 hover:text-red-400 hover:bg-white/[0.06]"
            )}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#00FF41]">{automation.posts_per_day}</p>
          <p className="text-[10px] text-white/30 mt-0.5">posts/dia · conta</p>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#00E5FF]">{automation.posts_per_day * automation.account_count}</p>
          <p className="text-[10px] text-white/30 mt-0.5">total/dia ({automation.account_count}c)</p>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-white/70">{gapLabel(automation.posts_per_day)}</p>
          <p className="text-[10px] text-white/30 mt-0.5">gap/conta</p>
        </div>
      </div>

      {/* Pastas */}
      <div className="space-y-2 mb-4">
        {automation.account_folders.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Folder size={11} className="text-white/30 flex-shrink-0" />
            {automation.account_folders.map((f) => (
              <span key={f.id} className="text-[10px] px-2 py-0.5 rounded-md bg-[#00FF41]/[0.08] border border-[#00FF41]/20 text-[#00FF41]/80">
                {f.name}
              </span>
            ))}
          </div>
        )}
        {automation.video_folders.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Film size={11} className="text-white/30 flex-shrink-0" />
            {automation.video_folders.map((f) => (
              <span key={f.id} className="text-[10px] px-2 py-0.5 rounded-md bg-[#00E5FF]/[0.08] border border-[#00E5FF]/20 text-[#00E5FF]/80">
                {f.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Progresso diário */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2.5">
        {/* Barra de progresso */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-white/40">Progresso hoje (todas as contas)</span>
            <span className="text-[10px] font-semibold text-white/60">
              {automation.published_today} / {automation.posts_per_day * automation.account_count} posts
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (automation.published_today / Math.max(1, automation.posts_per_day * automation.account_count)) * 100)}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #00FF41, #00E5FF)" }}
            />
          </div>
        </div>

        {/* Stats linha */}
        <div className="grid grid-cols-3 gap-2 pt-0.5">
          <div className="text-center">
            <p className="text-[11px] font-bold text-[#00FF41]">{automation.published_today}</p>
            <p className="text-[9px] text-white/30 mt-0.5">publicados</p>
          </div>
          <div className="text-center border-x border-white/[0.06]">
            <p className="text-[11px] font-bold text-white/60">{automation.pending_posts}</p>
            <p className="text-[9px] text-white/30 mt-0.5">na fila</p>
          </div>
          <div className="text-center">
            <p className="text-[11px] font-bold text-[#00E5FF] truncate">{formatNextPost(automation.next_post_at)}</p>
            <p className="text-[9px] text-white/30 mt-0.5">próximo</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function AutomatizarPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [accountFolders, setAccountFolders] = useState<AccountFolder[]>([]);
  const [videoFolders, setVideoFolders] = useState<VideoFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [accountsModal, setAccountsModal] = useState<{ id: string; name: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [autoRes, afRes, vfRes] = await Promise.all([
      fetch("/api/automations").then((r) => r.json()),
      fetch("/api/accounts/folders").then((r) => r.json()),
      fetch("/api/library/folders").then((r) => r.json()),
    ]);
    setAutomations(autoRes.automations ?? []);
    setAccountFolders(afRes.folders ?? []);
    setVideoFolders(vfRes.folders ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("DELETE falhou");
      setAutomations((prev) => prev.filter((a) => a.id !== id));
    } catch {
      window.alert("Não foi possível excluir a automação. Tente novamente.");
    }
  };

  const handleToggle = async (automation: Automation) => {
    const newActive = !automation.active;
    try {
      const res = await fetch(`/api/automations/${automation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: newActive }),
      });
      if (!res.ok) throw new Error("PATCH falhou");
      setAutomations((prev) => prev.map((a) => a.id === automation.id ? { ...a, active: newActive } : a));
    } catch {
      window.alert("Não foi possível alterar o status da automação. Tente novamente.");
    }
  };

  const activeCount = automations.filter((a) => a.active).length;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Automatizar Contas</h1>
          <p className="text-sm text-white/35 mt-0.5">
            {automations.length} automação{automations.length !== 1 ? "ões" : ""} · {activeCount} ativa{activeCount !== 1 ? "s" : ""}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
        >
          <Plus size={15} />
          Nova automação
        </motion.button>
      </motion.div>

      {/* Estados */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="glass-card rounded-2xl h-52 animate-pulse bg-white/[0.02]" />
          ))}
        </div>
      ) : automations.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="glass-card rounded-2xl flex flex-col items-center gap-4 py-20 text-center px-6">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            <Bot size={24} className="text-white/20" />
          </div>
          <div>
            <p className="text-white/50 font-medium">Nenhuma automação criada</p>
            <p className="text-white/25 text-sm mt-1">Crie uma automação para enfileirar posts automaticamente.</p>
          </div>
          <button
            onClick={() => { setEditing(null); setModalOpen(true); }}
            className="btn-primary flex items-center gap-2 text-sm px-5 py-2.5"
          >
            <Plus size={14} /> Nova automação
          </button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence>
            {automations.map((a) => (
              <AutomationCard
                key={a.id}
                automation={a}
                onEdit={() => { setEditing(a); setModalOpen(true); }}
                onDelete={() => handleDelete(a.id)}
                onToggle={() => handleToggle(a)}
                onShowAccounts={() => setAccountsModal({ id: a.id, name: a.name })}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Info */}
      {automations.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
          <Clock size={13} className="text-white/25 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-white/30 leading-relaxed">
            O motor verifica as automações ativas a cada minuto e cria posts em{" "}
            <span className="text-white/50">Postagens Agendadas</span> automaticamente. Posts são processados pelo pipeline de publicação existente.
          </p>
        </motion.div>
      )}

      <AutomationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        accountFolders={accountFolders}
        videoFolders={videoFolders}
        onSaved={loadAll}
      />

      <AccountsDetailModal
        open={!!accountsModal}
        onClose={() => setAccountsModal(null)}
        automationId={accountsModal?.id ?? null}
        automationName={accountsModal?.name ?? ""}
      />
    </div>
  );
}
