import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALVOS_MAX, BIO_MAX, agendadoPara, expandirEtapas, parseAlvos, parseEstrutura, parsePlano, progressoEstrutura } from "../lib/vps/estruturacao";
import { listarMidias, nomeSeguro, salvarMidia } from "../lib/vps/midias";
import { parseJobSteps } from "../lib/emulador/jobs";
import { toVpsJob } from "../lib/vps/load";
import { CONEXAO_OUTRA_CONTA, PROFISSIONAL_FALHOU, arrobaDaConfirmacao, conferirConexao, etapaDoAlvo, hostDoLink, motivoParaPular } from "../agente-vps/lib/estrutura.mjs";
import { caminhoDoPrint, salvarPrint } from "../agente-vps/lib/prints.mjs";
import { comandoDeepLink } from "../agente-vps/fluxos/instagram.mjs";
import { ESTRUTURACAO } from "../agente-vps/fluxos/estruturacao.mjs";
import { acharBotao, botaoDePermissao, comandoAbrirUrl, paginaAberta, stickerDeLink, telaDeLogin } from "../agente-vps/fluxos/oauth.mjs";

const ALVOS = "@loja.um | Link | https://exemplo.com/a\n@loja_dois | Meu destaque | https://exemplo.com/b?x=1&y=2";
const BASE = {
  fotoPerfil: "perfil/foto.jpg",
  fotoStory: "story.png",
  bio: "Bio simples",
  alvos: ALVOS,
  legenda: "Clique aqui",
  destaque: "Link",
  fazerPerfil: true,
  fazerOauth: true,
  fazerStory: true,
  agendarHoras: 24,
};
const MIDIAS = ["perfil/foto.jpg", "story.png"];

const no = (extra: Record<string, unknown>) => ({ texto: "", descricao: "", id: "", classe: "", pacote: "com.instagram.android", clicavel: false, x: 100, y: 500, ...extra });

describe("Estruturar: etapas expandidas por alvo na criação do job", () => {
  it("9 etapas fixas + 6 por alvo, na ordem de execução", () => {
    const parsed = parseEstrutura(BASE, MIDIAS);
    if (!("value" in parsed)) throw new Error(parsed.error);
    const chaves = expandirEtapas(parsed.value).map((e) => e.key);
    expect(chaves).toEqual([
      "rede", "abrir", "instagram", "foto", "bio", "profissional",
      "perfil-1", "destaque-1", "link-1", "conectar-1", "consentir-1", "confirmar-1",
      "perfil-2", "destaque-2", "link-2", "conectar-2", "consentir-2", "confirmar-2",
      "story", "destacar", "fechar",
    ]);
    const rotulos = new Map(expandirEtapas(parsed.value).map((e) => [e.key, e.label]));
    expect(rotulos.get("perfil-2")).toBe("Alvo 2: abrir o perfil @loja_dois");
    expect(rotulos.get("destaque-2")).toBe('Alvo 2: abrir o destaque "Meu destaque"');
  });

  it("interruptores tiram as etapas deles; bio vazia não vira etapa", () => {
    const alvos = parseAlvos(ALVOS).alvos;
    const k = (d: Parameters<typeof expandirEtapas>[0]) => expandirEtapas(d).map((e) => e.key);
    expect(k({ alvos, bio: "", fazerPerfil: true, fazerOauth: false, fazerStory: false })).toEqual(["rede", "abrir", "instagram", "foto", "fechar"]);
    expect(k({ alvos, bio: "x", fazerPerfil: false, fazerOauth: false, fazerStory: true })).toEqual(["rede", "abrir", "instagram", "story", "destacar", "fechar"]);
    expect(k({ alvos: alvos.slice(0, 1), bio: "", fazerPerfil: false, fazerOauth: true, fazerStory: false })).toEqual([
      "rede", "abrir", "instagram", "profissional", "perfil-1", "destaque-1", "link-1", "conectar-1", "consentir-1", "confirmar-1", "fechar",
    ]);
  });

  it("10 alvos cabem no andamento do agente (69 etapas) e o card lê o array do job", () => {
    const alvos = Array.from({ length: ALVOS_MAX }, (_, i) => ({ perfil: `p${i}`, destaque: "D", link: "https://exemplo.com/" }));
    const plano = expandirEtapas({ alvos, bio: "b", fazerPerfil: true, fazerOauth: true, fazerStory: true });
    expect(plano).toHaveLength(9 + 6 * ALVOS_MAX);
    const steps = parseJobSteps(plano.map((p) => ({ key: p.key, status: "done", message: null })));
    expect(steps).toHaveLength(plano.length);
    expect(parsePlano(JSON.parse(JSON.stringify(plano)))).toEqual(plano);
    expect(parsePlano([{ key: "RUIM", label: "x" }, { key: "ok-1", label: "y" }, null])).toEqual([{ key: "ok-1", label: "y" }]);

    const job = toVpsJob({
      id: "j", agent_id: "a", kind: "estruturacao", label: "conta", template_index: 3, instance_index: 3, steps, status: "done", error: null, prompt: null,
      lote_id: null, pausa: null, versao_ig: null, created_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z", acoes: plano, conta_id: "c1", agendado_para: null,
    });
    expect(job.kind).toBe("estruturacao");
    expect(job.plano).toEqual(plano);
    expect(job.contaId).toBe("c1");
  });

  it("barra da segunda linha: feitas + falhas sobre o total do próprio job", () => {
    const plano = expandirEtapas({ alvos: parseAlvos(ALVOS).alvos.slice(0, 1), bio: "", fazerPerfil: false, fazerOauth: true, fazerStory: false });
    const steps = [
      { key: "rede", status: "done" }, { key: "abrir", status: "done" }, { key: "instagram", status: "done" },
      { key: "profissional", status: "error" }, { key: "perfil-1", status: "running" },
    ];
    const p = progressoEstrutura({ plano, steps, status: "running" });
    expect(p).toMatchObject({ feitas: 3, falhas: 1, total: 11, label: "Alvo 1: abrir o perfil @loja.um" });
    expect(p.pct).toBe(Math.round((4 / 11) * 100));
    expect(progressoEstrutura({ plano, steps: [], status: "queued" }).label).toBe("Na fila");
    expect(progressoEstrutura({ plano, steps: [], status: "done" }).pct).toBe(100);
  });

  it("agenda: 0 = agora; N horas vira a data em que o job sai da fila", () => {
    const agora = Date.parse("2026-11-09T12:00:00Z");
    expect(agendadoPara(0, agora)).toBeNull();
    expect(agendadoPara(24, agora)).toBe("2026-11-10T12:00:00.000Z");
    expect(agendadoPara(0.5, agora)).toBe("2026-11-09T12:30:00.000Z");
  });
});

describe("Estruturar: validação do diálogo (a mesma do servidor)", () => {
  const erro = (extra: Record<string, unknown>, midias: string[] | null = MIDIAS) => {
    const r = parseEstrutura({ ...BASE, ...extra }, midias);
    return "error" in r ? r.error : null;
  };

  it("aceita o formulário completo e usa 24 h quando a agenda vem vazia", () => {
    const r = parseEstrutura({ ...BASE, agendarHoras: "" }, MIDIAS);
    if (!("value" in r)) throw new Error(r.error);
    expect(r.value.agendarHoras).toBe(24);
    expect(r.value.alvos).toEqual([
      { perfil: "loja.um", destaque: "Link", link: "https://exemplo.com/a" },
      { perfil: "loja_dois", destaque: "Meu destaque", link: "https://exemplo.com/b?x=1&y=2" },
    ]);
    expect(erro({ agendarHoras: 0 })).toBeNull();
    expect(erro({ agendarHoras: "0" })).toBeNull();
  });

  it("alvos: mínimo 1, três partes por linha, link https://", () => {
    expect(erro({ alvos: "" })).toMatch(/ao menos um alvo/);
    expect(erro({ alvos: "@a | Destaque" })).toMatch(/Linha 1/);
    expect(erro({ alvos: "@a | D | http://exemplo.com" })).toMatch(/https:\/\//);
    expect(erro({ alvos: "@a b | D | https://exemplo.com" })).toMatch(/@ inválido/);
    expect(erro({ alvos: "@a |  | https://exemplo.com" })).toMatch(/nome do destaque/);
    expect(parseAlvos("\n@a | D | https://exemplo.com\n\n").alvos).toHaveLength(1);
    const muitos = Array.from({ length: ALVOS_MAX + 1 }, (_, i) => `@p${i} | D | https://exemplo.com`).join("\n");
    expect(erro({ alvos: muitos })).toMatch(/No máximo/);
  });

  it("sem foto com o interruptor correspondente ligado não passa; desligado passa", () => {
    expect(erro({ fotoPerfil: "" })).toMatch(/foto de perfil/);
    expect(erro({ fotoPerfil: "", fazerPerfil: false })).toBeNull();
    expect(erro({ fotoStory: "" })).toMatch(/foto do story/);
    expect(erro({ fotoStory: "", fazerStory: false, destaque: "" })).toBeNull();
    expect(erro({ fotoPerfil: "sumiu.jpg" })).toMatch(/não está em/);
    expect(erro({ fotoPerfil: "sumiu.jpg" }, null)).toBeNull();
  });

  it("limites: bio 150, legenda 200, destaque 30, só texto que o teclado do container digita", () => {
    expect(erro({ bio: "a".repeat(BIO_MAX) })).toBeNull();
    expect(erro({ bio: "a".repeat(BIO_MAX + 1) })).toMatch(/150/);
    expect(erro({ legenda: "a".repeat(201) })).toMatch(/200/);
    expect(erro({ destaque: "a".repeat(31) })).toMatch(/30/);
    expect(erro({ destaque: "" })).toMatch(/nome do destaque/);
    expect(erro({ bio: "promoção" })).toMatch(/acento/);
    expect(erro({ agendarHoras: -1 })).toMatch(/Agendar/);
    expect(erro({ fazerPerfil: false, fazerOauth: false, fazerStory: false })).toMatch(/interruptor/);
  });
});

describe("Estruturar: regras de falha no agente", () => {
  it("profissional falhou → só as etapas de OAuth ficam bloqueadas", () => {
    const falhas = new Set(["profissional"]);
    for (const etapa of ["perfil-1", "destaque-1", "link-1", "conectar-1", "consentir-1", "confirmar-1", "perfil-2", "confirmar-2"]) {
      expect(motivoParaPular(etapa, falhas)).toMatch(new RegExp(`^${PROFISSIONAL_FALHOU}`));
    }
    for (const etapa of ["foto", "bio", "story", "destacar", "fechar", "rede"]) expect(motivoParaPular(etapa, falhas)).toBeNull();
  });

  it("link-N falhou → pula conectar-N, consentir-N e confirmar-N e segue para o alvo seguinte", () => {
    const falhas = new Set(["link-1"]);
    expect(motivoParaPular("conectar-1", falhas)).toBe("pulada: link-1 falhou");
    expect(motivoParaPular("consentir-1", falhas)).toBe("pulada: link-1 falhou");
    expect(motivoParaPular("confirmar-1", falhas)).toBe("pulada: link-1 falhou");
    for (const etapa of ["perfil-2", "destaque-2", "link-2", "conectar-2", "consentir-2", "confirmar-2", "story"]) {
      expect(motivoParaPular(etapa, falhas)).toBeNull();
    }
    expect(etapaDoAlvo("link-12")).toEqual({ tipo: "link", n: 12 });
    expect(etapaDoAlvo("story")).toBeNull();
  });

  it("foto, bio e story falhando não bloqueiam etapa independente; destacar depende do story", () => {
    const falhas = new Set(["foto", "bio"]);
    for (const etapa of ["profissional", "perfil-1", "story", "destacar", "fechar"]) expect(motivoParaPular(etapa, falhas)).toBeNull();
    expect(motivoParaPular("destacar", new Set(["story"]))).toBe("pulada: story falhou");
  });

  it("o fluxo do agente sai do plano do job: rede/abrir/instagram/fechar param tudo, o resto segue", () => {
    const parsed = parseEstrutura(BASE, MIDIAS);
    if (!("value" in parsed)) throw new Error(parsed.error);
    const plano = expandirEtapas(parsed.value);
    const fluxo = ESTRUTURACAO({ ...parsed.value, plano }) as Array<{ chave: string; rotulo: string; segue?: boolean; sempre?: boolean; pular: (f: Set<string>) => string | null }>;
    expect(fluxo.map((e) => e.chave)).toEqual(plano.map((p) => p.key));
    expect(fluxo.filter((e) => !e.segue).map((e) => e.chave)).toEqual(["rede", "abrir", "instagram", "fechar"]);
    expect(fluxo.find((e) => e.chave === "fechar")?.sempre).toBe(true);
    expect(fluxo.find((e) => e.chave === "link-2")?.rotulo).toBe("Alvo 2: tocar no link do destaque");

    // Simulação do laço do rodarJob: profissional falha e, sem ele, link-1 falha.
    const rodar = (falhou: string[]) => {
      const falhas = new Set<string>();
      const rodadas: string[] = [];
      for (const etapa of fluxo) {
        if (etapa.pular(falhas)) {
          falhas.add(etapa.chave);
          continue;
        }
        rodadas.push(etapa.chave);
        if (falhou.includes(etapa.chave)) falhas.add(etapa.chave);
      }
      return { rodadas, falhas: [...falhas] };
    };
    expect(rodar(["profissional"]).rodadas).toEqual(["rede", "abrir", "instagram", "foto", "bio", "profissional", "story", "destacar", "fechar"]);
    const semLink = rodar(["link-1"]);
    expect(semLink.rodadas).not.toContain("conectar-1");
    expect(semLink.rodadas).toEqual(expect.arrayContaining(["perfil-2", "destaque-2", "link-2", "conectar-2", "consentir-2", "confirmar-2", "story"]));
    expect(semLink.falhas).toEqual(["link-1", "conectar-1", "consentir-1", "confirmar-1"]);
  });
});

describe("Estruturar: deep link, página e confirmação", () => {
  it("comando do deep link do perfil do alvo", () => {
    expect(comandoDeepLink("loja.um").join(" ")).toBe(
      "am start -a android.intent.action.VIEW -d instagram://user?username=loja.um -p com.instagram.android -f 0x20000000"
    );
  });

  it("abrir um link no Chrome vai entre aspas simples (o sh do Android não corta em &)", () => {
    expect(comandoAbrirUrl("https://exemplo.com/b?x=1&y=2", "com.android.chrome")).toEqual([
      "am", "start", "-a", "android.intent.action.VIEW", "-d", "'https://exemplo.com/b?x=1&y=2'", "-p", "com.android.chrome",
    ]);
    expect(comandoAbrirUrl("https://exemplo.com/a'b", "x")[5]).toBe("'https://exemplo.com/a%27b'");
  });

  it("parser do @ de confirmação", () => {
    expect(arrobaDaConfirmacao(["Conta conectada com sucesso", "@maria.silva123"])).toEqual({ confirmado: true, usuario: "maria.silva123" });
    expect(arrobaDaConfirmacao(["Instagram @Maria_Silva conectado."])).toEqual({ confirmado: true, usuario: "maria_silva" });
    expect(arrobaDaConfirmacao(["Siga @suporte", "Tudo certo! Você conectou @joana.fernandes259."])).toEqual({ confirmado: true, usuario: "joana.fernandes259" });
    expect(arrobaDaConfirmacao(["Successfully connected"])).toEqual({ confirmado: true, usuario: null });
    expect(arrobaDaConfirmacao(["Conectar com Instagram", "@loja"])).toEqual({ confirmado: false, usuario: "loja" });
    expect(arrobaDaConfirmacao([])).toEqual({ confirmado: false, usuario: null });
  });

  it("@ divergente do da conta = CONEXAO_OUTRA_CONTA", () => {
    expect(conferirConexao("maria.silva", "@Maria.Silva")).toEqual({ ok: true, mensagem: "conectada como @maria.silva" });
    const outra = conferirConexao("outra.conta", "maria.silva");
    expect(outra.ok).toBe(false);
    expect(outra.mensagem).toBe(`${CONEXAO_OUTRA_CONTA}: a página conectou @outra.conta, a conta é @maria.silva`);
    expect(conferirConexao(null, "maria.silva").ok).toBe(true);
  });

  it("sticker de link, página aberta, permissão e login são achados pelo dump", () => {
    expect(hostDoLink("https://www.Exemplo.com/a")).toBe("exemplo.com");
    const story = [no({ texto: "loja.um", y: 120 }), no({ texto: "EXEMPLO.COM", y: 900, clicavel: true }), no({ descricao: "Curtir", y: 1700 })];
    expect(stickerDeLink(story, "exemplo.com")?.texto).toBe("EXEMPLO.COM");
    expect(stickerDeLink([no({ id: "com.instagram.android:id/story_link_sticker", y: 800 })], "")?.y).toBe(800);
    expect(stickerDeLink([no({ descricao: "Curtir" })], "exemplo.com")).toBeNull();

    const pagina = [no({ classe: "android.webkit.WebView" }), no({ texto: "Minha página" }), no({ texto: "Conectar com Instagram", classe: "android.widget.Button", clicavel: true })];
    expect(paginaAberta(pagina)).toBe(true);
    expect(paginaAberta([no({ classe: "android.webkit.WebView" })])).toBe(false);
    expect(acharBotao(pagina, ["Conectar"])?.texto).toBe("Conectar com Instagram");
    // Frase solta com a palavra não é botão; o botão de verdade ganha.
    expect(acharBotao([no({ texto: "Para conectar, toque abaixo" }), no({ texto: "Conectar", clicavel: true, x: 7 })], ["Conectar"])?.x).toBe(7);
    expect(acharBotao([no({ texto: "Para conectar, toque abaixo" })], ["Conectar"])).toBeNull();

    expect(botaoDePermissao([no({ texto: "Não permitir" }), no({ texto: "Permitir", x: 9 })])?.x).toBe(9);
    expect(botaoDePermissao([no({ texto: "Continuar como Maria" })])?.texto).toBe("Continuar como Maria");
    expect(botaoDePermissao([no({ texto: "Não permitir" })])).toBeNull();
    expect(telaDeLogin([no({ classe: "android.widget.EditText" }), no({ classe: "android.widget.EditText" }), no({ texto: "Entrar" })])).toBe(true);
    expect(telaDeLogin([no({ texto: "Entrar" })])).toBe(false);
  });
});

describe("Estruturar: upload de mídia e prints", () => {
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP"), 0]);
  const pasta = () => mkdtempSync(path.join(os.tmpdir(), "sm-midias-"));

  it("grava jpg/png/webp com nome sanitizado e lista para o diálogo", () => {
    const dir = pasta();
    expect(salvarMidia(dir, "Foto de Perfil (1).JPG", JPG)).toEqual({ path: "foto-de-perfil-1.jpg" });
    expect(salvarMidia(dir, "story.png", PNG)).toEqual({ path: "story.png" });
    expect(salvarMidia(dir, "capa.webp", WEBP)).toEqual({ path: "capa.webp" });
    expect(listarMidias(dir).map((m) => m.path)).toEqual(["capa.webp", "foto-de-perfil-1.jpg", "story.png"]);
    expect(nomeSeguro("../../etc/passwd.png")).toBe("passwd.png");
    expect(nomeSeguro("C:\\fotos\\Ação.jpeg")).toBe("acao.jpeg");
    expect(nomeSeguro("...jpg")).toBe("foto.jpg");
    expect(nomeSeguro("animacao.gif")).toBeNull();
  });

  it("nunca sobrescreve: o segundo upload com o mesmo nome ganha sufixo", () => {
    const dir = pasta();
    expect(salvarMidia(dir, "foto.jpg", JPG)).toEqual({ path: "foto.jpg" });
    const outro = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 9, 9]);
    expect(salvarMidia(dir, "foto.jpg", outro)).toEqual({ path: "foto-2.jpg" });
    expect(salvarMidia(dir, "foto.jpg", outro)).toEqual({ path: "foto-3.jpg" });
    expect([...readFileSync(path.join(dir, "foto.jpg"))]).toEqual([...JPG]);
  });

  it("recusa mais de 8 MB, extensão fora da lista e conteúdo que não é imagem", () => {
    const dir = pasta();
    const grande = new Uint8Array(8 * 1024 * 1024 + 1);
    grande.set(JPG);
    expect(salvarMidia(dir, "grande.jpg", grande)).toEqual({ error: "A foto passa de 8 MB." });
    expect(salvarMidia(dir, "video.mp4", JPG)).toEqual({ error: "Só jpg, png ou webp." });
    expect(salvarMidia(dir, "script.jpg", new Uint8Array(Buffer.from("<script>alert(1)</script>")))).toMatchObject({ error: expect.stringMatching(/não é uma imagem/) });
    expect(salvarMidia(dir, "troca.png", JPG)).toMatchObject({ error: expect.stringMatching(/não é uma imagem/) });
    expect(salvarMidia(dir, "vazio.jpg", new Uint8Array())).toEqual({ error: "Arquivo vazio." });
    expect(listarMidias(dir)).toEqual([]);
  });

  it("print de cada etapa vai para <pasta>/<job>/<etapa>.png; nome fora do padrão não grava", () => {
    const dir = pasta();
    const job = "0b0e6a52-6d0a-4f0e-9a51-3c1f6d2a9b11";
    const arquivo = salvarPrint(job, "link-1", Buffer.from(PNG), dir);
    expect(arquivo).toBe(path.join(dir, job, "link-1.png"));
    expect(existsSync(arquivo as string)).toBe(true);
    expect(caminhoDoPrint("../fora", "link-1", dir)).toBeNull();
    expect(caminhoDoPrint(job, "../x", dir)).toBeNull();
    expect(salvarPrint(job, "foto", Buffer.alloc(0), dir)).toBeNull();
  });
});
