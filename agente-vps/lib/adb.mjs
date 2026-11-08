import { esperar, rodar, trecho } from "./processo.mjs";

/**
 * Um container redroid visto pelo adb da VPS (pacote android-tools-adb). Cópia
 * adaptada de agente-mumu/lib/adb.mjs: o serial é 127.0.0.1:<porta>, com a
 * porta 5555 do container publicada em 6000 + índice; `root()` existe porque
 * o redroid aceita adb root (necessário para settings/props); e `indice` sai
 * do próprio serial. A caixa de ferramentas das automações é a mesma: tocar,
 * arrastar, digitar, abrir app, print e achar elemento pelo texto (uiautomator).
 */

export const PORTA_BASE = 6000;

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

/**
 * Atividade LAUNCHER na saída de `cmd package resolve-activity --brief`: a
 * última linha "pacote/.Atividade" (ou "pacote/com.x.Atividade"), expandindo o
 * ".Atividade" relativo. null = não resolveu (app sem launcher ou saída vazia).
 */
export function resolverAtividade(saida, pacote) {
  const linhas = String(saida ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const linha of linhas.reverse()) {
    const m = new RegExp(`^${pacote.replace(/\./g, "\\.")}/(\\S+)$`).exec(linha);
    if (!m) continue;
    const classe = m[1].startsWith(".") ? `${pacote}${m[1]}` : m[1];
    return `${pacote}/${classe}`;
  }
  return null;
}

/** Serial do container de índice n (porta publicada só em 127.0.0.1). */
export function serialDe(index) {
  return `127.0.0.1:${PORTA_BASE + index}`;
}

/** Índice do container a partir do serial (inverso de serialDe), ou null. */
export function indiceDe(serial) {
  const m = /^127\.0\.0\.1:(\d+)$/.exec(String(serial ?? ""));
  if (!m) return null;
  const n = Number(m[1]) - PORTA_BASE;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export class Dispositivo {
  constructor(adb, serial) {
    if (!adb) throw new Error("adb não encontrado na VPS (apt install android-tools-adb).");
    if (!serial) throw new Error("O container não informou a porta do adb (ele está ligado?).");
    this.adb = adb;
    this.serial = serial;
    this.index = indiceDe(serial);
  }

  /** Conecta o adb; logo depois de ligar o container ele recusa por um tempo: tenta por até 1 min. */
  async conectar() {
    let ultima = "";
    for (let tentativa = 0; tentativa < 20; tentativa++) {
      if (tentativa > 0) await esperar(3000);
      const r = await rodar(this.adb, ["connect", this.serial], { timeoutMs: 20_000 });
      if (/connected/i.test(String(r.stdout)) && !/cannot|failed/i.test(String(r.stdout))) return;
      ultima = trecho(r.stdout || r.stderr);
    }
    throw new Error(`adb não conectou em ${this.serial}: ${ultima}`);
  }

  async desconectar() {
    await rodar(this.adb, ["disconnect", this.serial], { timeoutMs: 10_000 });
  }

  /** adbd como root (o redroid permite): precisa para settings e para ler /data. */
  async root() {
    const r = await rodar(this.adb, ["-s", this.serial, "root"], { timeoutMs: 30_000 });
    if (/cannot|failed/i.test(String(r.stdout + r.stderr))) throw new Error(`adb root falhou: ${trecho(r.stdout || r.stderr)}`);
    // O adbd reinicia como root e a conexão cai por um instante.
    await esperar(2000);
    await this.conectar();
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

  /** Instala um APK do disco da VPS (adb install -r; -g já concede as permissões). */
  async instalar(caminho) {
    const r = await rodar(this.adb, ["-s", this.serial, "install", "-r", "-g", caminho], { timeoutMs: 10 * 60_000 });
    if (r.codigo !== 0 || !/Success/i.test(String(r.stdout))) throw new Error(`adb install falhou: ${trecho(r.stderr || r.stdout)}`);
  }

  /** Instala um APK dividido (base + splits) de uma vez: adb install-multiple -r -g. */
  async instalarMultiplos(caminhos) {
    const r = await rodar(this.adb, ["-s", this.serial, "install-multiple", "-r", "-g", ...caminhos], { timeoutMs: 10 * 60_000 });
    if (r.codigo !== 0 || !/Success/i.test(String(r.stdout))) throw new Error(`adb install-multiple falhou: ${trecho(r.stderr || r.stdout)}`);
  }

  /** primaryCpuAbi do pacote no dumpsys package (x86_64, arm64-v8a…), ou null se não está instalado. */
  async abiPrimaria(pacote) {
    if (!(await this.temApp(pacote))) return null;
    const saida = await this.shell("dumpsys", "package", pacote).catch(() => "");
    return /primaryCpuAbi=([^\s]+)/.exec(saida)?.[1] ?? "";
  }

  /** Apaga o campo focado: vai ao fim e dá backspace. */
  limparCampo(caracteres = 60) {
    return this.shell("input", "keyevent", "KEYCODE_MOVE_END", ...Array(caracteres).fill("KEYCODE_DEL"));
  }

  async prop(nome) {
    return (await this.shell("getprop", nome)).trim();
  }

  async setprop(nome, valor) {
    await this.shell("setprop", nome, valor);
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

  /** Janela com foco ("com.instagram.android/…MainTabActivity"), pelo dumpsys: na hora, sem uiautomator. */
  async focoAtual() {
    const saida = await this.shell("dumpsys", "window").catch(() => "");
    return /mCurrentFocus=Window\{[^}]*\s([^\s}]+)\}/.exec(saida)?.[1] ?? "";
  }

  /**
   * Abre o app pela atividade LAUNCHER resolvida (`cmd package resolve-activity`
   * + `am start -W`). O `monkey` do redroid 13 aborta (rc 251, "VM exiting with
   * result code -5") sem abrir nada, visto em 2026-11-08 no ig-2; fica só como
   * último recurso quando a resolução falha.
   */
  async abrirApp(pacote) {
    const saida = await this.shell("cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", pacote).catch(() => "");
    const atividade = resolverAtividade(saida, pacote);
    if (atividade) {
      const r = await this.shell("am", "start", "-W", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-n", atividade);
      if (/Error|Exception/i.test(r) && !/Status:\s*ok/i.test(r)) throw new Error(`am start ${atividade} falhou: ${trecho(r)}`);
      return r;
    }
    const r = await rodar(this.adb, ["-s", this.serial, "shell", "monkey", "-p", pacote, "-c", "android.intent.category.LAUNCHER", "1"], { timeoutMs: 60_000 });
    if (r.codigo !== 0 || !/Events injected/i.test(String(r.stdout))) {
      throw new Error(`não achei a atividade LAUNCHER de ${pacote} e o monkey falhou (rc ${r.codigo}): ${trecho(String(r.stdout + r.stderr).split("\n").slice(-3).join(" "))}`);
    }
    return String(r.stdout);
  }

  fecharApp(pacote) {
    return this.shell("am", "force-stop", pacote);
  }

  /** Copia um arquivo da VPS para o container (na /sdcard o Android já põe na galeria sozinho). */
  async enviar(local, remoto) {
    const r = await rodar(this.adb, ["-s", this.serial, "push", local, remoto], { timeoutMs: 300_000 });
    if (r.codigo !== 0) throw new Error(`adb push falhou: ${trecho(r.stderr || r.stdout)}`);
  }

  /** Copia um arquivo do container para a VPS. */
  async puxar(remoto, local) {
    const r = await rodar(this.adb, ["-s", this.serial, "pull", remoto, local], { timeoutMs: 300_000 });
    if (r.codigo !== 0) throw new Error(`adb pull falhou: ${trecho(r.stderr || r.stdout)}`);
  }

  /** Saída binária de um comando do Android (exec-out). */
  async binario(...args) {
    const r = await rodar(this.adb, ["-s", this.serial, "exec-out", ...args], { timeoutMs: 120_000, binario: true });
    if (r.codigo !== 0 || !r.stdout?.length) throw new Error(`exec-out ${args[0]} falhou: ${trecho(r.stderr)}`);
    return r.stdout;
  }

  /** Largura e altura da tela em pixels (wm size; vale o tamanho trocado, se houver). */
  async tamanho() {
    const saida = await this.shell("wm", "size");
    const m = /Override size:\s*(\d+)x(\d+)/.exec(saida) ?? /Physical size:\s*(\d+)x(\d+)/.exec(saida);
    if (!m) throw new Error(`Não li o tamanho da tela: ${trecho(saida)}`);
    return { largura: Number(m[1]), altura: Number(m[2]) };
  }

  /** PNG da tela. */
  async print() {
    return this.binario("screencap", "-p");
  }

  /** Elementos da tela agora (uiautomator dump). */
  async tela() {
    // O uiautomator devolve "null root node" enquanto a tela ainda está desenhando: tenta de novo.
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
