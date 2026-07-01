"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Shield,
  Crown,
  Camera,
  Mail,
  Tag,
  Zap,
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
  if (type === "mobile") return <Smartphone size={size} className="text-[#00E5FF]" />;
  if (type === "tablet") return <Tablet size={size} className="text-[#00E5FF]" />;
  return <Monitor size={size} className="text-[#00E5FF]" />;
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
  const [nickname, setNickname] = useState("");
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const _savingPasswordRef = useRef(false);

  // Subscription
  const [coupon, setCoupon] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const _couponRef = useRef(false);

  // Sessions / Devices
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [revokeConfirm, setRevokeConfirm] = useState<"others" | "all" | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email ?? "");
        setFullName(user.user_metadata?.full_name ?? "");
        setNickname(user.user_metadata?.nickname ?? "");
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

  // ── Password save ──────────────────────────────────────────
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (_savingPasswordRef.current) return;
    setPasswordError("");
    if (!newPassword || newPassword.length < 6) {
      setPasswordError("A nova senha deve ter pelo menos 6 caracteres.");
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

  // ── Coupon ─────────────────────────────────────────────────
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
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-2xl font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.3)]">
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
                className="text-xs text-violet-400 hover:text-violet-300 mt-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

              {/* Apelido */}
              <div>
                <label className="text-[11px] font-medium text-white/35 block mb-1.5">
                  Apelido (@)
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
        <form onSubmit={handleSavePassword} className="space-y-4">
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
                {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

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

          {passwordError && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertCircle size={13} className="flex-shrink-0" />
              {passwordError}
            </div>
          )}

          <div className="flex justify-end">
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
              {savingPassword && <Loader2 size={14} className="animate-spin" />}
              {!savingPassword && passwordSuccess && <Check size={14} />}
              {savingPassword
                ? "Atualizando..."
                : passwordSuccess
                ? "Atualizado!"
                : "Atualizar Senha"}
            </button>
          </div>
        </form>
      </Section>

      {/* ── Dispositivos e Sessões ─────────────────────────── */}
      <Section icon={<Wifi size={15} />} title="Dispositivos e Sessões">
        <div className="space-y-3">
          <p className="text-xs text-white/30">
            Dispositivos que acessaram sua conta. Revogue sessões suspeitas para manter sua conta segura.
          </p>

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
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-colors",
                      isCurrent
                        ? "bg-[#00FF41]/[0.04] border-[#00FF41]/20"
                        : "bg-white/[0.02] border-white/[0.06]"
                    )}
                  >
                    {/* Ícone do dispositivo */}
                    <div
                      className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                        isCurrent ? "bg-[#00FF41]/10" : "bg-white/[0.05]"
                      )}
                    >
                      <DeviceIcon type={s.device_type} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white/80">
                          {s.browser} · {s.os}
                        </span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-[#00FF41]/10 border border-[#00FF41]/25 text-[#00FF41]">
                            ESTA SESSÃO
                          </span>
                        )}
                      </div>

                      <div className="mt-1 space-y-0.5">
                        {/* Local */}
                        {(s.city || s.country) && (
                          <div className="flex items-center gap-1.5 text-xs text-white/35">
                            <MapPin size={10} className="flex-shrink-0" />
                            <span>
                              {countryFlag(s.country)}{" "}
                              {[s.city, s.country].filter(Boolean).join(", ")}
                            </span>
                          </div>
                        )}
                        {/* IP */}
                        {s.ip_address && (
                          <p className="text-[11px] text-white/25 font-mono pl-4">
                            {s.ip_address}
                          </p>
                        )}
                        {/* Última atividade */}
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

          {/* Ações */}
          {!loadingSessions && sessions.length > 0 && (
            <div className="pt-1 border-t border-white/[0.06] flex flex-col sm:flex-row gap-2 mt-3">
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
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                    >
                      {revokingOthers ? <Loader2 size={11} className="animate-spin" /> : "Confirmar"}
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
                    Revogar outros dispositivos
                  </button>
                )
              )}

              {/* Deslogar de tudo */}
              {revokeConfirm === "all" ? (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-red-400 flex-1">
                    Você será deslogado agora. Continuar?
                  </span>
                  <button
                    onClick={handleLogoutAll}
                    disabled={loggingOutAll}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    {loggingOutAll ? <Loader2 size={11} className="animate-spin" /> : "Confirmar"}
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
                  Deslogar de todos os dispositivos
                </button>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── Assinatura ─────────────────────────────────────── */}
      <Section icon={<Crown size={15} />} title="Assinatura">
        <div className="space-y-4">
          <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-[0_0_8px_rgba(139,92,246,0.35)] flex-shrink-0">
                <Crown size={14} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/80">Plano Atual</p>
                <p className="text-[11px] text-white/35">
                  3 contas · 50 vídeos · 30 posts/mês
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-white/[0.07] border border-white/[0.10] text-[10px] font-bold text-white/45 tracking-widest">
              GRATUITO
            </span>
          </div>

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

          <div className="pt-2 border-t border-white/[0.06] space-y-2.5">
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-white/35">
              <Tag size={12} />
              Cupom de Desconto
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                placeholder="CUPOM2025"
                maxLength={20}
                className="input-glass flex-1 text-sm py-2.5 font-mono tracking-wider"
              />
              <button
                type="button"
                onClick={handleApplyCoupon}
                disabled={applyingCoupon || !coupon.trim()}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl btn-primary text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {applyingCoupon && <Loader2 size={13} className="animate-spin" />}
                Aplicar
              </button>
            </div>
          </div>
        </div>
      </Section>

    </div>
  );
}
