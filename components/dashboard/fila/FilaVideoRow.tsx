"use client";

import * as React from "react";
import { Eye, Play, Repeat2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton, Switch } from "@/components/ui";
import { LazyThumb } from "@/components/dashboard/queue-insights/LazyThumb";
import { fmtInt } from "@/components/dashboard/queue-insights/format";
import type { FilaVideo } from "@/lib/fila/types";

/** Primeira linha da legenda, para reconhecer o vídeo; sem legenda, null. */
export function captionLine(caption: string | null): string | null {
  const line = caption?.split("\n").map((l) => l.trim()).find(Boolean);
  return line || null;
}

/**
 * Um vídeo da fila numa linha, no desenho do print de referência: capa,
 * posts, média por post e views nas filas da pasta (valor com ícone em cima,
 * rótulo em caixa alta embaixo), o liga/desliga da fila e o play.
 */
export function FilaVideoRow({
  video,
  busy,
  disabled,
  onToggle,
  onPreview,
}: {
  video: FilaVideo;
  /** Salvando o liga/desliga deste vídeo. */
  busy: boolean;
  /** Pausa indisponível (SQL pendente). */
  disabled: boolean;
  onToggle: (video: FilaVideo) => void;
  onPreview: (video: FilaVideo) => void;
}) {
  const paused = !!video.pausedAt;
  const caption = captionLine(video.caption);
  const name = caption ?? "vídeo sem legenda";

  return (
    <li className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-xl border border-line bg-surface px-3 py-3 sm:gap-x-4 sm:px-4 md:grid-cols-[48px_minmax(0,1fr)_auto_auto]">
      <button
        type="button"
        onClick={() => onPreview(video)}
        aria-label={`Ver o vídeo: ${name}`}
        className="w-12 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <LazyThumb src={video.publicUrl} label={name} className={cn(paused && "opacity-40")} />
      </button>

      <p className={cn("min-w-0 truncate text-sm leading-5", caption && !paused ? "text-ink" : "text-ink-3")}>
        {caption ?? "Sem legenda"}
      </p>

      {/* Números: linha de baixo no celular, coluna própria a partir do md. */}
      <dl
        className={cn(
          "col-span-3 grid grid-cols-3 gap-2 md:col-span-1 md:col-start-3 md:row-start-1 md:flex md:gap-6 lg:gap-8",
          paused && "opacity-60"
        )}
      >
        <Stat icon={<Repeat2 size={14} strokeWidth={2} />} label="Posts" value={fmtInt(video.posts)} />
        <Stat
          icon={<TrendingUp size={14} strokeWidth={2} />}
          label="Média/post"
          value={video.avgViews == null ? "—" : fmtInt(video.avgViews)}
        />
        <Stat icon={<Eye size={14} strokeWidth={2} />} label="Views" value={fmtInt(video.views)} />
      </dl>

      <div className="col-start-3 row-start-1 flex items-center justify-end gap-2 md:col-start-4">
        <div className="min-w-[96px]">
          <Switch
            checked={!paused}
            disabled={busy || disabled}
            onChange={() => onToggle(video)}
            label={paused ? "Pausado" : "Ativo"}
            aria-label={`Na fila: ${name}`}
          />
        </div>
        <IconButton
          icon={<Play size={16} strokeWidth={2} />}
          aria-label={`Ver o vídeo: ${name}`}
          onClick={() => onPreview(video)}
          className="border-line"
        />
      </div>
    </li>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  // dt antes do dd no DOM; flex-col-reverse põe o número em cima.
  return (
    <div className="flex min-w-0 flex-col-reverse items-start gap-0.5 rounded-lg bg-surface-hover/50 px-2.5 py-2 md:min-w-[88px] md:items-end md:bg-transparent md:p-0">
      <dt className="text-[10px] font-medium uppercase leading-3 tracking-[0.08em] text-ink-3">{label}</dt>
      <dd className="flex items-center gap-1.5 font-mono text-base font-semibold leading-6 tabular-nums tracking-[-0.01em] text-ink md:text-lg">
        <span className="text-ink-3" aria-hidden="true">
          {icon}
        </span>
        {value}
      </dd>
    </div>
  );
}
