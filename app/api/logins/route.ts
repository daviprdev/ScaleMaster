import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — list all logins for the authenticated user (RLS ensures isolation)
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ logins: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await supabase
    .from("account_logins")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logins: data ?? [] });
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

  if (!profile_name?.trim() || !username?.trim() || !password_hash?.trim()) {
    return NextResponse.json(
      { error: "profile_name, username e password_hash são obrigatórios" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("account_logins")
    .insert({
      user_id: user.id,
      profile_name: profile_name.trim(),
      username: username.trim(),
      password_hash,
      recovery_email: recovery_email?.trim() || null,
      two_factor_key: two_factor_key?.trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ login: data }, { status: 201 });
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

  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const { data, error } = await supabase
    .from("account_logins")
    .update({
      ...updates,
      recovery_email: updates.recovery_email?.trim() || null,
      two_factor_key: updates.two_factor_key?.trim() || null,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ login: data });
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
