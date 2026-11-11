/**
 * Regras do Estruturar (kind 'estruturacao') que não mexem em tela: quais
 * etapas a falha de outra bloqueia e como ler o @ da página de confirmação.
 * As chaves são as de lib/vps/estruturacao.ts (expandirEtapas).
 */

export const PROFISSIONAL_FALHOU = "PROFISSIONAL_FALHOU";
/** A conta não está logada no Instagram do container: o job para, a conta fica. */
export const SESSAO_PERDIDA = "SESSAO_PERDIDA";
/** A página abriu sem sessão e o container não tem navegador para fazer o login. */
export const SEM_NAVEGADOR = "SEM_NAVEGADOR";
export const CONEXAO_OUTRA_CONTA = "CONEXAO_OUTRA_CONTA";

const DO_ALVO_RE = /^(perfil|destaque|link|conectar|consentir|confirmar)-(\d+)$/;
const ORDEM_DO_ALVO = ["perfil", "destaque", "link", "conectar", "consentir", "confirmar"];

/** { tipo: "link", n: 2 } para "link-2"; null se a etapa não é de alvo. */
export function etapaDoAlvo(chave) {
  const m = DO_ALVO_RE.exec(String(chave));
  return m ? { tipo: m[1], n: Number(m[2]) } : null;
}

/**
 * Motivo para pular a etapa por causa de outra que falhou, ou null (roda).
 *   - `profissional` falhou: todas as etapas de OAuth (as dos alvos) ficam bloqueadas;
 *   - uma etapa do alvo N falhou (ex.: link-N): o resto do alvo N é pulado e o
 *     alvo seguinte roda normalmente;
 *   - `story` falhou: `destacar` não tem o que destacar.
 * foto, bio, story e as etapas dos outros alvos não dependem de nada.
 */
export function motivoParaPular(chave, falhas) {
  const tem = (k) => (falhas instanceof Set ? falhas.has(k) : falhas.includes(k));
  const alvo = etapaDoAlvo(chave);
  if (alvo) {
    if (tem("profissional")) return `${PROFISSIONAL_FALHOU}: etapas de OAuth bloqueadas`;
    const antes = ORDEM_DO_ALVO.slice(0, ORDEM_DO_ALVO.indexOf(alvo.tipo)).find((tipo) => tem(`${tipo}-${alvo.n}`));
    if (antes) return `pulada: ${antes}-${alvo.n} falhou`;
    return null;
  }
  if (chave === "destacar" && tem("story")) return "pulada: story falhou";
  return null;
}

const CONFIRMADO_RE = /conectad|connected|vinculad|linked|autorizad|authorized|sucesso|success|conclu[ií]d|tudo certo|all set|pronto/i;
const ARROBA_RE = /@([A-Za-z0-9._]{1,30})/;

/**
 * Lê os textos da página de confirmação: `confirmado` quando algum fala em
 * conectado/sucesso, e o @ exibido (minúsculo, sem ponto final), ou null.
 */
export function arrobaDaConfirmacao(textos) {
  const lista = (Array.isArray(textos) ? textos : []).map((t) => String(t ?? "")).filter(Boolean);
  const confirmado = lista.some((t) => CONFIRMADO_RE.test(t));
  // O @ da frase de confirmação vale mais que um @ solto em outro canto da página.
  const ordenada = [...lista.filter((t) => CONFIRMADO_RE.test(t)), ...lista];
  let usuario = null;
  for (const t of ordenada) {
    const m = ARROBA_RE.exec(t);
    if (!m) continue;
    usuario = m[1].replace(/[._]+$/, "").toLowerCase();
    if (usuario) break;
  }
  return { confirmado, usuario: usuario || null };
}

/** O @ que a página confirmou é o da conta? Sem @ na página não dá para dizer que divergiu. */
export function conferirConexao(usuarioDaPagina, usuarioDaConta) {
  if (!usuarioDaPagina) return { ok: true, mensagem: "conectada (a página não mostrou o @)" };
  const conta = String(usuarioDaConta ?? "").replace(/^@/, "").toLowerCase();
  if (usuarioDaPagina !== conta) {
    return { ok: false, mensagem: `${CONEXAO_OUTRA_CONTA}: a página conectou @${usuarioDaPagina}, a conta é @${conta}` };
  }
  return { ok: true, mensagem: `conectada como @${usuarioDaPagina}` };
}

/** Host do link sem www, para achar o sticker pelo texto. */
export function hostDoLink(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
