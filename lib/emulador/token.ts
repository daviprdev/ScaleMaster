import { createHash, randomBytes } from "crypto";

/**
 * Código do agente: aparece uma vez na tela ao conectar um PC. O banco guarda
 * só o sha256 — quem lê a tabela não consegue se passar pelo agente.
 */
export function newAgentToken(): string {
  return `smag_${randomBytes(32).toString("base64url")}`;
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** `Authorization: Bearer smag_…` → token, ou null se o formato não bate. */
export function agentTokenFromRequest(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (smag_[A-Za-z0-9_-]{43})$/.exec(header);
  return match ? match[1] : null;
}
