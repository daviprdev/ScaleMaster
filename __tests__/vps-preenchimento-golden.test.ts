import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { campoPreenchido, esperarTeclado, preencherEsperando, telaAtual } from "../agente-vps/fluxos/tela.mjs";

const RAIZ = path.join(__dirname, "..");
type No = { texto: string; descricao: string; id: string; classe: string; pacote: string; clicavel: boolean; focado: boolean; x: number; y: number };
const campo = (texto: string): No => ({ texto, descricao: "", id: "", classe: "android.widget.EditText", pacote: "com.instagram.android", clicavel: true, focado: false, x: 300, y: 400 });

describe("Preenchimento: ordem dos dumps", () => {
  /** Aparelho simulado que registra cada operação; `aceita` diz a partir de qual digitação o texto fica no campo. */
  function aparelho({ inicial = "", aceita = 1 }: { inicial?: string; aceita?: number } = {}) {
    const eventos: string[] = [];
    let texto = inicial;
    let digitacoes = 0;
    const d = {
      tocar: async () => void eventos.push("toque"),
      shell: async (...args: string[]) => {
        eventos.push(args[0] === "dumpsys" ? "teclado" : `shell ${args[0]}`);
        return "mShowRequested=true mInputShown=true";
      },
      limparCampo: async () => {
        eventos.push("apagar");
        texto = "";
      },
      digitar: async (v: string) => {
        eventos.push("broadcast");
        digitacoes += 1;
        if (digitacoes >= aceita) texto = v;
        return "broadcast";
      },
      tela: async () => {
        eventos.push("dump");
        return [campo(texto)];
      },
    };
    return { d, eventos };
  }

  it("campo vazio: toque, espera do teclado, broadcast e UM dump de verificação (o dump que achou o campo é de quem chama)", async () => {
    const { d, eventos } = aparelho();
    const achado = [campo("")];
    expect(await preencherEsperando(d, achado[0], "Promoção 🔥", achado)).toBe("broadcast");
    expect(eventos).toEqual(["toque", "teclado", "broadcast", "dump"]);
    expect(eventos.filter((e) => e === "dump")).toHaveLength(1);
  });

  it("campo que já tinha texto: apaga antes de digitar, ainda com um dump só", async () => {
    const { d, eventos } = aparelho({ inicial: "antigo" });
    const achado = [campo("antigo")];
    await preencherEsperando(d, achado[0], "novo texto", achado);
    expect(eventos).toEqual(["toque", "teclado", "apagar", "broadcast", "dump"]);
  });

  it("verificação mostra o campo ainda vazio: repete do toque, sem dump antes de digitar de novo e sem apagar", async () => {
    const { d, eventos } = aparelho({ aceita: 2 });
    const achado = [campo("")];
    await preencherEsperando(d, achado[0], "bio com acento é ok", achado);
    expect(eventos).toEqual(["toque", "teclado", "broadcast", "dump", "toque", "teclado", "broadcast", "dump"]);
    // Nunca dois dumps seguidos, nem dump entre o toque e o broadcast.
    expect(eventos.join(" ")).not.toMatch(/dump dump|toque (teclado )?dump/);
  });

  it("a espera do teclado lê o dumpsys input_method, nunca o uiautomator", async () => {
    const chamadas: string[] = [];
    let leituras = 0;
    const d = {
      shell: async (...args: string[]) => {
        chamadas.push(args.join(" "));
        return ++leituras < 3 ? "mInputShown=false" : "mInputShown=true";
      },
      tela: async () => {
        throw new Error("não devia ler a tela");
      },
    };
    expect(await esperarTeclado(d, { timeoutMs: 2000, intervaloMs: 1 })).toBe(true);
    expect(chamadas).toEqual(["dumpsys input_method", "dumpsys input_method", "dumpsys input_method"]);
    const nunca = { shell: async () => "mInputShown=false" };
    expect(await esperarTeclado(nunca, { timeoutMs: 20, intervaloMs: 1 })).toBe(false);
  });

  it("verificação: o texto na tela, ou (campo de senha) o conteúdo dos campos mudou", () => {
    expect(campoPreenchido([campo("Promoção 🔥")], "Promoção 🔥", [campo("")])).toBe(true);
    expect(campoPreenchido([campo("")], "abc", [campo("")])).toBe(false);
    expect(campoPreenchido([campo("••••••")], "segredo", [campo("")])).toBe(true);
    expect(campoPreenchido([campo("antigo")], "novo", [campo("antigo")])).toBe(false);
  });

  it("quem chama relê do cache do aparelho quando ele tem (telaAtual); sem cache, um dump", async () => {
    const comCache = { telaAtual: async () => [campo("do cache")], tela: async () => [campo("dump novo")] };
    expect((await telaAtual(comCache))[0].texto).toBe("do cache");
    const semCache = { tela: async () => [campo("dump novo")] };
    expect((await telaAtual(semCache))[0].texto).toBe("dump novo");
  });
});

describe("Golden: a base em uso não muda em falha", () => {
  const SCRIPT = path.join(RAIZ, "scripts", "vps", "golden.sh");
  const fonte = readFileSync(SCRIPT, "utf8").replace(/\r\n/g, "\n");
  const posix = (p: string) => p.replace(/\\/g, "/");
  let temBash = false;
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "sm-golden-"));
    const sonda = path.join(dir, "sonda.sh");
    writeFileSync(sonda, "#!/usr/bin/env bash\necho SONDA_OK\n");
    const r = spawnSync("bash", [posix(sonda)], { encoding: "utf8" });
    temBash = r.status === 0 && /SONDA_OK/.test(r.stdout ?? "");
  });

  it("constrói no volume temporário e só toca na base depois da verificação obrigatória (ordem no script)", () => {
    expect(fonte).toMatch(/NOVO_VOLUME="scalemaster-base-novo"/);
    expect(fonte).toMatch(/-v "\$NOVO_VOLUME:\/data"/);
    expect(fonte).not.toMatch(/-v "\$BASE_VOLUME:\/data"/);
    const verificacao = fonte.indexOf("VERIFICAÇÃO OBRIGATÓRIA");
    const troca = fonte.indexOf("TROCA: só daqui para baixo");
    expect(verificacao).toBeGreaterThan(0);
    expect(troca).toBeGreaterThan(verificacao);
    // Nenhum comando mexe em $BASE_VOLUME antes do bloco da troca.
    const antesDaTroca = fonte.slice(0, troca).split("\n").filter((l) => !l.trim().startsWith("#"));
    expect(antesDaTroca.filter((l) => /docker volume (rm|create)[^\n]*"\$BASE_VOLUME"/.test(l))).toEqual([]);
    expect(antesDaTroca.filter((l) => /"\$PROPS\/|> "\$APKS\/ATUAL"|rm -rf "\$PROPS"$/.test(l))).toEqual([]);
    // A verificação confere os dois pacotes e a ABI do Chrome.
    const bloco = fonte.slice(verificacao, troca);
    expect(bloco).toMatch(/pm list packages/);
    expect(bloco).toMatch(/for pacote in com\.android\.chrome com\.instagram\.android/);
    expect(bloco).toMatch(/\[ "\$ABI_CHROME" = "\$ABI" \] \|\| falhar/);
    expect(bloco).toMatch(/primaryCpuAbi/);
  });

  /** Roda o golden.sh com docker e adb de mentira; devolve o código de saída e os comandos que ele chamou. */
  function rodar(falha: string) {
    const caso = mkdtempSync(path.join(dir, "caso-"));
    const bin = path.join(caso, "bin");
    const apks = path.join(caso, "apks");
    const props = path.join(caso, "props");
    const registro = path.join(caso, "comandos.log");
    for (const p of [bin, path.join(apks, "x86-454.0.0.54.77"), path.join(apks, "browser", "chrome-156.0.8078.79"), props]) mkdirSync(p, { recursive: true });
    writeFileSync(path.join(props, "system.prop"), "base-em-uso\n");
    writeFileSync(path.join(apks, "ATUAL"), "versao-em-uso\n");
    const ig = path.join(apks, "x86-454.0.0.54.77");
    for (const a of ["base.apk", "split_config.xxhdpi.apk"]) writeFileSync(path.join(ig, a), `apk ${a}`);
    writeFileSync(path.join(apks, "browser", "chrome-156.0.8078.79", "base.apk"), "apk chrome");
    // Os scripts de mentira saem sempre com LF, mesmo se este arquivo vier com CRLF no checkout do Windows.
    const lf = (s: string) => s.replace(/\r\n/g, "\n");
    writeFileSync(
      path.join(bin, "docker"),
      lf(`#!/usr/bin/env bash
echo "docker $*" >> "$REGISTRO"
case "$1 $2" in
  "cp "*) echo prop > "\${@: -1}" ;;
  "volume inspect") if [ "$3" = "-f" ]; then echo /nao/existe; fi ;;
  "run --rm") if [ "$FALHA" = copia ]; then exit 1; fi ;;
esac
exit 0
`)
    );
    writeFileSync(
      path.join(bin, "adb"),
      lf(`#!/usr/bin/env bash
echo "adb $*" >> "$REGISTRO"
case "$*" in
  *"getprop sys.boot_completed"*) echo 1 ;;
  *"getprop ro.product.cpu.abilist"*) echo "x86_64,arm64-v8a" ;;
  *"install-multiple"*chrome*) if [ "$FALHA" = chrome ]; then echo "Failure [INSTALL_FAILED]"; exit 1; fi; echo Success ;;
  *"install-multiple"*) echo Success ;;
  *"pm list packages"*) echo "package:com.instagram.android"; if [ "$FALHA" != pacote ]; then echo "package:com.android.chrome"; fi ;;
  *"dumpsys package com.android.chrome"*) echo "    versionName=156.0.8078.79"; if [ "$FALHA" = abi ]; then echo "    primaryCpuAbi=arm64-v8a"; else echo "    primaryCpuAbi=x86_64"; fi ;;
  *"dumpsys package com.instagram.android"*) echo "    versionName=454.0.0.54.77"; echo "    primaryCpuAbi=x86_64" ;;
esac
exit 0
`)
    );
    const preparar = `cd "${posix(ig)}" && for a in *.apk; do sha256sum "$a" > "$a.sha256"; done && cd "${posix(path.join(apks, "browser"))}" && sha256sum chrome-*/*.apk > SHA256SUMS`;
    expect(spawnSync("bash", ["-c", preparar], { encoding: "utf8" }).status).toBe(0);
    const r = spawnSync("bash", [posix(SCRIPT)], {
      encoding: "utf8",
      env: {
        // No Windows a variável pode vir como "Path": tira a original para não ficar com duas.
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path")),
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`,
        SCALEMASTER_APKS: posix(apks),
        SCALEMASTER_PROPS: posix(props),
        REGISTRO: posix(registro),
        FALHA: falha,
        GOLDEN_ESPERA_ROOT: "0",
      } as unknown as NodeJS.ProcessEnv,
    });
    const comandos = existsSync(registro) ? readFileSync(registro, "utf8").split(/\r?\n/).filter(Boolean) : [];
    // Comandos que mexem no volume da base em uso (não no -novo nem no -anterior, que são temporários).
    const naBase = comandos.filter((c) => /^docker volume (rm|create)\b.*\bscalemaster-base$/.test(c) || /:\/para\b/.test(c) && /-v scalemaster-base:\/para/.test(c));
    return {
      status: r.status,
      saida: `${r.stdout ?? ""}${r.stderr ?? ""}`,
      comandos,
      naBase,
      props: readFileSync(path.join(props, "system.prop"), "utf8").trim(),
      atual: readFileSync(path.join(apks, "ATUAL"), "utf8").trim(),
    };
  }

  it.each([
    ["chrome", "a instalação do Chrome falha"],
    ["pacote", "pm list packages não traz o Chrome"],
    ["abi", "o Chrome instalou com outra ABI"],
  ])("falha no meio (%s: %s): sai com erro, apaga só os temporários e não toca na base, nos props nem no ATUAL", (falha) => {
    if (!temBash) return;
    const r = rodar(falha);
    expect(r.status).not.toBe(0);
    expect(r.naBase).toEqual([]);
    expect(r.props).toBe("base-em-uso");
    expect(r.atual).toBe("versao-em-uso");
    expect(r.comandos).toContain("docker volume rm -f scalemaster-base-novo");
    expect(r.saida).toMatch(/a base scalemaster-base em uso não foi alterada/);
    if (falha !== "chrome") expect(r.saida).toMatch(/VERIFICACAO:/);
  }, 60_000);

  it("tudo certo: verifica, guarda a anterior, troca a base e só então grava props e ATUAL", () => {
    if (!temBash) return;
    const r = rodar("");
    expect(r.saida).toMatch(/RESUMO: base pronta com Instagram 454\.0\.0\.54\.77 x86_64 e Chrome 156\.0\.8078\.79/);
    expect(r.status).toBe(0);
    const i = (trecho: string) => r.comandos.findIndex((c) => c.includes(trecho));
    const verificou = i("pm list packages");
    const guardou = i("-v scalemaster-base:/de:ro -v scalemaster-base-anterior:/para");
    const apagou = i("docker volume rm -f scalemaster-base");
    const primeiraNaBase = r.comandos.findIndex((c) => /^docker volume (rm|create)\b.*\bscalemaster-base$/.test(c));
    const copiou = i("-v scalemaster-base-novo:/de:ro -v scalemaster-base:/para");
    expect(verificou).toBeGreaterThan(0);
    expect(guardou).toBeGreaterThan(verificou);
    expect(primeiraNaBase).toBeGreaterThan(guardou);
    expect(copiou).toBeGreaterThan(primeiraNaBase);
    expect(apagou).toBeGreaterThan(-1);
    expect(r.props).toBe("prop");
    expect(r.atual).toBe("454.0.0.54.77");
  }, 60_000);

  it("a cópia para a base falha na troca: a base anterior volta", () => {
    if (!temBash) return;
    const r = rodar("copia");
    expect(r.status).not.toBe(0);
    // A primeira cópia (guardar a anterior) já falha: nada é trocado.
    expect(r.naBase).toEqual([]);
    expect(r.saida).toMatch(/não consegui guardar a base anterior: nada foi trocado/);
    expect(r.props).toBe("base-em-uso");
  }, 60_000);
});

describe("Firewall documentado no LEIAME", () => {
  const leiame = readFileSync(path.join(RAIZ, "agente-vps", "LEIAME.md"), "utf8");
  const instalar = readFileSync(path.join(RAIZ, "scripts", "vps", "instalar.sh"), "utf8");

  it("política de encaminhamento e regras de rota estão escritas, com a forma que o ufw aceita", () => {
    expect(leiame).toMatch(/DEFAULT_FORWARD_POLICY="ACCEPT"/);
    expect(leiame).toMatch(/ufw allow from 10\.77\.0\.0\/16/);
    expect(leiame).toMatch(/ufw allow from 172\.17\.0\.0\/16/);
    expect(leiame).toMatch(/ufw route allow in on vpsnet\+/);
    expect(leiame).toMatch(/ufw route allow out on vpsnet\+/);
    expect(leiame).toMatch(/ufw status verbose/);
    expect(leiame).toMatch(/allow \(routed\)/);
  });

  it("o instalar.sh aplica as mesmas regras (e nunca a forma com 'on any', que não casa com nada)", () => {
    for (const regra of ['DEFAULT_FORWARD_POLICY="ACCEPT"', "ufw allow from 10.77.0.0/16", "ufw allow from 172.17.0.0/16", "ufw route allow in on vpsnet+", "ufw route allow out on vpsnet+", "ufw reload"]) {
      expect(instalar).toContain(regra);
    }
    const comandos = instalar.split(/\r?\n/).filter((l) => /^\s*ufw /.test(l));
    expect(comandos.filter((l) => /\bon any\b/.test(l))).toEqual([]);
  });
});
