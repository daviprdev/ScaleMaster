"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Mail,
  Crown,
  Zap,
  LogOut,
  Save,
  Check,
  Loader2,
  AlertCircle,
  Shield,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loadingUser, setLoadingUser] = useState(true);

  const [savingName, setSavingName] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  const _savingRef = useRef(false);

  const [loggingOut, setLoggingOut] = useState(false);
  const _loggingOutRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email ?? "");
        setName(user.user_metadata?.full_name ?? "");
      }
      setLoadingUser(false);
    });
  }, [supabase]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (_savingRef.current) return;
    _savingRef.current = true;
    setSavingName(true);
    setSaveError("");
    setSaveSuccess(false);

    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name.trim() },
      });
      if (error) throw error;
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      _savingRef.current = false;
      setSavingName(false);
    }
  };

  const handleLogout = async () => {
    if (_loggingOutRef.current) return;
    _loggingOutRef.current = true;
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const initial = (name || email).charAt(0).toUpperCase() || "U";

  return (
    <div className="max-w-2xl space-y-6">

      {/* Título */}
      <div>
        <h1 className="text-xl font-bold text-white">Configurações</h1>
        <p className="text-sm text-white/35 mt-0.5">
          Gerencie seu perfil, assinatura e sessão
        </p>
      </div>

      {/* ── Seção: Perfil ─────────────────────────────────────── */}
      <section className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <User size={15} className="text-violet-400" />
          <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">
            Perfil
          </h2>
        </div>

        {loadingUser ? (
          <div className="flex items-center gap-2 py-4 text-white/30 text-sm">
            <Loader2 size={15} className="animate-spin" />
            Carregando dados...
          </div>
        ) : (
          <form onSubmit={handleSaveName} className="space-y-4">
            {/* Avatar + E-mail */}
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-lg font-bold text-white flex-shrink-0 shadow-[0_0_16px_rgba(139,92,246,0.35)]">
                {initial}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-white/35 mb-1.5 font-medium">E-mail (somente leitura)</p>
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07] text-white/45 text-sm select-none cursor-default">
                  <Mail size={13} className="flex-shrink-0 text-white/20" />
                  <span className="truncate">{email || "—"}</span>
                </div>
              </div>
            </div>

            {/* Nome */}
            <div>
              <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                Nome de exibição
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Seu nome"
                maxLength={60}
                className="input-glass w-full text-sm py-2.5"
              />
            </div>

            {/* Feedback de erro */}
            {saveError && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertCircle size={13} className="flex-shrink-0" />
                {saveError}
              </div>
            )}

            {/* Botão salvar */}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingName || !name.trim()}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
                  saveSuccess
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                    : "btn-primary"
                )}
              >
                {savingName && <Loader2 size={14} className="animate-spin" />}
                {!savingName && saveSuccess && <Check size={14} />}
                {!savingName && !saveSuccess && <Save size={14} />}
                {savingName ? "Salvando..." : saveSuccess ? "Salvo!" : "Salvar alterações"}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ── Seção: Assinatura ─────────────────────────────────── */}
      <section className="glass-card overflow-hidden">
        {/* Cabeçalho do card */}
        <div className="px-6 py-5 bg-gradient-to-r from-violet-600/10 to-cyan-600/10 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-[0_0_12px_rgba(139,92,246,0.4)]">
              <Crown size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white/85">Assinatura</p>
              <p className="text-[11px] text-white/35">Recursos e limites do seu plano</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-white/[0.07] border border-white/[0.10] text-[11px] font-semibold text-white/50 tracking-wide">
            GRATUITO
          </span>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Grid de recursos */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Contas Instagram", value: "3" },
              { label: "Vídeos na biblioteca", value: "50" },
              { label: "Posts por mês", value: "30" },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-3 text-center"
              >
                <p className="text-xl font-bold text-white/75">{item.value}</p>
                <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{item.label}</p>
              </div>
            ))}
          </div>

          {/* Upgrade */}
          <button
            onClick={() => alert("Em breve! O plano Pro está sendo preparado.")}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
              bg-gradient-to-r from-violet-600 to-cyan-600
              hover:from-violet-500 hover:to-cyan-500
              hover:shadow-[0_0_22px_rgba(139,92,246,0.45)]
              text-white text-sm font-semibold
              transition-all duration-200 active:scale-[0.98]"
          >
            <Zap size={14} />
            Fazer Upgrade para Pro
          </button>
        </div>
      </section>

      {/* ── Seção: Sessão ─────────────────────────────────────── */}
      <section className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Shield size={15} className="text-white/40" />
          <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">
            Sessão
          </h2>
        </div>

        {/* Conta ativa */}
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="min-w-0">
            <p className="text-[11px] text-white/30">Logado como</p>
            <p className="text-sm font-medium text-white/65 truncate">{email || "—"}</p>
          </div>
          <div className="flex items-center gap-1.5 ml-4 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
            <span className="text-[11px] text-emerald-400 font-medium">Ativo</span>
          </div>
        </div>

        {/* Botão logout */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl
            border border-red-500/25 bg-red-500/[0.07]
            hover:bg-red-500/[0.15] hover:border-red-500/40
            text-red-400 text-sm font-semibold
            transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
            active:scale-[0.98]"
        >
          {loggingOut
            ? <><Loader2 size={14} className="animate-spin" /> Saindo...</>
            : <><LogOut size={14} /> Sair da Conta</>}
        </button>
      </section>

    </div>
  );
}
