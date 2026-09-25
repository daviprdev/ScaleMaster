import { NextResponse } from "next/server";
import { encrypt, decrypt } from "@/lib/encrypt";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const secret = process.env.ENCRYPTION_SECRET;
  const isSet = !!secret && secret.length > 0;
  const secretLength = secret?.length ?? 0;

  // Lista todas as env vars que podem ser a chave de criptografia (só nome + tamanho)
  const candidateVars: Record<string, number> = {};
  for (const key of Object.keys(process.env)) {
    if (/encrypt|cipher|secret|key/i.test(key) && !/supabase|instagram|meta|vapid|cron|worker_api|python_server|rapidapi/i.test(key)) {
      const v = process.env[key];
      candidateVars[key] = v ? v.length : 0;
    }
  }

  const derivedKeyHash = isSet
    ? crypto.createHash("sha256").update(crypto.createHash("sha256").update(secret!).digest()).digest("hex").slice(0, 16)
    : null;

  let roundTrip: { ok: boolean; error?: string; sample?: string } = { ok: false };
  try {
    const plaintext = "diag-test-" + Date.now();
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    roundTrip = { ok: decrypted === plaintext, sample: ciphertext.slice(0, 60) + "..." };
  } catch (err) {
    roundTrip = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const secretPreview = isSet && secret!.length > 8 ? `${secret!.slice(0, 4)}...${secret!.slice(-4)}` : null;

  // TEMPORÁRIO: expõe a chave completa para sincronizar com o Worker RPA durante o debug.
  // REMOVER IMEDIATAMENTE APÓS SINCRONIZAÇÃO.
  const secretFull = isSet ? secret : null;

  return NextResponse.json({
    encryption_secret_set: isSet,
    encryption_secret_length: secretLength,
    encryption_secret_preview: secretPreview,
    encryption_secret_full: secretFull,
    derived_key_hash_prefix: derivedKeyHash,
    candidate_env_vars: candidateVars,
    round_trip: roundTrip,
    timestamp: new Date().toISOString(),
  });
}