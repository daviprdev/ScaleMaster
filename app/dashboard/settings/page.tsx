"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Shield, Crown, Camera, Mail, Lock,
  Tag, Zap, Check, Loader2, AlertCircle, Eye, EyeOff,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Tab = "perfil" | "seguranca" | "assinatura";

function PasswordStrength({ password }: { password: string }) {
  const score = !password
    ? 0
    : [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) =>
        r.test(password)
      ).length;

  const labels = ["", "Fraca", "Razoável", "Boa", "Forte"];
  const textColors = [
    "",
    "text-red-400",
    "text-yellow-400",
    "text-blue-400",
    "text-emerald-400",
  ];
  const barColors = [
    "",
    "bg-red-500",
    "bg-yellow-500",
    "bg-blue-500",
    "bg-emerald-500",
  ];

  if (!password) return null;

  return (
    <div className="space-y-1.5 mt-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              i <= score ? barColors[score] : "bg-white/[0.08]"
            )}
          />
        ))}
      </div>
      <p className={cn("text-[10px]", textColors[score])}>
        Senha {labels[score]}
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [activeTab, setActiveTab] = useState<Tab>("perfil");

  // ── Profile ────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [loadingUser, setLoadingUser] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");
  const _savingProfileRef = useRef(false);

  // ── Security ───────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const _savingPasswordRef = useRef(false);

  // ── Subscription ───────────────────────────────────────────
  const [coupon, setCoupon] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const _couponRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email ?? "");
        setFullName(user.user_metadata?.full_name ?? "");
        setNickname(user.user_metadata?.nickname ?? "");
        setPhone(user.user_metadata?.phone ?? "");
      }
      setLoadingUser(false);
    });
  }, [supabase]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (_savingProfileRef.current) return;
    _savingProfileRef.current = true;
    setSavingProfile(true);
    setProfileError("");
    setProfileSuccess(false);
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: fullName.trim(),
          nickname: nickname.trim(),
          phone: phone.trim(),
        },
      });
      if (error) throw error;
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      _savingProfileRef.current = false;
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (_savingPasswordRef.current) return;
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("As senhas não coincidem.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    _savingPasswordRef.current = true;
    setSavingPassword(true);
    setPasswordSuccess(false);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Erro ao atualizar senha."
      );
    } finally {
      _savingPasswordRef.current = false;
      setSavingPassword(false);
    }
  };

  const handleApplyCoupon = async () => {
    if (_couponRef.current || !coupon.trim()) return;
    _couponRef.current = true;
    setApplyingCoupon(true);
    await new Promise((r) => setTimeout(r, 900));
    _couponRef.current = false;
    setApplyingCoupon(false);
    alert("Cupom inválido ou expirado.");
  };

  const initial = (fullName || email).charAt(0).toUpperCase() || "U";

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "perfil", label: "Perfil", icon: User },
    { id: "seguranca", label: "Segurança", icon: Shield },
    { id: "assinatura", label: "Assinatura", icon: Crown },
  ];

  return (
    <div className="max-w-3xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Configurações</h1>
        <p className="text-sm text-white/35 mt-0.5">
          Gerencie seu perfil, segurança e assinatura
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Tab navigation */}
        <div className="flex lg:flex-col gap-1 lg:w-44 flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 text-left w-full",
                activeTab === tab.id
                  ? "bg-violet-600/20 text-violet-300 border border-violet-500/25"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
              )}
            >
              <tab.icon size={15} className="flex-shrink-0" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">

            {/* ── Perfil ── */}
            {activeTab === "perfil" && (
              <motion.div
                key="perfil"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
              >
                <form onSubmit={handleSaveProfile} className="glass-card p-6 space-y-5">
                  {/* Avatar row */}
                  <div className="flex items-center gap-4">
                    <div className="relative group cursor-pointer flex-shrink-0">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-2xl font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                        {initial}
                      </div>
                      <div className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Camera size={16} className="text-white" />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white/75">
                        Foto de Perfil
                      </p>
                      <p className="text-xs text-white/30 mt-0.5">
                        JPG, PNG · Máx 5 MB
                      </p>
                      <button
                        type="button"
                        className="text-xs text-violet-400 hover:text-violet-300 mt-1.5 transition-colors"
                      >
                        Alterar foto
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-white/[0.06]" />

                  {loadingUser ? (
                    <div className="flex items-center gap-2 py-4 text-white/30 text-sm">
                      <Loader2 size={15} className="animate-spin" />
                      Carregando dados...
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Nome Completo */}
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                          Nome Completo
                        </label>
                        <input
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Seu nome completo"
                          maxLength={80}
                          className="input-glass w-full text-sm py-2.5"
                        />
                      </div>

                      {/* Apelido */}
                      <div>
                        <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                          Apelido
                        </label>
                        <input
                          type="text"
                          value={nickname}
                          onChange={(e) => setNickname(e.target.value)}
                          placeholder="@apelido"
                          maxLength={30}
                          className="input-glass w-full text-sm py-2.5"
                        />
                      </div>

                      {/* Telefone */}
                      <div>
                        <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                          Telefone
                        </label>
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+55 11 9 9999-9999"
                          className="input-glass w-full text-sm py-2.5"
                        />
                      </div>

                      {/* E-mail readonly */}
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                          E-mail{" "}
                          <span className="text-white/20 font-normal">
                            (somente leitura)
                          </span>
                        </label>
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07] text-white/40 text-sm select-none">
                          <Mail
                            size={13}
                            className="flex-shrink-0 text-white/20"
                          />
                          <span className="truncate">{email || "—"}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {profileError && (
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                      <AlertCircle size={13} className="flex-shrink-0" />
                      {profileError}
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={savingProfile || loadingUser}
                      className={cn(
                        "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
                        profileSuccess
                          ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                          : "btn-primary"
                      )}
                    >
                      {savingProfile && (
                        <Loader2 size={14} className="animate-spin" />
                      )}
                      {!savingProfile && profileSuccess && <Check size={14} />}
                      {savingProfile
                        ? "Salvando..."
                        : profileSuccess
                        ? "Salvo!"
                        : "Salvar Perfil"}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* ── Segurança ── */}
            {activeTab === "seguranca" && (
              <motion.div
                key="seguranca"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
              >
                <form
                  onSubmit={handleSavePassword}
                  className="glass-card p-6 space-y-4"
                >
                  <div className="flex items-center gap-2.5 pb-1">
                    <Lock size={14} className="text-white/35" />
                    <h2 className="text-sm font-semibold text-white/70">
                      Alterar Senha
                    </h2>
                  </div>

                  {/* Senha atual */}
                  <div>
                    <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                      Senha Atual
                    </label>
                    <div className="relative">
                      <input
                        type={showCurrentPw ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="••••••••"
                        className="input-glass w-full text-sm py-2.5 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPw(!showCurrentPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors"
                      >
                        {showCurrentPw ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Nova senha */}
                  <div>
                    <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                      Nova Senha
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPw ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="input-glass w-full text-sm py-2.5 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(!showNewPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors"
                      >
                        {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <PasswordStrength password={newPassword} />
                  </div>

                  {/* Confirmar senha */}
                  <div>
                    <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                      Confirmar Nova Senha
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className={cn(
                        "input-glass w-full text-sm py-2.5",
                        confirmPassword && confirmPassword !== newPassword
                          ? "border-red-500/40 focus:border-red-500/60"
                          : ""
                      )}
                    />
                    {confirmPassword && confirmPassword !== newPassword && (
                      <p className="text-[10px] text-red-400 mt-1.5">
                        As senhas não coincidem.
                      </p>
                    )}
                  </div>

                  {passwordError && (
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                      <AlertCircle size={13} className="flex-shrink-0" />
                      {passwordError}
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={savingPassword || !newPassword}
                      className={cn(
                        "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
                        passwordSuccess
                          ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                          : "btn-primary"
                      )}
                    >
                      {savingPassword && (
                        <Loader2 size={14} className="animate-spin" />
                      )}
                      {!savingPassword && passwordSuccess && (
                        <Check size={14} />
                      )}
                      {savingPassword
                        ? "Atualizando..."
                        : passwordSuccess
                        ? "Atualizado!"
                        : "Atualizar Senha"}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* ── Assinatura ── */}
            {activeTab === "assinatura" && (
              <motion.div
                key="assinatura"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                {/* Plan card */}
                <div className="glass-card overflow-hidden">
                  <div className="px-6 py-5 bg-gradient-to-r from-violet-600/10 to-cyan-600/10 border-b border-white/[0.06] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-[0_0_12px_rgba(139,92,246,0.4)]">
                        <Crown size={16} className="text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white/85">
                          Plano Atual
                        </p>
                        <p className="text-[11px] text-white/35">
                          Recursos e limites do seu plano
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-white/[0.07] border border-white/[0.10] text-[11px] font-semibold text-white/50 tracking-wide">
                      GRATUITO
                    </span>
                  </div>

                  <div className="px-6 py-5 space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Contas Instagram", value: "3" },
                        { label: "Vídeos na biblioteca", value: "50" },
                        { label: "Posts por mês", value: "30" },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-3 text-center"
                        >
                          <p className="text-xl font-bold text-white/75">
                            {item.value}
                          </p>
                          <p className="text-[10px] text-white/30 mt-0.5 leading-tight">
                            {item.label}
                          </p>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() =>
                        alert("Em breve! O plano Pro está sendo preparado.")
                      }
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
                </div>

                {/* Coupon */}
                <div className="glass-card p-6 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <Tag size={14} className="text-white/35" />
                    <h2 className="text-sm font-semibold text-white/70">
                      Cupom de Desconto
                    </h2>
                  </div>
                  <p className="text-xs text-white/30">
                    Tem um cupom? Insira abaixo para aplicar desconto na sua
                    assinatura.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={coupon}
                      onChange={(e) =>
                        setCoupon(e.target.value.toUpperCase())
                      }
                      placeholder="CUPOM2025"
                      maxLength={20}
                      className="input-glass flex-1 text-sm py-2.5 font-mono tracking-wider"
                    />
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      disabled={applyingCoupon || !coupon.trim()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl btn-primary text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {applyingCoupon && (
                        <Loader2 size={13} className="animate-spin" />
                      )}
                      Aplicar
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
