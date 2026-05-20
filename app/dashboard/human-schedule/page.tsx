"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, Shield, CheckCircle2, AlertCircle, Loader2,
  Globe, CalendarClock, Info, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface Settings {
  is_active: boolean;
  start_time: string;
  end_time: string;
  timezone: string;
}

// ── Timezone options ───────────────────────────────────────────────────────

const TIMEZONES = [
  { group: "Brasil", options: [
    { value: "America/Sao_Paulo",    label: "São Paulo / Rio / Brasília (UTC-3)" },
    { value: "America/Fortaleza",    label: "Fortaleza / Recife (UTC-3)" },
    { value: "America/Belem",        label: "Belém / Macapá (UTC-3)" },
    { value: "America/Manaus",       label: "Manaus / Campo Grande (UTC-4)" },
    { value: "America/Cuiaba",       label: "Cuiabá (UTC-4)" },
    { value: "America/Porto_Velho",  label: "Porto Velho (UTC-4)" },
    { value: "America/Boa_Vista",    label: "Boa Vista (UTC-4)" },
    { value: "America/Rio_Branco",   label: "Rio Branco (UTC-5)" },
    { value: "America/Noronha",      label: "Fernando de Noronha (UTC-2)" },
  ]},
  { group: "América", options: [
    { value: "America/Buenos_Aires", label: "Buenos Aires (UTC-3)" },
    { value: "America/Santiago",     label: "Santiago (UTC-3/-4)" },
    { value: "America/Mexico_City",  label: "Cidade do México (UTC-6)" },
    { value: "America/New_York",     label: "Nova York (UTC-5/-4)" },
    { value: "America/Chicago",      label: "Chicago (UTC-6/-5)" },
    { value: "America/Los_Angeles",  label: "Los Angeles (UTC-8/-7)" },
  ]},
  { group: "Europa", options: [
    { value: "Europe/Lisbon",        label: "Lisboa (UTC+0/+1)" },
    { value: "Europe/London",        label: "Londres (UTC+0/+1)" },
    { value: "Europe/Paris",         label: "Paris / Madrid (UTC+1/+2)" },
    { value: "Europe/Berlin",        label: "Berlim / Roma (UTC+1/+2)" },
  ]},
];

const PRESETS = [
  { label: "Padrão",      desc: "7h–23h",  start: "07:00", end: "23:00" },
  { label: "Conservador", desc: "8h–22h",  start: "08:00", end: "22:00" },
  { label: "Amplo",       desc: "6h–23h59", start: "06:00", end: "23:59" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isWithinWindow(timezone: string, start: string, end: string): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const h = Number(parts.find(p => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
    const cur = h * 60 + m;
    return cur >= timeToMinutes(start) && cur < timeToMinutes(end);
  } catch {
    return true;
  }
}

function liveTime(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return "--:--:--";
  }
}

// ── Toggle component ───────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none",
        checked ? "bg-violet-600" : "bg-white/10"
      )}
    >
      <motion.span
        animate={{ x: checked ? 24 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
      />
    </button>
  );
}

// ── SectionCard ────────────────────────────────────────────────────────────

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6",
      className
    )}>
      {children}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  is_active: false,
  start_time: "07:00",
  end_time: "23:00",
  timezone: "America/Sao_Paulo",
};

export default function HumanSchedulePage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [clock, setClock] = useState("--:--:--");
  const [posting, setPosting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(true);

  // Live clock
  useEffect(() => {
    const tick = () => {
      setClock(liveTime(settings.timezone));
      setPosting(
        settings.is_active
          ? isWithinWindow(settings.timezone, settings.start_time, settings.end_time)
          : false
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [settings.timezone, settings.is_active, settings.start_time, settings.end_time]);

  // Fetch settings on mount
  useEffect(() => {
    fetch("/api/human-schedule", { cache: "no-store" })
      .then(r => r.json() as Promise<{ settings: Settings }>)
      .then(d => {
        if (d.settings) {
          setSettings({
            is_active: d.settings.is_active,
            start_time: d.settings.start_time.substring(0, 5),
            end_time: d.settings.end_time.substring(0, 5),
            timezone: d.settings.timezone,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Auto-save — debounced 1.2 s after any change (skip first render)
  const save = useCallback((s: Settings) => {
    setSaveStatus("saving");
    fetch("/api/human-schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    })
      .then(r => r.json())
      .then(d => setSaveStatus(d.ok ? "saved" : "error"))
      .catch(() => setSaveStatus("error"))
      .finally(() => setTimeout(() => setSaveStatus(st => st === "saved" ? "idle" : st), 2500));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      if (initialLoadRef.current) { initialLoadRef.current = false; return next; }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => save(next), 1200);
      return next;
    });
  }, [save]);

  const applyPreset = (start: string, end: string) => update({ start_time: start, end_time: end });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }

  const tzLabel = TIMEZONES.flatMap(g => g.options).find(o => o.value === settings.timezone)?.label
    ?? settings.timezone;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">Horário Humano</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold tracking-wide">
              <Shield size={10} />
              Anti-Shadowban
            </span>
          </div>
          <p className="text-white/40 text-sm max-w-xl">
            Restringe o Cron Job de Loops para publicar apenas dentro de uma janela horária,
            simulando o comportamento de um usuário real e reduzindo sinais de automação.
          </p>
        </div>

        {/* Save status indicator */}
        <AnimatePresence mode="wait">
          {saveStatus !== "idle" && (
            <motion.div
              key={saveStatus}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex items-center gap-2 text-sm flex-shrink-0"
            >
              {saveStatus === "saving" && (
                <>
                  <Loader2 size={14} className="animate-spin text-white/40" />
                  <span className="text-white/40">Salvando…</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span className="text-emerald-400">Salvo</span>
                </>
              )}
              {saveStatus === "error" && (
                <>
                  <AlertCircle size={14} className="text-red-400" />
                  <span className="text-red-400">Erro ao salvar</span>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Row 1: Clock + Toggle ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Live clock card */}
        <SectionCard>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-white/40" />
            <span className="text-sm font-medium text-white/60">Relógio ao Vivo</span>
          </div>

          <div className="flex flex-col items-center gap-3 py-2">
            <div className="font-mono text-4xl font-bold tracking-widest text-white tabular-nums">
              {clock}
            </div>

            {/* Status badge */}
            <motion.div
              animate={{ opacity: 1 }}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium border",
                settings.is_active
                  ? posting
                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                    : "bg-amber-500/10 border-amber-500/25 text-amber-400"
                  : "bg-white/[0.04] border-white/10 text-white/30"
              )}
            >
              <span className={cn(
                "w-2 h-2 rounded-full",
                settings.is_active
                  ? posting ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                  : "bg-white/20"
              )} />
              {settings.is_active
                ? posting ? "Postando" : "Pausado"
                : "Inativo"}
            </motion.div>

            <p className="text-xs text-white/25 text-center leading-relaxed">
              {tzLabel.split(" ")[0]}
            </p>
          </div>
        </SectionCard>

        {/* Activation card */}
        <SectionCard>
          <div className="flex items-center gap-2 mb-4">
            <Zap size={16} className="text-white/40" />
            <span className="text-sm font-medium text-white/60">Ativação</span>
          </div>

          <div className="flex flex-col gap-4 justify-center h-[calc(100%-40px)]">
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div>
                <p className="text-sm font-semibold text-white">Horário Humano</p>
                <p className="text-xs text-white/35 mt-0.5">
                  {settings.is_active ? "Loops respeitam a janela horária" : "Loops publicam a qualquer hora"}
                </p>
              </div>
              <Toggle
                checked={settings.is_active}
                onChange={v => update({ is_active: v })}
              />
            </div>

            <div className={cn(
              "flex items-start gap-3 p-3 rounded-xl border text-xs transition-colors",
              settings.is_active
                ? "bg-emerald-500/[0.06] border-emerald-500/15 text-emerald-400/70"
                : "bg-white/[0.02] border-white/[0.05] text-white/25"
            )}>
              <Shield size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                {settings.is_active
                  ? `Loops bloqueados fora de ${settings.start_time}–${settings.end_time}`
                  : "Ative para proteger a conta contra detecção de bot"}
              </span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Row 2: Publication window ── */}
      <SectionCard>
        <div className="flex items-center gap-2 mb-5">
          <CalendarClock size={16} className="text-white/40" />
          <span className="text-sm font-medium text-white/60">Janela de Publicação</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          {/* Start time */}
          <div>
            <label className="block text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">
              Início
            </label>
            <input
              type="time"
              value={settings.start_time}
              onChange={e => update({ start_time: e.target.value })}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10
                text-white text-sm font-mono focus:outline-none focus:border-violet-500/50
                hover:border-white/20 transition-colors [color-scheme:dark]"
            />
          </div>

          {/* End time */}
          <div>
            <label className="block text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">
              Fim
            </label>
            <input
              type="time"
              value={settings.end_time}
              onChange={e => update({ end_time: e.target.value })}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10
                text-white text-sm font-mono focus:outline-none focus:border-violet-500/50
                hover:border-white/20 transition-colors [color-scheme:dark]"
            />
          </div>
        </div>

        {/* Visual window bar */}
        <div className="mb-5">
          <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              animate={{
                left: `${(timeToMinutes(settings.start_time) / (24 * 60)) * 100}%`,
                width: `${Math.max(0, (timeToMinutes(settings.end_time) - timeToMinutes(settings.start_time)) / (24 * 60)) * 100}%`,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute top-0 h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full"
            />
          </div>
          <div className="flex justify-between text-[10px] text-white/20 mt-1 font-mono">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </div>

        {/* Preset buttons */}
        <div>
          <p className="text-xs text-white/30 mb-2 font-medium uppercase tracking-wide">Atalhos</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => {
              const active = settings.start_time === p.start && settings.end_time === p.end;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.start, p.end)}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all border",
                    active
                      ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                      : "bg-white/[0.04] border-white/10 text-white/50 hover:text-white/80 hover:bg-white/[0.07]"
                  )}
                >
                  {p.label}
                  <span className={cn("font-mono", active ? "text-violet-400/70" : "text-white/25")}>
                    {p.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      {/* ── Row 3: Timezone + Info ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Timezone */}
        <SectionCard>
          <div className="flex items-center gap-2 mb-4">
            <Globe size={16} className="text-white/40" />
            <span className="text-sm font-medium text-white/60">Fuso Horário</span>
          </div>
          <select
            value={settings.timezone}
            onChange={e => update({ timezone: e.target.value })}
            className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10
              text-white text-sm focus:outline-none focus:border-violet-500/50
              hover:border-white/20 transition-colors [color-scheme:dark]"
          >
            {TIMEZONES.map(group => (
              <optgroup key={group.group} label={group.group}>
                {group.options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <p className="mt-3 text-xs text-white/25 leading-relaxed">
            Agora neste fuso: <span className="font-mono text-white/50">{clock}</span>
          </p>
        </SectionCard>

        {/* How it works */}
        <SectionCard className="bg-violet-500/[0.03] border-violet-500/[0.12]">
          <div className="flex items-center gap-2 mb-4">
            <Info size={16} className="text-violet-400/50" />
            <span className="text-sm font-medium text-violet-300/60">Como funciona</span>
          </div>
          <ul className="space-y-3 text-sm text-white/45 leading-relaxed">
            <li className="flex gap-2.5">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-violet-500/50 flex-shrink-0" />
              O Cron Job de Loops verifica a janela antes de cada publicação.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-violet-500/50 flex-shrink-0" />
              Posts fora da janela são <strong className="text-white/60">pulados naquele ciclo</strong> — nunca cancelados.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-violet-500/50 flex-shrink-0" />
              No próximo disparo do Cron dentro da janela, o post ocorre normalmente.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-cyan-500/50 flex-shrink-0" />
              Configurações salvas automaticamente ao alterar.
            </li>
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
