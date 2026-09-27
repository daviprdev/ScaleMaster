"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Server, Activity, Plus, Trash2, RefreshCw, AlertCircle,
  CheckCircle2, XCircle, Loader2, Wifi, WifiOff, Upload,
  FileText, Image as ImageIcon, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProxyRow { id: string; proxy_url_enc: string; provider: string | null; country: string | null; is_active: number; failure_count: number; last_used_at: number | null; last_error: string | null; created_at: number; }
interface ProxyStats { total: number; active: number; inactive: number; with_failures: number; avg_failure_rate: number; }
interface JobStats { pending: number; processing: number; done: number; error: number; }
interface JobRow { id: string; username: string; status: string; attempts: number; error_message: string | null; created_at: number; updated_at: number; }

const API_BASE = "/api/admin/rpa";

function timeAgo(ts: number | null): string {
  if (!ts) return "Nunca";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.floor(diff)}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

function statusBadge(status: string) {
  const map: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
    pending: { color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: Loader2, label: "Pendente" },
    processing: { color: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: RefreshCw, label: "Processando" },
    done: { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2, label: "Concluído" },
    error: { color: "bg-red-500/10 text-red-400 border-red-500/20", icon: XCircle, label: "Erro" },
  };
  const cfg = map[status] || map.pending;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", cfg.color)}>
      <Icon className={cn("w-3 h-3", status === "processing" && "animate-spin")} />
      {cfg.label}
    </span>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </div>
  );
}

function FileUpload({ label, accept, value, onChange, placeholder }: { label: string; accept: string; value: File | null; onChange: (f: File | null) => void; placeholder: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-400 mb-1.5">{label}</label>
      <div onClick={() => inputRef.current?.click()} className={cn("flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-all", value ? "border-violet-500/50 bg-violet-500/5" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700")}>
        <ImageIcon className={cn("w-5 h-5 shrink-0", value ? "text-violet-400" : "text-zinc-500")} />
        <span className={cn("text-sm truncate", value ? "text-white" : "text-zinc-500")}>{value ? value.name : placeholder}</span>
        {value && <button onClick={(e) => { e.stopPropagation(); onChange(null); }} className="ml-auto p-1 text-zinc-400 hover:text-red-400 rounded"><X className="w-3.5 h-3.5" /></button>}
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </div>
  );
}

export default function RPAPage() {
  const [tab, setTab] = useState<"proxies" | "jobs" | "monitor">("proxies");
  const [proxies, setProxies] = useState<ProxyRow[]>([]);
  const [proxyStats, setProxyStats] = useState<ProxyStats | null>(null);
  const [loadingProxies, setLoadingProxies] = useState(true);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importProvider, setImportProvider] = useState("");
  const [importCountry, setImportCountry] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: number; fail: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addProxyModalOpen, setAddProxyModalOpen] = useState(false);
  const [newProxy, setNewProxy] = useState("");
  const [newProvider, setNewProvider] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [addingProxy, setAddingProxy] = useState(false);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [addJobModalOpen, setAddJobModalOpen] = useState(false);
  const [newJobUsername, setNewJobUsername] = useState("");
  const [newJobPassword, setNewJobPassword] = useState("");
  const [newJobTotp, setNewJobTotp] = useState("");
  const [newJobPhotoFile, setNewJobPhotoFile] = useState<File | null>(null);
  const [newJobStoryFile, setNewJobStoryFile] = useState<File | null>(null);
  const [newJobStoryLink, setNewJobStoryLink] = useState("");
  const [newJobStoryText, setNewJobStoryText] = useState("");
  const [newJobHighlight, setNewJobHighlight] = useState("");
  const [addingJob, setAddingJob] = useState(false);

  const fetchProxies = useCallback(async () => {
    try {
      const [listRes, statsRes] = await Promise.all([fetch(`${API_BASE}/proxies`), fetch(`${API_BASE}/proxies/stats`)]);
      if (listRes.ok) setProxies(await listRes.json());
      if (statsRes.ok) setProxyStats(await statsRes.json());
    } catch (e) { console.error("Failed to fetch proxies:", e); }
    finally { setLoadingProxies(false); }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const [statsRes, jobsRes] = await Promise.all([fetch(`${API_BASE}/stats`), fetch(`${API_BASE}/jobs`)]);
      if (statsRes.ok) setJobStats(await statsRes.json());
      if (jobsRes.ok) setJobs(await jobsRes.json());
    } catch (e) { console.error("Failed to fetch jobs:", e); }
    finally { setLoadingJobs(false); }
  }, []);

  useEffect(() => { fetchProxies(); fetchJobs(); }, [fetchProxies, fetchJobs]);

  async function handleAddProxy() {
    if (!newProxy.trim()) return;
    setAddingProxy(true);
    try {
      const res = await fetch(`${API_BASE}/proxies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxy_url_enc: newProxy.trim(), provider: newProvider.trim() || undefined, country: newCountry.trim() || undefined }) });
      if (res.ok) { setNewProxy(""); setNewProvider(""); setNewCountry(""); setAddProxyModalOpen(false); await fetchProxies(); }
    } catch (e) { console.error("Failed to add proxy:", e); }
    finally { setAddingProxy(false); }
  }

  async function handleImportProxies() {
    const lines = importText.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    if (lines.length === 0) return;
    setImporting(true); setImportResult(null);
    let ok = 0, fail = 0;
    for (const line of lines) {
      try {
        const res = await fetch(`${API_BASE}/proxies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxy_url_enc: line, provider: importProvider.trim() || undefined, country: importCountry.trim() || undefined }) });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
    }
    setImportResult({ ok, fail }); setImporting(false);
    if (ok > 0) await fetchProxies();
  }

  async function handleDeleteProxy(id: string) {
    try { await fetch(`${API_BASE}/proxies/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } }); await fetchProxies(); }
    catch (e) { console.error("Failed to delete proxy:", e); }
  }

  async function handleToggleProxy(id: string, isActive: number) {
    try { if (isActive) { await fetch(`${API_BASE}/proxies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" } }); } await fetchProxies(); }
    catch (e) { console.error("Failed to toggle proxy:", e); }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file); });
  }

  async function handleAddJob() {
    if (!newJobUsername.trim() || !newJobPassword.trim() || !newJobTotp.trim()) return;
    setAddingJob(true);
    try {
      // Gera magic link automaticamente via API
      const magicRes = await fetch(`${API_BASE}/generate-magic-link`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!magicRes.ok) throw new Error("Falha ao gerar magic link");
      const { token: magicToken } = await magicRes.json();

      const body: Record<string, string | undefined> = {
        username: newJobUsername.trim(),
        password: newJobPassword.trim(),
        totp_secret: newJobTotp.trim(),
        magic_link_token: magicToken,
        story_link_url: newJobStoryLink.trim() || undefined,
        story_link_text: newJobStoryText.trim() || undefined,
        highlight_title: newJobHighlight.trim() || undefined,
      };
      if (newJobPhotoFile) body.photo_url = await fileToBase64(newJobPhotoFile);
      if (newJobStoryFile) body.story_media_url = await fileToBase64(newJobStoryFile);

      const res = await fetch(`${API_BASE}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        setNewJobUsername(""); setNewJobPassword(""); setNewJobTotp("");
        setNewJobPhotoFile(null); setNewJobStoryFile(null);
        setNewJobStoryLink(""); setNewJobStoryText(""); setNewJobHighlight("");
        setAddJobModalOpen(false);
        await fetchJobs();
      }
    } catch (e) { console.error("Failed to add job:", e); }
    finally { setAddingJob(false); }
  }

  const tabs = [
    { id: "proxies" as const, label: "Estoque de Proxies", icon: Server },
    { id: "jobs" as const, label: "Contas RPA", icon: Bot },
    { id: "monitor" as const, label: "Monitoramento", icon: Activity },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="p-2 bg-violet-500/10 rounded-lg border border-violet-500/20"><Bot className="w-6 h-6 text-violet-400" /></div>
          Painel RPA
        </h1>
        <p className="text-zinc-400 mt-1">Gerencie o estoque de proxies, acompanhe contas e monitore o fluxo de onboarding</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1"><Server className="w-4 h-4" /> Proxies Ativos</div>
          <div className="text-2xl font-bold text-white">{proxyStats?.active ?? "—"}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1"><AlertCircle className="w-4 h-4" /> Com Falhas</div>
          <div className="text-2xl font-bold text-orange-400">{proxyStats?.with_failures ?? "—"}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1"><Loader2 className="w-4 h-4" /> Jobs Pendentes</div>
          <div className="text-2xl font-bold text-yellow-400">{jobStats?.pending ?? "—"}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-zinc-400 text-sm mb-1"><CheckCircle2 className="w-4 h-4" /> Concluídos</div>
          <div className="text-2xl font-bold text-emerald-400">{jobStats?.done ?? "—"}</div>
        </div>
      </div>

      <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800 rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all", tab === t.id ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50")}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "proxies" && (
          <motion.div key="proxies" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex gap-3">
              <button onClick={() => { setAddProxyModalOpen(true); setNewProxy(""); setNewProvider(""); setNewCountry(""); }} className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"><Plus className="w-4 h-4" /> Adicionar Proxy</button>
              <button onClick={() => { setImportModalOpen(true); setImportText(""); setImportProvider(""); setImportCountry(""); setImportResult(null); }} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border border-zinc-700"><Upload className="w-4 h-4" /> Importar em Lote</button>
              <button onClick={fetchProxies} className="text-zinc-400 hover:text-white px-3 py-2.5 rounded-lg transition-colors"><RefreshCw className="w-4 h-4" /></button>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-zinc-800"><h3 className="text-white font-medium">Proxies Cadastrados ({proxies.length})</h3></div>
              {loadingProxies ? (<div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-violet-400 animate-spin" /></div>)
                : proxies.length === 0 ? (<div className="p-8 text-center text-zinc-500">Nenhum proxy cadastrado ainda</div>)
                : (<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-zinc-950/50 text-zinc-400"><tr><th className="px-4 py-3 text-left font-medium">Provider</th><th className="px-4 py-3 text-left font-medium">País</th><th className="px-4 py-3 text-center font-medium">Status</th><th className="px-4 py-3 text-center font-medium">Falhas</th><th className="px-4 py-3 text-left font-medium">Último Uso</th><th className="px-4 py-3 text-left font-medium">Último Erro</th><th className="px-4 py-3 text-right font-medium">Ações</th></tr></thead><tbody className="divide-y divide-zinc-800/50">{proxies.map((p) => (<tr key={p.id} className="hover:bg-zinc-800/30 transition-colors"><td className="px-4 py-3 text-white font-medium">{p.provider || "—"}</td><td className="px-4 py-3 text-zinc-300 uppercase">{p.country || "—"}</td><td className="px-4 py-3 text-center">{p.is_active ? (<span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-medium"><Wifi className="w-3 h-3" /> Ativo</span>) : (<span className="inline-flex items-center gap-1 text-zinc-500 text-xs font-medium"><WifiOff className="w-3 h-3" /> Inativo</span>)}</td><td className="px-4 py-3 text-center"><span className={cn("text-xs font-mono", p.failure_count > 5 ? "text-red-400" : p.failure_count > 0 ? "text-orange-400" : "text-zinc-500")}>{p.failure_count}</span></td><td className="px-4 py-3 text-zinc-400 text-xs">{timeAgo(p.last_used_at)}</td><td className="px-4 py-3 text-zinc-500 text-xs max-w-[200px] truncate" title={p.last_error || ""}>{p.last_error || "—"}</td><td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1">{p.is_active ? (<button onClick={() => handleToggleProxy(p.id, p.is_active)} className="p-1.5 text-zinc-400 hover:text-yellow-400 rounded-md hover:bg-yellow-500/10 transition-colors" title="Desativar"><WifiOff className="w-3.5 h-3.5" /></button>) : null}<button onClick={() => handleDeleteProxy(p.id)} className="p-1.5 text-zinc-400 hover:text-red-400 rounded-md hover:bg-red-500/10 transition-colors" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button></div></td></tr>))}</tbody></table></div>)}
            </div>
          </motion.div>
        )}

        {tab === "jobs" && (
          <motion.div key="jobs" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex gap-3">
              <button onClick={() => { setAddJobModalOpen(true); setNewJobUsername(""); setNewJobPassword(""); setNewJobTotp(""); setNewJobPhotoFile(null); setNewJobStoryFile(null); setNewJobStoryLink(""); setNewJobStoryText(""); setNewJobHighlight(""); }} className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"><Plus className="w-4 h-4" /> Adicionar Conta</button>
              <button onClick={fetchJobs} className="text-zinc-400 hover:text-white px-3 py-2.5 rounded-lg transition-colors"><RefreshCw className="w-4 h-4" /></button>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-zinc-800"><h3 className="text-white font-medium">Fila de Onboarding ({jobs.length})</h3></div>
              {loadingJobs ? (<div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-violet-400 animate-spin" /></div>)
                : jobs.length === 0 ? (<div className="p-8 text-center text-zinc-500">Nenhuma conta na fila de onboarding</div>)
                : (<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-zinc-950/50 text-zinc-400"><tr><th className="px-4 py-3 text-left font-medium">Username</th><th className="px-4 py-3 text-center font-medium">Status</th><th className="px-4 py-3 text-center font-medium">Tentativas</th><th className="px-4 py-3 text-left font-medium">Erro</th><th className="px-4 py-3 text-left font-medium">Atualizado</th></tr></thead><tbody className="divide-y divide-zinc-800/50">{jobs.map((j) => (<tr key={j.id} className="hover:bg-zinc-800/30 transition-colors"><td className="px-4 py-3 text-white font-medium">@{j.username}</td><td className="px-4 py-3 text-center">{statusBadge(j.status)}</td><td className="px-4 py-3 text-center text-zinc-400 font-mono">{j.attempts}</td><td className="px-4 py-3 text-zinc-500 text-xs max-w-[250px] truncate" title={j.error_message || ""}>{j.error_message || "—"}</td><td className="px-4 py-3 text-zinc-400 text-xs">{timeAgo(j.updated_at)}</td></tr>))}</tbody></table></div>)}
            </div>
          </motion.div>
        )}

        {tab === "monitor" && (
          <motion.div key="monitor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center">
              <Activity className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
              <h3 className="text-white font-medium text-lg mb-2">Monitoramento de Fluxo</h3>
              <p className="text-zinc-400 max-w-md mx-auto">Acompanhe em tempo real o progresso de cada conta no fluxo de onboarding.</p>
              <div className="mt-6 grid grid-cols-4 gap-3 max-w-lg mx-auto">
                {[{ label: "Pendentes", value: jobStats?.pending ?? 0, color: "text-yellow-400" }, { label: "Processando", value: jobStats?.processing ?? 0, color: "text-blue-400" }, { label: "Concluídos", value: jobStats?.done ?? 0, color: "text-emerald-400" }, { label: "Erros", value: jobStats?.error ?? 0, color: "text-red-400" }].map((s) => (<div key={s.label} className="bg-zinc-950/50 rounded-lg p-3"><div className={cn("text-xl font-bold", s.color)}>{s.value}</div><div className="text-zinc-500 text-xs">{s.label}</div></div>))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Proxy Modal */}
      <Modal open={addProxyModalOpen} onClose={() => setAddProxyModalOpen(false)} title="Adicionar Proxy">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-zinc-400 mb-1.5">Proxy URL</label><input type="text" placeholder="host:port:user:pass ou URL completa" value={newProxy} onChange={(e) => setNewProxy(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="block text-sm font-medium text-zinc-400 mb-1.5">Provider</label><input type="text" placeholder="ex: ipbr" value={newProvider} onChange={(e) => setNewProvider(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div><div><label className="block text-sm font-medium text-zinc-400 mb-1.5">País</label><input type="text" placeholder="ex: br" value={newCountry} onChange={(e) => setNewCountry(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div></div>
          <button onClick={handleAddProxy} disabled={addingProxy || !newProxy.trim()} className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">{addingProxy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar</button>
        </div>
      </Modal>

      {/* Import Proxies Modal */}
      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title="Importar Proxies em Lote">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Cole os proxies (um por linha)</label>
            <textarea rows={8} placeholder={"host:port:user:pass\nhost:port:user:pass\n..."} value={importText} onChange={(e) => setImportText(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50 font-mono" />
            <div className="flex items-center gap-2 mt-2">
              <input ref={fileInputRef} type="file" accept=".txt,.csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = () => setImportText(reader.result as string); reader.readAsText(file); } }} />
              <button onClick={() => fileInputRef.current?.click()} className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"><FileText className="w-3 h-3" /> Carregar de arquivo .txt/.csv</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3"><div><label className="block text-sm font-medium text-zinc-400 mb-1.5">Provider (todos)</label><input type="text" placeholder="ex: ipbr" value={importProvider} onChange={(e) => setImportProvider(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div><div><label className="block text-sm font-medium text-zinc-400 mb-1.5">País (todos)</label><input type="text" placeholder="ex: br" value={importCountry} onChange={(e) => setImportCountry(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div></div>
          {importResult && (<div className={cn("p-3 rounded-lg text-sm", importResult.fail === 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-orange-500/10 text-orange-400 border border-orange-500/20")}>{importResult.ok} importado(s){importResult.fail > 0 && `, ${importResult.fail} falha(s)`}</div>)}
          <button onClick={handleImportProxies} disabled={importing || !importText.trim()} className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">{importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Importar</button>
        </div>
      </Modal>

      {/* Add Job Modal */}
      <Modal open={addJobModalOpen} onClose={() => setAddJobModalOpen(false)} title="Adicionar Conta para Onboarding">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><div><label className="block text-sm font-medium text-zinc-400 mb-1.5">Username *</label><input type="text" placeholder="@usuario" value={newJobUsername} onChange={(e) => setNewJobUsername(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div><div><label className="block text-sm font-medium text-zinc-400 mb-1.5">Senha *</label><input type="password" placeholder="••••••" value={newJobPassword} onChange={(e) => setNewJobPassword(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div></div>
          <div><label className="block text-sm font-medium text-zinc-400 mb-1.5">TOTP Secret *</label><input type="text" placeholder="Base32 secret" value={newJobTotp} onChange={(e) => setNewJobTotp(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div>
          <FileUpload label="Foto de Perfil" accept="image/*" value={newJobPhotoFile} onChange={setNewJobPhotoFile} placeholder="Selecionar imagem..." />
          <FileUpload label="Mídia do Story (vídeo/foto)" accept="image/*,video/*" value={newJobStoryFile} onChange={setNewJobStoryFile} placeholder="Selecionar vídeo ou foto..." />
          <div><label className="block text-sm font-medium text-zinc-400 mb-1.5">URL do Link no Story</label><input type="text" placeholder="https://..." value={newJobStoryLink} onChange={(e) => setNewJobStoryLink(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div>
          <div><label className="block text-sm font-medium text-zinc-400 mb-1.5">Texto do Sticker</label><input type="text" placeholder="Ex: Saiba mais" value={newJobStoryText} onChange={(e) => setNewJobStoryText(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div>
          <div><label className="block text-sm font-medium text-zinc-400 mb-1.5">Título do Destaque</label><input type="text" placeholder="Ex: Bem-vindo" value={newJobHighlight} onChange={(e) => setNewJobHighlight(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50" /></div>
          <button onClick={handleAddJob} disabled={addingJob || !newJobUsername.trim() || !newJobPassword.trim() || !newJobTotp.trim()} className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">{addingJob ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar à Fila</button>
        </div>
      </Modal>
    </div>
  );
}