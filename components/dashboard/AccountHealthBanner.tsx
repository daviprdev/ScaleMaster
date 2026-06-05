"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, X, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import Link from "next/link";

export interface AccountHealthError {
  id: string;
  username: string;
  errorType: "unsupported" | "token" | "unknown";
}

interface Props {
  accounts: AccountHealthError[];
}

const ERROR_LABELS: Record<AccountHealthError["errorType"], string> = {
  unsupported: "Conta pessoal — não suporta API de Reels",
  token:       "Token inválido / conta não confirmada",
  unknown:     "Erro desconhecido na Meta API",
};

const DISMISS_KEY = "accountHealthBannerDismissed";

export function AccountHealthBanner({ accounts }: Props) {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Só aparece se não foi dispensado nesta sessão
  useEffect(() => {
    if (accounts.length === 0) return;
    const dismissed = sessionStorage.getItem(DISMISS_KEY);
    if (!dismissed) setVisible(true);
  }, [accounts.length]);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  if (!visible || accounts.length === 0) return null;

  const preview = accounts.slice(0, 3);
  const rest = accounts.slice(3);

  return (
    <div className="relative z-50 shrink-0 border-b border-red-500/30 bg-red-950/60 backdrop-blur-sm">
      <div className="px-4 py-2.5 flex items-start gap-3">
        {/* Ícone */}
        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-red-300">
              {accounts.length} conta{accounts.length > 1 ? "s" : ""} com erro de publicação
            </span>
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-[10px] text-red-400/80 hover:text-red-300 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Ocultar" : "Ver detalhes"}
            </button>
            <Link
              href="/dashboard/failover"
              className="flex items-center gap-1 text-[10px] text-red-400/80 hover:text-red-300 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Gerenciar
            </Link>
          </div>

          {/* Preview sem expandir */}
          {!expanded && (
            <p className="text-[11px] text-red-400/70 mt-0.5">
              {preview.map(a => `@${a.username}`).join(", ")}
              {rest.length > 0 && ` e mais ${rest.length}…`}
            </p>
          )}

          {/* Lista expandida */}
          {expanded && (
            <ul className="mt-2 space-y-1">
              {accounts.map(a => (
                <li key={a.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  <span className="font-medium text-red-300">@{a.username}</span>
                  <span className="text-red-400/60">—</span>
                  <span className="text-red-400/80">{ERROR_LABELS[a.errorType]}</span>
                </li>
              ))}
              <li className="text-[10px] text-red-500/60 pt-1">
                Essas contas foram pausadas automaticamente. Corrija o problema e clique em{" "}
                <strong className="text-red-400">Restaurar</strong> na página de Failover.
              </li>
            </ul>
          )}
        </div>

        {/* Fechar */}
        <button
          onClick={dismiss}
          className="shrink-0 p-0.5 rounded text-red-500/60 hover:text-red-300 transition-colors"
          aria-label="Dispensar aviso"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
