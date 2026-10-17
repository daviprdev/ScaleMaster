/**
 * cron-auth.ts — autenticação FAIL-CLOSED das rotas de cron.
 *
 * O padrão anterior, repetido em 13 rotas, era fail-OPEN:
 *
 *   if (!cronSecret) { console.warn(...) }          // ← sem env var, segue em frente
 *   else if (auth !== `Bearer ${cronSecret}`) 401
 *
 * Se `CRON_SECRET` sumisse do ambiente (rename, deploy novo, env não
 * propagada), toda a malha de crons ficava aberta na internet — qualquer um
 * podia disparar publicação, sync e processamento de vídeo.
 *
 * Aqui a regra é sempre a mesma:
 *   env ausente/vazia  → 503, sem executar trabalho nenhum
 *   header ausente     → 401
 *   header incorreto   → 401
 *   header correto     → segue
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/** Comparação em tempo constante — evita distinguir segredos por timing. */
export function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Valida o header `Authorization: Bearer <CRON_SECRET>`.
 * Retorna `{ ok: false, response }` — quem chama devolve a resposta e para.
 */
export function requireCronAuth(req: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || cronSecret.trim() === "") {
    console.error("[cron-auth] CRON_SECRET ausente/vazio — rota bloqueada (fail-closed).");
    return {
      ok: false,
      response: NextResponse.json(
        { error: "CRON_SECRET não configurado no servidor." },
        { status: 503 }
      ),
    };
  }

  const header = req.headers.get("authorization");
  if (!header || !secureEquals(header, `Bearer ${cronSecret}`)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

/**
 * Variante booleana, para rotas que aceitam CRON_SECRET **ou** outra forma de
 * autenticação (ex.: `force-run`, que também aceita sessão de admin).
 * Nunca devolve true quando a env var está ausente.
 */
export function hasValidCronSecret(candidate: string | null | undefined, isBearer = true): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim() === "") return false;
  if (!candidate) return false;
  return secureEquals(candidate, isBearer ? `Bearer ${cronSecret}` : cronSecret);
}
