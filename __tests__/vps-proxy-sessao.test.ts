import net from "node:net";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AVISO_ROTACAO,
  SESSAO_RE,
  SUFIXO_PADRAO,
  derivarProxy,
  derivarUsuario,
  parseLoteInput,
  parseProxy,
  parseSufixo,
  sessoesDoLote,
  tipoDaUrl,
} from "../lib/vps/input";
import { AVISO_ROTACAO_DETECTADA, entraNoLote, pedirPelaProxy, testarSessao, type ResultadoProxy } from "../lib/vps/testar-proxy";
import { classificarTentativa as classificarCurl } from "../agente-vps/lib/teste-proxy.mjs";
import { chaveGeo, lerProxy, urlDoGost } from "../agente-vps/lib/rede.mjs";
import { estadoIsolamento } from "../lib/vps/jobs";
import { sessoesRestantes, sobrasDoLote } from "../lib/vps/lote-sobras";

const LINK = "https://hridoyhub.shop/OTP/";
const codigos = (n: number) => Array.from({ length: n }, (_, i) => `${LINK} | COD${String(i).padStart(5, "0")}`).join("\n");
const base = { agentId: "a", versaoIg: "454.0.0.54.77" };

describe("Sessão fixa: derivação do usuário", () => {
  it("usuário base + sufixo, com {sessao} trocado pelos 8 hex", () => {
    expect(derivarUsuario("cliente1", SUFIXO_PADRAO, "a1b2c3d4")).toBe("cliente1-session-a1b2c3d4");
    expect(derivarUsuario("cliente1", "", "a1b2c3d4")).toBe("cliente1");
    const p = derivarProxy(parseProxy("gw.exemplo.com:7000:cliente1:s3nh#", "socks5")!, SUFIXO_PADRAO, "0badc0de");
    expect(p).toMatchObject({ usuario: "cliente1-session-0badc0de", sessao: "0badc0de", host: "gw.exemplo.com", porta: 7000, tipo: "socks5" });
    expect(p.url).toBe("socks5h://cliente1-session-0badc0de:s3nh%23@gw.exemplo.com:7000");
  });
  it("sufixo precisa de {sessao} e não aceita : @ / nem espaço", () => {
    expect(parseSufixo(SUFIXO_PADRAO)).toEqual({ value: SUFIXO_PADRAO });
    expect(parseSufixo("")).toEqual({ value: "" });
    expect(parseSufixo("-session-fixa")).toHaveProperty("error");
    expect(parseSufixo("-s:{sessao}")).toHaveProperty("error");
    expect(parseSufixo("-s {sessao}")).toHaveProperty("error");
  });
});

describe("Sessão fixa: unicidade no lote", () => {
  it("cada conta ganha uma sessão de 8 hex, sem repetir, aproveitando as do Testar todas", () => {
    const sessoes = sessoesDoLote(50, ["aaaaaaaa", "aaaaaaaa", "XYZ", "bbbbbbbb"]);
    expect(sessoes).toHaveLength(50);
    expect(new Set(sessoes).size).toBe(50);
    expect(sessoes.slice(0, 2)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(sessoes.every((s) => SESSAO_RE.test(s))).toBe(true);
  });
  it("gerador que repete não gera sessão duplicada", () => {
    const fila = ["11111111", "11111111", "22222222"];
    expect(sessoesDoLote(2, [], () => fila.shift() ?? "33333333")).toEqual(["11111111", "22222222"]);
  });
  it("lote com sufixo: uma credencial base serve 50 contas, cada uma com usuário derivado único (dedupe na derivada)", () => {
    const r = parseLoteInput({ ...base, codigos: codigos(50), proxies: "gw.exemplo.com:7000:cliente1:senha", tipo: "socks5", sufixo: SUFIXO_PADRAO });
    if ("error" in r) throw new Error(r.error);
    expect(r.value.quantidade).toBe(50);
    expect(r.value.proxies).toHaveLength(50);
    expect(r.value.proxiesTodas.length).toBeGreaterThan(50); // reservas para as que morrerem
    const usuarios = r.value.proxiesTodas.map((p) => p.usuario);
    expect(new Set(usuarios).size).toBe(usuarios.length);
    expect(r.value.proxies.every((p) => p.url.startsWith("socks5h://") && /^cliente1-session-[0-9a-f]{8}$/.test(p.usuario))).toBe(true);
    expect(r.value.avisos).not.toContain(AVISO_ROTACAO);
    // A mesma base em duas linhas não bloqueia com sufixo (as contas se revezam).
    expect(parseLoteInput({ ...base, codigos: codigos(2), proxies: "gw.exemplo.com:7000:cliente1:senha\ngw.exemplo.com:7000:cliente1:senha", sufixo: SUFIXO_PADRAO })).toHaveProperty("value");
  });
  it("sem sufixo: uma proxy por conta e o aviso amarelo de rotação", () => {
    const r = parseLoteInput({ ...base, codigos: codigos(2), proxies: "a.com:1:u:p\nb.com:2:u:p", tipo: "http", sufixo: "" });
    if ("error" in r) throw new Error(r.error);
    expect(r.value.avisos[0]).toBe(AVISO_ROTACAO);
    expect(r.value.proxies.every((p) => !p.sessao && p.url.startsWith("http://"))).toBe(true);
  });
});

describe("SOCKS5 gera socks5h", () => {
  it("tipo socks5 → URL socks5h:// (curl resolve o nome pela proxy); agente e gost entendem", () => {
    const p = parseProxy("u:p@gw.exemplo.com:1080", "socks5")!;
    expect(p.url).toBe("socks5h://u:p@gw.exemplo.com:1080");
    expect(tipoDaUrl(p.url)).toBe("socks5");
    const lida = lerProxy(p.url);
    expect(lida.tipo).toBe("socks5");
    expect(urlDoGost(lida, "1.2.3.4")).toBe("socks5://u:p@1.2.3.4:1080");
    expect(urlDoGost(lerProxy("http://u:p@gw.exemplo.com:3128"), "1.2.3.4")).toBe("http://u:p@1.2.3.4:3128");
    expect(chaveGeo("socks5h://u-session-aaaaaaaa:p@gw.exemplo.com:1080")).toBe("gw.exemplo.com:1080:u-session-aaaaaaaa");
  });
  it("curl 97 com usuário recusado = credencial; 97 sem isso = morta", () => {
    expect(classificarCurl({ codigo: 97, http: 0, stderr: "curl: (97) User was rejected by the SOCKS5 server (1 1)." }).estado).toBe("credencial");
    expect(classificarCurl({ codigo: 97, http: 0, stderr: "curl: (97) Can't complete SOCKS5 connection" }).estado).toBe("morta");
  });
});

describe("Testar todas: rotação e 429 do geo", () => {
  const viva: ResultadoProxy = { estado: "viva", motivo: "respondeu em 0.8 s", ms: 800, tentativas: 1 };
  it("mesma sessão testada duas vezes com IPs diferentes: rotação detectada (aviso, segue viva)", async () => {
    const ips = ["177.1.1.1", "189.2.2.2"];
    const r = await testarSessao("socks5h://u:p@gw.com:1080", { testar: async () => viva, saida: async () => ({ ip: "177.1.1.1", pais: "BR" }), ip: async () => ips.shift() === "177.1.1.1" ? "189.2.2.2" : null });
    expect(r.rotacao).toBe(true);
    expect(r.aviso).toContain(AVISO_ROTACAO_DETECTADA);
    expect(entraNoLote(r.estado)).toBe(true);
  });
  it("IP igual nas duas leituras: sessão fixa, IP e país gravados", async () => {
    const r = await testarSessao("socks5h://u:p@gw.com:1080", { testar: async () => viva, saida: async () => ({ ip: "177.1.1.1", pais: "BR" }), ip: async () => "177.1.1.1" });
    expect(r).toMatchObject({ estado: "viva", ip: "177.1.1.1", pais: "BR", rotacao: false, aviso: null });
  });
  it("429 do endpoint de geo não mata a linha: segue viva, IP pelo ipify, país não lido", async () => {
    const r = await testarSessao("socks5h://u:p@gw.com:1080", { testar: async () => viva, saida: async () => ({ limitado: true }), ip: async () => "177.1.1.1" });
    expect(r.estado).toBe("viva");
    expect(entraNoLote(r.estado)).toBe(true);
    expect(r).toMatchObject({ ip: "177.1.1.1", pais: null });
    expect(r.aviso).toContain("429");
  });
  it("proxy morta não consulta o geo", async () => {
    const saida = vi.fn();
    const r = await testarSessao("socks5h://u:p@gw.com:1080", { testar: async () => ({ estado: "morta", motivo: "x", ms: null, tentativas: 3 }), saida });
    expect(r.estado).toBe("morta");
    expect(saida).not.toHaveBeenCalled();
  });
});

describe("Isolamento e sessões queimadas", () => {
  const conta = (n: number, ipSaida: string | null, rotacao = false) => ({ ip: `10.77.3.${n}`, mac: `3c:00:00:00:00:0${n}`, modelo: "Pixel 7", serial: `S${n}`, androidId: `a${n}`, sessao: `0000000${n}`, ipSaida, rotacao });
  it("escudo verde só com IP de saída diferente dos outros do lote; rotação = vermelho", () => {
    const lote = [conta(1, "177.0.0.1"), conta(2, "177.0.0.2")];
    expect(estadoIsolamento(lote[0], lote)).toBe("unico");
    const repetido = [conta(1, "177.0.0.1"), conta(2, "177.0.0.1")];
    expect(estadoIsolamento(repetido[1], repetido)).toBe("repetido");
    expect(estadoIsolamento(conta(1, "177.0.0.1", true), [conta(1, "177.0.0.1", true)])).toBe("repetido");
    expect(estadoIsolamento(conta(1, null), [conta(1, null)])).toBe("neutro");
  });
  it("depois do envio: sessões usadas saem da lista; a credencial base fica na caixa", () => {
    const lista = [{ sessao: "aaaaaaaa", entra: true }, { sessao: "bbbbbbbb", entra: true }, { sessao: "cccccccc", entra: false }];
    expect(sessoesRestantes(lista, ["aaaaaaaa", "bbbbbbbb"])).toEqual([{ sessao: "cccccccc", entra: false }]);
    expect(sobrasDoLote("C1\nC2\nC3", "gw:1:u:p", { enviadas: 2, linhasUsadas: [1], problemas: [{ linha: 1, hostPorta: "gw:1", estado: "morta", motivo: "x", sessao: "cccccccc" }], modoSessao: true }, true)).toEqual({ codigos: "C3", proxies: "gw:1:u:p" });
  });
});

describe("SOCKS5 de verdade: handshake com usuário/senha e nome resolvido pela proxy", () => {
  let socks: net.Server;
  let alvo: http.Server;
  let portaSocks = 0;
  let portaAlvo = 0;
  const pedidosDeNome: string[] = [];

  beforeAll(async () => {
    alvo = http.createServer((req, res) => {
      res.writeHead(req.url === "/generate_204" ? 204 : 200);
      res.end();
    });
    await new Promise<void>((r) => alvo.listen(0, "127.0.0.1", () => r()));
    portaAlvo = (alvo.address() as net.AddressInfo).port;
    // Servidor SOCKS5 mínimo (RFC 1928/1929): só usuário "cliente1-session-*" com senha "certa", CONNECT por nome.
    socks = net.createServer((c) => {
      let etapa = 0;
      let buf = Buffer.alloc(0);
      c.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        if (etapa === 0 && buf.length >= 3) {
          buf = buf.subarray(2 + buf[1]);
          c.write(Buffer.from([5, 2]));
          etapa = 1;
        }
        if (etapa === 1 && buf.length >= 2 && buf.length >= 3 + buf[1] && buf.length >= 3 + buf[1] + buf[2 + buf[1]]) {
          const ulen = buf[1];
          const user = buf.subarray(2, 2 + ulen).toString();
          const plen = buf[2 + ulen];
          const pass = buf.subarray(3 + ulen, 3 + ulen + plen).toString();
          buf = buf.subarray(3 + ulen + plen);
          const ok = /^cliente1-session-[0-9a-f]{8}$/.test(user) && pass === "certa";
          c.write(Buffer.from([1, ok ? 0 : 1]));
          if (!ok) return c.end();
          etapa = 2;
        }
        if (etapa === 2 && buf.length >= 5 && buf[3] === 3 && buf.length >= 7 + buf[4]) {
          const nome = buf.subarray(5, 5 + buf[4]).toString();
          pedidosDeNome.push(nome);
          buf = buf.subarray(7 + buf[4]);
          etapa = 3;
          const destino = net.connect(portaAlvo, "127.0.0.1", () => {
            c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
            if (buf.length) destino.write(buf);
            c.pipe(destino).pipe(c);
          });
          destino.on("error", () => c.destroy());
        }
      });
      c.on("error", () => {});
    });
    await new Promise<void>((r) => socks.listen(0, "127.0.0.1", () => r()));
    portaSocks = (socks.address() as net.AddressInfo).port;
  });
  afterAll(() => {
    socks?.close();
    alvo?.close();
  });

  it("usuário derivado e senha certa: o túnel abre e o nome vai para a proxy (socks5h)", async () => {
    const r = await pedirPelaProxy(`socks5h://cliente1-session-a1b2c3d4:certa@127.0.0.1:${portaSocks}`, "http://www.gstatic.com/generate_204", 5000);
    expect(r).toMatchObject({ status: 204 });
    expect(pedidosDeNome).toContain("www.gstatic.com");
  });
  it("senha errada: SOCKS_AUTH (credencial)", async () => {
    const r = await pedirPelaProxy(`socks5h://cliente1-session-a1b2c3d4:errada@127.0.0.1:${portaSocks}`, "http://www.gstatic.com/generate_204", 5000);
    expect(r).toMatchObject({ erro: "SOCKS_AUTH" });
  });
});
