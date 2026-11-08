import { describe, it, expect, vi } from "vitest";
import { codigoPortalValido, linkPortalValido, parseConta, parseLinhaPortal, parseLinhasPortal, parseLoteInput, PORTAL_PADRAO } from "../lib/vps/input";
import { extrairEmail, extrairOtp, lerStatus, mascarar, urlSessao, codigoValido } from "../agente-vps/lib/portal.mjs";
import { conferirCaixa, criarCaixa, descricaoCaixa, provedorDe } from "../agente-vps/fluxos/caixa.mjs";
import { ROTULOS_EMAIL } from "../lib/vps/provedores";
import { PROVEDORES_EMAIL } from "../lib/vps/types";

const BASE = { senhaIg: "segredo123", nome: "Maria Silva", usuario: "maria.silva", nascimento: "15/03/2001" };
const LINK = "https://hridoyhub.shop/OTP/";

describe("Portal: linha do hstock", () => {
  it("separa 'link | codigo' em link e código (maiúsculo)", () => {
    expect(parseLinhaPortal("https://hridoyhub.shop/OTP/ | SUDXHRAY")).toEqual({ link: LINK, codigo: "SUDXHRAY" });
    expect(parseLinhaPortal("  https://hridoyhub.shop/OTP/|sudxhray ,")).toEqual({ link: LINK, codigo: "SUDXHRAY" });
    expect(parseLinhaPortal("SUDXHRAY | https://hridoyhub.shop/OTP/")).toEqual({ link: LINK, codigo: "SUDXHRAY" });
    expect(parseLinhaPortal("https://hridoyhub.shop/OTP/ SUDXHRAY")).toEqual({ link: LINK, codigo: "SUDXHRAY" });
  });

  it("só o código usa o link padrão; lixo é null", () => {
    expect(parseLinhaPortal("ABC123")).toEqual({ link: PORTAL_PADRAO, codigo: "ABC123" });
    expect(parseLinhaPortal("")).toBeNull();
    expect(parseLinhaPortal("http://inseguro.com/OTP/ | SUDXHRAY")).toBeNull();
    expect(parseLinhaPortal("https://hridoyhub.shop/OTP/ | AB")).toBeNull();
    expect(parseLinhaPortal("https://hridoyhub.shop/OTP/ | COD-COM-TRACO")).toBeNull();
    expect(parseLinhaPortal("a | b | c")).toBeNull();
    expect(parseLinhaPortal("maria@gmail.com")).toBeNull();
  });

  it("várias linhas, uma por conta, mantendo a posição das inválidas", () => {
    const lidas = parseLinhasPortal("https://hridoyhub.shop/OTP/ | AAAAAA\n\nruim ruim ruim\nhttps://hridoyhub.shop/OTP/ | BBBBBB\n");
    expect(lidas).toHaveLength(3);
    expect(lidas[0]?.codigo).toBe("AAAAAA");
    expect(lidas[1]).toBeNull();
    expect(lidas[2]?.codigo).toBe("BBBBBB");
  });

  it("validações soltas", () => {
    expect(linkPortalValido("https://hridoyhub.shop/OTP/")).toBe(true);
    expect(linkPortalValido("https://u:p@hridoyhub.shop/OTP/")).toBe(false);
    expect(linkPortalValido("https://semponto/")).toBe(false);
    expect(codigoPortalValido("SUDXHRAY")).toBe(true);
    expect(codigoPortalValido("ABCDEFGHIJKLM")).toBe(false);
    expect(codigoValido("sudxhray")).toBe(true);
  });
});

describe("Portal: validação por provedor (lib/vps/input)", () => {
  it("portal: e-mail = link, senha = código; host/porta IMAP zerados", () => {
    const r = parseConta({ ...BASE, provedorEmail: "portal", email: LINK, senhaEmail: "sudxhray" }, 1);
    expect(r).toHaveProperty("value");
    if (!("value" in r)) return;
    expect(r.value.provedorEmail).toBe("portal");
    expect(r.value.email).toBe(LINK);
    expect(r.value.senhaEmail).toBe("SUDXHRAY");
    expect(r.value.imapHost).toBe("");
    expect(r.value.imapPorta).toBe(0);
  });

  it("portal: a linha 'link | codigo' colada no campo do e-mail é separada", () => {
    const r = parseConta({ ...BASE, provedorEmail: "portal", email: "https://hridoyhub.shop/OTP/ | SUDXHRAY", senhaEmail: "" }, 1);
    expect(r).toHaveProperty("value");
    if ("value" in r) {
      expect(r.value.email).toBe(LINK);
      expect(r.value.senhaEmail).toBe("SUDXHRAY");
    }
    const soCodigo = parseConta({ ...BASE, provedorEmail: "portal", email: "SUDXHRAY", senhaEmail: "" }, 1);
    expect(soCodigo).toHaveProperty("value");
    if ("value" in soCodigo) expect(soCodigo.value.email).toBe(PORTAL_PADRAO);
  });

  it("portal: exige https e código de 6 a 12 alfanuméricos", () => {
    expect(parseConta({ ...BASE, provedorEmail: "portal", email: "http://hridoyhub.shop/OTP/", senhaEmail: "SUDXHRAY" }, 1)).toEqual({ error: "Conta 1: informe o link do portal (https://…)." });
    expect(parseConta({ ...BASE, provedorEmail: "portal", email: "maria@gmail.com", senhaEmail: "SUDXHRAY" }, 1)).toHaveProperty("error");
    expect(parseConta({ ...BASE, provedorEmail: "portal", email: LINK, senhaEmail: "AB" }, 1)).toEqual({ error: "Conta 1: código de resgate com 6 a 12 letras/números." });
    expect(parseConta({ ...BASE, provedorEmail: "portal", email: LINK, senhaEmail: "COD-123456" }, 1)).toHaveProperty("error");
    expect(parseConta({ ...BASE, provedorEmail: "portal", email: LINK, senhaEmail: "" }, 1)).toHaveProperty("error");
  });

  it("imap continua igual (padrão sem provedor); mailtm exige senha; manual não", () => {
    const antigo = parseConta({ ...BASE, email: "Maria@Gmail.com", senhaEmail: "app-pass" }, 1);
    expect(antigo).toHaveProperty("value");
    if ("value" in antigo) {
      expect(antigo.value.provedorEmail).toBe("imap");
      expect(antigo.value.imapHost).toBe("imap.gmail.com");
    }
    expect(parseConta({ ...BASE, provedorEmail: "mailtm", email: "x@mail.tm", senhaEmail: "" }, 2)).toEqual({ error: "Conta 2: informe a senha da conta no mail.tm." });
    const mailtm = parseConta({ ...BASE, provedorEmail: "mailtm", email: "x@mail.tm", senhaEmail: "s3nha" }, 2);
    expect(mailtm).toHaveProperty("value");
    if ("value" in mailtm) expect(mailtm.value.imapHost).toBe("");
    const manual = parseConta({ ...BASE, provedorEmail: "manual", email: "x@gmail.com", senhaEmail: "" }, 3);
    expect(manual).toHaveProperty("value");
    expect(parseConta({ ...BASE, provedorEmail: "pombo", email: "x@gmail.com", senhaEmail: "" }, 4)).toEqual({ error: "Conta 4: provedor de e-mail desconhecido." });
  });

  it("lote portal: mesmo link em todas, códigos não podem repetir", () => {
    const lote = (codigos: string[]) =>
      parseLoteInput({
        agentId: "a",
        quantidade: codigos.length,
        proxies: codigos.map((_, i) => `p${i}.exemplo.com:1000:u:s`).join("\n"),
        perfil: "aleatorio",
        versaoIg: "454.0.0.54.77",
        pais: "BR",
        conta: codigos.map((c, i) => ({ ...BASE, usuario: `u${i}`, provedorEmail: "portal", email: LINK, senhaEmail: c })),
      });
    expect(lote(["AAAAAA", "BBBBBB"])).toHaveProperty("value");
    expect(lote(["AAAAAA", "AAAAAA"])).toEqual({ error: "O código de resgate da conta 2 aparece em mais de uma conta." });
  });

  it("seletor tem Portal primeiro e rótulos por provedor", () => {
    expect(PROVEDORES_EMAIL.map((p) => p.key)).toEqual(["portal", "mailtm", "imap", "manual"]);
    expect(ROTULOS_EMAIL.portal.email).toBe("Link do portal");
    expect(ROTULOS_EMAIL.portal.senha).toBe("Código de resgate");
    expect(ROTULOS_EMAIL.imap.email).toBe("E-mail");
  });
});

const STATUS_SEM = { ok: true, lease: ["Emma.Brown65456@gmail.com", 1794147279, 1794148479], remaining_sec: 610, status: "active", time_up: false, has_otp: false, can_reactivate: true, mails: [] };

describe("Portal: parsers do painel (agente-vps/lib/portal.mjs)", () => {
  it("endereço no HTML da inbox", () => {
    expect(extrairEmail("<div class='label'>Your email</div><div class='addr' id='email'>xpto99@gmail.com</div><div class='hint'>Tap</div>")).toBe("xpto99@gmail.com");
    expect(extrairEmail('<div class="addr">  Outro@Gmail.com </div>')).toBe("outro@gmail.com");
    expect(extrairEmail("<form method='post'><input name='code'></form>")).toBeNull();
  });

  it("OTP no /status: com código, sem código, código só no assunto; ignora virtual e sessão anterior", () => {
    expect(extrairOtp(STATUS_SEM)).toBeNull();
    expect(extrairOtp({ ...STATUS_SEM, has_otp: true, mails: [{ id: "1", otp: "123456", subject: "123456 is your Instagram code" }] })).toBe("123456");
    expect(extrairOtp({ ...STATUS_SEM, mails: [{ id: "1", subject: "654321 é o seu código do Instagram" }] })).toBe("654321");
    expect(
      extrairOtp({
        ...STATUS_SEM,
        mails: [
          { id: "v", otp: "111111", virtual: true },
          { id: "p", otp: "222222", previous_session: true },
          { id: "a", otp: "333333" },
          { id: "b", subject: "Bem-vindo ao Instagram" },
        ],
      })
    ).toBe("333333");
    expect(extrairOtp({ ...STATUS_SEM, mails: [{ id: "1", subject: "Thank You for Your Purchase | Hridoy Bot Hub" }] })).toBeNull();
  });

  it("OTP no HTML: #breeze-code, .otp-mini, assunto", () => {
    expect(extrairOtp('<div class="breeze-code" id="breeze-code">445566</div>')).toBe("445566");
    expect(extrairOtp('<div class="breeze-code" id="breeze-code">—</div><span class="otp-mini">778899</span>')).toBe("778899");
    expect(extrairOtp('<div class="otp-preview">🔑 OTP <b>101010</b></div>')).toBe("101010");
    expect(extrairOtp('<span class="subject">202020 is your Instagram code</span>')).toBe("202020");
    expect(extrairOtp('<div class="breeze-code" id="breeze-code">—</div><span class="subject">Welcome</span>')).toBeNull();
  });

  it("lerStatus, urlSessao e máscara do código", () => {
    const s = lerStatus(STATUS_SEM);
    expect(s.email).toBe("emma.brown65456@gmail.com");
    expect(s.restanteMs).toBe(610_000);
    expect(s.acabou).toBe(false);
    expect(lerStatus({ ...STATUS_SEM, time_up: true, remaining_sec: 0, status: "expired" }).acabou).toBe(true);
    expect(urlSessao("https://hridoyhub.shop/OTP/", "sudxhray")).toBe("https://hridoyhub.shop/OTP/SUDXHRAY");
    expect(urlSessao("https://hridoyhub.shop/OTP", "SUDXHRAY")).toBe("https://hridoyhub.shop/OTP/SUDXHRAY");
    expect(mascarar("SUDXHRAY")).toBe("SU****AY");
    expect(mascarar("ABC")).toBe("***");
  });
});

describe("Portal: caixa de e-mail no cadastro (fluxos/caixa.mjs)", () => {
  const inputPortal = { provedorEmail: "portal", conta: { email: LINK, nome: "Maria" }, imap: { senha: "SUDXHRAY" } };

  it("provedor por input e descrição sem o código inteiro", () => {
    expect(provedorDe({})).toBe("imap");
    expect(provedorDe(inputPortal)).toBe("portal");
    expect(provedorDe({ provedorEmail: "qualquer" })).toBe("imap");
    expect(descricaoCaixa(inputPortal)).toContain("SU****AY");
    expect(descricaoCaixa(inputPortal)).not.toContain("SUDXHRAY");
  });

  it("portal: a sessão abre só no endereco(), e o OTP vem do esperarOtp", async () => {
    const sessao = { modo: "http", email: "nova@gmail.com", fimEm: Date.now() + 19 * 60_000 };
    const portal = {
      mascarar,
      codigoValido,
      abrir: vi.fn(async () => ({ sessao, email: sessao.email })),
      esperarOtp: vi.fn(async () => "123456"),
      fechar: vi.fn(async () => {}),
      verificarPortal: vi.fn(async () => true),
    };
    const logs: string[] = [];
    const caixa = criarCaixa(inputPortal, { portal, log: (m: string) => logs.push(m) });
    expect(portal.abrir).not.toHaveBeenCalled();
    expect(caixa.email).toBeNull();
    expect(await caixa.endereco()).toBe("nova@gmail.com");
    expect(portal.abrir).toHaveBeenCalledWith(LINK, "SUDXHRAY", expect.anything());
    expect(caixa.email).toBe("nova@gmail.com");
    expect(await caixa.esperarCodigo({})).toBe("123456");
    expect(portal.abrir).toHaveBeenCalledTimes(1);
    await caixa.fechar();
    expect(portal.fechar).toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("SUDXHRAY");
  });

  it("portal fora do ar: endereco() e esperarCodigo() devolvem null (a aba pergunta), sem lançar", async () => {
    const portal = {
      mascarar,
      codigoValido,
      abrir: vi.fn(async () => {
        throw new Error("o portal respondeu HTTP 503 ao resgatar");
      }),
      esperarOtp: vi.fn(async () => null),
      fechar: vi.fn(async () => {}),
      verificarPortal: vi.fn(async () => true),
    };
    const logs: string[] = [];
    const caixa = criarCaixa(inputPortal, { portal, log: (m: string) => logs.push(m) });
    expect(await caixa.endereco()).toBeNull();
    expect(await caixa.esperarCodigo({})).toBeNull();
    expect(logs.some((l) => l.includes("HTTP 503"))).toBe(true);
    await caixa.fechar();
  });

  it("portal com OTP não chegando (esperarOtp null) cai para manual", async () => {
    const sessao = { modo: "http", email: "x@gmail.com", fimEm: Date.now() + 10 * 60_000 };
    const portal = { mascarar, codigoValido, abrir: vi.fn(async () => ({ sessao, email: sessao.email })), esperarOtp: vi.fn(async () => null), fechar: vi.fn(async () => {}), verificarPortal: vi.fn() };
    const caixa = criarCaixa(inputPortal, { portal, log: () => {} });
    expect(await caixa.esperarCodigo({})).toBeNull();
  });

  it("manual nunca lê nada; imap sem host devolve null", async () => {
    const manual = criarCaixa({ provedorEmail: "manual", conta: { email: "m@gmail.com" }, imap: {} });
    expect(await manual.endereco()).toBe("m@gmail.com");
    expect(await manual.esperarCodigo({})).toBeNull();
    const imap = criarCaixa({ conta: { email: "m@gmail.com" }, imap: {} });
    expect(imap.provedor).toBe("imap");
    expect(await imap.esperarCodigo({})).toBeNull();
  });

  it("etapa email: portal só confere o link (não gasta código); manual não faz nada", async () => {
    const portal = { mascarar, codigoValido, verificarPortal: vi.fn(async () => true), abrir: vi.fn() };
    const msg = await conferirCaixa(inputPortal, { portal });
    expect(portal.verificarPortal).toHaveBeenCalledWith(LINK);
    expect(portal.abrir).not.toHaveBeenCalled();
    expect(msg).toContain("SU****AY");
    expect(msg).not.toContain("SUDXHRAY");
    await expect(conferirCaixa({ provedorEmail: "portal", conta: { email: LINK }, imap: { senha: "ab" } }, { portal })).rejects.toThrow(/6 a 12/);
    expect(await conferirCaixa({ provedorEmail: "manual", conta: { email: "m@gmail.com" }, imap: {} })).toContain("pedido na aba");
  });
});
