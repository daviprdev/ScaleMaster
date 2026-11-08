import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseAgentKind, parseCriada, parseInstances } from "../lib/emulador/payload";
import { loadEmulador } from "../lib/emulador/load";
import { syncJobs } from "../lib/emulador/sync-jobs";
import { UID_REDSOCKS, scriptSidecar } from "../agente-vps/lib/rede.mjs";
import { resolver } from "../agente-vps/lib/captcha.mjs";

// Pasta temporária para os retratos (SCALEMASTER_VPS_DIR) antes de carregar o driver.
const PASTA = mkdtempSync(path.join(os.tmpdir(), "sm-vps-"));
process.env.SCALEMASTER_VPS_DIR = PASTA;
// Sessões: os testes passam a pasta temporária direto para exportarSessao (a env var é só override do padrão /opt).
const SESSOES = path.join(PASTA, "sessoes");

/** Containers que o "docker" de mentira conhece: nome → campos do inspect do driver. */
const containers = new Map<string, { status: string; criada: string; nome: string; job: string; volume: string; mac: string }>();
/** Respostas do "adb" de mentira, trocadas por cada teste. */
let adbMock: (args: string[]) => { codigo: number; estourou?: boolean; stdout: string; stderr?: string } = () => ({ codigo: 0, stdout: "" });

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
      if (arquivo === "adb") {
        const r = adbMock(args);
        return { estourou: false, stderr: "", ...r };
      }
      return { codigo: 0, estourou: false, stdout: "", stderr: "" };
    },
  };
});

const android = await import("../agente-vps/lib/android.mjs");
const { exportarSessao, shellComoRoot } = await import("../agente-vps/fluxos/nova-conta.mjs");

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

  it("reconstruir grava 'Instância N' no container sem JSON nem label", () => {
    const spec4 = JSON.parse(readFileSync(path.join(PASTA, "instancias", "ig-4.json"), "utf8"));
    expect(spec4.nome).toBe("Instância 4");
    expect(spec4.criada).toBe("2026-11-07T02:00:00.000000000Z");
  });

  it("excluir recusa quando o Created (docker_created) ou o nome não batem, dizendo qual divergiu", async () => {
    const driver = new android.Android();
    await expect(driver.excluir(3, { nome: "maria", criada: "2020-01-01T00:00:00Z" })).rejects.toThrow(/criado em 2026-11-07T01:00:00.000000000Z, o banco tem 2020-01-01T00:00:00Z/);
    await expect(driver.excluir(3, { nome: "joao", criada: "2026-11-07T01:00:00.000000000Z" })).rejects.toThrow(/agora se chama "maria", a aba esperava "joao"/);
    expect(JSON.parse(readFileSync(path.join(PASTA, "instancias", "ig-3.json"), "utf8")).nome).toBe("maria");
  });

  it("excluir sem docker_created aceita pelo inspect (logando), e 'Instância N' com o Created batendo", async () => {
    containers.set("ig-5", { status: "exited", criada: "2026-11-07T05:00:00.000000000Z", nome: "", job: "job-5", volume: "scalemaster-ig-5", mac: "3c:00:00:00:00:05" });
    containers.set("ig-6", { status: "exited", criada: "2026-11-07T06:00:00.000000000Z", nome: "", job: "job-6", volume: "scalemaster-ig-6", mac: "3c:00:00:00:00:06" });
    const driver = new android.Android();
    await driver.reconstruir();
    const logs: string[] = [];
    await driver.excluir(5, { log: (m: string) => logs.push(m), nome: "Instância 5" });
    expect(logs.some((l) => /docker_created ausente/.test(l))).toBe(true);
    expect(() => readFileSync(path.join(PASTA, "instancias", "ig-5.json"))).toThrow();
    // Created ao vivo bate com o banco: o nome genérico é só rótulo.
    await driver.excluir(6, { nome: "Instância 6", criada: "2026-11-07T06:00:00.000000000Z" });
    expect(() => readFileSync(path.join(PASTA, "instancias", "ig-6.json"))).toThrow();
  });

  it("excluir com Created divergente recusa mesmo com o nome igual", async () => {
    containers.set("ig-7", { status: "exited", criada: "2026-11-07T07:00:00.000000000Z", nome: "ana", job: "job-7", volume: "scalemaster-ig-7", mac: "3c:00:00:00:00:07" });
    const driver = new android.Android();
    await driver.reconstruir();
    await expect(driver.excluir(7, { nome: "ana", criada: "2026-11-07T07:00:01.000000000Z" })).rejects.toThrow(/não é o mesmo/);
    await expect(driver.excluir(7, { nome: "Instância 7", criada: "2026-11-07T07:00:01.000000000Z" })).rejects.toThrow(/não é o mesmo/);
    expect(JSON.parse(readFileSync(path.join(PASTA, "instancias", "ig-7.json"), "utf8")).nome).toBe("ana");
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

describe("Sessão exportada (nova-conta.mjs)", () => {
  const fakeD = (shell: (args: string[]) => Promise<string>, puxar: (remoto: string, local: string) => Promise<void> = async () => {}) => ({
    adb: "adb",
    serial: "127.0.0.1:6003",
    shell: (...args: string[]) => shell(args),
    puxar,
    conectar: async () => {},
  });

  it("'adbd is already running as root' é sucesso", async () => {
    adbMock = (args) => (args.includes("root") ? { codigo: 1, stdout: "adbd is already running as root" } : { codigo: 0, stdout: "" });
    expect(await shellComoRoot(fakeD(async () => "") as never)).toEqual([]);
  });

  it("serial que não volta em 20 s cai para su 0", async () => {
    adbMock = (args) => (args.includes("wait-for-device") ? { codigo: -1, estourou: true, stdout: "" } : { codigo: 0, stdout: "restarting adbd as root" });
    expect(await shellComoRoot(fakeD(async () => "") as never)).toEqual(["su", "0"]);
  });

  it("tar de 0 byte (ou com erro) é falha da etapa; só o pull que falha vira 'sessão não exportada'", async () => {
    adbMock = () => ({ codigo: 0, stdout: "" });
    const vazio = fakeD(async (args) => (args.includes("stat") ? "0\n" : ""));
    await expect(exportarSessao(vazio as never, "job-x", undefined, SESSOES)).rejects.toThrow(/0 byte/);
    const tarQuebrado = fakeD(async (args) => {
      if (args.includes("tar")) throw new Error("tar: permission denied");
      return "";
    });
    await expect(exportarSessao(tarQuebrado as never, "job-x", undefined, SESSOES)).rejects.toThrow(/tar da sessão falhou/);
    const logs: string[] = [];
    const semPull = fakeD(
      async (args) => (args.includes("stat") ? "2048\n" : ""),
      async () => {
        throw new Error("adb pull falhou: device offline");
      }
    );
    expect(await exportarSessao(semPull as never, "job-x", (m: string) => logs.push(m), SESSOES)).toBe("sessão não exportada");
    expect(logs.some((l) => /sessão não exportada: adb pull falhou/.test(l))).toBe(true);
  });

  it("tar só de shared_prefs, databases e files, sem cache; grava na pasta temporária passada e loga o tamanho", async () => {
    adbMock = () => ({ codigo: 0, stdout: "" });
    const comandos: string[][] = [];
    const logs: string[] = [];
    const d = fakeD(
      async (args) => {
        comandos.push(args);
        return args.includes("stat") ? "4096\n" : "";
      },
      async (_remoto: string, local: string) => writeFileSync(local, "tgz")
    );
    const saida = await exportarSessao(d as never, "job-ok", (m: string) => logs.push(m), SESSOES);
    expect(saida).toMatch(/job-ok\.tgz exportado/);
    expect(readFileSync(path.join(SESSOES, "job-ok.tgz"), "utf8")).toBe("tgz");
    const tar = comandos.find((c) => c.includes("tar"))!;
    expect(tar.slice(tar.indexOf("-C") + 1)).toEqual([
      "/data/data/com.instagram.android",
      "--exclude=cache",
      "--exclude=files/cache",
      "--exclude=code_cache",
      "--exclude=no_backup",
      "shared_prefs",
      "databases",
      "files",
    ]);
    expect(tar).not.toContain("/data/data");
    expect(logs.some((l) => /sessão: 4 KB/.test(l))).toBe(true);
  });
});

describe("Kill switch (rede.mjs)", () => {
  it("regras na ordem: owner RETURN → REDIRECT 53 (udp e tcp) → REDIRECT tcp → lo → owner ACCEPT → udp/53 → udp/443 REJECT → tcp ACCEPT → DROP", () => {
    const s = scriptSidecar();
    const ordem = [
      "iptables -t nat -A OUTPUT -m owner --uid-owner 60000 -j RETURN",
      "iptables -t nat -A OUTPUT -p udp --dport 53 -j REDIRECT --to-ports 53",
      "iptables -t nat -A OUTPUT -p tcp --dport 53 -j REDIRECT --to-ports 12345",
      "iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports 12345",
      "iptables -A OUTPUT -d 127.0.0.11 -j DROP",
      "iptables -A OUTPUT -o lo -j ACCEPT",
      "iptables -A OUTPUT -m owner --uid-owner 60000 -j ACCEPT",
      "iptables -A OUTPUT -p udp --dport 53 -j ACCEPT",
      "iptables -A OUTPUT -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable",
      "iptables -A OUTPUT -p tcp -j ACCEPT",
      "iptables -A OUTPUT -j DROP",
    ];
    let pos = -1;
    for (const regra of ordem) {
      const i = s.indexOf(regra, pos + 1);
      expect(i, regra).toBeGreaterThan(pos);
      pos = i;
    }
    expect(s).not.toContain("PREROUTING");
    // gost (red) e unbound rodam com o uid 60000: é o owner que os libera das regras.
    expect(s).toContain('exec su-exec redsocks gost -L "red://:12345" -F "$PROXY_URL"');
    expect(s).toContain('username: "redsocks"');
    expect(s).toContain("tcp-upstream: yes");
    expect(s).toContain("interface: $IP_NETNS@53");
    expect(s).toContain("nameserver %s");
    expect(s).toContain("adduser -D -H -s /sbin/nologin -u 60000 redsocks");
    // Política DROP antes de qualquer flush: falha no meio do script fecha, nunca abre.
    expect(s.indexOf("iptables -P OUTPUT DROP")).toBeLessThan(s.indexOf("iptables -F OUTPUT"));
    expect(UID_REDSOCKS).toBe(60000);
    expect(s).not.toMatch(/--uid-owner (1000|2000|redsocks)\b/);
    // O REDIRECT do 53 vem antes do ACCEPT do 53: nada de DNS pelo resolver da VPS.
    expect(s.indexOf("--dport 53 -j REDIRECT")).toBeLessThan(s.indexOf("--dport 53 -j ACCEPT"));
    // Em modo bloqueado o udp/53 ACCEPT e o tcp ACCEPT ficam dentro do if do proxy: nem DNS sai.
    expect(s.split('if [ "$MODO" = "proxy" ]').length).toBe(5);
  });
});

describe("Sync do MuMu com vps_devices", () => {
  it("UPDATE em vps_devices com erro (tabela ausente) ou sem linha não derruba o sync", async () => {
    const chamadas: string[] = [];
    const avisos: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((m: string) => void avisos.push(String(m)));
    const admin = {
      from(table: string) {
        let op = "select";
        const builder: Record<string, unknown> = {};
        for (const m of ["eq", "in", "gte", "order", "limit", "not", "neq", "select"]) builder[m] = () => builder;
        builder.update = () => {
          op = "update";
          return builder;
        };
        builder.then = (resolve: (v: unknown) => void) => {
          chamadas.push(`${op} ${table}`);
          if (table === "vps_devices") return resolve({ data: null, error: { code: "42P01", message: 'relation "vps_devices" does not exist' } });
          if (table === "emulator_jobs" && op === "update") return resolve({ data: [], error: null });
          return resolve({ data: [], error: null });
        };
        return builder;
      },
    };
    const update = {
      id: "11111111-1111-4111-8111-111111111111",
      instanceIndex: 3,
      steps: [{ key: "copiar", status: "done" as const, message: "instância #3 docker_created=2026-11-07T01:00:00.123456789Z" }],
      status: "done" as const,
      error: null,
      prompt: null,
    };
    const r = await syncJobs(admin as never, "agente-mumu", [update], new Set(), "2026-11-07T00:00:00Z");
    expect(r).toEqual({ jobs: [], replies: [] });
    expect(chamadas.filter((c) => c.startsWith("update vps_devices")).length).toBe(2);
    expect(chamadas.some((c) => c.includes("insert") || c.includes("upsert"))).toBe(false);
    expect(avisos.some((a) => /vps_devices/.test(a))).toBe(true);
    warn.mockRestore();
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

  it("parseInstances guarda o criada cru do agente da VPS e descarta o malformado", () => {
    const [i] = parseInstances([{ index: 2, name: "x", state: "off", criada: "2026-11-07T01:00:00.123456789Z" }]);
    expect(i.criada).toBe("2026-11-07T01:00:00.123456789Z");
    expect(parseInstances([{ index: 2, name: "x", state: "off" }])[0].criada).toBeNull();
    expect(parseCriada("07/11/2026 01:00")).toBeNull();
    expect(parseCriada("2026-11-07T01:00:00Z; drop")).toBeNull();
    expect(parseCriada(new Date("2026-11-07T01:00:00Z"))).toBeNull();
    expect(parseCriada(`2026-11-07T01:00:00.${"1".repeat(40)}Z`)).toBe(`2026-11-07T01:00:00.${"1".repeat(40)}Z`.slice(0, 40));
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
