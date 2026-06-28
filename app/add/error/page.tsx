"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const MESSAGES: Record<string, string> = {
  invalid_token: "Este link é inválido ou foi atualizado. Solicite um novo link ao administrador.",
  app_not_found: "O app Meta vinculado a este link não existe mais. Solicite um novo link.",
  no_app_configured: "Nenhum app Meta configurado. Entre em contato com o administrador.",
};

function ErrorContent() {
  const params = useSearchParams();
  const reason = params.get("reason") ?? "unknown";
  const message = MESSAGES[reason] ?? "Ocorreu um erro inesperado. Solicite um novo link.";

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
        <h1 className="text-white font-bold text-xl">Link inválido</h1>
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
