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

/** Resposta do dono a um pedido do agente (código do Gmail, "já resolvi"). */
export interface JobReply {
  id: string;
  reply: string;
}

export interface SyncJobsResult {
  jobs: ClaimedJob[];
  replies: JobReply[];
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
const EMPTY: SyncJobsResult = { jobs: [], replies: [] };

/**
 * Parte "Criar instância" do sync do agente, nesta ordem:
 *   1. grava o andamento que ele mandou (etapas, cópia criada, pedido ao dono);
 *   2. entrega as respostas do dono às contas que estão esperando e limpa o pedido;
 *   3. marca como erro a conta que ele largou no meio;
 *   4. se ele estiver livre, entrega a próxima da fila (uma conta por vez por PC).
 *
 * `stillRunning` null = agente antigo, que não conhece a fila: não recebe conta.
 * Sem a tabela ou sem as colunas novas (SQL ainda não aplicado) não faz nada.
 */
export async function syncJobs(
  admin: SupabaseClient,
  agentId: string,
  updates: JobUpdate[],
  stillRunning: ReadonlySet<string> | null,
  now: string
): Promise<SyncJobsResult> {
  for (const u of updates) {
    const patch: Record<string, unknown> = { steps: u.steps, status: u.status, error: u.error, updated_at: now };
    if (u.instanceIndex !== undefined) patch.instance_index = u.instanceIndex;
    if (u.prompt !== undefined) patch.prompt = u.prompt ? JSON.stringify(u.prompt) : null;
    if (u.status !== "running") Object.assign(patch, { finished_at: now, prompt: null, reply: null });
    const { error } = await admin
      .from("emulator_jobs")
      .update(patch)
      .eq("id", u.id)
      .eq("agent_id", agentId)
      .eq("status", "running");
    if (isMissingSchemaError(error)) return EMPTY;
    if (error) throw new Error(error.message);
  }

  const { data: runningData, error: runningErr } = await admin
    .from("emulator_jobs")
    .select("id, reply")
    .eq("agent_id", agentId)
    .eq("status", "running");
  if (isMissingSchemaError(runningErr)) return EMPTY;
  if (runningErr) throw new Error(runningErr.message);
  const running = (runningData ?? []) as Array<{ id: string; reply: string | null }>;

  const replies = running
    .filter((r) => r.reply !== null && stillRunning?.has(r.id))
    .map((r) => ({ id: r.id, reply: r.reply as string }));
  if (replies.length > 0) {
    const { error } = await admin
      .from("emulator_jobs")
      .update({ prompt: null, reply: null, updated_at: now })
      .in("id", replies.map((r) => r.id));
    if (error) throw new Error(error.message);
  }

  const finished = new Set(updates.filter((u) => u.status !== "running").map((u) => u.id));
  const orphans = running.map((r) => r.id).filter((id) => !stillRunning?.has(id) && !finished.has(id));
  if (orphans.length > 0) {
    const { error } = await admin
      .from("emulator_jobs")
      .update({ status: "error", error: ORPHAN_ERROR, prompt: null, reply: null, finished_at: now, updated_at: now })
      .in("id", orphans)
      .eq("status", "running");
    if (error) throw new Error(error.message);
  }

  const busy = running.some((r) => stillRunning?.has(r.id));
  if (!stillRunning || busy) return { jobs: [], replies };

  const { data: next, error: nextErr } = await admin
    .from("emulator_jobs")
    .select("id, kind, template_index, instance_index, input_enc, steps")
    .eq("agent_id", agentId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextErr) throw new Error(nextErr.message);
  if (!next) return { jobs: [], replies };
  const row = next as QueuedRow;

  let input: NovaContaInput;
  try {
    input = JSON.parse(decrypt(row.input_enc)) as NovaContaInput;
  } catch {
    await admin
      .from("emulator_jobs")
      .update({ status: "error", error: "Não deu para abrir os dados da conta. Remova e cadastre de novo.", finished_at: now, updated_at: now })
      .eq("id", row.id);
    return { jobs: [], replies };
  }

  const { data: claimed, error: claimErr } = await admin
    .from("emulator_jobs")
    .update({ status: "running", started_at: now, updated_at: now, prompt: null, reply: null })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("id");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return { jobs: [], replies };

  return {
    jobs: [
      {
        id: row.id,
        kind: row.kind,
        templateIndex: row.template_index,
        instanceIndex: row.instance_index,
        steps: Array.isArray(row.steps) ? row.steps : [],
        input,
      },
    ],
    replies,
  };
}
