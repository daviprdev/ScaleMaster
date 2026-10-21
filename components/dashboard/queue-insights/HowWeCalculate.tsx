"use client";

import { ChevronDown } from "lucide-react";

/** Texto curto, aberto sob demanda, no lugar de tooltips longos. Regras completas em docs/fila-ideal.md. */
export function HowWeCalculate() {
  return (
    <details className="group rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-ink [&::-webkit-details-marker]:hidden">
        Como calculamos
        <ChevronDown size={14} className="text-ink-3 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-4 leading-5">
        <li>
          Só contam posts <span className="text-ink">maduros</span>: views lidas com 4h ou mais de publicação.
        </li>
        <li>
          <span className="text-ink">Normal da conta</span>: mediana das views da própria conta nos dias em volta do
          post (precisa de 20 posts).
        </li>
        <li>
          <span className="text-ink">Nota do vídeo</span>: quantas vezes ele rendeu o normal de cada conta. Cada conta
          vale um voto; a nota é a mediana. Entra na fila ideal com 3+ contas votando e nota de 1,2× ou mais.
        </li>
        <li>
          <span className="text-ink">Contas boas</span>: normal de 30+ views e pelo menos metade da conta típica da
          fila.
        </li>
        <li>
          <span className="text-ink">Previsão</span>: normal da conta × nota do vídeo, na média de todas as
          combinações. A fila de hoje é medida na mesma régua.
        </li>
        <li>Hora e dia sempre no horário de Brasília. Nada muda sozinho: a fila só nasce quando você confirma no Postar.</li>
      </ul>
    </details>
  );
}
