import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encrypt";
import { parseProxyLine } from "@/lib/proxy-pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Contas LEITORAS — pool dedicado à raspagem, isolado das contas de postagem
// (instagram_accounts). Segredos (senha/2FA/proxy/sessão) NUNCA voltam ao
// browser: a listagem só expõe colunas não-sensíveis + flags has_proxy/has_totp.

// GET — lista as contas leitoras do usuário (RLS garante isolamento).
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ accounts: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const [accountsResult, jobsResult] = await Promise.all([
    supabase
      .from("reader_accounts")
      .select("id, username, ig_user_id, full_name, followers_count, media_count, status, last_error, last_login_at, last_scrape_at, created_at, proxy_url, totp_secret_enc")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("scrape_jobs")
      .select("reader_account_id, verify, status, error_message, retry_after")
      .eq("user_id", user.id)
      .in("status", ["queued", "processing"]),
  ]);

  if (accountsResult.error) {
    return NextResponse.json({ error: accountsResult.error.message }, { status: 500 });
  }

  // Job de verificação ativo por conta — inclui o erro da última tentativa
  // para a UI não ficar "conectando…" sem explicar o backoff.
  const verifyJobs = new Map<string, { error_message: string | null; retry_after: string | null; status: string }>();
  for (const j of jobsResult.data ?? []) {
    if (j.verify) verifyJobs.set(j.reader_account_id as string, j as { error_message: string | null; retry_after: string | null; status: string });
  }

  const accounts = (accountsResult.data ?? []).map((a) => {
    const { proxy_url, totp_secret_enc, ...safe } = a as Record<string, unknown>;
    return {
      ...safe,
      has_proxy: !!proxy_url,
      has_totp: !!totp_secret_enc,
      verifying: verifyJobs.has(a.id as string),
      verify_error: verifyJobs.get(a.id as string)?.error_message ?? null,
      verify_retry_at: verifyJobs.get(a.id as string)?.status === "queued"
        ? verifyJobs.get(a.id as string)?.retry_after ?? null
        : null,
    };
  });

  return NextResponse.json({ accounts });
}

// POST — cadastra uma nova conta leitora.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: { username?: string; password?: string; totp_secret?: string; proxy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const username = body.username?.trim().replace(/^@/, "");
  const password = body.password?.trim();
  if (!username || !password) {
    return NextResponse.json({ error: "username e senha são obrigatórios." }, { status: 400 });
  }

  // Proxy dedicado é opcional no cadastro, mas o cron não raspa sem ele.
  // Normaliza os formatos comuns de venda para http://user:pass@host:port.
  let proxyEnc: string | null = null;
  const proxyRaw = body.proxy?.trim();
  if (proxyRaw) {
    const parsed = parseProxyLine(proxyRaw);
    if (!parsed) {
      return NextResponse.json(
        { error: "Proxy em formato inválido. Use user:pass@host:porta, host:porta:user:pass ou uma URL http://…" },
        { status: 400 }
      );
    }
    proxyEnc = encrypt(parsed);
  }

  const totp = body.totp_secret?.trim();

  const { data, error } = await supabase
    .from("reader_accounts")
    .insert({
      user_id: user.id,
      username,
      password_enc: encrypt(password),
      totp_secret_enc: totp ? encrypt(totp.replace(/\s+/g, "")) : null,
      proxy_url: proxyEnc,
    })
    .select("id, username, status, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { account: { ...data, has_proxy: !!proxyEnc, has_totp: !!totp, verifying: false, verify_error: null, verify_retry_at: null } },
    { status: 201 }
  );
}

// PATCH — atualiza credenciais/proxy de uma conta leitora (só os campos enviados).
export async function PATCH(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: { id?: string; password?: string; totp_secret?: string; proxy?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const updates: Record<string, string | null> = {};
  if (body.password !== undefined && body.password.trim()) {
    updates.password_enc = encrypt(body.password.trim());
  }
  if (body.totp_secret !== undefined) {
    const t = body.totp_secret?.trim();
    updates.totp_secret_enc = t ? encrypt(t.replace(/\s+/g, "")) : null;
  }
  if (body.proxy !== undefined) {
    if (body.proxy === null || body.proxy.trim() === "") {
      updates.proxy_url = null;
    } else {
      const parsed = parseProxyLine(body.proxy.trim());
      if (!parsed) {
        return NextResponse.json({ error: "Proxy em formato inválido." }, { status: 400 });
      }
      updates.proxy_url = encrypt(parsed);
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar." }, { status: 400 });
  }

  // Reset de sessão quando a senha muda — a sessão salva pode não valer mais.
  if (updates.password_enc) updates.session_settings = null;

  const { error } = await supabase
    .from("reader_accounts")
    .update(updates)
    .eq("id", body.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE — remove uma conta leitora (scrape_jobs em cascata via FK).
export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const { error } = await supabase
    .from("reader_accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
