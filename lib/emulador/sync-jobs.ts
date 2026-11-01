import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import type { JobStep, JobUpdate, NovaContaInput } from "./jobs";

/** O que o agente recebe para rodar uma conta (input já aberto: só vai pelo sync autenticado). */
export interface ClaimedJob {
  id: string;
  kind: string;
  templateIndex: number;
  instanceIndex: number | null;
  steps: JobStep[];
  input: NovaContaInput;
}

interface QueuedRow {
  id: string;
  kind: string;
  template_index: number;
  instance_index: number | null;
  input_enc: string;
  steps: JobStep[];
}

const ORPHAN_ERROR = "O agente parou no meio (fechou ou reiniciou). Clique em Continuar.";

/**
 * Parte "Nova conta" do sync do agente: grava o andamento que ele mandou,
 * marca como erro a conta que ele largou no meio e, se ele estiver livre,
 * entrega a próxima da fila. Uma conta por vez por PC.
 *
 * `stillRunning` null = agente antigo, que não conhece a fila: não recebe conta.
 * Sem a tabela (SQL ainda não aplicado) devolve lista vazia.
 */
export async function syncJobs(
  admin: SupabaseClient,
  agentId: string,
  updates: JobUpdate[],
  stillRunning: ReadonlySet<string> | null,
  now: string
): Promise<ClaimedJob[]> {
  for (const u of updates) {
    const patch: Record<string, unknown> = { steps: u.steps, status: u.status, error: u.error, updated_at: now };
    if (u.instanceIndex !== undefined) patch.instance_index = u.instanceIndex;
    if (u.status !== "running") patch.finished_at = now;
    const { error } = await admin
      .from("emulator_jobs")
      .update(patch)
      .eq("id", u.id)
      .eq("agent_id", agentId)
      .eq("status", "running");
    if (isMissingSchemaError(error)) return [];
    if (error) throw new Error(error.message);
  }

  const { data: running, error: runningErr } = await admin
    .from("emulator_jobs")
    .select("id")
    .eq("agent_id", agentId)
    .eq("status", "running");
  if (isMissingSchemaError(runningErr)) return [];
  if (runningErr) throw new Error(runningErr.message);

  const finished = new Set(updates.filter((u) => u.status !== "running").map((u) => u.id));
  const orphans = (running ?? [])
    .map((r) => r.id as string)
    .filter((id) => !stillRunning?.has(id) && !finished.has(id));
  if (orphans.length > 0) {
    const { error } = await admin
      .from("emulator_jobs")
      .update({ status: "error", error: ORPHAN_ERROR, finished_at: now, updated_at: now })
      .in("id", orphans)
      .eq("status", "running");
    if (error) throw new Error(error.message);
  }

  const busy = (running ?? []).some((r) => stillRunning?.has(r.id as string));
  if (!stillRunning || busy) return [];

  const { data: next, error: nextErr } = await admin
    .from("emulator_jobs")
    .select("id, kind, template_index, instance_index, input_enc, steps")
    .eq("agent_id", agentId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextErr) throw new Error(nextErr.message);
  if (!next) return [];
  const row = next as QueuedRow;

  let input: NovaContaInput;
  try {
    input = JSON.parse(decrypt(row.input_enc)) as NovaContaInput;
  } catch {
    await admin
      .from("emulator_jobs")
      .update({ status: "error", error: "Não deu para abrir os dados da conta. Remova e cadastre de novo.", finished_at: now, updated_at: now })
      .eq("id", row.id);
    return [];
  }

  const { data: claimed, error: claimErr } = await admin
    .from("emulator_jobs")
    .update({ status: "running", started_at: now, updated_at: now })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("id");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return [];

  return [
    {
      id: row.id,
      kind: row.kind,
      templateIndex: row.template_index,
      instanceIndex: row.instance_index,
      steps: Array.isArray(row.steps) ? row.steps : [],
      input,
    },
  ];
}
