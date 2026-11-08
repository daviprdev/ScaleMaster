import { extrairCodigo } from "./imap.mjs";
import { esperar } from "./processo.mjs";

/**
 * Provedor "mailtm": caixa temporária do mail.tm (API pública JSON, sem
 * dependências). A conta já existe (endereço + senha criados pelo dono no
 * mail.tm); aqui só se pega o token e se lê a caixa até achar o código de 6
 * dígitos do Instagram (mesmo extrator do IMAP).
 */

export const MAILTM_API = process.env.MAILTM_API || "https://api.mail.tm";

async function chamar(caminho, { method = "GET", token = null, body = null } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers["Content-Type"] = "application/json";
  const r = await fetch(`${MAILTM_API}${caminho}`, { method, headers, body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (r.status === 401) throw new Error("mail.tm recusou o endereço/senha");
  if (!r.ok) throw new Error(`mail.tm devolveu HTTP ${r.status}`);
  return r.json();
}

/** Token da conta (POST /token). */
export async function token(email, senha) {
  const j = await chamar("/token", { method: "POST", body: { address: email, password: senha } });
  if (!j?.token) throw new Error("mail.tm não devolveu token");
  return j.token;
}

export async function testarLogin({ email, senha }) {
  await token(email, senha);
  return true;
}

/** Lista as mensagens (hydra:member) mais novas que `desde`. */
async function mensagens(tok, desde) {
  const j = await chamar("/messages?page=1", { token: tok });
  const lista = Array.isArray(j?.["hydra:member"]) ? j["hydra:member"] : Array.isArray(j) ? j : [];
  return lista.filter((m) => !m?.createdAt || Date.parse(m.createdAt) >= desde - 60_000);
}

/**
 * Espera o código do Instagram chegar na caixa do mail.tm (até timeoutMs).
 * Devolve o código ou lança.
 */
export async function esperarCodigo({ email, senha, desde = Date.now() - 5 * 60_000, timeoutMs = 180_000, log = () => {} }) {
  const limite = Date.now() + timeoutMs;
  const vistos = new Set();
  let tok = null;
  let ultimoErro = null;
  while (Date.now() < limite) {
    try {
      tok ||= await token(email, senha);
      for (const m of await mensagens(tok, desde)) {
        if (!m?.id || vistos.has(m.id)) continue;
        vistos.add(m.id);
        const completa = await chamar(`/messages/${encodeURIComponent(m.id)}`, { token: tok }).catch(() => m);
        const texto = [m.subject ?? "", completa?.text ?? "", m.intro ?? "", ...(Array.isArray(completa?.html) ? completa.html : [])].join("\n");
        const codigo = extrairCodigo(`Subject: ${m.subject ?? ""}\r\n\r\n${texto}`);
        if (codigo) return codigo;
      }
    } catch (e) {
      ultimoErro = e;
      if (/recusou/.test(e.message)) throw e;
      log(`mail.tm: ${e.message} (tentando de novo)`);
      tok = null;
    }
    await esperar(5000);
  }
  throw new Error(ultimoErro ? `o código não chegou no mail.tm (${ultimoErro.message})` : "o código não chegou no mail.tm a tempo");
}
