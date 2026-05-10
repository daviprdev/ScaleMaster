"use client";

import { motion } from "framer-motion";
import {
  Instagram,
  Download,
  CalendarCheck,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

const stagger = {
  show: { transition: { staggerChildren: 0.08 } },
};

const stats = [
  {
    label: "Contas Conectadas",
    value: "4",
    change: "+1 este mês",
    up: true,
    icon: Instagram,
    color: "from-pink-500 to-rose-600",
    glow: "rgba(244,63,94,0.3)",
  },
  {
    label: "Vídeos Baixados",
    value: "128",
    change: "+23 esta semana",
    up: true,
    icon: Download,
    color: "from-violet-500 to-purple-600",
    glow: "rgba(139,92,246,0.3)",
  },
  {
    label: "Postagens Agendadas",
    value: "17",
    change: "Próxima em 2h",
    up: null,
    icon: CalendarCheck,
    color: "from-cyan-500 to-blue-600",
    glow: "rgba(6,182,212,0.3)",
  },
  {
    label: "Engajamento Médio",
    value: "4.7%",
    change: "+0.3% vs semana passada",
    up: true,
    icon: TrendingUp,
    color: "from-emerald-500 to-teal-600",
    glow: "rgba(16,185,129,0.3)",
  },
];

const recentActivity = [
  {
    type: "download",
    text: 'Reel baixado de @fitness_brasil',
    time: "há 12 min",
    status: "success",
  },
  {
    type: "schedule",
    text: 'Postagem agendada para @minha_marca',
    time: "há 35 min",
    status: "success",
  },
  {
    type: "process",
    text: 'Metadados removidos — video_0091.mp4',
    time: "há 1h",
    status: "success",
  },
  {
    type: "schedule",
    text: 'Falha ao agendar para @loja_teste',
    time: "há 2h",
    status: "error",
  },
  {
    type: "download",
    text: 'Reel baixado de @travel_vibes',
    time: "há 3h",
    status: "success",
  },
];

const scheduledPosts = [
  {
    account: "@minha_marca",
    time: "14:00",
    date: "Hoje",
    thumb: "from-violet-500 to-cyan-500",
  },
  {
    account: "@loja_oficial",
    time: "18:30",
    date: "Hoje",
    thumb: "from-pink-500 to-orange-500",
  },
  {
    account: "@minha_marca",
    time: "09:00",
    date: "Amanhã",
    thumb: "from-emerald-500 to-teal-500",
  },
  {
    account: "@loja_oficial",
    time: "12:00",
    date: "Amanhã",
    thumb: "from-amber-500 to-orange-500",
  },
];

export default function DashboardPage() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="space-y-6 max-w-7xl"
    >
      {/* Stats grid */}
      <motion.div
        variants={stagger}
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        {stats.map((stat, i) => (
          <motion.div
            key={i}
            variants={fadeUp}
            className="glass-card p-5 group hover:border-white/20 transition-all duration-300 relative overflow-hidden"
            style={{
              boxShadow: `0 0 0 1px rgba(255,255,255,0.07)`,
            }}
          >
            <div
              className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 blur-2xl"
              style={{ background: stat.glow }}
            />
            <div className="flex items-start justify-between mb-4">
              <div
                className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center group-hover:scale-110 transition-transform`}
              >
                <stat.icon className="w-4.5 h-4.5 text-white" size={18} />
              </div>
              {stat.up !== null && (
                <span
                  className={`flex items-center gap-0.5 text-xs font-medium ${
                    stat.up ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {stat.up ? (
                    <ArrowUpRight size={12} />
                  ) : (
                    <ArrowDownRight size={12} />
                  )}
                </span>
              )}
            </div>
            <div className="text-2xl font-black text-white mb-0.5">
              {stat.value}
            </div>
            <div className="text-xs text-white/40 font-medium">{stat.label}</div>
            <div className="text-[10px] text-white/25 mt-1">{stat.change}</div>
          </motion.div>
        ))}
      </motion.div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <motion.div variants={fadeUp} className="lg:col-span-2 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white/90">Atividade Recente</h2>
            <button className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
              Ver tudo
            </button>
          </div>
          <div className="space-y-3">
            {recentActivity.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0"
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    item.status === "success"
                      ? "bg-emerald-500/15"
                      : "bg-red-500/15"
                  }`}
                >
                  {item.status === "success" ? (
                    <CheckCircle2
                      size={14}
                      className="text-emerald-400"
                    />
                  ) : (
                    <AlertCircle size={14} className="text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/70 truncate">{item.text}</p>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-white/25 flex-shrink-0">
                  <Clock size={10} />
                  {item.time}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Scheduled Posts */}
        <motion.div variants={fadeUp} className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white/90">Próximas Postagens</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
              {scheduledPosts.length} agendadas
            </span>
          </div>
          <div className="space-y-3">
            {scheduledPosts.map((post, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.06 }}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
              >
                <div
                  className={`w-10 h-10 rounded-lg bg-gradient-to-br ${post.thumb} flex items-center justify-center flex-shrink-0`}
                >
                  <Play size={14} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/80">
                    {post.account}
                  </p>
                  <p className="text-[10px] text-white/30">
                    {post.date} às {post.time}
                  </p>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Quick actions */}
      <motion.div variants={fadeUp} className="glass-card p-5">
        <h2 className="font-semibold text-white/90 mb-4">Ações Rápidas</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Pesquisar Reels",
              href: "/dashboard/search",
              icon: "🔍",
              desc: "Scraping de perfil",
            },
            {
              label: "Ver Biblioteca",
              href: "/dashboard/library",
              icon: "📁",
              desc: "Seus vídeos",
            },
            {
              label: "Agendar Post",
              href: "/dashboard/schedule",
              icon: "📅",
              desc: "Múltiplas contas",
            },
            {
              label: "Adicionar Conta",
              href: "#",
              icon: "➕",
              desc: "Conectar Instagram",
            },
          ].map((action, i) => (
            <motion.a
              key={i}
              href={action.href}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-violet-500/30 hover:bg-violet-600/5 transition-all cursor-pointer text-center"
            >
              <span className="text-2xl">{action.icon}</span>
              <div>
                <p className="text-xs font-medium text-white/80">
                  {action.label}
                </p>
                <p className="text-[10px] text-white/30">{action.desc}</p>
              </div>
            </motion.a>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
