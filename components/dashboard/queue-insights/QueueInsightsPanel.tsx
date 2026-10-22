"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ListX, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Banner, Button, EmptyState, IconButton, Select, Skeleton } from "@/components/ui";
import { InsightsContent } from "./InsightsContent";
import { ScrollRootContext } from "./LazyThumb";
import { queueKey, useQueueInsights, type QueueInsightsState } from "./useQueueInsights";

const FOCUSABLE =
  'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Raio-X da fila — janela central (tela cheia no celular) aberta pelo botão
 * flutuante. Carregada sob demanda (next/dynamic) no primeiro clique; depois o
 * componente fica montado e o conteúdo sai do DOM quando a animação de fechar
 * termina. Cada abertura busca os números de novo. O painel só lê: os botões
 * abrem o Postar preenchido, nada é criado aqui.
 */
export default function QueueInsightsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = React.useState(false);
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();
  const lastPath = React.useRef(pathname);
  const dialogRef = React.useRef<HTMLElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const insights = useQueueInsights(open);
  // Fica montado até a animação de saída terminar.
  const [present, setPresent] = React.useState(open);
  const openRef = React.useRef(open);

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    openRef.current = open;
    if (open) setPresent(true);
  }, [open]);

  // Trocou de página (ex.: o botão levou ao Postar) → fecha.
  React.useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (open) onClose();
  }, [pathname, open, onClose]);

  // Esc fecha; o fundo não rola enquanto a janela está aberta.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Foco no X ao abrir (a volta para o botão flutuante fica com o launcher).
  React.useEffect(() => {
    if (!open || !mounted) return;
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, mounted]);

  // Tab não sai da janela enquanto ela está aberta.
  const trapFocus = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!mounted || !(open || present)) return null;

  // Saída feita à mão (não AnimatePresence): ao fechar, a janela já para de
  // receber clique na hora — senão um clique rápido no botão flutuante cairia no
  // "Montar essa fila" que ainda está sumindo.
  const shown = reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 };
  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 12 };

  return createPortal(
    <>
      <motion.div
        className={cn("fixed inset-0 z-[70] bg-overlay", !open && "pointer-events-none")}
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Centraliza a janela; o clique fora dela cai no fundo escuro acima. */}
      <div className="pointer-events-none fixed inset-0 z-[70] flex items-stretch justify-center sm:items-center sm:p-6">
        <motion.section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qi-title"
          aria-hidden={open ? undefined : true}
          onKeyDown={trapFocus}
          initial={hidden}
          animate={open ? shown : hidden}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onAnimationComplete={() => {
            if (!openRef.current) setPresent(false);
          }}
          className={cn(
            "flex h-dvh w-full flex-col overflow-hidden bg-surface-raised pt-safe shadow-pop",
            "sm:h-[min(880px,calc(100dvh-3rem))] sm:max-w-4xl sm:rounded-xl sm:border sm:border-line sm:pt-0",
            open ? "pointer-events-auto" : "pointer-events-none"
          )}
        >
          <PanelHeader insights={insights} onClose={onClose} closeRef={closeRef} />
          <PanelBody insights={insights} onClose={onClose} />
        </motion.section>
      </div>
    </>,
    document.body
  );
}

// ── Cabeçalho ────────────────────────────────────────────────
function PanelHeader({
  insights,
  onClose,
  closeRef,
}: {
  insights: QueueInsightsState;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement>;
}) {
  const queues = insights.queues ?? [];

  return (
    <header className="flex flex-col gap-3 border-b border-line px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-5">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg"
          aria-hidden="true"
        >
          <Sparkles size={18} strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id="qi-title" className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink">
            Raio-X da fila
          </h2>
          <p className="text-[13px] leading-[18px] text-ink-3">o que os números da fila estão dizendo</p>
        </div>
        <IconButton ref={closeRef} icon={<X size={18} />} aria-label="Fechar Raio-X da fila" onClick={onClose} />
      </div>

      {/* Seletor só quando há mais de uma fila rodando. */}
      {queues.length > 1 && (
        <Select
          aria-label="Fila analisada"
          value={insights.selectedKey ?? ""}
          onChange={(e) => insights.select(e.target.value)}
          options={queues.map((q) => ({ value: queueKey(q), label: q.label }))}
        />
      )}
    </header>
  );
}

// ── Corpo ────────────────────────────────────────────────────
function PanelBody({ insights, onClose }: { insights: QueueInsightsState; onClose: () => void }) {
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null);
  const { queues, selectedKey, data, loading, error } = insights;

  let content: React.ReactNode;
  if (error && !loading) {
    content = (
      <Banner
        tone="danger"
        action={
          <Button variant="secondary" size="sm" onClick={insights.retry}>
            Tentar de novo
          </Button>
        }
      >
        {error}
      </Banner>
    );
  } else if (queues && !loading && (queues.length === 0 || !selectedKey)) {
    content = (
      <EmptyState
        icon={<ListX size={18} />}
        title="Nenhuma campanha rodando"
        description="Quando uma campanha do Postar estiver rodando, o Raio-X mostra aqui o que os números dela estão dizendo."
        action={
          <Button asChild size="sm">
            <Link href="/dashboard/postar" onClick={onClose}>
              Ir para o Postar
            </Link>
          </Button>
        }
      />
    );
  } else if (data && !loading) {
    content = <InsightsContent key={`${selectedKey}@${data.generatedAt}`} data={data} onNavigate={onClose} />;
  } else {
    content = <BodySkeleton />;
  }

  return (
    <div
      ref={setScrollEl}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:px-6"
    >
      <ScrollRootContext.Provider value={scrollEl}>{content}</ScrollRootContext.Provider>
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Carregando o Raio-X">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
            <Skeleton height="28px" width="70%" />
            <Skeleton height="12px" width="55%" />
          </div>
        ))}
      </div>
      {["200px", "360px"].map((h) => (
        <div key={h} className="flex gap-3 sm:gap-4">
          <Skeleton width="36px" height="36px" radius="9999px" className="shrink-0" />
          <Skeleton height={h} radius="12px" className="flex-1" />
        </div>
      ))}
    </div>
  );
}
