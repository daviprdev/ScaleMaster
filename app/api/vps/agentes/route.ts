import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { hashAgentToken, newAgentToken } from "@/lib/emulador/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AGENTS = 10;

// POST — conecta uma VPS: cria o agente com kind='vps' e devolve o código
// smag_ UMA vez (o banco guarda só o sha256). O agente da VPS usa o mesmo
// sync do MuMu; o kind é o que separa as abas.
export async function POST() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { count, error: countErr } = await admin
    .from("emulator_agents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("kind", "vps");

  if (isMissingSchemaError(countErr)) {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/vps_contas.sql no Supabase." }, { status: 503 });
  }
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((count ?? 0) >= MAX_AGENTS) {
    return NextResponse.json({ error: `Limite de ${MAX_AGENTS} VPSs. Desconecte uma antes.` }, { status: 409 });
  }

  const token = newAgentToken();
  const { data, error } = await admin
    .from("emulator_agents")
    .insert({ user_id: user.id, token_hash: hashAgentToken(token), kind: "vps" })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, token });
}
