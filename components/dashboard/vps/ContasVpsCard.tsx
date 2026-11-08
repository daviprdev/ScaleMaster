"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2, PauseCircle, RotateCw, Send, Trash2, UserPlus, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, ProgressBar, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/emulador/jobs";
import { timeAgo } from "@/lib/emulador/view";
import { VPS_FLUXO, ehAlertaVps, ehProxyMorta, progresso } from "@/lib/vps/jobs";
import { rotuloAlerta } from "@/lib/vps/painel";
import type { VpsDevice, VpsJob } from "@/lib/vps/types";

const STATUS_BADGE: Record<JobStatus, { tone: BadgeTone; label: string }> = {
  queued: { tone: "neutral", label: "Na fila" },
  running: { tone: "info", label: "Rodando" },
  done: { tone: "success", label: "Conta criada" },
  error: { tone: "danger", label: "Parou" },
};

export type JobAction = "continuar" | "remover" | "pausar" | "despausar";

interface ContasVpsCardProps {
  jobs: readonly VpsJob[];
  devices: ReadonlyMap<string, VpsDevice>;
  /** Contas com pedido saindo agora (botão em loading). */
  busy: ReadonlySet<string>;
  now: number;
  onAction: (job: VpsJob, action: JobAction) => void;
  onReply: (job: VpsJob, resposta: string) => void;
  onEdit: (job: VpsJob) => void;
}

/** Uma linha por conta da VPS: índice do container, @, etapa atual com barra, Continuar, Remover, Pausar proxy e avisos. */
export function ContasVpsCard({ jobs, devices, busy, now, onAction, onReply, onEdit }: ContasVpsCardProps) {
  return (
    <Card
      title="Contas da VPS"
      description="Cada conta roda no seu container redroid com a sua proxy. Até maxCadastro contas cadastram ao mesmo tempo; as outras esperam na fila."
    >
      {jobs.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={18} />}
          title="Nenhuma conta ainda"
          description="Clique em Enviar lote, cole as proxies e preencha as contas; a VPS faz o resto."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} device={devices.get(job.id)} busy={busy.has(job.id)} now={now} onAction={onAction} onReply={onReply} onEdit={onEdit} />
          ))}
        </ul>
      )}
    </Card>
  );
}

interface JobRowProps {
  job: VpsJob;
  device: VpsDevice | undefined;
  busy: boolean;
  now: number;
  onAction: ContasVpsCardProps["onAction"];
  onReply: ContasVpsCardProps["onReply"];
  onEdit: ContasVpsCardProps["onEdit"];
}

function JobRow({ job, device, busy, now, onAction, onReply, onEdit }: JobRowProps) {
  const [aberto, setAberto] = React.useState(false);
  const badge = STATUS_BADGE[job.status];
  const steps = new Map(job.steps.map((s) => [s.key, s]));
  const prog = progresso(job);
  // Avisos de fim de conta (telefone, captcha, proxy morta) em vermelho; o captcha ganha o rótulo próprio.
  const alerta = ehAlertaVps(job.error) || ehProxyMorta(job.error) ? rotuloAlerta(job.error) : null;
  const pausada = job.pausa === "proxy";
  const indice = job.instanceIndex ?? Number(/^ig-(\d+)$/.exec(device?.container ?? "")?.[1] ?? NaN);
  const onde = Number.isFinite(indice) ? `ig-${indice}` : "container a criar";

  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            <span className="font-mono text-xs text-ink-3">{onde}</span> · {job.label ?? "Conta"}
          </p>
          <p className="text-xs text-ink-3">
            {device ? `${device.model} · ${device.serial}` : "sem device"} · {job.versaoIg ? `IG ${job.versaoIg}` : ""} · {timeAgo(job.updatedAt, now)}
          </p>
        </div>
        <Badge tone={job.prompt ? "warning" : pausada ? "warning" : badge.tone} dot>
          {job.prompt ? "Esperando você" : pausada ? "Pausada (proxy)" : badge.label}
        </Badge>
        <div className="flex flex-wrap items-center gap-2">
          {job.status === "error" && !pausada && (
            <Button size="sm" icon={<RotateCw size={14} />} loading={busy} onClick={() => onAction(job, "continuar")}>
              Continuar
            </Button>
          )}
          {job.status !== "running" && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onEdit(job)}>
              Editar
            </Button>
          )}
          {(job.status === "queued" || job.status === "error") && !pausada && (
            <Button variant="secondary" size="sm" icon={<PauseCircle size={14} />} disabled={busy} onClick={() => onAction(job, "pausar")}>
              Pausar proxy
            </Button>
          )}
          {pausada && (
            <Button variant="secondary" size="sm" icon={<PauseCircle size={14} />} disabled={busy} onClick={() => onAction(job, "despausar")}>
              Tirar a pausa
            </Button>
          )}
          {job.status !== "running" && (
            <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={() => onAction(job, "remover")}>
              Remover
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <ProgressBar value={prog.pct} size="sm" />
        </div>
        <button type="button" className="shrink-0 text-xs text-ink-2 hover:text-ink" onClick={() => setAberto((v) => !v)}>
          {prog.label} · {prog.pct}% {aberto ? "▲" : "▼"}
        </button>
      </div>

      {alerta && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-danger">
          <AlertTriangle size={13} className="shrink-0" />
          {alerta}
        </p>
      )}

      {job.status === "running" && job.prompt && <PromptBox job={job} busy={busy} onReply={onReply} />}

      {aberto && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {VPS_FLUXO.map((def) => {
            const step = steps.get(def.key);
            return (
              <li key={def.key} className="flex items-start gap-2 text-sm">
                <StepIcon status={step?.status} />
                <span className="min-w-0 text-ink">
                  {def.label}
                  {step?.message && (
                    <span className={cn("text-xs", step.status === "error" ? "text-danger" : "text-ink-2")}> · {step.message}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {job.status === "error" && job.error && !alerta && <p className="mt-3 text-xs text-danger">{rotuloAlerta(job.error)}</p>}
    </li>
  );
}

/** O que o agente pediu: o código do e-mail (IMAP não achou) ou "resolva e continue". */
function PromptBox({ job, busy, onReply }: { job: VpsJob; busy: boolean; onReply: ContasVpsCardProps["onReply"] }) {
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
              aria-label="Código do e-mail"
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
