import { describe, expect, it } from "vitest";
import { PASTA_CRIADAS, PASTA_FALHAS, PASTA_RODANDO, PASTA_MAX, SEM_PASTA, ehPastaFixa, elegiveisDaPasta, filtrarPorPasta, gruposDePasta, normalizarPasta, pastaAoTerminar, pastasDasContas } from "../lib/vps/pastas";
import { errosPorCampo, expandirEtapas, parseEstrutura } from "../lib/vps/estruturacao";

const conta = (id: string, extra: Partial<{ status: string; pasta: string | null; label: string; kind: string }> = {}) => ({
  id,
  kind: "nova-conta",
  status: "done",
  label: id,
  pasta: null as string | null,
  ...extra,
});

describe("Pastas: nome, lista e filtro", () => {
  it("normaliza o nome; vazio e o valor de Sem pasta viram null", () => {
    expect(normalizarPasta("  Lote   novembro ")).toBe("Lote novembro");
    expect(normalizarPasta("")).toBeNull();
    expect(normalizarPasta("   ")).toBeNull();
    expect(normalizarPasta(SEM_PASTA)).toBeNull();
    expect(normalizarPasta(42)).toBeNull();
    expect([...(normalizarPasta("x".repeat(60)) ?? "")]).toHaveLength(PASTA_MAX);
  });

  it("lista as pastas com o número de contas (só contas, sem estruturação) e filtra", () => {
    const jobs = [
      conta("a", { pasta: "Novembro" }),
      conta("b", { pasta: "Novembro" }),
      conta("c", { pasta: "Agência" }),
      conta("d"),
      { id: "e", kind: "estruturacao", status: "done", label: "a", pasta: "Novembro" },
    ];
    expect(pastasDasContas(jobs)).toEqual([
      { nome: "Agência", contas: 1 },
      { nome: "CRIADAS", contas: 0 },
      { nome: "FALHAS", contas: 0 },
      { nome: "Novembro", contas: 2 },
    ]);
    expect(filtrarPorPasta(jobs, "").length).toBe(5);
    expect(filtrarPorPasta(jobs, SEM_PASTA).map((j) => j.id)).toEqual(["d"]);
    expect(filtrarPorPasta(jobs, "Agência").map((j) => j.id)).toEqual(["c"]);
  });
});

describe("Estruturar pasta: quem entra", () => {
  const plano = expandirEtapas({ alvos: [{ perfil: "link.zada", destaque: "AQUI", link: "" }], bio: "", fazerPerfil: true, fazerOauth: true, fazerStory: true });
  const tudoFeito = { status: "done", plano, steps: plano.map((p) => ({ key: p.key, status: "done" })) };

  it("só contas criadas da pasta, sem estruturação na fila e ainda não prontas", () => {
    const contas = [
      conta("pronta", { pasta: "P" }),
      conta("fila", { pasta: "P" }),
      conta("falhou", { pasta: "P" }),
      conta("nova", { pasta: "P" }),
      conta("criando", { pasta: "P", status: "running" }),
      conta("outra", { pasta: "Q" }),
    ];
    const estruturas: Record<string, { status: string; plano?: typeof plano; steps: Array<{ key: string; status: string; message?: string | null }> }> = {
      pronta: tudoFeito,
      fila: { status: "queued", plano, steps: [] },
      falhou: { status: "error", plano, steps: plano.map((p) => ({ key: p.key, status: p.key === "link-1" ? "error" : "done", message: "não abriu" })) },
    };
    const r = elegiveisDaPasta(contas, "P", (id) => estruturas[id]);
    expect(r.elegiveis.map((c) => c.id)).toEqual(["falhou", "nova"]);
    expect(r.puladas).toEqual([
      { label: "@pronta", motivo: "já está pronta" },
      { label: "@fila", motivo: "já tem estruturação na fila" },
      { label: "@criando", motivo: "ainda não foi criada" },
    ]);
    expect(elegiveisDaPasta([conta("x"), conta("y", { pasta: "P" })], null, () => null).elegiveis.map((c) => c.id)).toEqual(["x"]);
  });
});

describe("Estruturar sem a foto de perfil (é da criação de conta)", () => {
  it("o formulário passa sem foto de perfil e o plano não tem a etapa foto", () => {
    const form = { fotoStory: "s.png", bio: "oi", perfil: "link.zada", nomeDestaque: "AQUI", linkStory: "https://x.com", agendarHoras: 0 };
    expect(errosPorCampo(form, ["s.png"])).toEqual({});
    const lido = parseEstrutura(form, ["s.png"]);
    if (!("value" in lido)) throw new Error(lido.error);
    expect(expandirEtapas(lido.value).map((p) => p.key)).not.toContain("foto");
  });
});

describe("Abas Criadas/Estruturadas com as pastas", () => {
  const plano = expandirEtapas({ alvos: [{ perfil: "link.zada", destaque: "AQUI", link: "" }], bio: "", fazerPerfil: true, fazerOauth: true, fazerStory: true });
  const pronta = { status: "done", plano, steps: plano.map((p) => ({ key: p.key, status: "done" })) };
  const soConectada = { status: "error", plano, steps: plano.map((p) => ({ key: p.key, status: p.key === "destacar" ? "error" : "done", message: "travou" })) };

  it("selo verde vai para Estruturadas; o resto fica em Criadas, cada uma com as suas pastas e Sem pasta por último", () => {
    const contas = [
      conta("a", { pasta: "Novembro" }),
      conta("b", { pasta: "Novembro" }),
      conta("c", { pasta: "Novembro", status: "running" }),
      conta("d"),
      conta("e", { pasta: "Agência" }),
    ];
    const est: Record<string, typeof pronta> = { a: pronta, e: soConectada };
    const g = gruposDePasta(contas, (id) => est[id]);
    expect(g.estruturadas.map((p) => [p.nome, p.contas.map((c) => c.id), p.resumo])).toEqual([
      ["Agência", ["e"], ["1 só conectada"]],
      ["Novembro", ["a"], ["1 pronta para postar"]],
    ]);
    expect(g.criadas.map((p) => [p.nome, p.contas.map((c) => c.id), p.resumo])).toEqual([
      ["RODANDO", ["c"], ["1 criando"]],
      ["CRIADAS", [], []],
      ["FALHAS", [], []],
      ["Novembro", ["b"], ["1 para estruturar"]],
      ["Sem pasta", ["d"], ["1 para estruturar"]],
    ]);
    expect(g.criadas[4].chave).toBe(SEM_PASTA);
  });
});

describe("Linha de resumo sem rodada de criação", () => {
  it("conta só as contas (não as estruturações) e as conectadas pelo selo", async () => {
    const { resumoDasContas } = await import("../lib/vps/pastas");
    const plano = expandirEtapas({ alvos: [{ perfil: "link.zada", destaque: "AQUI", link: "" }], bio: "", fazerPerfil: true, fazerOauth: true, fazerStory: true });
    const jobs = [
      conta("a"),
      conta("b"),
      conta("c", { status: "error" }),
      conta("d", { status: "queued" }),
      { id: "e1", kind: "estruturacao", status: "done", label: "a", contaId: "a", plano, steps: plano.map((p) => ({ key: p.key, status: "done" })) },
      { id: "e2", kind: "estruturacao", status: "error", label: "b", contaId: "b", plano, steps: plano.map((p) => ({ key: p.key, status: p.key === "link-1" ? "error" : "done", message: "x" })) },
    ];
    expect(resumoDasContas(jobs)).toEqual({ total: 4, criadas: 2, prontas: 1, criando: 1, falhas: 1 });
  });
});

describe("Conectada no SaaS conta como estruturada", () => {
  it("sem registro do Estruturar, a conta em Contas do Instagram vai para Estruturadas e soma no resumo", async () => {
    const { resumoDasContas } = await import("../lib/vps/pastas");
    const contas = [conta("josianecavalcanti85432", { pasta: "PRONTAS" }), conta("outra", { pasta: "PRONTAS" })];
    const g = gruposDePasta(contas, () => null, new Set(["josianecavalcanti85432"]));
    expect(g.estruturadas.map((p) => [p.nome, p.contas.map((c) => c.id), p.resumo])).toEqual([["PRONTAS", ["josianecavalcanti85432"], ["1 pronta para postar"]]]);
    expect(g.criadas.map((p) => p.contas.map((c) => c.id))).toEqual([[], [], [], ["outra"]]);
    expect(resumoDasContas(contas, new Set(["josianecavalcanti85432"])).prontas).toBe(1);
  });
});

describe("Pastas fixas CRIADAS e FALHAS", () => {
  it("conta que termina vai para CRIADAS (concluída) ou FALHAS (erro); rodando não muda", () => {
    expect(pastaAoTerminar("done")).toBe(PASTA_CRIADAS);
    expect(pastaAoTerminar("error")).toBe(PASTA_FALHAS);
    expect(pastaAoTerminar("running")).toBeNull();
    expect(pastaAoTerminar("queued")).toBeNull();
  });
  it("não se renomeiam e o nome digitado em outra caixa cai na pasta fixa", () => {
    expect(ehPastaFixa("CRIADAS")).toBe(true);
    expect(ehPastaFixa(" falhas ")).toBe(true);
    expect(ehPastaFixa("Novembro")).toBe(false);
    expect(normalizarPasta("criadas")).toBe(PASTA_CRIADAS);
    expect(normalizarPasta("Falhas")).toBe(PASTA_FALHAS);
  });
  it("aparecem primeiro na aba Criadas; Estruturar pasta CRIADAS só pega as concluídas", () => {
    const contas = [
      conta("ok", { pasta: PASTA_CRIADAS }),
      conta("ruim", { pasta: PASTA_FALHAS, status: "error" }),
      conta("z", { pasta: "Antiga" }),
      conta("criando", { pasta: PASTA_CRIADAS, status: "running" }),
      conta("fila", { pasta: "Novembro", status: "queued" }),
    ];
    const g = gruposDePasta(contas, () => null);
    expect(g.criadas.map((p) => [p.nome, p.contas.map((c) => c.id)])).toEqual([
      [PASTA_RODANDO, ["criando", "fila"]],
      ["CRIADAS", ["ok"]],
      ["FALHAS", ["ruim"]],
      ["Antiga", ["z"]],
    ]);
    expect(ehPastaFixa("rodando")).toBe(true);
    expect(normalizarPasta("Rodando")).toBeNull();
    expect(elegiveisDaPasta(contas, PASTA_CRIADAS, () => null).elegiveis.map((c) => c.id)).toEqual(["ok"]);
  });
});
