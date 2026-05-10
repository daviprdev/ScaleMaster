"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import {
  Zap,
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  ArrowRight,
  Check,
} from "lucide-react";

const passwordRequirements = [
  { label: "Mínimo 8 caracteres", test: (p: string) => p.length >= 8 },
  { label: "Uma letra maiúscula", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Um número", test: (p: string) => /\d/.test(p) },
];

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // TODO: Integrate with Supabase Auth
    // const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    setTimeout(() => setIsLoading(false), 1500);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[500px] h-[400px] bg-cyan-600/8 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[300px] bg-violet-500/8 rounded-full blur-[80px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center mb-8"
        >
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.4)]">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-bold gradient-text">NexusSocial</span>
          </Link>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="glass neon-border rounded-2xl p-8"
        >
          <div className="mb-6">
            <h1 className="text-2xl font-bold mb-1">Criar conta grátis</h1>
            <p className="text-white/40 text-sm">
              14 dias grátis. Sem cartão de crédito.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="text-sm text-white/60 mb-1.5 block">
                Nome completo
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="text"
                  placeholder="Seu nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="input-glass pl-10"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="text-sm text-white/60 mb-1.5 block">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input-glass pl-10"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-sm text-white/60 mb-1.5 block">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Crie uma senha forte"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input-glass pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Password strength indicators */}
              {password.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="mt-2 space-y-1"
                >
                  {passwordRequirements.map((req, i) => {
                    const passed = req.test(password);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <div
                          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-colors ${
                            passed ? "bg-emerald-500" : "bg-white/10"
                          }`}
                        >
                          {passed && <Check className="w-2 h-2 text-white" />}
                        </div>
                        <span
                          className={`text-xs transition-colors ${
                            passed ? "text-emerald-400" : "text-white/30"
                          }`}
                        >
                          {req.label}
                        </span>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </div>

            {/* Terms */}
            <p className="text-xs text-white/30 leading-relaxed">
              Ao criar sua conta, você concorda com nossos{" "}
              <a href="#" className="text-violet-400 hover:underline">
                Termos de Serviço
              </a>{" "}
              e{" "}
              <a href="#" className="text-violet-400 hover:underline">
                Política de Privacidade
              </a>
              .
            </p>

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={isLoading}
              whileTap={{ scale: 0.98 }}
              className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Criar conta grátis
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </motion.button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-white/30">ou</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* OAuth placeholder */}
          <button className="btn-ghost w-full flex items-center justify-center gap-2 text-sm">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continuar com Google
          </button>

          <p className="text-center text-sm text-white/40 mt-6">
            Já tem uma conta?{" "}
            <Link
              href="/auth/login"
              className="text-violet-400 hover:text-violet-300 font-medium transition-colors"
            >
              Entrar agora
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
