"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { AlertCircle, XCircle, UserX, ServerCrash, Clock, ArrowLeft } from "lucide-react";

const ERROR_MAP: Record<string, { title: string; message: string; Icon: typeof AlertCircle }> = {
  invalid_token: {
    title: "Link inválido ou expirado",
    message: "O link que você acessou não existe ou foi revogado. Peça um novo link para quem gerou.",
    Icon: XCircle,
  },
  app_not_found: {
    title: "Aplicativo não encontrado",
    message: "O Meta App associado a este link foi removido ou desconfigurado. Avise o proprietário do link.",
    Icon: ServerCrash,
  },
  no_app_configured: {
    title: "Nenhum app configurado",
    message: "Não há um Meta App global configurado neste ambiente. O administrador precisa configurar antes de gerar links.",
    Icon: ServerCrash,
  },
  cancelled: {
    title: "Autorização cancelada",
    message: "Você cancelou a autorização no Instagram. Nenhuma conta foi conectada. Tente novamente se desejar.",
    Icon: UserX,
  },
  state_mismatch: {
    title: "Sessão expirada ou inválida",
    message: "A validação de segurança falhou. Isso pode acontecer se a aba ficou aberta por muito tempo. Tente acessar o link novamente.",
    Icon: Clock,
  },
  no_code: {
    title: "Autorização incompleta",
    message: "O Instagram não retornou o código de autorização. Tente acessar o link novamente.",
    Icon: AlertCircle,
  },
  personal_account: {
    title: "Conta pessoal não suportada",
    message: "A conta do Instagram que você tentou conectar é pessoal. Converta-a para Business ou Creator nas configurações do Instagram e tente novamente.",
    Icon: UserX,
  },
  rate_limit: {
    title: "Muitas tentativas",
    message: "O Instagram limitou temporariamente as solicitações. Aguarde alguns minutos e tente novamente.",
    Icon: Clock,
  },
  server_error: {
    title: "Erro ao conectar a conta",
    message: "Algo deu errado durante a conexão. Se o problema persistir, peça um novo link ou entre em contato com o suporte.",
    Icon: ServerCrash,
  },
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") ?? "";
  const detail = searchParams.get("detail") ?? "";

  const mapped = ERROR_MAP[reason] ?? ERROR_MAP.server_error;
  const Icon = mapped.Icon;

  return (
    <div className="min-h-screen bg-[#050507] text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full glass rounded-2xl border border-white/10 shadow-2xl p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <Icon size={24} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{mapped.title}</h1>
            <p className="text-white/50 text-sm mt-1.5 leading-relaxed">{mapped.message}</p>
          </div>
        </div>

        {detail && (
          <div className="px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/40 text-xs font-mono break-all">
            {detail}
          </div>
        )}

        <div className="pt-2">
          <Link
            href="/"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm font-medium text-white/70 hover:bg-white/[0.07] hover:text-white transition-all"
          >
            <ArrowLeft size={14} />
            Voltar para o ScaleMaster
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AddErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#050507] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      }
    >
      <ErrorContent />
    </Suspense>
  );
}