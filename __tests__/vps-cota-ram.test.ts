import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLoteInput, parseProxies } from "../lib/vps/input";
import {
  RAM_ALERTA_MB,
  RAM_POR_CONTA_MB,
  bloqueioPorRam,
  chaveProxy,
  estadoIsolamento,
  hostPortaDaChave,
  isolamentoUnico,
  parseCapacidade,
  parseTopRss,
  proxiesEmUso,
  type Isolamento,
} from "../lib/vps/jobs";
import { lerMeminfo, ramDoHost } from "../lib/vps/ram";
import { MEMORIA, argsDaCota, argsDoContainer, cotaAtual, cpusPorContainer } from "../agente-vps/lib/android.mjs";
import { enderecoDe } from "../agente-vps/lib/rede.mjs";
import { capacidade, containerDoCgroup, lerPs } from "../agente-vps/lib/supervisor.mjs";

describe("Cota por container", () => {
  it("--cpus = max(1, vCPU / maxLigadas com uma casa); 2 vCPU = 2, KVM 8 (6 ligadas) = 1.3", () => {
    expect(cpusPorContainer(2, 1)).toBe("2");
    expect(cpusPorContainer(4, 2)).toBe("2");
    expect(cpusPorContainer(8, 4)).toBe("2");
    expect(cpusPorContainer(16, 8)).toBe("2");
    expect(cpusPorContainer(6, 3)).toBe("2");
    expect(cpusPorContainer(5, 2)).toBe("2.5");
    expect(cpusPorContainer(8, 6)).toBe("1.3");
    expect(cpusPorContainer(3, 1)).toBe("3");
    expect(cpusPorContainer(1, 1)).toBe("1");
    expect(cpusPorContainer(2, 4)).toBe("1");
    expect(cpusPorContainer(0, 0)).toBe("1");
    // Com a capacidade real calculada pelo supervisor para cada tamanho de host.
    for (const vcpu of [1, 2, 3, 4, 8, 16, 32]) {
      const cap = capacidade({ arch: "x86_64", vcpu, totalMb: 8000, livreMb: 4000 });
      expect(cotaAtual(cap).cpus, `${vcpu} vCPU`).toBe(String(Math.max(1, Math.floor((vcpu * 10) / cap.maxLigadas) / 10)));
    }
    expect(cotaAtual(capacidade({ arch: "x86_64", vcpu: 2, totalMb: 8126, livreMb: 1497 }))).toEqual({ cpus: "2", memoria: "2048m" });
  });

  it("2048m de memória sem swap por fora, no create e no docker update que vale para os containers antigos", () => {
    expect(MEMORIA).toBe("2048m");
    expect(argsDaCota("ig-5", { cpus: "2", memoria: "2048m" })).toEqual(["update", "--cpus", "2", "--memory", "2048m", "--memory-swap", "2048m", "ig-5"]);
    const spec = { index: 4, nome: "x", jobId: null, volume: "v", device: { model: "Pixel 7", mac: "3c:00:00:00:00:04", serial: "S", rede: 0 } };
    const { rede, ip } = enderecoDe(spec.device, spec.index);
    const args: string[] = argsDoContainer(spec, { props: "/p", rede, ip, cota: cotaAtual(capacidade({ arch: "x86_64", vcpu: 2, totalMb: 8000, livreMb: 4000 })) });
    const valor = (flag: string) => args[args.indexOf(flag) + 1];
    expect([valor("--cpus"), valor("--memory"), valor("--memory-swap")]).toEqual(["2", "2048m", "2048m"]);
  });
});

describe("Bloqueio do lote por RAM livre", () => {
  it("precisa de maxLigadas × 1600 MB livres; abaixo disso, o motivo com o número", () => {
    expect(RAM_POR_CONTA_MB).toBe(1600);
    expect(bloqueioPorRam(1600, 1)).toBeNull();
    expect(bloqueioPorRam(1497, 1)).toBe("RAM insuficiente: 1497 MB livres para 1 conta");
    expect(bloqueioPorRam(3199, 2)).toBe("RAM insuficiente: 3199 MB livres para 2 contas");
    expect(bloqueioPorRam(3200, 2)).toBeNull();
    expect(bloqueioPorRam(12_000, 8)).toBe("RAM insuficiente: 12000 MB livres para 8 contas");
    expect(bloqueioPorRam(-5, 1)).toBe("RAM insuficiente: 0 MB livres para 1 conta");
  });

  it("a memória livre vem do /proc/meminfo do host na hora (MemAvailable), não do retrato do agente", () => {
    const meminfo = "MemTotal:        8126136 kB\nMemFree:         2225820 kB\nMemAvailable:    1496992 kB\nBuffers: 1 kB\n";
    expect(lerMeminfo(meminfo)).toEqual({ livreMb: 1461, totalMb: 7935 });
    expect(lerMeminfo("MemTotal: 2048 kB\nMemFree: 1024 kB\n")).toEqual({ livreMb: 1, totalMb: 2 });
    expect(lerMeminfo("lixo")).toBeNull();
    const dir = mkdtempSync(path.join(os.tmpdir(), "sm-meminfo-"));
    const arquivo = path.join(dir, "meminfo");
    writeFileSync(arquivo, meminfo);
    const lida = ramDoHost(1, arquivo);
    expect(lida).toMatchObject({ livreMb: 1461, totalMb: 7935, bloqueio: "RAM insuficiente: 1461 MB livres para 1 conta" });
    writeFileSync(arquivo, "MemTotal: 16000000 kB\nMemAvailable: 9000000 kB\n");
    expect(ramDoHost(4, arquivo)?.bloqueio).toBeNull();
    expect(ramDoHost(6, arquivo)?.bloqueio).toBe("RAM insuficiente: 8789 MB livres para 6 contas");
    // Lido de novo a cada chamada: o retrato do agente (ramUsadaMb) não entra na conta.
    writeFileSync(arquivo, "MemTotal: 16000000 kB\nMemAvailable: 1000000 kB\n");
    expect(ramDoHost(1, arquivo)?.livreMb).toBe(976);
    expect(ramDoHost(1, path.join(dir, "nao-existe"))).toBeNull();
    expect(RAM_ALERTA_MB).toBe(2000);
  });
});

describe("Dedupe de proxy por host:porta:usuário", () => {
  it("mesma host:porta com usuários diferentes passa, com aviso; mesmo usuário bloqueia", () => {
    const gateway = parseProxies("sv2.gmproxys.com:10000:user-a:s1\nsv2.gmproxys.com:10000:user-b:s2\nsv2.gmproxys.com:10000:user-c:s3");
    expect("value" in gateway && gateway.value.map((p) => p.usuario)).toEqual(["user-a", "user-b", "user-c"]);
    expect("avisos" in gateway && gateway.avisos).toEqual([
      "A proxy sv2.gmproxys.com:10000 aparece nas linhas 1, 2, 3 com usuários diferentes: segue, cada linha conta como uma proxy.",
    ]);
    expect(parseProxies("sv2.gmproxys.com:10000:user-a:s1\nSV2.GMPROXYS.COM:10000:user-a:outra")).toEqual({
      error: "A proxy sv2.gmproxys.com:10000 com o usuário user-a aparece nas linhas 1 e 2: cada conta precisa da sua.",
    });
    // Sem repetição nenhuma, sem aviso.
    expect(parseProxies("a.com:1:u:p\nb.com:1:u:p")).toMatchObject({ avisos: [] });
    expect(chaveProxy({ host: "A.com", porta: "80", usuario: "U" })).toBe("a.com:80:U");
    expect(hostPortaDaChave("a.com:80:U")).toBe("a.com:80");
  });

  it("o lote aceita a mesma host:porta com usuários diferentes e leva o aviso adiante", () => {
    const corpo = {
      agentId: "a",
      versaoIg: "454.0.0.54.77",
      proxies: "gw.com:10000:u1:p1\ngw.com:10000:u2:p2",
      codigos: "https://hridoyhub.shop/OTP/ | AAAA1111\nhttps://hridoyhub.shop/OTP/ | BBBB2222",
    };
    const lote = parseLoteInput(corpo);
    if (!("value" in lote)) throw new Error(lote.error);
    expect(lote.value.proxies.map((p) => p.usuario)).toEqual(["u1", "u2"]);
    expect(lote.value.avisos).toEqual(["A proxy gw.com:10000 aparece nas linhas 1, 2 com usuários diferentes: segue, cada linha conta como uma proxy."]);
    expect(parseLoteInput({ ...corpo, proxies: "gw.com:10000:u1:p1\ngw.com:10000:u1:p2" })).toEqual({
      error: "A proxy gw.com:10000 com o usuário u1 aparece nas linhas 1 e 2: cada conta precisa da sua.",
    });
  });

  it("contra as contas vivas: a chave completa em uso bloqueia; só a host:porta em uso é aviso", () => {
    const vivos = [
      { status: "done" as const, error: null, label: "maria", proxyHost: chaveProxy({ host: "gw.com", porta: 10000, usuario: "u1" }) },
    ];
    const emUso = proxiesEmUso(vivos);
    const hosts = proxiesEmUso(vivos.map((v) => ({ ...v, proxyHost: hostPortaDaChave(v.proxyHost) })));
    expect(emUso.has(chaveProxy({ host: "gw.com", porta: 10000, usuario: "u1" }))).toBe(true);
    expect(emUso.has(chaveProxy({ host: "gw.com", porta: 10000, usuario: "u2" }))).toBe(false);
    expect(hosts.get("gw.com:10000")).toBe("maria");
  });
});

describe("Isolamento: escudo neutro sem MAC", () => {
  const conta = (n: number, extra: Partial<Isolamento> = {}): Isolamento => ({
    ip: `10.77.3.${n}`, mac: `3c:00:00:00:00:0${n}`, modelo: "Pixel 7", serial: `S${n}`, androidId: `a${n}`, ...extra,
  });

  it("sem MAC conhecido: neutro (nem verde nem vermelho); repetição de outro valor continua vermelha", () => {
    const lote = [conta(2, { mac: null }), conta(3), conta(4)];
    expect(estadoIsolamento(lote[0], lote)).toBe("neutro");
    expect(isolamentoUnico(lote[0], lote)).toBe(false);
    expect(estadoIsolamento(lote[1], lote)).toBe("unico");
    const comIpRepetido = [conta(2, { mac: null }), conta(3, { ip: "10.77.3.2" })];
    expect(estadoIsolamento(comIpRepetido[0], comIpRepetido)).toBe("repetido");
    const macRepetido = [conta(2), conta(3, { mac: "3C:00:00:00:00:02" })];
    expect(estadoIsolamento(macRepetido[1], macRepetido)).toBe("repetido");
    // Dois sem MAC no mesmo lote não "repetem" o vazio.
    const doisSemMac = [conta(2, { mac: null }), conta(3, { mac: null })];
    expect(doisSemMac.map((c) => estadoIsolamento(c, doisSemMac))).toEqual(["neutro", "neutro"]);
  });
});

describe("Maiores consumidores de RAM (RSS)", () => {
  it("lê o ps ordenado por RSS e acha o container pelo cgroup", () => {
    const ps = [
      "   1153 754184 /usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock",
      "3536674 541900 com.instagram.android",
      "   3301 317620 system_server",
      "   3609 271144 com.android.systemui",
      "   3959 218972 com.android.launcher3",
      "3526085 206672 next-server (v15.5.4)",
    ].join("\n");
    expect(lerPs(ps)).toEqual([
      // Nome cortado em 60 caracteres.
      { pid: 1153, rssMb: 737, nome: "dockerd -H fd:// --containerd=/run/containerd/containerd.soc" },
      { pid: 3536674, rssMb: 529, nome: "com.instagram.android" },
      { pid: 3301, rssMb: 310, nome: "system_server" },
      { pid: 3609, rssMb: 265, nome: "com.android.systemui" },
      { pid: 3959, rssMb: 214, nome: "com.android.launcher3" },
    ]);
    const id = "a".repeat(64);
    expect(containerDoCgroup(`0::/system.slice/docker-${id}.scope\n`)).toBe(id);
    expect(containerDoCgroup(`0::/docker/${id}\n`)).toBe(id);
    expect(containerDoCgroup("0::/system.slice/docker.service\n")).toBeNull();
  });

  it("o servidor aceita no máximo 5, com nome e container saneados", () => {
    const top = parseTopRss([
      { nome: "dockerd", rssMb: 736.6, container: null },
      { nome: "com.instagram.android", rssMb: 529, container: "teste-ig" },
      { nome: "", rssMb: 10 },
      { nome: "x", rssMb: "muito" },
      { nome: "system_server", rssMb: 310, container: "../../etc" },
      { nome: "a", rssMb: 1 },
      { nome: "b", rssMb: 1 },
      { nome: "c", rssMb: 1 },
    ]);
    expect(top).toEqual([
      { nome: "dockerd", rssMb: 737, container: null },
      { nome: "com.instagram.android", rssMb: 529, container: "teste-ig" },
      { nome: "system_server", rssMb: 310, container: null },
    ]);
    expect(parseCapacidade({ maxLigadas: 1, topRss: [{ nome: "dockerd", rssMb: 700 }] }).topRss).toEqual([{ nome: "dockerd", rssMb: 700, container: null }]);
  });
});
