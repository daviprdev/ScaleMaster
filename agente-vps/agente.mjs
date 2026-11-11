#!/usr/bin/env node
/**
 * Agente do Scale Master para a VPS de containers redroid (aba Contas VPS).
 *
 * Cópia adaptada de agente-mumu/agente.mjs: o mesmo sync
 * (/api/emulador/agente/sync, código smag_, comandos launch/shutdown/rename/
 * delete/task e a fila de jobs), com agentKind "vps" no corpo, o driver
 * Android (lib/android.mjs) no lugar do MuMu e o supervisor (lib/supervisor.mjs):
 * semáforos de containers ligados e cadastros simultâneos, watchdog por conta
 * e limpeza de órfãos no boot.
 *
 *   node agente.mjs conectar <código>   salva o código (gerado na aba Contas VPS) e começa
 *   node agente.mjs rodar               roda com o código salvo (é o que a unit systemd chama)
 *   node agente.mjs parar               para o agente que estiver rodando
 *   node agente.mjs instancias          lista os containers (teste local, sem SaaS)
 *   node agente.mjs abrir <n>           liga o container n (teste local)
 *   node agente.mjs fechar <n>          desliga o container n (teste local)
 *   node agente.mjs excluir <n>         apaga o container n, com o volume (teste local)
 *   node agente.mjs tarefa <nome> <n>   roda uma automação no container n (teste local)
 *   node agente.mjs nova-conta [json]   roda Criar conta a partir da base (teste local)
 *   node agente.mjs proxy <url> [pais]  valida uma proxy pelo endpoint de geo (teste local)
 *   node agente.mjs capacidade          mostra maxLigadas/maxCadastro desta máquina
 *
 * Sem dependências: só Node 18+. Segurança: o servidor só escolhe entre
 * abrir/fechar/renomear/excluir/automação conhecida, pelo índice do container
 * (excluir confere o nome antes); nada vindo dele vira comando de terminal.
 */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Dispositivo } from "./lib/adb.mjs";
import { alertaDe, limparAlerta } from "./lib/alertas.mjs";
import { ARCH, Android, IMAGEM } from "./lib/android.mjs";
import { listarMidias, pastaDeMidias } from "./lib/midias.mjs";
import { limparPrintsAntigos, salvarPrint } from "./lib/prints.mjs";
import { esperar } from "./lib/processo.mjs";
import { validar } from "./lib/rede.mjs";
import { Semaforo, capacidade, criarWatchdog, limparOrfaos, limparOrfaosAntigos, maioresConsumidores } from "./lib/supervisor.mjs";
import { TAREFAS } from "./tarefas/index.mjs";
import { versoesDisponiveis } from "./fluxos/apk.mjs";
import { pararInstagram } from "./fluxos/instagram.mjs";
import { FLUXOS } from "./fluxos/nova-conta.mjs";

const VERSAO = "1.6.0";
const AGENT_KIND = "vps";
/** "Instância" -1 = a VPS em si: só a automação rebuild-imagem roda nela (igual a lib/emulador/payload.ts). */
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

function pidVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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
  for (const sinal of ["SIGINT", "SIGTERM"]) process.on(sinal, () => process.exit(0));
}

// ── execução dos comandos ──────────────────────────────────────────────────

/** Uma coisa por container de cada vez; containers diferentes rodam em paralelo. */
const filas = new Map();

function naFilaDaInstancia(index, trabalho) {
  const anterior = filas.get(index) ?? Promise.resolve();
  const atual = anterior.then(trabalho, trabalho);
  filas.set(index, atual.catch(() => {}));
  return atual;
}

async function executar(driver, comando) {
  const index = comando.instanceIndex;
  if (index === PC_INDEX) {
    // Na VPS em si só rodam automações sem container (rebuild-imagem). Não há "abrir o MuMu".
    if (comando.action !== "task") throw new Error("Na VPS em si só dá para rodar uma automação.");
    const tarefa = TAREFAS.find((t) => t.nome === comando.task && t.semInstancia);
    if (!tarefa) throw new Error(`A automação "${comando.task}" não roda sem container.`);
    const logTarefa = (m) => log(`[${tarefa.nome}] ${m}`);
    logTarefa("começou");
    const resultado = await tarefa.rodar({ instancia: null, dispositivo: null, mumu: driver, params: comando.params ?? {}, log: logTarefa });
    logTarefa("terminou");
    return resultado ?? null;
  }
  if (!Number.isInteger(index) || index < 0) throw new Error("Container inválido.");

  if (comando.action === "launch") {
    await driver.prepararInstancia(index, { log: (m) => log(`[ig-${index}] ${m}`) });
    return null;
  }
  if (comando.action === "shutdown") {
    // Instagram parado antes de desligar: no próximo boot ele não acorda sozinho.
    const atual = await driver.instancia(index).catch(() => null);
    if (atual?.state === "on" && atual.adb) {
      const d = new Dispositivo(driver.adb, atual.adb);
      await d.conectar().then(() => pararInstagram(d), () => {});
    }
    await driver.fechar(index);
    return null;
  }
  if (comando.action === "rename") {
    const nome = String(comando.params?.nome ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!nome) throw new Error("Nome inválido.");
    await driver.renomear(index, nome);
    return null;
  }
  if (comando.action === "delete") {
    // Só apaga se o índice ainda é o container que a aba mostrou (o índice é reaproveitado depois).
    const atual = await driver.instancia(index);
    const esperado = String(comando.params?.nome ?? "");
    // Remover da aba manda o id da conta: container com a label dela é o dela, mesmo recriado (Created novo) ou renomeado.
    const conta = typeof comando.params?.conta === "string" ? comando.params.conta : undefined;
    const daConta = await driver.ehDaConta(index, conta);
    if (!daConta && (!esperado || (atual.name.trim().slice(0, 80) !== esperado && `ig-${index}` !== esperado))) {
      throw new Error(`O container #${index} agora se chama "${atual.name}". Nada foi apagado.`);
    }
    // O driver confere de novo nome e Created (params.criada vem do retrato que a aba viu).
    const criada = typeof comando.params?.criada === "string" ? comando.params.criada : undefined;
    await driver.excluir(index, { log: (m) => log(`[excluir ig-${index}] ${m}`), nome: atual.name, criada, conta });
    limparAlerta(atual.criada);
    log(`Container ig-${index} (${atual.name}) apagado, com o volume.`);
    return null;
  }
  if (comando.action === "task") {
    const tarefa = TAREFAS.find((t) => t.nome === comando.task);
    if (!tarefa) throw new Error(`Este agente não tem a automação "${comando.task}". Atualize a pasta agente-vps.`);
    const logTarefa = (m) => log(`[${tarefa.nome} ig-${index}] ${m}`);
    const instancia = await driver.prepararInstancia(index, { log: logTarefa });
    const dispositivo = new Dispositivo(driver.adb, instancia.adb);
    await dispositivo.conectar();
    logTarefa("começou");
    const resultado = await tarefa.rodar({
      instancia,
      dispositivo,
      mumu: driver,
      params: comando.params && typeof comando.params === "object" ? comando.params : {},
      log: logTarefa,
    });
    logTarefa("terminou");
    return resultado ?? null;
  }
  throw new Error(`Ação desconhecida: ${comando.action}`);
}

/** Nome da conta nos logs: o rótulo da fila (@ ou nome), senão o e-mail. */
function nomeDoJob(job) {
  const conta = job.input?.conta ?? {};
  return job.label || conta.usuario || conta.email || job.id.slice(0, 8);
}

/** Quanto o agente espera o dono responder (código do e-mail, "já resolvi"). */
const ESPERA_RESPOSTA_MS = 30 * 60_000;

/**
 * Roda uma conta da fila (fluxos/), etapa por etapa, pulando as que já estão
 * concluídas em job.steps (retomada pelo botão Continuar). `reportar` recebe o
 * andamento inteiro a cada mudança; o último vale. `aguardarResposta(id, ms)`
 * devolve o que o dono respondeu na aba quando uma etapa pergunta algo.
 * `semaforos` = { ligadas, cadastro } do supervisor (null no teste local).
 */
async function rodarJob(driver, job, reportar, aguardarResposta, semaforos = null) {
  const definicao = FLUXOS[job.kind];
  const fluxo = typeof definicao === "function" ? definicao(job.input ?? {}) : definicao;
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
      // Contas VPS: @ aceito depois de recusa e conta descartada (container já apagado pelo próprio fluxo).
      ...(estado.usuario ? { usuario: estado.usuario } : {}),
      ...(estado.descartada ? { descartada: true } : {}),
      ...(estado.portal ? { portal: estado.portal } : {}),
    });

  if (!fluxo) return enviar("error", `Este agente não conhece o fluxo "${job.kind}". Atualize a pasta agente-vps.`);
  if (!driver) return enviar("error", "Docker/redroid não encontrado nesta VPS.");

  const logJob = (m) => log(`[${job.kind === "nova-conta" ? "conta" : "estruturar"} ${nomeDoJob(job)}] ${m}`);

  // Vagas do supervisor: uma de cadastro para o job inteiro e uma de "ligado" enquanto o container está de pé.
  const soltarCadastro = semaforos ? await semaforos.cadastro.pegar() : () => {};
  const soltarLigada = semaforos ? await semaforos.ligadas.pegar() : () => {};
  const watchdog = criarWatchdog(() => {
    logJob("travou: sem progresso há 1 h, desligando o container");
    if (estado.instanceIndex !== null) driver.fechar(estado.instanceIndex).catch(() => {});
  });

  /** Aparelho do container, ligado e com adb (liga de novo se alguém desligou no meio). */
  let aparelho = null;
  const dispositivo = async () => {
    if (estado.instanceIndex === null) throw new Error("O container ainda não foi criado.");
    const instancia = await driver.prepararInstancia(estado.instanceIndex, { log: logJob });
    if (!aparelho || aparelho.serial !== instancia.adb) aparelho = new Dispositivo(driver.adb, instancia.adb);
    await aparelho.conectar();
    return aparelho;
  };
  const perguntar = async (tipo, texto, { sinal } = {}) => {
    prompt = { tipo, texto };
    enviar("running");
    try {
      return await aguardarResposta(job.id, ESPERA_RESPOSTA_MS, sinal);
    } finally {
      prompt = null;
      enviar("running");
    }
  };

  // Estruturar: print da tela no fim de cada etapa (o card mostra a miniatura). Nunca derruba a etapa.
  const comPrint = job.kind === "estruturacao";
  if (comPrint) {
    try {
      limparPrintsAntigos();
    } catch {
      /* pasta de prints fora do ar: segue sem limpar */
    }
  }
  const fotografar = async (chave) => {
    if (!comPrint || estado.instanceIndex === null) return;
    try {
      const atual = await driver.instancia(estado.instanceIndex);
      if (atual?.state !== "on" || !atual.adb) return;
      salvarPrint(job.id, chave, await new Dispositivo(driver.adb, atual.adb).print());
    } catch (e) {
      logJob(`print de ${chave}: ${e.message}`);
    }
  };
  /** Etapas com `segue` que falharam (ou foram puladas por causa delas): o job continua e termina como erro. */
  const falhas = new Set();

  try {
    for (const etapa of fluxo) {
      const feita = steps.findIndex((s) => s.key === etapa.chave);
      if (feita >= 0) {
        if (!etapa.sempre) continue;
        steps.splice(feita, 1);
      }
      // Etapa bloqueada pela falha de outra (OAuth sem conta profissional, resto do alvo sem o link): registra e vai para a próxima.
      const motivo = etapa.pular?.(falhas);
      if (motivo) {
        steps.push({ key: etapa.chave, status: "error", message: String(motivo).slice(0, 300) });
        falhas.add(etapa.chave);
        logJob(`${etapa.rotulo}: ${motivo}`);
        enviar("running");
        continue;
      }
      const step = { key: etapa.chave, status: "running", message: null };
      steps.push(step);
      enviar("running");
      logJob(`${etapa.rotulo}…`);
      try {
        const mensagem = await etapa.rodar({ mumu: driver, job, input: job.input ?? {}, estado, log: logJob, dispositivo, perguntar });
        step.status = "done";
        step.message = mensagem ? String(mensagem).slice(0, 300) : null;
        watchdog.bater();
        logJob(`${etapa.rotulo}: ok${step.message ? ` (${step.message})` : ""}`);
        if (etapa.chave !== "fechar") await fotografar(etapa.chave);
        enviar("running");
      } catch (e) {
        step.status = "error";
        step.message = String(e.message).slice(0, 300);
        logJob(`${etapa.rotulo} falhou: ${e.message}`);
        await fotografar(etapa.chave);
        // Etapa independente (`segue`): a falha fica registrada e o job vai para a próxima.
        if (etapa.segue) {
          falhas.add(etapa.chave);
          watchdog.bater();
          enviar("running");
          continue;
        }
        // Conta parada = container desligado (sem Instagram aberto por aí); proxy morta também. Descartada já foi
        // apagada; código do portal vencido mantém o container ligado (e.manterContainer) à espera do código novo.
        if (estado.instanceIndex !== null && !estado.descartada && !e.manterContainer) await driver.fechar(estado.instanceIndex).catch(() => {});
        return enviar("error", e.semPrefixo ? e.message : `${etapa.rotulo}: ${e.message}`);
      }
    }
    if (falhas.size > 0) {
      logJob(`terminou com falha em: ${[...falhas].join(", ")}`);
      return enviar("error", `Etapas com falha: ${[...falhas].join(", ")}`.slice(0, 480));
    }
    logJob("terminou");
    return enviar("done");
  } finally {
    watchdog.parar();
    soltarLigada();
    soltarCadastro();
  }
}

// ── conexão com o SaaS ─────────────────────────────────────────────────────

async function rodarAgente() {
  // Token: config.json (node agente.mjs conectar) ou SCALEMASTER_AGENT_TOKEN do .env da unit (chmod 600).
  const doEnv = String(process.env.SCALEMASTER_AGENT_TOKEN ?? "").trim();
  const config = { ...(lerConfig() ?? {}), ...(TOKEN_RE.test(doEnv) ? { token: doEnv } : {}) };
  if (!config?.token) {
    console.log("Esta VPS ainda não está conectada. Gere o código na aba Contas VPS e rode:");
    console.log("  node agente.mjs conectar <código>   (ou SCALEMASTER_AGENT_TOKEN=smag_... em /opt/scalemaster/agente-vps/.env)");
    process.exit(1);
  }
  travarInstanciaUnica();

  const url = String(config.url || URL_PADRAO).replace(/\/+$/, "");
  const tarefas = TAREFAS.map((t) => ({ name: t.nome, label: t.rotulo, description: t.descricao }));
  const emAndamento = new Set();
  let resultados = [];
  const contasEmAndamento = new Set();
  const andamentos = new Map();
  const devolverAndamentos = (lista) => {
    for (const u of lista) if (!andamentos.has(u.id)) andamentos.set(u.id, u);
  };
  const esperandoResposta = new Map();
  const aguardarResposta = (id, ms, sinal) =>
    new Promise((resolve, reject) => {
      const terminar = (fim) => {
        clearTimeout(timer);
        esperandoResposta.delete(id);
        fim();
      };
      const timer = setTimeout(() => terminar(() => reject(new Error(`Ninguém respondeu em ${Math.round(ms / 60_000)} min.`))), ms);
      esperandoResposta.set(id, (resposta) => terminar(() => resolve(resposta)));
      sinal?.addEventListener("abort", () => terminar(() => resolve(null)), { once: true });
    });

  const cap = capacidade();
  const semaforos = { ligadas: new Semaforo(cap.maxLigadas), cadastro: new Semaforo(cap.maxCadastro) };
  let driver = null;
  let versaoDocker = null;
  let erroLocalizar = null;
  let proximaBusca = 0;
  let online = false;
  let midias = { root: null, files: [] };
  let proximaLeituraMidias = 0;
  let midiasEnviadas = "";
  let reenviarMidias = 0;
  let orfaosLimpos = false;
  let topRss = [];
  // Boot: pede ao SaaS os containers que ele conhece (vps_devices e fila) até limpar os órfãos velhos uma vez.
  let orfaosAntigosVistos = false;

  log(`Agente ${VERSAO} (VPS) iniciado (${os.hostname()}, ${ARCH} → ${IMAGEM}) → ${url} · ${cap.maxLigadas} ligadas / ${cap.maxCadastro} cadastros`);

  for (;;) {
    if (!driver && Date.now() >= proximaBusca) {
      try {
        driver = await Android.localizar();
        versaoDocker = await driver.versao().catch(() => null);
        erroLocalizar = null;
        log(`Docker ${versaoDocker ?? "?"} com redroid pronto`);
      } catch (e) {
        erroLocalizar = e.message;
        proximaBusca = Date.now() + 30_000;
        logSemRepetir(`VPS: ${erroLocalizar}`);
      }
    }
    // Boot do agente: container de conta ligado sem conta em andamento é órfão (o agente caiu no meio).
    if (driver && !orfaosLimpos) {
      orfaosLimpos = true;
      await limparOrfaos((i) => driver.fechar(i), log).catch((e) => log(`órfãos: ${e.message}`));
    }

    let erroDriver = driver ? null : erroLocalizar;
    let instancias = [];
    if (driver) {
      try {
        instancias = await driver.instancias();
      } catch (e) {
        erroDriver = e.message;
        logSemRepetir(`VPS: ${erroDriver}`);
      }
    }

    if (Date.now() >= proximaLeituraMidias) {
      proximaLeituraMidias = Date.now() + 30_000;
      const raiz = await pastaDeMidias().catch(() => null);
      midias = { root: raiz, files: raiz ? listarMidias(raiz) : [] };
      // Mesmo ritmo das mídias: os 5 processos com mais RAM (o card do agente mostra).
      topRss = await maioresConsumidores().catch(() => topRss);
    }
    const textoMidias = JSON.stringify(midias);
    const mandarMidias = textoMidias !== midiasEnviadas || Date.now() >= reenviarMidias;

    const agora = capacidade();
    const ligadas = instancias.filter((i) => i.state !== "off").length;
    const enviando = resultados;
    resultados = [];
    const enviandoAndamentos = [...andamentos.values()];
    const macsEnviando = driver ? [...driver.macsAprendidos].map(([jobId, mac]) => ({ jobId, mac })) : [];
    andamentos.clear();
    const corpo = {
      agentKind: AGENT_KIND,
      agentVersion: VERSAO,
      hostname: os.hostname(),
      mumuVersion: versaoDocker,
      mumuError: erroDriver,
      instances: instancias.map(({ index, name, state, criada }) => ({ index, name, state, criada, alert: alertaDe(criada) })),
      tasks: tarefas,
      // HOST_TESTE=1 no .env do agente: o SaaS troca o bloqueio de RAM do lote por um aviso.
      capacity: { ...agora, ligadas, versoesIg: versoesDisponiveis(), topRss, hostTeste: process.env.HOST_TESTE === "1" },
      results: enviando,
      running: [...emAndamento],
      jobUpdates: enviandoAndamentos,
      runningJobs: [...contasEmAndamento],
      ...(orfaosAntigosVistos ? {} : { querConhecidos: true }),
      ...(macsEnviando.length ? { macs: macsEnviando } : {}),
      ...(mandarMidias ? { media: midias } : {}),
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
        logSemRepetir(`Código recusado pelo SaaS: ${resposta.error ?? "401"}. Gere outro na aba Contas VPS e rode "node agente.mjs conectar <código>".`);
      } else if (!res.ok) {
        resultados = [...enviando, ...resultados];
        devolverAndamentos(enviandoAndamentos);
        espera = res.status === 503 ? ESPERA_SQL_MS : ESPERA_SEM_REDE_MS;
        logSemRepetir(`SaaS respondeu ${res.status}: ${resposta.error ?? "sem mensagem"}`);
      } else {
        // MAC entregue ao SaaS: sai da fila (o retrato já guarda o MAC).
        for (const { jobId, mac } of macsEnviando) if (driver?.macsAprendidos.get(jobId) === mac) driver.macsAprendidos.delete(jobId);
        if (mandarMidias) {
          midiasEnviadas = textoMidias;
          reenviarMidias = Date.now() + 5 * 60_000;
        }
        if (!online) {
          online = true;
          ultimaLinha = "";
          log(`Conectado ao SaaS. ${instancias.length} container(s) de conta.`);
        }
        if (!orfaosAntigosVistos && driver && Array.isArray(resposta.conhecidos)) {
          orfaosAntigosVistos = true;
          // Sem job ativo = nem rodando aqui, nem chegando neste mesmo sync.
          const ativos = new Set((Array.isArray(resposta.jobs) ? resposta.jobs : []).map((j) => `ig-${j?.instanceIndex ?? j?.input?.device?.index}`));
          limparOrfaosAntigos({ conhecidos: new Set(resposta.conhecidos.map(String)), ativos, log }).catch((e) => log(`órfãos antigos: ${e.message}`));
        }
        for (const comando of Array.isArray(resposta.commands) ? resposta.commands : []) {
          if (typeof comando?.id !== "string" || emAndamento.has(comando.id)) continue;
          emAndamento.add(comando.id);
          log(`Comando: ${comando.action}${comando.task ? ` ${comando.task}` : ""} no container #${comando.instanceIndex}`);
          naFilaDaInstancia(comando.instanceIndex, async () => {
            try {
              if (!driver) throw new Error(erroDriver ?? "Docker/redroid não encontrado.");
              const resultado = await executar(driver, comando);
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
          log(job.kind !== "nova-conta" ? `Estruturação na fila: ${nomeDoJob(job)} (ig-${job.instanceIndex})` : `Conta na fila: ${nomeDoJob(job)} (lote, ig-${job.input?.device?.index ?? "?"})`);
          rodarJob(driver, job, (u) => andamentos.set(u.id, u), aguardarResposta, semaforos)
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
    console.log("Código inválido. Ele começa com smag_ e aparece ao clicar em Conectar uma VPS na aba Contas VPS.");
    process.exit(1);
  }
  const iUrl = args.indexOf("--url");
  const url = iUrl >= 0 ? args[iUrl + 1] : lerConfig()?.url;
  const anterior = lerConfig() ?? {};
  writeFileSync(ARQ_CONFIG, `${JSON.stringify({ ...anterior, url: url || URL_PADRAO, token }, null, 2)}\n`, { mode: 0o600 });
  console.log("Código salvo em config.json.");
}

function indice(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) {
    console.log("Informe o índice do container (veja com: node agente.mjs instancias).");
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
    try {
      unlinkSync(ARQ_PID);
    } catch {
      /* já foi */
    }
    return console.log(`Agente parado (PID ${pid}).`);
  }
  if (cmd === "capacidade") return console.log(JSON.stringify({ ...capacidade(), imagem: IMAGEM, versoesIg: versoesDisponiveis() }, null, 2));
  if (cmd === "proxy") {
    const geo = await validar(args[1], args[2]);
    return console.log(`proxy ok: ${geo.ip} (${geo.pais}, ${geo.timezone})`);
  }

  const driver = await Android.localizar();
  if (cmd === "instancias") {
    console.log(`Docker ${await driver.versao()}`);
    console.table(await driver.instancias());
    return;
  }
  if (cmd === "abrir" || cmd === "fechar") {
    const index = indice(args[1]);
    await executar(driver, { action: cmd === "abrir" ? "launch" : "shutdown", instanceIndex: index });
    return console.log(`Container ig-${index}: ${cmd === "abrir" ? "ligado" : "desligado"}.`);
  }
  if (cmd === "excluir") {
    const index = indice(args[1]);
    const { name, criada } = await driver.instancia(index);
    await executar(driver, { action: "delete", instanceIndex: index, params: { nome: name, criada } });
    return console.log(`Container ig-${index} (${name}) apagado.`);
  }
  if (cmd === "nova-conta") {
    // Teste local: node agente.mjs nova-conta [arquivo.json com { proxy, pais, versaoIg, conta, imap, device? }]
    const input = args[1] ? JSON.parse(readFileSync(args[1], "utf8")) : { proxy: "", conta: {} };
    const job = { id: randomUUID(), kind: "nova-conta", templateIndex: 0, instanceIndex: null, steps: [], input };
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let ultimo = null;
    await rodarJob(
      driver,
      job,
      (u) => {
        ultimo = u;
        if (u.prompt) console.log(`>>> ${u.prompt.texto}`);
      },
      (_id, _ms, sinal) =>
        new Promise((resolve) => {
          rl.question("resposta: ", resolve);
          sinal?.addEventListener("abort", () => resolve(null), { once: true });
        })
    );
    rl.close();
    return console.log(JSON.stringify(ultimo, null, 2));
  }
  if (cmd === "tarefa") {
    const resultado = await executar(driver, { action: "task", task: args[1], instanceIndex: args[2] === undefined ? PC_INDEX : indice(args[2]) });
    return console.log(JSON.stringify(resultado, null, 2));
  }

  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
}

main(process.argv.slice(2)).catch((e) => {
  log(`Erro: ${e.message}`);
  process.exit(1);
});
