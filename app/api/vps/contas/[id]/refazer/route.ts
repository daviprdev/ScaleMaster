import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt, encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { ehDescarte } from "@/lib/emulador/jobs";
import { parseInstances } from "@/lib/emulador/payload";
import { parseLinhaPortal, parseProxy } from "@/lib/vps/input";
import { proxiesEmUso } from "@/lib/vps/jobs";
import { proxyHostDe } from "@/lib/vps/load";
import { novoDevice, proximosIndices } from "@/lib/vps/device";
import { gerarPessoa } from "@/lib/vps/pessoa";
import type { VpsContaInput } from "@/lib/vps/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — "Tentar de novo" de uma conta descartada (captcha ou @ recusado 5
// vezes): cria uma conta nova do zero no mesmo lote, com device, proxy, código
// do portal e pessoa novos, e tira a descartada da lista (container e volume já
// foram apagados pelo agente). Corpo: { proxy: "host:porta:u:s", codigo: "link | código" }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const proxy = parseProxy(typeof body.proxy === "string" ? body.proxy : "");
  if (!proxy) return NextResponse.json({ error: "Proxy no formato host:porta:usuário:senha." }, { status: 400 });
  const codigo = parseLinhaPortal(typeof body.codigo === "string" ? body.codigo : "");
  if (!codigo) return NextResponse.json({ error: 'Código do hstock no formato "link | código".' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: antigo, error: readErr } = await admin
    .from("emulator_jobs")
    .select("id, agent_id, status, error, lote_id, versao_ig, input_enc")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (isMissingSchemaError(readErr)) return NextResponse.json({ error: "Falta aplicar o SQL supabase/vps_contas.sql no Supabase." }, { status: 503 });
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!antigo) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  if (antigo.status !== "error" || !ehDescarte(antigo.error as string | null)) {
    return NextResponse.json({ error: "Só uma conta descartada (captcha ou @ recusado) pode ser refeita." }, { status: 409 });
  }
  let anterior: VpsContaInput;
  try {
    anterior = JSON.parse(decrypt(antigo.input_enc as string)) as VpsContaInput;
  } catch {
    return NextResponse.json({ error: "Não deu para abrir os dados da conta descartada." }, { status: 500 });
  }

  const { data: agent } = await admin.from("emulator_agents").select("id, instances").eq("id", antigo.agent_id).eq("user_id", user.id).maybeSingle();
  if (!agent) return NextResponse.json({ error: "VPS não encontrada." }, { status: 404 });

  // Proxy não pode estar em uso por outra conta viva (a descartada libera a dela).
  const { data: outros } = await admin.from("emulator_jobs").select("id, status, error, label, input_enc").eq("agent_id", agent.id).neq("id", id);
  const emUso = proxiesEmUso(
    ((outros ?? []) as Array<{ status: "queued" | "running" | "done" | "error"; error: string | null; label: string | null; input_enc: string }>).map((j) => ({
      status: j.status,
      error: j.error,
      label: j.label,
      proxyHost: proxyHostDe(j.input_enc),
    }))
  );
  const chave = `${proxy.host}:${proxy.porta}`;
  if (emUso.has(chave)) return NextResponse.json({ error: `A proxy ${chave} já está em uso pela conta @${emUso.get(chave)}.` }, { status: 409 });

  // Índice novo acima de tudo o que já existiu.
  const { data: devices } = await admin.from("vps_devices").select("container").eq("user_id", user.id);
  const { data: todosJobs } = await admin.from("emulator_jobs").select("instance_index").eq("agent_id", agent.id).not("instance_index", "is", null);
  const ocupados = [
    ...parseInstances(agent.instances).map((i) => i.index),
    ...((devices ?? []) as Array<{ container: string }>).map((d) => Number(/^ig-(\d+)$/.exec(d.container)?.[1] ?? 0)),
    ...((todosJobs ?? []) as Array<{ instance_index: number }>).map((j) => j.instance_index),
  ];
  const [index] = proximosIndices(ocupados, 1);

  const { data: labels } = await admin.from("emulator_jobs").select("label").eq("user_id", user.id);
  const usados = new Set(((labels ?? []) as Array<{ label: string | null }>).map((l) => l.label ?? "").filter(Boolean));
  const pessoa = gerarPessoa({ usados });
  const pais = proxy.pais ?? anterior.pais;
  const device = novoDevice(anterior.perfil, pais, index);
  const input: VpsContaInput = {
    proxy: proxy.url,
    pais: device.pais,
    versaoIg: anterior.versaoIg,
    perfil: anterior.perfil,
    provedorEmail: "portal",
    portalLink: codigo.link,
    portalCodigo: codigo.codigo,
    conta: { email: codigo.link, senha: pessoa.senha, nome: pessoa.nome, usuario: pessoa.usuario, nascimento: pessoa.nascimento },
    imap: { host: "", porta: 0, usuario: codigo.link, senha: codigo.codigo },
    device,
  };
  const now = new Date().toISOString();
  const { data: novo, error: insErr } = await admin
    .from("emulator_jobs")
    .insert({
      user_id: user.id,
      agent_id: agent.id,
      kind: "nova-conta",
      label: pessoa.usuario,
      template_index: 0,
      lote_id: antigo.lote_id,
      versao_ig: antigo.versao_ig,
      input_enc: encrypt(JSON.stringify(input)),
      created_at: now,
    })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const { error: devErr } = await admin.from("vps_devices").insert({
    user_id: user.id,
    job_id: novo.id,
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
    await admin.from("emulator_jobs").delete().eq("id", novo.id);
    return NextResponse.json({ error: devErr.message }, { status: 500 });
  }

  // A descartada sai da lista (o agente já apagou container e volume; o device vai junto por cascade).
  await admin.from("vps_devices").delete().eq("job_id", id).eq("user_id", user.id);
  await admin.from("emulator_jobs").delete().eq("id", id).eq("user_id", user.id).eq("status", "error");

  return NextResponse.json({ ok: true, id: novo.id, usuario: pessoa.usuario, container: device.container });
}
