import { describe, it, expect } from "vitest";
import {
  AGENT_ONLINE_MS,
  isOnline,
  parseInstances,
  parseResults,
  parseRunning,
  parseTasks,
  shortText,
} from "../lib/emulador/payload";
import { activeText, latestCommandByInstance, resultPairs, timeAgo } from "../lib/emulador/view";
import { agentTokenFromRequest, hashAgentToken, newAgentToken } from "../lib/emulador/token";
import type { EmulatorCommand } from "../lib/emulador/types";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function cmd(partial: Partial<EmulatorCommand>): EmulatorCommand {
  return {
    id: UUID_A,
    agentId: "ag",
    instanceIndex: 0,
    action: "launch",
    task: null,
    status: "done",
    error: null,
    result: null,
    createdAt: "2026-11-01T12:00:00Z",
    finishedAt: null,
    ...partial,
  };
}

describe("payload do agente", () => {
  it("lê instâncias: índice em texto, sem repetidas, estado desconhecido vira off, em ordem", () => {
    const out = parseInstances([
      { index: "2", name: "Conta B", state: "on" },
      { index: 0, name: "  Conta A ", state: "starting" },
      { index: 2, name: "duplicada", state: "off" },
      { index: -1, name: "negativa" },
      { index: 1.5, name: "quebrada" },
      { index: 3, name: "", state: "voando" },
      "lixo",
    ]);
    expect(out).toEqual([
      { index: 0, name: "Conta A", state: "starting" },
      { index: 2, name: "Conta B", state: "on" },
      { index: 3, name: "Instância 3", state: "off" },
    ]);
  });

  it("não aceita lista que não é lista", () => {
    expect(parseInstances({ 0: { index: 0 } })).toEqual([]);
    expect(parseTasks("teste")).toEqual([]);
    expect(parseResults(null)).toEqual([]);
    expect(parseRunning(undefined)).toEqual([]);
  });

  it("lê automações só com nome válido e sem repetir", () => {
    const out = parseTasks([
      { name: "teste-adb", label: "Testar automação", description: "Lê o aparelho" },
      { name: "Teste Maiusculo", label: "x" },
      { name: "teste-adb", label: "de novo" },
      { name: "sem-rotulo" },
    ]);
    expect(out).toEqual([
      { name: "teste-adb", label: "Testar automação", description: "Lê o aparelho" },
      { name: "sem-rotulo", label: "sem-rotulo", description: null },
    ]);
  });

  it("lê resultados: só id uuid e status final; erro sem mensagem ganha uma", () => {
    const out = parseResults([
      { id: UUID_A, status: "done", result: { android: "15" } },
      { id: UUID_B, status: "error" },
      { id: "nao-e-uuid", status: "done" },
      { id: UUID_A, status: "running" },
    ]);
    expect(out).toEqual([
      { id: UUID_A, status: "done", error: null, result: { android: "15" } },
      { id: UUID_B, status: "error", error: "Erro sem mensagem.", result: null },
    ]);
  });

  it("resultado grande demais vira aviso", () => {
    const [r] = parseResults([{ id: UUID_A, status: "done", result: { texto: "x".repeat(30_000) } }]);
    expect(r.result).toEqual({ aviso: "Resultado grande demais para guardar." });
  });

  it("running aceita só uuids", () => {
    expect(parseRunning([UUID_A, 3, "abc", UUID_B])).toEqual([UUID_A, UUID_B]);
  });

  it("shortText corta e descarta vazio", () => {
    expect(shortText("  abc  ", 2)).toBe("ab");
    expect(shortText("   ", 10)).toBeNull();
    expect(shortText(5, 10)).toBeNull();
  });

  it("online até AGENT_ONLINE_MS depois do último sync", () => {
    const now = Date.parse("2026-11-01T12:00:30Z");
    expect(isOnline(new Date(now - AGENT_ONLINE_MS + 1000).toISOString(), now)).toBe(true);
    expect(isOnline(new Date(now - AGENT_ONLINE_MS - 1000).toISOString(), now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
});

describe("código do agente", () => {
  it("gera smag_ + 43 caracteres e o header aceita só esse formato", () => {
    const token = newAgentToken();
    expect(token).toMatch(/^smag_[A-Za-z0-9_-]{43}$/);
    const ok = new Request("https://x", { headers: { authorization: `Bearer ${token}` } });
    expect(agentTokenFromRequest(ok)).toBe(token);
    const ruim = new Request("https://x", { headers: { authorization: `Bearer ${token}x` } });
    expect(agentTokenFromRequest(ruim)).toBeNull();
    expect(agentTokenFromRequest(new Request("https://x"))).toBeNull();
  });

  it("hash é sha256 hex e não devolve o código", () => {
    const token = newAgentToken();
    expect(hashAgentToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAgentToken(token)).not.toContain(token);
  });
});

describe("tela do emulador", () => {
  it("pega o comando mais novo de cada instância", () => {
    const novo = cmd({ id: UUID_B, status: "running" });
    const velho = cmd({ id: UUID_A, status: "done" });
    const outra = cmd({ id: UUID_A, instanceIndex: 1 });
    const map = latestCommandByInstance([novo, velho, outra]);
    expect(map.get("ag:0")).toBe(novo);
    expect(map.get("ag:1")).toBe(outra);
  });

  it("texto do comando em andamento", () => {
    const tasks = [{ name: "teste-adb", label: "Testar automação", description: null }];
    expect(activeText(cmd({ status: "queued" }), tasks)).toBe("Enviando para o PC…");
    expect(activeText(cmd({ status: "running", action: "launch" }), tasks)).toBe("Abrindo…");
    expect(activeText(cmd({ status: "running", action: "shutdown" }), tasks)).toBe("Fechando…");
    expect(activeText(cmd({ status: "running", action: "task", task: "teste-adb" }), tasks)).toBe("Rodando Testar automação…");
  });

  it("timeAgo", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(timeAgo(null, now)).toBe("nunca");
    expect(timeAgo("2026-11-01T11:59:58Z", now)).toBe("agora");
    expect(timeAgo("2026-11-01T11:59:20Z", now)).toBe("há 40 s");
    expect(timeAgo("2026-11-01T11:55:00Z", now)).toBe("há 5 min");
    expect(timeAgo("2026-11-01T09:00:00Z", now)).toBe("há 3 h");
  });

  it("resultPairs mostra só valores simples", () => {
    expect(resultPairs({ android: "15", ok: true, n: 3, lista: [1], obj: {} })).toEqual([
      ["android", "15"],
      ["ok", "true"],
      ["n", "3"],
    ]);
    expect(resultPairs(null)).toEqual([]);
    expect(resultPairs([1, 2])).toEqual([]);
  });
});
