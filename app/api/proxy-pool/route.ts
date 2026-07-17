import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt, decrypt } from "@/lib/encrypt";
import { normalizeProxyUrl, proxyHash } from "@/lib/proxy-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Host:porta para exibição — nunca retorna credenciais ao browser.
function censorForDisplay(plainUrl: string): string {
  try {
    const u = new URL(plainUrl);
    return `${u.hostname}:${u.port || "?"}`;
  } catch {
    return "proxy inválido";
  }
}

interface PoolRow {
  id: string;
  proxy_url: string;
  assigned_account_id: string | null;
  created_at: string;
}

// GET /api/proxy-pool — lista o estoque com status e conta atribuída.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const [{ data: rows }, { data: accounts }] = await Promise.all([
    admin
      .from("proxy_pool")
      .select("id, proxy_url, assigned_account_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    admin
      .from("instagram_accounts")
      .select("id, username")
      .eq("user_id", user.id),
  ]);

  const usernameById = new Map<string, string>(
    (accounts ?? []).map((a: { id: string; username: string }) => [a.id, a.username])
  );

  const items = ((rows ?? []) as PoolRow[]).map((r) => {
    let display = "?";
    try { display = censorForDisplay(decrypt(r.proxy_url)); } catch { /* mantém "?" */ }
    return {
      id: r.id,
      display,
      assigned_username: r.assigned_account_id
        ? usernameById.get(r.assigned_account_id) ?? null
        : null,
      created_at: r.created_at,
    };
  });

  const free = items.filter((i) => !i.assigned_username).length;
  const in_use = items.filter((i) => i.assigned_username).length;

  return NextResponse.json({ items, total: items.length, free, in_use });
}

// POST /api/proxy-pool — adiciona proxies em lote (um por linha).
// Body: { urls: string[] }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: { urls?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }
  const rawUrls = Array.isArray(body.urls) ? (body.urls as string[]) : [];
  if (rawUrls.length === 0) {
    return NextResponse.json({ error: "urls é obrigatório." }, { status: 400 });
  }
  if (rawUrls.length > 500) {
    return NextResponse.json({ error: "Máximo de 500 proxies por importação." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  let added = 0;
  let duplicates = 0;
  let invalid = 0;

  for (const raw of rawUrls) {
    const normalized = normalizeProxyUrl(raw);
    if (!normalized) continue;
    // Validação: precisa ser URL http(s) com host e porta.
    try {
      const u = new URL(normalized);
      if (!/^https?:$/.test(u.protocol) || !u.hostname) { invalid++; continue; }
    } catch { invalid++; continue; }

    const { error } = await admin.from("proxy_pool").insert({
      user_id: user.id,
      proxy_url: encrypt(normalized),
      proxy_hash: proxyHash(normalized),
    });
    if (error) {
      // 23505 = unique_violation (mesmo proxy já no estoque)
      if (error.code === "23505") duplicates++;
      else invalid++;
    } else {
      added++;
    }
  }

  return NextResponse.json({ added, duplicates, invalid });
}

// DELETE /api/proxy-pool?id=<uuid> — remove entrada LIVRE do estoque.
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id é obrigatório." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: deleted, error } = await admin
    .from("proxy_pool")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .is("assigned_account_id", null)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted || deleted.length === 0) {
    return NextResponse.json(
      { error: "Proxy não encontrado ou em uso por uma conta — remova o proxy da conta primeiro." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
