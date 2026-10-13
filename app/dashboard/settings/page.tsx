"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Shield,
  Camera,
  Mail,
  Check,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  X,
  Monitor,
  Smartphone,
  Tablet,
  Wifi,
  LogOut,
  MapPin,
  Clock,
  Bell,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import PushNotificationManager from "@/components/dashboard/PushNotificationManager";
import NotificationAlertSettings from "@/components/dashboard/NotificationAlertSettings";
import SalesWebhookCard from "@/components/dashboard/SalesWebhookCard";

// ── Helpers ───────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  device_type: "desktop" | "mobile" | "tablet";
  browser: string;
  os: string;
  ip_address: string | null;
  country: string | null;
  city: string | null;
  created_at: string;
  last_seen_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Agora mesmo";
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d atrás`;
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  const pts = [...code.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0));
  return String.fromCodePoint(...pts);
}

function DeviceIcon({ type, size = 15 }: { type: string; size?: number }) {
  if (type === "mobile") return <Smartphone size={size} className="text-[#85B9E9]" />;
  if (type === "tablet") return <Tablet size={size} className="text-[#85B9E9]" />;
  return <Monitor size={size} className="text-[#85B9E9]" />;
}

// ── Password strength ──────────────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const score = !password
    ? 0
    : [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) =>
        r.test(password)
      ).length;
  if (!password) return null;
  const bar = ["", "bg-red-500", "bg-yellow-500", "bg-blue-500", "bg-emerald-500"];
  const text = ["", "text-red-400", "text-yellow-400", "text-blue-400", "text-emerald-400"];
  const labels = ["", "Fraca", "Razoável", "Boa", "Forte"];
  return (
    <div className="space-y-1.5 mt-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              i <= score ? bar[score] : "bg-white/[0.08]"
            )}
          />
        ))}
      </div>
      <p className={cn("text-[10px]", text[score])}>Senha {labels[score]}</p>
    </div>
  );
}

// ── Section card ───────────────────────────────────────────────────────────
function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/[0.06]">
        <span className="text-white/30">{icon}</span>
        <h2 className="text-sm font-semibold text-white/65 uppercase tracking-wider">
          {title}
        </h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // Profile
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [loadingUser, setLoadingUser] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");
  const _savingProfileRef = useRef(false);

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const _uploadingAvatarRef = useRef(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Security
  const [newPassword, setNewPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  // "form" = digitando nova senha · "code" = aguardando código enviado ao email
  const [pwStep, setPwStep] = useState<"form" | "code">("form");
  const [verifyCode, setVerifyCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const _savingPasswordRef = useRef(false);

  // Sessions / Devices
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [revokingSelected, setRevokingSelected] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [revokeConfirm, setRevokeConfirm] = useState<"others" | "all" | "selected" | null>(null);
  // Modo de seleção de sessões
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email ?? "");
        setFullName(user.user_metadata?.full_name ?? "");
        setDisplayName(user.user_metadata?.display_name ?? "");
        setUsername(user.user_metadata?.username ?? "");
        setPhone(user.user_metadata?.phone ?? "");
        setAvatarUrl(user.user_metadata?.avatar_url ?? null);
      }
      setLoadingUser(false);
    });
  }, [supabase]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      // Registra sessão atual e obtém seu ID
      const postRes = await fetch("/api/profile/sessions", { method: "POST" });
      const postData = (await postRes.json()) as { id: string | null; migration_pending?: boolean };
      if (postData.id) setCurrentSessionId(postData.id);

      // Lista todas as sessões
      const getRes = await fetch("/api/profile/sessions");
      const getData = (await getRes.json()) as { sessions: SessionRow[]; migration_pending?: boolean };
      setSessions(getData.sessions ?? []);
    } catch {
      // silencioso — sessões são non-critical
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setRevokeConfirm(null);
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Seleciona/desmarca todos os não-atuais
  const toggleSelectAll = () => {
    const others = sessions.filter(s => s.id !== currentSessionId).map(s => s.id);
    if (selectedIds.size === others.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(others));
    }
  };

  const handleRevokeSelected = async () => {
    if (revokingSelected || selectedIds.size === 0) return;
    setRevokingSelected(true);
    setSessionError("");
    setRevokeConfirm(null);
    try {
      const ids = [...selectedIds].join(",");
      const res = await fetch(
        `/api/profile/sessions?ids=${ids}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Erro ao revogar sessões.");
      exitSelectMode();
      await loadSessions();
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Erro ao revogar.");
    } finally {
      setRevokingSelected(false);
    }
  };

  const handleRevokeOthers = async () => {
    if (revokingOthers) return;
    setRevokingOthers(true);
    setSessionError("");
    setRevokeConfirm(null);
    try {
      const res = await fetch(
        `/api/profile/sessions?scope=others&currentId=${currentSessionId ?? ""}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Erro ao revogar sessões.");
      await loadSessions();
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Erro ao revogar.");
    } finally {
      setRevokingOthers(false);
    }
  };

  const handleLogoutAll = async () => {
    if (loggingOutAll) return;
    setLoggingOutAll(true);
    setSessionError("");
    setRevokeConfirm(null);
    try {
      await fetch("/api/profile/sessions?scope=all", { method: "DELETE" });
      router.push("/auth/login");
    } catch {
      setLoggingOutAll(false);
      setSessionError("Erro ao deslogar de todos os dispositivos.");
    }
  };

  // ── Avatar upload ──────────────────────────────────────────
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!file || _uploadingAvatarRef.current) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarError("Use JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Máximo 5 MB.");
      return;
    }

    _uploadingAvatarRef.current = true;
    setUploadingAvatar(true);
    setAvatarError("");

    try {
      const form = new FormData();
      form.append("avatar", file);
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro no upload.");
      setAvatarUrl(data.url!);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Erro ao fazer upload.");
    } finally {
      _uploadingAvatarRef.current = false;
      setUploadingAvatar(false);
    }
  };

  // ── Profile save ───────────────────────────────────────────
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
          display_name: displayName.trim(),
          username: username.trim().toLowerCase(),
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

  // ── Password: verificação por email em 2 etapas ────────────
  // Etapa 1: reauthenticate() envia código de 6 dígitos ao email do perfil.
  // Etapa 2: updateUser({ password, nonce }) só conclui com o código correto
  // (exige "Secure password change" ativo no Supabase Auth).
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendingCode) return;
    setPasswordError("");
    if (!newPassword || newPassword.length < 6) {
      setPasswordError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setSendingCode(true);
    try {
      const { error } = await supabase.auth.reauthenticate();
      if (error) throw error;
      setPwStep("code");
      setVerifyCode("");
      setResendCooldown(60);
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Erro ao enviar o código."
      );
    } finally {
      setSendingCode(false);
    }
  };

  const handleResendCode = async () => {
    if (sendingCode || resendCooldown > 0) return;
    setPasswordError("");
    setSendingCode(true);
    try {
      const { error } = await supabase.auth.reauthenticate();
      if (error) throw error;
      setResendCooldown(60);
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Erro ao reenviar o código."
      );
    } finally {
      setSendingCode(false);
    }
  };

  const handleConfirmPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (_savingPasswordRef.current) return;
    setPasswordError("");
    if (verifyCode.trim().length < 6) {
      setPasswordError("Digite o código de 6 dígitos enviado ao seu email.");
      return;
    }
    _savingPasswordRef.current = true;
    setSavingPassword(true);
    setPasswordSuccess(false);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        nonce: verifyCode.trim(),
      });
      if (error) throw error;
      setPasswordSuccess(true);
      setNewPassword("");
      setVerifyCode("");
      setPwStep("form");
      setResendCooldown(0);
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setPasswordError(
        /nonce|invalid|expired/i.test(msg)
          ? "Código inválido ou expirado. Verifique o email e tente novamente."
          : msg || "Erro ao atualizar senha."
      );
    } finally {
      _savingPasswordRef.current = false;
      setSavingPassword(false);
    }
  };

  const handleCancelCode = () => {
    setPwStep("form");
    setVerifyCode("");
    setPasswordError("");
  };

  const initial = (fullName || email).charAt(0).toUpperCase() || "U";

  return (
    <div className="max-w-2xl space-y-5">

      {/* ── Foto e Perfil ──────────────────────────────────── */}
      <Section icon={<User size={15} />} title="Foto e Perfil">
        <form onSubmit={handleSaveProfile} className="space-y-5">

          {/* Avatar */}
          <div className="flex items-center gap-5">
            {/* Hidden file input */}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />

            {/* Avatar circle — click to upload */}
            <div
              className="relative group cursor-pointer flex-shrink-0"
              onClick={() => !uploadingAvatar && avatarInputRef.current?.click()}
              title="Clique para alterar foto"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Foto de perfil"
                  className="w-16 h-16 rounded-full object-cover shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#00498D] to-[#85B9E9] flex items-center justify-center text-2xl font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                  {initial}
                </div>
              )}
              {/* Overlay */}
              <div className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                {uploadingAvatar ? (
                  <Loader2 size={16} className="text-white animate-spin" />
                ) : (
                  <Camera size={16} className="text-white" />
                )}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-white/75">Foto de perfil</p>
              <p className="text-xs text-white/30 mt-0.5">JPG, PNG, WebP · Máx 5 MB</p>
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => avatarInputRef.current?.click()}
                className="text-xs text-[#85B9E9] hover:text-[#AFBDD0] mt-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadingAvatar ? "Enviando..." : "Alterar foto"}
              </button>
            </div>
          </div>

          {/* Avatar error */}
          {avatarError && (
            <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle size={13} className="flex-shrink-0" />
                {avatarError}
              </div>
              <button type="button" onClick={() => setAvatarError("")}>
                <X size={13} />
              </button>
            </div>
          )}

          {loadingUser ? (
            <div className="flex items-center gap-2 py-2 text-white/30 text-sm">
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

              {/* Nome de Exibição */}
              <div>
                <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                  Nome de Exibição
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Como aparece na dashboard"
                  maxLength={40}
                  className="input-glass w-full text-sm py-2.5"
                />
              </div>

              {/* Nome de Usuário */}
              <div>
                <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                  Nome de Usuário
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))}
                  placeholder="usuario (login alternativo)"
                  maxLength={30}
                  pattern="[a-z0-9_.]+"
                  className="input-glass w-full text-sm py-2.5"
                />
                <p className="text-[10px] text-white/25 mt-1">Apenas letras minúsculas, números, _ e .</p>
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
                  <span className="text-white/20 font-normal">(somente leitura)</span>
                </label>
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07] text-white/40 text-sm select-none">
                  <Mail size={13} className="flex-shrink-0 text-white/20" />
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

          <div className="flex justify-end">
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
              {savingProfile && <Loader2 size={14} className="animate-spin" />}
              {!savingProfile && profileSuccess && <Check size={14} />}
              {savingProfile ? "Salvando..." : profileSuccess ? "Salvo!" : "Salvar Perfil"}
            </button>
          </div>
        </form>
      </Section>

      {/* ── Segurança ──────────────────────────────────────── */}
      <Section icon={<Shield size={15} />} title="Segurança">
        {pwStep === "form" ? (
          <form onSubmit={handleSendCode} className="space-y-4">
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

            <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-[#85B9E9]/[0.05] border border-[#85B9E9]/15 text-[11px] text-white/45">
              <Mail size={13} className="flex-shrink-0 mt-0.5 text-[#85B9E9]/70" />
              <span>
                Por segurança, enviaremos um código de verificação para o email
                da conta antes de alterar a senha.
              </span>
            </div>

            {passwordError && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertCircle size={13} className="flex-shrink-0" />
                {passwordError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={sendingCode || !newPassword}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
                  passwordSuccess
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                    : "btn-primary"
                )}
              >
                {sendingCode && <Loader2 size={14} className="animate-spin" />}
                {!sendingCode && passwordSuccess && <Check size={14} />}
                {sendingCode
                  ? "Enviando código..."
                  : passwordSuccess
                  ? "Senha atualizada!"
                  : "Enviar Código de Verificação"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleConfirmPassword} className="space-y-4">
            <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-[#00498D]/[0.05] border border-[#00498D]/15 text-[11px] text-white/50">
              <Mail size={13} className="flex-shrink-0 mt-0.5 text-[#00498D]/70" />
              <span>
                Enviamos um código de 6 dígitos para{" "}
                <span className="font-semibold text-white/75">{email}</span>.
                Digite-o abaixo para confirmar a alteração da senha.
              </span>
            </div>

            <div>
              <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                Código de Verificação
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={verifyCode}
                onChange={(e) =>
                  setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                className="input-glass w-full text-lg py-2.5 font-mono tracking-[0.5em] text-center"
                autoFocus
              />
            </div>

            {passwordError && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertCircle size={13} className="flex-shrink-0" />
                {passwordError}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancelCode}
                  className="text-xs text-white/35 hover:text-white/60 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={sendingCode || resendCooldown > 0}
                  className="text-xs text-[#85B9E9]/70 hover:text-[#85B9E9] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {resendCooldown > 0
                    ? `Reenviar em ${resendCooldown}s`
                    : "Reenviar código"}
                </button>
              </div>
              <button
                type="submit"
                disabled={savingPassword || verifyCode.length < 6}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold btn-primary transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingPassword && <Loader2 size={14} className="animate-spin" />}
                {savingPassword ? "Confirmando..." : "Confirmar Alteração"}
              </button>
            </div>
          </form>
        )}
      </Section>

      {/* ── Dispositivos e Sessões ─────────────────────────── */}
      <Section icon={<Wifi size={15} />} title="Dispositivos e Sessões">
        <div className="space-y-3">

          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-white/30">
              Dispositivos que acessaram sua conta. Selecione e revogue sessões suspeitas.
            </p>
            {/* Botão Selecionar — só aparece quando há outros dispositivos */}
            {!loadingSessions && sessions.filter(s => s.id !== currentSessionId).length > 0 && (
              selectMode ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={toggleSelectAll}
                    className="text-[11px] text-white/40 hover:text-white/70 transition-colors whitespace-nowrap"
                  >
                    {selectedIds.size === sessions.filter(s => s.id !== currentSessionId).length
                      ? "Desmarcar todos"
                      : "Selecionar todos"}
                  </button>
                  <button
                    onClick={exitSelectMode}
                    className="text-[11px] text-white/35 hover:text-white/60 transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setSelectMode(true); setRevokeConfirm(null); }}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium
                    bg-white/[0.05] border border-white/[0.08] text-white/45
                    hover:bg-white/[0.08] hover:text-white/70 transition-all"
                >
                  Selecionar
                </button>
              )
            )}
          </div>

          {/* Lista de sessões */}
          {loadingSessions ? (
            <div className="flex items-center gap-2 py-4 text-white/30 text-sm">
              <Loader2 size={14} className="animate-spin" />
              Carregando dispositivos...
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-6 text-white/25 text-sm">
              Nenhum dispositivo registrado ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => {
                const isCurrent = s.id === currentSessionId;
                const isSelected = selectedIds.has(s.id);
                const isSelectable = selectMode && !isCurrent;

                return (
                  <div
                    key={s.id}
                    onClick={() => isSelectable && toggleSelectId(s.id)}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-all duration-150",
                      isCurrent
                        ? "bg-[#00498D]/[0.04] border-[#00498D]/20"
                        : isSelected
                        ? "bg-red-500/[0.07] border-red-500/30 cursor-pointer"
                        : isSelectable
                        ? "bg-white/[0.02] border-white/[0.06] cursor-pointer hover:bg-white/[0.05] hover:border-white/[0.10]"
                        : "bg-white/[0.02] border-white/[0.06]"
                    )}
                  >
                    {/* Checkbox (modo seleção) ou ícone do dispositivo */}
                    {isSelectable ? (
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 border-2 transition-all",
                        isSelected
                          ? "bg-red-500/20 border-red-500/60"
                          : "bg-white/[0.04] border-white/[0.12]"
                      )}>
                        {isSelected
                          ? <Check size={14} className="text-red-400" />
                          : <DeviceIcon type={s.device_type} size={14} />
                        }
                      </div>
                    ) : (
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                        isCurrent ? "bg-[#00498D]/10" : "bg-white/[0.05]"
                      )}>
                        <DeviceIcon type={s.device_type} />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          "text-sm font-medium",
                          isSelected ? "text-red-300" : "text-white/80"
                        )}>
                          {s.browser} · {s.os}
                        </span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-[#00498D]/10 border border-[#00498D]/25 text-[#00498D]">
                            ESTA SESSÃO
                          </span>
                        )}
                        {isSelected && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-red-500/10 border border-red-500/25 text-red-400">
                            SELECIONADA
                          </span>
                        )}
                      </div>

                      <div className="mt-1 space-y-0.5">
                        {(s.city || s.country) && (
                          <div className="flex items-center gap-1.5 text-xs text-white/35">
                            <MapPin size={10} className="flex-shrink-0" />
                            <span>
                              {countryFlag(s.country)}{" "}
                              {[s.city, s.country].filter(Boolean).join(", ")}
                            </span>
                          </div>
                        )}
                        {s.ip_address && (
                          <p className="text-[11px] text-white/25 font-mono pl-4">
                            {s.ip_address}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 text-[11px] text-white/25">
                          <Clock size={10} className="flex-shrink-0" />
                          <span>Visto por último {timeAgo(s.last_seen_at)}</span>
                          <span className="text-white/15">·</span>
                          <span>Desde {new Date(s.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Barra de ação do modo de seleção */}
          {selectMode && (
            <div className={cn(
              "rounded-xl border px-4 py-3 flex items-center gap-3 transition-all",
              selectedIds.size > 0
                ? "bg-red-500/[0.07] border-red-500/25"
                : "bg-white/[0.03] border-white/[0.07]"
            )}>
              <span className={cn(
                "text-sm font-medium flex-1",
                selectedIds.size > 0 ? "text-red-300" : "text-white/35"
              )}>
                {selectedIds.size === 0
                  ? "Nenhuma sessão selecionada"
                  : `${selectedIds.size} sessão(ões) selecionada(s)`}
              </span>

              {selectedIds.size > 0 && (
                revokeConfirm === "selected" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-400">Deslogar {selectedIds.size} dispositivo(s)?</span>
                    <button
                      onClick={handleRevokeSelected}
                      disabled={revokingSelected}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {revokingSelected && <Loader2 size={11} className="animate-spin" />}
                      Confirmar
                    </button>
                    <button
                      onClick={() => setRevokeConfirm(null)}
                      className="px-3 py-1.5 rounded-lg text-xs text-white/35 hover:text-white/60 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRevokeConfirm("selected")}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold
                      bg-red-500/15 border border-red-500/30 text-red-400
                      hover:bg-red-500/25 transition-colors"
                  >
                    <LogOut size={12} />
                    Deslogar selecionados
                  </button>
                )
              )}
            </div>
          )}

          {/* Erro */}
          {sessionError && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertCircle size={13} className="flex-shrink-0" />
              {sessionError}
              <button className="ml-auto" onClick={() => setSessionError("")}>
                <X size={12} />
              </button>
            </div>
          )}

          {/* Ações globais — só quando NÃO está em modo seleção */}
          {!selectMode && !loadingSessions && sessions.length > 0 && (
            <div className="pt-1 border-t border-white/[0.06] flex flex-col sm:flex-row gap-2 mt-1">
              {/* Revogar outros */}
              {sessions.length > 1 && (
                revokeConfirm === "others" ? (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-amber-400 flex-1">
                      Deslogar de {sessions.length - 1} outro(s) dispositivo(s)?
                    </span>
                    <button
                      onClick={handleRevokeOthers}
                      disabled={revokingOthers}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {revokingOthers && <Loader2 size={11} className="animate-spin" />}
                      Confirmar
                    </button>
                    <button
                      onClick={() => setRevokeConfirm(null)}
                      className="px-3 py-1.5 rounded-lg text-xs text-white/35 hover:text-white/60 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRevokeConfirm("others")}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold flex-1 justify-center
                      bg-white/[0.04] border border-white/[0.08] text-white/50
                      hover:bg-white/[0.07] hover:text-white/75 hover:border-white/[0.12]
                      transition-all duration-150"
                  >
                    <LogOut size={14} />
                    Revogar todos os outros
                  </button>
                )
              )}

              {/* Deslogar de tudo */}
              {revokeConfirm === "all" ? (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-red-400 flex-1">Você será deslogado agora. Continuar?</span>
                  <button
                    onClick={handleLogoutAll}
                    disabled={loggingOutAll}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {loggingOutAll && <Loader2 size={11} className="animate-spin" />}
                    Confirmar
                  </button>
                  <button
                    onClick={() => setRevokeConfirm(null)}
                    className="px-3 py-1.5 rounded-lg text-xs text-white/35 hover:text-white/60 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setRevokeConfirm("all")}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold flex-1 justify-center
                    bg-red-500/[0.06] border border-red-500/20 text-red-400
                    hover:bg-red-500/[0.10] hover:border-red-500/30
                    transition-all duration-150"
                >
                  <LogOut size={14} />
                  Deslogar de todos
                </button>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── Notificações ─────────────────────────────────────── */}
      <Section icon={<Bell size={15} />} title="Notificações">
        <div className="space-y-5">
          <PushNotificationManager />
          <div>
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Alertas automáticos</p>
            <NotificationAlertSettings />
          </div>
          <div>
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Vendas</p>
            <SalesWebhookCard />
          </div>
        </div>
      </Section>

      </div>
  );
}
