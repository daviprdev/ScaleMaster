"use client";

import * as React from "react";
import { Card, StatTile } from "@/components/ui";
import { cn } from "@/lib/utils";
import { LOG_MAX, acrescentarLog, contadoresDoLote, diferencasDeLog, retratar, rodadaDeEstruturacao, rotulosDaEstruturacao, type LinhaLog, type Retrato } from "@/lib/vps/painel";
import type { VpsJob } from "@/lib/vps/types";

/**
 * "Estruturação" + "Log da estruturação" (15/11): aparece enquanto houver
 * estruturação na fila ou rodando, igual ao painel do lote de criação.
 * Contadores da rodada (as estruturações criadas juntas) e o log montado no
 * cliente a partir do que muda entre um polling e outro (até LOG_MAX linhas).
 */
export function ProgressoEstruturacaoPanel({ jobs }: { jobs: readonly VpsJob[] }) {
  const rodada = React.useMemo(() => rodadaDeEstruturacao(jobs), [jobs]);
  const rotulos = React.useMemo(() => rotulosDaEstruturacao(rodada ?? []), [rodada]);
  const [linhas, setLinhas] = React.useState<LinhaLog[]>([]);
  const retrato = React.useRef<Retrato | null>(null);
  const caixa = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!rodada) {
      retrato.current = null;
      return;
    }
    const novas = diferencasDeLog(retrato.current, rodada, new Date(), rotulos, "Estruturação concluída");
    retrato.current = retratar(rodada);
    if (novas.length > 0) setLinhas((atual) => acrescentarLog(atual, novas));
  }, [rodada, rotulos]);

  // Auto-scroll para o fim só dentro da caixa do log (nunca rola a página).
  React.useEffect(() => {
    const el = caixa.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [linhas]);

  if (!rodada) return null;
  const c = contadoresDoLote(rodada);

  return (
    <div className="flex flex-col gap-4" data-testid="painel-estruturacao">
      <Card title="Estruturação" description={`Rodada atual · ${rodada.length} conta${rodada.length === 1 ? "" : "s"}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Na fila" value={String(c.queued)} hint="Esperando vaga" />
          <StatTile label="Rodando" value={String(c.running)} hint="Aparelho ligado, etapa em andamento" />
          <StatTile label="Concluídas" value={String(c.done)} hint="Todas as etapas sem falha" />
          <StatTile label="Falhas" value={String(c.error)} tone="negative" hint="Pararam na etapa com erro e desligaram" />
        </div>
      </Card>

      <Card title="Log da estruturação" description={`Etapas das contas da rodada, na ordem em que chegam (últimas ${LOG_MAX} linhas).`}>
        <div ref={caixa} className="h-56 overflow-y-auto rounded-[14px] border border-line bg-surface-raised p-3 font-mono text-xs leading-5" aria-live="polite">
          {linhas.length === 0 ? (
            <p className="text-ink-3">Esperando o agente…</p>
          ) : (
            linhas.map((l) => (
              <div key={l.id} className={cn("whitespace-pre-wrap break-words", l.erro ? "text-danger" : "text-ink-2")}>
                <span className="text-ink-3">{l.hora}</span> <span className={l.erro ? "text-danger" : "text-ink"}>@{l.conta}</span> · {l.etapa} · {l.mensagem}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
