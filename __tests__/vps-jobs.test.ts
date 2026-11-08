import { describe, it, expect } from "vitest";
import { ALERTA_CAPTCHA, ALERTA_ROBO, ALERTA_TELEFONE } from "../lib/emulador/jobs";
import {
  PROXY_MORTA,
  TAREFA_GOLDEN,
  VPS_FLUXO,
  VPS_FLUXO_KEYS,
  activeCount,
  busyInstances,
  ehAlertaVps,
  ehProxyMorta,
  instanceAlerts,
  linkedJobs,
  parseCapacidade,
  progresso,
  stepsAfterProxyChange,
} from "../lib/vps/jobs";
import { geoDoPais, gerarImei, gerarMac, novoDevice, proximosIndices } from "../lib/vps/device";
import type { VpsJob } from "../lib/vps/types";
import { ALERTA_CAPTCHA as CAPTCHA_AGENTE, ALERTA_ROBO as ROBO_AGENTE, ALERTA_TELEFONE as TELEFONE_AGENTE, NOVA_CONTA, nomeDaInstancia } from "../agente-vps/fluxos/nova-conta.mjs";
import { TAREFAS } from "../agente-vps/tarefas/index.mjs";
import { ipDe, lerProxy } from "../agente-vps/lib/rede.mjs";
import { Semaforo, capacidade } from "../agente-vps/lib/supervisor.mjs";

const job = (extra: Partial<VpsJob>): VpsJob => ({
  id: "11111111-1111-4111-8111-111111111111",
  agentId: "a",
  kind: "nova-conta",
  acoes: [],
  label: "maria",
  templateIndex: 0,
  instanceIndex: 3,
  steps: [],
  status: "queued",
  error: null,
  prompt: null,
  createdAt: "2026-11-06T00:00:00Z",
  updatedAt: "2026-11-06T00:00:00Z",
  loteId: null,
  pausa: null,
  versaoIg: "309.0.0.40.113",
  proxyHost: null,
  ...extra,
});

describe("Contas VPS: etapas", () => {
  it("as chaves do servidor batem com as do agente, na mesma ordem", () => {
    expect(NOVA_CONTA.map((e: { chave: string }) => e.chave)).toEqual([...VPS_FLUXO_KEYS]);
    expect(VPS_FLUXO_KEYS).toEqual(["copiar", "ids", "fingerprint", "geo", "nome", "abrir", "instagram", "rede", "limpar", "email", "cadastro", "perfil", "seguir", "reels", "sessao", "fechar"]);
    expect(new Set(VPS_FLUXO_KEYS).size).toBe(VPS_FLUXO.length);
  });

  it("avisos iguais nos dois lados", () => {
    expect(TELEFONE_AGENTE).toBe(ALERTA_TELEFONE);
    expect(CAPTCHA_AGENTE).toBe(ALERTA_CAPTCHA);
    expect(ROBO_AGENTE).toBe(ALERTA_ROBO);
    expect(ALERTA_ROBO).toBe("Confirme que você não é um robô");
    expect(ehAlertaVps(ALERTA_ROBO)).toBe(true);
    expect(ehAlertaVps(ALERTA_TELEFONE)).toBe(true);
    expect(ehAlertaVps(PROXY_MORTA)).toBe(true);
    expect(ehAlertaVps("outro erro")).toBe(false);
    expect(ehProxyMorta("PROXY_MORTA: a proxy sai por US, a conta é BR")).toBe(true);
  });

  it("o agente tem a automação do Rebuild imagem", () => {
    expect(TAREFAS.some((t: { nome: string; semInstancia?: boolean }) => t.nome === TAREFA_GOLDEN && t.semInstancia)).toBe(true);
  });

  it("progresso: etapa em andamento e percentual das concluídas", () => {
    const j = job({
      status: "running",
      steps: [
        { key: "copiar", status: "done", message: null },
        { key: "ids", status: "done", message: null },
        { key: "fingerprint", status: "running", message: null },
      ],
    });
    const p = progresso(j);
    expect(p.etapa).toBe("fingerprint");
    expect(p.label).toBe("Aplicar o perfil do aparelho");
    expect(p.pct).toBe(Math.round((2 / VPS_FLUXO.length) * 100));
    expect(progresso(job({ status: "done" })).pct).toBe(100);
    expect(progresso(job({ status: "queued" })).label).toBe("Na fila");
  });

  it("proxy nova refaz da validação em diante", () => {
    const steps = VPS_FLUXO_KEYS.slice(0, 11).map((key) => ({ key, status: "done" as const, message: null }));
    expect(stepsAfterProxyChange(steps).map((s) => s.key)).toEqual(["copiar", "ids", "fingerprint", "nome", "abrir", "instagram"]);
  });
});

describe("Contas VPS: ligação conta ↔ container", () => {
  const instances = [
    { index: 3, name: "maria" },
    { index: 4, name: "ig-4" },
  ];

  it("liga pelo nome da etapa 'nome'; índice reaproveitado com outro nome não liga", () => {
    const ligada = job({ status: "done", steps: [{ key: "nome", status: "done", message: "maria" }] });
    const antiga = job({ id: "22222222-2222-4222-8222-222222222222", instanceIndex: 4, status: "done", steps: [{ key: "nome", status: "done", message: "joao" }] });
    const m = linkedJobs([ligada, antiga], "a", instances);
    expect(m.get(3)?.id).toBe(ligada.id);
    expect(m.has(4)).toBe(false);
  });

  it("na fila sem nome ainda, vale pelo índice; outro agente não entra", () => {
    const fila = job({ instanceIndex: 4, status: "queued" });
    expect(linkedJobs([fila], "a", instances).get(4)?.id).toBe(fila.id);
    expect(linkedJobs([job({ agentId: "b" })], "a", instances).size).toBe(0);
  });

  it("busyInstances, activeCount e alertas", () => {
    const rodando = job({ status: "running" });
    const parada = job({ id: "33333333-3333-4333-8333-333333333333", instanceIndex: 4, status: "error", error: PROXY_MORTA, steps: [{ key: "nome", status: "done", message: "ig-4" }] });
    expect([...busyInstances([rodando, parada], "a")]).toEqual([3]);
    expect(activeCount([rodando, parada, job({ status: "done" })], "a")).toBe(1);
    expect(instanceAlerts([parada], "a", instances).get(4)).toBe(PROXY_MORTA);
  });

  it("nome do container pelo @ ou pelo e-mail", () => {
    expect(nomeDaInstancia({ id: "abcdef12-0" }, { conta: { usuario: "maria.silva" } })).toBe("maria.silva");
    expect(nomeDaInstancia({ id: "abcdef12-0" }, { conta: { email: "jose@gmail.com" } })).toBe("jose");
    expect(nomeDaInstancia({ id: "abcdef12-0" }, { conta: {} })).toBe("conta-abcdef12");
  });
});

describe("Contas VPS: capacidade e identidade", () => {
  it("capacidade com limites e padrões", () => {
    expect(parseCapacidade(null)).toEqual({ maxLigadas: 2, maxCadastro: 2, ramTotalMb: 0, ramUsadaMb: 0, ligadas: 0, versoesIg: [] });
    const c = parseCapacidade({ maxLigadas: 23.4, maxCadastro: 400, versoesIg: ["309.0.0.40.113", "ruim ç", 5], ligadas: -2 });
    expect(c.maxLigadas).toBe(23);
    expect(c.maxCadastro).toBe(50);
    expect(c.versoesIg).toEqual(["309.0.0.40.113"]);
    expect(c.ligadas).toBe(0);
  });

  it("supervisor: capacidade por arquitetura; semáforo respeita a vaga", async () => {
    // x86_64: maxLigadas = max(1, vCPU/2), maxCadastro = 1, nada vem da RAM.
    expect(capacidade({ arch: "x86_64", vcpu: 2, totalMb: 7935, livreMb: 1145 })).toMatchObject({ arch: "x86_64", maxLigadas: 1, maxCadastro: 1, ramTotalMb: 7935, ramUsadaMb: 6790 });
    expect(capacidade({ arch: "x64", vcpu: 8, totalMb: 2000, livreMb: 500 })).toMatchObject({ maxLigadas: 4, maxCadastro: 1 });
    expect(capacidade({ arch: "x86_64", vcpu: 1, totalMb: 65536, livreMb: 60000 })).toMatchObject({ maxLigadas: 1, maxCadastro: 1 });
    // arm64: maxLigadas = RAM/1400, maxCadastro = max(2, vCPU/2) (Hetzner CAX31 → 23 / 4).
    expect(capacidade({ arch: "aarch64", vcpu: 8, totalMb: 32768, livreMb: 30000 })).toMatchObject({ arch: "arm64", maxLigadas: 23, maxCadastro: 4 });
    expect(capacidade({ arch: "arm64", vcpu: 2, totalMb: 4096, livreMb: 1000 })).toMatchObject({ maxLigadas: 2, maxCadastro: 2 });
    const c = capacidade();
    expect(c.maxLigadas).toBeGreaterThanOrEqual(1);
    expect(c.maxCadastro).toBeGreaterThanOrEqual(1);
    const s = new Semaforo(1);
    const solta1 = await s.pegar();
    let entrou = false;
    const segundo = s.pegar().then((solta) => {
      entrou = true;
      solta();
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(entrou).toBe(false);
    solta1();
    await segundo;
    expect(entrou).toBe(true);
    expect(s.livres).toBe(1);
  });

  it("lote de 10 gera 10 devices distintos, com país → fuso/idioma", () => {
    const indices = proximosIndices([1, 2, 7], 10);
    expect(indices).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const devices = indices.map((i) => novoDevice("aleatorio", "BR", i));
    expect(new Set(devices.map((d) => d.androidId)).size).toBe(10);
    expect(new Set(devices.map((d) => d.serial)).size).toBe(10);
    expect(new Set(devices.map((d) => d.mac)).size).toBe(10);
    expect(new Set(devices.map((d) => d.container)).size).toBe(10);
    for (const d of devices) {
      expect(d.fingerprint).toMatch(new RegExp(`^${d.brand}/${d.product}/${d.device}:13/${d.buildId.replace(/\./g, "\\.")}/\\d{7}:user/release-keys$`));
      expect(d.timezone).toBe("America/Sao_Paulo");
      expect(d.locale).toBe("pt-BR");
      expect(d.androidId).toMatch(/^[0-9a-f]{16}$/);
      expect(d.mac).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/);
    }
    expect(novoDevice("pixel7", "US", 1).model).toBe("Pixel 7");
    expect(geoDoPais("xx")).toEqual({ timezone: "UTC", locale: "en-US" });
    expect(gerarImei()).toMatch(/^35\d{13}$/);
    expect(Number.parseInt(gerarMac().slice(0, 2), 16) & 0x03).toBe(0);
  });

  it("rede: IP fixo por índice e leitura da proxy", () => {
    expect(ipDe(1)).toBe("10.77.0.3");
    expect(ipDe(252)).toBe("10.77.0.254");
    expect(() => ipDe(253)).toThrow();
    expect(lerProxy("http://u%40x:p@proxy.com:3128")).toEqual({ host: "proxy.com", porta: 3128, usuario: "u@x", senha: "p" });
    expect(() => lerProxy("http://proxy.com")).toThrow();
  });
});
