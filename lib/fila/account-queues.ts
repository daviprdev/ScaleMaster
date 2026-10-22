/**
 * Contas que já estão numa fila — o verde dos seletores de contas do Postar e
 * do Loop, e a guarda das filas que puxam conta sozinhas pela pasta
 * (docs/fila-pausa.md). Regra pura; a leitura do banco fica em lib/fila/load
 * (loadAccountQueues).
 *
 * Matriculada (`enrolled`) = a conta já posta por essa fila:
 *  - Postar: tem post pendente/publicando na campanha; ou a campanha está
 *    sincronizada com a pasta de contas dela, a conta está ativa e sem erro, já
 *    postou nela e ainda não chegou ao teto de vídeos (entre um post e outro a
 *    sincronizada não tem nada pendente);
 *  - Loop: conta escolhida (contas específicas), ou, em modo pasta, conta ativa
 *    e sem erro da pasta que postou por ele nos últimos 2 dias.
 *
 * A caminho (`enrolled: false`) = a fila ainda não postou na conta, mas vai
 * puxá-la pela pasta (conta ativa e sem erro na pasta sincronizada/do Loop, e
 * abaixo do teto). Só vale se a conta não está matriculada em OUTRA fila: os
 * crons não puxam conta que já posta por outra fila (isBusyElsewhere).
 */

export interface AccountQueueRef {
  source: "postar" | "loop";
  id: string;
  /** "Postar · pasta VITORIAOFZ" / "Loop · Meu Loop", com "(pausada)" quando parada. */
  label: string;
  /** true = já posta por essa fila; false = ainda não, a fila vai puxá-la pela pasta. */
  enrolled: boolean;
}

export interface AccountQueuesResponse {
  /** account_id → filas em que a conta está (conta fora de fila não aparece). */
  accounts: Record<string, AccountQueueRef[]>;
}

export interface QueueAccount {
  id: string;
  folderId: string | null;
  isActive: boolean | null;
  healthStatus: string | null;
}

export interface QueueCampaign {
  id: string;
  label: string;
  /** Pastas de contas sincronizadas (vazio = campanha comum). */
  accountFolderIds: string[];
  burstMode: boolean;
  /** Teto de vídeos por conta, o mesmo do sync-distribute-accounts; null = desconhecido (sem teto). */
  maxVideos: number | null;
  /** account_id → posts da conta na campanha: total e em voo (pendente/publicando). */
  states: Map<string, { total: number; inflight: number }>;
}

export interface QueueLoop {
  id: string;
  label: string;
  /** Modo pasta: as contas da pasta entram sozinhas. */
  accountFolderId: string | null;
  /** Modo contas específicas (loop_accounts). */
  accountIds: string[];
  /** Modo pasta: contas que postaram por esse Loop nos últimos 2 dias. */
  recentAccountIds: ReadonlySet<string>;
}

/** Conta que os crons de fila consideram: ativa e sem erro. */
function isLive(a: QueueAccount): boolean {
  return a.isActive === true && a.healthStatus !== "error";
}

export function buildAccountQueues(
  accounts: QueueAccount[],
  campaigns: QueueCampaign[],
  loops: QueueLoop[],
): Record<string, AccountQueueRef[]> {
  const out: Record<string, AccountQueueRef[]> = {};
  const add = (accountId: string, ref: AccountQueueRef) => {
    (out[accountId] ??= []).push(ref);
  };
  // Puxadas pela pasta: só entram depois, se a conta não posta por outra fila.
  const onTheWay: { accountId: string; ref: AccountQueueRef }[] = [];
  const owned = new Set(accounts.map((a) => a.id));

  for (const c of campaigns) {
    const folders = c.burstMode ? new Set<string>() : new Set(c.accountFolderIds);
    for (const a of accounts) {
      const s = c.states.get(a.id) ?? { total: 0, inflight: 0 };
      const byFolder = !!a.folderId && folders.has(a.folderId) && isLive(a) && (c.maxVideos == null || s.total < c.maxVideos);
      if (s.inflight > 0 || (byFolder && s.total > 0)) {
        add(a.id, { source: "postar", id: c.id, label: c.label, enrolled: true });
      } else if (byFolder) {
        onTheWay.push({ accountId: a.id, ref: { source: "postar", id: c.id, label: c.label, enrolled: false } });
      }
    }
  }

  for (const l of loops) {
    if (!l.accountFolderId) {
      for (const id of new Set(l.accountIds)) {
        if (owned.has(id)) add(id, { source: "loop", id: l.id, label: l.label, enrolled: true });
      }
      continue;
    }
    for (const a of accounts) {
      if (a.folderId !== l.accountFolderId || !isLive(a)) continue;
      const enrolled = l.recentAccountIds.has(a.id);
      const ref: AccountQueueRef = { source: "loop", id: l.id, label: l.label, enrolled };
      if (enrolled) add(a.id, ref);
      else onTheWay.push({ accountId: a.id, ref });
    }
  }

  for (const { accountId, ref } of onTheWay) {
    if (!isBusyElsewhere(out[accountId], ref)) add(accountId, ref);
  }
  return out;
}

/** A conta já posta por uma fila diferente de `self`? (guarda das filas por pasta) */
export function isBusyElsewhere(
  refs: AccountQueueRef[] | undefined,
  self: Pick<AccountQueueRef, "source" | "id">,
): boolean {
  return !!refs?.some((r) => r.enrolled && !(r.source === self.source && r.id === self.id));
}
