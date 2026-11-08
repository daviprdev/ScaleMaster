import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseInstances } from "@/lib/emulador/payload";
import { parseLoteInput } from "@/lib/vps/input";
import { parseCapacidade, proxiesEmUso } from "@/lib/vps/jobs";
import { proxyHostDe } from "@/lib/vps/load";
import { novoDevice, proximosIndices } from "@/lib/vps/device";
import { gerarPessoa } from "@/lib/vps/pessoa";
import type { VpsContaInput } from "@/lib/vps/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SQL_FALTA = "Falta aplicar o SQL supabase/vps_contas.sql no Supabase.";

// POST — envia um lote (1 a 20 contas) para a VPS: uma proxy e um device por
// conta, todas com o mesmo lote_id. Cada conta vira um emulator_jobs
// (input_enc com proxy, conta, IMAP e a identidade do aparelho) e uma linha em
// vps_devices. Respeita a capacidade que a VPS informou (maxLigadas).
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const agentId = body && typeof body === "object" ? String((body as Record<string, unknown>).agentId ?? "") : "";
  if (!agentId) return NextResponse.json({ error: "VPS não informada." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: agent, error: agentErr } = await admin
    .from("emulator_agents")
    .select("id, kind, instances, capacidade")
    .eq("id", agentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (isMissingSchemaError(agentErr)) return NextResponse.json({ error: SQL_FALTA }, { status: 503 });
  if (agentErr) return NextResponse.json({ error: agentErr.message }, { status: 500 });
  if (!agent || agent.kind !== "vps") return NextResponse.json({ error: "VPS não encontrada." }, { status: 404 });

  const capacidade = parseCapacidade(agent.capacidade);
  const parsed = parseLoteInput(body, capacidade.versoesIg);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const lote = parsed.value;

  const { data: ativos, error: ativosErr } = await admin
    .from("emulator_jobs")
    .select("id, instance_index")
    .eq("agent_id", agent.id)
    .in("status", ["queued", "running"]);
  if (ativosErr && !isMissingSchemaError(ativosErr)) return NextResponse.json({ error: ativosErr.message }, { status: 500 });
  const ativosLista = (ativos ?? []) as Array<{ id: string; instance_index: number | null }>;
  if (ativosLista.length + lote.quantidade > capacidade.maxLigadas) {
    return NextResponse.json(
      { error: `A VPS cabe ${capacidade.maxLigadas} container(s) ligado(s); já tem ${ativosLista.length} na fila ou rodando.` },
      { status: 409 }
    );
  }

  // Índices reservados acima de tudo o que a VPS já tem (containers, contas, devices).
  const { data: devicesAntigos } = await admin.from("vps_devices").select("container").eq("user_id", user.id);
  const ocupados: number[] = [
    ...parseInstances(agent.instances).map((i) => i.index),
    ...ativosLista.map((j) => j.instance_index ?? 0),
    ...((devicesAntigos ?? []) as Array<{ container: string }>).map((d) => Number(/^ig-(\d+)$/.exec(d.container)?.[1] ?? 0)),
  ];
  const { data: todosJobs } = await admin.from("emulator_jobs").select("instance_index").eq("agent_id", agent.id).not("instance_index", "is", null);
  for (const j of (todosJobs ?? []) as Array<{ instance_index: number }>) ocupados.push(j.instance_index);
  const indices = proximosIndices(ocupados, lote.quantidade);

  // Proxy em uso por conta viva desta VPS não entra de novo; conta descartada libera a dela.
  const { data: existentes } = await admin.from("emulator_jobs").select("id, status, error, label, input_enc").eq("agent_id", agent.id);
  const emUso = proxiesEmUso(
    ((existentes ?? []) as Array<{ status: "queued" | "running" | "done" | "error"; error: string | null; label: string | null; input_enc: string }>).map((j) => ({
      status: j.status,
      error: j.error,
      label: j.label,
      proxyHost: proxyHostDe(j.input_enc),
    }))
  );
  for (const p of lote.proxies) {
    const chave = `${p.host}:${p.porta}`;
    if (emUso.has(chave)) return NextResponse.json({ error: `A proxy ${chave} já está em uso pela conta @${emUso.get(chave)}.` }, { status: 409 });
  }

  // Nome, @, senha e nascimento gerados aqui (lib/vps/pessoa.ts); o @ não repete nenhum já gravado nem outro do lote.
  const { data: labels } = await admin.from("emulator_jobs").select("label").eq("user_id", user.id);
  const usados = new Set(((labels ?? []) as Array<{ label: string | null }>).map((l) => l.label ?? "").filter(Boolean));

  const loteId = randomUUID();
  const now = new Date().toISOString();
  const criados: string[] = [];
  for (let i = 0; i < lote.quantidade; i++) {
    const bruta = lote.contas[i];
    const pessoa = lote.gerarPessoa ? gerarPessoa({ usados }) : null;
    const conta = pessoa ? { ...bruta, senhaIg: pessoa.senha, nome: pessoa.nome, usuario: pessoa.usuario, nascimento: pessoa.nascimento } : bruta;
    const proxy = lote.proxies[i];
    const device = novoDevice(lote.perfil, proxy.pais ?? lote.pais, indices[i]);
    const input: VpsContaInput = {
      proxy: proxy.url,
      pais: device.pais,
      versaoIg: lote.versaoIg,
      perfil: lote.perfil,
      provedorEmail: conta.provedorEmail,
      // portal: conta.email = link do painel, imap.senha = código de resgate (mesmos campos, ver lib/vps/types.ts).
      conta: { email: conta.email, senha: conta.senhaIg, nome: conta.nome, usuario: conta.usuario, nascimento: conta.nascimento },
      imap: { host: conta.imapHost, porta: conta.imapPorta, usuario: conta.email, senha: conta.senhaEmail },
      device,
    };
    const { data: job, error } = await admin
      .from("emulator_jobs")
      .insert({
        user_id: user.id,
        agent_id: agent.id,
        kind: "nova-conta",
        label: conta.usuario || (conta.provedorEmail === "portal" ? conta.nome : conta.email),
        template_index: 0,
        lote_id: loteId,
        versao_ig: lote.versaoIg,
        input_enc: encrypt(JSON.stringify(input)),
        created_at: now,
      })
      .select("id")
      .single();
    if (isMissingSchemaError(error)) return NextResponse.json({ error: SQL_FALTA, criados }, { status: 503 });
    if (error) return NextResponse.json({ error: error.message, criados }, { status: 500 });
    criados.push(job.id);

    const { error: devErr } = await admin.from("vps_devices").insert({
      user_id: user.id,
      job_id: job.id,
      android_id: device.androidId,
      serial: device.serial,
      mac: device.mac,
      model: device.model,
      manufacturer: device.manufacturer,
      fingerprint: device.fingerprint,
      resolucao: device.resolucao,
      timezone: device.timezone,
      locale: device.locale,
      container: device.container,
      volume: device.volume,
    });
    if (devErr) {
      await admin.from("emulator_jobs").delete().eq("id", job.id);
      criados.pop();
      if (isMissingSchemaError(devErr)) return NextResponse.json({ error: SQL_FALTA, criados }, { status: 503 });
      return NextResponse.json({ error: devErr.message, criados }, { status: 500 });
    }
  }

  return NextResponse.json({ loteId, ids: criados });
}
