"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueInsightsResponse, QueueListItem, QueueListResponse, QueueSource } from "@/lib/queue-insights/types";

const STORAGE_KEY = "queue-insights:queue";

export function queueKey(q: { source: QueueSource; id: string }): string {
  return `${q.source}:${q.id}`;
}

function parseKey(key: string): { source: QueueSource; id: string } | null {
  const i = key.indexOf(":");
  if (i < 0) return null;
  const source = key.slice(0, i);
  const id = key.slice(i + 1);
  if ((source !== "postar" && source !== "loop") || !id) return null;
  return { source, id };
}

/**
 * Fila em que o painel abre: a escolhida pelo dono (se ainda está rodando), a
 * sugerida pela API (mais posts nas últimas 24h) ou a primeira da lista.
 */
export function pickQueueKey(
  queues: Pick<QueueListItem, "source" | "id">[],
  chosen: string | null,
  defaultQueue: QueueListResponse["defaultQueue"]
): string | null {
  const keys = new Set(queues.map(queueKey));
  if (chosen && keys.has(chosen)) return chosen;
  if (defaultQueue && keys.has(queueKey(defaultQueue))) return queueKey(defaultQueue);
  return queues[0] ? queueKey(queues[0]) : null;
}

function readStoredKey(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredKey(key: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* janela anônima / storage bloqueado — só não lembra a escolha */
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    /* corpo não é JSON */
  }
  return `${fallback} (HTTP ${res.status})`;
}

export interface QueueInsightsState {
  /** Filas rodando; null até a primeira resposta. */
  queues: QueueListItem[] | null;
  selectedKey: string | null;
  /** Raio-X da fila escolhida, sempre da abertura atual do painel. */
  data: QueueInsightsResponse | null;
  loading: boolean;
  error: string | null;
  select: (key: string) => void;
  retry: () => void;
}

/**
 * Lista de filas + Raio-X da fila escolhida. Busca as duas coisas TODA vez que
 * o painel abre (o rodapé da fila ideal promete os números mais recentes) — sem
 * cache. Trocar de fila no seletor busca só o Raio-X da nova.
 */
export function useQueueInsights(open: boolean): QueueInsightsState {
  const [queues, setQueues] = useState<QueueListItem[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [data, setData] = useState<QueueInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reabriu: some com os números da abertura anterior já no primeiro quadro
  // (antes do efeito que busca), para nunca montar a fila com dado velho.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setData(null);
      setError(null);
      setLoading(true);
    }
  }

  const selectedRef = useRef<string | null>(null);
  // Escolha feita no seletor nesta sessão (vale mesmo com o storage bloqueado).
  const chosenRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** withList = busca a lista antes (abertura e "Tentar de novo"); senão só o Raio-X de `key`. */
  const load = useCallback(async (withList: boolean, key?: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      let target = key ?? selectedRef.current;
      if (withList) {
        const res = await fetch("/api/queue-insights", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(await errorMessage(res, "Não foi possível carregar as filas"));
        const json = (await res.json()) as QueueListResponse;
        const list = Array.isArray(json?.queues) ? json.queues : [];
        target = pickQueueKey(list, chosenRef.current ?? readStoredKey(), json?.defaultQueue ?? null);
        setQueues(list);
        selectedRef.current = target;
        setSelectedKey(target);
      }

      const parsed = target ? parseKey(target) : null;
      if (!parsed) return;
      const res = await fetch(`/api/queue-insights/${parsed.source}/${encodeURIComponent(parsed.id)}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Não foi possível analisar essa fila"));
      const json = (await res.json()) as QueueInsightsResponse;
      if (!ctrl.signal.aborted) setData(json);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Não foi possível carregar o Raio-X");
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Abriu: lista e números novos. Fechou: cancela o que estiver em voo.
  useEffect(() => {
    if (open) {
      void load(true);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, [open, load]);

  const select = useCallback(
    (key: string) => {
      if (!parseKey(key) || key === selectedRef.current) return;
      chosenRef.current = key;
      selectedRef.current = key;
      setSelectedKey(key);
      writeStoredKey(key);
      void load(false, key);
    },
    [load]
  );

  const retry = useCallback(() => void load(true), [load]);

  return { queues, selectedKey, data, loading, error, select, retry };
}
