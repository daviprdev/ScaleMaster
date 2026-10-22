/**
 * Contas que já estão numa fila — o verde dos seletores de contas do Postar e
 * do Loop (docs/fila-pausa.md). Regra pura; a leitura do banco fica em
 * lib/fila/load (loadAccountQueues).
 *
 * Em fila = a conta vai postar por uma fila do Postar ou Loop ativa ou pausada:
 *  - Postar: tem post pendente/publicando na campanha; ou a campanha está
 *    sincronizada com a pasta de contas dela, a conta está ativa e sem erro e
 *    ainda não chegou ao teto de vídeos — o sync-distribute-accounts matricula
 *    essa conta sozinho (mesmo filtro do cron), mesmo antes do 1º post.
 *  - Loop: as contas ativas e sem erro da pasta de contas dele (mesmo filtro do
 *    process-loops), ou as contas escolhidas.
 */

export interface AccountQueueRef {
  source: "postar" | "loop";
  id: string;
  /** "Postar · pasta VITORIAOFZ" / "Loop · Meu Loop", com "(pausada)" quando parada. */
  label: string;
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
  const owned = new Set(accounts.map((a) => a.id));

  for (const c of campaigns) {
    const ref: AccountQueueRef = { source: "postar", id: c.id, label: c.label };
    const folders = c.burstMode ? new Set<string>() : new Set(c.accountFolderIds);
    for (const a of accounts) {
      const s = c.states.get(a.id) ?? { total: 0, inflight: 0 };
      const viaFolder =
        !!a.folderId && folders.has(a.folderId) && isLive(a) && (c.maxVideos == null || s.total < c.maxVideos);
      if (s.inflight > 0 || viaFolder) add(a.id, ref);
    }
  }

  for (const l of loops) {
    const ref: AccountQueueRef = { source: "loop", id: l.id, label: l.label };
    const ids = l.accountFolderId
      ? accounts.filter((a) => a.folderId === l.accountFolderId && isLive(a)).map((a) => a.id)
      : Array.from(new Set(l.accountIds)).filter((id) => owned.has(id));
    for (const id of ids) add(id, ref);
  }

  return out;
}
