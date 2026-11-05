/**
 * lib/oauth-cookie.ts — assinaturas do OAuth do Instagram
 * (/api/instagram/auth e /add/oauth/[token] → /api/instagram/callback).
 *
 * State: `nonce.timestamp.HMAC(nonce.timestamp)`, válido por 1h (o prazo dos
 * cookies). O callback exige que ele bata com o cookie `ig_oauth_state` E que
 * a assinatura e o prazo confiram — state forjado ou velho não passa.
 *
 * Cookie do link mágico: o callback do link mágico não tem sessão: a quem
 * vincular a conta vinha do cookie `ig_oauth_magic_user_id` em texto puro. Quem
 * setasse esse cookie com o UUID de outro usuário (e um state qualquer) vinculava
 * a PRÓPRIA conta do Instagram ao painel da vítima. Agora o valor é
 * `userId.HMAC(userId|state|appId)` — sem a chave do servidor não dá para forjar
 * nem trocar o app.
 */

import crypto from "crypto";

const STATE_TTL_MS = 60 * 60 * 1000;
// Folga para relógio adiantado entre réplicas/containers.
const STATE_CLOCK_SKEW_MS = 60 * 1000;

function macKey(label: string): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET env var not set");
  // Chave derivada: não reaproveita a mesma chave do AES de lib/encrypt.ts.
  return crypto.createHash("sha256").update(`${label}:${secret}`).digest();
}

function mac(userId: string, state: string, appId: string): string {
  return crypto
    .createHmac("sha256", macKey("ig-oauth-magic-cookie"))
    .update(`${userId}|${state}|${appId}`)
    .digest("base64url");
}

function stateMac(payload: string): string {
  return crypto.createHmac("sha256", macKey("ig-oauth-state")).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const given = Buffer.from(a);
  const expected = Buffer.from(b);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function signOAuthState(now = Date.now()): string {
  const payload = `${crypto.randomUUID()}.${now.toString(36)}`;
  return `${payload}.${stateMac(payload)}`;
}

/** true se o state foi assinado por este servidor e ainda está no prazo. */
export function verifyOAuthState(state: string, now = Date.now()): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;
  if (!safeEqual(sig, stateMac(`${nonce}.${ts}`))) return false;
  const issuedAt = parseInt(ts, 36);
  if (!Number.isFinite(issuedAt)) return false;
  return issuedAt <= now + STATE_CLOCK_SKEW_MS && now - issuedAt <= STATE_TTL_MS;
}

export function signMagicUserCookie(userId: string, state: string, appId: string): string {
  return `${userId}.${mac(userId, state, appId)}`;
}

/** userId se a assinatura confere com este state/app; null se forjado/antigo. */
export function verifyMagicUserCookie(value: string, state: string, appId: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  if (!safeEqual(value.slice(dot + 1), mac(userId, state, appId))) return null;
  return userId;
}
