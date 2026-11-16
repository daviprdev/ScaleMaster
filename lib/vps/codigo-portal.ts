import type { VpsContaInput } from "./types";

/**
 * Código do hstock de uma conta (16/11). O agente lê `portalCodigo`/`portalLink`
 * (com `imap.senha`/`conta.email` como reserva das contas antigas) e, depois do
 * resgate, `portalResgatadoEm`/`portalExpiraEm`/`portalEmail` — a janela de 20
 * min com o endereço, para a retomada não tocar no portal.
 */

/** Janela mínima para usar a sessão num cadastro (igual a JANELA_MINIMA_MS em agente-vps/fluxos/caixa.mjs). */
export const JANELA_MINIMA_MS = 4 * 60_000;

type CamposPortal = Pick<VpsContaInput, "portalLink" | "portalCodigo" | "portalResgatadoEm" | "portalExpiraEm" | "portalEmail">;

/**
 * Campos do portal depois de um Editar. Código ou link novos = conta sem resgate
 * (a janela gravada era do código anterior). Mesmo código = mantém a janela.
 * Outro provedor = nada do portal. `undefined` = apagar o campo.
 */
export function camposDoPortal(
  antes: Pick<VpsContaInput, "portalLink" | "portalCodigo" | "portalResgatadoEm" | "portalExpiraEm" | "portalEmail" | "conta" | "imap">,
  novo: { provedorEmail: string; email: string; senhaEmail: string }
): CamposPortal {
  if (novo.provedorEmail !== "portal") {
    return { portalLink: undefined, portalCodigo: undefined, portalResgatadoEm: undefined, portalExpiraEm: undefined, portalEmail: undefined };
  }
  const codigoAntes = String(antes.portalCodigo ?? antes.imap?.senha ?? "").toUpperCase();
  const linkAntes = String(antes.portalLink ?? antes.conta?.email ?? "");
  const mesmo = codigoAntes === String(novo.senhaEmail).toUpperCase() && linkAntes === novo.email;
  return {
    portalLink: novo.email,
    portalCodigo: novo.senhaEmail,
    portalResgatadoEm: mesmo ? antes.portalResgatadoEm : undefined,
    portalExpiraEm: mesmo ? antes.portalExpiraEm : undefined,
    portalEmail: mesmo ? antes.portalEmail : undefined,
  };
}

export type EstadoCodigo =
  | { estado: "livre" }
  | { estado: "em-uso"; ate: string; email: string | null }
  | { estado: "janela-encerrada"; ate: string | null };

/**
 * Estado do código para o card (Informações). Pausa depois do resgate não queima
 * o código: com a janela aberta ele está "em uso" até o fim dela; depois, "janela
 * encerrada" (o agente consulta o portal: reativa se der, senão pede código novo).
 */
export function estadoDoCodigo(input: Pick<VpsContaInput, "provedorEmail" | "portalResgatadoEm" | "portalExpiraEm" | "portalEmail">, agora = Date.now()): EstadoCodigo | null {
  if ((input.provedorEmail ?? "imap") !== "portal") return null;
  if (!input.portalResgatadoEm) return { estado: "livre" };
  const fim = Date.parse(input.portalExpiraEm ?? "");
  if (Number.isFinite(fim) && fim > agora) return { estado: "em-uso", ate: new Date(fim).toISOString(), email: input.portalEmail ?? null };
  return { estado: "janela-encerrada", ate: Number.isFinite(fim) ? new Date(fim).toISOString() : null };
}

/** "SUDXHRAY" → "SU****AY" (igual ao mascarar do agente). */
export function mascararCodigo(codigo: string | undefined | null): string {
  const c = String(codigo ?? "");
  return c.length <= 4 ? "****" : `${c.slice(0, 2)}${"*".repeat(c.length - 4)}${c.slice(-2)}`;
}
