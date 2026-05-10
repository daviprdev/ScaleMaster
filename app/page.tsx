"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Zap,
  Shield,
  BarChart3,
  Download,
  Calendar,
  Users,
  ArrowRight,
  Instagram,
  Play,
  Star,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const stagger = {
  show: { transition: { staggerChildren: 0.12 } },
};

const features = [
  {
    icon: Instagram,
    title: "Multi-conta",
    description:
      "Gerencie dezenas de perfis do Instagram em um único painel centralizado.",
    color: "from-violet-500 to-purple-600",
  },
  {
    icon: Download,
    title: "Scraping de Reels",
    description:
      "Extraia Reels de qualquer perfil público com métricas de views, curtidas e comentários.",
    color: "from-cyan-500 to-blue-600",
  },
  {
    icon: Shield,
    title: "Limpeza de Metadados",
    description:
      "Remova automaticamente metadados dos vídeos via FFmpeg para máxima privacidade.",
    color: "from-emerald-500 to-teal-600",
  },
  {
    icon: Calendar,
    title: "Agendamento Inteligente",
    description:
      "Programe postagens para múltiplas contas nos melhores horários de engajamento.",
    color: "from-orange-500 to-amber-600",
  },
  {
    icon: BarChart3,
    title: "Analytics em Tempo Real",
    description:
      "Acompanhe performance, alcance e engajamento de todas as contas em um só lugar.",
    color: "from-pink-500 to-rose-600",
  },
  {
    icon: Users,
    title: "Gestão de Equipes",
    description:
      "Adicione colaboradores com permissões granulares para seu time de social media.",
    color: "from-indigo-500 to-violet-600",
  },
];

const stats = [
  { value: "10k+", label: "Contas gerenciadas" },
  { value: "5M+", label: "Postagens agendadas" },
  { value: "99.9%", label: "Uptime garantido" },
  { value: "2.4x", label: "Aumento de engajamento" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-violet-600/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-purple-600/10 rounded-full blur-[80px]" />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5 border-b border-white/5">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-xl font-bold gradient-text">AutoScale</span>
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
          <a href="#pricing" className="hover:text-white transition-colors">
            Preços
          </a>
          <a href="#about" className="hover:text-white transition-colors">
            Sobre
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
            Começar grátis
          </Link>
        </motion.div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-24 pb-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-violet-500/30 text-sm text-violet-300 mb-8"
        >
          <Star className="w-3.5 h-3.5 text-violet-400" />
          <span>Novo: Agendamento com IA disponível</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </motion.div>

        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="text-5xl md:text-7xl font-black leading-tight mb-6 max-w-5xl"
        >
          Automatize seu{" "}
          <span className="gradient-text">Instagram</span>
          {" "}como nunca antes
        </motion.h1>

        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.1 }}
          className="text-lg md:text-xl text-white/50 max-w-2xl mb-10 leading-relaxed"
        >
          Faça scraping de Reels, limpe metadados automaticamente, gerencie
          múltiplas contas e agende postagens — tudo em uma plataforma futurista.
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
            Começar gratuitamente
          </Link>
          <button className="btn-ghost flex items-center gap-2 text-base px-8 py-4">
            <Play className="w-4 h-4" />
            Ver demonstração
          </button>
        </motion.div>

        {/* Hero mockup */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
          className="relative mt-20 w-full max-w-5xl"
        >
          <div className="glass neon-border rounded-2xl p-1 overflow-hidden">
            <div className="bg-gray-900/80 rounded-xl p-6 h-80 flex items-center justify-center">
              {/* Mock Dashboard Preview */}
              <div className="w-full h-full flex gap-4">
                {/* Sidebar mock */}
                <div className="w-48 glass rounded-xl p-3 flex flex-col gap-2">
                  {["Dashboard", "Pesquisa", "Biblioteca", "Agendamento"].map(
                    (item, i) => (
                      <div
                        key={i}
                        className={`px-3 py-2 rounded-lg text-xs font-medium ${
                          i === 0
                            ? "bg-violet-600/30 text-violet-300 border border-violet-500/30"
                            : "text-white/40 hover:text-white/60"
                        }`}
                      >
                        {item}
                      </div>
                    )
                  )}
                </div>

                {/* Main content mock */}
                <div className="flex-1 flex flex-col gap-3">
                  <div className="flex gap-3">
                    {stats.slice(0, 3).map((stat, i) => (
                      <div key={i} className="flex-1 glass rounded-xl p-3">
                        <div className="text-lg font-bold gradient-text">
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
                        className="glass rounded-lg aspect-square bg-gradient-to-br"
                        style={{
                          background: `linear-gradient(135deg, rgba(${
                            [
                              "139,92,246",
                              "6,182,212",
                              "16,185,129",
                              "245,158,11",
                              "239,68,68",
                              "99,102,241",
                              "139,92,246",
                              "6,182,212",
                            ][i]
                          },0.2) 0%, rgba(0,0,0,0.3) 100%)`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Glow effect under mockup */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-3/4 h-20 bg-violet-600/20 blur-3xl rounded-full" />
        </motion.div>
      </section>

      {/* Stats Section */}
      <section className="relative z-10 py-16 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="glass-card p-6 text-center"
            >
              <div className="text-3xl font-black gradient-text mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-white/50">{stat.label}</div>
            </motion.div>
          ))}
        </div>
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
            <span className="inline-block px-4 py-1.5 rounded-full glass border border-cyan-500/30 text-sm text-cyan-300 mb-4">
              Recursos poderosos
            </span>
            <h2 className="text-4xl md:text-5xl font-black mb-4">
              Tudo que você precisa,{" "}
              <span className="gradient-text">em um só lugar</span>
            </h2>
            <p className="text-white/50 text-lg max-w-2xl mx-auto">
              Do scraping à postagem automatizada, AutoScale cobre todo o
              fluxo de trabalho do seu Instagram.
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
                className="glass-card p-6 group hover:border-white/20 transition-all duration-300 hover:shadow-[0_0_30px_rgba(139,92,246,0.1)]"
              >
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}
                >
                  <feature.icon className="w-5 h-5 text-white" />
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

      {/* CTA Section */}
      <section className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="glass neon-border rounded-3xl p-12 text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 via-transparent to-cyan-600/10 pointer-events-none" />
            <div className="relative">
              <h2 className="text-4xl md:text-5xl font-black mb-4">
                Pronto para{" "}
                <span className="gradient-text">escalar seu Instagram?</span>
              </h2>
              <p className="text-white/50 text-lg mb-8 max-w-xl mx-auto">
                Junte-se a milhares de criadores que já automatizam seu
                conteúdo com AutoScale.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link
                  href="/auth/register"
                  className="btn-primary flex items-center justify-center gap-2 text-base px-8 py-4"
                >
                  <Zap className="w-4 h-4" />
                  Começar gratuitamente
                </Link>
                <Link href="/auth/login" className="btn-ghost text-base px-8 py-4 text-center">
                  Já tenho uma conta
                </Link>
              </div>
              <p className="mt-6 text-xs text-white/30">
                Sem cartão de crédito necessário • 14 dias grátis
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <span className="font-bold gradient-text">AutoScale</span>
          </div>
          <p className="text-white/30 text-sm">
            © 2025 AutoScale. Todos os direitos reservados.
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
