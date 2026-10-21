/**
 * Raio-X da fila — números em pt-BR e os textos que o painel mostra.
 *
 * Puro (roda no navegador junto com buildIdealQueue). Formatação feita à mão
 * para não depender do ICU do Node: 1234 → "1.234", 1.25 → "1,3".
 */

import { ANALYSIS_DAYS, HOUR_MS, MIN_READY_VIDEOS, MIN_VOTING_ACCOUNTS, NORMAL_MIN_POSTS, NORMAL_MIN_VIEWS } from "./constants";
import { brtHour, toMs } from "./time";

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/** Inteiro com separador de milhar pt-BR: 1234567 → "1.234.567". */
export function fmtInt(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Decimal pt-BR com `digits` casas: 1.25 → "1,3". */
export function fmtDecimal(value: number, digits = 1): string {
  const fixed = Math.abs(value).toFixed(digits);
  const [int, frac] = fixed.split(".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return sign + fmtInt(Number(int)) + (frac ? "," + frac : "");
}

/** Múltiplo: 1.25 → "1,3×". */
export function fmtMultiple(value: number): string {
  return `${fmtDecimal(value, 1)}×`;
}

/** Intervalo por conta: 30 → "30 min", 120 → "2h", 90 → "1h30". */
export function fmtInterval(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const min = total % 60;
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, "0")}`;
}

/** Hora BRT "HH:MM" do instante. */
export function fmtClock(at: string | number): string {
  const d = new Date(toMs(at) - 3 * HOUR_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "1 vídeo" / "3 vídeos". */
export function plural(count: number, one: string, many: string): string {
  return `${fmtInt(count)} ${count === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Prontidão (item 9)
// ---------------------------------------------------------------------------

export const READINESS_IMPOSSIBLE_TEXT = "Essa fila não repete vídeo em 3 contas — a régua não vai fechar.";
export const READINESS_NO_ACCOUNTS_TEXT = `Nenhuma conta passou de ${NORMAL_MIN_VIEWS} views por post ainda.`;
/** Nenhuma conta tem amostra para o normal — o problema é a quantidade de posts, não as views. */
export const READINESS_NO_NORMALS_TEXT =
  `As contas ainda não têm ${NORMAL_MIN_POSTS} posts lidos nos últimos ${ANALYSIS_DAYS} dias para medir o normal.`;

export function collectingText(covered: number, fewAccounts: number, awaiting: number, etaHours: number | null): string {
  const coveredPart = covered === 1 ? "1 vídeo já rodou" : `${fmtInt(covered)} vídeos já rodaram`;
  const fewPart = fewAccounts === 1 ? "1 vídeo está" : `${fmtInt(fewAccounts)} vídeos estão`;
  const awaitingPart = awaiting === 1 ? "1 post aguarda" : `${fmtInt(awaiting)} posts aguardam`;
  let text =
    `Coletando dados: ${coveredPart} em ${MIN_VOTING_ACCOUNTS}+ contas com leitura de 4h (precisa de ${MIN_READY_VIDEOS}). ` +
    `${fewPart} em 1–2 contas e ${awaitingPart} a leitura de 4h.`;
  if (etaHours != null) {
    text += etaHours > 0 ? ` Previsão: ~${fmtInt(etaHours)}h.` : " Previsão: nas próximas horas.";
  }
  return text;
}

export function fewGoodText(covered: number, passing: number): string {
  const passingPart =
    passing === 0 ? "nenhum está" : passing === 1 ? "só 1 está" : `só ${fmtInt(passing)} estão`;
  return `Já dá para comparar ${fmtInt(covered)} vídeos, mas ${passingPart} acima do normal das contas — a fila ideal precisa de ${MIN_READY_VIDEOS}.`;
}

export function readyText(passing: number, goodAccounts: number): string {
  const accountsPart = goodAccounts === 1 ? "1 conta está boa" : `${fmtInt(goodAccounts)} contas estão boas`;
  return `${plural(passing, "vídeo passa", "vídeos passam")} na régua e ${accountsPart} — a fila ideal está pronta.`;
}

// ---------------------------------------------------------------------------
// Post bombando (item 8)
// ---------------------------------------------------------------------------

export const HOT_TITLE = "Fora da curva agora";
export const HOT_NONE_TITLE = "Nenhum post fora da curva nas últimas 48h";

export function hotHighlightText(username: string, views: number, multiple: number, isLoop: boolean): string {
  let body =
    `A publicação da @${username} já passou de ${fmtInt(views)} visualizações — ${fmtMultiple(multiple)} o normal da conta, ` +
    "entre os 10% melhores da fila. Vale colocar esse vídeo nas outras contas.";
  if (isLoop) body += " O próprio Loop já vai levar esse vídeo às outras contas; o botão antecipa.";
  return body;
}

export function hotFallbackText(username: string, views: number, multiple: number | null): string {
  const multPart = multiple != null ? ` (${fmtMultiple(multiple)} o normal da conta)` : "";
  return `O melhor post das últimas 48h é da @${username}: ${fmtInt(views)} visualizações${multPart}.`;
}

export const HOT_EMPTY_TEXT = "Ainda não há post das últimas 48h com leitura de 4h.";

/** "+380 views desde a leitura das 14h". */
export function risingText(gain: number, previousReadAt: number): string {
  return `+${fmtInt(gain)} views desde a leitura das ${brtHour(previousReadAt)}h`;
}

// ---------------------------------------------------------------------------
// Fila ideal (item 5)
// ---------------------------------------------------------------------------

export const IDEAL_TITLE = "A sua fila ideal, montada com o que já funciona";

export interface IdealTextParts {
  n: number;
  m: number;
  postsPerCycle: number;
  intervalMinutes: number;
  postsPerDay: number;
  expectedPerPost: number | null;
  currentTypicalPerPost: number | null;
  currentObservedMedian: number | null;
  videosFactor: number | null;
  accountsFactor: number | null;
  startAt: string;
  startHour: number | null;
  /** Média dos scores das horas da fase escolhida (só com startHour). */
  phaseScore: number | null;
  /** Há melhor horário na fila (senão o horário não fez diferença). */
  hasBestHour: boolean;
}

export function idealText(p: IdealTextParts): string {
  if (p.n === 0 || p.m === 0) return "Ainda não há vídeos e contas suficientes para montar a fila.";

  const videosPart = p.n === 1 ? "o seu melhor vídeo" : `os seus ${fmtInt(p.n)} melhores vídeos`;
  const accountsPart = p.m === 1 ? "a sua melhor conta" : `as suas ${fmtInt(p.m)} melhores contas`;
  const cyclePart = `${plural(p.postsPerCycle, "publicação", "publicações")} por ciclo, uma a cada ${fmtInterval(p.intervalMinutes)} por conta`;

  let forecast = "";
  if (p.expectedPerPost != null) {
    forecast = ` — previsão de ${fmtInt(p.expectedPerPost)} views por publicação`;
    if (p.currentTypicalPerPost != null) {
      forecast += `, contra ${fmtInt(p.currentTypicalPerPost)} da fila de hoje`;
      if (p.currentObservedMedian != null) forecast += ` (mediana real ${fmtInt(p.currentObservedMedian)})`;
    }
  }
  const sentences = [`Cruzei ${videosPart} com ${accountsPart}: ${cyclePart}${forecast}.`];

  if (p.videosFactor != null && p.accountsFactor != null) {
    sentences.push(`O ganho vem ${fmtMultiple(p.videosFactor)} dos vídeos e ${fmtMultiple(p.accountsFactor)} das contas.`);
  }
  sentences.push(startSentence(p));
  sentences.push("Nenhuma conta repete o mesmo vídeo no ciclo.");
  return sentences.join(" ");
}

function startSentence(p: IdealTextParts): string {
  if (p.startHour != null) {
    const lift = p.phaseScore != null ? `, onde os horários da fila rendem em média ${fmtMultiple(p.phaseScore)} o normal` : "";
    return `Começa às ${p.startHour}h${lift}.`;
  }
  const clock = fmtClock(p.startAt);
  if (!p.hasBestHour) return `Começa às ${clock} — o horário não fez diferença nesta fila.`;
  return `Começa às ${clock} — com ${fmtInt(p.postsPerDay)} posts por dia em cada conta, a fila passa por todos os horários.`;
}

export function shortQueueWarning(n: number, cycleMinutes: number): string {
  return `Fila curta: com ${plural(n, "vídeo", "vídeos")}, cada conta repete o ciclo a cada ${fmtInterval(cycleMinutes)}.`;
}

export function repostWarning(factor: number, alreadyPostedPairs: number, postsPerCycle: number): string {
  const less = Math.round((1 - factor) * 100);
  return `${fmtInt(alreadyPostedPairs)} das ${fmtInt(postsPerCycle)} publicações do ciclo são repost, e repost tem rendido ${less}% menos.`;
}

export function weakAccountsWarning(count: number): string {
  return count === 1
    ? "1 conta abaixo da régua entrou na fila."
    : `${fmtInt(count)} contas abaixo da régua entraram na fila.`;
}
