import { describe, it, expect } from "vitest";
import { ALERTA_ROBO, ALERTA_TELEFONE } from "../lib/emulador/jobs";
import { VPS_FLUXO } from "../lib/vps/jobs";
import { LOG_MAX, ROTULO_CAPTCHA, acrescentarLog, contadoresDoLote, diferencasDeLog, loteAtual, mascararProxy, proxiesDoLote, retratar, rotuloAlerta } from "../lib/vps/painel";
import type { VpsJob } from "../lib/vps/types";

const ORPHAN = "O agente parou no meio (fechou ou reiniciou). Clique em Continuar.";
const ROTULOS = new Map(VPS_FLUXO.map((s) => [s.key, s.label]));

let seq = 0;
const job = (extra: Partial<VpsJob>): VpsJob => ({
  id: `job-${++seq}`,
  agentId: "a",
  kind: "nova-conta",
  acoes: [],
  label: `conta${seq}`,
  templateIndex: 0,
  instanceIndex: seq,
  steps: [],
  status: "queued",
  error: null,
  prompt: null,
  createdAt: `2026-11-08T10:00:${String(seq).padStart(2, "0")}Z`,
  updatedAt: "2026-11-08T10:00:00Z",
  loteId: "lote-1",
  pausa: null,
  versaoIg: "454.0.0.54.77",
  proxyHost: null,
  ...extra,
});

describe("Painel da rodada: contadores e lote ativo", () => {
  it("conta queued, running, done e error do lote", () => {
    const jobs = [job({ status: "queued" }), job({ status: "running" }), job({ status: "running" }), job({ status: "done" }), job({ status: "error" })];
    expect(contadoresDoLote(jobs)).toEqual({ queued: 1, running: 2, done: 1, error: 1 });
    expect(contadoresDoLote([])).toEqual({ queued: 0, running: 0, done: 0, error: 0 });
  });

  it("rodada atual = lote mais recente com conta na fila ou rodando, com todas as contas dele", () => {
    const antigo = [job({ loteId: "lote-a", status: "done", createdAt: "2026-11-08T08:00:00Z" }), job({ loteId: "lote-a", status: "error", createdAt: "2026-11-08T08:00:01Z" })];
    const meio = [job({ loteId: "lote-b", status: "running", createdAt: "2026-11-08T09:00:00Z" }), job({ loteId: "lote-b", status: "done", createdAt: "2026-11-08T09:00:01Z" })];
    const novo = [job({ loteId: "lote-c", status: "queued", createdAt: "2026-11-08T10:00:00Z" }), job({ loteId: "lote-c", status: "error", createdAt: "2026-11-08T10:00:01Z" })];
    const lote = loteAtual([...antigo, ...meio, ...novo]);
    expect(lote?.loteId).toBe("lote-c");
    expect(lote?.jobs.map((j) => j.status)).toEqual(["queued", "error"]);
    // Só o lote-b tem conta pendente: é ele, mesmo havendo lote mais novo já terminado.
    const soMeio = loteAtual([...antigo, ...meio, ...novo.map((j) => ({ ...j, status: "done" as const }))]);
    expect(soMeio?.loteId).toBe("lote-b");
  });

  it("sem lote ativo o painel fica oculto (null); conta sem lote_id não conta", () => {
    expect(loteAtual([])).toBeNull();
    expect(loteAtual([job({ status: "done" }), job({ status: "error" })])).toBeNull();
    expect(loteAtual([job({ loteId: null, status: "running" })])).toBeNull();
  });

  it("proxies distintas do lote com o IP mascarado; hostname fica inteiro", () => {
    expect(mascararProxy("45.181.53.233:10000")).toBe("45.181.x.x:10000");
    expect(mascararProxy("10.0.0.1")).toBe("10.0.x.x");
    expect(mascararProxy("sv2.gmproxys.com:10000")).toBe("sv2.gmproxys.com:10000");
    expect(mascararProxy(null)).toBeNull();
    expect(mascararProxy("")).toBeNull();
    const jobs = [job({ proxyHost: "45.181.53.233:10000" }), job({ proxyHost: "45.181.53.233:10000" }), job({ proxyHost: "sv2.gmproxys.com:10000" }), job({ proxyHost: null })];
    expect(proxiesDoLote(jobs)).toEqual(["45.181.x.x:10000", "sv2.gmproxys.com:10000"]);
  });
});

describe("Painel da rodada: log", () => {
  const agora = new Date("2026-11-08T12:34:56Z");

  it("primeira leitura registra só o que está rodando ou errado; depois só o que mudou", () => {
    const a = job({ label: "maria", status: "running", steps: [{ key: "copiar", status: "done", message: "ok" }, { key: "geo", status: "running", message: null }] });
    const primeiras = diferencasDeLog(null, [a], agora, ROTULOS);
    expect(primeiras).toHaveLength(1);
    expect(primeiras[0]).toMatchObject({ conta: "maria", etapa: "Validar a proxy e o país", mensagem: "…", erro: false });
    expect(primeiras[0].hora).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    const retrato = retratar([a]);
    const b = { ...a, steps: [{ key: "copiar", status: "done" as const, message: "ok" }, { key: "geo", status: "done" as const, message: "177.37.208.148 (BR)" }, { key: "nome", status: "running" as const, message: null }] };
    const depois = diferencasDeLog(retrato, [b], agora, ROTULOS);
    expect(depois.map((l) => `${l.etapa} · ${l.mensagem}`)).toEqual(["Validar a proxy e o país · ok · 177.37.208.148 (BR)", "Dar o nome da conta ao container · …"]);
    // Nada mudou: nenhuma linha.
    expect(diferencasDeLog(retratar([b]), [b], agora, ROTULOS)).toEqual([]);
  });

  it("erro de etapa, aviso da conta e pedido ao dono viram linhas (erro em vermelho)", () => {
    const a = job({ label: "ana", status: "running", steps: [{ key: "email", status: "running", message: null }] });
    const retrato = retratar([a]);
    const b = { ...a, status: "error" as const, error: ALERTA_ROBO, steps: [{ key: "email", status: "done" as const, message: "portal ok" }, { key: "cadastro", status: "error" as const, message: "Confirme que você não é um robô" }] };
    const linhas = diferencasDeLog(retrato, [b], agora, ROTULOS);
    expect(linhas.map((l) => [l.etapa, l.mensagem, l.erro])).toEqual([
      ["Conferir a caixa de e-mail", "ok · portal ok", false],
      ["Criar a conta no Instagram", "Confirme que você não é um robô", true],
      ["conta", ROTULO_CAPTCHA, true],
    ]);
    const c = { ...a, prompt: { tipo: "codigo" as const, texto: "Digite o código." } };
    expect(diferencasDeLog(retrato, [c], agora, ROTULOS).map((l) => [l.etapa, l.mensagem])).toEqual([["esperando você", "Digite o código."]]);
    const d = { ...a, status: "done" as const, steps: [{ key: "email", status: "done" as const, message: null }] };
    expect(diferencasDeLog(retrato, [d], agora, ROTULOS).map((l) => l.mensagem)).toEqual(["ok", "Conta criada"]);
  });

  it("escopo por lote: só as contas do lote ativo entram no log", () => {
    const foraDoLote = job({ loteId: "outro", status: "running", steps: [{ key: "geo", status: "running", message: null }] });
    const doLote = job({ loteId: "lote-1", status: "queued", steps: [] });
    const lote = loteAtual([foraDoLote, doLote]);
    expect(lote?.loteId).toBe("lote-1");
    expect(diferencasDeLog(null, lote!.jobs, agora, ROTULOS)).toEqual([]);
  });

  it("limite de 300 linhas em memória", () => {
    const muitas = Array.from({ length: 290 }, (_, i) => ({ id: `l${i}`, hora: "00:00:00", conta: "x", etapa: "e", mensagem: "m", erro: false }));
    const novas = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, hora: "00:00:00", conta: "x", etapa: "e", mensagem: "m", erro: false }));
    const junto = acrescentarLog(muitas, novas);
    expect(junto).toHaveLength(LOG_MAX);
    expect(junto[0].id).toBe("l10");
    expect(junto[junto.length - 1].id).toBe("n19");
    expect(acrescentarLog(muitas, [])).toHaveLength(290);
  });
});

describe("Aviso de captcha", () => {
  it("tem texto próprio, distinto do genérico de agente parado e do telefone", () => {
    expect(rotuloAlerta(ALERTA_ROBO)).toBe("Captcha: confirme que você é uma pessoa");
    expect(rotuloAlerta(ALERTA_ROBO)).not.toBe(ORPHAN);
    expect(rotuloAlerta(ALERTA_ROBO)).not.toBe(rotuloAlerta(ALERTA_TELEFONE));
    expect(rotuloAlerta(ORPHAN)).toBe(ORPHAN);
    expect(rotuloAlerta(null)).toBeNull();
  });
});
