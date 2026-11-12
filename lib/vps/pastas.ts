import { prontidaoDaConta, type PlanoEtapa } from "./estruturacao";

/**
 * Pastas da aba Contas VPS (supabase/vps_pastas.sql, 12/11): cada conta
 * (job nova-conta) fica numa pasta escolhida ou criada no "Enviar lote" e
 * trocada no card; a lista filtra por pasta e o "Estruturar pasta" cria uma
 * estruturação para cada conta criada da pasta que ainda não está pronta.
 * Sem pasta = null ("Sem pasta" na tela).
 */

export const PASTA_MAX = 40;
/** Valor do filtro/seletor para "Sem pasta" (null no banco). */
export const SEM_PASTA = "__sem_pasta__";
export const FALTA_SQL_PASTAS = "Falta aplicar o SQL supabase/vps_pastas.sql no Supabase (SQL Editor).";

/** Nome da pasta como vai para o banco: sem espaços sobrando, até 40 caracteres; vazio = null (sem pasta). */
export function normalizarPasta(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const nome = raw.replace(/\s+/g, " ").trim();
  if (!nome || nome === SEM_PASTA) return null;
  return [...nome].slice(0, PASTA_MAX).join("");
}

interface ContaComPasta {
  kind: string;
  pasta?: string | null;
}

/** Pastas que existem (alguma conta nelas), em ordem alfabética, com o número de contas. */
export function pastasDasContas(contas: ReadonlyArray<ContaComPasta>): Array<{ nome: string; contas: number }> {
  const conta = new Map<string, number>();
  for (const c of contas) if (c.kind === "nova-conta" && c.pasta) conta.set(c.pasta, (conta.get(c.pasta) ?? 0) + 1);
  return [...conta.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([nome, n]) => ({ nome, contas: n }));
}

/** Filtro da lista: "" = todas, SEM_PASTA = só as sem pasta, nome = só as da pasta. */
export function filtrarPorPasta<T extends { pasta?: string | null }>(contas: ReadonlyArray<T>, filtro: string): T[] {
  if (!filtro) return [...contas];
  if (filtro === SEM_PASTA) return contas.filter((c) => !c.pasta);
  return contas.filter((c) => c.pasta === filtro);
}

export interface ContaParaEstruturar {
  id: string;
  kind: string;
  status: string;
  label: string | null;
  pasta?: string | null;
}

export interface EstruturaDaConta {
  status: string;
  plano?: ReadonlyArray<PlanoEtapa> | null;
  steps: ReadonlyArray<{ key: string; status: string; message?: string | null }>;
}

/**
 * Quem entra no "Estruturar pasta": conta criada (nova-conta concluída) da
 * pasta, sem estruturação na fila/rodando e que ainda não está pronta
 * (selo verde). O resto volta em `puladas` com o motivo.
 */
export function elegiveisDaPasta<C extends ContaParaEstruturar>(
  contas: ReadonlyArray<C>,
  pasta: string | null,
  estruturaDe: (contaId: string) => EstruturaDaConta | null | undefined
): { elegiveis: C[]; puladas: Array<{ label: string; motivo: string }> } {
  const elegiveis: C[] = [];
  const puladas: Array<{ label: string; motivo: string }> = [];
  for (const c of contas) {
    if (c.kind !== "nova-conta" || (c.pasta ?? null) !== pasta) continue;
    const label = c.label ? `@${c.label}` : "conta";
    if (c.status !== "done") {
      puladas.push({ label, motivo: "ainda não foi criada" });
      continue;
    }
    const estrutura = estruturaDe(c.id);
    if (estrutura && (estrutura.status === "queued" || estrutura.status === "running")) {
      puladas.push({ label, motivo: "já tem estruturação na fila" });
      continue;
    }
    if (prontidaoDaConta(estrutura) === "pronta") {
      puladas.push({ label, motivo: "já está pronta" });
      continue;
    }
    elegiveis.push(c);
  }
  return { elegiveis, puladas };
}
