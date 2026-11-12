"use client";

import * as React from "react";
import { CheckCircle2, UserPlus } from "lucide-react";
import { Card, StatTile } from "@/components/ui";
import { resumoDasContas } from "@/lib/vps/pastas";
import { cn } from "@/lib/utils";
import { VPS_FLUXO } from "@/lib/vps/jobs";
import { LOG_MAX, acrescentarLog, contadoresDoLote, diferencasDeLog, loteAtual, proxiesDoLote, retratar, type LinhaLog, type Retrato } from "@/lib/vps/painel";
import type { VpsJob } from "@/lib/vps/types";

/**
 * "Progresso" + "Log" da rodada atual (lote mais recente com conta na fila ou
 * rodando). Contadores e proxies saem dos jobs; o log é montado no cliente a
 * partir do que muda entre um polling e outro (até LOG_MAX linhas). Sem lote
 * ativo, Progresso e Log somem e fica uma linha com os totais das contas
 * (12/11); voltam sozinhos quando uma rodada começa.
 */
const SEM_RODADA: readonly VpsJob[] = [];

export function ProgressoLotePanel({ jobs }: { jobs: readonly VpsJob[] }) {
  const lote = React.useMemo(() => loteAtual(jobs), [jobs]);
  const rotulos = React.useMemo(() => new Map(VPS_FLUXO.map((s) => [s.key, s.label])), []);
  const [linhas, setLinhas] = React.useState<LinhaLog[]>([]);
  const retrato = React.useRef<Retrato | null>(null);
  const loteVisto = React.useRef<string | null>(null);
  const caixa = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!lote) {
      retrato.current = null;
      loteVisto.current = null;
      return;
    }
    if (loteVisto.current !== lote.loteId) {
      retrato.current = null;
      loteVisto.current = lote.loteId;
      setLinhas([]);
    }
    const novas = diferencasDeLog(retrato.current, lote.jobs, new Date(), rotulos);
    retrato.current = retratar(lote.jobs);
    if (novas.length > 0) setLinhas((atual) => acrescentarLog(atual, novas));
  }, [lote, rotulos]);

  // Auto-scroll para o fim só dentro da caixa do log (nunca rola a página).
  React.useEffect(() => {
    const el = caixa.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [linhas]);

  const doLote = lote?.jobs ?? SEM_RODADA;
  const c = contadoresDoLote(doLote);
  const proxies = proxiesDoLote(doLote);
  const total = React.useMemo(() => resumoDasContas(jobs), [jobs]);

  if (!lote) {
    if (total.total === 0) return null;
    const partes = [
      `${total.criadas} criada${total.criadas === 1 ? "" : "s"}`,
      total.criando ? `${total.criando} na fila` : "",
      total.falhas ? `${total.falhas} com falha` : "",
    ].filter(Boolean);
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3 text-sm" data-testid="painel-progresso">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <UserPlus size={14} className="text-ink-3" />
          {total.total} conta{total.total === 1 ? "" : "s"}
        </span>
        <span className="text-ink-2">{partes.join(" · ")}</span>
        <span className="inline-flex items-center gap-1.5 text-success">
          <CheckCircle2 size={14} />
          {total.prontas} conectada{total.prontas === 1 ? "" : "s"} no SaaS
        </span>
        <span className="ml-auto text-xs text-ink-3">Progresso e log aparecem quando um lote estiver sendo criado.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="painel-progresso">
      <Card
        title="Progresso"
        description={
          lote
            ? `Rodada atual · ${doLote.length} conta${doLote.length === 1 ? "" : "s"} · lote ${lote.loteId.slice(0, 8)}`
            : "Nenhuma conta sendo criada agora. Os números voltam a andar quando uma rodada começar."
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Na fila" value={String(c.queued)} hint="Esperando vaga de cadastro" />
          <StatTile label="Rodando" value={String(c.running)} hint="Container ligado, etapa em andamento" />
          <StatTile label="Criadas" value={String(c.done)} hint="Cadastro, aquecimento e sessão prontos" />
          <StatTile label="Falhas" value={String(c.error)} tone="negative" hint="Pararam: Continuar retoma da etapa" />
        </div>
        <div className="mt-4">
          <p className="text-[13px] font-medium text-ink-2">Proxies da rodada</p>
          {proxies.length === 0 ? (
            <p className="mt-1 text-xs text-ink-3">{lote ? "Sem proxy legível nas contas deste lote." : "Nenhuma rodada em andamento."}</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {proxies.map((p) => (
                <li key={p} className="rounded-md border border-line bg-surface-raised px-2 py-1 font-mono text-xs text-ink">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title="Log" description={`Etapas das contas da rodada, na ordem em que chegam (últimas ${LOG_MAX} linhas).`}>
        <div ref={caixa} className="h-56 overflow-y-auto rounded-lg border border-line bg-surface-raised p-3 font-mono text-xs leading-5" aria-live="polite">
          {linhas.length === 0 ? (
            <p className="text-ink-3">{lote ? "Esperando o agente…" : "Nenhuma rodada em andamento."}</p>
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
