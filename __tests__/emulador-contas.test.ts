import { describe, it, expect } from "vitest";
import { NOVA_CONTA_FLUXO, parseJobSteps, parseJobUpdates, parseNovaContaInput } from "../lib/emulador/jobs";
import { digitoLuhn, gerarImei, imeiValido } from "../agente-mumu/lib/imei.mjs";
import { NOVA_CONTA } from "../agente-mumu/fluxos/nova-conta.mjs";

const UUID = "33333333-3333-4333-8333-333333333333";

describe("Nova conta: formulário", () => {
  it("aceita vazio e tira o @ do usuário", () => {
    const r = parseNovaContaInput({ proxy: " 1.2.3.4:80 ", conta: { usuario: "@maria.silva", nascimento: "" } });
    expect("value" in r && r.value.proxy).toBe("1.2.3.4:80");
    expect("value" in r && r.value.conta.usuario).toBe("maria.silva");
  });

  it("recusa usuário com caractere inválido", () => {
    expect(parseNovaContaInput({ conta: { usuario: "maria silva" } })).toHaveProperty("error");
    expect(parseNovaContaInput({ conta: { usuario: "maria-silva" } })).toHaveProperty("error");
  });

  it("data de nascimento dd/mm/aaaa e data que existe", () => {
    expect(parseNovaContaInput({ conta: { nascimento: "15/03/2001" } })).toHaveProperty("value");
    expect(parseNovaContaInput({ conta: { nascimento: "31/02/2001" } })).toHaveProperty("error");
    expect(parseNovaContaInput({ conta: { nascimento: "2001-03-15" } })).toHaveProperty("error");
  });
});

describe("Nova conta: andamento do agente", () => {
  it("lê etapas válidas, sem repetir chave", () => {
    expect(
      parseJobSteps([
        { key: "copiar", status: "done", message: "instância #3" },
        { key: "copiar", status: "error" },
        { key: "imei", status: "parado" },
        { key: "IMEI", status: "done" },
        { key: "abrir", status: "running" },
      ])
    ).toEqual([
      { key: "copiar", status: "done", message: "instância #3" },
      { key: "abrir", status: "running", message: null },
    ]);
  });

  it("lê updates: índice só inteiro, erro ganha mensagem", () => {
    expect(
      parseJobUpdates([
        { id: UUID, instanceIndex: 4, steps: [], status: "running" },
        { id: UUID, instanceIndex: "4", steps: [], status: "error" },
        { id: "x", status: "done" },
        { id: UUID, status: "queued" },
      ])
    ).toEqual([
      { id: UUID, instanceIndex: 4, steps: [], status: "running", error: null },
      { id: UUID, instanceIndex: undefined, steps: [], status: "error", error: "Erro sem mensagem." },
    ]);
  });

  it("as etapas prontas do SaaS são as mesmas do agente, na mesma ordem", () => {
    const prontas = NOVA_CONTA_FLUXO.filter((s) => s.ready).map((s) => s.key);
    expect(NOVA_CONTA.map((e: { chave: string }) => e.chave)).toEqual(prontas);
  });
});

describe("IMEI", () => {
  it("dígito verificador de um IMEI conhecido", () => {
    expect(digitoLuhn("49015420323751")).toBe(8);
    expect(imeiValido("490154203237518")).toBe(true);
    expect(imeiValido("490154203237519")).toBe(false);
  });

  it("gera 15 dígitos válidos começando com 35", () => {
    for (let i = 0; i < 200; i++) {
      const imei = gerarImei();
      expect(imei).toMatch(/^35\d{13}$/);
      expect(imeiValido(imei)).toBe(true);
    }
  });
});
