import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";

export const runtime = "nodejs";

interface BulkProxyRow {
  username: string;
  proxy_url: string | null; // null = remove proxy
}

interface BulkProxyResult {
  username: string;
  status: "saved" | "removed" | "not_found" | "error";
  error?: string;
}

// POST /api/accounts/bulk-proxy
// Body: { rows: BulkProxyRow[] }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as { rows?: BulkProxyRow[] };
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "rows é obrigatório e não pode ser vazio." }, { status: 400 });
  }

  if (body.rows.length > 500) {
    return NextResponse.json({ error: "Máximo de 500 linhas por importação." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Busca todas as contas do usuário de uma vez
  const { data: accounts } = await admin
    .from("instagram_accounts")
    .select("id, username")
    .eq("user_id", user.id);

  const accountMap = new Map<string, string>(
    (accounts ?? []).map((a: { id: string; username: string }) => [a.username.toLowerCase(), a.id])
  );

  const results: BulkProxyResult[] = await Promise.all(
    body.rows.map(async (row): Promise<BulkProxyResult> => {
      const username = row.username.replace(/^@/, "").trim().toLowerCase();
      const accountId = accountMap.get(username);

      if (!accountId) {
        return { username: row.username, status: "not_found" };
      }

      let proxyValue: string | null = null;
      if (row.proxy_url && row.proxy_url.trim()) {
        try {
          proxyValue = encrypt(row.proxy_url.trim());
        } catch (e) {
          return { username: row.username, status: "error", error: String(e) };
        }
      }

      const { error } = await admin
        .from("instagram_accounts")
        .update({ proxy_url: proxyValue })
        .eq("id", accountId);

      if (error) {
        return { username: row.username, status: "error", error: error.message };
      }

      return { username: row.username, status: proxyValue ? "saved" : "removed" };
    })
  );

  // Consumo único do estoque: contas que tiveram proxy trocado/removido via CSV
  // têm a entrada do estoque atribuída a elas DELETADA — nunca redistribuída.
  const touchedIds = body.rows
    .map(r => accountMap.get(r.username.replace(/^@/, "").trim().toLowerCase()))
    .filter((id): id is string => !!id);
  if (touchedIds.length > 0) {
    const { error: poolErr } = await admin
      .from("proxy_pool")
      .delete()
      .in("assigned_account_id", touchedIds);
    if (poolErr) console.warn("[bulk-proxy] Falha ao consumir entradas do estoque:", poolErr.message);
  }

  const saved = results.filter(r => r.status === "saved").length;
  const removed = results.filter(r => r.status === "removed").length;
  const notFound = results.filter(r => r.status === "not_found").length;
  const errors = results.filter(r => r.status === "error").length;

  return NextResponse.json({ results, saved, removed, not_found: notFound, errors });
}
