import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PORTAL_PADRAO, parseLinhaPortal, parseLinhasPortal, parseLoteInput } from "../lib/vps/input";
import { criarCaixa, descricaoCaixa } from "../agente-vps/fluxos/caixa.mjs";
import { codigoValido, mascarar } from "../agente-vps/lib/portal.mjs";

const LINK = "https://hridoyhub.shop/OTP/";
const base = { agentId: "a1", perfil: "aleatorio", versaoIg: "454.0.0.54.77", pais: "BR" };
const proxies = (n: number) => Array.from({ length: n }, (_, i) => `p${i}.exemplo.com:${1000 + i}:u:s`).join("\n");

describe("Códigos do hstock: fonte única do lote", () => {
  it("o mesmo link repetido em todas as linhas é o caso normal; contas na ordem 1..N", () => {
    const codigos = `${LINK} | AAAAAA\n${LINK} | BBBBBB\n${LINK} | CCCCCC`;
    const r = parseLoteInput({ ...base, codigos, proxies: proxies(3) });
    expect(r).toHaveProperty("value");
    if (!("value" in r)) return;
    expect(r.value.quantidade).toBe(3);
    expect(r.value.contas.map((c) => c.email)).toEqual([LINK, LINK, LINK]);
    expect(r.value.contas.map((c) => c.senhaEmail)).toEqual(["AAAAAA", "BBBBBB", "CCCCCC"]);
    expect(r.value.contas.every((c) => c.provedorEmail === "portal")).toBe(true);
  });

  it("linha só com código usa o link padrão", () => {
    expect(parseLinhaPortal("SUDXHRAY")).toEqual({ link: PORTAL_PADRAO, codigo: "SUDXHRAY" });
    const r = parseLoteInput({ ...base, codigos: "SUDXHRAY\nYR8T9LSD", proxies: proxies(2) });
    expect(r).toHaveProperty("value");
    if ("value" in r) expect(r.value.contas.map((c) => c.email)).toEqual([PORTAL_PADRAO, PORTAL_PADRAO]);
  });

  it("parser tolerante: trim, espaços em volta do |, linha vazia descartada, código em maiúsculas", () => {
    expect(parseLinhaPortal(`   ${LINK}   |   sudxhray   `)).toEqual({ link: LINK, codigo: "SUDXHRAY" });
    expect(parseLinhaPortal(`${LINK}|SUDXHRAY`)).toEqual({ link: LINK, codigo: "SUDXHRAY" });
    expect(parseLinhasPortal(`\n  ${LINK} | AAAAAA  \n\n\nBBBBBB\n   \n`)).toEqual([
      { link: LINK, codigo: "AAAAAA" },
      { link: PORTAL_PADRAO, codigo: "BBBBBB" },
    ]);
  });

  it("linha inválida aponta o número e bloqueia: sem https, código curto/longo/com símbolo", () => {
    expect(parseLoteInput({ ...base, codigos: `${LINK} | AAAAAA\nhttp://x.com/OTP/ | BBBBBB`, proxies: proxies(2) })).toEqual({
      error: 'Linha 2 dos códigos fora do formato "link | código".',
    });
    expect(parseLoteInput({ ...base, codigos: `${LINK} | AAAAAA\n${LINK} | BBBBBB\n${LINK} | AB`, proxies: proxies(3) })).toEqual({
      error: 'Linha 3 dos códigos fora do formato "link | código".',
    });
    expect(parseLinhaPortal(`${LINK} | ABCDEFGHIJKLM`)).toBeNull();
    expect(parseLinhaPortal(`${LINK} | COD-12345`)).toBeNull();
    expect(codigoValido("SUDXHRAY")).toBe(true);
  });

  it("quantidade derivada das linhas válidas; proxies a menos bloqueia com a contagem; a mais são ignoradas", () => {
    const codigos = `${LINK} | AAAAAA\n${LINK} | BBBBBB\n${LINK} | CCCCCC\n${LINK} | DDDDDD`;
    expect(parseLoteInput({ ...base, codigos, proxies: proxies(2) })).toEqual({ error: "2 proxies para 4 contas: cole uma proxy por conta." });
    const ok = parseLoteInput({ ...base, codigos, proxies: proxies(6) });
    expect(ok).toHaveProperty("value");
    if ("value" in ok) {
      expect(ok.value.quantidade).toBe(4);
      expect(ok.value.proxies).toHaveLength(4);
      expect(ok.value.gerarPessoa).toBe(true);
    }
  });

  it("portalLink/portalCodigo do input_enc valem para a caixa; contas antigas caem em conta.email/imap.senha", () => {
    const novo = { provedorEmail: "portal", portalLink: LINK, portalCodigo: "SUDXHRAY", conta: { email: LINK, nome: "Ana" }, imap: { senha: "SUDXHRAY" } };
    expect(descricaoCaixa(novo)).toBe(`portal ${LINK} (código ${mascarar("SUDXHRAY")})`);
    const antigo = { provedorEmail: "portal", conta: { email: LINK }, imap: { senha: "YR8T9LSD" } };
    expect(descricaoCaixa(antigo)).toContain(mascarar("YR8T9LSD"));
    const chamadas: string[][] = [];
    const portal = {
      mascarar,
      codigoValido,
      abrir: async (link: string, codigo: string) => {
        chamadas.push([link, codigo]);
        return { sessao: { modo: "http", email: "x@gmail.com", fimEm: Date.now() + 60_000 }, email: "x@gmail.com" };
      },
      esperarOtp: async () => "123456",
      fechar: async () => {},
      verificarPortal: async () => true,
    };
    const caixa = criarCaixa({ ...novo, portalCodigo: "ZZZZZZ" }, { portal });
    return caixa.endereco().then(() => expect(chamadas).toEqual([[LINK, "ZZZZZZ"]]));
  });
});

describe("LoteDialog: nenhum campo de e-mail por conta", () => {
  const fonte = readFileSync(new URL("../components/dashboard/vps/LoteDialog.tsx", import.meta.url), "utf8");

  it("só os textareas de proxies e códigos; sem Link do portal, Código de resgate, E-mail ou campos da pessoa", () => {
    expect(fonte).not.toMatch(/Link do portal/);
    expect(fonte).not.toMatch(/Código de resgate/);
    expect(fonte).not.toMatch(/label="E-mail"/);
    expect(fonte).not.toMatch(/type="email"/);
    expect(fonte).not.toMatch(/Senha do Instagram|Nome completo|Nascimento|Usuário \(opcional\)|Host IMAP|Porta IMAP/);
    expect(fonte).not.toMatch(/<fieldset/);
    expect(fonte).toMatch(/label="Códigos do hstock"/);
    expect(fonte).toMatch(/label=\{`Proxies/);
    expect(fonte).toMatch(/Enviar \{quantidade/);
    expect(fonte).toMatch(/proxies para \$\{quantidade\} contas/);
    expect(fonte).toMatch(/gerados automaticamente/);
  });
});
