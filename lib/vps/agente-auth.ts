import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { agentTokenFromRequest, hashAgentToken } from "@/lib/emulador/token";

/**
 * Rotas que o agente da VPS chama fora do sync (fotos e prints), com o mesmo
 * `Authorization: Bearer smag_…`. Com o agente noutra máquina (12/11) o
 * app deixa de ver a pasta dele: as fotos descem por aqui e os prints sobem.
 */
export async function agenteDoPedido(req: Request): Promise<{ agent: { id: string; user_id: string } } | { response: NextResponse }> {
  const token = agentTokenFromRequest(req);
  if (!token) return { response: NextResponse.json({ error: "Código do agente ausente ou inválido." }, { status: 401 }) };
  const { data: agent, error } = await getSupabaseAdmin()
    .from("emulator_agents")
    .select("id, user_id")
    .eq("token_hash", hashAgentToken(token))
    .maybeSingle();
  if (error) return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!agent) return { response: NextResponse.json({ error: "Código do agente desconhecido." }, { status: 401 }) };
  return { agent: agent as { id: string; user_id: string } };
}
