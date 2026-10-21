/**
 * Raio-X da fila — constantes das regras (docs/fila-ideal.md, tabela "Constantes").
 *
 * Tudo puro: este arquivo também roda no navegador (buildIdealQueue).
 */

/** Post maduro: leitura de views feita ≥ 4h depois da publicação. */
export const MATURE_HOURS = 4;
/** Nota dos vídeos, contas, horário e melhor dia. */
export const ANALYSIS_DAYS = 14;
/** Resumo do topo. */
export const SUMMARY_DAYS = 30;
/** Amostra mínima do normal (local e atual). */
export const NORMAL_MIN_POSTS = 20;
/** Conta só vota com normal local ≥ 30. */
export const NORMAL_MIN_VIEWS = 30;
/** Vídeo precisa de 3 contas votantes. */
export const MIN_VOTING_ACCOUNTS = 3;
/** A régua fecha com 3 vídeos cobertos (3+ contas) e a fila ideal precisa de 3 que passam. */
export const MIN_READY_VIDEOS = 3;
/** Vídeo precisa render 20% acima do normal. */
export const MIN_SCORE = 1.2;
/** Conta boa ≥ metade da conta típica. */
export const GOOD_ACCOUNT_REF_RATIO = 0.5;
/** Post fora da curva: ≥ 5× o normal local… */
export const HOT_MIN_MULTIPLE = 5;
/** …e entre os 10% com mais views da fila. */
export const HOT_PERCENTILE = 0.9;
/** Candidatos a "bombando agora". */
export const HOT_WINDOW_HOURS = 48;
/** Até 3 destaques, o 1º em evidência. */
export const HOT_MAX_HIGHLIGHTS = 3;
/** Pares (vídeo, conta) para medir o fator de repost. */
export const REPOST_MIN_PAIRS = 30;
/** Abaixo disso o repost vira aviso na fila ideal. */
export const REPOST_WARN_BELOW = 0.8;
/** Teto do ritmo da fila ideal. */
export const MAX_POSTS_PER_DAY = 48;
/** Aviso do freio de ~50 posts/24h (usado pelo painel). */
export const LOAD_WARN = 45;

/** Melhor horário: hora qualificada precisa de 10 posts e 3 contas… */
export const BEST_HOUR_MIN_POSTS = 10;
export const BEST_HOUR_MIN_ACCOUNTS = 3;
/** …e só existe melhor horário com 3+ horas qualificadas e a melhor ≥ 1,2× a mediana delas. */
export const BEST_HOUR_MIN_HOURS = 3;
export const BEST_HOUR_LIFT = 1.2;
/** typicalViews usa só as contas boas quando elas têm 5+ posts na hora. */
export const BEST_HOUR_GOOD_MIN_POSTS = 5;

/** Melhor dia: ≥ 90% dos posts maduros, ≥ max(20, 50% da mediana diária) posts, ≥ 3 contas. */
export const BEST_DAY_MATURE_SHARE = 0.9;
export const BEST_DAY_MIN_POSTS = 20;
export const BEST_DAY_MEDIAN_SHARE = 0.5;
export const BEST_DAY_MIN_ACCOUNTS = 3;

/** Selo "ainda subindo": compara com a leitura ≥ 3h anterior; ganho ≥ 20% e ≥ normal local. */
export const RISING_MIN_GAP_HOURS = 3;
export const RISING_MIN_GAIN = 0.2;

/** Fila curta vira aviso. */
export const SHORT_QUEUE_VIDEOS = 5;
/** Limite de video_ids aceito pelo /api/posts/distribute. */
export const MAX_IDEAL_VIDEOS = 50;
/** Com 12+ posts/dia (intervalo ≤ 2h) a fila passa por todos os horários: começa já. */
export const FAST_PACE_POSTS_PER_DAY = 12;
/** Início: agora + 10 min, arredondado para cima em múltiplos de 5 min. */
export const START_DELAY_MINUTES = 10;
export const START_ROUND_MINUTES = 5;
/** Stagger automático do distribute: proporcional ao intervalo, máx. 5 min. */
export const MAX_AUTO_STAGGER_SECONDS = 300;
/** Intervalo usado quando o Modo Ciclo ainda não tem posts para medir. */
export const FALLBACK_INTERVAL_MINUTES = 60;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const MINUTES_PER_DAY = 1440;
