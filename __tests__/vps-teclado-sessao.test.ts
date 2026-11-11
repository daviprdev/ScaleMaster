import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { expandirEtapas, parseAlvos } from "../lib/vps/estruturacao";
import { caminhoDoPrint } from "../lib/vps/midias";
import { SEM_NAVEGADOR, SESSAO_PERDIDA } from "../agente-vps/lib/estrutura.mjs";
import { ORFAO_PARADO_MS, limparOrfaosAntigos, orfaosParaApagar } from "../agente-vps/lib/supervisor.mjs";
import { IME, TECLADO_INDISPONIVEL, aspas, broadcastOk, comandoDigitar, digitarCom, garantirTeclado, soAscii } from "../agente-vps/lib/teclado.mjs";
import { ESTRUTURACAO } from "../agente-vps/fluxos/estruturacao.mjs";
import { conferirSessao, destacarStory, editarPerfil, estadoDaSessao, postarStory, trocarFoto } from "../agente-vps/fluxos/instagram.mjs";
import { CHROME, entrarEVoltar } from "../agente-vps/fluxos/oauth.mjs";
import { TEMPOS, assinatura, esperarMudar, preencherEsperando, tocarAteMudar } from "../agente-vps/fluxos/tela.mjs";

const IG = "com.instagram.android";
type No = { texto: string; descricao: string; id: string; classe: string; pacote: string; clicavel: boolean; focado: boolean; x: number; y: number };
const no = (extra: Partial<No>): No => ({ texto: "", descricao: "", id: "", classe: "", pacote: IG, clicavel: false, focado: false, x: 100, y: 500, ...extra });
const BARRA: No[] = [
  no({ descricao: "Página inicial", id: `${IG}:id/feed_tab`, clicavel: true, x: 108, y: 1731 }),
  no({ descricao: "Reels", id: `${IG}:id/clips_tab`, clicavel: true, x: 324, y: 1731 }),
  no({ descricao: "Perfil", id: `${IG}:id/profile_tab`, clicavel: true, x: 972, y: 1731 }),
];
const LOGIN: No[] = [
  no({ texto: "Mobile number or email", y: 788 }),
  no({ texto: "Password", y: 978 }),
  no({ descricao: "Log in", clicavel: true, x: 540, y: 1149 }),
  no({ descricao: "Create new account", clicavel: true, x: 540, y: 1603 }),
];

beforeAll(() => {
  TEMPOS.intervaloMs = 1;
});

describe("Teclado ADB: broadcast do texto com fallback", () => {
  it("monta o am broadcast ADB_INPUT_TEXT com o texto entre aspas simples", () => {
    expect(comandoDigitar("Promoção de verão 🔥")).toEqual(["am", "broadcast", "-a", "ADB_INPUT_TEXT", "--es", "msg", "'Promoção de verão 🔥'"]);
    expect(aspas("it's")).toBe(`'it'\\''s'`);
    expect(aspas("a & b; $(x) `y`")).toBe("'a & b; $(x) `y`'");
    expect(IME).toBe("com.android.adbkeyboard/.AdbIME");
    expect(broadcastOk("Broadcasting: Intent { act=ADB_INPUT_TEXT }\nBroadcast completed: result=0")).toBe(true);
    expect(broadcastOk("")).toBe(false);
    expect(broadcastOk("Exception occurred while executing 'broadcast'")).toBe(false);
    expect(soAscii("plain text 123!")).toBe(true);
    expect(soAscii("ação")).toBe(false);
  });

  it("teclado ativo: vai por broadcast, com acento e emoji, sem tocar no input text", async () => {
    const chamadas: string[][] = [];
    const via = await digitarCom("Olá 😀", {
      ativo: async () => true,
      broadcast: async (args: string[]) => {
        chamadas.push(args);
        return { codigo: 0, stdout: "Broadcast completed: result=0", stderr: "" };
      },
      inputText: async () => {
        throw new Error("não devia usar o input text");
      },
    });
    expect(via).toBe("broadcast");
    expect(chamadas).toEqual([comandoDigitar("Olá 😀")]);
  });

  it("broadcast falhou: cai no input text quando o texto é ASCII", async () => {
    const digitado: string[] = [];
    let esqueceu = false;
    const via = await digitarCom("hello world", {
      ativo: async () => true,
      broadcast: async () => ({ codigo: 255, stdout: "", stderr: "Error: Activity not started" }),
      inputText: async (t: string) => void digitado.push(t),
      aoFalhar: () => {
        esqueceu = true;
      },
    });
    expect(via).toBe("input");
    expect(digitado).toEqual(["hello world"]);
    expect(esqueceu).toBe(true);
    // Sem o teclado como padrão nem tenta o broadcast.
    const sem = await digitarCom("abc", { ativo: async () => false, broadcast: async () => { throw new Error("não"); }, inputText: async (t: string) => void digitado.push(t) });
    expect(sem).toBe("input");
  });

  it("broadcast falhou e o texto tem acento ou emoji: o aviso TECLADO_INDISPONIVEL (só nesse caso)", async () => {
    const tentar = (texto: string, ativo: boolean) =>
      digitarCom(texto, {
        ativo: async () => ativo,
        broadcast: async () => ({ codigo: 0, stdout: "sem a linha de conclusão", stderr: "" }),
        inputText: async () => {
          throw new Error("não devia digitar");
        },
      });
    await expect(tentar("Promoção 🔥", true)).rejects.toThrow(new RegExp(`^${TECLADO_INDISPONIVEL}: o broadcast do teclado ADB falhou`));
    await expect(tentar("ação", false)).rejects.toThrow(new RegExp(`^${TECLADO_INDISPONIVEL}: o teclado ADB não é o teclado padrão`));
  });

  it("garantirTeclado: instala se ausente e define como teclado padrão; sem o APK segue sem ele", async () => {
    const comandos: string[] = [];
    let instalado = false;
    let padrao = "com.android.inputmethod.latin/.LatinIME";
    const d = {
      temApp: async () => instalado,
      instalar: async (apk: string) => {
        comandos.push(`install ${path.basename(apk)}`);
        instalado = true;
      },
      shell: async (...args: string[]) => {
        comandos.push(args.join(" "));
        if (args[0] === "ime" && args[1] === "set") padrao = args[2];
        return args[0] === "settings" ? `${padrao}\n` : "";
      },
    };
    const apk = path.join(__dirname, "vps-teclado-sessao.test.ts"); // qualquer arquivo que exista
    expect(await garantirTeclado(d, () => {}, { apk })).toBe(true);
    expect(comandos).toEqual([
      "install vps-teclado-sessao.test.ts",
      `ime enable ${IME}`,
      `ime set ${IME}`,
      "settings get secure default_input_method",
    ]);
    instalado = false;
    const avisos: string[] = [];
    expect(await garantirTeclado(d, (m: string) => avisos.push(m), { apk: "/nao/existe/adbkeyboard.apk" })).toBe(false);
    expect(avisos[0]).toMatch(/não está na VPS/);
  });
});

describe("Sessão: SESSAO_PERDIDA antes da foto", () => {
  it("logada = barra de navegação ou o @ na tela; tela de login = deslogada; pop-up = indefinida", () => {
    expect(estadoDaSessao(BARRA, "maria.silva")).toBe("logada");
    expect(estadoDaSessao([no({ texto: "maria.silva" })], "@Maria.Silva")).toBe("logada");
    expect(estadoDaSessao([no({ texto: "@maria.silva" })], "maria.silva")).toBe("logada");
    expect(estadoDaSessao(LOGIN, "maria.silva")).toBe("deslogada");
    expect(estadoDaSessao([no({ texto: "Continuar como maria.silva", clicavel: true })], "outra.conta")).toBe("deslogada");
    expect(estadoDaSessao([no({ texto: "Ativar notificações" }), no({ texto: "Agora não", clicavel: true })], "maria.silva")).toBe("indefinida");
    // O @ de outro app na tela não conta.
    expect(estadoDaSessao([no({ texto: "maria.silva", pacote: "com.android.chrome" })], "maria.silva")).toBe("indefinida");
  });

  it("conta deslogada: SESSAO_PERDIDA sem prefixo de etapa (o job para, nada é descartado)", async () => {
    const ctx = { d: { tela: async () => LOGIN }, log: () => {}, ajuda: {} };
    const erro = await conferirSessao(ctx, "maria.silva").catch((e: Error & { semPrefixo?: boolean }) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(new RegExp(`^${SESSAO_PERDIDA}: o Instagram abriu na tela de login`));
    expect((erro as Error & { semPrefixo?: boolean }).semPrefixo).toBe(true);
  });

  it("tela que nunca mostra a barra nem o @: SESSAO_PERDIDA no fim do tempo; conta logada passa", async () => {
    const vazia = { d: { tela: async () => [no({ texto: "Carregando", pacote: IG })] }, log: () => {}, ajuda: {} };
    await expect(conferirSessao(vazia, "maria.silva", { timeoutMs: 30 })).rejects.toThrow(new RegExp(`^${SESSAO_PERDIDA}: sem a barra de navegação nem o @`));
    const ok = { d: { tela: async () => BARRA }, log: () => {}, ajuda: {} };
    expect(await conferirSessao(ok, "maria.silva")).toBe("logada (barra de navegação)");
  });

  it("a etapa sessao vem antes da foto e para o job (não é das que seguem)", () => {
    const alvos = parseAlvos("@loja | Link | https://exemplo.com").alvos;
    const plano = expandirEtapas({ alvos, bio: "x", fazerPerfil: true, fazerOauth: true, fazerStory: true });
    const chaves = plano.map((p) => p.key);
    expect(chaves.indexOf("sessao")).toBe(chaves.indexOf("instagram") + 1);
    expect(chaves.indexOf("sessao")).toBeLessThan(chaves.indexOf("foto"));
    const fluxo = ESTRUTURACAO({ plano, alvos }) as Array<{ chave: string; segue?: boolean }>;
    expect(fluxo.find((e) => e.chave === "sessao")?.segue).toBeUndefined();
    expect(fluxo.find((e) => e.chave === "foto")?.segue).toBe(true);
  });
});

describe("Navegador: SEM_NAVEGADOR", () => {
  it("página sem sessão e container sem o pacote do navegador: SEM_NAVEGADOR antes de qualquer comando", async () => {
    const comandos: string[] = [];
    const pacotes: string[] = [];
    const d = {
      temApp: async (p: string) => {
        pacotes.push(p);
        return false;
      },
      shell: async (...args: string[]) => {
        comandos.push(args.join(" "));
        return "";
      },
      tela: async () => [],
    };
    await expect(entrarEVoltar({ d, log: () => {} }, { link: "https://exemplo.com", conta: { usuario: "maria", senha: "x" } })).rejects.toThrow(
      new RegExp(`^${SEM_NAVEGADOR}: a página abriu sem sessão e o container não tem navegador`)
    );
    expect(pacotes).toEqual([CHROME]);
    expect(comandos).toEqual([]);
  });
});

describe("Esperas: por mudança de dump, com timeout e nova tentativa", () => {
  it("foto, bio, story e destaque não usam mais pausa fixa (nem tocarNo, nem esperar)", () => {
    for (const fluxo of [trocarFoto, editarPerfil, postarStory, destacarStory]) {
      const fonte = String(fluxo);
      expect(fonte, fluxo.name).not.toMatch(/tocarNo\(/);
      expect(fonte, fluxo.name).not.toMatch(/\besperar\(/);
      expect(fonte, fluxo.name).toMatch(/toque\(|preencherEsperando\(/);
      expect(fonte, fluxo.name).toMatch(/porMudanca: true/);
    }
  });

  it("esperarMudar devolve a tela nova assim que o dump muda; sem mudança, null no timeout", async () => {
    let leituras = 0;
    const antes = [no({ texto: "Seguinte" })];
    const d = { tela: async () => (++leituras < 4 ? antes : [no({ texto: "Concluído" })]) };
    const depois = await esperarMudar(d, antes, { timeoutMs: 2000 });
    expect(depois?.[0].texto).toBe("Concluído");
    expect(leituras).toBe(4);
    expect(await esperarMudar({ tela: async () => antes }, antes, { timeoutMs: 20 })).toBeNull();
    // Dump que falha (tela desenhando) conta como "ainda não mudou".
    let falhas = 0;
    const instavel = { tela: async () => (++falhas < 3 ? Promise.reject(new Error("null root node")) : [no({ texto: "ok" })]) };
    expect((await esperarMudar(instavel, antes, { timeoutMs: 2000 }))?.[0].texto).toBe("ok");
    expect(assinatura(antes)).not.toBe(assinatura([no({ texto: "Seguinte", x: 101 })]));
  });

  it("tocarAteMudar: nada mudou no tempo → toca de novo; toque único (publicar, salvar) não repete", async () => {
    const antes = [no({ texto: "Novo", x: 200, y: 300 })];
    const toques: Array<[number, number]> = [];
    const d = {
      tocar: async (x: number, y: number) => void toques.push([x, y]),
      // Só reage no segundo toque.
      tela: async () => (toques.length >= 2 ? [no({ texto: "Galeria" })] : antes),
    };
    const depois = await tocarAteMudar(d, antes[0], antes, { timeoutMs: 20, tentativas: 2 });
    expect(depois?.[0].texto).toBe("Galeria");
    expect(toques).toEqual([[200, 300], [200, 300]]);

    const umSo: Array<[number, number]> = [];
    const parado = { tocar: async (x: number, y: number) => void umSo.push([x, y]), tela: async () => antes };
    expect(await tocarAteMudar(parado, antes[0], antes, { timeoutMs: 20, tentativas: 1 })).toBeNull();
    expect(umSo).toHaveLength(1);
  });

  it("preencherEsperando: espera o foco, apaga, digita e espera o texto aparecer no dump", async () => {
    const eventos: string[] = [];
    let focado = false;
    let texto = "antigo";
    const campo = () => no({ classe: "android.widget.EditText", texto, focado, x: 300, y: 400 });
    const d = {
      tocar: async () => {
        eventos.push("tocar");
        focado = true;
      },
      tela: async () => [campo()],
      limparCampo: async () => {
        eventos.push("limpar");
        texto = "";
      },
      digitar: async (v: string) => {
        eventos.push(`digitar ${v}`);
        texto = v;
        return "broadcast";
      },
    };
    const inicio = Date.now();
    expect(await preencherEsperando(d, campo(), "Promoção 🔥", [campo()])).toBe("broadcast");
    expect(eventos).toEqual(["tocar", "limpar", "digitar Promoção 🔥"]);
    expect(Date.now() - inicio).toBeLessThan(1500);
  });

  it("destaque de ponta a ponta numa tela simulada: cada toque espera a tela reagir e o nome sai com acento e emoji", async () => {
    type Tela = "perfil" | "escolher" | "nome";
    let tela: Tela = "perfil";
    let tique = 0;
    let criado = false;
    let focado = false;
    let digitado = "";
    const toques: string[] = [];
    const telas: Record<Tela, () => No[]> = {
      perfil: () => [
        ...BARRA,
        no({ texto: "Editar perfil", clicavel: true, x: 300, y: 600 }),
        no({ texto: criado ? digitado : "Novo", clicavel: true, x: 120, y: 800 }),
      ],
      escolher: () => [
        no({ id: `${IG}:id/gallery_grid_item_thumbnail`, descricao: "Foto de hoje", clicavel: true, x: 180, y: 500 }),
        no({ texto: "Seguinte", clicavel: true, x: 980, y: 140 }),
      ],
      nome: () => [
        no({ classe: "android.widget.EditText", texto: digitado, focado, x: 540, y: 700 }),
        no({ texto: "Concluído", clicavel: true, x: 980, y: 140 }),
      ],
    };
    const d = {
      // O nó "tique" muda a cada toque: a tela simulada sempre reage.
      tela: async () => [...telas[tela](), no({ id: "tique", texto: String(tique), pacote: "sim", x: 1, y: 1 })],
      tocar: async (x: number, y: number) => {
        tique += 1;
        const alvo = telas[tela]().find((n) => n.x === Math.round(x) && n.y === Math.round(y));
        const rotulo = alvo?.classe.includes("EditText") ? "campo" : alvo?.texto || alvo?.descricao || "?";
        toques.push(`${tela}:${rotulo}`);
        if (tela === "perfil" && rotulo === "Novo") tela = "escolher";
        else if (tela === "escolher" && rotulo === "Seguinte") tela = "nome";
        else if (tela === "nome" && alvo?.classe.includes("EditText")) focado = true;
        else if (tela === "nome" && rotulo === "Concluído") {
          criado = true;
          tela = "perfil";
        }
      },
      limparCampo: async () => {
        digitado = "";
      },
      digitar: async (v: string) => {
        digitado = v;
        return "broadcast";
      },
      tecla: async () => "",
      focoAtual: async () => `${IG}/com.instagram.mainactivity.MainTabActivity`,
      abrirApp: async () => "",
    };
    const semDono = () => {
      throw new Error("não devia pedir ajuda");
    };
    const inicio = Date.now();
    const resultado = await destacarStory({ d, log: () => {}, ajuda: { manual: semDono, terminarAMao: semDono } }, "Promoção 🔥");
    expect(resultado).toBe('destaque "Promoção 🔥" criado');
    expect(digitado).toBe("Promoção 🔥");
    expect(toques).toEqual(["perfil:Perfil", "perfil:Novo", "escolher:Foto de hoje", "escolher:Seguinte", "nome:campo", "nome:Concluído"]);
    // Com as pausas fixas de antes (2,5 + 3 + 1,5 + 2,5 + 0,6 + 0,5 + 4 s) isto passava de 14 s.
    expect(Date.now() - inicio).toBeLessThan(3000);
  });
});

describe("Containers órfãos no boot", () => {
  const agora = Date.parse("2026-11-10T12:00:00Z");
  const ha = (horas: number) => new Date(agora - horas * 3_600_000).toISOString();
  const containers = [
    { nome: "ig-1", rodando: false, paradoEm: ha(48), criadoEm: ha(100) }, // tem linha em vps_devices
    { nome: "ig-2", rodando: false, paradoEm: ha(30), criadoEm: ha(90) }, // órfão velho
    { nome: "ig-3", rodando: false, paradoEm: ha(5), criadoEm: ha(90) }, // órfão, mas parado há pouco
    { nome: "ig-4", rodando: true, paradoEm: ha(200), criadoEm: ha(300) }, // órfão ligado
    { nome: "ig-5", rodando: false, paradoEm: ha(72), criadoEm: ha(90) }, // job chegando neste sync
    { nome: "ig-6", rodando: false, paradoEm: "0001-01-01T00:00:00Z", criadoEm: ha(26) }, // nunca ligou, criado há 26 h
    { nome: "ig-7", rodando: false, paradoEm: "0001-01-01T00:00:00Z", criadoEm: ha(2) },
    { nome: "teste-ig", rodando: false, paradoEm: ha(500), criadoEm: ha(600) },
    { nome: "ig-2-proxy", rodando: false, paradoEm: ha(500), criadoEm: ha(600) },
  ];

  it("só sai o container sem job ativo, sem linha em vps_devices e parado há mais de 24 h", () => {
    const orfaos = orfaosParaApagar(containers, { conhecidos: new Set(["ig-1"]), ativos: new Set(["ig-5"]), agora });
    expect(orfaos.map((c) => c.nome)).toEqual(["ig-2", "ig-6"]);
    expect(ORFAO_PARADO_MS).toBe(24 * 60 * 60_000);
    // Tudo conhecido: nada sai.
    expect(orfaosParaApagar(containers, { conhecidos: containers.map((c) => c.nome), agora })).toEqual([]);
  });

  it("limpeza: docker rm de cada órfão com log; falha em um não impede o outro", async () => {
    const removidos: string[] = [];
    const logs: string[] = [];
    const feitos = await limparOrfaosAntigos({
      conhecidos: new Set(["ig-1"]),
      ativos: new Set(["ig-5"]),
      agora,
      log: (m: string) => logs.push(m),
      listar: async () => containers,
      remover: async (nome: string) => {
        if (nome === "ig-2") throw new Error("container em uso");
        removidos.push(nome);
      },
    });
    expect(feitos).toEqual(["ig-6"]);
    expect(removidos).toEqual(["ig-6"]);
    expect(logs).toEqual([
      "órfão: não removi ig-2: container em uso",
      "órfão: container ig-6 sem job e sem linha em vps_devices, parado há 26 h: docker rm (volume e retrato mantidos)",
    ]);
  });
});

describe("Prints: path traversal", () => {
  const base = path.resolve("/opt/scalemaster/vps/prints");
  const job = "0b0e6a52-6d0a-4f0e-9a51-3c1f6d2a9b11";

  it("o caminho resolvido fica sempre dentro da pasta de prints", () => {
    expect(caminhoDoPrint(base, job, "link-1")).toBe(path.join(base, job, "link-1.png"));
    expect(caminhoDoPrint(base, job.toUpperCase(), "foto")).toBe(path.join(base, job, "foto.png"));
    for (const [id, etapa] of [
      ["..", "passwd"],
      ["../..", "etc/passwd"],
      [job, "../../../etc/passwd"],
      [job, "../outro-job/foto"],
      ["../../etc", "passwd"],
      [`${job}/..`, "foto"],
      [job, "sub/foto"],
      ["/etc", "passwd"],
      [".", "foto"],
    ]) {
      expect(caminhoDoPrint(base, id, etapa), `${id} / ${etapa}`).toBeNull();
    }
  });
});
