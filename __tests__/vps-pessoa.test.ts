import { describe, it, expect } from "vitest";
import {
  NOMES_FEMININOS,
  NOME_MAX,
  SOBRENOMES,
  bissexto,
  gerarNascimento,
  gerarNome,
  gerarPessoa,
  gerarSenha,
  gerarUsuario,
  mascararSenha,
  normalizarUsuario,
  senhaValida,
  usuarioValido,
  variarUsuario,
} from "../lib/vps/pessoa";
import { variarUsuario as variarUsuarioAgente } from "../agente-vps/lib/usuario.mjs";
import { parseLoteInput } from "../lib/vps/input";
import { parseJobUpdates, ALERTA_ROBO, ALERTA_USUARIO, ehDescarte } from "../lib/emulador/jobs";
import { ehDescartada, proxiesEmUso } from "../lib/vps/jobs";
import { ALERTA_USUARIO as USUARIO_AGENTE, TENTATIVAS_USUARIO, deveDescartar } from "../agente-vps/fluxos/cadastro.mjs";

/** Gerador determinístico (LCG) para os testes serem repetíveis. */
function rngDe(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("Pessoa: listas e nome", () => {
  it("120 nomes femininos e 80 sobrenomes, sem acento e sem repetição", () => {
    expect(NOMES_FEMININOS).toHaveLength(120);
    expect(SOBRENOMES).toHaveLength(80);
    expect(new Set(NOMES_FEMININOS).size).toBe(120);
    expect(new Set(SOBRENOMES).size).toBe(80);
    for (const n of [...NOMES_FEMININOS, ...SOBRENOMES]) expect(n).toMatch(/^[A-Za-z]+$/);
  });

  it("nome = primeiro nome + 1 ou 2 sobrenomes, até 28 caracteres", () => {
    const rng = rngDe(7);
    for (let i = 0; i < 300; i++) {
      const nome = gerarNome(rng);
      const partes = nome.split(" ");
      expect(partes.length).toBeGreaterThanOrEqual(2);
      expect(partes.length).toBeLessThanOrEqual(3);
      expect(NOMES_FEMININOS).toContain(partes[0]);
      for (const s of partes.slice(1)) expect(SOBRENOMES).toContain(s);
      expect(nome.length).toBeLessThanOrEqual(NOME_MAX);
    }
  });

  it("nome acima de 28 caracteres é descartado e sorteado de novo", () => {
    // Força os índices mais longos (Vasconcelos, Guimaraes…) nas primeiras tentativas e um curto depois.
    const longo = NOMES_FEMININOS.indexOf("Emanuelle") / NOMES_FEMININOS.length + 0.001;
    const sob1 = SOBRENOMES.indexOf("Vasconcelos") / SOBRENOMES.length + 0.001;
    const sob2 = SOBRENOMES.indexOf("Cavalcanti") / SOBRENOMES.length + 0.001;
    const curtoNome = NOMES_FEMININOS.indexOf("Ana") / NOMES_FEMININOS.length + 0.001;
    const curtoSob = SOBRENOMES.indexOf("Lima") / SOBRENOMES.length + 0.001;
    const fila = [longo, 0.99, sob1, sob2, curtoNome, 0.0, curtoSob];
    const rng = () => (fila.length ? (fila.shift() as number) : 0.0);
    expect("Emanuelle Vasconcelos Cavalcanti".length).toBeGreaterThan(NOME_MAX);
    expect(gerarNome(rng)).toBe("Ana Lima");
  });
});

describe("Pessoa: @", () => {
  it("formato: começa com letra, até 30, sem _ ou . no fim, sem ___ e com 3 a 5 dígitos", () => {
    const rng = rngDe(11);
    const usados = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const u = gerarUsuario(gerarNome(rng), { usados, rng });
      expect(usuarioValido(u)).toBe(true);
      expect(u.length).toBeLessThanOrEqual(30);
      expect(u).toMatch(/^[a-z]/);
      expect(u).not.toMatch(/[_.]$/);
      expect(u).not.toMatch(/___/);
      expect(u).toMatch(/\d{3,7}$/);
      expect(u).toMatch(/^[a-z][a-z0-9._]*$/);
    }
    expect(usados.size).toBe(300);
  });

  it("variantes nome_sobrenome, nome.sobrenome, nomesobrenome e nome__sobrenome", () => {
    const formas = new Set<string>();
    const rng = rngDe(3);
    for (let i = 0; i < 200; i++) {
      const u = gerarUsuario("Maria Silva", { rng });
      if (/^maria__silva\d+$/.test(u)) formas.add("__");
      else if (/^maria_silva\d+$/.test(u)) formas.add("_");
      else if (/^maria\.silva\d+$/.test(u)) formas.add(".");
      else if (/^mariasilva\d+$/.test(u)) formas.add("");
      else throw new Error(`forma inesperada: ${u}`);
    }
    expect([...formas].sort()).toEqual(["", ".", "_", "__"]);
  });

  it("dedupe dentro do lote e contra os já gravados; nome longo é cortado antes dos dígitos", () => {
    const usados = new Set(["maria_silva123"]);
    const fila = [0.0, 0.0, 123 / 1000, 0.0, 0.0, 124 / 1000];
    const rng = () => (fila.length ? (fila.shift() as number) : 0.5);
    const u = gerarUsuario("Maria Silva", { usados, rng });
    expect(u).not.toBe("maria_silva123");
    expect(usados.has(u)).toBe(true);
    const longo = gerarUsuario("Emanuelle Vasconcelos Cavalcanti", { rng: rngDe(5) });
    expect(longo.length).toBeLessThanOrEqual(30);
    expect(usuarioValido(longo)).toBe(true);
    expect(normalizarUsuario("Ana Clara Façanha")).toBe("ana_clara_facanha");
    expect(usuarioValido("9abc")).toBe(false);
    expect(usuarioValido("abc_")).toBe(false);
    expect(usuarioValido("a___b")).toBe(false);
  });

  it("variação por recusa: tira os dígitos do fim e põe mais (4 + tentativa, até 7); igual no agente", () => {
    const rng = rngDe(9);
    const v1 = variarUsuario("maria_silva123", 1, rng);
    expect(v1).toMatch(/^maria_silva\d{5}$/);
    const v4 = variarUsuario("maria_silva12345", 4, rng);
    expect(v4).toMatch(/^maria_silva\d{7}$/);
    expect(variarUsuario("maria_silva", 0, rng)).toMatch(/^maria_silva\d{4}$/);
    expect(variarUsuario("a".repeat(28) + "12", 3, rng).length).toBeLessThanOrEqual(30);
    for (let t = 0; t < 5; t++) {
      const a = variarUsuarioAgente("ana.lima99", t, () => 0.123456789);
      expect(a).toMatch(new RegExp(`^ana\\.lima\\d{${Math.min(7, 4 + t)}}$`));
      expect(a.length).toBeLessThanOrEqual(30);
    }
  });
});

describe("Pessoa: senha e nascimento", () => {
  it("senha com 14 caracteres, as quatro classes e sem 0 O 1 l I", () => {
    const rng = rngDe(21);
    for (let i = 0; i < 300; i++) {
      const s = gerarSenha(rng);
      expect(s).toHaveLength(14);
      expect(s).toMatch(/[A-Z]/);
      expect(s).toMatch(/[a-z]/);
      expect(s).toMatch(/\d/);
      expect(s).toMatch(/[!@#$%&*.]/);
      expect(s).not.toMatch(/[0O1lI]/);
      expect(senhaValida(s)).toBe(true);
    }
    expect(senhaValida("abcdefghijklmn")).toBe(false);
    expect(mascararSenha("an3Kx!pq9#zz39")).toBe("an••••••39");
    expect(mascararSenha("abc")).toBe("•••");
  });

  it("nascimento dd/mm/aaaa com ano 1988–2006 e dia válido; 29/02 só em bissexto", () => {
    const rng = rngDe(33);
    for (let i = 0; i < 500; i++) {
      const n = gerarNascimento(rng);
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(n);
      expect(m).not.toBeNull();
      const [dia, mes, ano] = [Number(m![1]), Number(m![2]), Number(m![3])];
      expect(ano).toBeGreaterThanOrEqual(1988);
      expect(ano).toBeLessThanOrEqual(2006);
      expect(mes).toBeGreaterThanOrEqual(1);
      expect(mes).toBeLessThanOrEqual(12);
      const d = new Date(Date.UTC(ano, mes - 1, dia));
      expect(d.getUTCMonth()).toBe(mes - 1);
      expect(d.getUTCDate()).toBe(dia);
      if (mes === 2 && dia === 29) expect(bissexto(ano)).toBe(true);
    }
    // rng que força fevereiro com dia no teto: 29 em 2000 (bissexto), 28 em 1999.
    const forcar = (ano: number) => {
      const fila = [(ano - 1988) / 19 + 0.001, 1 / 12 + 0.001, 0.999];
      return () => (fila.length ? (fila.shift() as number) : 0.5);
    };
    expect(gerarNascimento(forcar(2000))).toBe("29/02/2000");
    expect(gerarNascimento(forcar(1999))).toBe("28/02/1999");
    expect(bissexto(1900)).toBe(false);
    expect(bissexto(2004)).toBe(true);
  });

  it("gerarPessoa junta tudo e não repete @", () => {
    const usados = new Set<string>();
    const a = gerarPessoa({ usados, rng: rngDe(1) });
    const b = gerarPessoa({ usados, rng: rngDe(1) });
    expect(a.usuario).not.toBe(b.usuario);
    expect(a.nome.length).toBeLessThanOrEqual(NOME_MAX);
    expect(senhaValida(a.senha)).toBe(true);
    expect(a.nascimento).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("Lote pelos códigos do hstock", () => {
  const base = { agentId: "a1", perfil: "pixel7", versaoIg: "454.0.0.54.77", pais: "BR" };
  const codigos = "https://hridoyhub.shop/OTP/ | AAAAAA\nhttps://hridoyhub.shop/OTP/ | BBBBBB\n\nhttps://hridoyhub.shop/OTP/ | CCCCCC";

  it("quantidade = número de linhas; proxies ≥ quantidade (as excedentes são ignoradas); pessoa fica para o servidor", () => {
    const r = parseLoteInput({ ...base, codigos, proxies: "a.com:1:u:p\nb.com:2:u:p\nc.com:3:u:p\nd.com:4:u:p" });
    expect(r).toHaveProperty("value");
    if (!("value" in r)) return;
    expect(r.value.quantidade).toBe(3);
    expect(r.value.proxies.map((p) => p.host)).toEqual(["a.com", "b.com", "c.com"]);
    expect(r.value.gerarPessoa).toBe(true);
    expect(r.value.contas.map((c) => c.senhaEmail)).toEqual(["AAAAAA", "BBBBBB", "CCCCCC"]);
    expect(r.value.contas[0]).toMatchObject({ provedorEmail: "portal", email: "https://hridoyhub.shop/OTP/", nome: "", usuario: "", senhaIg: "" });
  });

  it("bloqueia com proxies faltando, linha inválida, código repetido ou nenhuma linha", () => {
    expect(parseLoteInput({ ...base, codigos, proxies: "a.com:1:u:p\nb.com:2:u:p" })).toEqual({
      error: "2 proxies para 3 contas: cole uma proxy por conta.",
    });
    expect(parseLoteInput({ ...base, codigos: "lixo sem formato", proxies: "a.com:1:u:p" })).toEqual({ error: 'Linha 1 dos códigos fora do formato "link | código".' });
    expect(parseLoteInput({ ...base, codigos: "https://hridoyhub.shop/OTP/ | AAAAAA\nhttps://hridoyhub.shop/OTP/ | AAAAAA", proxies: "a.com:1:u:p\nb.com:2:u:p" })).toEqual({
      error: "O código da linha 2 aparece mais de uma vez.",
    });
    expect(parseLoteInput({ ...base, codigos: "\n\n", proxies: "a.com:1:u:p" })).toHaveProperty("error");
  });
});

describe("Descarte: captcha e @ recusado", () => {
  it("avisos iguais no agente e no servidor; os dois descartam", () => {
    expect(USUARIO_AGENTE).toBe(ALERTA_USUARIO);
    expect(TENTATIVAS_USUARIO).toBe(5);
    expect(deveDescartar(ALERTA_ROBO)).toBe(true);
    expect(deveDescartar(ALERTA_USUARIO)).toBe(true);
    expect(deveDescartar("Conta ERRO CRIAÇÃO, verificar com numero telefone")).toBe(false);
    expect(ehDescarte(ALERTA_ROBO)).toBe(true);
    expect(ehDescarte("O agente parou no meio (fechou ou reiniciou). Clique em Continuar.")).toBe(false);
  });

  it("conta descartada libera a proxy; viva mantém; o update do agente traz usuario e descartada", () => {
    const uso = proxiesEmUso([
      { status: "error", error: ALERTA_ROBO, label: "a", proxyHost: "1.1.1.1:10" },
      { status: "done", error: null, label: "b", proxyHost: "2.2.2.2:10" },
      { status: "error", error: "qualquer outro", label: "c", proxyHost: "3.3.3.3:10" },
      { status: "queued", error: null, label: "d", proxyHost: null },
    ]);
    expect([...uso.keys()]).toEqual(["2.2.2.2:10", "3.3.3.3:10"]);
    expect(uso.get("2.2.2.2:10")).toBe("b");
    expect(ehDescartada({ status: "error", error: ALERTA_USUARIO })).toBe(true);
    expect(ehDescartada({ status: "done", error: null })).toBe(false);
    const [u] = parseJobUpdates([
      { id: "11111111-1111-4111-8111-111111111111", status: "error", error: ALERTA_ROBO, steps: [], usuario: "maria_silva12345", descartada: true },
    ]);
    expect(u.usuario).toBe("maria_silva12345");
    expect(u.descartada).toBe(true);
    const [semExtras] = parseJobUpdates([{ id: "11111111-1111-4111-8111-111111111111", status: "running", steps: [], usuario: "Inválido!", descartada: "sim" }]);
    expect(semExtras.usuario).toBeUndefined();
    expect(semExtras.descartada).toBeUndefined();
  });
});
