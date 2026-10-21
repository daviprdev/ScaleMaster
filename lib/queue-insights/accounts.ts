/**
 * Raio-X da fila — melhores contas (item 4).
 *
 * Conta boa = normal atual ≥ 30 E ≥ metade da conta típica da fila (`ref`,
 * mediana dos normais ≥ 30 das candidatas). Ordem: boas por normal desc,
 * depois fracas, sem dados e fora do ar.
 */

import type { AccountInfo, AccountScore, AccountStatus } from "./types";
import { GOOD_ACCOUNT_REF_RATIO, NORMAL_MIN_VIEWS } from "./constants";
import type { Normals } from "./normals";
import { median } from "./stats";

/** Conta que pode postar: ativa e sem erro de saúde. */
export function isAccountUsable(account: Pick<AccountInfo, "isActive" | "healthStatus">): boolean {
  return account.isActive && account.healthStatus !== "error";
}

/** Conta típica: mediana dos normais atuais ≥ 30 das candidatas; null se nenhuma chega a 30. */
export function referenceNormal(currentNormals: readonly (number | null)[]): number | null {
  return median(currentNormals.filter((v): v is number => v != null && v >= NORMAL_MIN_VIEWS));
}

export function accountStatus(usable: boolean, normal: number | null, ref: number | null): AccountStatus {
  if (!usable) return "inactive";
  if (normal == null) return "no_data";
  if (ref != null && normal >= NORMAL_MIN_VIEWS && normal >= GOOD_ACCOUNT_REF_RATIO * ref) return "good";
  return "weak";
}

const STATUS_ORDER: Record<AccountStatus, number> = { good: 0, weak: 1, no_data: 2, inactive: 3 };

export function compareAccountScores(a: AccountScore, b: AccountScore): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (b.currentNormal ?? -1) - (a.currentNormal ?? -1) ||
    b.postsInQueue - a.postsInQueue ||
    a.username.localeCompare(b.username)
  );
}

export interface RankAccountsArgs {
  /** Contas configuradas na fila (queue.accountIds). */
  accountIds: readonly string[];
  accounts: readonly AccountInfo[];
  normals: Normals;
  /** account_id → posts desta fila na janela de análise. */
  postsInQueue: ReadonlyMap<string, number>;
}

/** Todas as contas da fila em ordem de ranking. Contas que não vieram do banco ficam de fora. */
export function rankAccounts(args: RankAccountsArgs): AccountScore[] {
  const byId = new Map(args.accounts.map((a) => [a.id, a]));
  const rows = [...new Set(args.accountIds)]
    .map((id) => byId.get(id))
    .filter((a): a is AccountInfo => a != null)
    .map((account) => ({ account, usable: isAccountUsable(account), normal: args.normals.current(account.igAccountKey) }));

  const ref = referenceNormal(rows.filter((r) => r.usable).map((r) => r.normal.value));

  return rows
    .map(({ account, usable, normal }) => ({
      accountId: account.id,
      username: account.username,
      avatarUrl: account.avatarUrl,
      currentNormal: normal.value,
      normalWindowDays: normal.windowDays,
      postsInQueue: args.postsInQueue.get(account.id) ?? 0,
      status: accountStatus(usable, normal.value, ref),
    }))
    .sort(compareAccountScores);
}
