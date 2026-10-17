import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { secureEquals } from "@/lib/cron-auth";

export const runtime = "nodejs";

const REGISTER_SECRET = process.env.REGISTER_API_SECRET ?? "";

export async function POST(req: NextRequest) {
  // Fail-closed: se REGISTER_API_SECRET não estiver definido, rejeita todas as
  // requisições. Este endpoint cria usuários confirmados sem verificação de
  // e-mail e NÃO deve estar exposto publicamente.
  if (!REGISTER_SECRET) {
    return NextResponse.json(
      { error: "Endpoint desabilitado — REGISTER_API_SECRET não configurado." },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!secureEquals(authHeader ?? "", `Bearer ${REGISTER_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
