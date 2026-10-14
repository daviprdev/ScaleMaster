"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link2, Copy, ExternalLink, RefreshCw, ChevronDown, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { getAppUrlClient } from "@/lib/app-url-client";

interface UserMetaApp {
  id: string;
  app_name: string;
  ig_app_id: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const APP_BASE = getAppUrlClient();

export default function MagicLinkModal({ open, onClose }: Props) {
  const [apps, setApps] = useState<UserMetaApp[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string>("__global__");
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [appsLoading, setAppsLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const magicUrl = token ? `${APP_BASE}/add/${token}` : "";

  // Carrega lista de apps e token existente
  const loadData = useCallback(async () => {
    setAppsLoading(true);
    setError(null);
    try {
      const [appsRes, tokenRes] = await Promise.all([
        fetch("/api/apps"),
        fetch("/api/magic-link"),
      ]);

      if (!appsRes.ok || !tokenRes.ok) {
        setError("Não foi possível carregar os dados. Verifique sua conexão e tente novamente.");
        return;
      }

      const appsData = await appsRes.json();
      const tokenData = await tokenRes.json();

      setApps(appsData.apps ?? []);
      if (tokenData.token) {
        setToken(tokenData.token);
        setSelectedAppId(tokenData.app_id ?? "__global__");
      }
    } catch {
      setError("Erro de conexão ao carregar os dados. Tente novamente.");
    } finally {
      setAppsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: selectedAppId === "__global__" ? null : selectedAppId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao gerar o link. Tente novamente.");
        return;
      }

      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        // Copy automatically — fallback to manual if clipboard fails
        try {
          await navigator.clipboard.writeText(`${APP_BASE}/add/${data.token}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          // Clipboard blocked — link is visible in the input for manual copy
        }
      } else {
        setError("Resposta inválida do servidor. Tente novamente.");
      }
    } catch {
      setError("Erro de conexão ao gerar o link. Verifique sua rede e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!magicUrl) return;
    await navigator.clipboard.writeText(magicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const selectedApp = apps.find((a) => a.id === selectedAppId);
  const selectedLabel =
    selectedAppId === "__global__"
      ? "App Global (variáveis de ambiente)"
      : selectedApp?.app_name ?? "Selecionar app…";

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="glass rounded-2xl border border-white/10 w-full max-w-md shadow-2xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between p-5 pb-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#00498D]/10 border border-[#00498D]/20 flex items-center justify-center">
                    <Link2 size={16} className="text-[#00498D]" />
                  </div>
                  <div>
                    <h2 className="text-white font-semibold text-[15px] leading-tight">
                      Seu link pessoal para adicionar contas
                    </h2>
                    <p className="text-white/40 text-xs mt-0.5">Magic Link · uso único por acesso</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Error banner */}
                {error && (
                  <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-[13px] leading-relaxed">
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Description */}
                <p className="text-white/50 text-[13px] leading-relaxed">
                  Salve este link nos favoritos ou compartilhe com quem vai conectar a conta. Ao acessar, o navegador é redirecionado automaticamente para o login do Instagram — <span className="text-white/70">sem precisar estar logado no SaaS</span>.
                </p>

                {/* App Selector */}
                <div className="space-y-1.5">
                  <label className="text-white/40 text-xs font-medium uppercase tracking-wider">
                    Meta App
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setDropdownOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white/80 hover:border-white/20 hover:bg-white/[0.06] transition-all"
                    >
                      <span className="truncate">{appsLoading ? "Carregando…" : selectedLabel}</span>
                      <ChevronDown
                        size={14}
                        className={`text-white/30 transition-transform flex-shrink-0 ml-2 ${dropdownOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    <AnimatePresence>
                      {dropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                          className="absolute top-full left-0 right-0 mt-1 rounded-xl bg-[#0a0a0a] border border-white/10 shadow-2xl z-10 max-h-60 overflow-y-auto"
                        >
                          {/* Global option only if env var configured */}
                          <button
                            onClick={() => { setSelectedAppId("__global__"); setDropdownOpen(false); }}
                            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left hover:bg-white/[0.05] transition-colors ${selectedAppId === "__global__" ? "text-[#00498D]" : "text-white/70"}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-white/20 flex-shrink-0" />
                            App Global (variáveis de ambiente)
                          </button>

                          {apps.map((app) => (
                            <button
                              key={app.id}
                              onClick={() => { setSelectedAppId(app.id); setDropdownOpen(false); }}
                              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left hover:bg-white/[0.05] transition-colors ${selectedAppId === app.id ? "text-[#00498D]" : "text-white/70"}`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-[#00498D]/50 flex-shrink-0" />
                              <span className="truncate">{app.app_name}</span>
                              <span className="text-white/25 text-xs ml-auto flex-shrink-0">{app.ig_app_id.slice(0, 8)}…</span>
                            </button>
                          ))}

                          {apps.length === 0 && (
                            <div className="px-3.5 py-2.5 text-xs text-white/30 italic">
                              Nenhum app BYOC cadastrado
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* URL Display */}
                {token && (
                  <div className="space-y-1.5">
                    <label className="text-white/40 text-xs font-medium uppercase tracking-wider">
                      Seu link
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={magicUrl}
                        className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/[0.08] text-[13px] text-[#85B9E9]/80 font-mono focus:outline-none cursor-text select-all"
                        onFocus={(e) => e.target.select()}
                      />
                    </div>

                    <div className="flex gap-2 pt-0.5">
                      <button
                        onClick={handleCopy}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[13px] font-medium transition-all border ${
                          copied
                            ? "bg-[#00498D]/10 border-[#00498D]/30 text-[#00498D]"
                            : "bg-white/[0.04] border-white/[0.08] text-white/60 hover:bg-white/[0.07] hover:text-white/90"
                        }`}
                      >
                        {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                        {copied ? "Copiado!" : "Copiar"}
                      </button>
                      <button
                        onClick={() => window.open(magicUrl, "_blank")}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[13px] font-medium bg-white/[0.04] border border-white/[0.08] text-white/60 hover:bg-white/[0.07] hover:text-white/90 transition-all"
                      >
                        <ExternalLink size={13} />
                        Abrir
                      </button>
                    </div>
                  </div>
                )}

                {/* Generate Button */}
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="w-full btn-primary flex items-center justify-center gap-2 py-2.5 text-sm font-semibold"
                >
                  {loading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {token ? "Atualizar link e copiar" : "Gerar link e copiar"}
                </button>

                {token && (
                  <p className="text-white/25 text-[11px] text-center">
                    Ao gerar um novo link, o anterior é invalidado automaticamente.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
