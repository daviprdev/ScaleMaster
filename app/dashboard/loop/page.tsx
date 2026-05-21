"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Repeat2, Plus, Play, Pause, Trash2, Edit3, X,
  Folder, Users, Clock, Infinity, Hash, Type,
  ImageIcon, FlipHorizontal, Contrast, Check,
  Loader2, AlertCircle, ChevronDown, Info, Film,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
}

interface Folder {
  id: string;
  name: string;
}

interface LoopAccountData {
  account_id: string;
  instagram_accounts?: Account | null;
}

interface Loop {
  id: string;
  name: string;
  folder_id: string | null;
  is_infinite: boolean;
  cycles: number;
  interval_minutes: number;
  media_limit: number | null;
  captions: string[];
  cover_image_url: string | null;
  effect_mirror: boolean;
  effect_invert: boolean;
  status: "active" | "paused";
  created_at: string;
  loop_accounts?: LoopAccountData[];
  library_folders?: Folder | null;
}

interface FormData {
  name: string;
  accountIds: string[];
  folderId: string;
  isInfinite: boolean;
  cycles: number;
  intervalMinutes: number;
  mediaLimit: number | null;
  captions: string[];
  coverFile: File | null;
  coverPreviewUrl: string | null;
  effectMirror: boolean;
  effectInvert: boolean;
}

const DEFAULT_FORM: FormData = {
  name: "",
  accountIds: [],
  folderId: "",
  isInfinite: true,
  cycles: 1,
  intervalMinutes: 30,
  mediaLimit: null,
  captions: [""],
  coverFile: null,
  coverPreviewUrl: null,
  effectMirror: false,
  effectInvert: false,
};

// ── Helpers ───────────────────────────────────────────────────

function formatInterval(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}min`;
}

// ── Toggle component ──────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex w-11 h-6 rounded-full transition-all duration-200 focus:outline-none flex-shrink-0",
        checked
          ? "bg-violet-600 shadow-[0_0_10px_rgba(139,92,246,0.4)]"
          : "bg-white/10"
      )}
    >
      <span className={cn(
        "inline-block w-4 h-4 mt-1 rounded-full bg-white shadow-sm transition-transform duration-200",
        checked ? "translate-x-6" : "translate-x-1"
      )} />
    </button>
  );
}

// ── SectionLabel ─────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={13} className="text-violet-400/80" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">{label}</span>
    </div>
  );
}

// ── LoopCard ──────────────────────────────────────────────────

function LoopCard({
  loop,
  onToggleStatus,
  onEdit,
  onDelete,
}: {
  loop: Loop;
  onToggleStatus: (loop: Loop) => void;
  onEdit: (loop: Loop) => void;
  onDelete: (loop: Loop) => void;
}) {
  const accounts = loop.loop_accounts?.map(la => la.instagram_accounts).filter(Boolean) as Account[] ?? [];
  const isActive = loop.status === "active";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="glass-card p-5 space-y-4 hover:border-white/15 transition-all duration-200"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
            isActive
              ? "bg-violet-600/20 shadow-[0_0_12px_rgba(139,92,246,0.25)]"
              : "bg-white/[0.04]"
          )}>
            <Repeat2 size={16} className={isActive ? "text-violet-400" : "text-white/25"} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/90 truncate">{loop.name}</p>
            <p className="text-[11px] text-white/30 mt-0.5">
              {loop.library_folders?.name ?? "Sem pasta"}
            </p>
          </div>
        </div>
        {/* Status badge */}
        <span className={cn(
          "flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
          isActive
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-white/[0.04] text-white/30 border-white/[0.07]"
        )}>
          {isActive ? "Ativo" : "Pausado"}
        </span>
      </div>

      {/* Info row */}
      <div className="flex items-center gap-4 text-[11px] text-white/35">
        <span className="flex items-center gap-1.5">
          {loop.is_infinite
            ? <><Infinity size={11} /> Infinito</>
            : <><Hash size={11} /> {loop.cycles} ciclo{loop.cycles !== 1 ? "s" : ""}</>}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock size={11} />
          {formatInterval(loop.interval_minutes)}
        </span>
        {(loop.effect_mirror || loop.effect_invert) && (
          <span className="flex items-center gap-1">
            {loop.effect_mirror && <FlipHorizontal size={10} className="text-cyan-400/60" />}
            {loop.effect_invert && <Contrast size={10} className="text-cyan-400/60" />}
          </span>
        )}
      </div>

      {/* Accounts */}
      {accounts.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {accounts.slice(0, 5).map(acc => (
            <div
              key={acc.id}
              title={`@${acc.username}`}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/[0.04] border border-white/[0.07]"
            >
              <div className="w-4 h-4 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">
                {acc.username.charAt(0).toUpperCase()}
              </div>
              <span className="text-[10px] text-white/50">@{acc.username}</span>
            </div>
          ))}
          {accounts.length > 5 && (
            <span className="text-[10px] text-white/25">+{accounts.length - 5}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-white/[0.05]">
        <button
          onClick={() => onToggleStatus(loop)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150",
            isActive
              ? "bg-white/[0.05] text-white/50 hover:bg-amber-500/10 hover:text-amber-400 border border-transparent hover:border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
          )}
        >
          {isActive ? <Pause size={11} /> : <Play size={11} />}
          {isActive ? "Pausar" : "Retomar"}
        </button>
        <button
          onClick={() => onEdit(loop)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-all duration-150"
        >
          <Edit3 size={11} />
          Editar
        </button>
        <button
          onClick={() => onDelete(loop)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/25 hover:text-red-400 hover:bg-red-500/[0.07] transition-all duration-150"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </motion.div>
  );
}

// ── MediaLimitSelector ────────────────────────────────────────

const LIMIT_PRESETS = [null, 5, 10, 20] as const;

function MediaLimitSelector({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const isCustom = value !== null && !(LIMIT_PRESETS as readonly (number | null)[]).includes(value);
  const [customStr, setCustomStr] = useState(() => (isCustom ? String(value) : ""));

  const activateCustom = () => {
    const n = Math.max(1, Number(customStr) || 1);
    setCustomStr(String(n));
    onChange(n);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { label: "Toda a pasta", v: null as number | null | "custom" },
            { label: "5 vídeos", v: 5 as number | null | "custom" },
            { label: "10 vídeos", v: 10 as number | null | "custom" },
            { label: "20 vídeos", v: 20 as number | null | "custom" },
            { label: "Personalizado", v: "custom" as number | null | "custom" },
          ] as { label: string; v: number | null | "custom" }[]
        ).map(({ label, v }) => {
          const active = v === "custom" ? isCustom : value === v;
          return (
            <button
              key={String(v)}
              type="button"
              onClick={() => (v === "custom" ? activateCustom() : onChange(v as number | null))}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150",
                active
                  ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
                  : "bg-white/[0.03] border-white/[0.08] text-white/50 hover:text-white/80 hover:border-white/20"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {isCustom && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.07] bg-white/[0.03]">
              <label className="text-xs text-white/50 flex-shrink-0">Quantidade exata:</label>
              <input
                type="number"
                min={1}
                max={999}
                value={customStr}
                onChange={e => {
                  setCustomStr(e.target.value);
                  const n = Math.max(1, Number(e.target.value) || 1);
                  onChange(n);
                }}
                className="input-glass text-sm w-24 text-center py-1.5"
              />
              <span className="text-xs text-white/30">vídeos</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[11px] text-white/25 flex items-start gap-1.5">
        <Info size={10} className="flex-shrink-0 mt-0.5" />
        O loop rotacionará apenas dentro dos vídeos selecionados, ignorando o restante da pasta.
      </p>
    </div>
  );
}

// ── AccountsMultiSelect ───────────────────────────────────────

function AccountsMultiSelect({
  accounts,
  selected,
  onChange,
}: {
  accounts: Account[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  const selectedAccounts = accounts.filter(a => selected.includes(a.id));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm transition-all duration-200",
          "bg-white/[0.06] border-white/10 text-white",
          open ? "border-violet-500/50 ring-1 ring-violet-500/30" : "hover:border-white/20"
        )}
      >
        <span className={selected.length === 0 ? "text-white/30" : "text-white"}>
          {selected.length === 0
            ? "Selecionar contas..."
            : `${selected.length} conta${selected.length > 1 ? "s" : ""} selecionada${selected.length > 1 ? "s" : ""}`}
        </span>
        <ChevronDown size={14} className={cn("text-white/30 transition-transform duration-150", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-xl max-h-52 overflow-y-auto"
          >
            {accounts.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-white/30">
                Nenhuma conta conectada
              </div>
            ) : (
              accounts.map(acc => {
                const isSelected = selected.includes(acc.id);
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => toggle(acc.id)}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors cursor-pointer text-left",
                      isSelected ? "bg-violet-600/10" : "hover:bg-slate-800"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                        {acc.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white/80 text-xs font-medium truncate">@{acc.username}</p>
                        {acc.display_name && (
                          <p className="text-white/35 text-[11px] truncate">{acc.display_name}</p>
                        )}
                      </div>
                    </div>
                    <div className={cn(
                      "w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-all duration-150",
                      isSelected ? "bg-violet-600 border-violet-600" : "border-white/20"
                    )}>
                      {isSelected && <Check size={10} className="text-white" />}
                    </div>
                  </button>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected pills */}
      {selectedAccounts.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedAccounts.map(acc => (
            <span
              key={acc.id}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-violet-600/15 border border-violet-500/25 text-[11px] text-violet-300"
            >
              @{acc.username}
              <button type="button" onClick={() => toggle(acc.id)} className="hover:text-white transition-colors">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LoopFormModal ─────────────────────────────────────────────

function LoopFormModal({
  editingLoop,
  accounts,
  folders,
  onSave,
  onClose,
}: {
  editingLoop: Loop | null;
  accounts: Account[];
  folders: Folder[];
  onSave: (form: FormData, loopId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormData>(() => {
    if (editingLoop) {
      return {
        name: editingLoop.name,
        accountIds: editingLoop.loop_accounts?.map(la => la.account_id) ?? [],
        folderId: editingLoop.folder_id ?? "",
        isInfinite: editingLoop.is_infinite,
        cycles: editingLoop.cycles,
        intervalMinutes: editingLoop.interval_minutes,
        mediaLimit: editingLoop.media_limit ?? null,
        captions: editingLoop.captions.length > 0 ? editingLoop.captions : [""],
        coverFile: null,
        coverPreviewUrl: editingLoop.cover_image_url,
        effectMirror: editingLoop.effect_mirror,
        effectInvert: editingLoop.effect_invert,
      };
    }
    return DEFAULT_FORM;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const addCaption = () => update("captions", [...form.captions, ""]);
  const removeCaption = (i: number) =>
    update("captions", form.captions.filter((_, idx) => idx !== i));
  const updateCaption = (i: number, v: string) =>
    update("captions", form.captions.map((c, idx) => idx === i ? v : c));

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setForm(prev => ({ ...prev, coverFile: file, coverPreviewUrl: previewUrl }));
    e.target.value = "";
  };

  const removeCover = () => setForm(prev => ({ ...prev, coverFile: null, coverPreviewUrl: null }));

  const sliderPct = ((form.intervalMinutes - 10) / (1440 - 10)) * 100;

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError("Dê um nome ao loop."); return; }
    if (form.accountIds.length === 0) { setError("Selecione pelo menos uma conta."); return; }
    if (!form.folderId) { setError("Selecione uma pasta da biblioteca."); return; }
    setError(null);
    setSaving(true);
    try {
      await onSave(form, editingLoop?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.93, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="glass w-full max-w-2xl rounded-2xl border border-white/10 flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-600/20 flex items-center justify-center">
              <Repeat2 size={16} className="text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {editingLoop ? "Editar Loop" : "Novo Loop"}
              </h2>
              <p className="text-xs text-white/35">Configure a publicação automática em ciclo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.05] transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">

          {/* Nome */}
          <div>
            <SectionLabel icon={Type} label="Identificação" />
            <input
              type="text"
              placeholder="Ex: Reels Fitness — Contas Principais"
              value={form.name}
              onChange={e => update("name", e.target.value)}
              className="input-glass w-full text-sm"
              maxLength={80}
            />
          </div>

          {/* Contas */}
          <div>
            <SectionLabel icon={Users} label="Contas do Instagram" />
            <AccountsMultiSelect
              accounts={accounts}
              selected={form.accountIds}
              onChange={ids => update("accountIds", ids)}
            />
          </div>

          {/* Pasta */}
          <div>
            <SectionLabel icon={Folder} label="Pasta da Biblioteca" />
            <select
              value={form.folderId}
              onChange={e => update("folderId", e.target.value)}
              className="input-glass w-full text-sm"
            >
              <option value="">Selecione uma pasta...</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            {folders.length === 0 && (
              <p className="text-xs text-amber-400/60 mt-2 flex items-center gap-1.5">
                <AlertCircle size={11} />
                Nenhuma pasta encontrada. Crie pastas na Biblioteca primeiro.
              </p>
            )}
          </div>

          {/* Limite de mídias */}
          <div>
            <SectionLabel icon={Film} label="Quantidade de mídias por ciclo" />
            <MediaLimitSelector
              value={form.mediaLimit}
              onChange={v => update("mediaLimit", v)}
            />
          </div>

          {/* Ciclos */}
          <div>
            <SectionLabel icon={Hash} label="Ciclos" />
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div>
                  <p className="text-sm text-white/80 font-medium">Loop infinito</p>
                  <p className="text-xs text-white/30 mt-0.5">Repete indefinidamente enquanto ativo</p>
                </div>
                <Toggle checked={form.isInfinite} onChange={v => update("isInfinite", v)} />
              </div>

              <AnimatePresence>
                {!form.isInfinite && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                      <label className="text-sm text-white/60 flex-shrink-0">Quantidade de ciclos:</label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={form.cycles}
                        onChange={e => update("cycles", Math.max(1, Number(e.target.value)))}
                        className="input-glass text-sm w-24 text-center py-1.5"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Intervalo */}
          <div>
            <SectionLabel icon={Clock} label="Intervalo entre postagens" />
            <div className="space-y-3 p-4 rounded-xl border border-white/[0.07] bg-white/[0.03]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">10 min</span>
                <span className="text-base font-bold text-violet-300">
                  {formatInterval(form.intervalMinutes)}
                </span>
                <span className="text-xs text-white/40">24h</span>
              </div>
              <input
                type="range"
                min={10}
                max={1440}
                step={5}
                value={form.intervalMinutes}
                onChange={e => update("intervalMinutes", Number(e.target.value))}
                className="range-slider"
                style={{
                  background: `linear-gradient(to right, rgb(124,58,237) 0%, rgb(124,58,237) ${sliderPct}%, rgba(255,255,255,0.08) ${sliderPct}%, rgba(255,255,255,0.08) 100%)`
                }}
              />
              <p className="text-[11px] text-amber-400/50 flex items-center gap-1.5">
                <AlertCircle size={10} />
                Mínimo 10 minutos para evitar bloqueios automáticos do Instagram.
              </p>
            </div>
          </div>

          {/* Legendas */}
          <div>
            <SectionLabel icon={Type} label="Legendas Dinâmicas" />
            <div className="space-y-2.5">
              {form.captions.map((caption, i) => (
                <div key={i} className="flex gap-2">
                  <textarea
                    rows={2}
                    placeholder={`Variação ${i + 1}...`}
                    value={caption}
                    onChange={e => updateCaption(i, e.target.value)}
                    className="input-glass flex-1 text-sm resize-none"
                    maxLength={2200}
                  />
                  {form.captions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCaption(i)}
                      className="p-2 rounded-xl text-white/25 hover:text-red-400 hover:bg-red-500/[0.07] transition-all self-start mt-0.5"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={addCaption}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-white/15 text-xs text-white/40 hover:text-violet-400 hover:border-violet-500/30 transition-all duration-150 w-full justify-center"
              >
                <Plus size={12} />
                Adicionar variação de legenda
              </button>

              <p className="text-[11px] text-white/25 flex items-start gap-1.5">
                <Info size={10} className="flex-shrink-0 mt-0.5" />
                O sistema distribuirá estas legendas aleatoriamente entre os reels da pasta para evitar padrões de spam.
              </p>
            </div>
          </div>

          {/* Capa */}
          <div>
            <SectionLabel icon={ImageIcon} label="Capa do Reel (opcional)" />
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleCoverSelect}
            />
            {form.coverPreviewUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-white/10 group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.coverPreviewUrl}
                  alt="Capa"
                  className="w-full h-32 object-cover"
                />
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors"
                  >
                    Trocar
                  </button>
                  <button
                    type="button"
                    onClick={removeCover}
                    className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30 transition-colors"
                  >
                    Remover
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="w-full h-24 rounded-xl border-2 border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-2 text-white/30 hover:text-white/60 hover:border-violet-500/25 transition-all duration-150"
              >
                <ImageIcon size={20} />
                <span className="text-xs">Clique para adicionar uma capa</span>
                <span className="text-[10px] text-white/20">Aplica em todos os vídeos · JPG, PNG · Sem capa = frame automático</span>
              </button>
            )}
          </div>

          {/* Efeitos */}
          <div>
            <SectionLabel icon={Contrast} label="Efeitos de Vídeo" />
            <div className="space-y-2.5">
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <FlipHorizontal size={15} className="text-cyan-400/60" />
                  <div>
                    <p className="text-sm text-white/80 font-medium">Espelhar</p>
                    <p className="text-xs text-white/30">Inverte horizontalmente o vídeo</p>
                  </div>
                </div>
                <Toggle checked={form.effectMirror} onChange={v => update("effectMirror", v)} />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <Contrast size={15} className="text-cyan-400/60" />
                  <div>
                    <p className="text-sm text-white/80 font-medium">Inverter cores</p>
                    <p className="text-xs text-white/30">Estilo negativo fotográfico</p>
                  </div>
                </div>
                <Toggle checked={form.effectInvert} onChange={v => update("effectInvert", v)} />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
            >
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </motion.div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-white/[0.07] flex-shrink-0">
          <button onClick={onClose} className="btn-ghost text-sm py-2.5 px-5">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="btn-primary flex-1 text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Salvando...</>
              : editingLoop
                ? <><Check size={14} /> Salvar alterações</>
                : <><Repeat2 size={14} /> Criar Loop</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────

export default function LoopPage() {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingLoop, setEditingLoop] = useState<Loop | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchLoops = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/loops");
      const data = await res.json() as { loops: Loop[] };
      setLoops(data.loops ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetchLoops(),
      fetch("/api/library/folders").then(r => r.json() as Promise<{ folders: Folder[] }>),
      fetch("/api/accounts/list").then(r => r.json() as Promise<{ accounts: Account[] }>),
    ]).then(([, foldersData, accountsData]) => {
      setFolders(foldersData.folders ?? []);
      setAccounts(accountsData.accounts ?? []);
    });
  }, [fetchLoops]);

  const openNewForm = () => { setEditingLoop(null); setShowForm(true); };
  const openEditForm = (loop: Loop) => { setEditingLoop(loop); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingLoop(null); };

  const uploadCover = async (file: File): Promise<string | null> => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `covers/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("videos-library")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return null;
    return supabase.storage.from("videos-library").getPublicUrl(path).data.publicUrl;
  };

  const handleSave = async (form: FormData, loopId?: string) => {
    let coverImageUrl: string | null = null;

    if (form.coverFile) {
      coverImageUrl = await uploadCover(form.coverFile);
    } else if (form.coverPreviewUrl && !form.coverPreviewUrl.startsWith("blob:")) {
      coverImageUrl = form.coverPreviewUrl;
    }

    const payload = {
      name: form.name,
      folder_id: form.folderId || null,
      is_infinite: form.isInfinite,
      cycles: form.cycles,
      interval_minutes: form.intervalMinutes,
      media_limit: form.mediaLimit,
      captions: form.captions.filter(c => c.trim()),
      cover_image_url: coverImageUrl,
      effect_mirror: form.effectMirror,
      effect_invert: form.effectInvert,
      account_ids: form.accountIds,
    };

    const url = loopId ? `/api/loops/${loopId}` : "/api/loops";
    const method = loopId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error ?? "Erro ao salvar.");
    }

    closeForm();
    fetchLoops();
  };

  const handleToggleStatus = async (loop: Loop) => {
    const newStatus = loop.status === "active" ? "paused" : "active";
    setLoops(prev => prev.map(l => l.id === loop.id ? { ...l, status: newStatus } : l));
    await fetch(`/api/loops/${loop.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  const handleDelete = async (loop: Loop) => {
    if (deletingId === loop.id) return;
    setDeletingId(loop.id);
    try {
      const res = await fetch(`/api/loops/${loop.id}`, { method: "DELETE" });
      if (res.ok) setLoops(prev => prev.filter(l => l.id !== loop.id));
    } finally {
      setDeletingId(null);
    }
  };

  const activeCount = loops.filter(l => l.status === "active").length;

  return (
    <div className="space-y-6 max-w-full">

      <AnimatePresence>
        {showForm && (
          <LoopFormModal
            editingLoop={editingLoop}
            accounts={accounts}
            folders={folders}
            onSave={handleSave}
            onClose={closeForm}
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Loop</h1>
          <p className="page-subtitle">
            {loops.length === 0
              ? "Publique em ciclo automático a partir das suas pastas"
              : `${activeCount} ativo${activeCount !== 1 ? "s" : ""} · ${loops.length} loop${loops.length !== 1 ? "s" : ""} total`}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={openNewForm}
          className="btn-primary flex items-center gap-2 text-sm py-2.5 px-4 flex-shrink-0"
        >
          <Plus size={15} />
          Novo Loop
        </motion.button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card p-5 animate-pulse space-y-3">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/[0.04]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-white/[0.06] rounded-full w-2/3" />
                  <div className="h-2.5 bg-white/[0.04] rounded-full w-1/3" />
                </div>
              </div>
              <div className="h-2 bg-white/[0.04] rounded-full w-full" />
              <div className="h-2 bg-white/[0.04] rounded-full w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Loops grid */}
      {!loading && loops.length > 0 && (
        <AnimatePresence mode="popLayout">
          <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {loops.map(loop => (
              <LoopCard
                key={loop.id}
                loop={loop}
                onToggleStatus={handleToggleStatus}
                onEdit={openEditForm}
                onDelete={handleDelete}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Empty state */}
      {!loading && loops.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-24 gap-6 text-center"
        >
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center">
              <Repeat2 size={36} className="text-white/10" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
              <Infinity size={12} className="text-violet-400" />
            </div>
          </div>
          <div>
            <p className="text-white/50 font-semibold text-lg mb-1.5">Nenhum loop configurado</p>
            <p className="text-white/25 text-sm max-w-sm">
              Crie um loop para publicar automaticamente os vídeos de uma pasta
              em ciclos nas suas contas do Instagram.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={openNewForm}
            className="btn-primary flex items-center gap-2 text-sm py-2.5 px-6"
          >
            <Plus size={14} />
            Criar primeiro Loop
          </motion.button>
        </motion.div>
      )}

    </div>
  );
}
