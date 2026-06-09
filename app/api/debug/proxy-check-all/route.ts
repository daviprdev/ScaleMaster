import { NextResponse } from "next/server";
import { fetch as undiciFetch } from "undici";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getProxyForAccount, getProxyLabel } from "@/lib/proxy";
import crypto from "crypto";

export const runtime = "nodejs";

// GET /api/debug/proxy-check-all
// Retorna o IP real de cada conta do usuário logado, passando pelo proxy configurado.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: accounts } = await (admin as any)
    .from("instagram_accounts")
    .select("id, username, proxy_url")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("health_status", "online")
    .order("username");

  if (!accounts?.length) {
    return NextResponse.json({ results: [] });
  }

  const results = await Promise.all(
    accounts.map(async (account: { id: string; username: string; proxy_url: string | null }) => {
      const proxy = getProxyForAccount(account.id, account.proxy_url ?? null);
      const sessionId = crypto.createHash("sha256").update(account.id).digest("hex").slice(0, 8);
      const source = account.proxy_url ? "dedicado" : process.env.PROXY_URL_TEMPLATE ? "template" : "nenhum";

      let ip: string | null = null;
      let err: string | null = null;
      try {
        const res = await undiciFetch("https://api.ipify.org?format=json", {
          ...(proxy ? { dispatcher: proxy } : {}),
          signal: AbortSignal.timeout(12_000),
        } as any);
        const data = await res.json() as { ip?: string };
        ip = data.ip ?? null;
      } catch (e) {
        err = e instanceof Error ? e.message.slice(0, 80) : "erro";
      }

      return {
        id: account.id,
        username: account.username,
        session_id: sessionId,
        source,
        proxy_label: proxy ? (getProxyLabel(proxy) ?? null) : null,
        ip,
        error: err,
      };
    })
  );

  return NextResponse.json({ results });
}
