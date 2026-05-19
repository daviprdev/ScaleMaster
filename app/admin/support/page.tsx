"use client";

import { Headphones, Mail, MessageSquare, AlertTriangle } from "lucide-react";

const SUPPORT_ACTIONS = [
  {
    icon: Mail,
    title: "Contato por e-mail",
    description: "Visualize e responda tickets de suporte enviados pelos usuários.",
    badge: "Em breve",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/20",
  },
  {
    icon: MessageSquare,
    title: "Mensagens diretas",
    description: "Canal de mensagens internas entre admins e usuários da plataforma.",
    badge: "Em breve",
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    icon: AlertTriangle,
    title: "Reportes e denúncias",
    description: "Análise de conteúdo reportado ou contas sinalizadas para revisão.",
    badge: "Em breve",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
];

export default function AdminSupportPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Suporte</h1>
        <p className="mt-1 text-sm text-white/40">
          Central de atendimento e gestão de tickets
        </p>
      </div>

      {/* Placeholder cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SUPPORT_ACTIONS.map(({ icon: Icon, title, description, badge, color, bg }) => (
          <div
            key={title}
            className={`rounded-xl border p-5 flex flex-col gap-4 ${bg} opacity-60`}
          >
            <div className="flex items-start justify-between">
              <div className={`${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30 border border-white/10 rounded-full px-2 py-0.5">
                {badge}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="text-xs text-white/40 mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] flex flex-col items-center justify-center gap-4 py-20 text-white/30">
        <Headphones className="w-10 h-10" />
        <div className="text-center">
          <p className="text-sm font-medium">Módulo de suporte em desenvolvimento</p>
          <p className="text-xs mt-1 text-white/20">
            Tickets, mensagens e reportes estarão disponíveis em breve.
          </p>
        </div>
      </div>
    </div>
  );
}
