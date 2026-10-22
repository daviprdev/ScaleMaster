/**
 * Raio-X da fila — constantes das regras (v2, docs/fila-ideal.md).
 */

/** Post contado: views lidas e publicado há 1h ou mais. */
export const COUNTED_MIN_AGE_HOURS = 1;
/** A fila é lida desde o começo dela, até 30 dias. */
export const SUMMARY_DAYS = 30;

/** "Um post seu está indo muito bem agora": candidatos das últimas 48h. */
export const HOT_WINDOW_HOURS = 48;
/** "Publicar nas outras contas": fica de fora a conta que publicou o vídeo nas últimas 24h. */
export const REPUBLISH_RECENT_HOURS = 24;

/** Vídeo elegível: posts contados em 3 contas ou mais. */
export const MIN_VIDEO_ACCOUNTS = 3;
/** Conta escolhida: 3+ posts contados. */
export const MIN_ACCOUNT_POSTS = 3;
/** Menos de 3 vídeos (ou contas) acima da média → os 3 melhores. */
export const MIN_CHOSEN = 3;
/** No máximo 10 vídeos na fila ideal. */
export const MAX_IDEAL_VIDEOS = 10;
/** Views esperadas pelos posts vídeo escolhido × conta escolhida só com 5+ deles. */
export const EXPECTED_MIN_POSTS = 5;
/** Melhor horário: hora com 5+ posts contados das contas escolhidas. */
export const BEST_HOUR_MIN_POSTS = 5;
/** Padrão do dia: dia BRT com 20+ posts contados. */
export const PATTERN_DAY_MIN_POSTS = 20;

/** Teto do ritmo da fila ideal. */
export const MAX_POSTS_PER_DAY = 48;
/** Intervalo usado quando o Modo Ciclo ainda não tem posts para medir. */
export const FALLBACK_INTERVAL_MINUTES = 60;
/** Com 12+ posts/dia (intervalo ≤ 2h) o início não espera o melhor horário. */
export const FAST_PACE_POSTS_PER_DAY = 12;
/** Início: pelo menos 10 min à frente; sem melhor horário, arredondado para cima em 5 min. */
export const START_DELAY_MINUTES = 10;
export const START_ROUND_MINUTES = 5;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const MINUTES_PER_DAY = 1440;
