import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseJobSteps } from "@/lib/emulador/jobs";
import { parsePlano, prontidaoDaConta } from "./estruturacao";

/**
 * "Ao concluir, mover para a pasta" do Estruturar (12/11): a estruturação
 * guarda a pasta de destino na coluna `pasta` da linha dela. Quando ela
 * termina com a conta conectada (selo verde: "pronta" ou "conectada"), a conta
 * vai para essa pasta e o destino é limpo (move uma vez só; mover de volta à
 * mão fica). Terminou sem conectar: o destino fica, e o Continuar que conectar move.
 * Roda no sync do agente (a cada ~3 s), só sobre linhas com destino.
 */
export async function moverEstruturadas(admin: SupabaseClient, agentId: string): Promise<number> {
  const { data, error } = await admin
    .from("emulator_jobs")
    .select("id, user_id, conta_id, status, acoes, steps, pasta")
    .eq("agent_id", agentId)
    .eq("kind", "estruturacao")
    .in("status", ["done", "error"])
    .not("pasta", "is", null)
    .limit(50);
  if (error) {
    if (!isMissingSchemaError(error)) console.warn(`[vps/mover] leitura: ${error.message}`);
    return 0;
  }
  let movidas = 0;
  for (const e of (data ?? []) as Array<{ id: string; user_id: string; conta_id: string | null; status: string; acoes: unknown; steps: unknown; pasta: string }>) {
    if (!e.conta_id) continue;
    if (!prontidaoDaConta({ status: e.status, plano: parsePlano(e.acoes), steps: parseJobSteps(e.steps) })) continue;
    const { error: contaErr } = await admin.from("emulator_jobs").update({ pasta: e.pasta }).eq("id", e.conta_id).eq("user_id", e.user_id).eq("kind", "nova-conta");
    if (contaErr) {
      console.warn(`[vps/mover] conta ${e.conta_id}: ${contaErr.message}`);
      continue;
    }
    await admin.from("emulator_jobs").update({ pasta: null }).eq("id", e.id);
    movidas += 1;
  }
  return movidas;
}
