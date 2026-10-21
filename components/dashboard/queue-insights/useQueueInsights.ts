"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueInsightsResponse, QueueListResponse, QueueSource } from "@/lib/queue-insights/types";

/** Cada fila analisada fica 5 min em memória — reabrir o painel não refaz a conta. */
const CACHE_TTL_MS = 5 * 60_000;
const STORAGE_KEY = "queue-insights:queue";

const insightsCache = new Map<string, { at: number; data: QueueInsightsResponse }>();

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
  list: QueueListResponse | null;
  listLoading: boolean;
  listError: string | null;
  selectedKey: string | null;
  data: QueueInsightsResponse | null;
  dataLoading: boolean;
  dataError: string | null;
  select: (key: string) => void;
  refresh: () => void;
  retry: () => void;
}

/**
 * Lista de filas + Raio-X da fila escolhida. Busca a lista toda vez que o painel
 * abre; o Raio-X vem do cache de 5 min quando dá. "Atualizar" ignora o cache.
 */
export function useQueueInsights(open: boolean): QueueInsightsState {
  const [list, setList] = useState<QueueListResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [data, setData] = useState<QueueInsightsResponse | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const selectedRef = useRef<string | null>(null);
  const insightsAbort = useRef<AbortController | null>(null);
  const listAbort = useRef<AbortController | null>(null);

  const loadInsights = useCallback(async (key: string, force: boolean) => {
    const target = parseKey(key);
    if (!target) return;

    const cached = insightsCache.get(key);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      insightsAbort.current?.abort();
      setData(cached.data);
      setDataKey(key);
      setDataError(null);
      setDataLoading(false);
      return;
    }

    insightsAbort.current?.abort();
    const ctrl = new AbortController();
    insightsAbort.current = ctrl;
    setDataLoading(true);
    setDataError(null);
    try {
      const res = await fetch(`/api/queue-insights/${target.source}/${encodeURIComponent(target.id)}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Não foi possível analisar essa fila"));
      const json = (await res.json()) as QueueInsightsResponse;
      insightsCache.set(key, { at: Date.now(), data: json });
      if (selectedRef.current !== key) return;
      setData(json);
      setDataKey(key);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (selectedRef.current !== key) return;
      setDataError(err instanceof Error ? err.message : "Não foi possível analisar essa fila");
    } finally {
      if (insightsAbort.current === ctrl) {
        insightsAbort.current = null;
        setDataLoading(false);
      }
    }
  }, []);

  const loadList = useCallback(async () => {
    listAbort.current?.abort();
    const ctrl = new AbortController();
    listAbort.current = ctrl;
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/queue-insights", { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error(await errorMessage(res, "Não foi possível carregar as filas"));
      const json = (await res.json()) as QueueListResponse;
      const queues = Array.isArray(json?.queues) ? json.queues : [];
      setList({ queues, defaultQueue: json?.defaultQueue ?? null });

      // Fila escolhida: a atual, a lembrada, a sugerida pela API ou a primeira.
      const keys = new Set(queues.map(queueKey));
      const stored = readStoredKey();
      const next =
        (selectedRef.current && keys.has(selectedRef.current) && selectedRef.current) ||
        (stored && keys.has(stored) && stored) ||
        (json?.defaultQueue && keys.has(queueKey(json.defaultQueue)) && queueKey(json.defaultQueue)) ||
        (queues[0] ? queueKey(queues[0]) : null);
      selectedRef.current = next;
      setSelectedKey(next);
      return next;
    } catch (err) {
      if (ctrl.signal.aborted) return undefined;
      setListError(err instanceof Error ? err.message : "Não foi possível carregar as filas");
      return undefined;
    } finally {
      if (listAbort.current === ctrl) {
        listAbort.current = null;
        setListLoading(false);
      }
    }
  }, []);

  // Abriu o painel: lista nova; o Raio-X da fila escolhida vem do cache se ainda vale.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadList().then((key) => {
      if (!cancelled && key) loadInsights(key, false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loadList, loadInsights]);

  // Fechou: cancela o que estiver em voo (o cache continua).
  useEffect(() => {
    if (open) return;
    listAbort.current?.abort();
    insightsAbort.current?.abort();
  }, [open]);

  const select = useCallback(
    (key: string) => {
      if (!parseKey(key)) return;
      selectedRef.current = key;
      setSelectedKey(key);
      writeStoredKey(key);
      loadInsights(key, false);
    },
    [loadInsights]
  );

  const refresh = useCallback(() => {
    loadList().then((key) => {
      // Lista falhou: ainda atualiza a fila que já está na tela.
      const target = key ?? selectedRef.current;
      if (target) loadInsights(target, true);
    });
  }, [loadList, loadInsights]);

  const retry = useCallback(() => {
    if (!list) {
      refresh();
      return;
    }
    if (selectedRef.current) loadInsights(selectedRef.current, true);
  }, [list, refresh, loadInsights]);

  return {
    list,
    listLoading,
    listError,
    selectedKey,
    data: data && dataKey === selectedKey ? data : null,
    dataLoading,
    dataError,
    select,
    refresh,
    retry,
  };
}
