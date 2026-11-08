import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { decrypt, encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseJobSteps } from "@/lib/emulador/jobs";
import { isOnline, parseCriada } from "@/lib/emulador/payload";
import { parseConta, parseProxy } from "@/lib/vps/input";
import { stepsAfterProxyChange } from "@/lib/vps/jobs";
import type { VpsContaInput } from "@/lib/vps/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Usuário logado + a conta dele (com os dados abertos), ou a resposta de erro. */
async function loadJob(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };

  const admin = getSupabaseAdmin();
  const { data: job, error } = await admin
    .from("emulator_jobs")
    .select("id, kind, status, steps, input_enc, agent_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (isMissingSchemaError(error)) {
    return { response: NextResponse.json({ error: "Falta aplicar o SQL supabase/vps_contas.sql no Supabase." }, { status: 503 }) };
  }
  if (error) return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!job) return { response: NextResponse.json({ error: "Conta não encontrada." }, { status: 404 }) };

  let input: VpsContaInput;
  try {
    input = JSON.parse(decrypt(job.input_enc as string)) as VpsContaInput;
  } catch {
    return { response: NextResponse.json({ error: "Não deu para abrir os dados dessa conta." }, { status: 500 }) };
  }
  return { admin, user, job, input };
}

// GET — dados para a tela (sem senhas nem credenciais da proxy).
export async function GET(_req: NextRequest, { params }: Params) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }
  const loaded = await loadJob((await params).id);
  if ("response" in loaded) return loaded.response;
  const { input } = loaded;
  let proxyHost = "";
  try {
    const u = new URL(input.proxy);
    proxyHost = `${u.hostname}:${u.port}`;
  } catch {
    /* proxy ilegível */
  }
  return NextResponse.json({
    provedorEmail: input.provedorEmail ?? "imap",
    email: input.conta.email,
    nome: input.conta.nome,
    usuario: input.conta.usuario,
    nascimento: input.conta.nascimento,
    imapHost: input.imap.host,
    imapPorta: input.imap.porta,
    proxyHost,
    pais: input.pais,
    versaoIg: input.versaoIg,
    device: { model: input.device.model, serial: input.device.serial, androidId: input.device.androidId, container: input.device.container },
  });
}

// PATCH — troca a proxy (e/ou dados da conta) de uma conta parada ou na fila.
// Proxy nova tira a pausa e refaz da validação (geo) em diante. Conta rodando
// não edita; conta criada só guarda.
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  const { id } = await params;
  const loaded = await loadJob(id);
  if ("response" in loaded) return loaded.response;
  const { admin, job, input } = loaded;
  if (job.status === "running") {
    return NextResponse.json({ error: "A conta está rodando agora. Edite quando ela terminar ou parar." }, { status: 409 });
  }

  const next: VpsContaInput = { ...input, conta: { ...input.conta }, imap: { ...input.imap } };
  let proxyMudou = false;
  const proxyRaw = typeof body.proxy === "string" ? body.proxy.trim() : "";
  if (proxyRaw) {
    const p = parseProxy(proxyRaw);
    if (!p) return NextResponse.json({ error: "Proxy no formato host:porta:usuário:senha." }, { status: 400 });
    next.proxy = p.url;
    if (p.pais) next.pais = p.pais;
    proxyMudou = p.url !== input.proxy;
  }
  if (body.conta && typeof body.conta === "object") {
    const c = body.conta as Record<string, unknown>;
    const provedorAtual = input.provedorEmail ?? "imap";
    const provedorNovo = typeof c.provedorEmail === "string" && c.provedorEmail.trim() ? c.provedorEmail.trim() : provedorAtual;
    // Trocar de provedor não herda o que estava guardado: link/código do portal e senha de app não se misturam.
    const mesmoProvedor = provedorNovo === provedorAtual;
    const parsed = parseConta(
      {
        provedorEmail: provedorNovo,
        email: typeof c.email === "string" && c.email.trim() ? c.email : mesmoProvedor ? input.conta.email : "",
        senhaEmail: typeof c.senhaEmail === "string" && c.senhaEmail.trim() ? c.senhaEmail : mesmoProvedor ? input.imap.senha : "",
        imapHost: typeof c.imapHost === "string" && c.imapHost.trim() ? c.imapHost : mesmoProvedor ? input.imap.host : "",
        imapPorta: typeof c.imapPorta === "string" && c.imapPorta.trim() ? c.imapPorta : String(input.imap.porta || 993),
        senhaIg: typeof c.senhaIg === "string" && c.senhaIg.trim() ? c.senhaIg : input.conta.senha,
        nome: typeof c.nome === "string" ? c.nome : input.conta.nome,
        usuario: typeof c.usuario === "string" ? c.usuario : input.conta.usuario,
        nascimento: typeof c.nascimento === "string" ? c.nascimento : input.conta.nascimento,
      },
      1
    );
    if ("error" in parsed) return NextResponse.json({ error: parsed.error.replace(/^Conta 1: /, "") }, { status: 400 });
    const v = parsed.value;
    next.provedorEmail = v.provedorEmail;
    next.conta = { email: v.email, senha: v.senhaIg, nome: v.nome, usuario: v.usuario, nascimento: v.nascimento };
    next.imap = { host: v.imapHost, porta: v.imapPorta, usuario: v.email, senha: v.senhaEmail };
  }
  const contaMudou =
    JSON.stringify(next.conta) !== JSON.stringify(input.conta) ||
    JSON.stringify(next.imap) !== JSON.stringify(input.imap) ||
    (next.provedorEmail ?? "imap") !== (input.provedorEmail ?? "imap");

  const patch: Record<string, unknown> = {
    input_enc: encrypt(JSON.stringify(next)),
    label: next.conta.usuario || (next.provedorEmail === "portal" ? next.conta.nome : next.conta.email),
    updated_at: new Date().toISOString(),
  };
  if (job.status === "done") {
    const { data, error } = await admin.from("emulator_jobs").update(patch).eq("id", id).eq("status", "done").select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "A conta mudou enquanto você editava. Abra de novo." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  const steps = parseJobSteps(job.steps);
  Object.assign(patch, {
    steps: proxyMudou || contaMudou ? stepsAfterProxyChange(steps) : steps.filter((s) => s.status === "done"),
    status: "queued",
    error: null,
    prompt: null,
    reply: null,
    pausa: null,
    finished_at: null,
  });
  const { data, error } = await admin.from("emulator_jobs").update(patch).eq("id", id).in("status", ["error", "queued"]).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "A conta começou a rodar enquanto você editava." }, { status: 409 });
  if (proxyMudou) await admin.from("vps_devices").update({ status: "criado" }).eq("job_id", id);
  return NextResponse.json({ ok: true });
}

// DELETE — tira a conta da lista e da fila e apaga o device. Se o container já
// existe na VPS, manda o agente apagar (container + volume + prune) pelo
// comando `delete`, conferindo o nome, igual ao MuMu.
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }
  const { id } = await params;
  const loaded = await loadJob(id);
  if ("response" in loaded) return loaded.response;
  const { admin, user, job, input } = loaded;
  if (job.status === "running") {
    return NextResponse.json({ error: "A conta está rodando agora. Espere terminar ou parar." }, { status: 409 });
  }

  const steps = parseJobSteps(job.steps);
  const nome = steps.find((s) => s.key === "nome")?.message;
  const criado = steps.some((s) => s.key === "copiar" && s.status === "done");
  if (criado) {
    // Com a VPS offline o comando expiraria em 2 min e o container ficaria órfão sem botão para apagar.
    const { data: agent } = await admin.from("emulator_agents").select("last_seen_at").eq("id", job.agent_id).maybeSingle();
    if (!isOnline(agent?.last_seen_at as string | null)) {
      return NextResponse.json({ error: "A VPS está offline. Com o agente rodando, tente de novo para apagar o container junto." }, { status: 409 });
    }
    // Nome e índice saem de vps_devices; criada = docker_created (string crua do inspect, gravada na etapa copiar).
    // Sem a coluna (SQL não aplicado), lê só o container e o agente confere pelo inspect.
    let { data: device } = await admin.from("vps_devices").select("container, docker_created").eq("job_id", id).eq("user_id", user.id).maybeSingle();
    if (!device) ({ data: device } = await admin.from("vps_devices").select("container").eq("job_id", id).eq("user_id", user.id).maybeSingle());
    const container = (device?.container as string | undefined) ?? input.device.container;
    const index = Number(/^ig-(\d+)$/.exec(container)?.[1] ?? input.device.index);
    const criada = parseCriada((device as { docker_created?: unknown } | null)?.docker_created);
    const { error: cmdErr } = await admin.from("emulator_commands").insert({
      user_id: user.id,
      agent_id: job.agent_id,
      instance_index: index,
      action: "delete",
      params: { nome: nome ?? container, ...(criada ? { criada } : {}), container, volume: input.device.volume },
    });
    if (cmdErr) return NextResponse.json({ error: cmdErr.message }, { status: 500 });
  }

  await admin.from("vps_devices").delete().eq("job_id", id).eq("user_id", user.id);
  const { data, error } = await admin.from("emulator_jobs").delete().eq("id", id).eq("user_id", user.id).neq("status", "running").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Conta não encontrada ou rodando agora." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
