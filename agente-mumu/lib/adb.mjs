import { esperar, rodar, trecho } from "./processo.mjs";

/**
 * Uma instância ligada vista pelo adb (o adb.exe que vem com o MuMu). É a caixa
 * de ferramentas das automações em tarefas/: tocar, arrastar, digitar, abrir
 * app, print e achar elemento pelo texto da tela (uiautomator).
 */

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificar(texto) {
  return texto.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] !== "#") return ENTIDADES[e.toLowerCase()];
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : "";
  });
}

/** `input text` passa pelo sh do Android: espaço vira %s e os especiais levam barra. */
function escaparTexto(texto) {
  if (/[^\x20-\x7E]/.test(texto)) {
    throw new Error("digitar() só aceita texto sem acento/emoji (limite do input text do Android).");
  }
  return texto.replace(/([\\"'`$&|;<>()*~?#!{}[\]])/g, "\\$1").replace(/ /g, "%s");
}

/** Nós do dump do uiautomator: texto, descrição, id e centro na tela. */
export function lerNos(xml) {
  const nos = [];
  for (const m of xml.matchAll(/<node\s([^>]*?)\/?>/g)) {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = decodificar(a[2]);
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? "");
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nos.push({
      texto: attrs.text ?? "",
      descricao: attrs["content-desc"] ?? "",
      id: attrs["resource-id"] ?? "",
      classe: attrs.class ?? "",
      pacote: attrs.package ?? "",
      clicavel: attrs.clickable === "true",
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
    });
  }
  return nos;
}

/** O nó mostra esse texto (ou descrição)? Sem diferenciar maiúsculas. */
export function casa(no, alvo, exato = false) {
  const a = alvo.toLowerCase();
  return [no.texto, no.descricao].some((v) => {
    const t = v.toLowerCase();
    return t !== "" && (exato ? t === a : t.includes(a));
  });
}

export class Dispositivo {
  constructor(adb, serial) {
    if (!adb) throw new Error("adb.exe não encontrado na pasta do MuMu.");
    if (!serial) throw new Error("A instância não informou a porta do adb (ela está ligada?).");
    this.adb = adb;
    this.serial = serial;
  }

  async conectar() {
    const r = await rodar(this.adb, ["connect", this.serial], { timeoutMs: 20_000 });
    if (!/connected/i.test(String(r.stdout))) {
      throw new Error(`adb não conectou em ${this.serial}: ${trecho(r.stdout || r.stderr)}`);
    }
  }

  async shell(...args) {
    const r = await rodar(this.adb, ["-s", this.serial, "shell", ...args], { timeoutMs: 60_000 });
    if (r.codigo !== 0) throw new Error(`adb shell ${args[0]} falhou: ${trecho(r.stderr || r.stdout)}`);
    return String(r.stdout);
  }

  /** O app está instalado? (pm path sai com erro quando não está) */
  async temApp(pacote) {
    const r = await rodar(this.adb, ["-s", this.serial, "shell", "pm", "path", pacote], { timeoutMs: 30_000 });
    return String(r.stdout).includes("package:");
  }

  /** Apaga o campo focado: vai ao fim e dá backspace. */
  limparCampo(caracteres = 60) {
    return this.shell("input", "keyevent", "KEYCODE_MOVE_END", ...Array(caracteres).fill("KEYCODE_DEL"));
  }

  async prop(nome) {
    return (await this.shell("getprop", nome)).trim();
  }

  tocar(x, y) {
    return this.shell("input", "tap", Math.round(x), Math.round(y));
  }

  arrastar(x1, y1, x2, y2, ms = 300) {
    return this.shell("input", "swipe", x1, y1, x2, y2, ms);
  }

  digitar(texto) {
    return this.shell("input", "text", escaparTexto(String(texto)));
  }

  /** Ex.: tecla("KEYCODE_BACK"), tecla("KEYCODE_ENTER"). */
  tecla(codigo) {
    return this.shell("input", "keyevent", codigo);
  }

  abrirApp(pacote) {
    return this.shell("monkey", "-p", pacote, "-c", "android.intent.category.LAUNCHER", "1");
  }

  fecharApp(pacote) {
    return this.shell("am", "force-stop", pacote);
  }

  /** PNG da tela. */
  async print() {
    const r = await rodar(this.adb, ["-s", this.serial, "exec-out", "screencap", "-p"], { timeoutMs: 30_000, binario: true });
    if (r.codigo !== 0 || !r.stdout?.length) throw new Error(`print falhou: ${trecho(r.stderr)}`);
    return r.stdout;
  }

  /** Elementos da tela agora (uiautomator dump). */
  async tela() {
    // O uiautomator do MuMu sai com código de erro mesmo quando grava o arquivo,
    // e devolve "null root node" enquanto a tela ainda está desenhando: tenta de novo.
    let ultima = "";
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      if (tentativa > 0) await esperar(1500);
      const r = await rodar(this.adb, ["-s", this.serial, "shell", "uiautomator", "dump", "/sdcard/sm_ui.xml"], { timeoutMs: 60_000 });
      if (/dumped/i.test(String(r.stdout))) return lerNos(await this.shell("cat", "/sdcard/sm_ui.xml"));
      ultima = trecho(r.stderr || r.stdout);
    }
    throw new Error(`leitura da tela falhou: ${ultima}`);
  }

  /** Primeiro elemento com esse texto (ou descrição) na tela, ou null. */
  async acharTexto(alvo, { exato = false } = {}) {
    return (await this.tela()).find((no) => casa(no, alvo, exato)) ?? null;
  }

  async esperarTexto(alvo, { timeoutMs = 20_000, exato = false } = {}) {
    const limite = Date.now() + timeoutMs;
    for (;;) {
      const no = await this.acharTexto(alvo, { exato });
      if (no) return no;
      if (Date.now() > limite) throw new Error(`"${alvo}" não apareceu na tela em ${Math.round(timeoutMs / 1000)} s.`);
      await esperar(1000);
    }
  }

  async tocarTexto(alvo, opcoes) {
    const no = await this.esperarTexto(alvo, opcoes);
    await this.tocar(no.x, no.y);
    return no;
  }
}
