import { describe, it, expect } from "vitest";
import {
  ALERTA_TELEFONE,
  NOVA_CONTA_FLUXO,
  instanceAlerts,
  parseJobPrompt,
  parseJobSteps,
  parseJobUpdates,
  type EmulatorJob,
} from "../lib/emulador/jobs";
import { parseNovaContaInput } from "../lib/emulador/nova-conta-input";
import { instanceName } from "../lib/emulador/payload";
import { digitoLuhn, gerarAndroidId, gerarImei, gerarMac, imeiValido } from "../agente-mumu/lib/ids.mjs";
import { ALERTA_TELEFONE as ALERTA_AGENTE, NOVA_CONTA, nomeDaInstancia } from "../agente-mumu/fluxos/nova-conta.mjs";
import { lerProxy } from "../agente-mumu/fluxos/nekobox.mjs";
import { editableFrom, mergeEdit, stepsAfterEdit } from "../lib/emulador/editar-conta";

const UUID = "33333333-3333-4333-8333-333333333333";
const OK = {
  proxy: "sv2.exemplo.com:10114:usuario1:senha1",
  conta: { email: "Teste@Gmail.com", senha: "segredo123", nome: "Maria Silva", usuario: "@maria.silva", nascimento: "15/03/2001" },
};

describe("Criar instância: formulário", () => {
  it("normaliza a proxy para URL e o Gmail para minúsculas, tira o @", () => {
    const r = parseNovaContaInput(OK);
    expect(r).toHaveProperty("value");
    if (!("value" in r)) return;
    expect(r.value.proxy).toBe("http://usuario1:senha1@sv2.exemplo.com:10114");
    expect(r.value.conta.email).toBe("teste@gmail.com");
    expect(r.value.conta.usuario).toBe("maria.silva");
  });

  it("usuário é opcional", () => {
    expect(parseNovaContaInput({ ...OK, conta: { ...OK.conta, usuario: "" } })).toHaveProperty("value");
  });

  it("recusa proxy, Gmail, senha, nome, usuário e data inválidos", () => {
    const com = (conta: Partial<typeof OK.conta>, proxy = OK.proxy) => parseNovaContaInput({ proxy, conta: { ...OK.conta, ...conta } });
    expect(com({}, "")).toHaveProperty("error");
    expect(com({}, "sem-porta")).toHaveProperty("error");
    expect(com({ email: "maria" })).toHaveProperty("error");
    expect(com({ senha: "123" })).toHaveProperty("error");
    expect(com({ senha: "çenha123" })).toHaveProperty("error");
    expect(com({ nome: "" })).toHaveProperty("error");
    expect(com({ nome: "João" })).toHaveProperty("error");
    expect(com({ usuario: "maria silva" })).toHaveProperty("error");
    expect(com({ nascimento: "31/02/2001" })).toHaveProperty("error");
    expect(com({ nascimento: "2001-03-15" })).toHaveProperty("error");
  });
});

describe("Criar instância: andamento do agente", () => {
  it("lê etapas válidas, sem repetir chave", () => {
    expect(
      parseJobSteps([
        { key: "copiar", status: "done", message: "instância #3" },
        { key: "copiar", status: "error" },
        { key: "ids", status: "parado" },
        { key: "IMEI", status: "done" },
        { key: "abrir", status: "running" },
      ])
    ).toEqual([
      { key: "copiar", status: "done", message: "instância #3" },
      { key: "abrir", status: "running", message: null },
    ]);
  });

  it("lê updates: índice só inteiro, erro ganha mensagem, pedido só enquanto roda", () => {
    expect(
      parseJobUpdates([
        { id: UUID, instanceIndex: 4, steps: [], status: "running", prompt: { tipo: "codigo", texto: "Digite" } },
        { id: UUID, instanceIndex: "4", steps: [], status: "error", prompt: { tipo: "codigo", texto: "x" } },
        { id: UUID, steps: [], status: "running" },
        { id: "x", status: "done" },
        { id: UUID, status: "queued" },
      ])
    ).toEqual([
      { id: UUID, instanceIndex: 4, steps: [], status: "running", error: null, prompt: { tipo: "codigo", texto: "Digite" } },
      { id: UUID, instanceIndex: undefined, steps: [], status: "error", error: "Erro sem mensagem.", prompt: null },
      { id: UUID, instanceIndex: undefined, steps: [], status: "running", error: null, prompt: undefined },
    ]);
  });

  it("pedido ao dono só codigo ou manual", () => {
    expect(parseJobPrompt({ tipo: "manual", texto: "Resolva" })).toEqual({ tipo: "manual", texto: "Resolva" });
    expect(parseJobPrompt({ tipo: "senha", texto: "x" })).toBeNull();
    expect(parseJobPrompt(null)).toBeNull();
  });

  it("as etapas do SaaS são as mesmas do agente, na mesma ordem (Instagram antes da proxy)", () => {
    const chaves = NOVA_CONTA_FLUXO.map((s) => s.key);
    expect(NOVA_CONTA.map((e: { chave: string }) => e.chave)).toEqual(chaves);
    expect(chaves.indexOf("instagram")).toBeLessThan(chaves.indexOf("proxy"));
    expect(chaves.indexOf("proxy")).toBeLessThan(chaves.indexOf("cadastro"));
  });
});

describe("agente: nome da instância e proxy", () => {
  it("nome = @ pedido, senão a parte do Gmail", () => {
    expect(nomeDaInstancia({ id: UUID }, { conta: { usuario: "maria.silva", email: "x@gmail.com" } })).toBe("maria.silva");
    expect(nomeDaInstancia({ id: UUID }, { conta: { usuario: "", email: "afternoon.12@gmail.com" } })).toBe("afternoon.12");
    expect(nomeDaInstancia({ id: UUID }, { conta: {} })).toBe("conta-33333333");
  });

  it("instanceName limpa o nome digitado na aba", () => {
    expect(instanceName("  conta  nova #1 ")).toBe("conta nova 1");
    expect(instanceName("💥")).toBeNull();
    expect(instanceName(5)).toBeNull();
  });

  it("lerProxy desmonta a URL normalizada", () => {
    expect(lerProxy("http://usu%40rio:se%3Anha@sv2.exemplo.com:10114")).toEqual({
      host: "sv2.exemplo.com",
      porta: "10114",
      usuario: "usu@rio",
      senha: "se:nha",
    });
  });
});

describe("identidade da cópia", () => {
  it("dígito verificador de um IMEI conhecido", () => {
    expect(digitoLuhn("49015420323751")).toBe(8);
    expect(imeiValido("490154203237518")).toBe(true);
    expect(imeiValido("490154203237519")).toBe(false);
  });

  it("gera IMEI de 15 dígitos válido, Android ID hex e MAC unicast", () => {
    for (let i = 0; i < 200; i++) {
      const imei = gerarImei();
      expect(imei).toMatch(/^35\d{13}$/);
      expect(imeiValido(imei)).toBe(true);
      expect(gerarAndroidId()).toMatch(/^[0-9a-f]{16}$/);
      const mac = gerarMac();
      expect(mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
      expect(parseInt(mac.slice(0, 2), 16) & 0x03).toBe(0);
    }
  });
});

describe("aviso de conta travada no telefone", () => {
  const job = (over: Partial<EmulatorJob>): EmulatorJob => ({
    id: UUID,
    agentId: "pc",
    label: "julia",
    templateIndex: 0,
    instanceIndex: 1,
    steps: [{ key: "nome", status: "done", message: "julia_santana4738" }],
    status: "error",
    error: ALERTA_TELEFONE,
    prompt: null,
    createdAt: "2026-11-01T19:00:00Z",
    updatedAt: "2026-11-01T19:10:00Z",
    ...over,
  });

  it("o texto é o mesmo no agente e no SaaS", () => {
    expect(ALERTA_AGENTE).toBe(ALERTA_TELEFONE);
    expect(ALERTA_TELEFONE).toBe("Conta ERRO CRIAÇÃO, verificar com numero telefone");
  });

  it("marca a instância que ainda tem o nome que a conta deu", () => {
    const inst = [{ index: 0, name: "Android Device" }, { index: 1, name: "julia_santana4738" }];
    expect(instanceAlerts([job({})], "pc", inst)).toEqual(new Map([[1, ALERTA_TELEFONE]]));
  });

  it("não marca índice reaproveitado por outra instância, outro PC nem outro erro", () => {
    expect(instanceAlerts([job({})], "pc", [{ index: 1, name: "outra_conta" }]).size).toBe(0);
    expect(instanceAlerts([job({ agentId: "outro" })], "pc", [{ index: 1, name: "julia_santana4738" }]).size).toBe(0);
    expect(instanceAlerts([job({ error: "Proxy no NekoBox: falhou" })], "pc", [{ index: 1, name: "julia_santana4738" }]).size).toBe(0);
  });
});

describe("Editar dados", () => {
  const atual = {
    proxy: "http://u1:s1@sv2.exemplo.com:10114",
    conta: { email: "velho@gmail.com", senha: "segredo123", nome: "Julia Santana", usuario: "julia_santana4738", nascimento: "15/03/2001" },
  };
  const feitas = ["copiar", "ids", "nome", "abrir", "instagram", "proxy", "limpar"].map((key) => ({ key, status: "done" as const, message: null }));
  const passos = [...feitas, { key: "cadastro", status: "error" as const, message: "travou" }];
  const formulario = (over: Record<string, string> = {}) => ({
    proxy: "",
    conta: { email: "velho@gmail.com", senha: "", nome: "Julia Santana", usuario: "julia_santana4738", nascimento: "15/03/2001", ...over },
  });

  it("senha e proxy em branco mantêm as atuais", () => {
    const r = mergeEdit(atual, formulario());
    expect(r).toEqual({ value: atual });
  });

  it("mostra só host:porta da proxy, sem credenciais", () => {
    expect(editableFrom(atual)).toEqual({
      email: "velho@gmail.com",
      nome: "Julia Santana",
      usuario: "julia_santana4738",
      nascimento: "15/03/2001",
      proxyHost: "sv2.exemplo.com:10114",
    });
  });

  it("sem mudança = Continuar (só tira a etapa que falhou)", () => {
    expect(stepsAfterEdit(passos, atual, atual).map((s) => s.key)).toEqual(feitas.map((s) => s.key));
  });

  it("Gmail novo: zera o Instagram e refaz o cadastro, mantém o resto", () => {
    const r = mergeEdit(atual, formulario({ email: "novo@gmail.com" }));
    if (!("value" in r)) throw new Error("devia aceitar");
    expect(stepsAfterEdit(passos, atual, r.value).map((s) => s.key)).toEqual(["copiar", "ids", "nome", "abrir", "instagram", "proxy"]);
  });

  it("proxy nova refaz a proxy; @ novo renomeia a instância", () => {
    const r = mergeEdit(atual, { ...formulario({ usuario: "outra.conta" }), proxy: "novo.host:8080:u2:s2" });
    if (!("value" in r)) throw new Error("devia aceitar");
    expect(r.value.proxy).toBe("http://u2:s2@novo.host:8080");
    expect(stepsAfterEdit(passos, atual, r.value).map((s) => s.key)).toEqual(["copiar", "ids", "abrir", "instagram"]);
  });
});
