"use client";

import * as React from "react";
import Link from "next/link";
import { ListX, VideoOff } from "lucide-react";
import { Banner, Button, Dialog, EmptyState, PageHeader, Select, Skeleton } from "@/components/ui";
import { fmtInt } from "@/components/dashboard/queue-insights/format";
import { FilaVideoRow, captionLine } from "@/components/dashboard/fila/FilaVideoRow";
import { sortFilaVideos } from "@/lib/fila/stats";
import type { FilaFolderResponse, FilaListResponse, FilaVideo } from "@/lib/fila/types";

// A tela lembra a última pasta (localStorage pode não existir: janela anônima, bloqueio).
const FOLDER_KEY = "fila:pasta";

function readSavedFolder(): string | null {
  try {
    return window.localStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
}

function saveFolder(id: string) {
  try {
    window.localStorage.setItem(FOLDER_KEY, id);
  } catch {
    /* sem armazenamento: a tela só não lembra da escolha */
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Atualiza a pausa de um vídeo e o contador do resumo. */
function withPaused(data: FilaFolderResponse, id: string, pausedAt: string | null): FilaFolderResponse {
  const videos = data.videos.map((v) => (v.id === id ? { ...v, pausedAt } : v));
  return { ...data, videos, summary: { ...data.summary, paused: videos.filter((v) => v.pausedAt).length } };
}

/**
 * Aba Fila, no desenho do print de referência: escolhe uma pasta com fila
 * rodando e vê cada vídeo dela com posts, média por post e views nas filas da
 * pasta. O liga/desliga tira o vídeo da fila (Postar e Loop) até ser
 * reativado. Regras em docs/fila-pausa.md.
 */
export default function FilaPage() {
  const [list, setList] = React.useState<FilaListResponse | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<FilaFolderResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
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
      const ids = new Set(next.folders.map((f) => f.id));
      const saved = readSavedFolder();
      setFolderId(saved && ids.has(saved) ? saved : next.defaultFolderId);
    } catch (e) {
      setListError((e as Error).message);
    }
  }, []);

  const loadFolder = React.useCallback(async (id: string) => {
    const req = ++requestRef.current;
    setError(null);
    try {
      const res = await fetch(`/api/fila/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível ler os vídeos dessa pasta. Tente de novo."));
      const next = (await res.json()) as FilaFolderResponse;
      if (req === requestRef.current) setData(next);
    } catch (e) {
      if (req === requestRef.current) setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  React.useEffect(() => {
    if (!folderId) return;
    setData(null);
    void loadFolder(folderId);
  }, [folderId, loadFolder]);

  const selectFolder = (id: string) => {
    saveFolder(id);
    setFolderId(id);
  };

  const toggle = async (video: FilaVideo) => {
    if (saving.has(video.id)) return;
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

  const videos = React.useMemo(() => (data ? sortFilaVideos(data.videos) : []), [data]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Publicação"
        title="Fila"
        description="Os vídeos da pasta, um por um. Vídeo pausado não sai mais na fila até você ativar de novo."
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
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando as filas">
          <Skeleton width="min(100%, 28rem)" height="36px" />
          <ListSkeleton />
        </div>
      ) : list.folders.length === 0 ? (
        <EmptyState
          icon={<ListX size={18} />}
          title="Nenhuma fila rodando"
          description="Quando uma campanha do Postar ou um Loop estiver rodando numa pasta, os vídeos dela aparecem aqui."
          action={
            <Button asChild size="sm">
              <Link href="/dashboard/postar">Ir para o Postar</Link>
            </Button>
          }
        />
      ) : (
        <>
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

          {error ? (
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
          ) : videos.length === 0 ? (
            <EmptyState
              icon={<VideoOff size={18} />}
              title="Essa pasta não tem vídeos"
              description="Adicione vídeos pela Biblioteca ou pelas Inspirações."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {!data.pauseAvailable && (
                <Banner tone="warning">
                  Para pausar vídeos falta aplicar o SQL{" "}
                  <span className="font-mono">supabase/fila_pausa_videos.sql</span> no Supabase.
                </Banner>
              )}
              {toggleError && (
                <Banner tone="danger" onClose={() => setToggleError(null)}>
                  {toggleError}
                </Banner>
              )}
              <ul className="flex flex-col gap-2">
                {videos.map((v) => (
                  <FilaVideoRow
                    key={v.id}
                    video={v}
                    busy={saving.has(v.id)}
                    disabled={!data.pauseAvailable}
                    onToggle={toggle}
                    onPreview={setPreview}
                  />
                ))}
              </ul>
            </div>
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

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Carregando os vídeos">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
          <Skeleton width="48px" height="85px" radius="8px" className="shrink-0" />
          <Skeleton height="16px" width="40%" />
        </div>
      ))}
    </div>
  );
}
