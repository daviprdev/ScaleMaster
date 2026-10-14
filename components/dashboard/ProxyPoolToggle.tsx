"use client";

import { ShieldCheck, ShieldAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// ── ProxyPoolToggle ────────────────────────────────────────────────────────
// Opção opt-in: usar proxies do estoque na publicação via Meta Graph API.
//
// IMPORTANTE: Esta opção controla apenas o caminho de rede entre o SaaS e a
// API da Meta. A Meta continua processando a publicação em sua própria
// infraestrutura. Se o vídeo for fornecido por URL pública, a busca desse
// vídeo pela própria Meta NÃO passa pelo proxy do SaaS.
//
// Comportamento:
// - OFF (padrão): fluxo atual, chamada direta à Meta sem proxy
// - ON: no momento da execução, o worker seleciona um proxy ativo do estoque
//   do usuário (round-robin por post_id) e roteia as chamadas à Meta através dele
// - A escolha é feita na execução, não no agendamento — proxies mortos são ignorados
// - Sem fallback silencioso: se não há proxy ativo, a publicação falha com erro visível

interface ProxyPoolToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function ProxyPoolToggle({
  value,
  onChange,
  disabled = false,
  className,
}: ProxyPoolToggleProps) {
  return (
    <div className={cn("rounded-xl border transition-colors",
      value
        ? "border-[#00498D]/40 bg-[#00498D]/[0.06]"
        : "border-white/[0.07] bg-white/[0.02]",
      disabled && "opacity-50 pointer-events-none",
      className
    )}>
      <div className="flex items-center justify-between gap-3 p-3.5">
        <div className="flex items-start gap-2.5 min-w-0">
          {value ? (
            <ShieldCheck size={14} className="text-[#85B9E9] flex-shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert size={14} className="text-white/30 flex-shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p className={cn(
              "text-sm font-medium transition-colors",
              value ? "text-[#85B9E9]" : "text-white/60"
            )}>
              Usar proxies do estoque nesta publicação
            </p>
            <p className="text-[10px] text-white/35 leading-relaxed mt-0.5">
              {value
                ? "As chamadas à API da Meta passarão por um proxy ativo do seu estoque (selecionado automaticamente na execução)."
                : "Conexão direta à API da Meta, sem proxy."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => !disabled && onChange(!value)}
          disabled={disabled}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00498D]/50",
            value ? "bg-[#00498D]" : "bg-white/10"
          )}
          aria-label={value ? "Desativar proxy do estoque" : "Ativar proxy do estoque"}
          role="switch"
          aria-checked={value}
        >
          <span className={cn(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200",
            value ? "translate-x-5" : "translate-x-0"
          )} />
        </button>
      </div>

      {/* Aviso sobre limitações do proxy */}
      {value && (
        <div className="px-3.5 pb-3 pt-0">
          <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/10">
            <Info size={10} className="text-amber-400/70 flex-shrink-0 mt-0.5" />
            <p className="text-[9px] text-amber-200/50 leading-relaxed">
              O proxy afeta apenas a comunicação SaaS → Meta. Se o vídeo for uma URL pública,
              a Meta buscará o conteúdo diretamente (sem passar pelo proxy).
              Nenhum dado de autenticação é exposto.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}