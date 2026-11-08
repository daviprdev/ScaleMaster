import * as imapLib from "../lib/imap.mjs";
import * as mailtmLib from "../lib/mailtm.mjs";
import * as portalLib from "../lib/portal.mjs";

/**
 * A caixa de e-mail da conta, por provedor (input.provedorEmail):
 *   imap   — conta.email + imap.{host,porta,senha} (padrão das contas antigas)
 *   portal — conta.email = LINK do portal, imap.senha = CÓDIGO de resgate; a
 *            sessão (20 min) abre só na hora de digitar o endereço no Instagram
 *   mailtm — conta.email + imap.senha na API do mail.tm
 *   manual — nada automático: o código é pedido na aba
 *
 * Interface: endereco() → e-mail a digitar (null = não conseguiu, pergunte ao
 * dono); esperarCodigo({ desde, log }) → código ou null (null = pergunte na
 * aba); fechar() — sempre, inclusive em erro. Qualquer falha de provedor vira
 * null + log, nunca derruba o job.
 */

export const PROVEDORES = ["portal", "mailtm", "imap", "manual"];

export function provedorDe(input) {
  const p = String(input?.provedorEmail ?? "").toLowerCase();
  return PROVEDORES.includes(p) ? p : "imap";
}

/** Descrição curta da caixa para a etapa `email` e para os logs (sem segredo). */
export function descricaoCaixa(input) {
  const p = provedorDe(input);
  if (p === "portal") return `portal ${input?.conta?.email ?? ""} (código ${portalLib.mascarar(input?.imap?.senha)})`;
  if (p === "mailtm") return `mail.tm ${input?.conta?.email ?? ""}`;
  if (p === "manual") return `manual (${input?.conta?.email ?? ""})`;
  return `${input?.imap?.host ?? ""}:${input?.imap?.porta || 993} (${input?.conta?.email ?? ""})`;
}

/**
 * Etapa `email`: prova que a caixa responde sem gastar nada. IMAP e mail.tm
 * fazem login; portal só confere que o link mostra o form de resgate (a sessão
 * de 20 min não abre aqui); manual não faz nada.
 */
/**
 * @param {any} input
 * @param {{ portal?: any, imap?: any, mailtm?: any }} [deps] módulos injetáveis (testes)
 */
export async function conferirCaixa(input, { portal = portalLib, imap = imapLib, mailtm = mailtmLib } = {}) {
  const p = provedorDe(input);
  const conta = input?.conta ?? {};
  const cred = input?.imap ?? {};
  if (p === "manual") return `manual: o código será pedido na aba (${conta.email})`;
  if (p === "portal") {
    if (!conta.email || !cred.senha) throw new Error("Essa conta veio sem o link do portal ou sem o código de resgate.");
    if (!portal.codigoValido(cred.senha)) throw new Error("Código de resgate fora do formato (6 a 12 letras/números).");
    await portal.verificarPortal(conta.email);
    return `portal acessível (código ${portal.mascarar(cred.senha)}); a sessão abre na hora do cadastro`;
  }
  if (p === "mailtm") {
    if (!conta.email || !cred.senha) throw new Error("Essa conta veio sem o endereço ou a senha do mail.tm.");
    await mailtm.testarLogin({ email: conta.email, senha: cred.senha });
    return `mail.tm ${conta.email} ok`;
  }
  if (!cred.host || !cred.senha) throw new Error("Essa conta veio sem os dados do IMAP.");
  await imap.testarLogin({ host: cred.host, porta: cred.porta || 993, usuario: cred.usuario || conta.email, senha: cred.senha });
  return `${cred.host}:${cred.porta || 993} ok`;
}

/**
 * A caixa viva durante o cadastro (fluxos/cadastro.mjs). `log` recebe só texto sem segredo.
 * @param {any} input
 * @param {{ log?: (m: string) => void, portal?: any, imap?: any, mailtm?: any }} [deps]
 */
export function criarCaixa(input, { log = () => {}, portal = portalLib, imap = imapLib, mailtm = mailtmLib } = {}) {
  const p = provedorDe(input);
  const conta = input?.conta ?? {};
  const cred = input?.imap ?? {};

  if (p === "portal") {
    const link = String(conta.email ?? "");
    const codigo = String(cred.senha ?? "");
    let sessao = null;
    // Mensagens que já estavam na caixa quando o endereço foi digitado: OTP de tentativa anterior não vale.
    let vistos = null;
    // Códigos já digitados nesta caixa: o Instagram não aceita o mesmo duas vezes.
    const tentados = new Set();
    const abrir = async () => {
      if (sessao && sessao.fimEm && sessao.fimEm - Date.now() > 60_000) return sessao;
      await portal.fechar(sessao).catch(() => {});
      sessao = null;
      const aberta = await portal.abrir(link, codigo, { log });
      sessao = aberta.sessao;
      return sessao;
    };
    return {
      provedor: p,
      get email() {
        return sessao?.email ?? null;
      },
      async endereco() {
        try {
          const s = await abrir();
          vistos = portal.mensagensVistas ? await portal.mensagensVistas(s).catch(() => null) : null;
          return s.email;
        } catch (e) {
          log(`portal falhou ao abrir a sessão: ${e.message}`);
          return null;
        }
      },
      async esperarCodigo({ timeoutMs } = {}) {
        try {
          const s = await abrir();
          const restante = s.fimEm ? Math.max(30_000, s.fimEm - Date.now()) : 900_000;
          log(`esperando o OTP no portal (${portal.mascarar(codigo)}, até ${Math.round(Math.min(restante, timeoutMs ?? restante) / 60_000)} min)`);
          const otp = await portal.esperarOtp(s, Math.min(restante, timeoutMs ?? restante), { log, ignorar: vistos, descartar: tentados });
          if (otp) tentados.add(String(otp));
          return otp;
        } catch (e) {
          log(`portal não trouxe o OTP: ${e.message}`);
          return null;
        }
      },
      async fechar() {
        const s = sessao;
        sessao = null;
        await portal.fechar(s).catch(() => {});
      },
    };
  }

  if (p === "mailtm") {
    return {
      provedor: p,
      email: conta.email ?? null,
      async endereco() {
        return conta.email ?? null;
      },
      async esperarCodigo({ desde = Date.now() - 60_000, timeoutMs = 180_000 } = {}) {
        try {
          log(`esperando o código em ${conta.email} (mail.tm)`);
          return await mailtm.esperarCodigo({ email: conta.email, senha: cred.senha, desde, timeoutMs, log });
        } catch (e) {
          log(`mail.tm falhou: ${e.message}`);
          return null;
        }
      },
      async fechar() {},
    };
  }

  if (p === "manual") {
    return {
      provedor: p,
      email: conta.email ?? null,
      async endereco() {
        return conta.email ?? null;
      },
      async esperarCodigo() {
        return null;
      },
      async fechar() {},
    };
  }

  const temImap = !!(cred.host && cred.senha);
  return {
    provedor: "imap",
    email: conta.email ?? null,
    async endereco() {
      return conta.email ?? null;
    },
    async esperarCodigo({ desde = Date.now() - 60_000, timeoutMs = 180_000 } = {}) {
      if (!temImap) return null;
      try {
        log(`esperando o código em ${conta.email} (IMAP)`);
        return await imap.esperarCodigo({ host: cred.host, porta: cred.porta || 993, email: cred.usuario || conta.email, senha: cred.senha, desde, timeoutMs, log });
      } catch (e) {
        log(`IMAP falhou: ${e.message}`);
        return null;
      }
    },
    async fechar() {},
  };
}
