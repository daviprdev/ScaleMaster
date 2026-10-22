"use client";

import * as React from "react";
import type { AccountQueueRef, AccountQueuesResponse } from "@/lib/fila/account-queues";

/**
 * Filas em que cada conta já está — o verde dos seletores de contas do Postar
 * e do Loop (docs/fila-pausa.md). `exclude` tira a fila em edição (editando um
 * Loop, as contas dele não contam como "já em fila"). Sem resposta da rota, o
 * mapa fica vazio e os seletores ficam como antes.
 */
export function useAccountQueues(
  exclude?: { source: AccountQueueRef["source"]; id: string } | null,
): Map<string, AccountQueueRef[]> {
  const [accounts, setAccounts] = React.useState<Record<string, AccountQueueRef[]>>({});

  React.useEffect(() => {
    let alive = true;
    fetch("/api/accounts/queues", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AccountQueuesResponse>) : null))
      .then((d) => {
        if (alive && d) setAccounts(d.accounts ?? {});
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const excludeKey = exclude ? `${exclude.source}:${exclude.id}` : null;
  return React.useMemo(() => {
    const map = new Map<string, AccountQueueRef[]>();
    for (const [id, refs] of Object.entries(accounts)) {
      const kept = excludeKey ? refs.filter((r) => `${r.source}:${r.id}` !== excludeKey) : refs;
      if (kept.length) map.set(id, kept);
    }
    return map;
  }, [accounts, excludeKey]);
}

/** Título do chip: "@conta — na fila: Postar · pasta VITORIAOFZ". */
export function queueTitle(username: string, refs: AccountQueueRef[] | undefined): string {
  return refs?.length ? `@${username} — na fila: ${refs.map((r) => r.label).join(", ")}` : `@${username}`;
}
