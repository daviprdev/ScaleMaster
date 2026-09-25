"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Loader2,
  Instagram,
  Lock,
  ShieldCheck,
  Globe,
  Image as ImageIcon,
  Video,
  LinkIcon,
  Bookmark,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (data: { magic_token: string; worker_job_id: string | null }) => void;
}

type Step = "credentials" | "media" | "submitting" | "done" | "error";

export default function OnboardingModal({ open, onClose, onSuccess }: OnboardingModalProps) {
  const [step, setStep] = useState<Step>("credentials");
  const [errorMsg, setErrorMsg] = useState("");

  // Credentials
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");

  // Media
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [storyLinkUrl, setStoryLinkUrl] = useState("");
  const [highlightTitle, setHighlightTitle] = useState("");

  // Upload progress
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("credentials");
    setErrorMsg("");
    setUsername("");
    setPassword("");
    setTwoFactorSecret("");
    setProxyUrl("");
    setPhotoFile(null);
    setStoryFile(null);
    setStoryLinkUrl("");
    setHighlightTitle("");
    setUploading(false);
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function uploadToStorage(file: File, path: string): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("path", path);

    const res = await fetch("/api/onboarding/upload-media", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? `Upload falhou (${res.status})`);
    }

    const data = (await res.json()) as { url: string };
    return data.url;
  }

  async function handleSubmit() {
    if (!username.trim() || !password.trim()) {
      setErrorMsg("Username e senha são obrigatórios.");
      setStep("error");
      return;
    }

    setStep("submitting");
    setSubmitting(true);
    setErrorMsg("");

    try {
      let photoUrl: string | undefined;
      let storyMediaUrl: string | undefined;

      // Upload de mídias se fornecidas
      if (photoFile) {
        setUploading(true);
        photoUrl = await uploadToStorage(
          photoFile,
          `onboarding/${username}/photo_${Date.now()}.${photoFile.name.split(".").pop()}`
        );
        setUploading(false);
      }

      if (storyFile) {
        setUploading(true);
        storyMediaUrl = await uploadToStorage(
          storyFile,
          `onboarding/${username}/story_${Date.now()}.${storyFile.name.split(".").pop()}`
        );
        setUploading(false);
      }

      // Enviar job para o worker
      const res = await fetch("/api/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          two_factor_secret: twoFactorSecret.trim() || undefined,
          proxy_url: proxyUrl.trim() || undefined,
          photo_url: photoUrl,
          story_media_url: storyMediaUrl,
          story_link_url: storyLinkUrl.trim() || undefined,
          highlight_title: highlightTitle.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg((data as { error?: string }).error ?? "Erro ao iniciar onboarding.");
        setStep("error");
        return;
      }

      setStep("done");
      onSuccess({
        magic_token: (data as { magic_token: string }).magic_token,
        worker_job_id: (data as { worker_job_id: string | null }).worker_job_id,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro inesperado.");
      setStep("error");
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
                  <Instagram size={16} className="text-white" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-sm">Onboarding Automatizado</h2>
                  <p className="text-white/30 text-[11px]">RPA Worker · Playwright</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Step: credentials */}
              {step === "credentials" && (
                <div className="space-y-3">
                  <p className="text-white/50 text-xs leading-relaxed">
                    Preencha as credenciais da conta do Instagram. Todos os dados são cifrados com AES-256-GCM antes de serem enviados ao worker.
                  </p>

                  <div className="space-y-2">
                    <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <Instagram size={10} /> Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="@conta_exemplo"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <Lock size={10} /> Senha
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <ShieldCheck size={10} /> Secret 2FA (TOTP) — opcional
                    </label>
                    <input
                      type="text"
                      value={twoFactorSecret}
                      onChange={(e) => setTwoFactorSecret(e.target.value)}
                      placeholder="JBSWY3DPEHPK3PXP"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <Globe size={10} /> Proxy dedicado — opcional
                    </label>
                    <input
                      type="text"
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                      placeholder="http://user:pass@host:port"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors font-mono text-xs"
                    />
                  </div>

                  <button
                    onClick={() => setStep("media")}
                    disabled={!username.trim() || !password.trim()}
                    className="w-full py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold uppercase tracking-wide hover:bg-cyan-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Próximo: Mídias →
                  </button>
                </div>
              )}

              {/* Step: media */}
              {step === "media" && (
                <div className="space-y-3">
                  <p className="text-white/50 text-xs leading-relaxed">
                    Adicione mídias opcionais para o onboarding. Campos vazios serão pulados pelo worker.
                  </p>

                  {/* Foto de perfil */}
                  <div className="space-y-2">
                    <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <ImageIcon size={10} /> Foto de perfil — opcional
                    </label>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                    <button
                      onClick={() => photoInputRef.current?.click()}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/40 text-xs hover:border-white/20 transition-colors text-left"
                    >
                      {photoFile ? `✅ ${photoFile.name}` : "Clique para selecionar imagem..."}
                    </button>
                  </div>

                  {/* Mídia do story */}
                  <div className="space-y-2">
                    <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <Video size={10} /> Mídia do story — opcional
                    </label>
                    <input
                      ref={storyInputRef}
                      type="file"
                      accept="image/*,video/*"
                      onChange={(e) => setStoryFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                    <button
                      onClick={() => storyInputRef.current?.click()}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/40 text-xs hover:border-white/20 transition-colors text-left"
                    >
                      {storyFile ? `✅ ${storyFile.name}` : "Clique para selecionar vídeo/imagem..."}
                    </button>
                  </div>

                  {/* Link do story */}
                  <div className="space-y-2">
                    <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <LinkIcon size={10} /> Link do sticker no story — opcional
                    </label>
                    <input
                      type="url"
                      value={storyLinkUrl}
                      onChange={(e) => setStoryLinkUrl(e.target.value)}
                      placeholder="https://meulink.com/oferta"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                  </div>

                  {/* Título do destaque */}
                  <div className="space-y-2">
                    <label className="text-white/40 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <Bookmark size={10} /> Título do destaque — opcional
                    </label>
                    <input
                      type="text"
                      value={highlightTitle}
                      onChange={(e) => setHighlightTitle(e.target.value)}
                      placeholder="Ofertas"
                      className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setStep("credentials")}
                      className="flex-1 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/40 text-xs font-bold uppercase tracking-wide hover:bg-white/[0.08] transition-all"
                    >
                      ← Voltar
                    </button>
                    <button
                      onClick={handleSubmit}
                      className="flex-1 py-2.5 rounded-xl bg-[#00FF41]/20 border border-[#00FF41]/30 text-[#00FF41] text-xs font-bold uppercase tracking-wide hover:bg-[#00FF41]/30 transition-all"
                    >
                      Iniciar Onboarding 🚀
                    </button>
                  </div>
                </div>
              )}

              {/* Step: submitting */}
              {step === "submitting" && (
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-white font-bold text-sm">
                      {uploading ? "Enviando mídias..." : "Enviando job para o worker..."}
                    </p>
                    <p className="text-white/40 text-xs">
                      {uploading
                        ? "Aguarde o upload completar"
                        : `@${username} está sendo processada pelo RPA`}
                    </p>
                  </div>
                </div>
              )}

              {/* Step: done */}
              {step === "done" && (
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-[#00FF41]/10 border border-[#00FF41]/30 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-[#00FF41]" />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-white font-bold text-sm">Onboarding iniciado!</p>
                    <p className="text-white/40 text-xs leading-relaxed">
                      O worker RPA está processando @{username}.<br />
                      A conta aparecerá no dashboard quando o Magic Link for concluído.
                    </p>
                  </div>
                  <button
                    onClick={handleClose}
                    className="px-6 py-2.5 rounded-xl bg-[#00FF41]/20 border border-[#00FF41]/30 text-[#00FF41] text-xs font-bold uppercase tracking-wide hover:bg-[#00FF41]/30 transition-all"
                  >
                    Fechar
                  </button>
                </div>
              )}

              {/* Step: error */}
              {step === "error" && (
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-white font-bold text-sm">Erro no onboarding</p>
                    <p className="text-red-400/70 text-xs leading-relaxed max-w-xs">{errorMsg}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setStep("credentials")}
                      className="px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/40 text-xs font-bold uppercase tracking-wide hover:bg-white/[0.08] transition-all"
                    >
                      Tentar novamente
                    </button>
                    <button
                      onClick={handleClose}
                      className="px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-bold uppercase tracking-wide hover:bg-red-500/30 transition-all"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}