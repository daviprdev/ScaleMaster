import { describe, expect, it } from "vitest";
import { ESTRUTURACAO, dadosDoStory, nomeDoDestaqueDaConta } from "../agente-vps/fluxos/estruturacao.mjs";
import { DESTAQUE_POR_PREFIXO_FALHOU, abrirDestaque, bateDestaque, escolherDestaque, itensDaFaixa, normalizarDestaque } from "../agente-vps/fluxos/oauth.mjs";
import { expandirEtapas, parseEstrutura } from "../lib/vps/estruturacao";

const IG = "com.instagram.android";
type No = { texto: string; descricao: string; id: string; classe: string; pacote: string; clicavel: boolean; focado: boolean; x: number; y: number };
const no = (extra: Partial<No>): No => ({ texto: "", descricao: "", id: "", classe: "", pacote: IG, clicavel: false, focado: false, x: 100, y: 500, ...extra });

/** Topo do perfil com a faixa de destaques (rótulos embaixo das capas, na mesma altura). */
const perfilCom = (titulos: string[]) => [
  no({ texto: "link.zada", y: 150 }),
  no({ texto: "120", y: 400 }),
  no({ texto: "seguidores", y: 440 }),
  no({ texto: "Seguir", clicavel: true, y: 700 }),
  no({ texto: "Mensagem", clicavel: true, x: 600, y: 700 }),
  ...titulos.map((t, i) => no({ texto: t, id: `${IG}:id/highlight_title`, x: 120 + i * 200, y: 960 })),
];

describe("Destaque: normalização do texto", () => {
  it("tira emoji, acento, caixa e tudo que não é letra; vazio fica vazio", () => {
    expect(normalizarDestaque("AQUI 🔗👆")).toBe("aqui");
    expect(normalizarDestaque("Aquí")).toBe("aqui");
    expect(normalizarDestaque("AQUI")).toBe("aqui");
    expect(normalizarDestaque("  aQuI!! 2026 ✨")).toBe("aqui");
    expect(normalizarDestaque("Promoção")).toBe("promocao");
    expect(normalizarDestaque("🔗👆")).toBe("");
    expect(normalizarDestaque("")).toBe("");
    expect(normalizarDestaque(undefined)).toBe("");
  });

  it("prefixo: AQUI 🔗👆, Aqui e AQUI batem com o nome configurado; outro destaque não", () => {
    for (const visto of ["AQUI 🔗👆", "Aqui", "AQUI", "aqui 👇 link", "AQUI…"]) expect(bateDestaque(visto, "AQUI 🔗👆"), visto).toBe(true);
    expect(bateDestaque("Ofertas", "AQUI 🔗👆")).toBe(false);
    // Nome só de emoji não bate com nada (cai no fallback).
    expect(bateDestaque("🔗", "🔗👆")).toBe(false);
    expect(bateDestaque("", "AQUI")).toBe(false);
  });
});

describe("Destaque: qual abrir", () => {
  it("acha pelo prefixo mesmo fora de ordem; a faixa sai da esquerda para a direita e sem os botões do topo", () => {
    const nos = perfilCom(["Ofertas", "Aqui", "Dúvidas"]);
    expect(itensDaFaixa(nos).map((i: { texto: string }) => i.texto)).toEqual(["Ofertas", "Aqui", "Dúvidas"]);
    const e = escolherDestaque(nos, "AQUI 🔗👆");
    expect(e).toMatchObject({ texto: "Aqui", porPrefixo: true });
    expect(e?.no.x).toBe(320);
  });

  it("sem id no dump: lê pela linha de textos curtos alinhados (a faixa)", () => {
    const nos = [
      no({ texto: "link.zada", y: 150 }),
      no({ texto: "Seguir", clicavel: true, y: 700 }),
      no({ texto: "Mensagem", clicavel: true, x: 600, y: 700 }),
      no({ texto: "Novidades", x: 120, y: 962 }),
      no({ texto: "AQUI 🔗👆", x: 320, y: 958 }),
    ];
    expect(escolherDestaque(nos, "AQUI 🔗👆")).toMatchObject({ texto: "AQUI 🔗👆", porPrefixo: true });
  });

  it("nenhum bate: o primeiro da faixa, marcado como fallback", () => {
    const e = escolherDestaque(perfilCom(["Ofertas", "Dúvidas"]), "AQUI 🔗👆");
    expect(e).toMatchObject({ texto: "Ofertas", porPrefixo: false });
  });

  it("faixa vazia: null", () => {
    expect(escolherDestaque(perfilCom([]), "AQUI 🔗👆")).toBeNull();
    expect(itensDaFaixa([])).toEqual([]);
  });

  it("abrirDestaque: fallback loga DESTAQUE_POR_PREFIXO_FALHOU e toca no primeiro; faixa vazia falha a etapa", async () => {
    const logs: string[] = [];
    const toques: Array<[number, number]> = [];
    let aberto = false;
    const d = {
      tela: async () => (aberto ? [no({ descricao: "story", y: 900 })] : perfilCom(["Ofertas", "Dúvidas"])),
      tocar: async (x: number, y: number) => {
        toques.push([x, y]);
        aberto = true;
      },
      focoAtual: async () => "",
    };
    const msg = await abrirDestaque({ d, log: (m: string) => logs.push(m) }, "AQUI 🔗👆");
    expect(msg).toBe(`${DESTAQUE_POR_PREFIXO_FALHOU}: abri o primeiro destaque ("Ofertas")`);
    expect(logs[0]).toMatch(new RegExp(`^${DESTAQUE_POR_PREFIXO_FALHOU}: nenhum destaque bate com "AQUI 🔗👆"; abrindo o primeiro da faixa \\("Ofertas"\\)`));
    // Toca na capa (acima do rótulo).
    expect(toques[0]).toEqual([120, 870]);

    const vazio = { tela: async () => perfilCom([]), tocar: async () => {}, focoAtual: async () => "" };
    const t0 = Date.now();
    const erro = await abrirDestaque({ d: vazio, log: () => {} }, "AQUI").catch((e: Error) => e);
    expect((erro as Error).message).toMatch(/^a faixa de destaques do perfil está vazia/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(14_000);
  }, 30_000);
});

describe("Fluxo com os campos do diálogo", () => {
  const BASE = {
    fotoPerfil: "a.jpg",
    fotoStory: "b.png",
    bio: "",
    perfil: "@link.zada",
    nomeDestaque: "AQUI 🔗👆",
    linkStory: "https://minha.oferta/xyz",
    legendaSticker: "Clique aqui 👉",
    legendaDestaque: "",
    agendarHoras: "0",
  };

  it("perfil e destaque do alvo saem dos campos; story e destacar usam o link, a legenda e o nome do destaque", async () => {
    const r = parseEstrutura(BASE, ["a.jpg", "b.png"]);
    if (!("value" in r)) throw new Error(r.error);
    const input = { ...r.value, plano: expandirEtapas(r.value), conta: { usuario: "minha.conta", senha: "x" }, pais: "BR" };
    expect(input.alvos[0]).toEqual({ perfil: "link.zada", destaque: "AQUI 🔗👆", link: "" });
    expect(input.linkStory).toBe("https://minha.oferta/xyz");
    expect(input.legenda).toBe("Clique aqui 👉");
    expect(input.destaque).toBe("AQUI 🔗👆");
    // O sticker do story leva exatamente o link informado, e a legenda dele; o destaque da conta, o nome com o emoji.
    expect(dadosDoStory(input)).toEqual({ link: "https://minha.oferta/xyz", texto: "Clique aqui 👉" });
    expect(nomeDoDestaqueDaConta(input)).toBe("AQUI 🔗👆");
    expect(nomeDoDestaqueDaConta({ ...input, destaque: "Ofertas 🔥" })).toBe("Ofertas 🔥");
    // Job antigo (sem linkStory): o link do primeiro alvo.
    expect(dadosDoStory({ alvos: [{ link: "https://antigo.com" }], legenda: "duas\nlinhas" })).toEqual({ link: "https://antigo.com", texto: "duas linhas" });
    const fluxo = ESTRUTURACAO(input) as Array<{ chave: string; rotulo: string }>;
    expect(fluxo.find((e) => e.chave === "perfil-1")?.rotulo).toBe("Alvo 1: abrir o perfil @link.zada");
    expect(fluxo.find((e) => e.chave === "destaque-1")?.rotulo).toBe('Alvo 1: abrir o destaque "AQUI 🔗👆"');
  });
});
