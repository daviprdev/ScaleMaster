"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Zap,
  ArrowRight,
  Instagram,
  Users,
  Repeat2,
  Bot,
  Copy,
  Globe,
  Activity,
  Link2,
  SlidersHorizontal,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const stagger = {
  show: { transition: { staggerChildren: 0.12 } },
};

const features = [
  {
    icon: Users,
    title: "Multi-conta com Failover",
    description:
      "Conecte dezenas de contas Instagram Business. Se uma cair, o sistema isola e segue publicando nas demais — sem parar a operação inteira.",
    color: "#00498D",
  },
  {
    icon: Repeat2,
    title: "Loop de Postagem",
    description:
      "Ciclo contínuo de publicação por pasta de vídeos, com intervalo, limite e horário humano configuráveis, 24/7.",
    color: "#85B9E9",
  },
  {
    icon: Bot,
    title: "Automação por Pastas",
    description:
      "Vincule pastas de contas e de mídia — conta nova adicionada depois entra no fluxo sozinha, sem recriar nada.",
    color: "#00498D",
  },
  {
    icon: Copy,
    title: "Clonar Perfil",
    description:
      "Raspe os Reels de qualquer perfil público e reagende direto para suas contas, sem passar pela Biblioteca.",
    color: "#85B9E9",
  },
  {
    icon: Globe,
    title: "Proxy Dedicado por Conta",
    description:
      "Cada conta usa um IP residencial exclusivo e permanente. Zero reaproveitamento, zero vínculo entre perfis.",
    color: "#00498D",
  },
  {
    icon: Activity,
    title: "Monitor & Analytics",
    description:
      "Fila, publicações e métricas reais da Meta API em tempo real, com alertas automáticos de queda de conta.",
    color: "#85B9E9",
  },
];

const steps = [
  {
    n: "01",
    icon: Link2,
    title: "Conecte suas contas",
    description:
      "Autorize contas Instagram Business via OAuth oficial ou compartilhe um link de conexão — sem dar acesso ao painel.",
  },
  {
    n: "02",
    icon: SlidersHorizontal,
    title: "Escolha o fluxo",
    description:
      "Postar, Loop ou Automação por pasta. Defina cadência, proxy dedicado e legendas para cada operação.",
  },
  {
    n: "03",
    icon: Activity,
    title: "Acompanhe em tempo real",
    description:
      "Monitor e Failover mostram o que está publicando, o que caiu e o que precisa de atenção — sem precisar checar conta por conta.",
  },
];

const mockStats = [
  { label: "Contas Conectadas", value: "24", color: "#00498D" },
  { label: "Postagens Hoje", value: "312", color: "#85B9E9" },
  { label: "Fila", value: "18", color: "#00498D" },
];

const mockNav = ["Dashboard", "Contas", "Postar", "Loop"];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-black overflow-hidden pt-safe pb-safe">
      {/* Background effects */}
      <div className="fixed inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[#00498D]/[0.06] rounded-full blur-[120px]" />
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-[#85B9E9]/[0.05] rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-[#00498D]/[0.05] rounded-full blur-[80px]" />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5 border-b border-white/5">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2"
        >
          <BrandLogo size={36} textSize="text-xl" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="hidden md:flex items-center gap-8 text-sm text-white/60"
        >
          <a href="#features" className="hover:text-white transition-colors">
            Recursos
          </a>
          <a href="#how" className="hover:text-white transition-colors">
            Como funciona
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-3"
        >
          <Link href="/auth/login" className="btn-ghost text-sm py-2 px-4">
            Entrar
          </Link>
          <Link href="/auth/register" className="btn-primary text-sm py-2 px-4">
            Começar
          </Link>
        </motion.div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-24 pb-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass  text-sm text-[#00498D] mb-8"
        >
          <Instagram className="w-3.5 h-3.5" />
          <span>Automação de Instagram em escala real</span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="text-5xl md:text-7xl font-black leading-tight mb-6 max-w-5xl"
        >
          Publique em dezenas de contas.{" "}
          <span className="gradient-text">Sem cair, sem repetir.</span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.1 }}
          className="text-lg md:text-xl text-white/50 max-w-2xl mb-10 leading-relaxed"
        >
          Loop contínuo, automação por pasta, failover automático e proxy dedicado
          por conta — construído para quem gerencia dezenas de perfis, não um.
        </motion.p>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.2 }}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <Link href="/auth/register" className="btn-primary flex items-center gap-2 text-base px-8 py-4">
            <Zap className="w-4 h-4" />
            Criar conta
          </Link>
          <a href="#features" className="btn-ghost flex items-center gap-2 text-base px-8 py-4">
            Ver recursos
            <ArrowRight className="w-4 h-4" />
          </a>
        </motion.div>

        {/* Hero mockup */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
          className="relative mt-20 w-full max-w-5xl"
        >
          <div className="glass  rounded-2xl p-1 overflow-hidden">
            <div className="bg-black/60 rounded-xl p-6 h-80 flex items-center justify-center">
              {/* Mock Dashboard Preview */}
              <div className="w-full h-full flex gap-4">
                {/* Sidebar mock */}
                <div className="w-48 glass rounded-xl p-3 flex flex-col gap-2">
                  {mockNav.map((item, i) => (
                    <div
                      key={i}
                      className="px-3 py-2 rounded-lg text-xs font-medium"
                      style={
                        i === 0
                          ? { background: "rgba(0,73,141,0.1)", color: "#00498D", border: "0.5px solid rgba(0,73,141,0.3)" }
                          : { color: "rgba(255,255,255,0.4)" }
                      }
                    >
                      {item}
                    </div>
                  ))}
                </div>

                {/* Main content mock */}
                <div className="flex-1 flex flex-col gap-3">
                  <div className="flex gap-3">
                    {mockStats.map((stat, i) => (
                      <div key={i} className="flex-1 glass rounded-xl p-3">
                        <div
                          className="text-lg font-bold"
                          style={{ color: stat.color, textShadow: `0 0 14px ${stat.color}55` }}
                        >
                          {stat.value}
                        </div>
                        <div className="text-xs text-white/40">{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Video grid mock */}
                  <div className="flex-1 grid grid-cols-4 gap-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="glass rounded-lg aspect-square"
                        style={{
                          background: `linear-gradient(135deg, ${
                            i % 2 === 0 ? "rgba(0,73,141,0.16)" : "rgba(133,185,233,0.16)"
                          } 0%, rgba(0,0,0,0.3) 100%)`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Glow effect under mockup */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-3/4 h-20 bg-[#00498D]/10 blur-3xl rounded-full" />
        </motion.div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative z-10 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-block px-4 py-1.5 rounded-full glass border border-[#85B9E9]/30 text-sm text-[#85B9E9] mb-4">
              Recursos
            </span>
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Tudo que sua operação{" "}
              <span className="gradient-text">precisa rodar sozinha</span>
            </h2>
            <p className="text-white/50 text-lg max-w-2xl mx-auto">
              Do primeiro post ao failover automático, o Scale Master cobre toda a
              pipeline de publicação em múltiplas contas.
            </p>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {features.map((feature, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="glass-card ticks p-6 group transition-all duration-300"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `0.5px solid ${feature.color}33`,
                    boxShadow: `0 0 14px ${feature.color}22`,
                  }}
                >
                  <feature.icon className="w-5 h-5" style={{ color: feature.color }} strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative z-10 py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-block px-4 py-1.5 rounded-full glass border border-[#00498D]/30 text-sm text-[#00498D] mb-4">
              Como funciona
            </span>
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Três passos até o{" "}
              <span className="gradient-text">piloto automático</span>
            </h2>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {steps.map((step, i) => (
              <motion.div key={i} variants={fadeUp} className="glass-card p-6 relative overflow-hidden">
                <div
                  className="text-5xl font-black mb-4 opacity-20"
                  style={{ color: i % 2 === 0 ? "#00498D" : "#85B9E9" }}
                >
                  {step.n}
                </div>
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "0.5px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <step.icon className="w-4.5 h-4.5 text-white/70" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-bold mb-2">{step.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{step.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="glass  rounded-3xl p-12 text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#00498D]/[0.06] via-transparent to-[#85B9E9]/[0.06] pointer-events-none" />
            <div className="relative">
              <h2 className="text-4xl md:text-5xl font-black mb-4">
                Pronto para colocar sua{" "}
                <span className="gradient-text">operação no automático?</span>
              </h2>
              <p className="text-white/50 text-lg mb-8 max-w-xl mx-auto">
                Conecte sua primeira conta e configure o fluxo de publicação em
                poucos minutos.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link
                  href="/auth/register"
                  className="btn-primary flex items-center justify-center gap-2 text-base px-8 py-4"
                >
                  <Zap className="w-4 h-4" />
                  Criar conta
                </Link>
                <Link href="/auth/login" className="btn-ghost text-base px-8 py-4 text-center">
                  Já tenho uma conta
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <BrandLogo size={24} textSize="text-sm" />
          <p className="text-white/30 text-sm">
            © {new Date().getFullYear()} Scale Master. Todos os direitos reservados.
          </p>
          <div className="flex gap-6 text-sm text-white/40">
            <a href="#" className="hover:text-white transition-colors">
              Privacidade
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Termos
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
