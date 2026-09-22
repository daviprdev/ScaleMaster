/**
 * onboarding.ts - definicoes compartilhadas do onboarding automatizado
 * (Fase Onboarding 1/3). Usado pelo cron process-onboarding-jobs e pelas rotas
 * /api/onboarding/jobs.
 *
 * Ordem obrigatoria das etapas: o link magico e OAuth do Instagram Business
 * Login e so funciona em conta Business/Creator, entao a conversao para
 * profissional (e a confirmacao dela) vem ANTES do link.
 */

export const ONBOARDING_STAGES = [
  "invite",
  "photo",
  "professional",
  "verify_professional",
  "magic_link",
  "story",
  "highlight",
] as const;

export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export type StageState = "pending" | "ok" | "needs_manual" | "error";

export interface StageResult {
  state: StageState;
  reason?: string | null;
  at?: string;
  started_at?: string;
  account_type?: string | null;
  story_pk?: string | null;
  highlight_pk?: string | null;
}

export type StageStatusMap = Partial<Record<OnboardingStage, StageResult>>;

export function isOnboardingStage(value: unknown): value is OnboardingStage {
  return typeof value === "string" && (ONBOARDING_STAGES as readonly string[]).includes(value);
}

/** Proxima etapa, ou null se `stage` e a ultima. */
export function nextStage(stage: OnboardingStage): OnboardingStage | null {
  const idx = ONBOARDING_STAGES.indexOf(stage);
  return idx >= 0 && idx < ONBOARDING_STAGES.length - 1 ? ONBOARDING_STAGES[idx + 1] : null;
}

/** Copia do mapa com a etapa atualizada (nao muta o original). */
export function withStage(
  map: StageStatusMap | null | undefined,
  stage: OnboardingStage,
  patch: StageResult
): StageStatusMap {
  const current = map?.[stage] ?? {};
  return { ...(map ?? {}), [stage]: { ...current, ...patch, at: new Date().toISOString() } };
}

/** Percentual de progresso para a UI (etapas concluidas / total). */
export function onboardingProgress(stage: string, status: string): number {
  if (status === "done") return 100;
  const idx = ONBOARDING_STAGES.indexOf(stage as OnboardingStage);
  if (idx < 0) return 0;
  return Math.round((idx / ONBOARDING_STAGES.length) * 100);
}

/** Username do Instagram normalizado (minusculas, sem @). null se invalido. */
export function normalizeInstagramUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(value) ? value : null;
}
