import { describe, it, expect } from "vitest";
import { hostValido, imapPadrao, parseConta, parseLoteInput, parseProxies, parseProxy, portaValida } from "../lib/vps/input";
import { extrairCodigo, dataImap, decodificarCorpo } from "../agente-vps/lib/imap.mjs";
import { lerCoordenadas } from "../agente-vps/lib/captcha.mjs";
import { aplicarProps, propsDe } from "../agente-vps/lib/fingerprint.mjs";
import { escalaDoPrint, tamanhoPng } from "../scripts/vps/calibrar.mjs";

const CONTA = {
  email: "Maria.Teste@Gmail.com",
  senhaEmail: "app-pass-1234",
  imapHost: "",
  imapPorta: "993",
  senhaIg: "segredo123",
  nome: "Maria Silva",
  usuario: "@maria.silva",
  nascimento: "15/03/2001",
};

describe("Contas VPS: proxies", () => {
  it("host:porta:usuário:senha vira URL, com país opcional no fim", () => {
    expect(parseProxy("sv2.exemplo.com:10114:usuario1:senha1")).toEqual({
      url: "http://usuario1:senha1@sv2.exemplo.com:10114",
      host: "sv2.exemplo.com",
      porta: 10114,
      usuario: "usuario1",
      pais: null,
    });
    expect(parseProxy("1.2.3.4:8080:u:p:us")?.pais).toBe("US");
    expect(parseProxy("http://u:p@proxy.exemplo.com:3128")?.url).toBe("http://u:p@proxy.exemplo.com:3128");
    expect(parseProxy("u:p@proxy.exemplo.com:3128")?.host).toBe("proxy.exemplo.com");
  });

  it("recusa porta, host, campos faltando e país inválido", () => {
    expect(parseProxy("sem-porta")).toBeNull();
    expect(parseProxy("host.com:99999:u:p")).toBeNull();
    expect(parseProxy("host.com:80:u")).toBeNull();
    expect(parseProxy("host.com:80:u:p:BRA")).toBeNull();
    expect(parseProxy("host.com:80:u:p com acento ç")).toBeNull();
    expect(parseProxy("http://user%:pa%zz@host.com:8080")).toBeNull();
    expect(hostValido("300.1.1.1")).toBe(false);
    expect(portaValida("0")).toBe(false);
  });

  it("uma por linha; repetir host:porta com o mesmo usuário bloqueia, com outro usuário só avisa", () => {
    const ok = parseProxies("a.com:1:u:p\n\nb.com:2:u:p\n");
    expect(ok).toHaveProperty("value");
    if ("value" in ok) expect(ok.value.map((p) => p.host)).toEqual(["a.com", "b.com"]);
    expect(parseProxies("a.com:1:u:p\na.com:1:u:outra")).toHaveProperty("error");
    expect(parseProxies("a.com:1:u:p\na.com:1:x:y")).toHaveProperty("avisos", [
      "A proxy a.com:1 aparece nas linhas 1, 2 com usuários diferentes: segue, cada linha conta como uma proxy.",
    ]);
    expect(parseProxies("a.com:1:u:p\nruim")).toEqual({ error: "Proxy da linha 2 no formato host:porta:usuário:senha." });
  });
});

describe("Contas VPS: conta e IMAP", () => {
  it("normaliza o e-mail, tira o @ e deduz o host IMAP", () => {
    const r = parseConta(CONTA, 1);
    expect(r).toHaveProperty("value");
    if (!("value" in r)) return;
    expect(r.value.email).toBe("maria.teste@gmail.com");
    expect(r.value.usuario).toBe("maria.silva");
    expect(r.value.imapHost).toBe("imap.gmail.com");
    expect(r.value.imapPorta).toBe(993);
  });

  it("host IMAP por domínio", () => {
    expect(imapPadrao("x@outlook.com")).toBe("outlook.office365.com");
    expect(imapPadrao("x@yahoo.com.br")).toBe("imap.mail.yahoo.com");
    expect(imapPadrao("x@minhaempresa.com")).toBe("imap.minhaempresa.com");
  });

  it("recusa os obrigatórios errados", () => {
    const com = (c: Partial<typeof CONTA>) => parseConta({ ...CONTA, ...c }, 3);
    expect(com({ email: "maria" })).toHaveProperty("error");
    expect(com({ senhaEmail: "" })).toHaveProperty("error");
    expect(com({ imapHost: "sem ponto" })).toHaveProperty("error");
    expect(com({ imapPorta: "70000" })).toHaveProperty("error");
    expect(com({ senhaIg: "123" })).toHaveProperty("error");
    expect(com({ senhaIg: "çenha123" })).toHaveProperty("error");
    expect(com({ nome: "" })).toHaveProperty("error");
    expect(com({ nome: "João" })).toHaveProperty("error");
    expect(com({ usuario: "maria silva" })).toHaveProperty("error");
    expect(com({ nascimento: "31/02/2001" })).toHaveProperty("error");
    expect(com({ nascimento: "2001-03-15" })).toHaveProperty("error");
    expect(com({ nascimento: "15/03/2020" })).toHaveProperty("error");
    const erro = com({ email: "x" });
    if ("error" in erro) expect(erro.error.startsWith("Conta 3: ")).toBe(true);
  });
});

describe("Contas VPS: lote", () => {
  const lote = (extra: Record<string, unknown> = {}) => ({
    agentId: "a1",
    quantidade: 2,
    proxies: "a.com:1:u:p\nb.com:2:u:p:US",
    perfil: "pixel7",
    versaoIg: "309.0.0.40.113",
    pais: "br",
    conta: [CONTA, { ...CONTA, email: "outra@gmail.com" }],
    ...extra,
  });

  it("aceita o lote completo e devolve proxies e contas na ordem", () => {
    const r = parseLoteInput(lote(), ["309.0.0.40.113"]);
    expect(r).toHaveProperty("value");
    if (!("value" in r)) return;
    expect(r.value.pais).toBe("BR");
    expect(r.value.proxies[1].pais).toBe("US");
    expect(r.value.contas).toHaveLength(2);
    expect(r.value.perfil).toBe("pixel7");
  });

  it("quantidade de 1 a 20, proxies e contas batendo com ela, e-mails distintos", () => {
    expect(parseLoteInput(lote({ quantidade: 0 }))).toHaveProperty("error");
    expect(parseLoteInput(lote({ quantidade: 21 }))).toHaveProperty("error");
    expect(parseLoteInput(lote({ quantidade: 3 }))).toHaveProperty("error");
    expect(parseLoteInput(lote({ conta: [CONTA] }))).toHaveProperty("error");
    expect(parseLoteInput(lote({ conta: [CONTA, CONTA] }))).toHaveProperty("error");
    expect(parseLoteInput(lote({ perfil: "iphone" }))).toHaveProperty("error");
    expect(parseLoteInput(lote({ versaoIg: "" }))).toHaveProperty("error");
    expect(parseLoteInput(lote(), ["300.0.0.0.1"])).toHaveProperty("error");
    expect(parseLoteInput(lote({ pais: "Brasil" }))).toHaveProperty("error");
    expect(parseLoteInput(lote({ agentId: "" }))).toHaveProperty("error");
  });
});

describe("IMAP: código do Instagram", () => {
  it("acha os 6 dígitos no corpo simples, quoted-printable e base64", () => {
    const simples = "From: Instagram <no-reply@mail.instagram.com>\r\nSubject: 123456 is your Instagram code\r\n\r\nYour code is 123456.";
    expect(extrairCodigo(simples)).toBe("123456");
    const qp = "From: x\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nO teu c=C3=B3digo de confirma=C3=A7=C3=A3o =C3=A9 654321=\r\n fim";
    expect(extrairCodigo(qp)).toBe("654321");
    const b64 = `From: x\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from("Confirmation code: 999000").toString("base64")}`;
    expect(extrairCodigo(b64)).toBe("999000");
  });

  it("multipart: usa a parte decodificada e ignora números de 5 ou 7 dígitos", () => {
    const msg = [
      "From: Instagram <security@mail.instagram.com>",
      'Content-Type: multipart/alternative; boundary="XYZ"',
      "",
      "--XYZ",
      "Content-Type: text/plain",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Pedido 1234567 recebido. Codigo: 24=\r\n6810",
      "--XYZ--",
    ].join("\r\n");
    expect(extrairCodigo(msg)).toBe("246810");
    expect(extrairCodigo("From: x\r\n\r\nsem codigo 12345 aqui")).toBeNull();
  });

  it("data no formato do IMAP e decodificação", () => {
    expect(dataImap(Date.UTC(2026, 10, 6, 12))).toBe("6-Nov-2026");
    expect(decodificarCorpo("a=3Db", "quoted-printable")).toBe("a=b");
  });
});

describe("Captcha e calibração", () => {
  it("lê as coordenadas da resposta 2captcha e aplica a escala", () => {
    expect(lerCoordenadas("OK|coordinates:x=120,y=340;x=400,y=500")).toEqual([
      { x: 120, y: 340 },
      { x: 400, y: 500 },
    ]);
    expect(lerCoordenadas("OK|coordinates:x=540,y=960", 0.5)).toEqual([{ x: 1080, y: 1920 }]);
    expect(lerCoordenadas("CAPCHA_NOT_READY")).toBeNull();
  });

  it("tamanho do PNG e escala do print", () => {
    const png = Buffer.alloc(24);
    png.write("\x89PNG\r\n\x1a\n", 0, "binary");
    png.writeUInt32BE(1080, 16);
    png.writeUInt32BE(1920, 20);
    expect(tamanhoPng(png)).toEqual({ largura: 1080, altura: 1920 });
    expect(escalaDoPrint({ largura: 540, altura: 960 })).toBe(0.5);
    expect(tamanhoPng(Buffer.from("nope"))).toBeNull();
  });
});

describe("Fingerprint: build.prop", () => {
  it("troca as chaves existentes e acrescenta as que faltam", () => {
    const device = {
      model: "Pixel 7",
      manufacturer: "Google",
      brand: "google",
      device: "panther",
      product: "panther",
      buildId: "TQ3A.230901.001",
      fingerprint: "google/panther/panther:13/TQ3A.230901.001/1234567:user/release-keys",
    };
    const props = propsDe(device);
    expect(props["ro.product.model"]).toBe("Pixel 7");
    expect(props["ro.build.version.incremental"]).toBe("1234567");
    const saida = aplicarProps("# base\nro.product.model=redroid\nro.build.type=userdebug\nro.outra=x\n", props);
    expect(saida).toContain("ro.product.model=Pixel 7\n");
    expect(saida).toContain("ro.build.type=user\n");
    expect(saida).toContain("ro.outra=x\n");
    expect(saida).toContain("ro.build.fingerprint=google/panther/panther:13/TQ3A.230901.001/1234567:user/release-keys");
    expect(saida.split("ro.product.model=").length).toBe(2);
  });
});
