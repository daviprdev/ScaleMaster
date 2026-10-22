"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Rocket, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Banner, Button } from "@/components/ui";
import { saveHandoff } from "@/lib/queue-insights/handoff";
import type { HotPost, IdealQueue, QueueInsightsResponse, Summary } from "@/lib/queue-insights/types";
import { fmtInt, fmtViews, plural } from "./format";
import { idealHandoff, republishHandoff, type HandoffPayload } from "./handoff-payload";
import { LazyThumb } from "./LazyThumb";

const STORAGE_BLOCKED =
  "O navegador bloqueou o armazenamento do site, então não deu para abrir o Postar com a fila. Saia da janela anônima ou libere o armazenamento e tente de novo.";

type Action = "hot" | "ideal";

/**
 * Conteúdo do Raio-X no layout do Hotler: números do topo e, numa linha do
 * tempo, o post que está indo bem e a fila ideal. Os dois botões só abrem o
 * Postar preenchido — nada é criado aqui.
 */
export function InsightsContent({ data, onNavigate }: { data: QueueInsightsResponse; onNavigate: () => void }) {
  const router = useRouter();
  const [failed, setFailed] = React.useState<Action | null>(null);

  // O payload é montado no clique, com o "agora" do clique (início nunca no passado).
  const openPostar = (action: Action, build: (d: QueueInsightsResponse) => HandoffPayload | null) => {
    const payload = build(data);
    if (!payload) return;
    const id = saveHandoff(payload);
    if (!id) {
      setFailed(action);
      return;
    }
    setFailed(null);
    router.push(`/dashboard/postar?ideal=${encodeURIComponent(id)}`);
    onNavigate();
  };

  return (
    <div className="flex flex-col gap-6">
      <NumbersRow summary={data.summary} />

      <ol className="flex flex-col">
        {data.hot && (
          <TimelineItem icon={<Rocket size={16} strokeWidth={1.75} />}>
            <HotCard
              hot={data.hot}
              failed={failed === "hot"}
              onDismissError={() => setFailed(null)}
              onRepublish={() => openPostar("hot", republishHandoff)}
            />
          </TimelineItem>
        )}
        <TimelineItem icon={<Trophy size={16} strokeWidth={1.75} />} last>
          {data.ideal ? (
            <IdealCard
              ideal={data.ideal}
              failed={failed === "ideal"}
              onDismissError={() => setFailed(null)}
              onBuild={() => openPostar("ideal", idealHandoff)}
            />
          ) : (
            <Card labelledBy="qi-ideal-title">
              <CardText
                id="qi-ideal-title"
                title="A sua fila ideal"
                body={data.idealUnavailable ?? "Ainda não dá para montar a fila ideal com os dados dessa fila."}
              />
            </Card>
          )}
        </TimelineItem>
      </ol>
    </div>
  );
}

// ── Números do topo ──────────────────────────────────────────
function NumbersRow({ summary }: { summary: Summary }) {
  const items: { label: string; value: number | null; className?: string }[] = [
    { label: "publicações da fila", value: summary.posts },
    { label: "visualizações", value: summary.totalViews },
    { label: "views por publicação", value: summary.viewsPerPost },
    { label: "seu melhor post", value: summary.bestPostViews, className: "text-success" },
  ];
  return (
    // gap-px sobre o fundo da borda = linhas divisórias nas 2×2 do celular e nas 4 colunas.
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col-reverse gap-1 bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
          <dt className="text-xs leading-4 text-ink-3">{it.label}</dt>
          <dd
            className={cn(
              "font-mono text-xl font-medium leading-7 tracking-[-0.02em] tabular-nums text-ink sm:text-[26px] sm:leading-8",
              it.className
            )}
          >
            {fmtInt(it.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── Linha do tempo ───────────────────────────────────────────
function TimelineItem({ icon, last, children }: { icon: React.ReactNode; last?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 sm:gap-4">
      <div className="flex shrink-0 flex-col items-center">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-info-soft text-accent sm:h-10 sm:w-10"
          aria-hidden="true"
        >
          {icon}
        </span>
        {!last && <span className="my-2 w-px flex-1 bg-line" aria-hidden="true" />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-5")}>{children}</div>
    </li>
  );
}

function Card({ labelledBy, children }: { labelledBy: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-3.5 sm:p-5"
    >
      {children}
    </section>
  );
}

function CardText({
  id,
  eyebrow,
  eyebrowClassName,
  title,
  body,
}: {
  id: string;
  eyebrow?: string;
  eyebrowClassName?: string;
  title: string;
  body?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {eyebrow && <p className={cn("text-xs font-medium leading-4 tabular-nums", eyebrowClassName)}>{eyebrow}</p>}
      <h3 id={id} className="text-[15px] font-semibold leading-[22px] tracking-[-0.01em] text-ink sm:text-base">
        {title}
      </h3>
      {body && <p className="text-[13px] leading-5 text-ink-2 sm:text-sm sm:leading-6">{body}</p>}
    </div>
  );
}

function ActionButton({
  size,
  disabledReason,
  onClick,
  children,
}: {
  size: "md" | "lg";
  disabledReason: string | null;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-start">
      <Button size={size} iconRight={<ArrowRight size={16} />} disabled={!!disabledReason} onClick={onClick}>
        {children}
      </Button>
      {disabledReason && <p className="text-xs text-ink-3">{disabledReason}</p>}
    </div>
  );
}

function HandoffError({ onClose }: { onClose: () => void }) {
  return (
    <Banner tone="danger" className="px-3 py-2 text-xs" onClose={onClose}>
      {STORAGE_BLOCKED}
    </Banner>
  );
}

// ── Um post seu está indo muito bem agora ────────────────────
function HotCard({
  hot,
  failed,
  onDismissError,
  onRepublish,
}: {
  hot: HotPost;
  failed: boolean;
  onDismissError: () => void;
  onRepublish: () => void;
}) {
  const disabledReason = !hot.videoId
    ? "O vídeo saiu da Biblioteca — não dá para republicar."
    : hot.republishAccountIds.length === 0
      ? "Todas as contas ativas da fila já postaram esse vídeo nas últimas 24h."
      : null;

  return (
    <Card labelledBy="qi-hot-title">
      <CardText id="qi-hot-title" eyebrow={hot.eyebrow} eyebrowClassName="text-success" title={hot.title} body={hot.body} />

      <div className="flex flex-col items-start gap-1.5">
        <LazyThumb src={hot.publicUrl} label={`Vídeo do post de @${hot.username}`} className="w-20" />
        <div className="flex flex-col">
          <span className="text-xs font-semibold leading-4 tabular-nums text-success">{fmtViews(hot.views)}</span>
          <span className="text-xs leading-4 text-ink-3">@{hot.username}</span>
        </div>
      </div>

      <ActionButton size="md" disabledReason={disabledReason} onClick={onRepublish}>
        Publicar nas outras contas
      </ActionButton>
      {failed && <HandoffError onClose={onDismissError} />}
    </Card>
  );
}

// ── A sua fila ideal, montada com o que já funciona ──────────
function IdealCard({
  ideal,
  failed,
  onDismissError,
  onBuild,
}: {
  ideal: IdealQueue;
  failed: boolean;
  onDismissError: () => void;
  onBuild: () => void;
}) {
  const disabledReason =
    ideal.videos.length === 0
      ? "Nenhum vídeo para montar a fila."
      : ideal.accounts.length === 0
        ? "Nenhuma conta ativa da fila para montar a fila."
        : null;

  return (
    <Card labelledBy="qi-ideal-title">
      <CardText
        id="qi-ideal-title"
        eyebrow={ideal.eyebrow}
        eyebrowClassName="text-warning"
        title={ideal.title}
        body={ideal.body}
      />

      {ideal.videos.length > 0 && (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 md:grid-cols-8" aria-label="Vídeos da fila ideal">
          {ideal.videos.map((v, i) => (
            <li key={v.videoId} className="flex min-w-0 flex-col gap-1">
              <LazyThumb src={v.publicUrl} label={`Vídeo ${i + 1} da fila ideal`} />
              <span className="text-[11px] font-semibold leading-tight tabular-nums text-success sm:text-xs">
                {fmtViews(v.avgViews)}
              </span>
              <span className="text-[11px] leading-tight text-ink-3">{plural(v.posts, "post", "posts")}</span>
            </li>
          ))}
        </ul>
      )}

      {ideal.accounts.length > 0 && (
        <ul className="grid border-t border-line sm:grid-cols-2 sm:gap-x-6" aria-label="Contas da fila ideal">
          {ideal.accounts.map((a) => (
            <li
              key={a.accountId}
              className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px] leading-5"
            >
              <span className="min-w-0 truncate text-ink">@{a.username}</span>
              <span className="shrink-0 tabular-nums text-success">{fmtViews(a.avgViews)}</span>
            </li>
          ))}
        </ul>
      )}

      {ideal.footnote && <p className="text-xs leading-4 text-ink-3">{ideal.footnote}</p>}

      <ActionButton size="lg" disabledReason={disabledReason} onClick={onBuild}>
        Montar essa fila
      </ActionButton>
      {failed && <HandoffError onClose={onDismissError} />}
    </Card>
  );
}
