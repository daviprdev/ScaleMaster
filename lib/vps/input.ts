import type { DevicePerfil, ProvedorEmail, VpsContaDados } from "./types";

/**
 * Validação do formulário "Enviar lote" da aba Contas VPS. Puro (sem undici):
 * roda no navegador para avisar antes de enviar e no servidor para valer.
 */

export const LOTE_MIN = 1;
export const LOTE_MAX = 20;

const PERFIS: ReadonlySet<string> = new Set<DevicePerfil>(["aleatorio", "pixel7", "sm-a546e", "moto-g84"]);
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const BIRTH_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const PAIS_RE = /^[A-Z]{2}$/;
const VERSAO_IG_RE = /^[0-9][0-9A-Za-z.\-_]{0,30}$/;
const ASCII_RE = /^[\x20-\x7E]*$/;
const PROVEDORES: ReadonlySet<string> = new Set<ProvedorEmail>(["portal", "mailtm", "imap", "manual"]);
/** Código de resgate do portal (hstock): 6 a 12 letras/números. */
const CODIGO_PORTAL_RE = /^[A-Za-z0-9]{6,12}$/;
export const PORTAL_PADRAO = "https://hridoyhub.shop/OTP/";

export function provedorEmailValido(valor: unknown): valor is ProvedorEmail {
  return typeof valor === "string" && PROVEDORES.has(valor);
}

/** Link do portal: https, host com ponto, sem usuário/senha nem espaço. */
export function linkPortalValido(link: string): boolean {
  if (!/^https:\/\/\S+$/.test(link) || link.length > 200) return false;
  try {
    const u = new URL(link);
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function codigoPortalValido(codigo: string): boolean {
  return CODIGO_PORTAL_RE.test(codigo);
}

/**
 * Uma linha do hstock: "https://hridoyhub.shop/OTP/ | SUDXHRAY" (também aceita
 * só o código, com o link padrão, ou "link codigo" separado por espaço). null =
 * não é uma linha do portal.
 */
export function parseLinhaPortal(raw: unknown): { link: string; codigo: string } | null {
  const linha = typeof raw === "string" ? raw.trim().replace(/[,;]\s*$/, "") : "";
  if (!linha || !ASCII_RE.test(linha)) return null;
  const partes = linha
    .split(/\s*\|\s*|\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 1) {
    const codigo = partes[0].toUpperCase();
    return codigoPortalValido(codigo) ? { link: PORTAL_PADRAO, codigo } : null;
  }
  if (partes.length !== 2) return null;
  const [a, b] = partes;
  const link = /^https?:\/\//i.test(a) ? a : /^https?:\/\//i.test(b) ? b : null;
  const codigo = (link === a ? b : a).toUpperCase();
  if (!link || !linkPortalValido(link) || !codigoPortalValido(codigo)) return null;
  return { link, codigo };
}

/** Várias linhas do hstock coladas (uma por conta), ignorando as vazias. */
export function parseLinhasPortal(raw: string): Array<{ link: string; codigo: string } | null> {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => parseLinhaPortal(l));
}

export function field(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function hostValido(host: string): boolean {
  const m = IPV4_RE.exec(host);
  if (m) return m.slice(1).every((p) => Number(p) <= 255);
  return HOST_RE.test(host) && host.includes(".");
}

export function portaValida(porta: string | number): boolean {
  const n = typeof porta === "number" ? porta : /^\d{1,5}$/.test(porta) ? Number(porta) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

export interface ProxyLida {
  /** http://usuario:senha@host:porta */
  url: string;
  host: string;
  porta: number;
  /** País (ISO-2) quando a linha trouxe um 5º campo; senão null (vale o do lote). */
  pais: string | null;
}

/**
 * Uma linha da caixa de proxies: host:porta:usuário:senha (opcional :PAÍS no
 * fim), ou usuário:senha@host:porta, ou a URL http://usuário:senha@host:porta.
 * null = inválida.
 */
export function parseProxy(raw: string): ProxyLida | null {
  const linha = raw.trim().replace(/[,;]\s*$/, "");
  if (!linha || linha.length > 300 || !ASCII_RE.test(linha)) return null;

  const montar = (host: string, porta: string, usuario: string, senha: string, pais: string | null): ProxyLida | null => {
    if (!hostValido(host) || !portaValida(porta) || !usuario || !senha) return null;
    if (pais !== null && !PAIS_RE.test(pais)) return null;
    const url = `http://${encodeURIComponent(usuario)}:${encodeURIComponent(senha)}@${host.toLowerCase()}:${Number(porta)}`;
    return { url, host: host.toLowerCase(), porta: Number(porta), pais };
  };

  if (linha.includes("://")) {
    let u: URL;
    let usuario: string;
    let senha: string;
    try {
      u = new URL(linha);
      // "%" solto no usuário/senha passa pelo new URL e estoura só no decode.
      usuario = decodeURIComponent(u.username);
      senha = decodeURIComponent(u.password);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    return montar(u.hostname, u.port, usuario, senha, null);
  }

  if (linha.includes("@")) {
    const [esq, dir] = linha.split("@");
    const lp = (esq ?? "").split(":");
    const rp = (dir ?? "").split(":");
    if (lp.length === 2 && rp.length === 2) {
      if (hostValido(rp[0]) && portaValida(rp[1])) return montar(rp[0], rp[1], lp[0], lp[1], null);
      if (hostValido(lp[0]) && portaValida(lp[1])) return montar(lp[0], lp[1], rp[0], rp[1], null);
    }
    return null;
  }

  const partes = linha.split(":");
  if (partes.length === 4) return montar(partes[0], partes[1], partes[2], partes[3], null);
  if (partes.length === 5) return montar(partes[0], partes[1], partes[2], partes[3], partes[4].toUpperCase());
  return null;
}

/** A caixa inteira: uma proxy por linha, sem linha vazia contar. */
export function parseProxies(raw: unknown): { value: ProxyLida[] } | { error: string } {
  const linhas = (Array.isArray(raw) ? raw.map((l) => (typeof l === "string" ? l : "")) : typeof raw === "string" ? raw.split(/\r?\n/) : [])
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ProxyLida[] = [];
  const vistas = new Set<string>();
  for (const [i, linha] of linhas.entries()) {
    const p = parseProxy(linha);
    if (!p) return { error: `Proxy da linha ${i + 1} no formato host:porta:usuário:senha.` };
    const chave = `${p.host}:${p.porta}`;
    if (vistas.has(chave)) return { error: `A proxy ${chave} aparece mais de uma vez: cada conta precisa da sua.` };
    vistas.add(chave);
    out.push(p);
  }
  return { value: out };
}

/**
 * Uma linha de conta do lote. Senhas e nome sem acento (o Android digita por
 * input text). A validação do e-mail depende do provedor: `portal` exige link
 * https + código de resgate (uma linha "link | codigo" colada no campo do
 * e-mail é separada aqui), `imap` host/porta/senha, `mailtm` endereço + senha,
 * `manual` só o endereço. Sem provedor = imap (contas antigas).
 */
export function parseConta(raw: unknown, linha: number): { value: VpsContaDados } | { error: string } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const provedorBruto = field(r.provedorEmail, 10).toLowerCase() || "imap";
  if (!provedorEmailValido(provedorBruto)) return { error: `Conta ${linha}: provedor de e-mail desconhecido.` };
  const value: VpsContaDados = {
    provedorEmail: provedorBruto,
    email: field(r.email, 200),
    senhaEmail: field(r.senhaEmail, 200),
    imapHost: field(r.imapHost, 253).toLowerCase(),
    imapPorta: Number(field(r.imapPorta, 5) || 993),
    senhaIg: field(r.senhaIg, 100),
    nome: field(r.nome, 60),
    usuario: field(r.usuario, 30).replace(/^@/, ""),
    nascimento: field(r.nascimento, 10),
  };
  const onde = `Conta ${linha}: `;
  if (value.provedorEmail === "portal") {
    // "link | codigo" colado inteiro no campo do link: separa (o código da linha vale sobre o campo).
    const lida = value.email.includes("|") || (!value.senhaEmail && !/^https?:\/\//i.test(value.email)) ? parseLinhaPortal(value.email) : null;
    if (lida) {
      value.email = lida.link;
      value.senhaEmail = lida.codigo;
    }
    value.senhaEmail = value.senhaEmail.toUpperCase();
    if (!linkPortalValido(value.email)) return { error: `${onde}informe o link do portal (https://…).` };
    if (!codigoPortalValido(value.senhaEmail)) return { error: `${onde}código de resgate com 6 a 12 letras/números.` };
    value.imapHost = "";
    value.imapPorta = 0;
  } else {
    value.email = value.email.slice(0, 100).toLowerCase();
    if (!EMAIL_RE.test(value.email)) return { error: `${onde}informe o e-mail.` };
    if (value.provedorEmail === "manual") {
      if (!ASCII_RE.test(value.senhaEmail)) return { error: `${onde}a senha do e-mail não pode ter acento nem emoji.` };
      value.imapHost = "";
      value.imapPorta = 0;
    } else if (value.provedorEmail === "mailtm") {
      if (!value.senhaEmail) return { error: `${onde}informe a senha da conta no mail.tm.` };
      if (!ASCII_RE.test(value.senhaEmail)) return { error: `${onde}a senha do e-mail não pode ter acento nem emoji.` };
      value.imapHost = "";
      value.imapPorta = 0;
    } else {
      if (!value.senhaEmail) return { error: `${onde}informe a senha do e-mail (ou a senha de app do IMAP).` };
      if (!ASCII_RE.test(value.senhaEmail)) return { error: `${onde}a senha do e-mail não pode ter acento nem emoji.` };
      if (!value.imapHost) value.imapHost = imapPadrao(value.email);
      if (!hostValido(value.imapHost)) return { error: `${onde}host IMAP inválido.` };
      if (!portaValida(value.imapPorta)) return { error: `${onde}porta IMAP inválida.` };
    }
  }
  if (value.senhaIg.length < 6) return { error: `${onde}a senha do Instagram precisa de pelo menos 6 caracteres.` };
  if (!ASCII_RE.test(value.senhaIg)) return { error: `${onde}a senha do Instagram não pode ter acento nem emoji.` };
  if (!value.nome) return { error: `${onde}informe o nome completo.` };
  if (!ASCII_RE.test(value.nome)) return { error: `${onde}o nome não pode ter acento nem emoji.` };
  if (value.usuario && !USERNAME_RE.test(value.usuario)) {
    return { error: `${onde}usuário do Instagram só com letras, números, ponto e _ (até 30).` };
  }
  const m = BIRTH_RE.exec(value.nascimento);
  const date = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
  if (!m || !date || date.getDate() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1) {
    return { error: `${onde}data de nascimento no formato dd/mm/aaaa.` };
  }
  const ano = Number(m[3]);
  if (ano < 1940 || ano > new Date().getFullYear() - 16) return { error: `${onde}data de nascimento fora do esperado.` };
  return { value };
}

/** Host IMAP pelo domínio do e-mail, quando o formulário não informa. */
export function imapPadrao(email: string): string {
  const dominio = email.split("@")[1] ?? "";
  if (/^(gmail\.com|googlemail\.com)$/.test(dominio)) return "imap.gmail.com";
  if (/^(outlook\.com|hotmail\.com|live\.com|msn\.com)$/.test(dominio)) return "outlook.office365.com";
  if (/^(yahoo\.com|yahoo\.com\.br|ymail\.com)$/.test(dominio)) return "imap.mail.yahoo.com";
  if (/^(icloud\.com|me\.com|mac\.com)$/.test(dominio)) return "imap.mail.me.com";
  return dominio ? `imap.${dominio}` : "";
}

export interface LoteInput {
  agentId: string;
  quantidade: number;
  proxies: ProxyLida[];
  perfil: DevicePerfil;
  versaoIg: string;
  /** País padrão das proxies (ISO-2), para as linhas sem o 5º campo. */
  pais: string;
  contas: VpsContaDados[];
}

/**
 * Corpo do POST /api/vps/contas. `versoes` = APKs que a VPS listou (vazio =
 * aceita qualquer versão bem formada, a VPS avisa se não tiver).
 */
export function parseLoteInput(raw: unknown, versoes: readonly string[] = []): { value: LoteInput } | { error: string } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const agentId = field(body.agentId, 60);
  if (!agentId) return { error: "VPS não informada." };

  const quantidade = typeof body.quantidade === "number" ? body.quantidade : Number(field(body.quantidade, 3));
  if (!Number.isInteger(quantidade) || quantidade < LOTE_MIN || quantidade > LOTE_MAX) {
    return { error: `Quantidade de ${LOTE_MIN} a ${LOTE_MAX} contas por envio.` };
  }

  const proxies = parseProxies(body.proxies);
  if ("error" in proxies) return proxies;
  if (proxies.value.length !== quantidade) {
    return { error: `São ${quantidade} conta(s) e ${proxies.value.length} proxy(s): uma proxy por conta.` };
  }

  const perfil = field(body.perfil, 20) || "aleatorio";
  if (!PERFIS.has(perfil)) return { error: "Perfil de aparelho desconhecido." };

  const versaoIg = field(body.versaoIg, 30);
  if (!VERSAO_IG_RE.test(versaoIg)) return { error: "Escolha a versão do Instagram." };
  if (versoes.length > 0 && !versoes.includes(versaoIg)) return { error: `A VPS não tem o Instagram ${versaoIg} em /opt/scalemaster/apks.` };

  const pais = (field(body.pais, 10) || "BR").toUpperCase();
  if (!PAIS_RE.test(pais)) return { error: "País da proxy em duas letras (ex.: BR)." };

  const linhas = Array.isArray(body.conta) ? body.conta : [];
  if (linhas.length !== quantidade) return { error: `Preencha as ${quantidade} conta(s) do lote.` };
  const contas: VpsContaDados[] = [];
  const emails = new Set<string>();
  for (const [i, linha] of linhas.entries()) {
    const c = parseConta(linha, i + 1);
    if ("error" in c) return c;
    // No portal o link é o mesmo em todas: o que não pode repetir é o código de resgate.
    const chave = c.value.provedorEmail === "portal" ? `${c.value.email}|${c.value.senhaEmail}` : c.value.email;
    if (emails.has(chave)) {
      return { error: c.value.provedorEmail === "portal" ? `O código de resgate da conta ${i + 1} aparece em mais de uma conta.` : `O e-mail ${c.value.email} aparece em mais de uma conta.` };
    }
    emails.add(chave);
    contas.push(c.value);
  }

  return { value: { agentId, quantidade, proxies: proxies.value, perfil: perfil as DevicePerfil, versaoIg, pais, contas } };
}
