import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseJobSteps } from "@/lib/emulador/jobs";
import { parseEstrutura, parsePlano } from "@/lib/vps/estruturacao";
import { CONTA_COLUNAS, criarEstruturacao, type ContaRow } from "@/lib/vps/estruturar-conta";
import { listarMidias, pastaMidias } from "@/lib/vps/midias";
import { FALTA_SQL_PASTAS, SEM_PASTA, elegiveisDaPasta, normalizarPasta, type EstruturaDaConta } from "@/lib/vps/pastas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — "Estruturar pasta": os mesmos campos do Estruturar da conta + agentId e
// pasta (nome, ou "__sem_pasta__"). Cria uma estruturação para cada conta criada
// da pasta nesta VPS que não tem estruturação na fila e ainda não está pronta;
// o agente roda até maxCadastro ao mesmo tempo (capacidade do host). Devolve criadas e puladas.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const agentId = String(body.agentId ?? "");
  if (!agentId) return NextResponse.json({ error: "VPS não informada." }, { status: 400 });
  if (typeof body.pasta !== "string" || !body.pasta.trim()) return NextResponse.json({ error: "Escolha a pasta." }, { status: 400 });
  const pasta = body.pasta === SEM_PASTA ? null : normalizarPasta(body.pasta);

  const parsed = parseEstrutura(body, listarMidias(pastaMidias()).map((m) => m.path));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = getSupabaseAdmin();
  let consulta = admin.from("emulator_jobs").select(`${CONTA_COLUNAS}, pasta`).eq("user_id", user.id).eq("agent_id", agentId).eq("kind", "nova-conta");
  consulta = pasta === null ? consulta.is("pasta", null) : consulta.eq("pasta", pasta);
  const { data: contas, error: contasErr } = await consulta.order("created_at", { ascending: true }).limit(200);
  if (isMissingSchemaError(contasErr)) return NextResponse.json({ error: FALTA_SQL_PASTAS }, { status: 503 });
  if (contasErr) return NextResponse.json({ error: contasErr.message }, { status: 500 });
  const lista = (contas ?? []) as unknown as Array<ContaRow & { pasta: string | null }>;
  if (lista.length === 0) return NextResponse.json({ error: "Essa pasta não tem contas nesta VPS." }, { status: 404 });

  // Estruturação mais nova de cada conta da pasta (fila, rodando, pronta ou parada).
  const { data: estruturas, error: estErr } = await admin
    .from("emulator_jobs")
    .select("conta_id, status, acoes, steps, created_at")
    .eq("user_id", user.id)
    .eq("kind", "estruturacao")
    .in(
      "conta_id",
      lista.map((c) => c.id)
    )
    .order("created_at", { ascending: false });
  if (estErr && !isMissingSchemaError(estErr)) return NextResponse.json({ error: estErr.message }, { status: 500 });
  const maisNova = new Map<string, EstruturaDaConta>();
  for (const e of (estruturas ?? []) as Array<{ conta_id: string; status: string; acoes: unknown; steps: unknown }>) {
    if (!maisNova.has(e.conta_id)) maisNova.set(e.conta_id, { status: e.status, plano: parsePlano(e.acoes), steps: parseJobSteps(e.steps) });
  }

  const { elegiveis, puladas } = elegiveisDaPasta(lista, pasta, (id) => maisNova.get(id));
  const criadas: Array<{ id: string; label: string | null }> = [];
  for (const conta of elegiveis) {
    const r = await criarEstruturacao(admin, user.id, conta, parsed.value);
    if ("error" in r) {
      if (r.status === 503) return NextResponse.json({ error: r.error, criadas, puladas }, { status: 503 });
      puladas.push({ label: conta.label ? `@${conta.label}` : "conta", motivo: r.error });
      continue;
    }
    criadas.push({ id: r.id, label: conta.label });
  }
  return NextResponse.json({ criadas, puladas });
}
