import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { MIDIA_BUCKET, midiaPaths, type AtividadeInput } from "./atividade";
import type { JobStep, JobUpdate, NovaContaInput } from "./jobs";

/** Mídia de uma atividade para o agente baixar: link assinado e a extensão do arquivo. */
export interface MidiaParaAgente {
  url: string;
  ext: string;
}

/** Atividade como o agente recebe: as mídias viram links assinados (valem 2 h). */
export interface AtividadeParaAgente {
  acoes: AtividadeInput["acoes"];
  midias: { foto?: MidiaParaAgente; story?: MidiaParaAgente };
  story: AtividadeInput["story"];
}

/** O que o agente recebe para rodar uma conta (input já aberto: só vai pelo sync autenticado). */
export interface ClaimedJob {
  id: string;
  kind: string;
  label: string | null;
  templateIndex: number;
  instanceIndex: number | null;
  steps: JobStep[];
  input: NovaContaInput | AtividadeParaAgente;
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
  label: string | null;
  template_index: number;
  instance_index: number | null;
  input_enc: string;
  steps: JobStep[];
}

const ORPHAN_ERROR = "O agente parou no meio (fechou ou reiniciou). Clique em Continuar.";
const EMPTY: SyncJobsResult = { jobs: [], replies: [] };
const MIDIA_LINK_S = 2 * 60 * 60;

async function paraAgente(admin: SupabaseClient, input: AtividadeInput): Promise<AtividadeParaAgente> {
  const midias: AtividadeParaAgente["midias"] = {};
  for (const uso of ["foto", "story"] as const) {
    const path = input.midias?.[uso];
    if (!path) continue;
    const { data, error } = await admin.storage.from(MIDIA_BUCKET).createSignedUrl(path, MIDIA_LINK_S);
    if (error || !data?.signedUrl) throw new Error(`A mídia ${uso === "foto" ? "da foto" : "do story"} sumiu do armazenamento. Remova e inicie de novo.`);
    midias[uso] = { url: data.signedUrl, ext: path.slice(path.lastIndexOf(".")) };
  }
  return { acoes: input.acoes, midias, story: input.story ?? null };
}

/** Apaga do bucket as mídias de atividades que terminaram ou saíram da lista. Nunca falha quem chamou. */
export async function removerMidias(admin: SupabaseClient, rows: ReadonlyArray<{ kind: string; input_enc: string }>): Promise<void> {
  const paths = rows.flatMap((r) => {
    if (r.kind !== "atividade") return [];
    try {
      return midiaPaths(JSON.parse(decrypt(r.input_enc)) as AtividadeInput);
    } catch {
      return [];
    }
  });
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(MIDIA_BUCKET).remove(paths);
  if (error) console.warn(`[emulador] mídias da atividade ficaram no bucket: ${error.message}`);
}

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

  const done = updates.filter((u) => u.status === "done").map((u) => u.id);
  if (done.length > 0) {
    const { data } = await admin.from("emulator_jobs").select("kind, input_enc").in("id", done).eq("kind", "atividade");
    await removerMidias(admin, (data ?? []) as Array<{ kind: string; input_enc: string }>);
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
    .select("id, kind, label, template_index, instance_index, input_enc, steps")
    .eq("agent_id", agentId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextErr) throw new Error(nextErr.message);
  if (!next) return { jobs: [], replies };
  const row = next as QueuedRow;

  const falhar = async (error: string) => {
    await admin.from("emulator_jobs").update({ status: "error", error, finished_at: now, updated_at: now }).eq("id", row.id);
    return { jobs: [], replies };
  };
  let aberto: unknown;
  try {
    aberto = JSON.parse(decrypt(row.input_enc));
  } catch {
    return falhar("Não deu para abrir os dados da conta. Remova e cadastre de novo.");
  }
  let input: ClaimedJob["input"];
  try {
    input = row.kind === "atividade" ? await paraAgente(admin, aberto as AtividadeInput) : (aberto as NovaContaInput);
  } catch (e) {
    return falhar((e as Error).message);
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
        label: row.label,
        templateIndex: row.template_index,
        instanceIndex: row.instance_index,
        steps: Array.isArray(row.steps) ? row.steps : [],
        input,
      },
    ],
    replies,
  };
}
