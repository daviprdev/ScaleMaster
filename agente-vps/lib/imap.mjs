import { connect } from "node:tls";
import { esperar } from "./processo.mjs";

/**
 * Cliente IMAP mínimo sobre node:tls (sem dependências): LOGIN, SELECT INBOX,
 * UID SEARCH SINCE <data>, UID FETCH BODY[], LOGOUT. Serve só para achar o
 * código de 6 dígitos que o Instagram manda por e-mail no cadastro.
 */

const REMETENTES_INSTAGRAM = /instagram|facebookmail|meta\.com|security@mail\.instagram\.com/i;
const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dataImap(data) {
  const d = new Date(data);
  return `${d.getUTCDate()}-${MESES[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** Decodifica quoted-printable e base64 (os dois jeitos que o Instagram usa no corpo). */
export function decodificarCorpo(texto, encoding) {
  const enc = String(encoding ?? "").toLowerCase();
  if (enc === "base64") {
    try {
      return Buffer.from(texto.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return texto;
    }
  }
  if (enc === "quoted-printable") {
    return texto.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return texto;
}

/** "=?UTF-8?B?...?=" / "=?UTF-8?Q?...?=" nos cabeçalhos. */
function decodificarCabecalho(valor) {
  return String(valor ?? "").replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _cs, tipo, dados) =>
    tipo.toUpperCase() === "B" ? Buffer.from(dados, "base64").toString("utf8") : dados.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16)))
  );
}

/**
 * Extrai o código de 6 dígitos de uma mensagem (cabeçalhos + corpo). Quando a
 * mensagem é multipart, olha cada parte decodificada. Prefere o código que vem
 * logo depois de "código"/"code"; senão o primeiro grupo de 6 dígitos isolado.
 */
export function extrairCodigo(mensagem) {
  const partes = [];
  const [cabecalhos, ...resto] = String(mensagem).split(/\r?\n\r?\n/);
  const corpo = resto.join("\n\n");
  const limite = /boundary="?([^";\r\n]+)"?/i.exec(cabecalhos)?.[1];
  if (limite) {
    for (const parte of corpo.split(`--${limite}`)) {
      const [cab, ...c] = parte.split(/\r?\n\r?\n/);
      const enc = /Content-Transfer-Encoding:\s*([^\r\n]+)/i.exec(cab)?.[1];
      partes.push(decodificarCorpo(c.join("\n\n"), enc));
    }
  } else {
    const enc = /Content-Transfer-Encoding:\s*([^\r\n]+)/i.exec(cabecalhos)?.[1];
    partes.push(decodificarCorpo(corpo, enc));
  }
  partes.push(decodificarCabecalho(/^Subject:\s*(.*)$/im.exec(cabecalhos)?.[1] ?? ""));
  const texto = partes.join("\n").replace(/<[^>]+>/g, " ");
  const perto = /(?:c[oó]digo|code)[^0-9]{0,40}?(\d{6})\b/i.exec(texto)?.[1];
  if (perto) return perto;
  const solto = /(?<!\d)(\d{6})(?!\d)/.exec(texto)?.[1];
  return solto ?? null;
}

/** Sessão IMAP: manda comandos com tag e junta a resposta até a linha "<tag> OK|NO|BAD". */
class SessaoImap {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.n = 0;
    this.espera = null;
    socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      this.espera?.();
    });
    socket.on("error", (e) => {
      this.erro = e;
      this.espera?.();
    });
    socket.on("close", () => {
      this.fechado = true;
      this.espera?.();
    });
  }

  async saudacao() {
    await this.ate(() => /^\* (OK|PREAUTH|BYE)/m.test(this.buffer));
    const linha = this.buffer;
    this.buffer = "";
    if (/^\* BYE/m.test(linha)) throw new Error(`servidor recusou: ${linha.trim()}`);
  }

  ate(pronto, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const limite = setTimeout(() => {
        this.espera = null;
        reject(new Error("o servidor IMAP demorou demais"));
      }, timeoutMs);
      const checar = () => {
        if (this.erro) {
          clearTimeout(limite);
          this.espera = null;
          reject(this.erro);
        } else if (pronto()) {
          clearTimeout(limite);
          this.espera = null;
          resolve();
        } else if (this.fechado) {
          clearTimeout(limite);
          this.espera = null;
          reject(new Error("o servidor IMAP fechou a conexão"));
        }
      };
      this.espera = checar;
      checar();
    });
  }

  async comando(texto, timeoutMs) {
    const tag = `A${String(++this.n).padStart(3, "0")}`;
    this.socket.write(`${tag} ${texto}\r\n`);
    const fim = new RegExp(`^${tag} (OK|NO|BAD)(.*)$`, "m");
    await this.ate(() => fim.test(this.buffer), timeoutMs);
    const resposta = this.buffer;
    this.buffer = "";
    const m = fim.exec(resposta);
    if (m[1] !== "OK") throw new Error(`IMAP ${texto.split(" ")[0]}: ${m[1]}${m[2].trim() ? ` ${m[2].trim()}` : ""}`);
    return resposta;
  }

  fechar() {
    this.socket.end();
    this.socket.destroy();
  }
}

/** Literal IMAP: "usuário" e "senha" entre aspas, com aspas e barras escapadas. */
const entreAspas = (v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`;

export async function abrirSessao({ host, porta = 993, usuario, senha }) {
  const socket = await new Promise((resolve, reject) => {
    const s = connect({ host, port: Number(porta), servername: host }, () => resolve(s));
    s.once("error", reject);
    s.setTimeout(30_000, () => s.destroy(new Error("conexão IMAP sem resposta")));
  });
  const sessao = new SessaoImap(socket);
  await sessao.saudacao();
  await sessao.comando(`LOGIN ${entreAspas(usuario)} ${entreAspas(senha)}`);
  return sessao;
}

/** Só confere que o login funciona (etapa "email" do fluxo). */
export async function testarLogin(conta) {
  const sessao = await abrirSessao(conta);
  try {
    await sessao.comando("SELECT INBOX");
    return true;
  } finally {
    await sessao.comando("LOGOUT").catch(() => {});
    sessao.fechar();
  }
}

/** UIDs das mensagens desde a data (SINCE é por dia; o filtro de hora vem depois, pelo cabeçalho Date). */
async function buscarUids(sessao, desde) {
  const r = await sessao.comando(`UID SEARCH SINCE ${dataImap(desde)}`);
  const m = /^\* SEARCH(.*)$/m.exec(r);
  return (m?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

async function lerMensagem(sessao, uid) {
  const r = await sessao.comando(`UID FETCH ${uid} BODY.PEEK[]`, 60_000);
  const inicio = r.indexOf("}\r\n");
  const texto = inicio >= 0 ? r.slice(inicio + 3) : r;
  return texto.replace(/\r?\n\)\r?\nA\d{3} OK[^\n]*$/, "");
}

function dataDaMensagem(texto) {
  const d = /^Date:\s*(.*)$/im.exec(texto)?.[1];
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function remetenteDaMensagem(texto) {
  return decodificarCabecalho(/^From:\s*(.*)$/im.exec(texto)?.[1] ?? "");
}

/**
 * Espera o código do Instagram chegar: a cada 5 s abre a sessão, procura as
 * mensagens desde `desde` do remetente do Instagram, lê a mais recente e tira
 * o \b\d{6}\b. Estourou `timeoutMs` → null (quem chama cai no prompt manual).
 */
export async function esperarCodigo({ host, porta = 993, email, senha, desde = Date.now() - 5 * 60_000, timeoutMs = 180_000, log = () => {} }) {
  const limite = Date.now() + timeoutMs;
  const vistos = new Set();
  let ultimoErro = null;
  while (Date.now() < limite) {
    try {
      const sessao = await abrirSessao({ host, porta, usuario: email, senha });
      try {
        await sessao.comando("SELECT INBOX");
        const uids = (await buscarUids(sessao, desde)).sort((a, b) => b - a).slice(0, 10);
        for (const uid of uids) {
          if (vistos.has(uid)) continue;
          const texto = await lerMensagem(sessao, uid);
          const quando = dataDaMensagem(texto);
          if (quando && quando < desde - 120_000) {
            vistos.add(uid);
            continue;
          }
          if (!REMETENTES_INSTAGRAM.test(remetenteDaMensagem(texto))) {
            vistos.add(uid);
            continue;
          }
          const codigo = extrairCodigo(texto);
          if (codigo) {
            log(`código achado no e-mail (uid ${uid})`);
            return codigo;
          }
          vistos.add(uid);
        }
      } finally {
        await sessao.comando("LOGOUT").catch(() => {});
        sessao.fechar();
      }
    } catch (e) {
      ultimoErro = e.message;
      if (/LOGIN: NO/i.test(e.message)) throw new Error(`o IMAP recusou o login de ${email}: ${e.message}`);
    }
    await esperar(5000);
  }
  if (ultimoErro) log(`IMAP: ${ultimoErro}`);
  return null;
}
