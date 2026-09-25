import { NextResponse } from "next/server";
import { encrypt, decrypt } from "@/lib/encrypt";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/onboarding/debug-crypto
 * Rota TEMPORÁRIA de diagnóstico — remove depois de confirmar que a chave bate.
 * Testa round-trip encrypt→decrypt no runtime do Vercel e reporta:
 * - se ENCRYPTION_SECRET está setada (sem expor o valor)
 * - hash SHA-256 da chave derivada (para comparar com o Worker)
 * - resultado de um round-trip de teste
 */
export async function GET() {
  const secret = process.env.ENCRYPTION_SECRET;
  const isSet = !!secret && secret.length > 0;
  const secretLength = secret?.length ?? 0;
  const derivedKeyHash = isSet
    ? crypto.createHash("sha256").update(crypto.createHash("sha256").update(secret!).digest()).digest("hex").slice(0, 16)
    : null;

  let roundTrip: { ok: boolean; error?: string; sample?: string } = { ok: false };
  try {
    const plaintext = "diag-test-" + Date.now();
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    roundTrip = {
      ok: decrypted === plaintext,
      sample: ciphertext.slice(0, 60) + "...",
    };
  } catch (err) {
    roundTrip = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Retorna prefixo/sufixo da secret para ajudar a identificar qual valor está configurado
  // (sem expor o valor completo por segurança)
  const secretPreview = isSet && secret!.length > 8
    ? `${secret!.slice(0, 4)}...${secret!.slice(-4)}`
    : null;

  return NextResponse.json({
    encryption_secret_set: isSet,
    encryption_secret_length: secretLength,
    encryption_secret_preview: secretPreview,
    derived_key_hash_prefix: derivedKeyHash,
    round_trip: roundTrip,
    timestamp: new Date().toISOString(),
  });
}