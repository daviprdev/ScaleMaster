/**
 * Formatação do Raio-X da fila. Hora e dia sempre em BRT com offset fixo de −3h
 * (mesma regra de lib/brt-time.ts — o Brasil não tem horário de verão).
 */

// Caminho relativo (não "@/"): o vitest do projeto não resolve o alias e este arquivo tem teste.
import { MATURE_HOURS } from "../../../lib/queue-insights/constants";

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

const compactFmt = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const oneDecimalFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 12.345 → "12,3 mil". */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return compactFmt.format(n);
}

/** 12345 → "12.345" (vai no `title` dos números compactos). */
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return intFmt.format(Math.round(n));
}

/** 2.34 → "2,3×" — uma casa sempre, igual aos textos de lib/queue-insights/texts.ts. */
export function fmtMultiple(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return "—";
  return `${oneDecimalFmt.format(x)}×`;
}

function brtParts(iso: string) {
  const d = new Date(new Date(iso).getTime() - BRT_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    day: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    wd: d.getUTCDay(),
    key: d.toISOString().slice(0, 10),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "14:05" se for hoje (BRT), senão "18/10 14:05". */
export function fmtReadAt(iso: string, now = new Date()): string {
  const p = brtParts(iso);
  const hhmm = `${pad(p.h)}:${pad(p.mi)}`;
  return p.key === brtParts(now.toISOString()).key ? hhmm : `${pad(p.day)}/${pad(p.mo + 1)} ${hhmm}`;
}

/** "há 3h", "há 1 dia", "há 5 dias". */
export function fmtAgo(iso: string, now = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "há poucos minutos";
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}

/** Igual a fmtAgo, mas com minuto na primeira hora: "há 3 min", "há 2h". */
export function fmtAgoMin(iso: string, now = new Date()): string {
  const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  return fmtAgo(iso, now);
}

/**
 * Quanto depois da publicação as views foram lidas: "2 min após publicar",
 * "1h30 após publicar", "3 dias após publicar". Leitura antes da publicação
 * (horário estimado do Loop, erro de ~3 min) conta como "logo após".
 */
export function fmtReadAfterPublish(publishedAt: string, readAt: string): string {
  const min = Math.round((new Date(readAt).getTime() - new Date(publishedAt).getTime()) / 60_000);
  if (!isFinite(min) || min < 1) return "logo após publicar";
  if (min < 24 * 60) return `${fmtMinutes(min)} após publicar`;
  const d = Math.floor(min / (24 * 60));
  return `${d} dia${d > 1 ? "s" : ""} após publicar`;
}

/** Leitura feita antes das 4h de publicado — o número ainda vai subir (mesma régua do post maduro). */
export function isInitialRead(publishedAt: string, readAt: string | null): boolean {
  if (!readAt) return false;
  return new Date(readAt).getTime() - new Date(publishedAt).getTime() < MATURE_HOURS * 3_600_000;
}

/** "2026-10-14" (já em BRT) → "terça, 14/10". */
export function fmtDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${pad(d)}/${pad(m)}`;
}

/** 90 → "1h30"; 45 → "45 min". */
export function fmtMinutes(min: number | null | undefined): string {
  if (min == null || !isFinite(min)) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h${pad(rest)}` : `${h}h`;
}

/** Faixa p10–p90 da hora BRT: "8h–22h". */
export function fmtHourRange(from: number | null, to: number | null): string {
  if (from == null || to == null) return "—";
  return from === to ? `${from}h` : `${from}h–${to}h`;
}

/** Plural simples: plural(3, "conta", "contas") → "3 contas". */
export function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}
