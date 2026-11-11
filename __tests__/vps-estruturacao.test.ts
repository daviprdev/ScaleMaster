import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALVOS_MAX, BIO_MAX, NOME_DESTAQUE_PADRAO, PERFIL_PADRAO, agendadoPara, contarCaracteres, errosPorCampo, expandirEtapas, parseAlvos, parseEstrutura, parsePlano, progressoEstrutura } from "../lib/vps/estruturacao";
import { listarMidias, nomeSeguro, salvarMidia } from "../lib/vps/midias";
import { parseJobSteps } from "../lib/emulador/jobs";
import { toVpsJob } from "../lib/vps/load";
import { CONEXAO_OUTRA_CONTA, PROFISSIONAL_FALHOU, arrobaDaConfirmacao, conferirConexao, etapaDoAlvo, hostDoLink, motivoParaPular } from "../agente-vps/lib/estrutura.mjs";
import { caminhoDoPrint, salvarPrint } from "../agente-vps/lib/prints.mjs";
import { comandoDeepLink } from "../agente-vps/fluxos/instagram.mjs";
import { ESTRUTURACAO } from "../agente-vps/fluxos/estruturacao.mjs";
import { acharBotao, botaoDePermissao, comandoAbrirUrl, paginaAberta, stickerDeLink, telaDeLogin } from "../agente-vps/fluxos/oauth.mjs";

const ALVOS = "@loja.um | Link | https://exemplo.com/a\n@loja_dois | Meu destaque | https://exemplo.com/b?x=1&y=2";
/** O formulário de campos fixos do diálogo. */
const BASE = {
  fotoPerfil: "perfil/foto.jpg",
  fotoStory: "story.png",
  bio: "Bio simples",
  perfil: "@link.zada",
  nomeDestaque: "AQUI 🔗👆",
  linkStory: "https://exemplo.com/oferta?x=1&y=2",
  legendaSticker: "Clique aqui",
  legendaDestaque: "",
  agendarHoras: "24",
};
const MIDIAS = ["perfil/foto.jpg", "story.png"];

const no = (extra: Record<string, unknown>) => ({ texto: "", descricao: "", id: "", classe: "", pacote: "com.instagram.android", clicavel: false, x: 100, y: 500, ...extra });

describe("Estruturar: etapas expandidas por alvo na criação do job", () => {
  it("formulário de campos fixos: 10 etapas fixas + as 6 do perfil configurado, na ordem de execução", () => {
    const parsed = parseEstrutura(BASE, MIDIAS);
    if (!("value" in parsed)) throw new Error(parsed.error);
    const chaves = expandirEtapas(parsed.value).map((e) => e.key);
    expect(chaves).toEqual([
      "rede", "abrir", "instagram", "sessao", "foto", "bio", "profissional",
      "perfil-1", "destaque-1", "link-1", "conectar-1", "consentir-1", "confirmar-1",
      "story", "destacar", "fechar",
    ]);
    const rotulos = new Map(expandirEtapas(parsed.value).map((e) => [e.key, e.label]));
    expect(rotulos.get("perfil-1")).toBe("Alvo 1: abrir o perfil @link.zada");
    expect(rotulos.get("destaque-1")).toBe('Alvo 1: abrir o destaque "AQUI 🔗👆"');
    // Bio em branco: sem a etapa bio.
    const semBio = parseEstrutura({ ...BASE, bio: "" }, MIDIAS);
    expect("value" in semBio && expandirEtapas(semBio.value).map((e) => e.key)).not.toContain("bio");
  });

  it("interruptores tiram as etapas deles; bio vazia não vira etapa", () => {
    const alvos = parseAlvos(ALVOS).alvos;
    const k = (d: Parameters<typeof expandirEtapas>[0]) => expandirEtapas(d).map((e) => e.key);
    expect(k({ alvos, bio: "", fazerPerfil: true, fazerOauth: false, fazerStory: false })).toEqual(["rede", "abrir", "instagram", "sessao", "foto", "fechar"]);
    expect(k({ alvos, bio: "x", fazerPerfil: false, fazerOauth: false, fazerStory: true })).toEqual(["rede", "abrir", "instagram", "sessao", "story", "destacar", "fechar"]);
    expect(k({ alvos: alvos.slice(0, 1), bio: "", fazerPerfil: false, fazerOauth: true, fazerStory: false })).toEqual([
      "rede", "abrir", "instagram", "sessao", "profissional", "perfil-1", "destaque-1", "link-1", "conectar-1", "consentir-1", "confirmar-1", "fechar",
    ]);
  });

  it("10 alvos cabem no andamento do agente (70 etapas) e o card lê o array do job", () => {
    const alvos = Array.from({ length: ALVOS_MAX }, (_, i) => ({ perfil: `p${i}`, destaque: "D", link: "https://exemplo.com/" }));
    const plano = expandirEtapas({ alvos, bio: "b", fazerPerfil: true, fazerOauth: true, fazerStory: true });
    expect(plano).toHaveLength(10 + 6 * ALVOS_MAX);
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
    expect(p).toMatchObject({ feitas: 3, falhas: 1, total: 12, label: "Alvo 1: abrir o perfil @loja.um" });
    expect(p.pct).toBe(Math.round((4 / 12) * 100));
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
  it("padrões: perfil @link.zada e nome do destaque AQUI 🔗👆 quando o campo não vem", () => {
    expect(PERFIL_PADRAO).toBe("link.zada");
    expect(NOME_DESTAQUE_PADRAO).toBe("AQUI 🔗👆");
    const { perfil: _p, nomeDestaque: _n, ...semPadroes } = BASE;
    void _p;
    void _n;
    const r = parseEstrutura(semPadroes, MIDIAS);
    if (!("value" in r)) throw new Error(r.error);
    expect(r.value.alvos).toEqual([{ perfil: "link.zada", destaque: "AQUI 🔗👆", link: "" }]);
  });

  it("o story leva o link e a legenda informados; o destaque da conta leva o nome do destaque (ou a legenda do destaque)", () => {
    const r = parseEstrutura(BASE, MIDIAS);
    if (!("value" in r)) throw new Error(r.error);
    expect(r.value.linkStory).toBe("https://exemplo.com/oferta?x=1&y=2");
    expect(r.value.legenda).toBe("Clique aqui");
    expect(r.value.destaque).toBe("AQUI 🔗👆");
    expect(r.value.alvos[0]).toEqual({ perfil: "link.zada", destaque: "AQUI 🔗👆", link: "" });
    const comLegenda = parseEstrutura({ ...BASE, legendaDestaque: "Ofertas 🔥" }, MIDIAS);
    expect("value" in comLegenda && comLegenda.value.destaque).toBe("Ofertas 🔥");
    // "@" e caixa no perfil são normalizados.
    const perfil = parseEstrutura({ ...BASE, perfil: "@Link.Zada" }, MIDIAS);
    expect("value" in perfil && perfil.value.alvos[0].perfil).toBe("link.zada");
    // Agenda vazia = 24 h; 0 = agora.
    const vazia = parseEstrutura({ ...BASE, agendarHoras: "" }, MIDIAS);
    expect("value" in vazia && vazia.value.agendarHoras).toBe(24);
    const agora = parseEstrutura({ ...BASE, agendarHoras: "0" }, MIDIAS);
    expect("value" in agora && agora.value.agendarHoras).toBe(0);
  });

  it("validação por campo: sem foto de perfil, sem foto do story, sem perfil e sem nome do destaque bloqueiam, cada um com a sua mensagem", () => {
    expect(errosPorCampo(BASE, MIDIAS)).toEqual({});
    expect(errosPorCampo({ ...BASE, fotoPerfil: "", fotoStory: "", perfil: "", nomeDestaque: "" }, MIDIAS)).toEqual({
      fotoPerfil: "Escolha a foto de perfil.",
      fotoStory: "Escolha a foto do story.",
      perfil: "Informe o perfil com o destaque.",
      nomeDestaque: "Informe o nome do destaque (o texto embaixo da capa).",
    });
    expect(errosPorCampo({ ...BASE, fotoPerfil: "sumiu.jpg" }, MIDIAS)).toEqual({ fotoPerfil: 'A foto de perfil "sumiu.jpg" não está em /opt/scalemaster/midias.' });
    expect(errosPorCampo({ ...BASE, fotoPerfil: "sumiu.jpg" }, null)).toEqual({});
    expect(errosPorCampo({ ...BASE, perfil: "@link zada" }, MIDIAS)).toEqual({ perfil: "@ inválido: só letras, números, ponto e _ (até 30)." });
    expect(errosPorCampo({ ...BASE, linkStory: "" }, MIDIAS)).toEqual({ linkStory: "Informe o link do sticker do story." });
    expect(errosPorCampo({ ...BASE, linkStory: "http://exemplo.com" }, MIDIAS)).toEqual({ linkStory: "O link precisa começar com https://." });
    expect(errosPorCampo({ ...BASE, agendarHoras: "-1" }, MIDIAS)).toEqual({ agendarHoras: '"Agendar em" vai de 0 a 720 horas.' });
    // O servidor recusa com o primeiro, na ordem da tela.
    expect(parseEstrutura({ ...BASE, fotoStory: "", perfil: "" }, MIDIAS)).toEqual({ error: "Escolha a foto do story." });
  });

  it("limites por code point (emoji conta 1): bio 150, legenda do sticker 200, nome e legenda do destaque 30", () => {
    expect(contarCaracteres("AQUI 🔗👆")).toBe(7);
    expect("AQUI 🔗👆".length).toBe(9);
    expect(contarCaracteres("")).toBe(0);
    expect(errosPorCampo({ ...BASE, bio: "😀".repeat(BIO_MAX) }, MIDIAS)).toEqual({});
    expect(errosPorCampo({ ...BASE, bio: "😀".repeat(BIO_MAX + 1) }, MIDIAS)).toEqual({ bio: "A bio passa de 150 caracteres (151)." });
    expect(errosPorCampo({ ...BASE, legendaSticker: "a".repeat(201) }, MIDIAS)).toEqual({ legendaSticker: "A legenda do sticker passa de 200 caracteres (201)." });
    // 15 emoji = 15 caracteres (30 unidades UTF-16): cabe nos 30.
    expect(errosPorCampo({ ...BASE, nomeDestaque: "🔗".repeat(30) }, MIDIAS)).toEqual({});
    expect(errosPorCampo({ ...BASE, nomeDestaque: "🔗".repeat(31) }, MIDIAS)).toEqual({ nomeDestaque: "O nome do destaque passa de 30 caracteres." });
    expect(errosPorCampo({ ...BASE, legendaDestaque: "x".repeat(31) }, MIDIAS)).toEqual({ legendaDestaque: "A legenda do destaque passa de 30 caracteres." });
    expect(errosPorCampo({ ...BASE, bio: "Promoção de verão 🔥", legendaSticker: "Clique já 👉", nomeDestaque: "Ação ✨" }, MIDIAS)).toEqual({});
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

  it("o fluxo do agente sai do plano do job: rede/abrir/instagram/sessao/fechar param tudo, o resto segue", () => {
    // Dois alvos (jobs antigos ou API) para provar que a falha num não derruba o outro.
    const lido = parseEstrutura(BASE, MIDIAS);
    if (!("value" in lido)) throw new Error(lido.error);
    const parsed = { value: { ...lido.value, alvos: parseAlvos(ALVOS).alvos } };
    const plano = expandirEtapas(parsed.value);
    const fluxo = ESTRUTURACAO({ ...parsed.value, plano }) as Array<{ chave: string; rotulo: string; segue?: boolean; sempre?: boolean; pular: (f: Set<string>) => string | null }>;
    expect(fluxo.map((e) => e.chave)).toEqual(plano.map((p) => p.key));
    expect(fluxo.filter((e) => !e.segue).map((e) => e.chave)).toEqual(["rede", "abrir", "instagram", "sessao", "fechar"]);
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
    expect(rodar(["profissional"]).rodadas).toEqual(["rede", "abrir", "instagram", "sessao", "foto", "bio", "profissional", "story", "destacar", "fechar"]);
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
