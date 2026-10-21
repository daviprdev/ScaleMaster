"use client";

import * as React from "react";
import { ExternalLink, Film, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "@/components/ui";
import { VideoThumb } from "@/components/ui/video-thumb";
import type { PostCard } from "@/lib/queue-insights/types";
import { fmtCompact, fmtInt } from "./format";

// ── Scroll do painel ─────────────────────────────────────────
// As miniaturas observam o corpo rolável do painel (não a janela), então a
// margem de pré-carga funciona dentro do aside.
export const ScrollRootContext = React.createContext<HTMLElement | null>(null);

function useInView<T extends HTMLElement>(rootMargin = "200px 0px") {
  const root = React.useContext(ScrollRootContext);
  const ref = React.useRef<T>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      root,
      rootMargin,
      threshold: 0,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [root, rootMargin]);

  return { ref, inView };
}

// ── Cartão com a linha colorida em cima ──────────────────────
export type EyebrowTone = "success" | "accent" | "warning" | "danger" | "neutral";

const eyebrowText: Record<EyebrowTone, string> = {
  success: "text-success",
  accent: "text-accent",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-ink-3",
};

const eyebrowDot: Record<EyebrowTone, string> = {
  success: "bg-success",
  accent: "bg-accent",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-ink-3",
};

export function Eyebrow({ tone = "neutral", children }: { tone?: EyebrowTone; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em]",
        eyebrowText[tone]
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", eyebrowDot[tone])} aria-hidden="true" />
      {children}
    </p>
  );
}

export function InsightCard({
  eyebrow,
  tone = "neutral",
  title,
  children,
  className,
  headingId,
}: {
  eyebrow: string;
  tone?: EyebrowTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  headingId?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-3 rounded-xl border border-line bg-surface p-4", className)}
    >
      <div className="flex flex-col gap-1.5">
        <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
        {title && (
          <h3 id={headingId} className="text-[15px] font-semibold leading-[22px] tracking-[-0.01em] text-ink">
            {title}
          </h3>
        )}
      </div>
      {children}
    </section>
  );
}

// ── Números ──────────────────────────────────────────────────
/** Número compacto com o valor exato no title. */
export function Num({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)} title={value == null ? undefined : fmtInt(value)}>
      {fmtCompact(value)}
    </span>
  );
}

export function MiniStat({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: number | null | undefined;
  hint?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2.5">
      <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-ink-3">{label}</span>
      <Num value={value} className={cn("font-mono text-lg font-medium leading-6 text-ink", valueClassName)} />
      {hint && <span className="truncate text-[11px] text-ink-3">{hint}</span>}
    </div>
  );
}

// ── Miniatura 9:16 ───────────────────────────────────────────
/** Só monta o <video> perto da área visível; sem URL ou com erro, mostra o ícone. */
export function LazyThumb({ src, className, label }: { src: string | null; className?: string; label?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => setFailed(false), [src]);

  return (
    <div
      ref={ref}
      role={label ? "img" : undefined}
      aria-label={label}
      className={cn("relative aspect-[9/16] shrink-0 overflow-hidden rounded-lg bg-surface-hover", className)}
    >
      {inView && src && !failed ? (
        <VideoThumb src={src} className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-ink-3">
          <Film size={18} strokeWidth={1.5} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

// ── +/− ──────────────────────────────────────────────────────
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  unit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  unit: [string, string];
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2 py-1.5">
      <IconButton
        size="sm"
        icon={<Minus size={14} />}
        aria-label={`Menos ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      />
      <span className="text-center text-[13px] font-medium tabular-nums text-ink" aria-live="polite">
        {value} {value === 1 ? unit[0] : unit[1]}
      </span>
      <IconButton
        size="sm"
        icon={<Plus size={14} />}
        aria-label={`Mais ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      />
    </div>
  );
}

// ── "Ver no Instagram" ───────────────────────────────────────
const INSTAGRAM_URL = /^https:\/\/(www\.)?instagram\.com\//i;

/**
 * Busca o permalink do post e abre em outra aba. A aba é aberta no clique (antes
 * do fetch) para o bloqueador de pop-up não barrar — principalmente no PWA do iOS.
 */
export function ViewOnInstagram({ post }: { post: Pick<PostCard, "postId" | "source" | "mediaId"> }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!post.mediaId) return null;

  const open = async () => {
    setError(null);
    setLoading(true);
    const win = window.open("", "_blank");
    try {
      const qs = new URLSearchParams({ source: post.source, postId: post.postId });
      if (post.mediaId) qs.set("mediaId", post.mediaId);
      const res = await fetch(`/api/queue-insights/permalink?${qs.toString()}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { permalink?: unknown; url?: unknown; error?: unknown };
      const url = typeof body.permalink === "string" ? body.permalink : typeof body.url === "string" ? body.url : null;
      if (!res.ok || !url || !INSTAGRAM_URL.test(url)) {
        throw new Error(typeof body.error === "string" && body.error ? body.error : "o Instagram não devolveu o link");
      }
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      win?.close();
      setError(`Não deu para abrir o post: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3"
        loading={loading}
        iconRight={<ExternalLink size={13} />}
        onClick={open}
      >
        Ver no Instagram
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
