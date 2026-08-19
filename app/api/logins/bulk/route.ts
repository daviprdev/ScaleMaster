import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encrypt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface BulkLoginRow {
  username: string;
  password_hash: string;
  two_factor_key?: string;
  recovery_email?: string;
}

const MAX_ROWS = 300;

// POST — importa várias credenciais de uma vez no Logins Vault (colar lista).
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null) as { rows?: BulkLoginRow[] } | null;
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows é obrigatório e não pode ser vazio" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Máximo de ${MAX_ROWS} linhas por importação` }, { status: 400 });
  }

  const results: Array<{ username: string; ok: boolean; reason?: string }> = [];
  const toInsert: Record<string, string | null>[] = [];

  for (const row of rows) {
    const username = row.username?.replace(/^@/, "").trim();
    const password = row.password_hash?.trim();
    if (!username || !password) {
      results.push({ username: row.username ?? "", ok: false, reason: "usuário/senha ausente" });
      continue;
    }
    try {
      toInsert.push({
        user_id: user.id,
        profile_name: username,
        username,
        password_hash: encrypt(password),
        recovery_email: row.recovery_email?.trim() || null,
        two_factor_key: row.two_factor_key?.trim() ? encrypt(row.two_factor_key.trim()) : null,
      });
      results.push({ username, ok: true });
    } catch (e) {
      results.push({ username, ok: false, reason: String(e) });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("account_logins").insert(toInsert);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const created = results.filter((r) => r.ok).length;
  const skipped = results.length - created;
  return NextResponse.json({ results, created, skipped });
}
