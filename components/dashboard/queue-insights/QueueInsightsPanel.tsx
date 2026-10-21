"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ListX, RefreshCw, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Banner, Button, EmptyState, IconButton, Select, Skeleton } from "@/components/ui";
import { saveHandoff } from "@/lib/queue-insights/handoff";
import type { PostCard, QueueInsightsResponse, QueueListItem } from "@/lib/queue-insights/types";
import { fmtReadAt, plural } from "./format";
import { ScrollRootContext } from "./parts";
import { SummarySection } from "./SummarySection";
import { HotSection } from "./HotSection";
import { IdealSection, useIdealQueue } from "./IdealSection";
import { TimingSection } from "./TimingSection";
import { HowWeCalculate } from "./HowWeCalculate";
import { queueKey, useQueueInsights } from "./useQueueInsights";

const STATE_SUFFIX: Record<QueueListItem["state"], string> = {
  running: "",
  running_synced: "",
  paused: " · pausada",
  finished: " · terminada",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Raio-X da fila — janela central (tela cheia no celular) aberta pelo botão
 * flutuante. Carregada sob
 * demanda (next/dynamic) no primeiro clique; depois o componente fica montado
 * (com o cache) e o conteúdo sai do DOM quando a animação de fechar termina.
 * O painel só lê: os botões abrem o Postar preenchido, nada é criado aqui.
 */
export default function QueueInsightsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = React.useState(false);
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();
  const lastPath = React.useRef(pathname);
  const asideRef = React.useRef<HTMLElement>(null);
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

  // Trocou de página → fecha.
  React.useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (open) onClose();
  }, [pathname, open, onClose]);

  // Esc fecha; o fundo não rola enquanto o painel está aberto.
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

  // Tab não sai do painel enquanto ele está aberto.
  const trapFocus = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !asideRef.current) return;
    const nodes = Array.from(asideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
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

  // Saída feita à mão (não AnimatePresence): ao fechar, o painel já para de
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
        <motion.aside
          ref={asideRef}
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
            "sm:h-[min(880px,calc(100dvh-3rem))] sm:max-w-4xl sm:rounded-2xl sm:border sm:border-line sm:pt-0",
            open ? "pointer-events-auto" : "pointer-events-none"
          )}
        >
          <PanelHeader insights={insights} onClose={onClose} closeRef={closeRef} />
          <PanelBody insights={insights} onClose={onClose} />
        </motion.aside>
      </div>
    </>,
    document.body
  );
}

type Insights = ReturnType<typeof useQueueInsights>;

// ── Cabeçalho ────────────────────────────────────────────────
function PanelHeader({
  insights,
  onClose,
  closeRef,
}: {
  insights: Insights;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement>;
}) {
  const { list, selectedKey, data, listLoading, dataLoading } = insights;
  const queues = list?.queues ?? [];
  const busy = listLoading || dataLoading;

  return (
    <header className="flex flex-col gap-3 border-b border-line px-4 pb-3 pt-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="qi-title" className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink">
            Raio-X da fila
          </h2>
          <p className="text-[13px] text-ink-3">o que os números da fila estão dizendo</p>
        </div>
        <IconButton ref={closeRef} icon={<X size={18} />} aria-label="Fechar Raio-X da fila" onClick={onClose} />
      </div>

      {list === null && listLoading ? (
        <Skeleton height="36px" />
      ) : queues.length > 0 ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select
              aria-label="Fila analisada"
              value={selectedKey ?? ""}
              onChange={(e) => insights.select(e.target.value)}
              options={queues.map((q) => ({ value: queueKey(q), label: q.label + STATE_SUFFIX[q.state] }))}
            />
          </div>
          <Button
            variant="ghost"
            size="md"
            icon={<RefreshCw size={14} className={busy ? "animate-spin" : undefined} />}
            onClick={insights.refresh}
            disabled={busy}
          >
            Atualizar
          </Button>
        </div>
      ) : null}

      {list !== null && insights.listError && !listLoading && (
        <p className="text-xs text-danger">Não deu para atualizar a lista de filas: {insights.listError}</p>
      )}
      {data && <FreshnessLine data={data} />}
    </header>
  );
}

function FreshnessLine({ data }: { data: QueueInsightsResponse }) {
  const f = data.freshness;
  const parts = [
    f.viewsReadUntil ? `views lidas até ${fmtReadAt(f.viewsReadUntil)}` : "nenhuma leitura de views ainda",
    f.awaitingMatureRead > 0
      ? plural(f.awaitingMatureRead, "post aguardando leitura de 4h", "posts aguardando leitura de 4h")
      : null,
    f.frozenAccountPosts > 0
      ? plural(f.frozenAccountPosts, "post de conta fora do ar", "posts de contas fora do ar")
      : null,
  ].filter(Boolean);
  return <p className="text-xs leading-4 text-ink-3">{parts.join(" · ")}</p>;
}

// ── Corpo ────────────────────────────────────────────────────
function PanelBody({ insights, onClose }: { insights: Insights; onClose: () => void }) {
  const { list, listLoading, listError, data, dataLoading, dataError, selectedKey } = insights;

  if (list === null) {
    if (listError && !listLoading) {
      return (
        <ScrollArea>
          <Banner
            tone="danger"
            action={
              <Button variant="secondary" size="sm" onClick={insights.retry}>
                Tentar de novo
              </Button>
            }
          >
            {listError}
          </Banner>
        </ScrollArea>
      );
    }
    return (
      <ScrollArea>
        <BodySkeleton />
      </ScrollArea>
    );
  }

  if (list.queues.length === 0 || !selectedKey) {
    return (
      <ScrollArea>
        <EmptyState
          icon={<ListX size={18} />}
          title="Nenhuma fila rodando"
          description="Crie uma campanha no Postar ou um Loop. Quando os posts tiverem views, o Raio-X aparece aqui."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild size="sm">
                <Link href="/dashboard/postar" onClick={onClose}>
                  Ir para o Postar
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/loop" onClick={onClose}>
                  Ir para o Loop
                </Link>
              </Button>
            </div>
          }
        />
      </ScrollArea>
    );
  }

  if (dataError && !dataLoading) {
    return (
      <ScrollArea>
        <Banner
          tone="danger"
          action={
            <Button variant="secondary" size="sm" onClick={insights.retry}>
              Tentar de novo
            </Button>
          }
        >
          {dataError}
        </Banner>
      </ScrollArea>
    );
  }

  if (!data) {
    return (
      <ScrollArea>
        <BodySkeleton />
      </ScrollArea>
    );
  }

  return <InsightsContent key={`${selectedKey}@${data.generatedAt}`} data={data} onNavigate={onClose} />;
}

function ScrollArea({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:px-5">
      {children}
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando o Raio-X">
      <div className="grid grid-cols-3 gap-2">
        <Skeleton height="64px" radius="8px" />
        <Skeleton height="64px" radius="8px" />
        <Skeleton height="64px" radius="8px" />
      </div>
      <Skeleton height="132px" radius="12px" />
      <Skeleton height="220px" radius="12px" />
      <Skeleton height="280px" radius="12px" />
    </div>
  );
}

// ── Conteúdo da fila ─────────────────────────────────────────
function InsightsContent({ data, onNavigate }: { data: QueueInsightsResponse; onNavigate: () => void }) {
  const router = useRouter();
  const ideal = useIdealQueue(data);
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null);
  const [handoffError, setHandoffError] = React.useState<string | null>(null);

  const sourceQueue = { source: data.queue.source, id: data.queue.id, label: data.queue.label };

  const videoInfo = (videoId: string) =>
    data.idealInputs.videos.find((v) => v.videoId === videoId) ?? data.videos.find((v) => v.videoId === videoId) ?? null;

  const openPostar = (id: string | null) => {
    if (!id) {
      setHandoffError(
        "O navegador bloqueou o armazenamento do site, então não deu para levar a fila ao Postar. Saia da janela anônima ou libere o armazenamento e tente de novo."
      );
      return;
    }
    setHandoffError(null);
    router.push(`/dashboard/postar?ideal=${encodeURIComponent(id)}`);
    onNavigate();
  };

  const buildIdeal = () => {
    const q = ideal.freshForHandoff();
    if (!q) return;
    const id = saveHandoff({
      kind: "ideal",
      videoIds: q.videoIds,
      accountIds: q.accountIds,
      postsPerDay: q.postsPerDay,
      startAt: q.startAt,
      defaults: data.queue.handoff,
      sourceQueue,
      videos: q.videoIds.map((vid) => {
        const v = videoInfo(vid);
        return { id: vid, publicUrl: v?.publicUrl ?? null, caption: v?.caption ?? null };
      }),
    });
    openPostar(id);
  };

  const republish = (post: PostCard) => {
    if (!post.videoId || data.hot.republishAccountIds.length === 0) return;
    const v = videoInfo(post.videoId);
    const id = saveHandoff({
      kind: "republish",
      videoIds: [post.videoId],
      accountIds: data.hot.republishAccountIds,
      postsPerDay: 1,
      startAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      defaults: { ...data.queue.handoff, accountStaggerSeconds: 300 },
      sourceQueue,
      videos: [{ id: post.videoId, publicUrl: post.publicUrl ?? v?.publicUrl ?? null, caption: v?.caption ?? null }],
    });
    openPostar(id);
  };

  const missing = data.missingSql ?? [];

  return (
    <>
      <div
        ref={setScrollEl}
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:px-5"
      >
        <ScrollRootContext.Provider value={scrollEl}>
          <div className="flex flex-col gap-4">
            {missing.length > 0 && (
              <Banner tone="warning" className="px-3 py-2.5 text-xs">
                <p className="font-medium">Rode o SQL de supabase/fila_ideal.sql no Supabase</p>
                <ul className="mt-1 list-disc pl-4">
                  {missing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Banner>
            )}

            <SummarySection summary={data.summary} />
            {/* Na janela larga, "bombando" e horário/dia lado a lado; a fila ideal ocupa a largura toda. */}
            <div className="grid items-start gap-4 md:grid-cols-2">
              <HotSection hot={data.hot} onRepublish={republish} />
              <TimingSection bestHour={data.bestHour} bestDay={data.bestDay} />
            </div>
            <IdealSection data={data} ctl={ideal} />
            <HowWeCalculate />
          </div>
        </ScrollRootContext.Provider>
      </div>

      {(handoffError || ideal.ideal) && (
        <footer className="flex flex-col gap-2 border-t border-line bg-surface-raised px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-5">
          {handoffError && (
            <Banner tone="danger" className="px-3 py-2 text-xs" onClose={() => setHandoffError(null)}>
              {handoffError}
            </Banner>
          )}
          {ideal.ideal && (
            <>
              <Button size="lg" className="w-full" icon={<Wand2 size={16} />} onClick={buildIdeal}>
                Montar essa fila
              </Button>
              <p className="text-center text-[11px] text-ink-3">
                Abre o Postar já preenchido — você revisa antes de confirmar.
              </p>
            </>
          )}
        </footer>
      )}
    </>
  );
}
