import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/encrypt";
import { isMissingSchemaError } from "@/lib/queue-insights/load";
import { parseInstances } from "@/lib/emulador/payload";
import { AVISO_ROTACAO, parseFotosPerfil, parseLoteInput, parseProxies, type ProxyLida } from "@/lib/vps/input";
import { diagnosticar, entraNoLote, testarProxies, type ResultadoProxy } from "@/lib/vps/testar-proxy";
import { listarMidias, pastaMidias } from "@/lib/vps/midias";
import { chaveProxy, decidirRam, hostPortaDaChave, parseCapacidade, proxiesEmUso } from "@/lib/vps/jobs";
import { proxyChaveDe, proxyHostDe, redeDe } from "@/lib/vps/load";
import { ramDoAgente } from "@/lib/vps/ram";
import { colisaoDeIdentidade, novoDevice, proximaRede, proximosIndices } from "@/lib/vps/device";
import { gerarPessoa } from "@/lib/vps/pessoa";
import { FALTA_SQL_PASTAS, normalizarPasta } from "@/lib/vps/pastas";
import type { VpsContaInput } from "@/lib/vps/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SQL_FALTA = "Falta aplicar o SQL supabase/vps_contas.sql no Supabase.";

// POST — envia um lote (1 a 50 contas) para a VPS: uma proxy e um device por
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
  // Fotos de perfil marcadas no lote (mínimo 2, da pasta Foto Perfil): cada conta recebe uma, sorteada.
  const fotos = parseFotosPerfil((body as Record<string, unknown>).fotosPerfil, listarMidias(pastaMidias()).map((m) => m.path));
  if ("error" in fotos) return NextResponse.json({ error: fotos.error }, { status: 400 });
  // Pasta escolhida ou criada no diálogo; vazia = sem pasta (a coluna nem vai no insert: funciona sem o SQL das pastas).
  const pasta = normalizarPasta((body as Record<string, unknown>).pasta);

  const { data: ativos, error: ativosErr } = await admin
    .from("emulator_jobs")
    .select("id, instance_index")
    .eq("agent_id", agent.id)
    .in("status", ["queued", "running"]);
  if (ativosErr && !isMissingSchemaError(ativosErr)) return NextResponse.json({ error: ativosErr.message }, { status: 500 });
  const ativosLista = (ativos ?? []) as Array<{ id: string; instance_index: number | null }>;
  // decisão (08/11): o lote entra na fila; maxLigadas/maxCadastro valem na VPS (semáforos do supervisor),
  // que liga um container por vez. Só recusa se a VPS não comporta nenhum container.
  if (capacidade.maxLigadas < 1) {
    return NextResponse.json({ error: "A VPS não comporta nenhum container ligado (capacidade zero)." }, { status: 409 });
  }
  // RAM livre lida do host agora (não do retrato do agente): precisa de maxLigadas × 1600 MB.
  // Com HOST_TESTE=1 no .env do agente o bloqueio vira aviso e o envio passa.
  const ram = ramDoAgente(capacidade);
  const decisaoRam = decidirRam(ram?.bloqueio ?? null, capacidade.hostTeste);
  if (decisaoRam.bloqueio) return NextResponse.json({ error: decisaoRam.bloqueio, ramLivreMb: ram?.livreMb ?? null }, { status: 409 });

  // Proxy em uso por conta viva desta VPS não entra de novo; conta descartada libera a dela.
  const { data: existentes } = await admin.from("emulator_jobs").select("id, status, error, label, input_enc").eq("agent_id", agent.id);
  // Dedupe contra as contas vivas por host:porta:usuário (bloqueia); mesma host:porta com outro usuário só avisa.
  const vivos = ((existentes ?? []) as Array<{ status: "queued" | "running" | "done" | "error"; error: string | null; label: string | null; input_enc: string }>).map((j) => ({
    status: j.status,
    error: j.error,
    label: j.label,
    proxyHost: proxyChaveDe(j.input_enc) ?? proxyHostDe(j.input_enc),
  }));
  const emUso = proxiesEmUso(vivos);
  const hostsEmUso = proxiesEmUso(vivos.map((v) => ({ ...v, proxyHost: v.proxyHost ? hostPortaDaChave(v.proxyHost) : null })));
  // Teste de vida na importação (16/11, formulário de códigos): todas as proxies coladas, direto deste servidor
  // (generate_204, 25 s + 2 tentativas). Só viva/limitada entram; morta, lenta, credencial, recusada e em uso ficam
  // numa lista à parte com o motivo e as excedentes cobrem as que caíram. API antiga (conta[]) segue sem teste.
  // Com sufixo de sessão (16/11) as candidatas são credenciais derivadas (uma sessão exclusiva por conta, mais
  // reservas): `linha` é a linha base da caixa e `sessao` o id; a caixa de proxies não perde linha nenhuma.
  const problemas: Array<{ linha: number; hostPorta: string; estado: string; motivo: string; sessao?: string }> = [];
  let proxiesDoLote: ProxyLida[] = lote.proxies;
  let linhasUsadas: number[] = lote.proxies.map((_, i) => i + 1);
  const testeDe = new Map<string, ResultadoProxy>();
  if (lote.gerarPessoa) {
    const resultados = await testarProxies(lote.proxiesTodas.map((p) => p.url));
    const escolhidas: Array<{ p: ProxyLida; linha: number }> = [];
    lote.proxiesTodas.forEach((p, i) => {
      const hostPorta = `${p.host}:${p.porta}`;
      const linha = lote.sufixo ? (p.linhaBase ?? 1) : i + 1;
      const sessao = p.sessao ? { sessao: p.sessao } : {};
      const dono = emUso.get(chaveProxy(p));
      if (dono) {
        problemas.push({ linha, hostPorta, estado: "em-uso", motivo: `já está em uso pela conta @${dono}`, ...sessao });
        return;
      }
      const r = resultados[i];
      testeDe.set(p.url, r);
      if (!entraNoLote(r.estado)) {
        // Reserva que morreu sem ser necessária não vira problema: só as sessões que ocupariam uma conta.
        if (!lote.sufixo || escolhidas.length < lote.quantidade) problemas.push({ linha, hostPorta, estado: r.estado, motivo: r.motivo, ...sessao });
        return;
      }
      if (escolhidas.length < lote.quantidade) escolhidas.push({ p, linha });
    });
    if (escolhidas.length === 0) {
      const base = parseProxies(body && typeof body === "object" ? (body as Record<string, unknown>).proxies : "", { tipo: lote.tipo, dedupe: false });
      const diagnostico = "value" in base && base.value[0] ? await diagnosticar(resultados, base.value[0], lote.sufixo).catch(() => null) : null;
      return NextResponse.json({ error: `Nenhuma proxy passou no teste: nada foi enviado.${diagnostico ? ` ${diagnostico}` : " Veja o motivo de cada uma abaixo."}`, problemas }, { status: 409 });
    }
    proxiesDoLote = escolhidas.map((e) => e.p);
    linhasUsadas = escolhidas.map((e) => e.linha);
  }
  const quantidade = Math.min(proxiesDoLote.length, lote.quantidade);
  const contasDoLote = lote.contas.slice(0, quantidade);
  const avisosProxy = lote.gerarPessoa
    ? [
        ...(lote.sufixo ? [] : [AVISO_ROTACAO]),
        ...((parseProxies(proxiesDoLote.map((p) => p.url)) as { avisos?: string[] }).avisos ?? []),
        ...proxiesDoLote.filter((p) => testeDe.get(p.url)?.rotacao).map((p) => `Sessão ${p.sessao ?? `${p.host}:${p.porta}`}: ${testeDe.get(p.url)?.aviso ?? "rotação detectada, sessão não fixa"}.`),
      ]
    : lote.avisos;
  const avisos = [...(decisaoRam.aviso ? [decisaoRam.aviso] : []), ...avisosProxy];
  for (const p of proxiesDoLote) {
    const chave = chaveProxy(p);
    const hp = `${p.host}:${p.porta}`;
    if (emUso.has(chave)) {
      return NextResponse.json({ error: `A proxy ${hp} com o usuário ${p.usuario} já está em uso pela conta @${emUso.get(chave)}.` }, { status: 409 });
    }
    if (hostsEmUso.has(hp)) avisos.push(`A proxy ${hp} já é usada pela conta @${hostsEmUso.get(hp)} com outro usuário: segue.`);
  }

  // Índices reservados acima de tudo o que a VPS já tem (containers, contas, devices).
  const { data: devicesAntigos } = await admin.from("vps_devices").select("container, mac").eq("user_id", user.id);
  const ocupados: number[] = [
    ...parseInstances(agent.instances).map((i) => i.index),
    ...ativosLista.map((j) => j.instance_index ?? 0),
    ...((devicesAntigos ?? []) as Array<{ container: string }>).map((d) => Number(/^ig-(\d+)$/.exec(d.container)?.[1] ?? 0)),
  ];
  const { data: todosJobs } = await admin.from("emulator_jobs").select("instance_index").eq("agent_id", agent.id).not("instance_index", "is", null);
  for (const j of (todosJobs ?? []) as Array<{ instance_index: number }>) ocupados.push(j.instance_index);
  const indices = proximosIndices(ocupados, quantidade);

  // Nome, @, senha e nascimento gerados aqui (lib/vps/pessoa.ts); o @ não repete nenhum já gravado nem outro do lote.
  const { data: labels } = await admin.from("emulator_jobs").select("label").eq("user_id", user.id);
  const usados = new Set(((labels ?? []) as Array<{ label: string | null }>).map((l) => l.label ?? "").filter(Boolean));

  // Isolamento: um /24 novo para este lote e, antes de gravar qualquer conta, IP e MAC de cada identidade conferidos
  // contra as linhas de vps_devices (MAC) e as identidades das contas da VPS (IP). Colisão aborta o envio inteiro.
  const redesExistentes = ((existentes ?? []) as Array<{ input_enc: string }>).map((j) => redeDe(j.input_enc)).filter((r) => r !== null);
  let redeDoLote: number;
  try {
    redeDoLote = proximaRede(redesExistentes.map((r) => r.rede));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
  const identidades: Array<{ mac?: string | null; ip?: string | null; container?: string | null }> = [
    ...((devicesAntigos ?? []) as Array<{ container: string; mac: string | null }>).map((d) => ({ mac: d.mac, container: d.container })),
    ...redesExistentes.map((r) => ({ ip: r.ip, container: r.container })),
  ];
  const devices = proxiesDoLote.slice(0, quantidade).map((proxy, i) => novoDevice(lote.perfil, proxy.pais ?? lote.pais, indices[i], redeDoLote));
  for (const device of devices) {
    const batida = colisaoDeIdentidade(device, identidades);
    if (batida) return NextResponse.json({ error: `Isolamento: ${batida}. Nada foi enviado; tente de novo.` }, { status: 409 });
    identidades.push({ mac: device.mac, ip: device.ip, container: device.container });
  }

  const loteId = randomUUID();
  const now = new Date().toISOString();
  const criados: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    const bruta = contasDoLote[i];
    const pessoa = lote.gerarPessoa ? gerarPessoa({ usados }) : null;
    const conta = pessoa ? { ...bruta, senhaIg: pessoa.senha, nome: pessoa.nome, usuario: pessoa.usuario, nascimento: pessoa.nascimento } : bruta;
    const proxy = proxiesDoLote[i];
    const device = devices[i];
    const input: VpsContaInput = {
      proxy: proxy.url,
      pais: device.pais,
      versaoIg: lote.versaoIg,
      perfil: lote.perfil,
      provedorEmail: conta.provedorEmail,
      ...(conta.provedorEmail === "portal" ? { portalLink: conta.email, portalCodigo: conta.senhaEmail } : {}),
      // portal: conta.email = link do painel, imap.senha = código de resgate (mesmos campos, ver lib/vps/types.ts).
      conta: { email: conta.email, senha: conta.senhaIg, nome: conta.nome, usuario: conta.usuario, nascimento: conta.nascimento },
      imap: { host: conta.imapHost, porta: conta.imapPorta, usuario: conta.email, senha: conta.senhaEmail },
      device,
      fotoPerfil: fotos.value[Math.floor(Math.random() * fotos.value.length)],
      // Sessão exclusiva desta conta (já no usuário da proxy) e o IP/país de saída do teste (bloco Isolamento).
      ...(proxy.sessao
        ? {
            sessao: {
              id: proxy.sessao,
              sufixo: lote.sufixo,
              ip: testeDe.get(proxy.url)?.ip ?? null,
              pais: testeDe.get(proxy.url)?.pais ?? null,
              rotacao: !!testeDe.get(proxy.url)?.rotacao,
              testadaEm: now,
            },
          }
        : {}),
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
        ...(pasta ? { pasta } : {}),
      })
      .select("id")
      .single();
    if (isMissingSchemaError(error)) return NextResponse.json({ error: pasta ? FALTA_SQL_PASTAS : SQL_FALTA, criados }, { status: 503 });
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

  // enviadas = as primeiras N linhas de código; linhasUsadas = linhas da caixa de proxies que entraram (o diálogo tira da lista).
  // modoSessao: a caixa de proxies (credenciais base) fica como está; saem as sessões usadas (queimadas).
  const sessoesUsadas = proxiesDoLote.slice(0, quantidade).map((p) => p.sessao).filter((x): x is string => !!x);
  return NextResponse.json({ loteId, ids: criados, avisos, problemas, enviadas: quantidade, codigosSobrando: lote.quantidade - quantidade, linhasUsadas, modoSessao: !!lote.sufixo, sessoesUsadas });
}
