"use client";

import { cn } from "@/lib/utils";
import type { BestDay, BestHour, DayPattern } from "@/lib/queue-insights/types";
import { fmtCompact, fmtDayKey, fmtHourRange, fmtInt, fmtMinutes, fmtMultiple } from "./format";
import { InsightCard } from "./parts";

/** Melhor horário e melhor dia da fila (14 dias, BRT). */
export function TimingSection({ bestHour, bestDay }: { bestHour: BestHour | null; bestDay: BestDay | null }) {
  return (
    <>
      <BestHourCard bestHour={bestHour} />
      <BestDayCard bestDay={bestDay} />
    </>
  );
}

function BestHourCard({ bestHour }: { bestHour: BestHour | null }) {
  if (!bestHour) {
    return (
      <InsightCard eyebrow="Melhor horário" tone="neutral" title="O horário não fez diferença nesta fila">
        <p className="text-[13px] leading-5 text-ink-2">
          Nenhuma hora rendeu claramente acima das outras nos últimos 14 dias — dá para postar ao longo do dia.
        </p>
      </InsightCard>
    );
  }

  const scores = bestHour.hourScores ?? {};
  const max = Math.max(...Object.values(scores), bestHour.score, 1);

  return (
    <InsightCard
      eyebrow="Melhor horário"
      tone="accent"
      title={`Das ${bestHour.hour}h às ${(bestHour.hour + 1) % 24}h`}
    >
      <p className="text-[13px] leading-5 text-ink-2">
        Os posts publicados nessa hora renderam <span className="font-medium text-ink">{fmtMultiple(bestHour.score)}</span>{" "}
        o normal da conta, com{" "}
        <span className="font-medium text-success" title={fmtInt(bestHour.typicalViews)}>
          {fmtCompact(bestHour.typicalViews)}
        </span>{" "}
        views típicas.
      </p>

      {/* 24 barras: altura = nota da hora; sem barra = menos de 10 posts ou 3 contas */}
      <div aria-hidden="true" className="flex flex-col gap-1">
        <div className="flex h-12 items-end gap-[2px]">
          {Array.from({ length: 24 }, (_, h) => {
            const s = scores[h];
            return (
              <div
                key={h}
                className={cn(
                  "flex-1 rounded-sm",
                  s == null ? "bg-line" : h === bestHour.hour ? "bg-accent" : "bg-line-control"
                )}
                style={{ height: s == null ? 2 : `${Math.max(8, (s / max) * 100)}%` }}
              />
            );
          })}
        </div>
        <div className="flex justify-between font-mono text-[10px] text-ink-3">
          <span>0h</span>
          <span>6h</span>
          <span>12h</span>
          <span>18h</span>
          <span>23h</span>
        </div>
      </div>
    </InsightCard>
  );
}

const ROWS: { label: string; get: (d: DayPattern) => string }[] = [
  { label: "Contas", get: (d) => fmtInt(d.accounts) },
  { label: "Posts", get: (d) => fmtInt(d.posts) },
  { label: "Intervalo por conta", get: (d) => fmtMinutes(d.medianIntervalMinutes) },
  { label: "Faixa de horário", get: (d) => fmtHourRange(d.hourFrom, d.hourTo) },
  { label: "Mesmo vídeo 2× no dia", get: (d) => fmtInt(d.repeatedSameDay) },
  { label: "Vídeo que a conta já tinha usado", get: (d) => fmtInt(d.repeatedFromBefore) },
  { label: "Contas também em outras filas", get: (d) => fmtInt(d.accountsAlsoInOtherQueues) },
];

function BestDayCard({ bestDay }: { bestDay: BestDay | null }) {
  if (!bestDay) {
    return (
      <InsightCard eyebrow="Melhor dia" tone="neutral" title="Ainda não há um dia para comparar">
        <p className="text-[13px] leading-5 text-ink-2">
          Precisa de um dia inteiro com quase todos os posts já lidos, pelo menos 20 posts e 3 contas.
        </p>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      eyebrow="Melhor dia"
      tone="success"
      title={`${fmtDayKey(bestDay.date)}: ${fmtMultiple(bestDay.medianMultiple)} o normal`}
    >
      <p className="text-[13px] leading-5 text-ink-2">
        Mediana de{" "}
        <span className="font-medium text-success" title={fmtInt(bestDay.medianViews)}>
          {fmtCompact(bestDay.medianViews)}
        </span>{" "}
        views por post (média {fmtCompact(bestDay.meanViews)}). Compare o jeito que a fila rodou nesse dia com hoje:
      </p>

      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-hover text-left text-ink-3">
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Item</span>
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Melhor dia</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Hoje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-ink-2">
                  {row.label}
                </th>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{row.get(bestDay)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                  {bestDay.today ? row.get(bestDay.today) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!bestDay.today && <p className="text-xs text-ink-3">Hoje a fila ainda não publicou nada.</p>}
    </InsightCard>
  );
}
