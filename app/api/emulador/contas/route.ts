import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseInstances } from "@/lib/emulador/payload";
import { parseNovaContaInput } from "@/lib/emulador/nova-conta-input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — Criar instância: põe na fila do agente do PC uma conta a criar numa
// cópia da instância padrão. Proxy e dados da conta vão criptografados; a
// tela só volta a ver o rótulo (o @ ou, sem ele, o Gmail).
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const { agentId, templateIndex } = body;
  if (typeof agentId !== "string" || !agentId) {
    return NextResponse.json({ error: "PC não informado." }, { status: 400 });
  }
  if (typeof templateIndex !== "number" || !Number.isInteger(templateIndex) || templateIndex < 0) {
    return NextResponse.json({ error: "Escolha a instância padrão." }, { status: 400 });
  }
  const parsed = parseNovaContaInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: agent, error: agentErr } = await admin
    .from("emulator_agents")
    .select("id, instances")
    .eq("id", agentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agent) return NextResponse.json({ error: "PC não encontrado." }, { status: 404 });
  if (!parseInstances(agent.instances).some((i) => i.index === templateIndex)) {
    return NextResponse.json({ error: "Essa instância padrão não existe mais no MuMu." }, { status: 404 });
  }

  const { data: job, error } = await admin
    .from("emulator_jobs")
    .insert({
      user_id: user.id,
      agent_id: agent.id,
      label: parsed.value.conta.usuario || parsed.value.conta.email,
      template_index: templateIndex,
      input_enc: encrypt(JSON.stringify(parsed.value)),
    })
    .select("id")
    .single();

  if (isMissingSchemaError(error)) {
    return NextResponse.json({ error: "Falta aplicar o SQL supabase/emulador_contas.sql no Supabase." }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: job.id });
}
