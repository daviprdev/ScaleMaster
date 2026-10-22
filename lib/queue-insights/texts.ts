/**
 * Raio-X da fila — números em pt-BR e os textos que o painel mostra
 * (exatamente os de docs/fila-ideal.md).
 *
 * Formatação feita à mão para não depender do ICU do Node: 1234 → "1.234".
 */

import { brtDay, brtHour } from "./time";

// ---------------------------------------------------------------------------
// Números e datas
// ---------------------------------------------------------------------------

/** Inteiro com separador de milhar pt-BR: 1234567 → "1.234.567". */
export function fmtInt(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "1 publicação" / "1.234 publicações". */
export function plural(count: number, one: string, many: string): string {
  return `${fmtInt(count)} ${Math.round(count) === 1 ? one : many}`;
}

/** Hora BRT 0–23 → "09h". */
export function fmtHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}h`;
}

/** Dia/mês BRT do instante: "09/10". */
export function fmtDayMonth(at: string | number | Date): string {
  return dayMonthOf(brtDay(at));
}

/** "2026-10-09" → "09/10". */
export function dayMonthOf(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

const views = (n: number) => plural(n, "visualização", "visualizações");

// ---------------------------------------------------------------------------
// Um post seu está indo muito bem agora
// ---------------------------------------------------------------------------

export const HOT_TITLE = "Um post seu está indo muito bem agora";

/** "108.834 views em 09/10 às 09h" (hora da publicação, BRT). */
export function hotEyebrow(postViews: number, publishedAt: string): string {
  return `${fmtInt(postViews)} views em ${fmtDayMonth(publishedAt)} às ${fmtHour(brtHour(publishedAt))}`;
}

/**
 * Texto do post. `typicalViews` = mediana das views do vídeo na fila; abaixo da
 * média da fila vira a variante "saiu da curva".
 */
export function hotBody(p: {
  username: string;
  views: number;
  typicalViews: number | null;
  queueAverage: number | null;
}): string {
  const opening = `A publicação da @${p.username} já passou de ${views(p.views)}.`;
  if (p.typicalViews == null) {
    return `${opening} Vale colocar esse vídeo nas outras contas ainda hoje — o assunto está quente.`;
  }
  if (p.queueAverage != null && p.typicalViews < p.queueAverage) {
    return (
      `${opening} Esse post saiu da curva: na publicação típica o vídeo faz ${views(p.typicalViews)}. ` +
      "Vale testar ele nas outras contas ainda hoje."
    );
  }
  return (
    `${opening} Esse vídeo já rende bem em geral: ${views(p.typicalViews)} na publicação típica dele. ` +
    "Vale colocar esse vídeo nas outras contas ainda hoje — o assunto está quente."
  );
}

// ---------------------------------------------------------------------------
// A sua fila ideal, montada com o que já funciona
// ---------------------------------------------------------------------------

export const IDEAL_TITLE = "A sua fila ideal, montada com o que já funciona";
export const IDEAL_FOOTNOTE =
  "Refeita toda vez que você abre o Raio-X, com os números mais recentes. Dá para mudar tudo antes de publicar.";

/** Sem nenhum vídeo com posts contados em 3 contas. */
export const IDEAL_NO_VIDEOS_TEXT =
  "Ainda nenhum vídeo tem posts com 1h+ em 3 contas — a fila ideal aparece assim que tiver.";
/** A fila tem menos de 3 contas: nenhum vídeo vai chegar a 3. */
export const IDEAL_FEW_ACCOUNTS_TEXT =
  "Essa fila tem menos de 3 contas — a fila ideal precisa de vídeos rodando em 3 contas.";
/** Há vídeos com 3 contas, mas nenhum está mais na pasta da fila. */
export const IDEAL_OUT_OF_FOLDER_TEXT =
  "Os vídeos que já rodaram em 3 contas não estão mais na pasta da fila — a fila ideal só usa vídeos da pasta.";
/** Nenhuma conta da fila pode entrar (fora do ar, com erro ou sem post contado). */
export const IDEAL_NO_ACCOUNTS_TEXT =
  "Nenhuma conta da fila está ativa, sem erro e com posts de 1h+ — a fila ideal precisa de contas para postar.";

/** "~868 views por publicação". */
export function idealEyebrow(expectedPerPost: number): string {
  return `~${fmtInt(expectedPerPost)} views por publicação`;
}

export interface IdealBodyParts {
  n: number;
  m: number;
  postsPerCycle: number;
  intervalMinutes: number;
  expectedPerPost: number;
  medianPerPost: number | null;
  bestHour: number | null;
  bestHourViews: number | null;
  /** "20/08" ou null. */
  patternDay: string | null;
}

/** As frases de horário e de dia somem quando não há dado. */
export function idealBody(p: IdealBodyParts): string {
  const videosPart = p.n === 1 ? "o seu melhor vídeo" : `os seus ${fmtInt(p.n)} melhores vídeos`;
  const accountsPart = p.m === 1 ? "a sua melhor conta" : `as suas ${fmtInt(p.m)} melhores contas`;
  let text =
    `Cruzei ${videosPart} com ${accountsPart}: ${plural(p.postsPerCycle, "publicação", "publicações")} por ciclo, ` +
    `uma a cada ${fmtInt(p.intervalMinutes)} min. — são ${views(p.expectedPerPost)} por publicação`;
  if (p.medianPerPost != null) text += `, contra ${fmtInt(p.medianPerPost)} do seu material mediano`;
  text += ".";
  if (p.bestHour != null && p.bestHourViews != null) {
    text += ` E o melhor horário para ${p.m === 1 ? "ela" : "elas"} é ${fmtHour(p.bestHour)}, onde você tem tido ${views(p.bestHourViews)}.`;
  }
  text += p.patternDay
    ? ` Nenhuma conta repete o mesmo vídeo — que foi o padrão do dia ${p.patternDay}.`
    : " Nenhuma conta repete o mesmo vídeo.";
  return text;
}
