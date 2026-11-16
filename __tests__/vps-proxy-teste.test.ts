import { beforeEach, describe, expect, it, vi } from "vitest";
import { classificarTentativa, entraNoLote, testarProxies, testarProxy, type Tentativa } from "../lib/vps/testar-proxy";
import { classificarTentativa as classificarCurl, proxyUsavel, testarProxy as testarProxyAgente } from "../agente-vps/lib/teste-proxy.mjs";
import { limparCacheGeo, validar, validarNoNetns } from "../agente-vps/lib/rede.mjs";
import { CODIGO_VENCIDO, JANELA_MINIMA_MS, conferirCaixa, criarCaixa, janelaGravada } from "../agente-vps/fluxos/caixa.mjs";
import { camposDoPortal, estadoDoCodigo, mascararCodigo } from "../lib/vps/codigo-portal";
import { sobrasDoLote } from "../lib/vps/lote-sobras";
import { parseJobUpdates } from "../lib/emulador/jobs";
import { parseLoteInput } from "../lib/vps/input";

const PROXY = "http://user:pass@sv2.exemplo.com:10611";
const semPausa = async () => {};

describe("Importação: classificação por código HTTP", () => {
  it("204/200 = ok, 407 = credencial, 429 = limitada, outro status = outro", () => {
    expect(classificarTentativa({ status: 204, ms: 300 })).toBe("ok");
    expect(classificarTentativa({ status: 200, ms: 300 })).toBe("ok");
    expect(classificarTentativa({ status: 407, ms: 300 })).toBe("credencial");
    expect(classificarTentativa({ status: 429, ms: 300 })).toBe("limitada");
    expect(classificarTentativa({ status: 502, ms: 300 })).toBe("outro");
  });
  it("conexão recusada / host inexistente = recusada; timeout e reset = morta", () => {
    expect(classificarTentativa({ erro: "ECONNREFUSED", ms: 5 })).toBe("recusada");
    expect(classificarTentativa({ erro: "ENOTFOUND", ms: 5 })).toBe("recusada");
    expect(classificarTentativa({ erro: "ETIMEDOUT", ms: 25_000 })).toBe("morta");
    expect(classificarTentativa({ erro: "ECONNRESET", ms: 5 })).toBe("morta");
  });
});

describe("Importação: tentativas antes de declarar morta", () => {
  it("timeout persistente: 3 tentativas com 2 pausas de 5 s, depois morta", async () => {
    const tentar = vi.fn(async (): Promise<Tentativa> => ({ erro: "ETIMEDOUT", ms: 25_000 }));
    const pausa = vi.fn(semPausa);
    const r = await testarProxy(PROXY, { tentar, pausa });
    expect(r.estado).toBe("morta");
    expect(tentar).toHaveBeenCalledTimes(3);
    expect(pausa).toHaveBeenCalledTimes(2);
    expect(pausa).toHaveBeenCalledWith(5_000);
    expect(r.motivo).toContain("3 tentativas");
  });
  it("falha passageira: a 2ª tentativa responde e a proxy é viva", async () => {
    const respostas: Tentativa[] = [{ erro: "ETIMEDOUT", ms: 25_000 }, { status: 204, ms: 900 }];
    const tentar = vi.fn(async () => respostas.shift() as Tentativa);
    const r = await testarProxy(PROXY, { tentar, pausa: semPausa });
    expect(r).toMatchObject({ estado: "viva", tentativas: 2 });
    expect(entraNoLote(r.estado)).toBe(true);
  });
  it("407 não repete; 429 não é culpa da proxy (entra); acima de 6 s é lenta (fica fora)", async () => {
    const t407 = vi.fn(async (): Promise<Tentativa> => ({ status: 407, ms: 200 }));
    expect((await testarProxy(PROXY, { tentar: t407, pausa: semPausa })).estado).toBe("credencial");
    expect(t407).toHaveBeenCalledTimes(1);
    const r429 = await testarProxy(PROXY, { tentar: async () => ({ status: 429, ms: 200 }), pausa: semPausa });
    expect(r429.estado).toBe("limitada");
    expect(entraNoLote(r429.estado)).toBe(true);
    const lenta = await testarProxy(PROXY, { tentar: async () => ({ status: 204, ms: 7_500 }), pausa: semPausa });
    expect(lenta.estado).toBe("lenta");
    expect(entraNoLote(lenta.estado)).toBe(false);
  });
  it("recusada em todas = host/porta", async () => {
    const r = await testarProxy(PROXY, { tentar: async () => ({ erro: "ECONNREFUSED", ms: 3 }), pausa: semPausa });
    expect(r.estado).toBe("recusada");
  });
  it("testarProxies devolve na ordem da lista", async () => {
    const estados = ["viva", "morta", "lenta"] as const;
    const out = await testarProxies(["a", "b", "c"], { testar: async (u) => ({ estado: estados[["a", "b", "c"].indexOf(u)], motivo: "", ms: null, tentativas: 1 }) });
    expect(out.map((o) => o.estado)).toEqual(["viva", "morta", "lenta"]);
  });
});

describe("Agente: teste de vida antes de qualquer etapa", () => {
  const curl = (respostas: Array<{ codigo: number; stdout?: string; stderr?: string }>) => {
    const fila = [...respostas];
    return vi.fn(async () => {
      const r = fila.shift() ?? { codigo: 28 };
      return { codigo: r.codigo, estourou: false, stdout: r.stdout ?? "000 000", stderr: r.stderr ?? "" };
    });
  };
  it("classifica pelo exit do curl e pelo HTTP", () => {
    expect(classificarCurl({ codigo: 0, http: 204 }).estado).toBe("ok");
    expect(classificarCurl({ codigo: 0, http: 407 }).estado).toBe("credencial");
    expect(classificarCurl({ codigo: 56, http: 0, connect: 407 }).estado).toBe("credencial");
    expect(classificarCurl({ codigo: 0, http: 429 }).estado).toBe("limitada");
    expect(classificarCurl({ codigo: 7, http: 0 }).estado).toBe("recusada");
    expect(classificarCurl({ codigo: 28, http: 0 }).estado).toBe("morta");
    expect(classificarCurl({ codigo: 52, http: 0 }).estado).toBe("morta");
  });
  it("PROXY_MORTA só depois de 3 tentativas (curl 28 em todas)", async () => {
    const executar = curl([{ codigo: 28 }, { codigo: 28 }, { codigo: 28 }]);
    const pausa = vi.fn(semPausa);
    const r = await testarProxyAgente(PROXY, { executar, pausa });
    expect(r.estado).toBe("morta");
    expect(executar).toHaveBeenCalledTimes(3);
    expect(pausa).toHaveBeenCalledTimes(2);
    expect(proxyUsavel(r.estado)).toBe(false);
    // generate_204 primeiro, nunca endpoint de geo para decidir vida.
    expect(executar.mock.calls.every((c) => !String((c as unknown[])[1]).includes("ip-api"))).toBe(true);
  });
  it("timeout na 1ª e 204 na 2ª: segue (viva)", async () => {
    const executar = curl([{ codigo: 28 }, { codigo: 0, stdout: "204 000" }]);
    const r = await testarProxyAgente(PROXY, { executar, pausa: semPausa });
    expect(r.estado).toBe("viva");
    expect(proxyUsavel(r.estado)).toBe(true);
  });
  it("generate_204 com outro status: confere no robots.txt do Instagram", async () => {
    const executar = curl([{ codigo: 0, stdout: "403 000" }, { codigo: 0, stdout: "200 200" }]);
    const r = await testarProxyAgente(PROXY, { executar, pausa: semPausa });
    expect(r.estado).toBe("viva");
    expect(String((executar.mock.calls[1] as unknown[])[1])).toContain("instagram.com/robots.txt");
  });
});

describe("Agente: geo só na etapa geo, com cache e sem derrubar por 429", () => {
  beforeEach(() => limparCacheGeo());
  const geoOk = { codigo: 0, estourou: false, stdout: '{"status":"success","countryCode":"BR","timezone":"America/Sao_Paulo","query":"1.2.3.4"}\n200', stderr: "" };
  const geo429 = { codigo: 0, estourou: false, stdout: "too many\n429", stderr: "" };

  it("429 sem cache: segue com aviso, sem ProxyMorta", async () => {
    const executar = vi.fn(async () => geo429);
    const r = await validar(PROXY, "BR", { executar, pausa: semPausa });
    expect(r.aviso).toContain("429");
  });
  it("cache por host:porta:usuário: a mesma credencial não consulta de novo; outra sessão do gateway consulta", async () => {
    const executar = vi.fn(async () => geoOk);
    await validar(PROXY, "BR", { executar, pausa: semPausa });
    const r = await validar(PROXY, "BR", { executar, pausa: semPausa });
    expect(r.ip).toBe("1.2.3.4");
    expect(executar).toHaveBeenCalledTimes(1);
    // 16/11: cada usuário derivado (sessão) sai por outro IP — não pode herdar o geo de outra sessão.
    await validar(PROXY.replace("user:pass", "user-session-a1b2c3d4:pass"), "BR", { executar, pausa: semPausa });
    expect(executar).toHaveBeenCalledTimes(2);
  });
  it("429 com cache: usa o cache; país diferente continua sendo ProxyMorta", async () => {
    const executar = vi.fn(async () => geoOk);
    await validar(PROXY, "BR", { executar, pausa: semPausa });
    await expect(validar(PROXY, "US", { executar: vi.fn(async () => geo429), pausa: semPausa })).rejects.toThrow(/PROXY_MORTA: a proxy sai por BR/);
  });
  it("dentro do container: 3 tentativas no generate_204 antes do ProxyMorta", async () => {
    const executar = vi.fn(async () => ({ codigo: 52, estourou: false, stdout: "000", stderr: "curl: (52) Empty reply from server" }));
    const pausa = vi.fn(semPausa);
    await expect(validarNoNetns("ig-1", "BR", { executar, pausa })).rejects.toThrow(/PROXY_MORTA: dentro do container a proxy não respondeu em 3 tentativas/);
    expect(executar).toHaveBeenCalledTimes(3);
    expect(pausa).toHaveBeenCalledTimes(2);
  });
  it("dentro do container: Empty reply na 1ª e 204 na 2ª passa", async () => {
    const fila = [
      { codigo: 52, estourou: false, stdout: "000", stderr: "Empty reply" },
      { codigo: 0, estourou: false, stdout: "204", stderr: "" },
    ];
    const r = await validarNoNetns("ig-1", "BR", { executar: vi.fn(async () => fila.shift()!), pausa: semPausa });
    expect(r.pais).toBe("BR");
  });
});

describe("Código do portal: janela gravada e retomada", () => {
  const LINK = "https://hridoyhub.shop/OTP/";
  const base = { provedorEmail: "portal", portalLink: LINK, portalCodigo: "SUDXHRAY", conta: { email: LINK, nome: "Maria" }, imap: { senha: "SUDXHRAY" } };
  const daqui = (ms: number) => new Date(Date.now() + ms).toISOString();

  it("janelaGravada: só com e-mail e pelo menos 4 min de janela", () => {
    expect(janelaGravada({ ...base, portalEmail: "a@gmail.com", portalExpiraEm: daqui(10 * 60_000) })).toMatchObject({ email: "a@gmail.com" });
    expect(janelaGravada({ ...base, portalEmail: "a@gmail.com", portalExpiraEm: daqui(3 * 60_000) })).toBeNull();
    expect(janelaGravada({ ...base, portalExpiraEm: daqui(10 * 60_000) })).toBeNull();
  });

  it("retomada dentro da janela usa o endereço gravado e não toca no portal", async () => {
    const input = { ...base, portalResgatadoEm: daqui(-5 * 60_000), portalExpiraEm: daqui(12 * 60_000), portalEmail: "gravado@gmail.com" };
    const portal = {
      mascarar: (c: string) => c,
      codigoValido: () => true,
      abrir: vi.fn(),
      renovar: vi.fn(),
      statusDoCodigo: vi.fn(),
      verificarPortal: vi.fn(),
      esperarPortalNoAr: vi.fn(async () => true),
      fechar: vi.fn(async () => {}),
      sessaoGuardada: vi.fn((_l: string, _c: string, g: { email: string; fimEm: number }) => ({ modo: "http", email: g.email, fimEm: g.fimEm })),
    };
    expect(await conferirCaixa(input, { portal })).toContain("em uso até");
    const caixa = criarCaixa(input, { portal, log: () => {} });
    expect(await caixa.endereco()).toBe("gravado@gmail.com");
    expect(portal.abrir).not.toHaveBeenCalled();
    expect(portal.statusDoCodigo).not.toHaveBeenCalled();
    expect(portal.esperarPortalNoAr).not.toHaveBeenCalled();
    expect(portal.renovar).not.toHaveBeenCalled();
  });

  it("código já resgatado nunca volta ao formulário (semResgate) e a janela nova é gravada com o e-mail", async () => {
    const input = { ...base, portalResgatadoEm: daqui(-30 * 60_000), portalExpiraEm: daqui(-10 * 60_000) };
    const sessao = { modo: "http", email: "novo@gmail.com", fimEm: Date.now() + 19 * 60_000 };
    const portal = { mascarar: (c: string) => c, codigoValido: () => true, abrir: vi.fn(async () => ({ sessao, email: sessao.email })), renovar: vi.fn(), fechar: vi.fn(async () => {}), verificarPortal: vi.fn(), esperarPortalNoAr: vi.fn(async () => true) };
    const gravados: Array<{ resgatadoEm: string; email: string | null }> = [];
    const caixa = criarCaixa(input, { portal, log: () => {}, aoResgatar: (p: { resgatadoEm: string; expiraEm: string; email: string | null }) => gravados.push(p) });
    expect(await caixa.endereco()).toBe("novo@gmail.com");
    expect((portal.abrir.mock.calls[0] as unknown[])[2]).toMatchObject({ semResgate: true });
    // O resgate original não muda; o e-mail da janela nova vai para a conta.
    expect(gravados[0]).toMatchObject({ resgatadoEm: input.portalResgatadoEm, email: "novo@gmail.com" });
  });

  it("menos de 4 min de janela: Reactivate antes de usar", async () => {
    const sessao = { modo: "http", email: "velho@gmail.com", fimEm: Date.now() + 2 * 60_000 };
    const portal = {
      mascarar: (c: string) => c,
      codigoValido: () => true,
      abrir: vi.fn(async () => ({ sessao, email: sessao.email })),
      renovar: vi.fn(async (s: { email: string; fimEm: number }) => {
        s.email = "fresco@gmail.com";
        s.fimEm = Date.now() + 20 * 60_000;
      }),
      fechar: vi.fn(async () => {}),
      verificarPortal: vi.fn(),
      esperarPortalNoAr: vi.fn(async () => true),
    };
    const caixa = criarCaixa(base, { portal, log: () => {} });
    expect(await caixa.endereco()).toBe("fresco@gmail.com");
    expect(portal.renovar).toHaveBeenCalledTimes(1);
    expect(JANELA_MINIMA_MS).toBe(4 * 60_000);
  });

  it("menos de 4 min e sem reativação sobrando: CODIGO_VENCIDO (pede código novo)", async () => {
    const sessao = { modo: "http", email: "velho@gmail.com", fimEm: Date.now() + 60_000 + 30_000 };
    const gasto = Object.assign(new Error("o código já usou a única reativação do portal"), { codigoVencido: true });
    const portal = { mascarar: (c: string) => c, codigoValido: () => true, abrir: vi.fn(async () => ({ sessao, email: sessao.email })), renovar: vi.fn(async () => { throw gasto; }), fechar: vi.fn(async () => {}), verificarPortal: vi.fn(), esperarPortalNoAr: vi.fn(async () => true) };
    const caixa = criarCaixa(base, { portal, log: () => {}, esperaPortalMs: 0 });
    await expect(caixa.endereco()).rejects.toThrow(CODIGO_VENCIDO);
    expect(portal.abrir).toHaveBeenCalledTimes(1);
  });
});

describe("Código do portal: Editar e estado no card", () => {
  const LINK = "https://hridoyhub.shop/OTP/";
  const antes = { portalLink: LINK, portalCodigo: "VELHO123", portalResgatadoEm: "2026-11-15T10:00:00.000Z", portalExpiraEm: "2026-11-15T10:20:00.000Z", portalEmail: "x@gmail.com", conta: { email: LINK, senha: "", nome: "", usuario: "", nascimento: "" }, imap: { host: "", porta: 0, usuario: LINK, senha: "VELHO123" } };
  it("código novo no Editar vai para portalCodigo e apaga a janela do código anterior", () => {
    const r = camposDoPortal(antes, { provedorEmail: "portal", email: LINK, senhaEmail: "NOVO4567" });
    expect(r).toMatchObject({ portalCodigo: "NOVO4567", portalLink: LINK, portalResgatadoEm: undefined, portalExpiraEm: undefined, portalEmail: undefined });
  });
  it("mesmo código mantém a janela (pausa não queima)", () => {
    const r = camposDoPortal(antes, { provedorEmail: "portal", email: LINK, senhaEmail: "velho123" });
    expect(r.portalResgatadoEm).toBe(antes.portalResgatadoEm);
    expect(r.portalEmail).toBe("x@gmail.com");
  });
  it("estado: livre, em uso até (com validade) e janela encerrada", () => {
    const agora = Date.parse("2026-11-15T10:05:00.000Z");
    expect(estadoDoCodigo({ provedorEmail: "portal" }, agora)).toEqual({ estado: "livre" });
    expect(estadoDoCodigo({ provedorEmail: "portal", portalResgatadoEm: antes.portalResgatadoEm, portalExpiraEm: antes.portalExpiraEm, portalEmail: "x@gmail.com" }, agora)).toEqual({ estado: "em-uso", ate: antes.portalExpiraEm, email: "x@gmail.com" });
    expect(estadoDoCodigo({ provedorEmail: "portal", portalResgatadoEm: antes.portalResgatadoEm, portalExpiraEm: antes.portalExpiraEm }, agora + 3600_000)).toMatchObject({ estado: "janela-encerrada" });
    expect(estadoDoCodigo({ provedorEmail: "imap" }, agora)).toBeNull();
    expect(mascararCodigo("SUDXHRAY")).toBe("SU****AY");
  });
  it("o sync guarda o e-mail da sessão que o agente manda", () => {
    const [u] = parseJobUpdates([{ id: "11111111-1111-4111-8111-111111111111", status: "running", steps: [], portal: { resgatadoEm: "2026-11-15T10:00:00Z", expiraEm: "2026-11-15T10:20:00Z", email: "Novo@Gmail.com" } }]);
    expect(u.portal).toEqual({ resgatadoEm: "2026-11-15T10:00:00.000Z", expiraEm: "2026-11-15T10:20:00.000Z", email: "novo@gmail.com" });
  });
});

describe("Enviar lote: sobras depois do envio", () => {
  it("códigos enviados saem; proxies fora saem sempre; usadas saem com a opção marcada", () => {
    const codigos = "C1\nC2\nC3";
    const proxies = "p1\n\np2\np3\np4";
    const resposta = { enviadas: 2, linhasUsadas: [1, 3], problemas: [{ linha: 2, hostPorta: "h:2", estado: "morta", motivo: "x" }] };
    expect(sobrasDoLote(codigos, proxies, resposta, true)).toEqual({ codigos: "C3", proxies: "p4" });
    expect(sobrasDoLote(codigos, proxies, resposta, false)).toEqual({ codigos: "C3", proxies: "p1\np3\np4" });
  });
  it("o parse guarda todas as proxies coladas (as excedentes cobrem as mortas)", () => {
    const r = parseLoteInput({ agentId: "a", versaoIg: "454.0.0.54.77", codigos: "CODIGO01", proxies: "h1.com:1:u:p\nh2.com:2:u:p" });
    if ("error" in r) throw new Error(r.error);
    expect(r.value.proxies).toHaveLength(1);
    expect(r.value.proxiesTodas).toHaveLength(2);
  });
});
