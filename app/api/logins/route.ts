import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt, decryptMaybe } from "@/lib/encrypt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — list all logins for the authenticated user (RLS ensures isolation)
// Enriches each login with `is_connected: boolean` by cross-referencing
// instagram_accounts (same user_id + username, active token, not expired).
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ logins: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const [loginsResult, accountsResult, jobsResult] = await Promise.all([
    supabase
      .from("account_logins")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("instagram_accounts")
      .select("id, username, meta_access_token, token_expires_at, is_active, health_status, connection_method, access_token")
      .eq("user_id", user.id),
    supabase
      .from("login_jobs")
      .select("account_id, status")
      .eq("user_id", user.id)
      .in("status", ["queued", "processing"]),
  ]);

  if (loginsResult.error) return NextResponse.json({ error: loginsResult.error.message }, { status: 500 });

  const now = Date.now();
  const connectingAccountIds = new Set((jobsResult.data ?? []).map((j) => j.account_id as string));

  // Maps username → "connected" | "error" | "connecting" for accounts that
  // exist in instagram_accounts (OAuth ou instagrapi — connection_method distingue).
  const accountMap = new Map<string, "connected" | "error" | "connecting">();
  for (const a of (accountsResult.data ?? [])) {
    const key = (a.username as string).toLowerCase();
    const healthOk = !a.health_status || a.health_status === "online";

    if (a.connection_method === "instagrapi") {
      if (a.access_token && healthOk) {
        accountMap.set(key, "connected");
      } else if (!healthOk) {
        accountMap.set(key, "error");
      } else if (connectingAccountIds.has(a.id as string)) {
        accountMap.set(key, "connecting");
      } else {
        accountMap.set(key, "error");
      }
      continue;
    }

    const tokenOk =
      !!a.meta_access_token &&
      (a.token_expires_at == null || new Date(a.token_expires_at).getTime() > now);
    const ok = a.is_active && tokenOk && healthOk;
    accountMap.set(key, ok ? "connected" : "error");
  }

  const logins = (loginsResult.data ?? []).map((l) => {
    const key = (l.username as string).toLowerCase();
    const meta_status: "connected" | "error" | "connecting" | "not_connected" = accountMap.has(key)
      ? accountMap.get(key)!
      : "not_connected";
    return {
      ...l,
      password_hash: decryptMaybe(l.password_hash as string | null),
      two_factor_key: decryptMaybe(l.two_factor_key as string | null),
      meta_status,
    };
  });

  return NextResponse.json({ logins });
}

// POST — create a new login entry
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json() as {
    profile_name?: string;
    username?: string;
    password_hash?: string;
    recovery_email?: string;
    two_factor_key?: string;
  };

  const { profile_name, username, password_hash, recovery_email, two_factor_key } = body;

  if (!username?.trim() || !password_hash?.trim()) {
    return NextResponse.json(
      { error: "username e password_hash são obrigatórios" },
      { status: 400 },
    );
  }

  // profile_name falls back to username if not provided (simplified form)
  const resolvedProfileName = profile_name?.trim() || username.trim();

  const { data, error } = await supabase
    .from("account_logins")
    .insert({
      user_id: user.id,
      profile_name: resolvedProfileName,
      username: username.trim(),
      password_hash: encrypt(password_hash),
      recovery_email: recovery_email?.trim() || null,
      two_factor_key: two_factor_key?.trim() ? encrypt(two_factor_key.trim()) : null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    login: { ...data, password_hash, two_factor_key: two_factor_key?.trim() || null },
  }, { status: 201 });
}

// PATCH — update an existing login (user_id protected by RLS)
export async function PATCH(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json() as {
    id?: string;
    profile_name?: string;
    username?: string;
    password_hash?: string;
    recovery_email?: string;
    two_factor_key?: string;
  };

  const { id, ...raw } = body;
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  // Build update payload with only the fields explicitly provided.
  // This prevents accidentally nulling out recovery_email or other fields
  // that are no longer in the simplified form.
  type Payload = Record<string, string | null>;
  const updates: Payload = {};
  if (raw.profile_name !== undefined) updates.profile_name = raw.profile_name?.trim() || null;
  if (raw.username !== undefined) {
    updates.username = raw.username.trim();
    // Keep profile_name in sync with username if both are present
    if (updates.profile_name === undefined) {
      updates.profile_name = raw.username.trim();
    }
  }
  if (raw.password_hash !== undefined) updates.password_hash = encrypt(raw.password_hash);
  if (raw.recovery_email !== undefined) updates.recovery_email = raw.recovery_email?.trim() || null;
  if (raw.two_factor_key !== undefined) {
    updates.two_factor_key = raw.two_factor_key?.trim() ? encrypt(raw.two_factor_key.trim()) : null;
  }

  const { data, error } = await supabase
    .from("account_logins")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    login: {
      ...data,
      password_hash: raw.password_hash !== undefined ? raw.password_hash : decryptMaybe(data.password_hash),
      two_factor_key: raw.two_factor_key !== undefined ? (raw.two_factor_key?.trim() || null) : decryptMaybe(data.two_factor_key),
    },
  });
}

// DELETE — remove a login entry by id
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
    .from("account_logins")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
