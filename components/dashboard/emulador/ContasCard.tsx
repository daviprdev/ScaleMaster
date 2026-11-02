"use client";

import * as React from "react";
import { Activity, CheckCircle2, Circle, Loader2, RotateCw, Send, Trash2, UserPlus, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/utils";
import { atividadeSteps } from "@/lib/emulador/atividade";
import { NOVA_CONTA_FLUXO, type EmulatorJob, type JobKind, type JobStatus } from "@/lib/emulador/jobs";
import { timeAgo } from "@/lib/emulador/view";

const STATUS_BADGE: Record<JobStatus, { tone: BadgeTone; label: string }> = {
  queued: { tone: "neutral", label: "Na fila" },
  running: { tone: "info", label: "Rodando" },
  done: { tone: "success", label: "Conta criada" },
  error: { tone: "danger", label: "Parou" },
};

const TEXTOS: Record<JobKind, { title: string; description: string; emptyTitle: string; emptyDescription: string; done: string }> = {
  "nova-conta": {
    title: "Criação de contas",
    description: "Uma conta por vez, na ordem da fila. Cada uma nasce numa cópia da instância padrão.",
    emptyTitle: "Nenhuma conta ainda",
    emptyDescription: "Clique em Criar instância, informe a proxy e os dados da conta, e o agente faz o resto no MuMu.",
    done: "Conta criada",
  },
  atividade: {
    title: "Estruturação das contas",
    description: "Divide a fila com a criação: uma coisa por vez. A instância liga, faz o que foi marcado e desliga.",
    emptyTitle: "Nenhuma estruturação ainda",
    emptyDescription: "Clique em Estruturar na linha de uma instância.",
    done: "Concluída",
  },
};

interface ContasCardProps {
  /** Qual fila o cartão mostra: as contas sendo criadas ou as atividades. */
  kind: JobKind;
  jobs: readonly EmulatorJob[];
  /** Contas com pedido saindo agora (Continuar/Remover/Responder em loading). */
  busy: ReadonlySet<string>;
  now: number;
  onContinue: (job: EmulatorJob) => void;
  onRemove: (job: EmulatorJob) => void;
  onReply: (job: EmulatorJob, resposta: string) => void;
}

/** Uma linha por conta (ou atividade) da fila, com o andamento etapa a etapa. Editar dados fica na linha da instância. */
export function ContasCard({ kind, jobs, busy, now, onContinue, onRemove, onReply }: ContasCardProps) {
  const t = TEXTOS[kind];
  return (
    <Card title={t.title} description={t.description}>
      {jobs.length === 0 ? (
        <EmptyState
          icon={kind === "atividade" ? <Activity size={18} /> : <UserPlus size={18} />}
          title={t.emptyTitle}
          description={t.emptyDescription}
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
              onReply={onReply}
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
  onReply: (job: EmulatorJob, resposta: string) => void;
}

function JobRow({ job, busy, now, onContinue, onRemove, onReply }: JobRowProps) {
  const atividade = job.kind === "atividade";
  const badge = job.status === "done" ? { ...STATUS_BADGE.done, label: TEXTOS[job.kind].done } : STATUS_BADGE[job.status];
  const steps = new Map(job.steps.map((s) => [s.key, s]));
  const plan = atividade ? atividadeSteps(job.acoes) : NOVA_CONTA_FLUXO;
  const where = atividade
    ? `instância #${job.instanceIndex ?? job.templateIndex}`
    : job.instanceIndex === null
      ? `cópia da #${job.templateIndex}`
      : `instância #${job.instanceIndex} (cópia da #${job.templateIndex})`;

  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{job.label ?? "Conta"}</p>
          <p className="text-xs text-ink-3">
            {where} · {timeAgo(job.updatedAt, now)}
          </p>
        </div>
        <Badge tone={job.prompt ? "warning" : badge.tone} dot>
          {job.prompt ? "Esperando você" : badge.label}
        </Badge>
        <div className="flex items-center gap-2">
          {job.status === "error" && (
            <Button size="sm" icon={<RotateCw size={14} />} loading={busy} onClick={() => onContinue(job)}>
              Continuar
            </Button>
          )}
          {job.status !== "running" && (
            <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={() => onRemove(job)}>
              Remover
            </Button>
          )}
        </div>
      </div>

      {job.status === "running" && job.prompt && <PromptBox job={job} busy={busy} onReply={onReply} />}

      <ol className="mt-3 flex flex-col gap-1.5">
        {plan.map((def) => {
          const step = steps.get(def.key);
          return (
            <li key={def.key} className="flex items-start gap-2 text-sm">
              <StepIcon status={step?.status} />
              <span className="min-w-0 text-ink">
                {def.label}
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

/** O que o agente pediu: o código do Gmail, ou "resolva a tela e continue". */
function PromptBox({ job, busy, onReply }: { job: EmulatorJob; busy: boolean; onReply: JobRowProps["onReply"] }) {
  const [code, setCode] = React.useState("");
  const prompt = job.prompt;
  if (!prompt) return null;

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-warning-soft p-3">
      <p className="text-sm text-ink">{prompt.texto}</p>
      {prompt.tipo === "codigo" ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) onReply(job, code.trim());
          }}
        >
          <div className="w-40">
            <Input
              aria-label="Código do Gmail"
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
            />
          </div>
          <Button type="submit" size="md" icon={<Send size={14} />} loading={busy} disabled={!code.trim()}>
            Enviar código
          </Button>
        </form>
      ) : (
        <div>
          <Button size="sm" loading={busy} onClick={() => onReply(job, "continuar")}>
            Já resolvi, continuar
          </Button>
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: string | undefined }) {
  const cls = "mt-0.5 shrink-0";
  if (status === "done") return <CheckCircle2 size={15} className={cn(cls, "text-success")} />;
  if (status === "running") return <Loader2 size={15} className={cn(cls, "animate-spin text-accent")} />;
  if (status === "error") return <XCircle size={15} className={cn(cls, "text-danger")} />;
  return <Circle size={15} className={cn(cls, "text-ink-3")} />;
}
