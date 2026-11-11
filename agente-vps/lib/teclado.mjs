import { existsSync } from "node:fs";

/**
 * Teclado ADB (ADBKeyboard, github.com/senzhk/ADBKeyBoard): o `input text` do
 * Android só digita ASCII; com este teclado como padrão o texto chega por
 * broadcast (`am broadcast --receiver-foreground -a ADB_INPUT_TEXT --es msg "<texto>"`) e aceita
 * acento e emoji. O APK fica pinado em /opt/scalemaster/apks/adbkeyboard.apk
 * (sha256 ao lado) e é instalado na etapa `instagram` se o container não tiver.
 */

export const TECLADO = "com.android.adbkeyboard";
export const IME = `${TECLADO}/.AdbIME`;
export const APK_TECLADO = process.env.SCALEMASTER_TECLADO_APK || "/opt/scalemaster/apks/adbkeyboard.apk";
/** Aviso da etapa quando o broadcast falha e o texto não cabe no `input text`. */
export const TECLADO_INDISPONIVEL = "TECLADO_INDISPONIVEL";

/** Texto entre aspas simples para o sh do Android (o adb shell junta os argumentos numa linha só). */
export function aspas(texto) {
  return `'${String(texto).replace(/'/g, `'\\''`)}'`;
}

/**
 * Argumentos do `adb shell` que mandam o texto para o campo focado.
 * --receiver-foreground põe o broadcast na fila de primeiro plano: logo depois
 * de o Instagram abrir a fila de segundo plano fica congestionada e o mesmo
 * broadcast levava 4,4–8,9 s; com a flag, 35–44 ms (teste-ig, 11/11).
 */
export function comandoDigitar(texto) {
  return ["am", "broadcast", "--receiver-foreground", "-a", "ADB_INPUT_TEXT", "--es", "msg", aspas(texto)];
}

/**
 * Apaga todo o texto do campo focado (ADB_CLEAR_TEXT do teclado ADB), de
 * qualquer tamanho: os 60 DELs de antes não davam conta da bio de 150 com
 * emoji e o texto novo entrava colado no antigo (aline.guimaraes82807, 11/11).
 */
export function comandoLimpar() {
  return ["am", "broadcast", "--receiver-foreground", "-a", "ADB_CLEAR_TEXT"];
}

/** O `am broadcast` entregou? (sem "Broadcast completed" ou com erro = falhou) */
export function broadcastOk(saida) {
  const s = String(saida ?? "");
  return /Broadcast completed/i.test(s) && !/Exception|Error:/i.test(s);
}

/** Só ASCII visível: o que o `input text` consegue digitar. */
export function soAscii(texto) {
  return /^[\x20-\x7E]*$/.test(String(texto));
}

/**
 * Digita `texto` no campo focado. Com o teclado ADB ativo vai por broadcast
 * (aceita acento e emoji); se o broadcast falhar, ou sem o teclado, cai no
 * `input text`, que só digita ASCII — texto com acento ou emoji nesse caso
 * para a etapa com TECLADO_INDISPONIVEL (o único aviso que sobra). Devolve por
 * onde foi: "broadcast" ou "input".
 *   ativo()            → o teclado ADB é o padrão do container?
 *   broadcast(args)    → roda `adb shell <args>` e devolve { codigo, stdout, stderr }
 *   inputText(texto)   → `input text` (só chega aqui com ASCII)
 *   aoFalhar()         → o broadcast falhou (o chamador esquece o "ativo")
 */
export async function digitarCom(texto, { ativo, broadcast, inputText, aoFalhar = () => {} }) {
  const t = String(texto);
  let motivo = "o teclado ADB não é o teclado padrão";
  if (await ativo()) {
    const r = await broadcast(comandoDigitar(t));
    if (r?.codigo === 0 && broadcastOk(r.stdout)) return "broadcast";
    motivo = `o broadcast do teclado ADB falhou (${String(r?.stderr || r?.stdout || `rc ${r?.codigo}`).trim().slice(0, 120)})`;
    aoFalhar();
  }
  if (!soAscii(t)) throw new Error(`${TECLADO_INDISPONIVEL}: ${motivo} e o texto tem acento ou emoji, que o input text não digita`);
  await inputText(t);
  return "input";
}

/**
 * Instala o teclado (se ausente) e define como padrão. true = é o teclado
 * ativo. Sem o APK na VPS, ou se o Android não aceitar, devolve false e a
 * digitação cai no `input text` (só ASCII).
 * @param {any} d
 * @param {(m: string) => void} [log]
 * @param {{ apk?: string }} [opcoes]
 */
export async function garantirTeclado(d, log = () => {}, { apk = APK_TECLADO } = {}) {
  if (!(await d.temApp(TECLADO))) {
    if (!existsSync(apk)) {
      log(`teclado ADB: ${apk} não está na VPS; texto com acento ou emoji não vai ser digitado`);
      return false;
    }
    await d.instalar(apk);
    log("teclado ADB instalado");
  }
  // Logo depois de instalar o Android ainda não lista o teclado: tenta por alguns segundos.
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    await d.shell("ime", "enable", IME).catch(() => "");
    await d.shell("ime", "set", IME).catch(() => "");
    const atual = (await d.shell("settings", "get", "secure", "default_input_method").catch(() => "")).trim();
    if (atual === IME) {
      d.tecladoAdb_ = true;
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log("teclado ADB: o Android não aceitou como teclado padrão; digitação por input text");
  return false;
}
