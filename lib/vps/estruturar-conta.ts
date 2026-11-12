import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { agendadoPara, expandirEtapas, type EstruturaDados, type EstruturaInput } from "./estruturacao";
import type { VpsContaInput } from "./types";

/** Servidor: põe na fila da VPS a estruturação de uma conta criada (usado pelo Estruturar da conta e da pasta). */

export const FALTA_SQL_ESTRUTURA = "Falta aplicar o SQL supabase/vps_estruturacao.sql no Supabase.";

export interface ContaRow {
  id: string;
  kind: string;
  status: string;
  label: string | null;
  agent_id: string;
  instance_index: number | null;
  input_enc: string;
}

export const CONTA_COLUNAS = "id, kind, status, label, agent_id, instance_index, input_enc";

export async function criarEstruturacao(
  admin: SupabaseClient,
  userId: string,
  conta: ContaRow,
  dados: EstruturaDados,
  { pastaDestino = null }: { pastaDestino?: string | null } = {}
): Promise<{ id: string; etapas: number } | { error: string; status: number }> {
  if (conta.kind !== "nova-conta") return { error: "Conta não encontrada.", status: 404 };
  if (conta.status !== "done") return { error: "Só dá para estruturar uma conta já criada.", status: 409 };

  let input: VpsContaInput;
  try {
    input = JSON.parse(decrypt(conta.input_enc)) as VpsContaInput;
  } catch {
    return { error: "Não deu para abrir os dados dessa conta.", status: 500 };
  }
  const index = typeof conta.instance_index === "number" ? conta.instance_index : input.device?.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return { error: "Essa conta não tem container.", status: 409 };

  // Sem job ativo no container: nem a própria conta rodando, nem outra estruturação na fila.
  const { data: ativa, error: ativaErr } = await admin
    .from("emulator_jobs")
    .select("id")
    .eq("agent_id", conta.agent_id)
    .eq("instance_index", index)
    .in("status", ["queued", "running"])
    .limit(1);
  if (ativaErr) return { error: ativaErr.message, status: 500 };
  if (ativa?.length) return { error: "Esse container já tem algo na fila ou rodando.", status: 409 };

  const plano = expandirEtapas(dados);
  const entrada: EstruturaInput = {
    ...dados,
    plano,
    conta: { usuario: input.conta.usuario, senha: input.conta.senha },
    pais: input.pais,
  };
  const { data: job, error } = await admin
    .from("emulator_jobs")
    .insert({
      user_id: userId,
      agent_id: conta.agent_id,
      kind: "estruturacao",
      label: conta.label ?? input.conta.usuario,
      template_index: index,
      instance_index: index,
      acoes: plano,
      conta_id: conta.id,
      agendado_para: agendadoPara(dados.agendarHoras),
      input_enc: encrypt(JSON.stringify(entrada)),
      // "Ao concluir, mover para a pasta": lib/vps/mover-ao-concluir.ts aplica quando ela termina conectada.
      ...(pastaDestino ? { pasta: pastaDestino } : {}),
    })
    .select("id")
    .single();
  // 23514 = o check de kind ainda não conhece 'estruturacao'.
  if (isMissingSchemaError(error) || error?.code === "23514") return { error: FALTA_SQL_ESTRUTURA, status: 503 };
  if (error) return { error: error.message, status: 500 };
  return { id: (job as { id: string }).id, etapas: plano.length };
}
