"use client";

import * as React from "react";
import { Avatar, Badge, Banner, Button, ProgressBar } from "@/components/ui";
import { LOAD_WARN, MAX_IDEAL_VIDEOS } from "@/lib/queue-insights/constants";
import { buildIdealQueue } from "@/lib/queue-insights/ideal";
import type {
  AccountScore,
  AccountStatus,
  IdealInputs,
  IdealQueue,
  QueueInsightsResponse,
  Readiness,
  VideoScore,
} from "@/lib/queue-insights/types";
import { fmtCompact, fmtMultiple, fmtReadAt, plural } from "./format";
import { InsightCard, LazyThumb, MiniStat, Num, Stepper } from "./parts";

const ACCOUNTS_PREVIEW = 8;

function tryBuild(inputs: IdealInputs, n: number, m: number): IdealQueue | null {
  try {
    return buildIdealQueue(inputs, n, m);
  } catch {
    return null;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * N e M da fila ideal. Começa no que o servidor montou e recalcula no navegador
 * a cada +/−. Quem usa monta com `key` da resposta, então trocar de fila zera.
 */
export function useIdealQueue(data: QueueInsightsResponse) {
  const inputs = data.idealInputs;
  const ready = data.readiness.state === "ready";
  // Mesmos limites do buildIdealQueue: vídeos com id (máx. 50) e contas que podem postar.
  const maxN = Math.max(1, Math.min(MAX_IDEAL_VIDEOS, inputs.videos.filter((v) => v.videoId != null).length));
  const maxM = Math.max(1, inputs.accounts.filter((a) => a.status !== "inactive").length);

  const base = React.useMemo<IdealQueue | null>(() => {
    if (!ready) return null;
    return data.ideal ?? tryBuild(inputs, clamp(inputs.defaultN, 1, maxN), clamp(inputs.defaultM, 1, maxM));
  }, [ready, data.ideal, inputs, maxN, maxM]);

  const n0 = clamp(base?.n ?? inputs.defaultN, 1, maxN);
  const m0 = clamp(base?.m ?? inputs.defaultM, 1, maxM);
  const [n, setN] = React.useState(n0);
  const [m, setM] = React.useState(m0);

  // Se o cálculo no navegador não roda, os +/− ficam travados no que veio do servidor.
  const canRecompute = React.useMemo(() => ready && tryBuild(inputs, n0, m0) !== null, [ready, inputs, n0, m0]);

  const ideal = React.useMemo<IdealQueue | null>(() => {
    if (!ready) return null;
    if (base && base.n === n && base.m === m) return base;
    return tryBuild(inputs, n, m) ?? base;
  }, [ready, base, inputs, n, m]);

  /** A fila para o Postar, com o início recalculado a partir de agora. */
  const freshForHandoff = React.useCallback((): IdealQueue | null => {
    if (!ideal) return null;
    return tryBuild({ ...inputs, nowIso: new Date().toISOString() }, ideal.n, ideal.m) ?? ideal;
  }, [ideal, inputs]);

  return { ideal, n, m, setN, setM, maxN, maxM, canRecompute, freshForHandoff };
}

export type IdealController = ReturnType<typeof useIdealQueue>;

// ── Prontidão ────────────────────────────────────────────────
const READINESS_COPY: Record<Exclude<Readiness["state"], "ready">, { eyebrow: string; title: string; tone: "warning" | "danger" }> = {
  collecting: { eyebrow: "Coletando dados", title: "A fila ideal ainda não fecha", tone: "warning" },
  few_good: { eyebrow: "Quase lá", title: "Poucos vídeos acima do normal", tone: "warning" },
  no_accounts: { eyebrow: "Sem contas boas", title: "Nenhuma conta passou da régua", tone: "danger" },
  impossible: { eyebrow: "Sem comparação", title: "Essa fila não fecha a régua", tone: "danger" },
};

function ReadinessCard({ readiness }: { readiness: Readiness }) {
  if (readiness.state === "ready") return null;
  const copy = READINESS_COPY[readiness.state];
  const covered = Math.min(3, readiness.coveredVideos);
  return (
    <InsightCard eyebrow={copy.eyebrow} tone={copy.tone} title={copy.title} headingId="qi-ideal-title">
      <p className="text-[13px] leading-5 text-ink-2">{readiness.message}</p>
      {readiness.state === "collecting" && (
        <div className="flex flex-col gap-1.5">
          <ProgressBar value={(covered / 3) * 100} size="sm" aria-label="Vídeos com leitura em 3 ou mais contas" />
          <span className="text-xs tabular-nums text-ink-3">
            {covered} de 3 vídeos com leitura em 3+ contas
          </span>
        </div>
      )}
    </InsightCard>
  );
}

// ── Fila ideal ───────────────────────────────────────────────
const ACCOUNT_BADGE: Record<Exclude<AccountStatus, "good">, string> = {
  weak: "abaixo da régua",
  no_data: "sem dados",
  inactive: "fora do ar",
};

export function IdealSection({ data, ctl }: { data: QueueInsightsResponse; ctl: IdealController }) {
  const [showAllAccounts, setShowAllAccounts] = React.useState(false);
  const { ideal } = ctl;

  const videosById = React.useMemo(() => {
    const map = new Map<string, VideoScore>();
    for (const v of [...data.videos, ...data.idealInputs.videos]) if (v.videoId) map.set(v.videoId, v);
    return map;
  }, [data.videos, data.idealInputs.videos]);

  const accountsById = React.useMemo(() => {
    const map = new Map<string, AccountScore>();
    for (const a of [...data.accounts, ...data.idealInputs.accounts]) map.set(a.accountId, a);
    return map;
  }, [data.accounts, data.idealInputs.accounts]);

  if (data.readiness.state !== "ready") return <ReadinessCard readiness={data.readiness} />;

  if (!ideal) {
    return (
      <InsightCard eyebrow="Fila ideal" tone="accent" title="A fila ideal não pôde ser montada agora" headingId="qi-ideal-title">
        <p className="text-[13px] leading-5 text-ink-2">Toque em Atualizar daqui a pouco para tentar de novo.</p>
      </InsightCard>
    );
  }

  const videos = ideal.videoIds.map((id) => ({ id, score: videosById.get(id) ?? null }));
  const accounts = ideal.accountIds.map((id) => accountsById.get(id) ?? null);
  const visibleAccounts = showAllAccounts ? accounts : accounts.slice(0, ACCOUNTS_PREVIEW);

  // Freio de ~50 posts/24h da Meta: avisa antes de chegar lá. Nada é pausado sozinho.
  const overloaded = ideal.accountIds.filter(
    (id) => (data.accountLoad24h?.[id] ?? 0) + ideal.postsPerDay > LOAD_WARN
  ).length;

  const current = data.idealInputs.currentTypicalPerPost;

  return (
    <InsightCard eyebrow="Fila ideal" tone="accent" title={ideal.text.title} headingId="qi-ideal-title">
      <p className="text-[13px] leading-5 text-ink-2">{ideal.text.body}</p>

      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Previsão" value={ideal.expectedPerPost} valueClassName="text-success" hint="views por post" />
        <MiniStat
          label="Fila de hoje"
          value={current}
          hint={
            data.idealInputs.currentObservedMedian != null
              ? `mediana real ${fmtCompact(data.idealInputs.currentObservedMedian)}`
              : "mesma régua"
          }
        />
        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface px-3 py-2.5">
          <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-ink-3">Começa</span>
          <span className="font-mono text-lg font-medium leading-6 tabular-nums text-ink">
            {ideal.startHour != null ? `${ideal.startHour}h` : fmtReadAt(ideal.startAt)}
          </span>
          <span className="truncate text-[11px] text-ink-3">horário de Brasília</span>
        </div>
      </div>

      {/* N e M */}
      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label="vídeos"
          unit={["vídeo", "vídeos"]}
          value={ctl.n}
          min={1}
          max={ctl.maxN}
          onChange={ctl.setN}
          disabled={!ctl.canRecompute}
        />
        <Stepper
          label="contas"
          unit={["conta", "contas"]}
          value={ctl.m}
          min={1}
          max={ctl.maxM}
          onChange={ctl.setM}
          disabled={!ctl.canRecompute}
        />
      </div>
      {!ctl.canRecompute && (
        <p className="text-xs text-ink-3">O ajuste de vídeos e contas não está disponível agora — vale a fila sugerida.</p>
      )}

      {/* Vídeos */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-ink-2">
          {plural(videos.length, "vídeo", "vídeos")} · {fmtCompact(ideal.postsPerCycle)} publicações por ciclo
        </p>
        <ul className="grid grid-cols-4 gap-2 md:grid-cols-6 lg:grid-cols-8">
          {videos.map(({ id, score }, i) => (
            <li key={id} className="flex min-w-0 flex-col gap-1">
              <LazyThumb src={score?.publicUrl ?? null} label={`Vídeo ${i + 1} da fila ideal`} />
              <span className="truncate text-xs text-success">
                <Num value={score?.matureViewsMedian} className="font-medium" /> views
              </span>
              <span className="truncate text-[11px] tabular-nums text-ink-3">
                <span className="font-medium text-ink">{fmtMultiple(score?.score)}</span>
                {score && ` · ${plural(score.posts, "post", "posts")}`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Contas */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-ink-2">{plural(accounts.length, "conta", "contas")}, das melhores para as piores</p>
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {visibleAccounts.map((a, i) => (
            <li key={a?.accountId ?? `missing-${i}`} className="flex items-center gap-2.5 px-3 py-2">
              <Avatar size="sm" src={a?.avatarUrl} alt={a?.username ?? "?"} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">@{a?.username ?? "conta"}</span>
              {a && a.status !== "good" && (
                <Badge tone={a.status === "inactive" ? "danger" : "warning"}>{ACCOUNT_BADGE[a.status]}</Badge>
              )}
              <span className="shrink-0 text-xs text-ink-3">
                <Num value={a?.currentNormal} className="font-medium text-success" /> /post
              </span>
            </li>
          ))}
        </ul>
        {accounts.length > ACCOUNTS_PREVIEW && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAllAccounts((v) => !v)}>
            {showAllAccounts ? "Mostrar menos" : `Mostrar todas (${accounts.length})`}
          </Button>
        )}
      </div>

      {/* Avisos */}
      {(ideal.warnings.length > 0 || overloaded > 0) && (
        <div className="flex flex-col gap-2">
          {overloaded > 0 && (
            <Banner tone="warning" className="px-3 py-2 text-xs">
              {overloaded === 1
                ? `1 conta passaria de ~${LOAD_WARN} posts em 24h — pause a fila atual antes`
                : `${overloaded} contas passariam de ~${LOAD_WARN} posts em 24h — pause a fila atual antes`}
            </Banner>
          )}
          {ideal.warnings.map((w) => (
            <Banner key={w} tone="warning" className="px-3 py-2 text-xs">
              {w}
            </Banner>
          ))}
        </div>
      )}
    </InsightCard>
  );
}
