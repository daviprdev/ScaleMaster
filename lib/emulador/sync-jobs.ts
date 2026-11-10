import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import type { AtividadeInput } from "./atividade";
import { ehDescarte, parseJobSteps, renameNomeStep, type JobStep, type JobUpdate, type NovaContaInput } from "./jobs";
import { parseCriada } from "./payload";

/** O que o agente recebe para rodar uma conta (input já aberto: só vai pelo sync autenticado). */
export interface ClaimedJob {
  id: string;
  kind: string;
  label: string | null;
  templateIndex: number;
  instanceIndex: number | null;
  steps: JobStep[];
  input: NovaContaInput | AtividadeInput;
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
/** Limite de tarefas abertas no MuMu por PC, para controlar o uso de RAM. */
export const MAX_CONCURRENT_JOBS_PER_AGENT = 2;
/**
 * Parte "Criar instância" do sync do agente, nesta ordem:
 *   1. grava o andamento que ele mandou (etapas, cópia criada, pedido ao dono);
 *   2. entrega as respostas do dono às contas que estão esperando e limpa o pedido;
 *   3. marca como erro a conta que ele largou no meio;
 *   4. entrega trabalhos da fila até preencher duas vagas simultâneas por PC.
 *
 * `stillRunning` null = agente antigo, que não conhece a fila: não recebe conta.
 * Sem a tabela ou sem as colunas novas (SQL ainda não aplicado) não faz nada.
 */
export async function syncJobs(
  admin: SupabaseClient,
  agentId: string,
  updates: JobUpdate[],
  stillRunning: ReadonlySet<string> | null,
  now: string,
  // Vagas simultâneas: 2 no MuMu; na VPS, o maxCadastro que o agente informou.
  maxConcurrent: number = MAX_CONCURRENT_JOBS_PER_AGENT
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
    // Aba Contas VPS: proxy morta pausa a conta (só volta com proxy nova) e marca o device; a etapa copiar
    // manda o Created do container na mensagem e ele vai para vps_devices.docker_created (mesmo corte de
    // parseCriada). Tudo UPDATE puro: job do MuMu não tem linha em vps_devices (nada acontece) e qualquer
    // erro — tabela/coluna ausente inclusive — é só logado, o sync nunca falha por isso.
    await atualizarDeviceVps(admin, u);
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

  if (!stillRunning) return { jobs: [], replies };
  const runningCount = running.filter((r) => stillRunning.has(r.id)).length;
  const slots = maxConcurrent - runningCount;
  if (slots <= 0) return { jobs: [], replies };

  const naFila = () =>
    admin
      .from("emulator_jobs")
      .select("id, kind, label, template_index, instance_index, input_enc, steps")
      .eq("agent_id", agentId)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(slots);
  // Estruturação agendada (Contas VPS) só sai da fila na hora marcada. Sem a coluna (SQL não aplicado), fila de sempre.
  let { data: nextRows, error: nextErr } = await naFila().or(`agendado_para.is.null,agendado_para.lte.${now}`);
  if (isMissingSchemaError(nextErr)) ({ data: nextRows, error: nextErr } = await naFila());
  if (nextErr) throw new Error(nextErr.message);
  const jobs: ClaimedJob[] = [];
  for (const row of (nextRows ?? []) as QueuedRow[]) {
    let input: ClaimedJob["input"];
    try {
      input = JSON.parse(decrypt(row.input_enc)) as ClaimedJob["input"];
    } catch {
      const { error } = await admin
        .from("emulator_jobs")
        .update({ status: "error", error: "Não deu para abrir os dados da conta. Remova e cadastre de novo.", finished_at: now, updated_at: now })
        .eq("id", row.id)
        .eq("agent_id", agentId)
        .eq("status", "queued");
      if (error) throw new Error(error.message);
      continue;
    }

    const { data: claimed, error: claimErr } = await admin
      .from("emulator_jobs")
      .update({ status: "running", started_at: now, updated_at: now, prompt: null, reply: null })
      .eq("id", row.id)
      .eq("agent_id", agentId)
      .eq("status", "queued")
      .select("id");
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed?.length) continue;

    jobs.push({
      id: row.id,
      kind: row.kind,
      label: row.label,
      templateIndex: row.template_index,
      instanceIndex: row.instance_index,
      steps: Array.isArray(row.steps) ? row.steps : [],
      input,
    });
  }

  if (jobs.length === 0) return { jobs: [], replies };
  return {
    jobs,
    replies,
  };
}

/** UPDATEs em vps_devices e na pausa do job ligados ao andamento; erro engolido com log. */
async function atualizarDeviceVps(admin: SupabaseClient, u: JobUpdate): Promise<void> {
  const avisar = (o: string, error: { message?: string } | null) => {
    if (error) console.warn(`[emulador/sync] ${o} não gravado (${u.id}): ${error.message ?? "erro"}`);
  };
  try {
    if (u.status === "error" && u.error?.startsWith("PROXY_MORTA")) {
      // Só a conta pausa; a estruturação com proxy morta fica parada com o erro e volta pelo Continuar.
      avisar("pausa", (await admin.from("emulator_jobs").update({ pausa: "proxy" }).eq("id", u.id).eq("kind", "nova-conta")).error);
      avisar("vps_devices.status", (await admin.from("vps_devices").update({ status: "proxy-morta" }).eq("job_id", u.id)).error);
    } else if (u.status === "error" && (u.descartada || ehDescarte(u.error))) {
      // Captcha ou @ recusado 5 vezes: o agente já apagou container e volume; a proxy fica livre (proxiesEmUso ignora descartadas).
      avisar("vps_devices.status", (await admin.from("vps_devices").update({ status: "descartada" }).eq("job_id", u.id)).error);
    } else if (u.status === "done") {
      avisar("vps_devices.status", (await admin.from("vps_devices").update({ status: "ativo" }).eq("job_id", u.id)).error);
    }
    // Código do portal resgatado: fica no input para a etapa email saber se a sessão venceu (CODIGO_VENCIDO, sem reuso).
    if (u.portal) {
      const { data: row, error } = await admin.from("emulator_jobs").select("input_enc").eq("id", u.id).maybeSingle();
      avisar("input_enc (ler portal)", error);
      if (row?.input_enc) {
        try {
          const input = JSON.parse(decrypt(row.input_enc as string)) as { portalResgatadoEm?: string; portalExpiraEm?: string };
          if (input.portalResgatadoEm !== u.portal.resgatadoEm || input.portalExpiraEm !== u.portal.expiraEm) {
            input.portalResgatadoEm = u.portal.resgatadoEm;
            input.portalExpiraEm = u.portal.expiraEm;
            avisar("input_enc (portal)", (await admin.from("emulator_jobs").update({ input_enc: encrypt(JSON.stringify(input)) }).eq("id", u.id)).error);
          }
        } catch (e) {
          console.warn(`[emulador/sync] portal não gravado (${u.id}): ${(e as Error).message}`);
        }
      }
    }
    // @ aceito depois de o original ser recusado: entra no input (para Continuar/sessão), no label e em vps_devices.usuario.
    if (u.usuario) {
      const { data: row, error } = await admin.from("emulator_jobs").select("input_enc").eq("id", u.id).maybeSingle();
      avisar("input_enc (ler)", error);
      if (row?.input_enc) {
        try {
          const input = JSON.parse(decrypt(row.input_enc as string)) as { conta?: { usuario?: string } };
          if (input.conta && input.conta.usuario !== u.usuario) {
            input.conta.usuario = u.usuario;
            avisar("input_enc (usuario)", (await admin.from("emulator_jobs").update({ input_enc: encrypt(JSON.stringify(input)), label: u.usuario }).eq("id", u.id)).error);
          }
        } catch (e) {
          console.warn(`[emulador/sync] usuario não gravado (${u.id}): ${(e as Error).message}`);
        }
      }
      avisar("vps_devices.usuario", (await admin.from("vps_devices").update({ usuario: u.usuario }).eq("job_id", u.id)).error);
    }
    // O Created do container vem na mensagem da etapa copiar e, se o abrir() recriou o container, na do abrir: vale o último.
    const comCreated = u.steps.filter((s) => s.status === "done" && /docker_created=/.test(s.message ?? ""));
    const dockerCreated = parseCriada(/docker_created=(\S+)/.exec(comCreated[comCreated.length - 1]?.message ?? "")?.[1]);
    if (dockerCreated) {
      avisar("vps_devices.docker_created", (await admin.from("vps_devices").update({ docker_created: dockerCreated }).eq("job_id", u.id)).error);
    }
  } catch (e) {
    console.warn(`[emulador/sync] vps_devices (${u.id}): ${(e as Error).message}`);
  }
}

/**
 * Editar nome confirmado pelo agente (comandos `done` deste sync): os dados da
 * instância se ligam a ela pelo nome (linkedJobs), então a etapa "nome" passa
 * do nome antigo (params.anterior, gravado ao pedir) para o novo. Repetir não
 * muda nada: depois da troca nenhuma conta tem mais o nome antigo.
 */
export async function syncRenames(admin: SupabaseClient, agentId: string, doneIds: readonly string[]): Promise<void> {
  if (doneIds.length === 0) return;
  const { data: renames, error } = await admin
    .from("emulator_commands")
    .select("instance_index, params")
    .in("id", doneIds)
    .eq("agent_id", agentId)
    .eq("action", "rename");
  if (error) throw new Error(error.message);

  for (const cmd of (renames ?? []) as Array<{ instance_index: number; params: Record<string, unknown> | null }>) {
    const { anterior, nome } = cmd.params ?? {};
    if (typeof anterior !== "string" || typeof nome !== "string" || anterior === nome) continue;
    const { data: jobs, error: jobsErr } = await admin
      .from("emulator_jobs")
      .select("id, steps")
      .eq("agent_id", agentId)
      .eq("instance_index", cmd.instance_index)
      .eq("kind", "nova-conta");
    if (isMissingSchemaError(jobsErr)) return;
    if (jobsErr) throw new Error(jobsErr.message);
    for (const job of (jobs ?? []) as Array<{ id: string; steps: unknown }>) {
      const steps = renameNomeStep(parseJobSteps(job.steps), anterior, nome);
      if (!steps) continue;
      const { error: updErr } = await admin.from("emulator_jobs").update({ steps }).eq("id", job.id);
      if (updErr) throw new Error(updErr.message);
    }
  }
}

/**
 * Excluir instância confirmado pelo agente (comandos `done` deste sync): a
 * conta e as estruturações da instância apagada saem da aba. Se ficassem, o
 * Continuar delas rodaria na próxima cópia, que o MuMu cria com o mesmo índice.
 * Conta com outro nome na etapa "nome" é de uma instância mais antiga que teve
 * esse índice e fica como está. Fila e rodando não chegam aqui (o pedido recusa).
 */
export async function syncDeletes(admin: SupabaseClient, agentId: string, doneIds: readonly string[]): Promise<void> {
  if (doneIds.length === 0) return;
  const { data: deletes, error } = await admin
    .from("emulator_commands")
    .select("instance_index, params")
    .in("id", doneIds)
    .eq("agent_id", agentId)
    .eq("action", "delete");
  if (error) throw new Error(error.message);

  for (const cmd of (deletes ?? []) as Array<{ instance_index: number; params: Record<string, unknown> | null }>) {
    const nome = cmd.params?.nome;
    if (typeof nome !== "string") continue;
    const { data: jobs, error: jobsErr } = await admin
      .from("emulator_jobs")
      .select("id, steps")
      .eq("agent_id", agentId)
      .eq("instance_index", cmd.instance_index)
      .in("status", ["done", "error"]);
    if (isMissingSchemaError(jobsErr)) return;
    if (jobsErr) throw new Error(jobsErr.message);
    const ids = ((jobs ?? []) as Array<{ id: string; steps: unknown }>)
      .filter((job) => {
        const dela = parseJobSteps(job.steps).find((s) => s.key === "nome")?.message;
        return !dela || dela === nome;
      })
      .map((job) => job.id);
    if (ids.length === 0) continue;
    const { error: delErr } = await admin.from("emulator_jobs").delete().in("id", ids).in("status", ["done", "error"]);
    if (delErr) throw new Error(delErr.message);
  }
}
