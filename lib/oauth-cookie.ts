/**
 * lib/oauth-cookie.ts — assinatura do cookie de identidade do OAuth do
 * Instagram via link mágico (/add/oauth/[token] → /api/instagram/callback).
 *
 * O callback do link mágico não tem sessão: a quem vincular a conta vinha do
 * cookie `ig_oauth_magic_user_id` em texto puro. Quem setasse esse cookie com o
 * UUID de outro usuário (e um state qualquer) vinculava a PRÓPRIA conta do
 * Instagram ao painel da vítima. Agora o valor é `userId.HMAC(userId|state|appId)`
 * — sem a chave do servidor não dá para forjar nem trocar o app.
 */

import crypto from "crypto";

function macKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET env var not set");
  // Chave derivada: não reaproveita a mesma chave do AES de lib/encrypt.ts.
  return crypto.createHash("sha256").update(`ig-oauth-magic-cookie:${secret}`).digest();
}

function mac(userId: string, state: string, appId: string): string {
  return crypto.createHmac("sha256", macKey()).update(`${userId}|${state}|${appId}`).digest("base64url");
}

export function signMagicUserCookie(userId: string, state: string, appId: string): string {
  return `${userId}.${mac(userId, state, appId)}`;
}

/** userId se a assinatura confere com este state/app; null se forjado/antigo. */
export function verifyMagicUserCookie(value: string, state: string, appId: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(userId, state, appId));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return userId;
}
