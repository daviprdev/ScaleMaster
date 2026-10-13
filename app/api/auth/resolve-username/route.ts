import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Resolve username → email via service role (client SDK não acessa auth.users)
export async function POST(req: NextRequest) {
  const { username } = await req.json();

  if (!username || typeof username !== "string") {
    return NextResponse.json({ error: "Username obrigatório" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Configuração ausente" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Busca em user_metadata.username (salvo via updateUser no settings)
  const { data, error } = await admin.auth.admin.listUsers();

  if (error) {
    return NextResponse.json({ error: "Falha ao buscar usuário" }, { status: 500 });
  }

  const normalized = username.trim().toLowerCase();
  const match = data?.users?.find(
    (u) => u.user_metadata?.username?.toLowerCase() === normalized
  );

  if (!match) {
    return NextResponse.json({ found: false }, { status: 200 });
  }

  return NextResponse.json({ found: true, email: match.email }, { status: 200 });
}