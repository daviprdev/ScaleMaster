"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const MESSAGES: Record<string, { title: string; message: string }> = {
  invalid_token: {
    title: "Link inválido",
    message: "Este link é inválido ou foi atualizado. Solicite um novo link ao administrador.",
  },
  app_not_found: {
    title: "Link inválido",
    message: "O app Meta vinculado a este link não existe mais. Solicite um novo link.",
  },
  no_app_configured: {
    title: "Link inválido",
    message: "Nenhum app Meta configurado. Entre em contato com o administrador.",
  },
  cancelled: {
    title: "Conexão cancelada",
    message: "A autorização foi cancelada no Instagram. Abra o link novamente para conectar a conta.",
  },
  state_mismatch: {
    title: "Sessão expirada",
    message:
      "A sessão de conexão expirou ou os cookies foram bloqueados. Abra o link novamente — de preferência no navegador (Chrome/Safari), não dentro do Instagram ou WhatsApp.",
  },
  no_code: {
    title: "Erro ao conectar",
    message: "O Instagram não retornou a autorização. Abra o link novamente e aceite as permissões.",
  },
  rate_limit: {
    title: "Muitas tentativas",
    message: "A Meta limitou temporariamente as tentativas de conexão. Aguarde alguns minutos e abra o link novamente.",
  },
  personal_account: {
    title: "Conta não compatível",
    message:
      "Essa conta do Instagram não é profissional. Converta para conta Business ou Criador de Conteúdo nas configurações do Instagram e tente novamente.",
  },
  server_error: {
    title: "Erro ao conectar",
    message:
      "Falha temporária ao conectar com o Instagram. Aguarde alguns instantes e abra o mesmo link novamente — não é preciso gerar um novo.",
  },
};

function ErrorContent() {
  const params = useSearchParams();
  const reason = params.get("reason") ?? "unknown";
  const { title, message } = MESSAGES[reason] ?? {
    title: "Erro ao conectar",
    message: "Ocorreu um erro inesperado. Abra o link novamente ou solicite um novo ao administrador.",
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="glass-card rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
          <svg
            className="w-8 h-8 text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-white font-bold text-xl">{title}</h1>
        <p className="text-white/50 text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

export default function AddErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
