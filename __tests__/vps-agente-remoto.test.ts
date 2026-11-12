import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { definirSaas, enviarPrint, relativoSeguro, sincronizarMidias } from "../agente-vps/lib/saas.mjs";
import { capacidade, ramDisponivelMb } from "../agente-vps/lib/supervisor.mjs";
import { parseCapacidade } from "../lib/vps/jobs";
import { ramDoAgente } from "../lib/vps/ram";

/** Agente na KVM 8 e app na VPS antiga (12/11): fotos descem, prints sobem, RAM vem do agente. */

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  definirSaas("", "");
});

const resposta = (corpo: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => corpo, arrayBuffer: async () => (corpo as Uint8Array).buffer }) as unknown as Response;

describe("Fotos: o agente baixa do app o que falta", () => {
  it("baixa só o que não existe ou mudou de tamanho e recusa caminho fora da pasta", async () => {
    const raiz = mkdtempSync(path.join(os.tmpdir(), "midias-"));
    pastas.push(raiz);
    mkdirSync(path.join(raiz, "perfil"));
    writeFileSync(path.join(raiz, "perfil", "igual.jpg"), "abc");
    definirSaas("https://scalemaster.tech/", "smag_x");
    const pedidos: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      pedidos.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer smag_x");
      if (url.endsWith("/api/emulador/agente/midias"))
        return resposta({
          files: [
            { path: "perfil/igual.jpg", size: 3 },
            { path: "perfil/nova.jpg", size: 4 },
            { path: "../../etc/passwd", size: 1 },
            { path: "/abs.png", size: 1 },
          ],
        });
      return resposta(new Uint8Array([1, 2, 3, 4]));
    };
    const baixadas = await sincronizarMidias(raiz, { fetcher: fetcher as unknown as typeof fetch });
    expect(baixadas).toBe(1);
    expect(pedidos).toEqual(["https://scalemaster.tech/api/emulador/agente/midias", "https://scalemaster.tech/api/emulador/agente/midias/arquivo?path=perfil%2Fnova.jpg"]);
    expect([...readFileSync(path.join(raiz, "perfil", "nova.jpg"))]).toEqual([1, 2, 3, 4]);
    expect(relativoSeguro("a/../b")).toBeNull();
    expect(relativoSeguro("a\\b")).toBeNull();
    expect(relativoSeguro("story/cta.png")).toBe("story/cta.png");
  });

  it("sem SaaS definido não faz nada; erro na lista lança", async () => {
    expect(await sincronizarMidias("/nao/existe", { fetcher: async () => resposta({ files: [] }) })).toBe(0);
    definirSaas("https://x", "smag_y");
    await expect(sincronizarMidias("/nao/existe", { fetcher: async () => resposta({}, 503) })).rejects.toThrow("503");
  });
});

describe("Prints: o agente manda o PNG para o app", () => {
  it("POST com job e etapa na URL; falha de rede vira false, nunca lança", async () => {
    definirSaas("https://scalemaster.tech", "smag_x");
    let pedido = "";
    const ok = await enviarPrint("0b0e6a52-6d0a-4f0e-9a51-3c1f6d2a9b11", "link-1", new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      fetcher: (async (url: string, init?: RequestInit) => {
        pedido = `${init?.method} ${url} ${(init?.headers as Record<string, string>)["Content-Type"]}`;
        return resposta({ ok: true });
      }) as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(pedido).toBe("POST https://scalemaster.tech/api/emulador/agente/prints?job=0b0e6a52-6d0a-4f0e-9a51-3c1f6d2a9b11&etapa=link-1 image/png");
    expect(await enviarPrint("j", "e", new Uint8Array([1]), { fetcher: async () => Promise.reject(new Error("sem rede")) })).toBe(false);
  });
});

describe("RAM: a do host do agente", () => {
  it("o agente lê MemAvailable e manda na capacidade; o app decide o lote por ela", () => {
    expect(ramDisponivelMb("MemTotal:  32000000 kB\nMemAvailable:   20480000 kB\n")).toBe(20000);
    expect(ramDisponivelMb("sem nada")).toBeNull();
    expect(capacidade({ arch: "x86_64", vcpu: 8, totalMb: 32000, livreMb: 1000, disponivelMb: 20000 })).toMatchObject({ ramDisponivelMb: 20000, maxLigadas: 4 });
    const cap = parseCapacidade({ maxLigadas: 4, maxCadastro: 4, vcpu: 8, ramTotalMb: 32000, ramDisponivelMb: 20000 });
    expect(cap.ramDisponivelMb).toBe(20000);
    expect(ramDoAgente(cap)).toMatchObject({ livreMb: 20000, totalMb: 32000, bloqueio: null });
    expect(ramDoAgente({ ...cap, ramDisponivelMb: 3000 })?.bloqueio).toMatch(/RAM insuficiente/);
    expect(parseCapacidade({ maxLigadas: 1 }).ramDisponivelMb).toBeNull();
  });
});

describe("Foto de perfil da criação: só de midias/perfil/", () => {
  it("nunca sorteia a foto do story (raiz da pasta); sem perfil/ não há foto", async () => {
    const { sortearFoto } = await import("../agente-vps/lib/midias.mjs");
    const raiz = mkdtempSync(path.join(os.tmpdir(), "midias-"));
    pastas.push(raiz);
    writeFileSync(path.join(raiz, "cta-destaques-02.png"), "x");
    expect(sortearFoto(raiz)).toBeNull();
    mkdirSync(path.join(raiz, "perfil"));
    writeFileSync(path.join(raiz, "perfil", "rosto.jpg"), "x");
    for (let i = 0; i < 10; i++) expect(sortearFoto(raiz)).toBe(path.join(raiz, "perfil", "rosto.jpg"));
  });
});
