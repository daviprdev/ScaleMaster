import { describe, expect, it } from "vitest";
import { syncJobs } from "../lib/emulador/sync-jobs";
import { colisaoDeIdentidade, ipDoDevice, ipNaRede, novoDevice, proximaRede } from "../lib/vps/device";
import { parseProxies } from "../lib/vps/input";
import { AVISO_HOST_PEQUENO, hostPequeno, isolamentoUnico, parseCapacidade, type Isolamento } from "../lib/vps/jobs";
import { MEMORIA, argsDoContainer, hostnameDe } from "../agente-vps/lib/android.mjs";
import { argsDaRede, colisao, enderecoDe, ipDe, ipNaRede as ipNaRedeAgente, redeDoLote } from "../agente-vps/lib/rede.mjs";
import { capacidade, limitesPorVcpu } from "../agente-vps/lib/supervisor.mjs";

describe("Concorrência: limites por vCPU", () => {
  it("maxLigadas = clamp(floor(vCPU×3/4), 1, 8) e maxCadastro = clamp(floor(vCPU×3/4), 1, 6), nunca acima de maxLigadas", () => {
    const esperado: Array<[number, number, number]> = [
      [1, 1, 1], [2, 1, 1], [3, 2, 2], [4, 3, 3], [5, 3, 3], [6, 4, 4], [8, 6, 6], [10, 7, 6], [12, 8, 6], [16, 8, 6], [32, 8, 6], [96, 8, 6],
    ];
    for (const [vcpu, maxLigadas, maxCadastro] of esperado) {
      expect(limitesPorVcpu(vcpu), `${vcpu} vCPU`).toEqual({ maxLigadas, maxCadastro });
      expect(capacidade({ arch: "x86_64", vcpu, totalMb: 8000, livreMb: 4000 })).toMatchObject({ vcpu, maxLigadas, maxCadastro });
      expect(capacidade({ arch: "arm64", vcpu, totalMb: 64000, livreMb: 60000 })).toMatchObject({ maxLigadas, maxCadastro });
      expect(maxCadastro).toBeLessThanOrEqual(maxLigadas);
    }
    expect(limitesPorVcpu(0)).toEqual({ maxLigadas: 1, maxCadastro: 1 });
    expect(limitesPorVcpu(Number.NaN)).toEqual({ maxLigadas: 1, maxCadastro: 1 });
  });

  it("os dois limites e as vCPUs vão em capacity; o servidor não aceita maxCadastro acima de maxLigadas", () => {
    const enviado = capacidade({ arch: "x86_64", vcpu: 8, totalMb: 16000, livreMb: 8000 });
    expect(parseCapacidade({ ...enviado, ligadas: 2, versoesIg: [] })).toMatchObject({ maxLigadas: 6, maxCadastro: 6, vcpu: 8, ligadas: 2 });
    expect(parseCapacidade({ maxLigadas: 1, maxCadastro: 4, vcpu: 2 })).toMatchObject({ maxLigadas: 1, maxCadastro: 1 });
  });

  it("host com menos de 4 vCPU ganha o aviso; agente antigo (sem vCPU) não", () => {
    expect(AVISO_HOST_PEQUENO).toBe("host pequeno, 1 por vez");
    expect(hostPequeno({ vcpu: 2 })).toBe(true);
    expect(hostPequeno({ vcpu: 3 })).toBe(true);
    expect(hostPequeno({ vcpu: 4 })).toBe(false);
    expect(hostPequeno({ vcpu: 0 })).toBe(false);
  });

  it("maxCadastro atingido: o job continua queued, nada é entregue nem marcado como running", async () => {
    const reivindicados: string[] = [];
    const lidasDaFila: number[] = [];
    const admin = (rodando: string[]) => ({
      from(table: string) {
        let op = "select";
        let status: unknown = null;
        let limite: number | null = null;
        const builder: Record<string, unknown> = {};
        for (const m of ["in", "gte", "order", "not", "neq", "select", "or"]) builder[m] = () => builder;
        builder.eq = (coluna: string, valor: unknown) => {
          if (coluna === "status") status = valor;
          return builder;
        };
        builder.limit = (n: number) => {
          limite = n;
          return builder;
        };
        builder.update = (patch: { status?: string }) => {
          op = "update";
          if (patch.status === "running") reivindicados.push(table);
          return builder;
        };
        builder.then = (resolve: (v: unknown) => void) => {
          if (table !== "emulator_jobs" || op !== "select") return resolve({ data: [], error: null });
          if (status === "running") return resolve({ data: rodando.map((id) => ({ id, reply: null })), error: null });
          lidasDaFila.push(limite ?? -1);
          return resolve({ data: [], error: null });
        };
        return builder;
      },
    });
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    // 2 rodando com maxCadastro 2: nem olha a fila.
    expect(await syncJobs(admin([a, b]) as never, "vps", [], new Set([a, b]), "2026-11-10T00:00:00Z", 2)).toEqual({ jobs: [], replies: [] });
    expect(lidasDaFila).toEqual([]);
    expect(reivindicados).toEqual([]);
    // 1 rodando com maxCadastro 2: pede só a vaga que sobra.
    await syncJobs(admin([a]) as never, "vps", [], new Set([a]), "2026-11-10T00:00:00Z", 2);
    expect(lidasDaFila).toEqual([1]);
  });
});

describe("Isolamento: docker run", () => {
  const spec = {
    index: 7,
    nome: "maria.silva",
    jobId: "0b0e6a52-6d0a-4f0e-9a51-3c1f6d2a9b11",
    volume: "scalemaster-ig-7",
    device: { model: "moto g84 5G", mac: "3c:11:22:33:44:55", serial: "ZYABCDEFGH12", fingerprint: "motorola/bangkk_g/bangkk:13/x/1:user/release-keys", rede: 3, ip: "10.77.3.9" },
  };

  it("--hostname com o modelo do aparelho, --cpus pela cota e --memory 2048m", () => {
    const { rede, ip } = enderecoDe(spec.device, spec.index);
    const args: string[] = argsDoContainer(spec, { props: "/opt/scalemaster/vps/props/ig-7", rede, ip, cota: { cpus: "2", memoria: "2048m" } });
    const valor = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args[0]).toBe("create");
    expect(valor("--hostname")).toBe("moto-g84-5G");
    expect(valor("--cpus")).toBe("2");
    expect(valor("--memory")).toBe("2048m");
    expect(valor("--memory-swap")).toBe("2048m");
    expect(MEMORIA).toBe("2048m");
    expect(valor("--network")).toBe("vpsnet-3");
    expect(valor("--ip")).toBe("10.77.3.9");
    expect(valor("--mac-address")).toBe("3c:11:22:33:44:55");
    expect(valor("--name")).toBe("ig-7");
    expect(args).toContain("androidboot.redroid_net_dns1=10.77.3.9");
    expect(args).toContain("androidboot.serialno=ZYABCDEFGH12");
    expect(args).toContain("scalemaster.conta=0b0e6a52-6d0a-4f0e-9a51-3c1f6d2a9b11");
  });

  it("hostname só com letras, números e hífen", () => {
    expect(hostnameDe("Pixel 7")).toBe("Pixel-7");
    expect(hostnameDe("SM-A546E")).toBe("SM-A546E");
    expect(hostnameDe("  ")).toBe("android");
    expect(hostnameDe(undefined)).toBe("android");
    expect(hostnameDe("a".repeat(80))).toHaveLength(63);
  });
});

describe("Isolamento: um /24 por lote, IP e MAC únicos", () => {
  it("cada lote ganha a sua rede; contas antigas ficam na bridge de sempre", () => {
    expect(redeDoLote(0)).toMatchObject({ nome: "vpsnet", subrede: "10.77.0.0/24", gateway: "10.77.0.1" });
    expect(redeDoLote(undefined)).toMatchObject({ indice: 0, nome: "vpsnet" });
    expect(redeDoLote(5)).toEqual({ indice: 5, nome: "vpsnet-5", subrede: "10.77.5.0/24", gateway: "10.77.5.1", bridge: "vpsnet5" });
    expect(redeDoLote(255)).toMatchObject({ indice: 0 });
    expect(argsDaRede(redeDoLote(5))).toEqual([
      "network", "create", "--driver", "bridge", "--subnet", "10.77.5.0/24", "--gateway", "10.77.5.1", "-o", "com.docker.network.bridge.name=vpsnet5", "vpsnet-5",
    ]);
    expect(proximaRede([])).toBe(1);
    expect(proximaRede([0, 0, 1, 2])).toBe(3);
    expect(proximaRede([7, 3])).toBe(8);
    expect(proximaRede(Array.from({ length: 254 }, (_, i) => i + 1).filter((n) => n !== 40))).toBe(40);
    expect(() => proximaRede(Array.from({ length: 254 }, (_, i) => i + 1))).toThrow(/rede \/24 livre/);
  });

  it("o IP sai do lote e do índice, igual no servidor e no agente", () => {
    for (const [rede, index] of [[0, 1], [0, 12], [1, 13], [3, 7], [9, 250], [9, 251], [254, 499]] as const) {
      expect(ipNaRede(rede, index)).toBe(ipNaRedeAgente(rede, index));
    }
    expect(ipNaRede(0, 12)).toBe(ipDe(12));
    expect(ipNaRede(3, 7)).toBe("10.77.3.9");
    // 20 contas de um lote (índices seguidos) nunca repetem IP.
    const ips = Array.from({ length: 20 }, (_, i) => ipNaRede(4, 241 + i));
    expect(new Set(ips).size).toBe(20);
    for (const ip of ips) expect(Number(ip.split(".")[3])).toBeGreaterThanOrEqual(2);
    // Conta antiga (sem device.rede / device.ip): o agente usa a bridge e o IP de sempre.
    expect(enderecoDe({ mac: "x" }, 12)).toMatchObject({ rede: { nome: "vpsnet" }, ip: "10.77.0.14" });
    expect(enderecoDe({ rede: 3, ip: "10.77.3.9" }, 7)).toMatchObject({ rede: { nome: "vpsnet-3" }, ip: "10.77.3.9" });
    // IP de outra rede na identidade não vale: recalcula dentro da rede do lote.
    expect(enderecoDe({ rede: 3, ip: "10.77.4.9" }, 7).ip).toBe("10.77.3.9");
    expect(ipDoDevice({ index: 12 })).toBe("10.77.0.14");
  });

  it("identidade nova: nada sai de constante (serial, Android ID, MAC, fingerprint) e fuso/idioma vêm do país da conta", () => {
    const lote = Array.from({ length: 20 }, (_, i) => novoDevice("aleatorio", i % 2 ? "US" : "BR", 30 + i, 6));
    for (const campo of ["androidId", "serial", "mac", "imei", "fingerprint", "ip", "container", "volume"] as const) {
      expect(new Set(lote.map((d) => d[campo])).size, campo).toBe(20);
    }
    expect(lote.every((d) => d.rede === 6 && d.ip?.startsWith("10.77.6."))).toBe(true);
    expect(lote[0]).toMatchObject({ timezone: "America/Sao_Paulo", locale: "pt-BR", pais: "BR" });
    expect(lote[1]).toMatchObject({ timezone: "America/New_York", locale: "en-US", pais: "US" });
    expect(novoDevice("pixel7", "BR", 3).ip).toBe("10.77.0.5");
  });

  it("colisão de IP aborta (servidor contra as outras contas, agente contra os containers vivos)", () => {
    const novo = novoDevice("pixel7", "BR", 7, 3);
    expect(colisaoDeIdentidade(novo, [{ ip: "10.77.3.9", container: "ig-2" }])).toBe("o IP 10.77.3.9 já é de ig-2");
    expect(colisaoDeIdentidade(novo, [{ ip: "10.77.4.9", container: "ig-2" }, { mac: "aa:bb:cc:dd:ee:ff", container: "ig-3" }])).toBeNull();

    const vivos = [
      { nome: "ig-2", ips: ["10.77.3.9"], macs: ["3c:00:00:00:00:02"] },
      { nome: "ig-2-proxy", ips: [], macs: [] },
      { nome: "teste-ig", ips: ["172.17.0.4"], macs: ["02:42:ac:11:00:04"] },
    ];
    expect(colisao({ nome: "ig-7", ip: "10.77.3.9", mac: "3c:00:00:00:00:07" }, vivos)).toBe("o IP 10.77.3.9 já é do container ig-2");
    expect(colisao({ nome: "ig-7", ip: "10.77.3.10", mac: "3c:00:00:00:00:07" }, vivos)).toBeNull();
    // O próprio container (Continuar / recriação no abrir) não colide consigo mesmo.
    expect(colisao({ nome: "ig-2", ip: "10.77.3.9", mac: "3c:00:00:00:00:02" }, vivos)).toBeNull();
  });

  it("colisão de MAC aborta (servidor contra vps_devices, agente contra os containers vivos), sem diferenciar maiúsculas", () => {
    const novo = { ...novoDevice("pixel7", "BR", 7, 3), mac: "3C:AA:BB:CC:DD:EE" };
    expect(colisaoDeIdentidade(novo, [{ mac: "3c:aa:bb:cc:dd:ee", container: "ig-4" }])).toBe("o MAC 3C:AA:BB:CC:DD:EE já é de ig-4");
    expect(colisaoDeIdentidade(novo, [{ mac: null, container: "ig-4" }])).toBeNull();
    expect(colisao({ nome: "ig-7", ip: "10.77.3.9", mac: "3C:AA:BB:CC:DD:EE" }, [{ nome: "ig-4", ips: ["10.77.1.6"], macs: ["3c:aa:bb:cc:dd:ee"] }])).toBe(
      "o MAC 3C:AA:BB:CC:DD:EE já é do container ig-4"
    );
  });

  it("proxy repetida no lote (mesmo usuário) bloqueia o envio", () => {
    const repetida = parseProxies("1.2.3.4:8000:user1:pass1\n5.6.7.8:8000:user2:pass2\n1.2.3.4:8000:user1:outra");
    expect(repetida).toEqual({ error: "A proxy 1.2.3.4:8000 com o usuário user1 aparece nas linhas 1 e 3: cada conta precisa da sua." });
    const ok = parseProxies("1.2.3.4:8000:user1:pass1\n1.2.3.4:8001:user1:pass1");
    expect("value" in ok && ok.value).toHaveLength(2);
  });

  it("bloco Isolamento: verde só com IP, MAC, serial e Android ID presentes e únicos no lote", () => {
    const conta = (n: number, extra: Partial<Isolamento> = {}): Isolamento => ({
      ip: `10.77.3.${n}`, mac: `3c:00:00:00:00:0${n}`, modelo: "Pixel 7", serial: `SERIAL${n}`, androidId: `aid${n}`, ...extra,
    });
    const lote = [conta(2), conta(3), conta(4)];
    // Modelo igual nas três não tira o verde: são 3 perfis reais de aparelho.
    expect(lote.every((c) => isolamentoUnico(c, lote))).toBe(true);
    const comIpRepetido = [conta(2), conta(3, { ip: "10.77.3.2" })];
    expect(isolamentoUnico(comIpRepetido[0], comIpRepetido)).toBe(false);
    const comMacRepetido = [conta(2), conta(3, { mac: "3C:00:00:00:00:02" })];
    expect(isolamentoUnico(comMacRepetido[1], comMacRepetido)).toBe(false);
    expect(isolamentoUnico(conta(2, { ip: null }), [conta(2, { ip: null })])).toBe(false);
    expect(isolamentoUnico(conta(2), [conta(2)])).toBe(true);
  });
});
