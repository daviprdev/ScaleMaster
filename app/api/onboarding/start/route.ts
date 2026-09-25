import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const WORKER_RPA_URL = process.env.WORKER_RPA_URL ?? "";
const WORKER_API_SECRET = process.env.WORKER_API_SECRET ?? "";

interface StartOnboardingBody {
  username: string;
  password: string;           // plaintext — será cifrado antes de enviar ao worker
  two_factor_secret?: string; // plaintext TOTP secret — será cifrado
  proxy_url?: string;         // plaintext proxy URL — será cifrado
  photo_url?: string;         // URL pública da foto de perfil (Supabase Storage)
  story_media_url?: string;   // URL pública da mídia do story
  story_link_url?: string;    // URL do sticker de link no story
  story_link_text?: string;   // Texto personalizado do sticker de link (opcional)
  highlight_title?: string;   // título do destaque
}

/**
 * POST /api/onboarding/start
 * Inicia o onboarding automatizado via RPA worker.
 * 1. Valida sessão do usuário
 * 2. Cifra credenciais com AES-256-GCM
 * 3. Gera magic_link_token único
 * 4. Envia job para o worker RPA via POST {WORKER_RPA_URL}/jobs
 * 5. Retorna token + status do envio
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: StartOnboardingBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const {
    username,
    password,
    two_factor_secret,
    proxy_url,
    photo_url,
    story_media_url,
    story_link_url,
    story_link_text,
    highlight_title,
  } = body;

  if (!username || !password || !two_factor_secret) {
    return NextResponse.json(
      { error: "username, password e secret 2FA são obrigatórios" },
      { status: 400 }
    );
  }

  // Validar configuração do worker
  if (!WORKER_RPA_URL || !WORKER_API_SECRET) {
    console.error("[onboarding/start] WORKER_RPA_URL ou WORKER_API_SECRET não configurados");
    return NextResponse.json(
      { error: "Worker RPA não configurado no servidor" },
      { status: 503 }
    );
  }

  const admin = getSupabaseAdmin();

  // 1. Cifrar credenciais
  const password_enc = encrypt(password);
  const two_factor_enc = two_factor_secret ? encrypt(two_factor_secret) : null;
  const proxy_url_enc = proxy_url ? encrypt(proxy_url) : null;

  // 2. Gerar magic_link_token
  const magicToken = crypto.randomUUID();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autoscale-ia.vercel.app").replace(/\/$/, "");

  // Salvar token no banco
  const { error: tokenInsertError } = await admin
    .from("onboarding_magic_tokens")
    .insert({
      user_id: user.id,
      token: magicToken,
      status: "pending",
      proxy_url_enc,
    });

  if (tokenInsertError) {
    console.error("[onboarding/start] token insert error:", tokenInsertError.message);
    return NextResponse.json({ error: "Erro ao gerar token de onboarding" }, { status: 500 });
  }

  // 3. Montar payload do job para o worker
  const jobPayload = {
    username,
    password_enc,
    two_factor_enc,
    proxy_url_enc,
    photo_url: photo_url ?? null,
    story_media_url: story_media_url ?? null,
    story_link_url: story_link_url ?? null,
    story_link_text: story_link_text ?? null,
    highlight_title: highlight_title ?? null,
    magic_link_token: magicToken,
  };

  // 4. Enviar job para o worker RPA
  let workerResponse: Response;
  try {
    workerResponse = await fetch(`${WORKER_RPA_URL}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_API_SECRET}`,
      },
      body: JSON.stringify(jobPayload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error("[onboarding/start] Worker unreachable:", msg);
    return NextResponse.json(
      { error: `Worker RPA indisponível: ${msg}` },
      { status: 502 }
    );
  }

  if (!workerResponse.ok) {
    const errorText = await workerResponse.text().catch(() => "");
    console.error(`[onboarding/start] Worker returned ${workerResponse.status}:`, errorText.slice(0, 500));

    if (workerResponse.status === 401) {
      return NextResponse.json({ error: "Autenticação com worker falhou" }, { status: 502 });
    }
    if (workerResponse.status === 409) {
      return NextResponse.json(
        { error: `Já existe um onboarding em andamento para @${username}` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: `Worker retornou erro ${workerResponse.status}` },
      { status: 502 }
    );
  }

  const workerResult = await workerResponse.json().catch(() => ({})) as {
    status?: string;
    id?: string;
    username?: string;
  };

  console.log(`[onboarding/start] ✅ Job enviado para @${username} → worker job ${workerResult.id ?? "unknown"}`);

  return NextResponse.json({
    success: true,
    magic_token: magicToken,
    magic_url: `${appUrl}/add/${magicToken}`,
    worker_job_id: workerResult.id ?? null,
    worker_status: workerResult.status ?? "accepted",
    message: `Onboarding iniciado para @${username}. O worker está processando.`,
  });
}