import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encrypt";
import { parseJobSteps } from "@/lib/emulador/jobs";
import { parseCriada } from "@/lib/emulador/payload";
import type { VpsContaInput } from "./types";

export interface ContaParaRemover {
  id: string;
  userId: string;
  agentId: string;
  steps: unknown;
  input: VpsContaInput;
}

/**
 * Tira a conta da aba Contas VPS: manda o agente apagar o container (com o
 * volume, o sidecar, as props e a sessão exportada) e apaga o device e a linha
 * da conta — as estruturações dela somem junto (conta_id ON DELETE CASCADE).
 * É o "Remover" do card e a limpeza da conta que terminou conectada no SaaS.
 * Quem chama confere antes que nada da conta está rodando e que a VPS está online.
 */
export async function removerContaVps(admin: SupabaseClient, conta: ContaParaRemover): Promise<{ ok: true } | { erro: string; status: number }> {
  const steps = parseJobSteps(conta.steps);
  const nome = steps.find((s) => s.key === "nome")?.message;
  const criado = steps.some((s) => s.key === "copiar" && s.status === "done");
  if (criado) {
    // Nome e índice saem de vps_devices; criada = docker_created (string crua do inspect, gravada na etapa copiar).
    // Sem a coluna (SQL não aplicado), lê só o container e o agente confere pelo inspect.
    let { data: device } = await admin.from("vps_devices").select("container, docker_created").eq("job_id", conta.id).eq("user_id", conta.userId).maybeSingle();
    if (!device) ({ data: device } = await admin.from("vps_devices").select("container").eq("job_id", conta.id).eq("user_id", conta.userId).maybeSingle());
    const container = (device?.container as string | undefined) ?? conta.input.device.container;
    const index = Number(/^ig-(\d+)$/.exec(container)?.[1] ?? conta.input.device.index);
    const criada = parseCriada((device as { docker_created?: unknown } | null)?.docker_created);
    const { error: cmdErr } = await admin.from("emulator_commands").insert({
      user_id: conta.userId,
      agent_id: conta.agentId,
      instance_index: index,
      action: "delete",
      // conta = id da conta: o agente apaga o container que tem a label dela (e a sessão <id>.tgz), mesmo com o Created do banco defasado.
      params: { nome: nome ?? container, ...(criada ? { criada } : {}), container, volume: conta.input.device.volume, conta: conta.id },
    });
    if (cmdErr) return { erro: cmdErr.message, status: 500 };
  }

  await admin.from("vps_devices").delete().eq("job_id", conta.id).eq("user_id", conta.userId);
  const { data, error } = await admin.from("emulator_jobs").delete().eq("id", conta.id).eq("user_id", conta.userId).neq("status", "running").select("id");
  if (error) return { erro: error.message, status: 500 };
  if (!data?.length) return { erro: "Conta não encontrada ou rodando agora.", status: 409 };
  return { ok: true };
}

/**
 * Pedido do dono (15/11): estruturação concluída com a conta conectada no SaaS
 * = a conta sai da VPS inteira (container, device, sessão, linha da aba). Só
 * apaga com a estruturação `done` (desde a 1.9.17 qualquer falha encerra o job,
 * então done = todas as etapas, OAuth incluído) E a conta em Contas do
 * Instagram com token. Nada da conta rodando. Roda no sync do agente (online).
 * Devolve os @ apagados.
 */
/** decisão (15/11): só estruturações concluídas a partir daqui; as 13 já conectadas antes ficam até o dono decidir. */
export const APAGAR_CONECTADAS_DESDE = "2026-11-15T01:18:00Z";

export async function apagarConectadas(admin: SupabaseClient, agentId: string, limite = 10, desde = APAGAR_CONECTADAS_DESDE): Promise<string[]> {
  const { data: prontas, error } = await admin
    .from("emulator_jobs")
    .select("conta_id")
    .eq("agent_id", agentId)
    .eq("kind", "estruturacao")
    .eq("status", "done")
    .gte("finished_at", desde)
    .not("conta_id", "is", null)
    .limit(limite);
  if (error || !prontas?.length) return [];
  const apagadas: string[] = [];
  for (const contaId of [...new Set(prontas.map((p) => p.conta_id as string))]) {
    const { data: conta } = await admin
      .from("emulator_jobs")
      .select("id, user_id, agent_id, label, status, steps, input_enc")
      .eq("id", contaId)
      .eq("kind", "nova-conta")
      .maybeSingle();
    if (!conta || conta.status === "running") continue;
    // Outra estruturação da mesma conta rodando ou na fila: espera ela terminar.
    const { data: ativa } = await admin.from("emulator_jobs").select("id").eq("conta_id", contaId).in("status", ["queued", "running"]).limit(1);
    if (ativa?.length) continue;
    const usuario = String(conta.label ?? "").replace(/^@/, "").trim();
    if (!usuario) continue;
    const { data: noSaas } = await admin
      .from("instagram_accounts")
      .select("id")
      .eq("user_id", conta.user_id)
      .ilike("username", usuario)
      .or("meta_access_token.not.is.null,access_token.not.is.null")
      .limit(1);
    if (!noSaas?.length) continue;
    let input: VpsContaInput;
    try {
      input = JSON.parse(decrypt(conta.input_enc as string)) as VpsContaInput;
    } catch {
      continue;
    }
    const r = await removerContaVps(admin, { id: conta.id as string, userId: conta.user_id as string, agentId: conta.agent_id as string, steps: conta.steps, input });
    if ("ok" in r) apagadas.push(usuario);
    else console.warn(`[vps/apagar-conectadas] @${usuario}: ${r.erro}`);
  }
  return apagadas;
}
