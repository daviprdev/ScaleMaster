import crypto from "crypto";

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET env var not set");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivB64, tagB64, encB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  // GCM com IV de 12 bytes e tag de 16: sem fixar o tamanho, o Node aceita
  // tag truncada (mais fácil de forjar).
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid ciphertext format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

// Linhas legadas gravadas antes da criptografia ser aplicada não batem o
// formato iv:tag:enc — nesse caso devolve o valor como está em vez de quebrar.
export function decryptMaybe(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}
