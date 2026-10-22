"use client";

import * as React from "react";
import Link from "next/link";
import { ListX, RefreshCw, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Banner, Button, Dialog, EmptyState, PageHeader, Segmented, Select, Skeleton } from "@/components/ui";
import { fmtInt } from "@/components/dashboard/queue-insights/format";
import { FilaVideoRow, captionLine } from "@/components/dashboard/fila/FilaVideoRow";
import {
  FILA_SORTS,
  filterFilaVideos,
  isFilaSort,
  sortFilaVideos,
  type FilaFilter,
  type FilaSort,
} from "@/lib/fila/stats";
import type { FilaFolderResponse, FilaListResponse, FilaQueue, FilaVideo } from "@/lib/fila/types";

// Preferências de quem olha (localStorage pode não existir: janela anônima, bloqueio).
const FOLDER_KEY = "fila:pasta";
const SORT_KEY = "fila:ordem";

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: a tela só não lembra da escolha */
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** "Postar · 55 contas · desde 20/10" / "Loop · Meu Loop · 12 contas" — a pasta já está no seletor. */
function queueLabel(q: FilaQueue): string {
  const contas = q.accountCount === 1 ? "1 conta" : `${fmtInt(q.accountCount)} contas`;
  if (q.source === "loop") return `${q.label} · ${contas}`;
  const d = new Date(q.createdAt);
  const desde = Number.isNaN(d.getTime())
    ? ""
    : ` · desde ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
  return `Postar · ${contas}${desde}`;
}

/** Atualiza a pausa de um vídeo e o contador do resumo. */
function withPaused(data: FilaFolderResponse, id: string, pausedAt: string | null): FilaFolderResponse {
  const videos = data.videos.map((v) => (v.id === id ? { ...v, pausedAt } : v));
  return { ...data, videos, summary: { ...data.summary, paused: videos.filter((v) => v.pausedAt).length } };
}

/**
 * Aba Fila: escolhe uma pasta com fila rodando e vê cada vídeo dela com os
 * posts, a média por post e as views nas filas da pasta. O liga/desliga tira o
 * vídeo da fila (Postar e Loop) até ser reativado. Regras em docs/fila-pausa.md.
 */
export default function FilaPage() {
  const [list, setList] = React.useState<FilaListResponse | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<FilaFolderResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<FilaSort>("views_asc");
  const [filter, setFilter] = React.useState<FilaFilter>("all");
  const [saving, setSaving] = React.useState<ReadonlySet<string>>(new Set());
  const [toggleError, setToggleError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<FilaVideo | null>(null);
  // Só a resposta do último pedido entra na tela (troca rápida de pasta).
  const requestRef = React.useRef(0);

  const loadList = React.useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch("/api/fila", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível carregar as filas. Tente de novo."));
      const next = (await res.json()) as FilaListResponse;
      setList(next);
      setFolderId((current) => {
        const ids = new Set(next.folders.map((f) => f.id));
        if (current && ids.has(current)) return current;
        const saved = readPref(FOLDER_KEY);
        return saved && ids.has(saved) ? saved : next.defaultFolderId;
      });
    } catch (e) {
      setListError((e as Error).message);
    }
  }, []);

  const loadFolder = React.useCallback(async (id: string) => {
    const req = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fila/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível ler os vídeos dessa pasta. Tente de novo."));
      const next = (await res.json()) as FilaFolderResponse;
      if (req === requestRef.current) setData(next);
    } catch (e) {
      if (req === requestRef.current) setError((e as Error).message);
    } finally {
      if (req === requestRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const saved = readPref(SORT_KEY);
    if (isFilaSort(saved)) setSort(saved);
    void loadList();
  }, [loadList]);

  React.useEffect(() => {
    if (!folderId) return;
    setData((d) => (d?.folder.id === folderId ? d : null));
    setFilter("all");
    void loadFolder(folderId);
  }, [folderId, loadFolder]);

  const selectFolder = (id: string) => {
    writePref(FOLDER_KEY, id);
    setFolderId(id);
  };

  const changeSort = (value: string) => {
    if (!isFilaSort(value)) return;
    writePref(SORT_KEY, value);
    setSort(value);
  };

  const refresh = () => {
    void loadList();
    if (folderId) void loadFolder(folderId);
  };

  const toggle = async (video: FilaVideo) => {
    if (!data || saving.has(video.id)) return;
    const pause = !video.pausedAt;
    setToggleError(null);
    setSaving((s) => new Set(s).add(video.id));
    setData((d) => (d ? withPaused(d, video.id, pause ? new Date().toISOString() : null) : d));
    try {
      const res = await fetch("/api/fila/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [video.id], paused: pause }),
      });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível salvar. Tente de novo."));
      const body = (await res.json()) as { pausedAt: string | null };
      setData((d) => (d ? withPaused(d, video.id, body.pausedAt) : d));
    } catch (e) {
      setData((d) => (d ? withPaused(d, video.id, video.pausedAt) : d));
      setToggleError((e as Error).message);
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(video.id);
        return next;
      });
    }
  };

  const folder = list?.folders.find((f) => f.id === folderId) ?? null;
  const visible = React.useMemo(
    () => (data ? sortFilaVideos(filterFilaVideos(data.videos, filter), sort) : []),
    [data, filter, sort]
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Publicação"
        title="Fila"
        description="Veja como cada vídeo da pasta está indo na fila e pause o que estiver abaixo da média."
        actions={
          list && list.folders.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} className={cn(loading && "animate-spin")} />}
              onClick={refresh}
              disabled={loading}
            >
              Atualizar
            </Button>
          ) : undefined
        }
      />

      {listError ? (
        <Banner
          tone="danger"
          action={
            <Button variant="secondary" size="sm" onClick={() => void loadList()}>
              Tentar de novo
            </Button>
          }
        >
          {listError}
        </Banner>
      ) : !list ? (
        <PageSkeleton />
      ) : list.folders.length === 0 ? (
        <EmptyState
          icon={<ListX size={18} />}
          title="Nenhuma fila rodando"
          description="Quando uma campanha do Postar ou um Loop estiver rodando numa pasta, os vídeos dela aparecem aqui para você pausar os que não estão indo bem."
          action={
            <Button asChild size="sm">
              <Link href="/dashboard/postar">Ir para o Postar</Link>
            </Button>
          }
        />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="max-w-md">
              <Select
                label="Pasta da Biblioteca"
                value={folderId ?? ""}
                onChange={(e) => selectFolder(e.target.value)}
                options={list.folders.map((f) => ({
                  value: f.id,
                  label: `${f.name} · ${f.videoCount === 1 ? "1 vídeo" : `${fmtInt(f.videoCount)} vídeos`}`,
                }))}
              />
            </div>
            {folder && folder.queues.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span>Rodando nesta pasta:</span>
                {folder.queues.map((q) => (
                  <span
                    key={`${q.source}:${q.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-ink-2"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                    {queueLabel(q)}
                  </span>
                ))}
              </div>
            )}
          </section>

          {error && !loading ? (
            <Banner
              tone="danger"
              action={
                <Button variant="secondary" size="sm" onClick={() => folderId && void loadFolder(folderId)}>
                  Tentar de novo
                </Button>
              }
            >
              {error}
            </Banner>
          ) : !data ? (
            <ListSkeleton />
          ) : (
            <FolderContent
              data={data}
              visible={visible}
              sort={sort}
              filter={filter}
              saving={saving}
              toggleError={toggleError}
              onDismissToggleError={() => setToggleError(null)}
              onSort={changeSort}
              onFilter={setFilter}
              onToggle={toggle}
              onPreview={setPreview}
            />
          )}
        </>
      )}

      <Dialog
        open={!!preview}
        onClose={() => setPreview(null)}
        title="Vídeo"
        description={preview ? (captionLine(preview.caption) ?? "Sem legenda") : undefined}
        className="max-w-sm"
      >
        {preview?.publicUrl ? (
          <video
            key={preview.id}
            src={preview.publicUrl}
            controls
            autoPlay
            playsInline
            className="mx-auto max-h-[70vh] w-full rounded-lg bg-black"
          />
        ) : (
          <p className="text-sm text-ink-3">Esse vídeo não tem arquivo para mostrar.</p>
        )}
      </Dialog>
    </div>
  );
}

function FolderContent({
  data,
  visible,
  sort,
  filter,
  saving,
  toggleError,
  onDismissToggleError,
  onSort,
  onFilter,
  onToggle,
  onPreview,
}: {
  data: FilaFolderResponse;
  visible: FilaVideo[];
  sort: FilaSort;
  filter: FilaFilter;
  saving: ReadonlySet<string>;
  toggleError: string | null;
  onDismissToggleError: () => void;
  onSort: (value: string) => void;
  onFilter: (value: FilaFilter) => void;
  onToggle: (video: FilaVideo) => void;
  onPreview: (video: FilaVideo) => void;
}) {
  const { summary } = data;
  const active = summary.videos - summary.paused;

  if (summary.videos === 0) {
    return (
      <EmptyState
        icon={<VideoOff size={18} />}
        title="Essa pasta não tem vídeos"
        description="Adicione vídeos pela Biblioteca ou pelas Inspirações."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!data.pauseAvailable && (
        <Banner tone="warning">
          Os números já aparecem, mas para pausar vídeos falta aplicar o SQL{" "}
          <span className="font-mono">supabase/fila_pausa_videos.sql</span> no Supabase.
        </Banner>
      )}
      {toggleError && (
        <Banner tone="danger" onClose={onDismissToggleError}>
          {toggleError}
        </Banner>
      )}
      {active === 0 && (
        <Banner tone="warning">
          Todos os vídeos desta pasta estão pausados — as filas dela param de postar até você reativar algum.
        </Banner>
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        {[
          { label: "publicações da fila", value: fmtInt(summary.posts) },
          { label: "visualizações", value: fmtInt(summary.views) },
          { label: "média por post da fila", value: fmtInt(summary.avgViews) },
          { label: "vídeos pausados", value: `${fmtInt(summary.paused)} de ${fmtInt(summary.videos)}` },
        ].map((it) => (
          <div key={it.label} className="flex min-w-0 flex-col-reverse gap-1 bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
            <dt className="text-xs leading-4 text-ink-3">{it.label}</dt>
            <dd className="font-mono text-xl font-medium leading-7 tracking-[-0.02em] tabular-nums text-ink sm:text-[24px] sm:leading-8">
              {it.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          aria-label="Mostrar"
          value={filter}
          onChange={(v) => onFilter(v as FilaFilter)}
          options={[
            { value: "all", label: `Todos (${fmtInt(summary.videos)})` },
            { value: "active", label: `Ativos (${fmtInt(active)})` },
            { value: "paused", label: `Pausados (${fmtInt(summary.paused)})` },
          ]}
        />
        <div className="sm:w-56">
          <Select aria-label="Ordem" value={sort} onChange={(e) => onSort(e.target.value)} options={FILA_SORTS} />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">
          {filter === "paused" ? "Nenhum vídeo pausado." : "Nenhum vídeo ativo."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((v) => (
            <FilaVideoRow
              key={v.id}
              video={v}
              queueAvg={summary.avgViews}
              busy={saving.has(v.id)}
              disabled={!data.pauseAvailable}
              onToggle={onToggle}
              onPreview={onPreview}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Carregando as filas">
      <Skeleton width="min(100%, 28rem)" height="36px" />
      <ListSkeleton />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando os vídeos">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
            <Skeleton height="28px" width="70%" />
            <Skeleton height="12px" width="55%" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
            <Skeleton width="48px" height="85px" radius="8px" className="shrink-0" />
            <Skeleton height="16px" width="40%" />
          </div>
        ))}
      </div>
    </div>
  );
}
