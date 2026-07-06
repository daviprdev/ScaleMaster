"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Bot, Pencil, Trash2, Power, X, ChevronDown, ChevronUp,
  Folder, Film, Clock, Loader2, CheckCircle2, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AccountFolder { id: string; name: string; account_count?: number; }
interface VideoFolder   { id: string; name: string; video_count?: number; }
interface Automation {
  id: string;
  name: string;
  posts_per_day: number;
  offset_seconds: number;
  active: boolean;
  captions: string[];
  account_folders: { id: string; name: string }[];
  video_folders: { id: string; name: string }[];
  pending_posts: number;
  created_at: string;
}

const DEFAULT_FORM = {
  name: "Nova automação",
  posts_per_day: 12,
  offset_seconds: 30,
  active: false,
  captions: "",
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
        captions: form.captions.split("\n").map((c) => c.trim()).filter(Boolean),
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
                <label className="block text-xs text-white/50 mb-2 font-medium">
                  Pastas de contas ({form.account_folder_ids.length})
                </label>
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
                <label className="block text-xs text-white/50 mb-2 font-medium">
                  Pastas de vídeos ({form.video_folder_ids.length})
                </label>
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

              {/* Captions */}
              <div>
                <label className="block text-xs text-white/50 mb-1.5 font-medium">
                  Captions (uma por linha — opcional)
                </label>
                <textarea
                  value={form.captions}
                  onChange={(e) => setForm((p) => ({ ...p, captions: e.target.value }))}
                  rows={4}
                  placeholder="Deixe vazio para usar captions padrão"
                  className="input-glass w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 resize-none"
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

function AutomationCard({
  automation, onEdit, onDelete, onToggle,
}: {
  automation: Automation;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
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
            {automation.active ? "Ativa" : "Pausada"} · {automation.pending_posts} post{automation.pending_posts !== 1 ? "s" : ""} na fila
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
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
          <p className="text-[10px] text-white/30 mt-0.5">posts/dia</p>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#00E5FF]">{gapLabel(automation.posts_per_day)}</p>
          <p className="text-[10px] text-white/30 mt-0.5">gap</p>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-white/70">{automation.offset_seconds}s</p>
          <p className="text-[10px] text-white/30 mt-0.5">offset</p>
        </div>
      </div>

      {/* Pastas */}
      <div className="space-y-2">
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
    await fetch(`/api/automations/${id}`, { method: "DELETE" });
    setAutomations((prev) => prev.filter((a) => a.id !== id));
  };

  const handleToggle = async (automation: Automation) => {
    const newActive = !automation.active;
    await fetch(`/api/automations/${automation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: newActive }),
    });
    setAutomations((prev) => prev.map((a) => a.id === automation.id ? { ...a, active: newActive } : a));
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
    </div>
  );
}
