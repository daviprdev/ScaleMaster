"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  UserPlus,
  Upload,
  Download,
  FileSpreadsheet,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Send,
  SkipForward,
  RotateCcw,
  ChevronDown,
  ShieldCheck,
  Globe,
  KeyRound,
  Users,
  Clock,
  Trash2,
  ExternalLink,
  Copy,
} from "lucide-react";
import { readOnboardingFile, TEMPLATE_CSV, type OnboardingImportRow } from "@/lib/onboarding-import";

// ── Tipos (espelham o GET /api/onboarding/jobs) ──────────────────────────────

type Stage = "invite" | "photo" | "professional" | "verify_professional" | "magic_link";
type StageState = "pending" | "ok" | "needs_manual" | "error";
type JobStatus = "pending" | "processing" | "done" | "error";

interface StageResult {
  state: StageState;
  reason?: string | null;
  at?: string;
  started_at?: string;
  account_type?: string | null;
}

interface OnboardingJob {
  id: string;
  username: string;
  stage: Stage;
  stage_status: Partial<Record<Stage, StageResult>>;
  status: JobStatus;
  retry_count: number;
  retry_after: string | null;
  error_message: string | null;
  photo_url: string | null;
  magic_link: string | null;
  account_id: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  has_proxy: boolean;
  has_two_factor: boolean;
  progress: number;
}

interface Rejected {
  username: string | null;
  error: string;
  line?: number;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: "invite", label: "Convite" },
  { key: "photo", label: "Foto" },
  { key: "professional", label: "Profissional" },
  { key: "verify_professional", label: "Verificação" },
  { key: "magic_link", label: "Link mágico" },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<Stage, string>;

const POLL_MS = 10_000;
const BATCH = 200; // teto do POST /api/onboarding/jobs

const JOB_STATUS_META: Record<JobStatus, { label: string; color: string; dot: string }> = {
  pending:    { label: "Na fila",     color: "rgba(0,229,255,0.85)",  dot: "#00E5FF" },
  processing: { label: "Executando",  color: "rgba(0,229,255,0.95)",  dot: "#00E5FF" },
  done:       { label: "Concluído",   color: "rgba(0,255,65,0.9)",    dot: "#00FF41" },
  error:      { label: "Parado",      color: "rgba(255,100,90,0.9)",  dot: "#FF3B30" },
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function timeUntil(iso: string | null): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "a qualquer momento";
  const m = Math.ceil(diff / 60_000);
  if (m < 60) return `em ${m} min`;
  return `em ${Math.floor(m / 60)}h ${m % 60}min`;
}

// Estado visual de cada etapa, considerando onde o job está.
type ChipState = "ok" | "current" | "retrying" | "needs_manual" | "error" | "todo";

function chipState(job: OnboardingJob, stage: Stage): ChipState {
  const order = STAGES.findIndex((s) => s.key === stage);
  const currentIdx = STAGES.findIndex((s) => s.key === job.stage);
  const res = job.stage_status?.[stage];
  if (job.status === "done" || res?.state === "ok") return "ok";
  if (order < currentIdx) return "ok";
  if (order > currentIdx) return "todo";
  if (res?.state === "needs_manual") return "needs_manual";
  if (res?.state === "error" || job.status === "error") return "error";
  if (res?.reason && job.retry_count > 0) return "retrying";
  return "current";
}

const CHIP_STYLE: Record<ChipState, { bg: string; border: string; color: string }> = {
  ok:           { bg: "rgba(0,255,65,0.08)",   border: "rgba(0,255,65,0.3)",   color: "rgba(0,255,65,0.9)" },
  current:      { bg: "rgba(0,229,255,0.08)",  border: "rgba(0,229,255,0.35)", color: "rgba(0,229,255,0.95)" },
  retrying:     { bg: "rgba(255,184,0,0.07)",  border: "rgba(255,184,0,0.3)",  color: "rgba(255,200,90,0.9)" },
  needs_manual: { bg: "rgba(255,184,0,0.1)",   border: "rgba(255,184,0,0.45)", color: "rgba(255,200,90,0.95)" },
  error:        { bg: "rgba(255,59,48,0.08)",  border: "rgba(255,59,48,0.35)", color: "rgba(255,110,100,0.95)" },
  todo:         { bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" },
};

type Filter = "all" | "active" | "attention" | "done";

export default function OnboardingPage() {
  const [jobs, setJobs] = useState<OnboardingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const _firstLoad = useRef(false);

  // Importação
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<OnboardingImportRow[]>([]);
  const [sending, setSending] = useState(false);
  const [rejected, setRejected] = useState<Rejected[]>([]);

  // Cadastro manual
  const [form, setForm] = useState({ username: "", password: "", proxy_url: "", two_factor: "" });
  const [savingOne, setSavingOne] = useState(false);

  // Lista
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!_firstLoad.current) setLoading(true);
    try {
      const res = await fetch("/api/onboarding/jobs", { cache: "no-store" });
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao carregar jobs.");
      setJobs(data.jobs ?? []);
      setLastSync(Date.now());
    } catch (e) {
      // Mantém a lista anterior; só avisa no primeiro carregamento.
      if (!_firstLoad.current) setError(e instanceof Error ? e.message : "Erro ao carregar jobs.");
    } finally {
      _firstLoad.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Polling a cada 10s, pausado com a aba em segundo plano.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  // ── Envio ────────────────────────────────────────────────────────────────

  const postJobs = async (
    items: { username: string; password: string; proxy_url: string; two_factor?: string; photo_url?: string; magic_link?: string }[],
    lines?: number[]
  ): Promise<{ created: number; rejected: Rejected[] }> => {
    let created = 0;
    const rej: Rejected[] = [];
    for (let offset = 0; offset < items.length; offset += BATCH) {
      const chunk = items.slice(offset, offset + BATCH);
      const res = await fetch("/api/onboarding/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: chunk }),
      });
      if (res.status === 401) { window.location.href = "/auth/login"; break; }
      const data = await res.json().catch(() => ({}));
      created += Array.isArray(data.created) ? data.created.length : 0;
      for (const r of (data.rejected ?? []) as { index: number; username: string | null; error: string }[]) {
        rej.push({
          username: r.username,
          error: r.error,
          line: r.index >= 0 && lines ? lines[offset + r.index] : undefined,
        });
      }
      if (!res.ok && !data.rejected?.length) {
        rej.push({ username: null, error: data.error ?? `Falha no envio (HTTP ${res.status}).` });
      }
    }
    return { created, rejected: rej };
  };

  const handleFile = async (file: File) => {
    setError(""); setNotice(""); setRejected([]);
    setFileName(file.name);
    setParsing(true);
    try {
      const parsed = await readOnboardingFile(file);
      if (!parsed.length) throw new Error("Nenhuma linha de conta encontrada no arquivo.");
      setRows(parsed);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      setParsing(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const validRows = useMemo(() => rows.filter((r) => !r.error), [rows]);
  const invalidRows = rows.length - validRows.length;

  const handleSendFile = async () => {
    if (sending || !validRows.length) return;
    setSending(true); setError(""); setNotice("");
    try {
      const { created, rejected: rej } = await postJobs(
        validRows.map(({ username, password, proxy_url, two_factor, photo_url, magic_link }) =>
          ({ username, password, proxy_url, two_factor, photo_url, magic_link })),
        validRows.map((r) => r.line)
      );
      setRejected(rej);
      if (created) {
        setNotice(`${created} conta${created > 1 ? "s" : ""} enviada${created > 1 ? "s" : ""} para a fila. O início é espalhado em ~15 min.`);
        setRows([]); setFileName("");
      }
      if (!created && rej.length) setError("Nenhuma conta foi criada — veja os motivos abaixo.");
      await load();
    } catch {
      setError("Erro de rede ao enviar as contas.");
    } finally {
      setSending(false);
    }
  };

  const handleAddOne = async () => {
    if (savingOne) return;
    if (!form.username.trim() || !form.password.trim() || !form.proxy_url.trim()) {
      setError("Usuário, senha e proxy são obrigatórios.");
      return;
    }
    setSavingOne(true); setError(""); setNotice(""); setRejected([]);
    try {
      const { created, rejected: rej } = await postJobs([form]);
      if (created) {
        setNotice(`@${form.username.replace(/^@/, "").toLowerCase()} entrou na fila.`);
        setForm({ username: "", password: "", proxy_url: "", two_factor: "" });
        await load();
      } else {
        setError(rej[0]?.error ?? "Não foi possível criar o job.");
      }
    } catch {
      setError("Erro de rede ao cadastrar a conta.");
    } finally {
      setSavingOne(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob(["﻿" + TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-onboarding.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Ações por job ────────────────────────────────────────────────────────

  // Segredo TOTP digitado no card de um job que parou pedindo 2FA.
  const [twoFactorDraft, setTwoFactorDraft] = useState<Record<string, string>>({});

  // Salva o segredo e reenfileira a etapa na MESMA chamada: o PATCH aplica a
  // edicao antes da acao, entao o cron ja pega o dado novo na proxima volta.
  const saveTwoFactor = async (job: OnboardingJob) => {
    const secret = (twoFactorDraft[job.id] ?? "").trim();
    if (!secret || acting.has(job.id)) return;
    setActing((s) => new Set(s).add(job.id));
    setError("");
    try {
      const res = await fetch(`/api/onboarding/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ two_factor: secret, action: "retry" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar o segredo 2FA.");
      setTwoFactorDraft((d) => { const n = { ...d }; delete n[job.id]; return n; });
      setNotice(`@${job.username}: segredo 2FA salvo — etapa reenfileirada.`);
      await load();
    } catch (e) {
      setError(`@${job.username}: ${e instanceof Error ? e.message : "erro desconhecido."}`);
    } finally {
      setActing((s) => { const n = new Set(s); n.delete(job.id); return n; });
    }
  };

  // Confirmacao de 2 cliques: o 1o clique arma o job, o 2o remove.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const removeJob = async (job: OnboardingJob) => {
    if (acting.has(job.id)) return;
    if (confirmRemove !== job.id) {
      setConfirmRemove(job.id);
      return;
    }
    setActing((s) => new Set(s).add(job.id));
    setError("");
    try {
      const res = await fetch(`/api/onboarding/jobs/${job.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao remover.");
      setConfirmRemove(null);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      setNotice(
        data.account_kept
          ? `@${job.username} saiu da fila. A conta ja conectada continua ativa.`
          : `@${job.username} removida da fila.`
      );
    } catch (e) {
      setError(`@${job.username}: ${e instanceof Error ? e.message : "erro desconhecido."}`);
    } finally {
      setActing((s) => { const n = new Set(s); n.delete(job.id); return n; });
    }
  };

  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  const copyMagicLink = async (job: OnboardingJob) => {
    if (!job.magic_link) return;
    try {
      await navigator.clipboard.writeText(job.magic_link);
      setCopiedLink(job.id);
      setTimeout(() => setCopiedLink((c) => (c === job.id ? null : c)), 2000);
    } catch {
      setError("Não foi possível copiar o link.");
    }
  };

  const act = async (job: OnboardingJob, action: "skip" | "retry") => {
    if (acting.has(job.id)) return;
    setActing((s) => new Set(s).add(job.id));
    setError("");
    try {
      const res = await fetch(`/api/onboarding/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha na ação.");
      if (data.job) {
        setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...data.job } : j)));
      }
      await load();
    } catch (e) {
      setError(`@${job.username}: ${e instanceof Error ? e.message : "erro desconhecido."}`);
    } finally {
      setActing((s) => { const n = new Set(s); n.delete(job.id); return n; });
    }
  };

  const toggleExpand = (id: string) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // ── Filtros ──────────────────────────────────────────────────────────────

  const needsAttention = (j: OnboardingJob) => j.status === "error";
  const counts = useMemo(() => ({
    all: jobs.length,
    active: jobs.filter((j) => j.status === "pending" || j.status === "processing").length,
    attention: jobs.filter(needsAttention).length,
    done: jobs.filter((j) => j.status === "done").length,
  }), [jobs]);

  const visibleJobs = useMemo(() => {
    switch (filter) {
      case "active": return jobs.filter((j) => j.status === "pending" || j.status === "processing");
      case "attention": return jobs.filter(needsAttention);
      case "done": return jobs.filter((j) => j.status === "done");
      default: return jobs;
    }
  }, [jobs, filter]);

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, rgba(0,255,65,0.15), rgba(0,229,255,0.1))", border: "0.5px solid rgba(0,255,65,0.25)", boxShadow: "0 0 18px rgba(0,255,65,0.12)" }}>
          <UserPlus size={18} style={{ color: "var(--matrix)" }} />
        </div>
        <div>
          <h1 className="page-title">Onboarding de Contas</h1>
          <p className="page-subtitle">Convite do App → foto → conta profissional → verificação → link mágico, sem abrir o celular.</p>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
        style={{ background: "rgba(0,229,255,0.05)", border: "0.5px solid rgba(0,229,255,0.12)" }}>
        <ShieldCheck size={15} style={{ color: "var(--electric)" }} className="flex-shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed" style={{ color: "rgba(0,229,255,0.7)" }}>
          Cada conta exige <strong>proxy dedicado</strong> — sem proxy nenhuma chamada é feita. As etapas rodam uma por ciclo,
          com pausa entre elas. Quando uma etapa precisa de ação humana, o job para em <strong>ação manual</strong>:
          resolva no Instagram e clique em <strong>Pular etapa</strong>.
        </p>
      </div>

      {/* Mensagens */}
      <AnimatePresence>
        {error && (
          <motion.div key="err"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
            style={{ background: "rgba(255,59,48,0.08)", border: "0.5px solid rgba(255,59,48,0.2)", color: "rgba(255,100,90,0.9)" }}>
            <AlertCircle size={15} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="hover:text-white/60"><X size={14} /></button>
          </motion.div>
        )}
        {notice && (
          <motion.div key="ok"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
            style={{ background: "rgba(0,255,65,0.06)", border: "0.5px solid rgba(0,255,65,0.2)", color: "rgba(0,255,65,0.85)" }}>
            <CheckCircle2 size={15} />
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice("")} className="hover:text-white/60"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Importar planilha */}
        <div className="glass-card ticks p-5 space-y-4 lg:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={15} style={{ color: "var(--matrix)" }} />
              <h2 className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.85)" }}>Importar planilha</h2>
            </div>
            <button onClick={downloadTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: "rgba(0,229,255,0.08)", border: "0.5px solid rgba(0,229,255,0.25)", color: "rgba(0,229,255,0.9)" }}>
              <Download size={12} />Baixar modelo
            </button>
          </div>

          <div
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className="cursor-pointer rounded-xl px-4 py-7 flex flex-col items-center gap-2 text-center transition-all"
            style={{
              background: dragOver ? "rgba(0,255,65,0.06)" : "rgba(255,255,255,0.02)",
              border: `1px dashed ${dragOver ? "rgba(0,255,65,0.5)" : "rgba(255,255,255,0.12)"}`,
            }}
          >
            {parsing ? <Loader2 size={22} className="animate-spin" style={{ color: "var(--matrix)" }} />
              : <Upload size={22} style={{ color: "rgba(0,255,65,0.6)" }} />}
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
              {fileName ? fileName : "Arraste um arquivo .csv ou .xlsx, ou clique para escolher"}
            </p>
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
              Colunas: <span className="font-mono">username, password, proxy_url</span> · opcionais:{" "}
              <span className="font-mono">two_factor, photo_url, magic_link</span>
            </p>
            <input ref={fileInput} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span style={{ color: "rgba(0,255,65,0.85)" }}>{validRows.length} válida{validRows.length !== 1 ? "s" : ""}</span>
                {invalidRows > 0 && (
                  <span style={{ color: "rgba(255,110,100,0.9)" }}>· {invalidRows} com erro (não serão enviadas)</span>
                )}
              </div>
              <div className="max-h-64 overflow-auto rounded-lg" style={{ border: "0.5px solid rgba(255,255,255,0.08)" }}>
                <table className="w-full text-xs">
                  <thead style={{ background: "rgba(255,255,255,0.03)" }}>
                    <tr style={{ color: "rgba(255,255,255,0.4)" }}>
                      <th className="text-left font-semibold px-3 py-2">Linha</th>
                      <th className="text-left font-semibold px-3 py-2">Username</th>
                      <th className="text-left font-semibold px-3 py-2">Senha</th>
                      <th className="text-left font-semibold px-3 py-2">Proxy</th>
                      <th className="text-left font-semibold px-3 py-2">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line} style={{ borderTop: "0.5px solid rgba(255,255,255,0.05)" }}>
                        <td className="px-3 py-1.5 font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{r.line}</td>
                        <td className="px-3 py-1.5" style={{ color: "rgba(255,255,255,0.75)" }}>{r.username ? `@${r.username}` : "—"}</td>
                        <td className="px-3 py-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>{r.password ? "••••••" : "—"}</td>
                        <td className="px-3 py-1.5 font-mono truncate max-w-[160px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                          {r.proxy_url ? r.proxy_url.replace(/:[^:@]*@/, ":•••@") : "—"}
                        </td>
                        <td className="px-3 py-1.5" style={{ color: r.error ? "rgba(255,110,100,0.9)" : "rgba(0,255,65,0.8)" }}>
                          {r.error ?? "ok"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => { setRows([]); setFileName(""); }} className="px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
                  Descartar
                </button>
                <button onClick={handleSendFile} disabled={sending || !validRows.length}
                  className="btn-primary px-4 py-2 rounded-lg text-xs disabled:opacity-60">
                  {sending ? <><Loader2 size={13} className="animate-spin" />Enviando...</>
                    : <><Send size={13} />Enviar {validRows.length} conta{validRows.length !== 1 ? "s" : ""}</>}
                </button>
              </div>
            </div>
          )}

          {rejected.length > 0 && (
            <div className="rounded-lg p-3 space-y-1.5" style={{ background: "rgba(255,59,48,0.05)", border: "0.5px solid rgba(255,59,48,0.18)" }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold" style={{ color: "rgba(255,110,100,0.9)" }}>
                  {rejected.length} recusada{rejected.length > 1 ? "s" : ""} pelo servidor
                </p>
                <button onClick={() => setRejected([])} style={{ color: "rgba(255,255,255,0.3)" }}><X size={12} /></button>
              </div>
              <ul className="max-h-40 overflow-auto space-y-1">
                {rejected.map((r, i) => (
                  <li key={i} className="text-[11px]" style={{ color: "rgba(255,150,140,0.85)" }}>
                    {r.line ? `linha ${r.line} · ` : ""}{r.username ? `@${r.username}: ` : ""}{r.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Cadastro manual */}
        <div className="glass-card ticks p-5 space-y-4 lg:col-span-2">
          <div className="flex items-center gap-2">
            <UserPlus size={15} style={{ color: "var(--electric)" }} />
            <h2 className="text-sm font-bold" style={{ color: "rgba(255,255,255,0.85)" }}>Conta única</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)" }}>teste</span>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Usuário</label>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="nome_da_conta" autoComplete="off"
                className="input-glass w-full mt-1 px-3 py-2.5 text-sm rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Senha</label>
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                type="password" placeholder="••••••••" autoComplete="new-password"
                className="input-glass w-full mt-1 px-3 py-2.5 text-sm rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
                Segredo 2FA <span style={{ color: "rgba(255,255,255,0.3)" }}>(opcional)</span>
              </label>
              <input value={form.two_factor} onChange={(e) => setForm({ ...form, two_factor: e.target.value })}
                placeholder="chave do autenticador" autoComplete="off"
                className="input-glass w-full mt-1 px-3 py-2.5 text-sm rounded-lg font-mono" />
              <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                Obrigatório se a conta tiver 2FA ativo. É a chave da configuração do autenticador, não o código de 6 dígitos.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Proxy dedicado</label>
              <input value={form.proxy_url} onChange={(e) => setForm({ ...form, proxy_url: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddOne(); }}
                placeholder="user:pass@host:porta" autoComplete="off"
                className="input-glass w-full mt-1 px-3 py-2.5 text-sm rounded-lg font-mono" />
            </div>
          </div>
          <button onClick={handleAddOne} disabled={savingOne}
            className="btn-primary w-full px-4 py-2.5 rounded-lg text-xs disabled:opacity-60">
            {savingOne ? <><Loader2 size={13} className="animate-spin" />Cadastrando...</> : <><UserPlus size={13} />Iniciar onboarding</>}
          </button>
        </div>
      </div>

      {/* Lista de jobs */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ["all", "Todos"],
              ["active", "Em andamento"],
              ["attention", "Atenção"],
              ["done", "Concluídos"],
            ] as [Filter, string][]).map(([key, label]) => {
              const active = filter === key;
              const warn = key === "attention" && counts.attention > 0;
              return (
                <button key={key} onClick={() => setFilter(key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={active
                    ? { background: "rgba(0,255,65,0.1)", border: "0.5px solid rgba(0,255,65,0.35)", color: "rgba(0,255,65,0.95)" }
                    : { background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.08)", color: warn ? "rgba(255,120,110,0.9)" : "rgba(255,255,255,0.45)" }}>
                  {label} <span className="opacity-60">{counts[key]}</span>
                </button>
              );
            })}
          </div>
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#00FF41" }} />
            atualiza a cada 10s{lastSync ? ` · ${new Date(lastSync).toLocaleTimeString("pt-BR")}` : ""}
          </span>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card h-28 animate-pulse" style={{ animationDelay: `${i * 70}ms` }} />
            ))}
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(0,255,65,0.06)", border: "0.5px solid rgba(0,255,65,0.18)" }}>
              <Users size={26} style={{ color: "rgba(0,255,65,0.4)" }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
              {jobs.length === 0 ? "Nenhum onboarding cadastrado" : "Nada neste filtro"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {visibleJobs.map((job) => {
                const sm = JOB_STATUS_META[job.status];
                const current = job.stage_status?.[job.stage];
                const isManual = current?.state === "needs_manual" && job.status !== "done";
                const canSkip = isManual && job.status !== "processing";
                const canRetry = job.status === "error";
                const busy = acting.has(job.id);
                const open = expanded.has(job.id);
                // Etapa parou pedindo 2FA: o dado precisa vir do usuario, entao
                // o card oferece o campo em vez de so um retry que vai repetir.
                // Cobre o codigo novo (two_factor_required) e os jobs que ja
                // falharam antes dele, cuja razao traz so o nome da excecao.
                const needsTwoFactor = STAGES.some((st) => {
                  const reason = job.stage_status?.[st.key]?.reason?.toLowerCase() ?? "";
                  return reason.includes("two_factor") || reason.includes("twofactor");
                });
                // Etapa do link magico exigindo humano: o card oferece o link.
                const needsMagicLink = isManual && job.stage === "magic_link";
                const logEntries = STAGES
                  .map((s) => ({ stage: s.key, res: job.stage_status?.[s.key] }))
                  .filter((e) => e.res && (e.res.reason || e.res.state !== "pending"));

                return (
                  <motion.div key={job.id} layout
                    initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                    className="glass-card p-4 space-y-3"
                    style={isManual ? { borderColor: "rgba(255,184,0,0.35)" } : job.status === "error" ? { borderColor: "rgba(255,59,48,0.3)" } : undefined}
                  >
                    {needsMagicLink && (
                      <div className="rounded-lg p-3 space-y-2"
                        style={{ background: "rgba(0,229,255,0.06)", border: "0.5px solid rgba(0,229,255,0.3)" }}>
                        <p className="text-[11px] leading-relaxed" style={{ color: "rgba(0,229,255,0.9)" }}>
                          A autorização automática não concluiu. Abra o link mágico no navegador,
                          logado como <span className="font-mono">@{job.username}</span>, e autorize o app.
                        </p>
                        {job.magic_link ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <a href={job.magic_link} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                              style={{ background: "rgba(0,229,255,0.1)", border: "0.5px solid rgba(0,229,255,0.35)", color: "rgba(0,229,255,0.95)" }}>
                              <ExternalLink size={12} />Abrir link mágico
                            </a>
                            <button onClick={() => copyMagicLink(job)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                              style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)" }}>
                              <Copy size={12} />{copiedLink === job.id ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        ) : (
                          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>
                            Nenhum link cadastrado neste job — gere um em Contas → Link mágico.
                          </p>
                        )}
                      </div>
                    )}

                    {needsTwoFactor && (
                      <div className="rounded-lg p-3 space-y-2"
                        style={{ background: "rgba(255,184,0,0.07)", border: "0.5px solid rgba(255,184,0,0.3)" }}>
                        <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,200,90,0.95)" }}>
                          {job.has_two_factor
                            ? "O código gerado foi recusado. Confira o segredo do autenticador e salve de novo."
                            : "A conta tem 2FA ativo e nenhum segredo TOTP foi cadastrado. Informe a chave do autenticador para continuar."}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={twoFactorDraft[job.id] ?? ""}
                            onChange={(e) => setTwoFactorDraft((d) => ({ ...d, [job.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") saveTwoFactor(job); }}
                            placeholder="chave do autenticador"
                            autoComplete="off" spellCheck={false}
                            className="input-glass flex-1 min-w-[200px] px-3 py-2 text-xs rounded-lg font-mono" />
                          <button onClick={() => saveTwoFactor(job)}
                            disabled={busy || !(twoFactorDraft[job.id] ?? "").trim()}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                            style={{ background: "rgba(0,255,65,0.1)", border: "0.5px solid rgba(0,255,65,0.35)", color: "rgba(0,255,65,0.9)" }}>
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                            Salvar e tentar de novo
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Linha 1 */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${job.status === "processing" ? "animate-pulse" : ""}`}
                          style={{ background: isManual ? "#FFB800" : sm.dot, boxShadow: `0 0 8px ${isManual ? "#FFB800" : sm.dot}` }} />
                        <span className="text-sm font-semibold truncate" style={{ color: "rgba(255,255,255,0.85)" }}>@{job.username}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                          style={{ color: isManual ? "rgba(255,200,90,0.95)" : sm.color, background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.08)" }}>
                          {isManual ? "Ação manual" : sm.label}
                        </span>
                        {job.has_proxy && <Globe size={11} style={{ color: "rgba(0,229,255,0.5)" }} />}
                        {job.has_two_factor && <KeyRound size={11} style={{ color: "rgba(0,255,65,0.5)" }} />}
                      </div>
                      <div className="flex items-center gap-2">
                        {canSkip && (
                          <button onClick={() => act(job, "skip")} disabled={busy}
                            title="Marca a etapa como feita manualmente e avança"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                            style={{ background: "rgba(255,184,0,0.12)", border: "0.5px solid rgba(255,184,0,0.4)", color: "rgba(255,200,90,0.95)" }}>
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <SkipForward size={12} />}Pular etapa
                          </button>
                        )}
                        {canRetry && (
                          <button onClick={() => act(job, "retry")} disabled={busy}
                            title="Reenfileira a etapa atual"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                            style={{ background: "rgba(0,229,255,0.08)", border: "0.5px solid rgba(0,229,255,0.3)", color: "rgba(0,229,255,0.9)" }}>
                            {busy && !canSkip ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}Tentar de novo
                          </button>
                        )}
                        <button onClick={() => removeJob(job)} disabled={busy}
                          onBlur={() => setConfirmRemove((c) => (c === job.id ? null : c))}
                          title={job.account_id
                            ? "Remove da fila de onboarding — a conta conectada continua ativa"
                            : "Remove esta conta da fila de onboarding"}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={confirmRemove === job.id
                            ? { background: "rgba(255,59,48,0.16)", border: "0.5px solid rgba(255,59,48,0.6)", color: "rgba(255,120,110,1)" }
                            : { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}>
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          {confirmRemove === job.id ? "Confirmar?" : "Remover"}
                        </button>
                        <button onClick={() => toggleExpand(job.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs"
                          style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>
                          Log
                          <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                    </div>

                    {/* Etapas */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {STAGES.map((s, i) => {
                        const cs = chipState(job, s.key);
                        const st = CHIP_STYLE[cs];
                        const spin = cs === "current" && job.status === "processing";
                        return (
                          <div key={s.key} className="flex items-center gap-1.5">
                            <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md"
                              title={job.stage_status?.[s.key]?.reason ?? undefined}
                              style={{ background: st.bg, border: `0.5px solid ${st.border}`, color: st.color }}>
                              {cs === "ok" && <CheckCircle2 size={11} />}
                              {spin && <Loader2 size={11} className="animate-spin" />}
                              {cs === "current" && !spin && <Clock size={11} />}
                              {cs === "retrying" && <RotateCcw size={11} />}
                              {(cs === "needs_manual" || cs === "error") && <AlertCircle size={11} />}
                              {s.label}
                            </span>
                            {i < STAGES.length - 1 && <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>→</span>}
                          </div>
                        );
                      })}
                    </div>

                    {/* Resumo do estado atual */}
                    {job.status === "done" ? (
                      <p className="text-[11px]" style={{ color: "rgba(0,255,65,0.7)" }}>
                        Concluído {fmtTime(job.processed_at)}{job.account_id ? " · conta conectada ao AutoScale" : ""}
                      </p>
                    ) : job.status === "error" ? (
                      <p className="text-[11px] leading-snug px-2.5 py-2 rounded"
                        style={isManual
                          ? { background: "rgba(255,184,0,0.07)", color: "rgba(255,210,120,0.9)" }
                          : { background: "rgba(255,59,48,0.07)", color: "rgba(255,130,120,0.9)" }}>
                        <strong>{STAGE_LABEL[job.stage]}:</strong>{" "}
                        {current?.reason ?? job.error_message ?? "Falha sem detalhe."}
                        {isManual && " — resolva manualmente e clique em Pular etapa."}
                      </p>
                    ) : (
                      <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {job.status === "processing"
                          ? `Executando ${STAGE_LABEL[job.stage]}…`
                          : `${STAGE_LABEL[job.stage]} · próxima execução ${timeUntil(job.retry_after)}`}
                        {job.retry_count > 0 && (
                          <span style={{ color: "rgba(255,200,90,0.85)" }}>
                            {" "}· tentativa {job.retry_count + 1} — último erro: {current?.reason ?? job.error_message}
                          </span>
                        )}
                      </p>
                    )}

                    {/* Log detalhado */}
                    <AnimatePresence>
                      {open && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="rounded-lg p-3 space-y-2 font-mono text-[11px]"
                            style={{ background: "rgba(0,0,0,0.35)", border: "0.5px solid rgba(255,255,255,0.06)" }}>
                            <p style={{ color: "rgba(255,255,255,0.3)" }}>
                              criado {fmtTime(job.created_at)} · atualizado {fmtTime(job.updated_at)} · id {job.id.slice(0, 8)}
                            </p>
                            {logEntries.length === 0 && !job.error_message && (
                              <p style={{ color: "rgba(255,255,255,0.35)" }}>Nenhum evento ainda — aguardando o primeiro ciclo.</p>
                            )}
                            {logEntries.map(({ stage, res }) => {
                              const color =
                                res!.state === "ok" ? "rgba(0,255,65,0.8)"
                                : res!.state === "needs_manual" ? "rgba(255,200,90,0.9)"
                                : res!.state === "error" ? "rgba(255,120,110,0.9)"
                                : "rgba(0,229,255,0.75)";
                              return (
                                <div key={stage} className="flex flex-col sm:flex-row sm:gap-3">
                                  <span className="flex-shrink-0 sm:w-40" style={{ color: "rgba(255,255,255,0.35)" }}>
                                    {fmtTime(res!.at)} {STAGE_LABEL[stage]}
                                  </span>
                                  <span style={{ color }} className="break-words">
                                    [{res!.state}] {res!.reason ?? "—"}
                                    {res!.account_type ? ` (tipo: ${res!.account_type})` : ""}
                                  </span>
                                </div>
                              );
                            })}
                            {job.error_message && (
                              <div className="pt-2" style={{ borderTop: "0.5px solid rgba(255,255,255,0.06)" }}>
                                <span style={{ color: "rgba(255,255,255,0.35)" }}>último erro: </span>
                                <span className="break-words" style={{ color: "rgba(255,130,120,0.9)" }}>{job.error_message}</span>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
