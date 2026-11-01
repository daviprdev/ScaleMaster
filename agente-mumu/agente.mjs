#!/usr/bin/env node
/**
 * Agente do Scale Master para o MuMu Player.
 *
 * Roda no PC onde está o MuMu e liga esse PC à aba Emulador do SaaS. A cada
 * ~3 s chama /api/emulador/agente/sync: manda as instâncias do MuMu e o
 * resultado dos comandos, e recebe os comandos novos (abrir, fechar, rodar
 * automação). A conexão sai do PC, então não precisa abrir porta no roteador.
 *
 *   node agente.mjs conectar <código>   salva o código (gerado na aba Emulador) e começa
 *   node agente.mjs                     roda com o código salvo
 *   node agente.mjs parar               para o agente que estiver rodando
 *   node agente.mjs instancias          lista as instâncias (teste local, sem SaaS)
 *   node agente.mjs abrir-mumu          abre só a janela do MuMu (teste local)
 *   node agente.mjs abrir <n>           abre a instância n (teste local)
 *   node agente.mjs fechar <n>          fecha a instância n (teste local)
 *   node agente.mjs tarefa <nome> <n>   roda uma automação na instância n (teste local)
 *   node agente.mjs nova-conta <n> [json] roda Criar instância copiando a n (teste local)
 *
 * Além dos comandos, o sync entrega as contas da fila Nova conta (fluxos/):
 * uma por vez, com o andamento etapa a etapa (jobUpdates/runningJobs).
 *
 * Sem dependências: só Node 18+. Segurança: o servidor só escolhe entre
 * abrir/fechar/automação conhecida, pelo número da instância; nada vindo dele
 * vira comando de terminal.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Dispositivo } from "./lib/adb.mjs";
import { MuMu } from "./lib/mumu.mjs";
import { esperar } from "./lib/processo.mjs";
import { TAREFAS } from "./tarefas/index.mjs";
import { FLUXOS } from "./fluxos/nova-conta.mjs";

const VERSAO = "1.3.1";
/** "Instância" -1 = o MuMu em si: launch nela abre só a janela principal (igual a lib/emulador/payload.ts). */
const PC_INDEX = -1;
const PASTA = path.dirname(fileURLToPath(import.meta.url));
const ARQ_CONFIG = path.join(PASTA, "config.json");
const ARQ_LOG = path.join(PASTA, "agente.log");
const ARQ_PID = path.join(PASTA, "agente.pid");
const URL_PADRAO = "https://scalemaster.tech";
const TOKEN_RE = /^smag_[A-Za-z0-9_-]{43}$/;

const INTERVALO_MS = 3_000;
const ESPERA_SEM_REDE_MS = 10_000;
const ESPERA_SQL_MS = 30_000;
const ESPERA_CODIGO_INVALIDO_MS = 60_000;
const LOG_MAX_BYTES = 5 * 1024 * 1024;

// ── log ─────────────────────────────────────────────────────────────────────

let ultimaLinha = "";

function log(mensagem) {
  const linha = `[${new Date().toLocaleString("pt-BR")}] ${mensagem}`;
  console.log(linha);
  try {
    if (existsSync(ARQ_LOG) && statSync(ARQ_LOG).size > LOG_MAX_BYTES) renameSync(ARQ_LOG, `${ARQ_LOG}.1`);
    appendFileSync(ARQ_LOG, `${linha}\n`);
  } catch {
    /* sem log em arquivo: segue só no console */
  }
}

/** Erro que se repete a cada sync aparece uma vez só, até mudar. */
function logSemRepetir(mensagem) {
  if (mensagem === ultimaLinha) return;
  ultimaLinha = mensagem;
  log(mensagem);
}

// ── config e instância única ───────────────────────────────────────────────

function lerConfig() {
  try {
    return JSON.parse(readFileSync(ARQ_CONFIG, "utf8"));
  } catch {
    return null;
  }
}

/** Processo vivo E node (o PID do arquivo pode ter sido reaproveitado pelo Windows depois de um desligamento). */
function pidVivo(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== "win32") return true;
  try {
    const saida = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], { encoding: "utf8", windowsHide: true });
    return /node/i.test(saida);
  } catch {
    return true;
  }
}

function pidRodando() {
  try {
    const pid = Number(readFileSync(ARQ_PID, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && pidVivo(pid) ? pid : null;
  } catch {
    return null;
  }
}

function travarInstanciaUnica() {
  const outro = pidRodando();
  if (outro) {
    console.log(`O agente já está rodando (PID ${outro}). Para parar: node agente.mjs parar`);
    process.exit(0);
  }
  writeFileSync(ARQ_PID, String(process.pid));
  const soltar = () => {
    try {
      if (readFileSync(ARQ_PID, "utf8").trim() === String(process.pid)) unlinkSync(ARQ_PID);
    } catch {
      /* já foi */
    }
  };
  process.on("exit", soltar);
  for (const sinal of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sinal, () => process.exit(0));
}

// ── execução dos comandos ──────────────────────────────────────────────────

/** Uma coisa por instância de cada vez; instâncias diferentes rodam em paralelo. */
const filas = new Map();

function naFilaDaInstancia(index, trabalho) {
  const anterior = filas.get(index) ?? Promise.resolve();
  const atual = anterior.then(trabalho, trabalho);
  filas.set(index, atual.catch(() => {}));
  return atual;
}

async function executar(mumu, comando) {
  const index = comando.instanceIndex;
  if (index === PC_INDEX) {
    if (comando.action !== "launch") throw new Error("No MuMu em si só dá para abrir.");
    await mumu.abrirMuMu();
    return null;
  }
  if (!Number.isInteger(index) || index < 0) throw new Error("Instância inválida.");

  if (comando.action === "launch") {
    await mumu.abrir(index);
    return null;
  }
  if (comando.action === "shutdown") {
    await mumu.fechar(index);
    return null;
  }
  if (comando.action === "rename") {
    const nome = String(comando.params?.nome ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!nome) throw new Error("Nome inválido.");
    await mumu.renomear(index, nome);
    return null;
  }
  if (comando.action === "task") {
    const tarefa = TAREFAS.find((t) => t.nome === comando.task);
    if (!tarefa) throw new Error(`Este agente não tem a automação "${comando.task}". Atualize a pasta agente-mumu.`);
    const logTarefa = (m) => log(`[${tarefa.nome} #${index}] ${m}`);
    const instancia = await mumu.prepararInstancia(index, { log: logTarefa });
    const dispositivo = new Dispositivo(mumu.adb, instancia.adb);
    await dispositivo.conectar();
    logTarefa("começou");
    const resultado = await tarefa.rodar({
      instancia,
      dispositivo,
      mumu,
      params: comando.params && typeof comando.params === "object" ? comando.params : {},
      log: logTarefa,
    });
    logTarefa("terminou");
    return resultado ?? null;
  }
  throw new Error(`Ação desconhecida: ${comando.action}`);
}

/** Quanto o agente espera o dono responder (código do Gmail, "já resolvi"). */
const ESPERA_RESPOSTA_MS = 30 * 60_000;

/**
 * Roda uma conta da fila (fluxos/), etapa por etapa, pulando as que já estão
 * concluídas em job.steps (retomada pelo botão Continuar). `reportar` recebe o
 * andamento inteiro a cada mudança; o último vale. `aguardarResposta(id, ms)`
 * devolve o que o dono respondeu na aba quando uma etapa pergunta algo.
 */
async function rodarJob(mumu, job, reportar, aguardarResposta) {
  const fluxo = FLUXOS[job.kind];
  const feitas = (Array.isArray(job.steps) ? job.steps : []).filter((s) => s?.status === "done");
  const steps = feitas.map((s) => ({ key: s.key, status: "done", message: s.message ?? null }));
  const estado = { instanceIndex: Number.isInteger(job.instanceIndex) ? job.instanceIndex : null };
  let prompt = null;
  const enviar = (status, error = null) =>
    reportar({
      id: job.id,
      instanceIndex: estado.instanceIndex ?? undefined,
      steps: steps.map((s) => ({ ...s })),
      status,
      error,
      prompt: status === "running" ? prompt : null,
    });

  if (!fluxo) return enviar("error", `Este agente não conhece o fluxo "${job.kind}". Atualize a pasta agente-mumu.`);
  if (!mumu) return enviar("error", "MuMu não encontrado neste PC.");

  const conta = job.input?.conta ?? {};
  const logJob = (m) => log(`[conta ${conta.usuario || conta.email || job.id.slice(0, 8)}] ${m}`);

  /** Aparelho da cópia, ligado e com adb (liga de novo se alguém desligou no meio). */
  let aparelho = null;
  const dispositivo = async () => {
    if (estado.instanceIndex === null) throw new Error("A cópia da instância ainda não foi criada.");
    const instancia = await mumu.prepararInstancia(estado.instanceIndex, { log: logJob });
    if (!aparelho || aparelho.serial !== instancia.adb) aparelho = new Dispositivo(mumu.adb, instancia.adb);
    await aparelho.conectar();
    return aparelho;
  };
  const perguntar = async (tipo, texto) => {
    prompt = { tipo, texto };
    enviar("running");
    try {
      return await aguardarResposta(job.id, ESPERA_RESPOSTA_MS);
    } finally {
      prompt = null;
      enviar("running");
    }
  };

  for (const etapa of fluxo) {
    if (steps.some((s) => s.key === etapa.chave)) continue;
    const step = { key: etapa.chave, status: "running", message: null };
    steps.push(step);
    enviar("running");
    logJob(`${etapa.rotulo}…`);
    try {
      const mensagem = await etapa.rodar({ mumu, job, input: job.input ?? {}, estado, log: logJob, dispositivo, perguntar });
      step.status = "done";
      step.message = mensagem ? String(mensagem).slice(0, 300) : null;
      logJob(`${etapa.rotulo}: ok${step.message ? ` (${step.message})` : ""}`);
      enviar("running");
    } catch (e) {
      step.status = "error";
      step.message = String(e.message).slice(0, 300);
      logJob(`${etapa.rotulo} falhou: ${e.message}`);
      return enviar("error", e.semPrefixo ? e.message : `${etapa.rotulo}: ${e.message}`);
    }
  }
  logJob("terminou");
  return enviar("done");
}

// ── conexão com o SaaS ─────────────────────────────────────────────────────

async function rodarAgente() {
  const config = lerConfig();
  if (!config?.token) {
    console.log("Este PC ainda não está conectado. Gere o código na aba Emulador e rode:");
    console.log("  node agente.mjs conectar <código>");
    process.exit(1);
  }
  travarInstanciaUnica();

  const url = String(config.url || URL_PADRAO).replace(/\/+$/, "");
  const tarefas = TAREFAS.map((t) => ({ name: t.nome, label: t.rotulo, description: t.descricao }));
  const emAndamento = new Set();
  let resultados = [];
  const contasEmAndamento = new Set();
  /** Último andamento de cada conta ainda não entregue ao SaaS. */
  const andamentos = new Map();
  const devolverAndamentos = (lista) => {
    for (const u of lista) if (!andamentos.has(u.id)) andamentos.set(u.id, u);
  };
  /** Contas paradas esperando o dono responder na aba: id → entrega da resposta. */
  const esperandoResposta = new Map();
  const aguardarResposta = (id, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        esperandoResposta.delete(id);
        reject(new Error(`Ninguém respondeu em ${Math.round(ms / 60_000)} min.`));
      }, ms);
      esperandoResposta.set(id, (resposta) => {
        clearTimeout(timer);
        esperandoResposta.delete(id);
        resolve(resposta);
      });
    });
  let mumu = null;
  let versaoMumu = null;
  let erroLocalizar = null;
  let proximaBusca = 0;
  let online = false;

  log(`Agente ${VERSAO} iniciado (${os.hostname()}) → ${url}`);

  for (;;) {
    // Sem MuMu achado, procura de novo a cada 30 s (a busca lê o registro do Windows).
    if (!mumu && Date.now() >= proximaBusca) {
      try {
        mumu = await MuMu.localizar(config.mumuManager);
        versaoMumu = await mumu.versao().catch(() => null);
        erroLocalizar = null;
        log(`MuMu ${versaoMumu ?? "?"} em ${mumu.manager}`);
      } catch (e) {
        erroLocalizar = e.message;
        proximaBusca = Date.now() + 30_000;
        logSemRepetir(`MuMu: ${erroLocalizar}`);
      }
    }

    let erroMumu = mumu ? null : erroLocalizar;
    let instancias = [];
    if (mumu) {
      try {
        instancias = await mumu.instancias();
      } catch (e) {
        erroMumu = e.message;
        logSemRepetir(`MuMu: ${erroMumu}`);
      }
    }

    const enviando = resultados;
    resultados = [];
    const enviandoAndamentos = [...andamentos.values()];
    andamentos.clear();
    const corpo = {
      agentVersion: VERSAO,
      hostname: os.hostname(),
      mumuVersion: versaoMumu,
      mumuError: erroMumu,
      instances: instancias.map(({ index, name, state }) => ({ index, name, state })),
      tasks: tarefas,
      results: enviando,
      running: [...emAndamento],
      jobUpdates: enviandoAndamentos,
      runningJobs: [...contasEmAndamento],
    };

    let espera = INTERVALO_MS;
    try {
      const res = await fetch(`${url}/api/emulador/agente/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(15_000),
      });
      const resposta = await res.json().catch(() => ({}));

      if (res.status === 401) {
        online = false;
        espera = ESPERA_CODIGO_INVALIDO_MS;
        logSemRepetir(`Código recusado pelo SaaS: ${resposta.error ?? "401"}. Gere outro na aba Emulador e rode "node agente.mjs conectar <código>".`);
      } else if (!res.ok) {
        resultados = [...enviando, ...resultados];
        devolverAndamentos(enviandoAndamentos);
        espera = res.status === 503 ? ESPERA_SQL_MS : ESPERA_SEM_REDE_MS;
        logSemRepetir(`SaaS respondeu ${res.status}: ${resposta.error ?? "sem mensagem"}`);
      } else {
        if (!online) {
          online = true;
          ultimaLinha = "";
          log(`Conectado ao SaaS. ${instancias.length} instância(s) no MuMu.`);
        }
        for (const comando of Array.isArray(resposta.commands) ? resposta.commands : []) {
          if (typeof comando?.id !== "string" || emAndamento.has(comando.id)) continue;
          emAndamento.add(comando.id);
          log(`Comando: ${comando.action}${comando.task ? ` ${comando.task}` : ""} na instância #${comando.instanceIndex}`);
          naFilaDaInstancia(comando.instanceIndex, async () => {
            try {
              if (!mumu) throw new Error(erroMumu ?? "MuMu não encontrado.");
              const resultado = await executar(mumu, comando);
              resultados.push({ id: comando.id, status: "done", result: resultado });
            } catch (e) {
              log(`Comando ${comando.action} #${comando.instanceIndex} falhou: ${e.message}`);
              resultados.push({ id: comando.id, status: "error", error: e.message });
            } finally {
              emAndamento.delete(comando.id);
            }
          });
        }
        for (const r of Array.isArray(resposta.replies) ? resposta.replies : []) {
          esperandoResposta.get(r?.id)?.(String(r.reply ?? ""));
        }
        for (const job of Array.isArray(resposta.jobs) ? resposta.jobs : []) {
          if (typeof job?.id !== "string" || contasEmAndamento.has(job.id)) continue;
          contasEmAndamento.add(job.id);
          log(`Conta na fila: ${job.input?.conta?.usuario || job.input?.conta?.email || job.id.slice(0, 8)} (cópia da #${job.templateIndex})`);
          rodarJob(mumu, job, (u) => andamentos.set(u.id, u), aguardarResposta)
            .catch((e) => andamentos.set(job.id, { id: job.id, steps: [], status: "error", error: e.message }))
            .finally(() => contasEmAndamento.delete(job.id));
        }
      }
    } catch (e) {
      online = false;
      resultados = [...enviando, ...resultados];
      devolverAndamentos(enviandoAndamentos);
      espera = ESPERA_SEM_REDE_MS;
      logSemRepetir(`Sem conexão com o SaaS (${e.cause?.code ?? e.name}): ${e.message}`);
    }

    await esperar(espera);
  }
}

// ── linha de comando ───────────────────────────────────────────────────────

function conectar(token, args) {
  if (!TOKEN_RE.test(token ?? "")) {
    console.log("Código inválido. Ele começa com smag_ e aparece ao clicar em Conectar um PC na aba Emulador.");
    process.exit(1);
  }
  const iUrl = args.indexOf("--url");
  const url = iUrl >= 0 ? args[iUrl + 1] : lerConfig()?.url;
  const anterior = lerConfig() ?? {};
  writeFileSync(ARQ_CONFIG, `${JSON.stringify({ ...anterior, url: url || URL_PADRAO, token }, null, 2)}\n`);
  console.log("Código salvo em config.json.");
}

function indice(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) {
    console.log("Informe o número da instância (veja com: node agente.mjs instancias).");
    process.exit(1);
  }
  return n;
}

async function main(args) {
  const [cmd] = args;
  if (cmd === "conectar") {
    conectar(args[1], args);
    return rodarAgente();
  }
  if (!cmd || cmd === "rodar") return rodarAgente();

  if (cmd === "parar") {
    const pid = pidRodando();
    if (!pid) return console.log("O agente não está rodando.");
    process.kill(pid);
    // No Windows o kill encerra na hora, sem rodar o handler de saída do outro processo.
    try {
      unlinkSync(ARQ_PID);
    } catch {
      /* já foi */
    }
    return console.log(`Agente parado (PID ${pid}).`);
  }

  const mumu = await MuMu.localizar(lerConfig()?.mumuManager);
  if (cmd === "instancias") {
    console.log(`MuMuManager: ${mumu.manager}`);
    console.table(await mumu.instancias());
    return;
  }
  if (cmd === "abrir-mumu") {
    await executar(mumu, { action: "launch", instanceIndex: PC_INDEX });
    return console.log("MuMu aberto.");
  }
  if (cmd === "abrir" || cmd === "fechar") {
    const index = indice(args[1]);
    await executar(mumu, { action: cmd === "abrir" ? "launch" : "shutdown", instanceIndex: index });
    return console.log(`Instância ${index}: ${cmd === "abrir" ? "abrindo" : "fechando"}.`);
  }
  if (cmd === "nova-conta") {
    // Teste local: node agente.mjs nova-conta <padrão> [arquivo.json com { proxy, conta }]
    const input = args[2] ? JSON.parse(readFileSync(args[2], "utf8")) : { proxy: "", conta: {} };
    const job = { id: randomUUID(), kind: "nova-conta", templateIndex: indice(args[1]), instanceIndex: null, steps: [], input };
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let ultimo = null;
    await rodarJob(
      mumu,
      job,
      (u) => {
        ultimo = u;
        if (u.prompt) console.log(`>>> ${u.prompt.texto}`);
      },
      () => new Promise((resolve) => rl.question("resposta: ", resolve))
    );
    rl.close();
    return console.log(JSON.stringify(ultimo, null, 2));
  }
  if (cmd === "tarefa") {
    const resultado = await executar(mumu, { action: "task", task: args[1], instanceIndex: indice(args[2]) });
    return console.log(JSON.stringify(resultado, null, 2));
  }

  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
}

main(process.argv.slice(2)).catch((e) => {
  log(`Erro: ${e.message}`);
  process.exit(1);
});
