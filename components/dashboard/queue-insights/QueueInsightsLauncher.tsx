"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ScanSearch } from "lucide-react";

// O painel (e tudo que ele importa) só baixa no primeiro clique — o dashboard não paga nada por ele.
const loadPanel = () => import("./QueueInsightsPanel");
const QueueInsightsPanel = dynamic(loadPanel, { ssr: false, loading: () => null });

/**
 * Botão flutuante do Raio-X da fila, no canto inferior direito de todas as
 * páginas do dashboard. Não busca nada ao montar.
 */
export function QueueInsightsLauncher() {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const wasOpen = React.useRef(false);

  const close = React.useCallback(() => setOpen(false), []);

  // Fechou → o foco volta para o botão.
  React.useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Abrir Raio-X da fila"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Raio-X da fila"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        // Passou o mouse: já adianta o download do painel.
        onPointerEnter={() => void loadPanel().catch(() => {})}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-[calc(1rem+env(safe-area-inset-right,0px))] z-30 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-fg shadow-pop transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:right-[calc(1.5rem+env(safe-area-inset-right,0px))]"
      >
        <ScanSearch size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {loaded && <QueueInsightsPanel open={open} onClose={close} />}
    </>
  );
}
