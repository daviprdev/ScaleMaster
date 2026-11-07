import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAgentKind, parseInstances } from "../lib/emulador/payload";
import { loadEmulador } from "../lib/emulador/load";
import { resolver } from "../agente-vps/lib/captcha.mjs";

// Pasta temporária para os retratos (SCALEMASTER_VPS_DIR) antes de carregar o driver.
const PASTA = mkdtempSync(path.join(os.tmpdir(), "sm-vps-"));
process.env.SCALEMASTER_VPS_DIR = PASTA;

/** Containers que o "docker" de mentira conhece: nome → campos do inspect do driver. */
const containers = new Map<string, { status: string; criada: string; nome: string; job: string; volume: string; mac: string }>();

vi.mock("../agente-vps/lib/processo.mjs", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    rodar: async (arquivo: string, args: string[]) => {
      if (arquivo === "docker" && args[0] === "inspect") {
        const nome = args[args.length - 1];
        const c = containers.get(nome);
        if (!c) return { codigo: 1, estourou: false, stdout: "", stderr: `No such object: ${nome}` };
        if (String(args[2]).includes(".State.Running")) return { codigo: 0, estourou: false, stdout: c.status === "running" ? "true" : "false", stderr: "" };
        return { codigo: 0, estourou: false, stdout: `${c.status}|${c.criada}|${c.nome}|${c.job}|${c.volume}|${c.mac}\n`, stderr: "" };
      }
      if (arquivo === "docker" && args[0] === "ps") {
        return { codigo: 0, estourou: false, stdout: `${[...containers.keys()].join("\n")}\n`, stderr: "" };
      }
      return { codigo: 0, estourou: false, stdout: "", stderr: "" };
    },
  };
});

const android = await import("../agente-vps/lib/android.mjs");

beforeAll(() => mkdirSync(path.join(PASTA, "instancias"), { recursive: true }));
afterAll(() => rmSync(PASTA, { recursive: true, force: true }));

describe("Identidade do container (android.mjs)", () => {
  it("nome resolvido: retrato → label scalemaster.nome → Instância N", () => {
    expect(android.resolverNome(3, { nome: "maria" }, { nomeLabel: "outra" })).toBe("maria");
    expect(android.resolverNome(3, null, { nomeLabel: "da-label" })).toBe("da-label");
    expect(android.resolverNome(3, { nome: "" }, { nomeLabel: "" })).toBe("Instância 3");
    expect(android.resolverNome(7, null, null)).toBe("Instância 7");
  });

  it("reconstrói o retrato que falta a partir das labels e lê o nome por fallback", async () => {
    containers.clear();
    containers.set("ig-3", { status: "exited", criada: "2026-11-07T01:00:00.000000000Z", nome: "maria", job: "job-3", volume: "scalemaster-ig-3", mac: "3c:11:22:33:44:55" });
    containers.set("ig-4", { status: "exited", criada: "2026-11-07T02:00:00.000000000Z", nome: "", job: "job-4", volume: "scalemaster-ig-4", mac: "3c:11:22:33:44:66" });
    writeFileSync(path.join(PASTA, "instancias", "ig-4.json"), "{ corrompido", "utf8");
    const driver = new android.Android();
    const refeitos = await driver.reconstruir();
    expect(refeitos).toEqual([3, 4]);
    const spec3 = JSON.parse(readFileSync(path.join(PASTA, "instancias", "ig-3.json"), "utf8"));
    expect(spec3.nome).toBe("maria");
    expect(spec3.jobId).toBe("job-3");
    expect(spec3.volume).toBe("scalemaster-ig-3");
    expect(spec3.reconstruido).toBe(true);
    const i3 = await driver.instancia(3);
    expect(i3.name).toBe("maria");
    expect(i3.criada).toBe("2026-11-07T01:00:00.000000000Z");
    const i4 = await driver.instancia(4);
    expect(i4.name).toBe("Instância 4");
  });

  it("excluir recusa quando o Created ou o nome não batem, dizendo qual divergiu", async () => {
    const driver = new android.Android();
    await expect(driver.excluir(3, { nome: "maria", criada: "2020-01-01T00:00:00Z" })).rejects.toThrow(/criado em 2026-11-07T01:00:00.000000000Z, a aba esperava 2020-01-01T00:00:00Z/);
    await expect(driver.excluir(3, { nome: "joao", criada: "2026-11-07T01:00:00.000000000Z" })).rejects.toThrow(/agora se chama "maria", a aba esperava "joao"/);
    expect(JSON.parse(readFileSync(path.join(PASTA, "instancias", "ig-3.json"), "utf8")).nome).toBe("maria");
  });

  it("retrato é gravado por rename atômico (sem .tmp sobrando)", async () => {
    const driver = new android.Android();
    await driver.renomear(3, "maria.nova");
    expect(JSON.parse(readFileSync(path.join(PASTA, "instancias", "ig-3.json"), "utf8")).nome).toBe("maria.nova");
    expect(() => readFileSync(path.join(PASTA, "instancias", "ig-3.json.tmp"))).toThrow();
  });
});

describe("Captcha (captcha.mjs) nunca lança", () => {
  const png = Buffer.from("png");
  const resposta = (texto: string) => ({ text: async () => texto }) as unknown as Response;

  it("sem chave → null", async () => {
    expect(await resolver(png, { chave: null })).toBeNull();
  });

  it("tipo desconhecido / recusa → null, com uma retentativa", async () => {
    let chamadas = 0;
    const fetchImpl = async () => {
      chamadas += 1;
      return resposta("ERROR_WRONG_FILE_EXTENSION");
    };
    expect(await resolver(png, { chave: "k", fetchImpl, pausaMs: 1 })).toBeNull();
    expect(chamadas).toBe(2);
    const estranho = async (url: string) => resposta(url.includes("in.php") ? "OK|123" : "OK|texto-que-nao-e-coordenada");
    expect(await resolver(png, { chave: "k", fetchImpl: estranho, pausaMs: 1 })).toBeNull();
  });

  it("timeout e erro de rede → null", async () => {
    const semResposta = async (url: string) => resposta(url.includes("in.php") ? "OK|123" : "CAPCHA_NOT_READY");
    expect(await resolver(png, { chave: "k", fetchImpl: semResposta, timeoutMs: 30, pausaMs: 5 })).toBeNull();
    const quebrado = async () => {
      throw new Error("rede caiu");
    };
    expect(await resolver(png, { chave: "k", fetchImpl: quebrado, pausaMs: 1 })).toBeNull();
    const ok = async (url: string) => resposta(url.includes("in.php") ? "OK|9" : "OK|coordinates:x=10,y=20");
    expect(await resolver(png, { chave: "k", fetchImpl: ok, pausaMs: 1 })).toEqual([{ x: 10, y: 20 }]);
  });
});

describe("Produção antes do SQL da VPS", () => {
  it("parseAgentKind: inválido vira mumu", () => {
    expect(parseAgentKind("vps")).toBe("vps");
    expect(parseAgentKind("mumu")).toBe("mumu");
    expect(parseAgentKind(undefined)).toBe("mumu");
    expect(parseAgentKind("outro")).toBe("mumu");
    expect(parseAgentKind(42)).toBe("mumu");
  });

  it("parseInstances guarda o criada do agente da VPS", () => {
    const [i] = parseInstances([{ index: 2, name: "x", state: "off", criada: "2026-11-07T01:00:00Z" }]);
    expect(i.criada).toBe("2026-11-07T01:00:00Z");
    expect("criada" in parseInstances([{ index: 2, name: "x", state: "off" }])[0]).toBe(false);
  });

  it("loadEmulador sem a coluna kind: lê todos os agentes e marca vpsAvailable=false", async () => {
    const agentes = [
      { id: "a1", hostname: "pc", agent_version: "1", mumu_version: null, mumu_error: null, instances: [], tasks: [], media: {}, last_seen_at: null, created_at: "2026-11-01T00:00:00Z" },
      { id: "a2", hostname: "vps", agent_version: "1", mumu_version: null, mumu_error: null, instances: [], tasks: [], media: {}, last_seen_at: null, created_at: "2026-11-02T00:00:00Z" },
    ];
    const resposta = (table: string, columns: string) => {
      if (table === "emulator_agents" && /\bkind\b/.test(columns)) return { data: null, error: { code: "42703", message: "column emulator_agents.kind does not exist" } };
      if (table === "emulator_agents") return { data: agentes, error: null };
      if (table === "emulator_commands") return { data: [], error: null };
      if (table === "emulator_jobs") return { data: [], error: null };
      return { data: [], error: null };
    };
    const admin = {
      from(table: string) {
        let columns = "";
        const builder: Record<string, unknown> = {};
        for (const m of ["eq", "in", "gte", "order", "limit", "not", "neq"]) builder[m] = () => builder;
        builder.select = (c: string) => {
          columns = c;
          return builder;
        };
        builder.then = (resolve: (v: unknown) => void) => resolve(resposta(table, columns));
        return builder;
      },
    };
    const r = await loadEmulador(admin as never, "user-1");
    expect(r.available).toBe(true);
    expect(r.vpsAvailable).toBe(false);
    expect(r.agents.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(r.jobsAvailable).toBe(true);
  });
});
