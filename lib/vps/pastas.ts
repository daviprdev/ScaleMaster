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

/**
 * Pastas fixas (13/11): a conta que termina o cadastro vai sozinha para
 * CRIADAS (concluída) ou FALHAS (terminou com erro, inclusive pausa de proxy e
 * agente que parou no meio). Aparecem sempre e não se renomeiam.
 */
export const PASTA_CRIADAS = "CRIADAS";
export const PASTA_FALHAS = "FALHAS";
export const PASTAS_FIXAS: readonly string[] = [PASTA_CRIADAS, PASTA_FALHAS];
/**
 * RODANDO (13/11) não existe no banco: é a pasta da tela onde ficam as contas
 * na fila ou sendo criadas, qualquer que seja a coluna `pasta`. Ao terminar,
 * o sync grava CRIADAS ou FALHAS e a conta sai dela.
 */
export const PASTA_RODANDO = "RODANDO";
const ORDEM_FIXAS: readonly string[] = [PASTA_RODANDO, PASTA_CRIADAS, PASTA_FALHAS];
const emAndamento = (status: string) => status === "queued" || status === "running";

/** Pasta de destino de uma conta que acabou de terminar o cadastro; null = ainda rodando. */
export function pastaAoTerminar(status: string): string | null {
  if (status === "done") return PASTA_CRIADAS;
  if (status === "error") return PASTA_FALHAS;
  return null;
}

/** RODANDO, CRIADAS e FALHAS (qualquer caixa) não se renomeiam. */
export function ehPastaFixa(nome: string | null | undefined): boolean {
  const n = String(nome ?? "").trim().toUpperCase();
  return ORDEM_FIXAS.includes(n);
}

/** Nome da pasta como vai para o banco: sem espaços sobrando, até 40 caracteres; vazio = null (sem pasta). */
export function normalizarPasta(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const nome = raw.replace(/\s+/g, " ").trim();
  if (!nome || nome === SEM_PASTA) return null;
  // "criadas"/"Falhas" digitado à mão cai na pasta fixa, não numa pasta nova com outra caixa; RODANDO não é destino.
  if (nome.toUpperCase() === PASTA_RODANDO) return null;
  const fixa = PASTAS_FIXAS.find((p) => p === nome.toUpperCase());
  if (fixa) return fixa;
  return [...nome].slice(0, PASTA_MAX).join("");
}

interface ContaComPasta {
  kind: string;
  pasta?: string | null;
}

/** Pastas que existem (alguma conta nelas), em ordem alfabética, com o número de contas. */
export function pastasDasContas(contas: ReadonlyArray<ContaComPasta>): Array<{ nome: string; contas: number }> {
  const conta = new Map<string, number>();
  for (const p of PASTAS_FIXAS) conta.set(p, 0);
  for (const c of contas) if (c.kind === "nova-conta" && c.pasta) conta.set(c.pasta, (conta.get(c.pasta) ?? 0) + 1);
  return [...conta.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([nome, n]) => ({ nome, contas: n }));
}

export type AbaContas = "criadas" | "estruturadas";

export interface GrupoDePasta<T> {
  /** Nome da pasta, ou SEM_PASTA. */
  chave: string;
  nome: string;
  contas: T[];
  /** Linha curta do cartão da pasta ("2 criando · 1 com falha"). */
  resumo: string[];
}

/**
 * Abas da lista de contas, cada uma com as suas pastas (cartões; Sem pasta
 * por último). Estruturadas = selo verde (prontidaoDaConta "pronta" ou
 * "conectada") ou conectada no SaaS (Contas do Instagram com token, mesmo sem
 * registro do Estruturar); Criadas = todo o resto (criando, com falha, esperando estruturar).
 */
export function gruposDePasta<T extends { id: string; kind: string; status: string; label?: string | null; pasta?: string | null; pausa?: string | null }>(
  contas: ReadonlyArray<T>,
  estruturaDe: (contaId: string) => EstruturaDaConta | null | undefined,
  noSaas: ReadonlySet<string> = new Set()
): Record<AbaContas, Array<GrupoDePasta<T>>> {
  const conectadaNoSaas = (c: T) => noSaas.has(String(c.label ?? "").replace(/^@/, "").toLowerCase());
  const abas: Record<AbaContas, Map<string, T[]>> = { criadas: new Map(), estruturadas: new Map() };
  for (const c of contas) {
    if (c.kind !== "nova-conta") continue;
    const aba: AbaContas = prontidaoDaConta(estruturaDe(c.id)) || conectadaNoSaas(c) ? "estruturadas" : "criadas";
    // Na fila ou sendo criada: fica na RODANDO até terminar (aí o sync põe em CRIADAS ou FALHAS).
    const chave = aba === "criadas" && emAndamento(c.status) ? PASTA_RODANDO : c.pasta || SEM_PASTA;
    abas[aba].set(chave, [...(abas[aba].get(chave) ?? []), c]);
  }
  // Na aba Criadas as pastas fixas aparecem sempre, primeiro (RODANDO, CRIADAS, FALHAS), mesmo vazias.
  for (const p of ORDEM_FIXAS) if (!abas.criadas.has(p)) abas.criadas.set(p, []);
  const ordem = (a: string) => (ORDEM_FIXAS.includes(a) ? ORDEM_FIXAS.indexOf(a) : a === SEM_PASTA ? 99 : ORDEM_FIXAS.length);
  const ordenar = (m: Map<string, T[]>, aba: AbaContas): Array<GrupoDePasta<T>> =>
    [...m.entries()]
      .sort(([a], [b]) => ordem(a) - ordem(b) || a.localeCompare(b, "pt-BR"))
      .map(([chave, lista]) => ({ chave, nome: chave === SEM_PASTA ? "Sem pasta" : chave, contas: lista, resumo: resumoDaPasta(lista, aba, estruturaDe, conectadaNoSaas) }));
  return { criadas: ordenar(abas.criadas, "criadas"), estruturadas: ordenar(abas.estruturadas, "estruturadas") };
}

function resumoDaPasta<T extends { id: string; status: string; pausa?: string | null }>(
  contas: ReadonlyArray<T>,
  aba: AbaContas,
  estruturaDe: (contaId: string) => EstruturaDaConta | null | undefined,
  conectadaNoSaas: (c: T) => boolean = () => false
): string[] {
  if (aba === "estruturadas") {
    // Conectada no SaaS = pronta para postar (é o que a postagem precisa); "só conectada" = conectou mas não está em Contas do Instagram.
    const prontas = contas.filter((c) => conectadaNoSaas(c) || prontidaoDaConta(estruturaDe(c.id)) === "pronta").length;
    const conectadas = contas.length - prontas;
    return [prontas ? `${prontas} pronta${prontas === 1 ? "" : "s"} para postar` : "", conectadas ? `${conectadas} só conectada${conectadas === 1 ? "" : "s"}` : ""].filter(Boolean);
  }
  let criando = 0;
  let falha = 0;
  let paraEstruturar = 0;
  let estruturando = 0;
  for (const c of contas) {
    const e = estruturaDe(c.id);
    if (c.status === "queued" || c.status === "running") criando += 1;
    else if (c.status === "error") falha += 1;
    else if (e && (e.status === "queued" || e.status === "running")) estruturando += 1;
    else if (e && e.status === "error") falha += 1;
    else paraEstruturar += 1;
  }
  return [
    criando ? `${criando} criando` : "",
    estruturando ? `${estruturando} estruturando` : "",
    paraEstruturar ? `${paraEstruturar} para estruturar` : "",
    falha ? `${falha} com falha` : "",
  ].filter(Boolean);
}

/** Linha de resumo da aba quando não há rodada de criação: totais das contas (não as estruturações). */
export function resumoDasContas<T extends { id: string; kind: string; status: string; label?: string | null; contaId?: string | null } & Partial<EstruturaDaConta>>(
  jobs: ReadonlyArray<T>,
  noSaas: ReadonlySet<string> = new Set()
): { total: number; criadas: number; prontas: number; criando: number; falhas: number } {
  const estrutura = new Map<string, T>();
  for (const j of jobs) if (j.kind === "estruturacao" && j.contaId && !estrutura.has(j.contaId)) estrutura.set(j.contaId, j);
  const r = { total: 0, criadas: 0, prontas: 0, criando: 0, falhas: 0 };
  for (const c of jobs) {
    if (c.kind !== "nova-conta") continue;
    r.total += 1;
    if (c.status === "done") r.criadas += 1;
    else if (c.status === "error") r.falhas += 1;
    else r.criando += 1;
    const e = estrutura.get(c.id);
    const conectada = noSaas.has(String(c.label ?? "").replace(/^@/, "").toLowerCase());
    if (conectada || (e && prontidaoDaConta({ status: e.status, plano: e.plano ?? [], steps: e.steps ?? [] }))) r.prontas += 1;
  }
  return r;
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
