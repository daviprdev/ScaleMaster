"use client";

import * as React from "react";

interface VideoThumbProps {
  src: string;
  className?: string;
  /** Opcional: quem usa decide o que mostrar quando o vídeo não carrega. */
  onError?: React.ReactEventHandler<HTMLVideoElement>;
}

/**
 * Miniatura de vídeo que NÃO fica preta.
 *
 * Um <video preload="metadata"> sem `poster` renderiza um quadro PRETO: o
 * browser carrega só os metadados e não decodifica nenhum frame. O truque do
 * media fragment `#t=0.1` na URL nem sempre pinta (depende do browser/preload).
 * Aqui forçamos via JS: ao ter os metadados, damos um seek para ~0,1s — o
 * browser decodifica e pinta esse frame como capa, sem precisar dar play.
 * Funciona com URLs do Storage (suportam Range) e com blob: de upload local.
 */
export function VideoThumb({ src, className, onError }: VideoThumbProps) {
  const ref = React.useRef<HTMLVideoElement>(null);

  const seekToFrame = React.useCallback(() => {
    const v = ref.current;
    if (!v) return;
    try {
      // Pequeno offset evita o frame 0 (às vezes preto/keyframe vazio).
      const t = v.duration && isFinite(v.duration) ? Math.min(0.1, v.duration / 2) : 0.1;
      if (v.currentTime < t) v.currentTime = t;
    } catch {
      /* alguns browsers barram seek antes de "canplay" — o onLoadedData retenta */
    }
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      className={className}
      muted
      playsInline
      preload="metadata"
      // dois gatilhos: metadados prontos e primeiro frame carregado.
      onLoadedMetadata={seekToFrame}
      onLoadedData={seekToFrame}
      onError={onError}
    />
  );
}
