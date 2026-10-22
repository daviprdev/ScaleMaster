"use client";

import * as React from "react";
import { Eye, Play, Repeat2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui";
import { LazyThumb } from "@/components/dashboard/queue-insights/LazyThumb";
import { fmtInt } from "@/components/dashboard/queue-insights/format";
import { isBelowAverage } from "@/lib/fila/stats";
import type { FilaVideo } from "@/lib/fila/types";

/** Primeira linha da legenda, para reconhecer o vídeo; sem legenda, null. */
export function captionLine(caption: string | null): string | null {
  const line = caption?.split("\n").map((l) => l.trim()).find(Boolean);
  return line || null;
}

function fmtPausedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${day} às ${time}`;
}

/**
 * Um vídeo da fila numa linha: capa (clique abre o vídeo), posts, média por
 * post e views nas filas da pasta, e o liga/desliga da fila. Os números seguem
 * o print de referência: valor com ícone em cima, rótulo em caixa alta embaixo.
 */
export function FilaVideoRow({
  video,
  queueAvg,
  busy,
  disabled,
  onToggle,
  onPreview,
}: {
  video: FilaVideo;
  /** Média da fila (régua do "abaixo da média"). */
  queueAvg: number | null;
  /** Salvando o liga/desliga deste vídeo. */
  busy: boolean;
  /** Pausa indisponível (SQL pendente). */
  disabled: boolean;
  onToggle: (video: FilaVideo) => void;
  onPreview: (video: FilaVideo) => void;
}) {
  const paused = !!video.pausedAt;
  const caption = captionLine(video.caption);
  const below = isBelowAverage(video, queueAvg);
  const name = caption ?? "vídeo sem legenda";

  return (
    <li
      className={cn(
        "grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-xl border bg-surface px-3 py-3 transition-colors sm:gap-x-4 sm:px-4",
        "md:grid-cols-[48px_minmax(0,1fr)_auto_auto]",
        paused ? "border-line bg-surface/60" : "border-line"
      )}
    >
      <button
        type="button"
        onClick={() => onPreview(video)}
        aria-label={`Ver o vídeo: ${name}`}
        className="group relative w-12 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <LazyThumb src={video.publicUrl} label={name} className={cn(paused && "opacity-40")} />
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Play size={16} strokeWidth={2} aria-hidden="true" />
        </span>
      </button>

      <div className="flex min-w-0 flex-col gap-1">
        <p className={cn("truncate text-sm leading-5", caption ? "text-ink" : "italic text-ink-3", paused && "text-ink-3")}>
          {caption ?? "Sem legenda"}
        </p>
        {paused && video.pausedAt ? (
          <p className="text-xs leading-4 text-ink-3">Pausado em {fmtPausedAt(video.pausedAt)} — fora da fila</p>
        ) : video.posts === 0 ? (
          <p className="text-xs leading-4 text-ink-3">Ainda sem post nesta fila</p>
        ) : null}
      </div>

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
          tone={below ? "warning" : undefined}
          hint={below && queueAvg != null ? `abaixo da média da fila (${fmtInt(queueAvg)})` : undefined}
        />
        <Stat icon={<Eye size={14} strokeWidth={2} />} label="Views" value={fmtInt(video.views)} />
      </dl>

      <div className="col-start-3 row-start-1 flex min-w-[104px] justify-end md:col-start-4">
        <Switch
          checked={!paused}
          disabled={busy || disabled}
          onChange={() => onToggle(video)}
          label={paused ? "Pausado" : "Ativo"}
          aria-label={`Na fila: ${name}`}
        />
      </div>
    </li>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "warning";
  hint?: string;
}) {
  // dt antes do dd no DOM; flex-col-reverse põe o número em cima.
  return (
    <div
      className="flex min-w-0 flex-col-reverse items-start gap-0.5 rounded-lg bg-surface-hover/50 px-2.5 py-2 md:min-w-[88px] md:items-end md:bg-transparent md:p-0"
      title={hint}
    >
      <dt className="text-[10px] font-medium uppercase leading-3 tracking-[0.08em] text-ink-3">{label}</dt>
      <dd
        className={cn(
          "flex items-center gap-1.5 font-mono text-base font-semibold leading-6 tabular-nums tracking-[-0.01em] text-ink md:text-lg",
          tone === "warning" && "text-warning"
        )}
      >
        <span className={cn("text-ink-3", tone === "warning" && "text-warning")} aria-hidden="true">
          {icon}
        </span>
        {value}
        {hint && <span className="sr-only">, {hint}</span>}
      </dd>
    </div>
  );
}
