import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { email, password, full_name } = await req.json() as {
    email?: string;
    password?: string;
    full_name?: string;
  };

  if (!email?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "E-mail e senha são obrigatórios." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Cria o usuário com e-mail já confirmado — bypassa o link de verificação
  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name?.trim() ?? "" },
  });

  if (error) {
    const status = error.message.toLowerCase().includes("already") ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ user_id: data.user.id });
}
