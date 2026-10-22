"use client";

import * as React from "react";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";
import { VideoThumb } from "@/components/ui/video-thumb";

/**
 * As miniaturas observam o corpo rolável do painel (não a janela), então a
 * margem de pré-carga funciona dentro da janela do Raio-X.
 */
export const ScrollRootContext = React.createContext<HTMLElement | null>(null);

function useNearViewport<T extends HTMLElement>(rootMargin = "200px 0px") {
  const root = React.useContext(ScrollRootContext);
  const ref = React.useRef<T>(null);
  const [near, setNear] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    // Chegou perto uma vez, fica montado — rolar de volta não baixa o vídeo de novo.
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        obs.disconnect();
      },
      { root, rootMargin, threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [root, rootMargin]);

  return { ref, near };
}

/** Miniatura 9:16. Só monta o <video> perto da área visível; sem URL ou com erro, mostra o ícone. */
export function LazyThumb({ src, label, className }: { src: string | null; label: string; className?: string }) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => setFailed(false), [src]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={cn("relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-surface-hover", className)}
    >
      {near && src && !failed ? (
        <VideoThumb src={src} className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-ink-3">
          <Film size={18} strokeWidth={1.5} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
