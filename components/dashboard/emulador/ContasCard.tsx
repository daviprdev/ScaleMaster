"use client";

import * as React from "react";
import { CheckCircle2, Circle, Loader2, Plus, RotateCw, Trash2, UserPlus, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/utils";
import { NOVA_CONTA_FLUXO, type EmulatorJob, type JobStatus } from "@/lib/emulador/jobs";
import type { EmulatorAgent } from "@/lib/emulador/types";
import { timeAgo } from "@/lib/emulador/view";

const STATUS_BADGE: Record<JobStatus, { tone: BadgeTone; label: string }> = {
  queued: { tone: "neutral", label: "Na fila" },
  running: { tone: "info", label: "Rodando" },
  done: { tone: "success", label: "Concluída" },
  error: { tone: "danger", label: "Parou" },
};

interface ContasCardProps {
  agent: EmulatorAgent;
  jobs: readonly EmulatorJob[];
  /** Contas com pedido saindo agora (Continuar/Remover em loading). */
  busy: ReadonlySet<string>;
  now: number;
  onNew: () => void;
  onContinue: (job: EmulatorJob) => void;
  onRemove: (job: EmulatorJob) => void;
}

/** Fila Nova conta de um PC: uma linha por conta, com o andamento etapa a etapa. */
export function ContasCard({ agent, jobs, busy, now, onNew, onContinue, onRemove }: ContasCardProps) {
  return (
    <Card
      title="Contas"
      description="Cada conta nasce numa cópia da instância padrão. Uma por vez, na ordem da fila."
      actions={
        <Button size="sm" icon={<Plus size={14} />} disabled={agent.instances.length === 0} onClick={onNew}>
          Nova conta
        </Button>
      }
    >
      {jobs.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={18} />}
          title="Nenhuma conta ainda"
          description="Clique em Nova conta, informe a proxy e os dados, e o agente faz o resto no MuMu."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              busy={busy.has(job.id)}
              now={now}
              onContinue={onContinue}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

interface JobRowProps {
  job: EmulatorJob;
  busy: boolean;
  now: number;
  onContinue: (job: EmulatorJob) => void;
  onRemove: (job: EmulatorJob) => void;
}

function JobRow({ job, busy, now, onContinue, onRemove }: JobRowProps) {
  const badge = STATUS_BADGE[job.status];
  const steps = new Map(job.steps.map((s) => [s.key, s]));
  const where =
    job.instanceIndex === null
      ? `cópia da #${job.templateIndex}`
      : `instância #${job.instanceIndex} (cópia da #${job.templateIndex})`;

  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{job.label ? `@${job.label}` : "Conta sem usuário"}</p>
          <p className="text-xs text-ink-3">
            {where} · {timeAgo(job.updatedAt, now)}
          </p>
        </div>
        <Badge tone={badge.tone} dot>
          {badge.label}
        </Badge>
        <div className="flex items-center gap-2">
          {job.status === "error" && (
            <Button size="sm" icon={<RotateCw size={14} />} loading={busy} onClick={() => onContinue(job)}>
              Continuar
            </Button>
          )}
          {job.status !== "running" && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              disabled={busy}
              onClick={() => onRemove(job)}
              aria-label="Remover da lista"
            >
              Remover
            </Button>
          )}
        </div>
      </div>

      <ol className="mt-3 flex flex-col gap-1.5">
        {NOVA_CONTA_FLUXO.map((def) => {
          const step = steps.get(def.key);
          return (
            <li key={def.key} className="flex items-start gap-2 text-sm">
              <StepIcon status={step?.status} ready={def.ready} />
              <span className={cn("min-w-0", def.ready ? "text-ink" : "text-ink-3")}>
                {def.label}
                {!def.ready && <span className="text-xs"> · em breve</span>}
                {step?.message && (
                  <span className={cn("text-xs", step.status === "error" ? "text-danger" : "text-ink-2")}>
                    {" "}
                    · {step.message}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {job.status === "error" && job.error && <p className="mt-3 text-xs text-danger">{job.error}</p>}
    </li>
  );
}

function StepIcon({ status, ready }: { status: string | undefined; ready: boolean }) {
  const cls = "mt-0.5 shrink-0";
  if (status === "done") return <CheckCircle2 size={15} className={cn(cls, "text-success")} />;
  if (status === "running") return <Loader2 size={15} className={cn(cls, "animate-spin text-accent")} />;
  if (status === "error") return <XCircle size={15} className={cn(cls, "text-danger")} />;
  return <Circle size={15} className={cn(cls, ready ? "text-ink-3" : "text-line")} strokeDasharray={ready ? undefined : "3 3"} />;
}
