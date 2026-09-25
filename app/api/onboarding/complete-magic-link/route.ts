import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface CompleteMagicLinkBody {
  token: string;
  username: string;
  ig_user_id?: string;
  access_token?: string;
  display_name?: string;
  avatar_url?: string;
}

/**
 * POST /api/onboarding/complete-magic-link
 * Chamada pela página pública /add/[token] após o worker RPA navegar até ela.
 * Valida o token, cria/atualiza a conta em instagram_accounts, marca token como usado.
 * Não requer auth de sessão — o token é a prova de autorização.
 */
export async function POST(req: NextRequest) {
  let body: CompleteMagicLinkBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { token, username, ig_user_id, access_token, display_name, avatar_url } = body;

  if (!token || !username) {
    return NextResponse.json({ error: "token e username são obrigatórios" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // 1. Buscar e validar o token
  const { data: tokenRecord, error: tokenError } = await admin
    .from("onboarding_magic_tokens")
    .select("id, user_id, status, expires_at, account_id")
    .eq("token", token)
    .single();

  if (tokenError || !tokenRecord) {
    console.warn("[onboarding/complete-magic-link] Token não encontrado:", token);
    return NextResponse.json({ error: "Token inválido" }, { status: 404 });
  }

  if (tokenRecord.status === "used") {
    return NextResponse.json({ error: "Token já foi utilizado" }, { status: 409 });
  }

  if (tokenRecord.status === "expired") {
    return NextResponse.json({ error: "Token expirado" }, { status: 410 });
  }

  const expiresAt = new Date(tokenRecord.expires_at).getTime();
  if (expiresAt < Date.now()) {
    // Marca como expired no banco
    await admin
      .from("onboarding_magic_tokens")
      .update({ status: "expired" })
      .eq("id", tokenRecord.id);
    return NextResponse.json({ error: "Token expirado" }, { status: 410 });
  }

  const userId = tokenRecord.user_id;

  // 2. Upsert em instagram_accounts
  const now = new Date().toISOString();
  const accountPayload: Record<string, unknown> = {
    user_id: userId,
    username,
    display_name: display_name ?? null,
    avatar_url: avatar_url ?? null,
    access_token: access_token ?? null,
    ig_business_account_id: ig_user_id ?? null,
    connected_at: now,
    health_status: "online",
    is_active: false, // conta nova nasce inativa — usuário ativa manualmente
  };

  let accountId: string | null = tokenRecord.account_id ?? null;

  // Tenta upsert por (user_id, username) — fallback se não existir unique constraint
  const { data: existingAccount } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("username", username)
    .maybeSingle();

  if (existingAccount) {
    const { error: updateError } = await admin
      .from("instagram_accounts")
      .update(accountPayload)
      .eq("id", existingAccount.id);
    if (updateError) {
      console.error("[onboarding/complete-magic-link] update error:", updateError.message);
      return NextResponse.json({ error: "Erro ao atualizar conta" }, { status: 500 });
    }
    accountId = existingAccount.id;
  } else {
    const { data: inserted, error: insertError } = await admin
      .from("instagram_accounts")
      .insert(accountPayload)
      .select("id")
      .single();
    if (insertError || !inserted) {
      console.error("[onboarding/complete-magic-link] insert error:", insertError?.message);
      return NextResponse.json({ error: "Erro ao criar conta" }, { status: 500 });
    }
    accountId = inserted.id;
  }

  // 3. Marcar token como usado
  const { error: tokenUpdateError } = await admin
    .from("onboarding_magic_tokens")
    .update({
      status: "used",
      used_at: now,
      account_id: accountId,
    })
    .eq("id", tokenRecord.id);

  if (tokenUpdateError) {
    console.error("[onboarding/complete-magic-link] token update error:", tokenUpdateError.message);
    // Não falha o fluxo — a conta já foi criada
  }

  console.log(`[onboarding/complete-magic-link] ✅ @${username} vinculada ao user ${userId} (account ${accountId})`);

  return NextResponse.json({
    success: true,
    account_id: accountId,
    username,
  });
}