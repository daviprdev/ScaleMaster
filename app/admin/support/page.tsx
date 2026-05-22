"use client";

import { Headphones, Mail, MessageSquare, AlertTriangle } from "lucide-react";

const SUPPORT_ACTIONS = [
  {
    icon: Mail,
    title: "Contato por e-mail",
    description: "Visualize e responda tickets de suporte enviados pelos usuários.",
    badge: "Em breve",
    color: "text-[#00E5FF]",
    border: "border-[#00E5FF]/20",
  },
  {
    icon: MessageSquare,
    title: "Mensagens diretas",
    description: "Canal de mensagens internas entre admins e usuários da plataforma.",
    badge: "Em breve",
    color: "text-[#00FF41]",
    border: "border-[#00FF41]/20",
  },
  {
    icon: AlertTriangle,
    title: "Reportes e denúncias",
    description: "Análise de conteúdo reportado ou contas sinalizadas para revisão.",
    badge: "Em breve",
    color: "text-amber-400",
    border: "border-amber-500/20",
  },
];

export default function AdminSupportPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Suporte</h1>
        <p className="page-subtitle mt-1">
          Central de atendimento e gestão de tickets
        </p>
      </div>

      {/* Placeholder cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SUPPORT_ACTIONS.map(({ icon: Icon, title, description, badge, color, border }) => (
          <div
            key={title}
            className={`glass-card rounded-2xl p-5 flex flex-col gap-4 opacity-55 ${border}`}
          >
            <div className="flex items-start justify-between">
              <div className={color}>
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30 border border-white/10 rounded-full px-2 py-0.5">
                {badge}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white/80">{title}</p>
              <p className="text-xs text-white/40 mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      <div className="glass-card rounded-2xl flex flex-col items-center justify-center gap-4 py-20 text-white/30">
        <Headphones className="w-10 h-10" />
        <div className="text-center">
          <p className="text-sm font-medium text-white/40">Módulo de suporte em desenvolvimento</p>
          <p className="text-xs mt-1 text-white/20">
            Tickets, mensagens e reportes estarão disponíveis em breve.
          </p>
        </div>
      </div>
    </div>
  );
}
