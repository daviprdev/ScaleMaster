import * as imapLib from "../lib/imap.mjs";
import * as mailtmLib from "../lib/mailtm.mjs";
import * as portalLib from "../lib/portal.mjs";
import { esperar } from "../lib/processo.mjs";

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
/** Código do portal já resgatado com sessão vencida (ou OTP já recebido): a conta para, o container fica, o card pede código novo. Igual a lib/emulador/jobs.ts. */
export const CODIGO_VENCIDO = "Código do portal vencido: edite a conta com um código novo";
export const SESSAO_PORTAL_MS = 20 * 60_000;

function erroCodigoVencido(motivo) {
  const e = new Error(CODIGO_VENCIDO);
  e.semPrefixo = true;
  e.manterContainer = true;
  e.motivo = motivo;
  return e;
}

/**
 * Código já resgatado antes (input.portalResgatadoEm) e vencido pelo relógio
 * (20 min) ou pelo /status (sessão acabou / OTP recebido). Código nunca
 * resgatado não é tocado: null.
 * @param {any} input
 * @param {any} [portal]
 */
export async function codigoVencido(input, portal = portalLib) {
  const resgatadoEm = Date.parse(input?.portalResgatadoEm ?? "");
  if (!Number.isFinite(resgatadoEm)) return null;
  const expiraEm = Date.parse(input?.portalExpiraEm ?? "") || resgatadoEm + SESSAO_PORTAL_MS;
  if (Date.now() >= expiraEm) return `sessão vencida em ${new Date(expiraEm).toISOString()}`;
  const link = input?.portalLink ?? input?.conta?.email;
  const codigo = input?.portalCodigo ?? input?.imap?.senha;
  const status = await portal.statusDoCodigo(link, codigo).catch(() => null);
  if (status?.acabou || status?.temOtp) return status.temOtp ? "sessão já recebeu OTP" : "sessão encerrada no portal";
  return null;
}

export function provedorDe(input) {
  const p = String(input?.provedorEmail ?? "").toLowerCase();
  return PROVEDORES.includes(p) ? p : "imap";
}

/** Descrição curta da caixa para a etapa `email` e para os logs (sem segredo). */
export function descricaoCaixa(input) {
  const p = provedorDe(input);
  if (p === "portal") return `portal ${input?.portalLink ?? input?.conta?.email ?? ""} (código ${portalLib.mascarar(input?.portalCodigo ?? input?.imap?.senha)})`;
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
    const link = input?.portalLink ?? conta.email;
    const codigo = input?.portalCodigo ?? cred.senha;
    if (!link || !codigo) throw new Error("Essa conta veio sem o link do portal ou sem o código de resgate.");
    if (!portal.codigoValido(codigo)) throw new Error("Código de resgate fora do formato (6 a 12 letras/números).");
    // Código já resgatado numa rodada anterior: nunca se reusa um vencido — para aqui e o card pede outro.
    const vencido = await codigoVencido(input, portal);
    if (vencido) throw erroCodigoVencido(vencido);
    await portal.verificarPortal(link);
    return `portal acessível (código ${portal.mascarar(codigo)}${input?.portalResgatadoEm ? ", sessão ainda válida" : ""}); a sessão abre na hora do cadastro`;
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
 * `aoResgatar({ resgatadoEm, expiraEm })` avisa quando o código do portal foi resgatado (vai para o input_enc).
 * @param {any} input
 * @param {{ log?: (m: string) => void, portal?: any, imap?: any, mailtm?: any, aoResgatar?: (p: { resgatadoEm: string, expiraEm: string }) => void }} [deps]
 */
export function criarCaixa(input, { log = () => {}, portal = portalLib, imap = imapLib, mailtm = mailtmLib, aoResgatar = () => {}, esperaPortalMs = 5000 } = {}) {
  const p = provedorDe(input);
  const conta = input?.conta ?? {};
  const cred = input?.imap ?? {};

  if (p === "portal") {
    // portalLink/portalCodigo vêm da linha do hstock; conta.email/imap.senha são os mesmos valores (contas antigas só têm estes).
    const link = String(input?.portalLink ?? conta.email ?? "");
    const codigo = String(input?.portalCodigo ?? cred.senha ?? "");
    let sessao = null;
    // Mensagens que já estavam na caixa quando o endereço foi digitado: OTP de tentativa anterior não vale.
    let vistos = null;
    // Códigos já digitados nesta caixa: o Instagram não aceita o mesmo duas vezes.
    const tentados = new Set();
    const abrir = async () => {
      if (sessao && sessao.fimEm && sessao.fimEm - Date.now() > 60_000) return sessao;
      await Promise.resolve(portal.fechar(sessao)).catch(() => {});
      sessao = null;
      const aberta = await portal.abrir(link, codigo, { log });
      sessao = aberta.sessao;
      // Hora do resgate e do fim da sessão: o servidor guarda no input_enc para a etapa email não reusar código vencido.
      const agora = Date.now();
      aoResgatar({ resgatadoEm: new Date(agora).toISOString(), expiraEm: new Date(sessao.fimEm ?? agora + SESSAO_PORTAL_MS).toISOString() });
      return sessao;
    };
    return {
      provedor: p,
      get email() {
        return sessao?.email ?? null;
      },
      async endereco() {
        // O portal às vezes passa de 15 s (4 contas abrindo juntas na KVM 8, emanuelle 13/11): tenta 3 vezes antes de
        // perguntar o endereço na aba.
        for (let tentativa = 1; tentativa <= 3; tentativa++) {
          try {
            const s = await abrir();
            vistos = portal.mensagensVistas ? await Promise.resolve(portal.mensagensVistas(s)).catch(() => null) : null;
            return s.email;
          } catch (e) {
            // Código já gasto: não há endereço possível com ele — para o job (container fica) e o card pede código novo.
            if (e.codigoVencido) throw erroCodigoVencido(e.message);
            log(`portal falhou ao abrir a sessão (tentativa ${tentativa}/3): ${e.message}`);
            if (tentativa < 3) await esperar(esperaPortalMs * tentativa);
          }
        }
        return null;
      },
      async esperarCodigo({ timeoutMs, sinal = null } = {}) {
        try {
          const s = await abrir();
          const restante = s.fimEm ? Math.max(30_000, s.fimEm - Date.now()) : 900_000;
          log(`esperando o OTP no portal (${portal.mascarar(codigo)}, até ${Math.round(Math.min(restante, timeoutMs ?? restante) / 60_000)} min)`);
          const otp = await portal.esperarOtp(s, Math.min(restante, timeoutMs ?? restante), { log, ignorar: vistos, descartar: tentados, sinal });
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
