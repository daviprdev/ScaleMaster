import { NextRequest, NextResponse } from "next/server";
import { fetch as undiciFetch } from "undici";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getProxyForAccount, getProxyLabel } from "@/lib/proxy";
import crypto from "crypto";
import { secureEquals } from "@/lib/cron-auth";

export const runtime = "nodejs";

// GET /api/debug/proxy-check?accountId=xxx
// Protegido por CRON_SECRET — não expõe credenciais publicamente.
// Retorna o IP real que a Meta API enxerga para a conta especificada.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // Fail-closed: se CRON_SECRET não estiver definida, rejeita a requisição
  // em vez de expor detalhes de proxy/IP publicamente.
  if (!secret) {
    console.error("[debug/proxy-check] CRON_SECRET não definida — rota bloqueada.");
    return NextResponse.json(
      { error: "Endpoint desabilitado — CRON_SECRET não configurado." },
      { status: 503 },
    );
  }
  if (!secureEquals(auth ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId é obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: account, error } = await (admin as any)
    .from("instagram_accounts")
    .select("id, username, proxy_url")
    .eq("id", accountId)
    .single();

  if (error || !account) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const proxy = getProxyForAccount(account.id, account.proxy_url ?? null);
  const sessionId = crypto.createHash("sha256").update(account.id).digest("hex").slice(0, 8);

  let ip: string | null = null;
  let fetchError: string | null = null;

  try {
    const res = await undiciFetch(
      "https://api.ipify.org?format=json",
      {
        ...(proxy ? { dispatcher: proxy } : {}),
        signal: AbortSignal.timeout(15_000),
      } as any
    );
    const data = await res.json() as { ip?: string };
    ip = data.ip ?? null;
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    account: {
      id: account.id,
      username: account.username,
    },
    proxy: {
      active: !!proxy,
      session_id: sessionId,
      label: proxy ? (getProxyLabel(proxy) ?? "proxy configurado") : null,
      source: account.proxy_url ? "dedicado (banco)" : "nenhum",
    },
    result: {
      ip,
      error: fetchError,
    },
  });
}
