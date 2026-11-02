"use client";

import * as React from "react";
import { MonitorSmartphone, Plus } from "lucide-react";
import { Banner, Button, ConfirmDialog, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { AgentCard, type SendCommand } from "@/components/dashboard/emulador/AgentCard";
import { AtividadeDialog, type AtividadeTarget } from "@/components/dashboard/emulador/AtividadeDialog";
import { ConnectDialog } from "@/components/dashboard/emulador/ConnectDialog";
import { ContasCard } from "@/components/dashboard/emulador/ContasCard";
import { ContaDialog, type ContaDialogTarget } from "@/components/dashboard/emulador/NovaContaDialog";
import { instanceKey, latestCommandByInstance } from "@/lib/emulador/view";
import { busyInstances, instanceAlerts, isRegistro, linkedJobs, type EmulatorJob } from "@/lib/emulador/jobs";
import type { EmuladorResponse, EmulatorAgent } from "@/lib/emulador/types";

// O agente faz sync a cada ~3 s; a tela acompanha no mesmo ritmo enquanto está visível.
const POLL_MS = 3000;

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/**
 * Aba Emulador: as instâncias do MuMu dos PCs conectados, com abrir/fechar e
 * as automações que o agente do PC sabe rodar. O agente fica em agente-mumu/
 * e o SQL em supabase/emulador_agente.sql.
 */
export default function EmuladorPage() {
  const [data, setData] = React.useState<EmuladorResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [commandError, setCommandError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState<ReadonlySet<string>>(new Set());
  const [connectOpen, setConnectOpen] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState<EmulatorAgent | null>(null);
  const [disconnectBusy, setDisconnectBusy] = React.useState(false);
  const [contaDialog, setContaDialog] = React.useState<ContaDialogTarget>(null);
  const [atividade, setAtividade] = React.useState<AtividadeTarget>(null);
  const [jobBusy, setJobBusy] = React.useState<ReadonlySet<string>>(new Set());
  const [removingJob, setRemovingJob] = React.useState<EmulatorJob | null>(null);
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/emulador", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível ler o emulador. Tente de novo."));
      setData((await res.json()) as EmuladorResponse);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const sendCommand: SendCommand = async (agent, index, action, extra) => {
    const key = instanceKey(agent.id, index);
    if (sending.has(key)) return;
    setCommandError(null);
    setSending((s) => new Set(s).add(key));
    try {
      const res = await fetch("/api/emulador/comandos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, instanceIndex: index, action, task: extra?.task, params: extra?.params }),
      });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível enviar o comando. Tente de novo."));
      await load();
    } catch (e) {
      setCommandError((e as Error).message);
    } finally {
      setSending((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  };

  const disconnect = async () => {
    if (!disconnecting) return;
    setDisconnectBusy(true);
    try {
      const res = await fetch(`/api/emulador/agentes/${encodeURIComponent(disconnecting.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível desconectar. Tente de novo."));
      setDisconnecting(null);
      await load();
    } catch (e) {
      setCommandError((e as Error).message);
      setDisconnecting(null);
    } finally {
      setDisconnectBusy(false);
    }
  };

  /** Continuar, responder (código do Gmail / "continuar") ou remover uma conta da fila. */
  const jobRequest = async (job: EmulatorJob, kind: "continuar" | "remover" | "responder", resposta?: string) => {
    if (jobBusy.has(job.id)) return;
    setCommandError(null);
    setJobBusy((s) => new Set(s).add(job.id));
    try {
      const base = `/api/emulador/contas/${encodeURIComponent(job.id)}`;
      const res =
        kind === "remover"
          ? await fetch(base, { method: "DELETE" })
          : await fetch(`${base}/${kind}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(kind === "responder" ? { resposta } : {}),
            });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível salvar. Tente de novo."));
      await load();
    } catch (e) {
      setCommandError((e as Error).message);
    } finally {
      setJobBusy((s) => {
        const next = new Set(s);
        next.delete(job.id);
        return next;
      });
    }
  };

  const latest = React.useMemo(() => latestCommandByInstance(data?.commands ?? []), [data]);
  const now = Date.now();
  const canConnect = !!data?.available;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Automação"
        title="Emulador"
        description="As instâncias do MuMu do seu PC. Abra, feche e rode automações daqui."
        actions={
          canConnect && data.agents.length > 0 ? (
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setConnectOpen(true)}>
              Conectar outro PC
            </Button>
          ) : undefined
        }
      />

      {error && !data ? (
        <Banner
          tone="danger"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Tentar de novo
            </Button>
          }
        >
          {error}
        </Banner>
      ) : !data ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando o emulador">
          <Skeleton height="56px" />
          <Skeleton height="220px" />
        </div>
      ) : !data.available ? (
        <Banner tone="warning">
          Para usar esta aba falta aplicar o SQL <span className="font-mono">supabase/emulador_agente.sql</span> no
          Supabase.
        </Banner>
      ) : data.agents.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphone size={18} />}
          title="Nenhum PC conectado"
          description="Conecte o PC onde está o MuMu para ver as instâncias aqui."
          action={
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setConnectOpen(true)}>
              Conectar um PC
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {error && <Banner tone="warning">{error}</Banner>}
          {commandError && (
            <Banner tone="danger" onClose={() => setCommandError(null)}>
              {commandError}
            </Banner>
          )}
          {!data.jobsAvailable && (
            <Banner tone="warning">
              Para Criar instância e Editar nome falta aplicar o SQL <span className="font-mono">supabase/emulador_contas.sql</span> no
              Supabase.
            </Banner>
          )}
          {data.jobsAvailable && !data.atividadeAvailable && (
            <Banner tone="warning">
              Para o botão Estruturar falta aplicar o SQL <span className="font-mono">supabase/emulador_atividade.sql</span> no Supabase.
            </Banner>
          )}
          {data.agents.map((agent) => {
            const jobs = data.jobs.filter((j) => j.agentId === agent.id);
            const atividades = jobs.filter((j) => j.kind === "atividade");
            const cardProps = {
              busy: jobBusy,
              now,
              onContinue: (job: EmulatorJob) => void jobRequest(job, "continuar"),
              onRemove: setRemovingJob,
              onReply: (job: EmulatorJob, resposta: string) => void jobRequest(job, "responder", resposta),
            };
            return (
              <React.Fragment key={agent.id}>
                <AgentCard
                  agent={agent}
                  latest={latest}
                  sending={sending}
                  now={now}
                  onCommand={sendCommand}
                  onDisconnect={setDisconnecting}
                  onCreateInstance={data.jobsAvailable ? (a) => setContaDialog({ agent: a }) : undefined}
                  alerts={instanceAlerts(data.jobs, agent.id, agent.instances)}
                  linked={linkedJobs(data.jobs, agent.id, agent.instances)}
                  onEditJob={(a, job) => setContaDialog({ agent: a, job })}
                  onRegister={data.jobsAvailable ? (a, instance) => setContaDialog({ agent: a, instance, registrar: true }) : undefined}
                  onCreateHere={data.jobsAvailable ? (a, instance) => setContaDialog({ agent: a, instance }) : undefined}
                  queued={busyInstances(data.jobs, agent.id)}
                  onAtividade={data.atividadeAvailable ? (a, instance) => setAtividade({ agent: a, instance }) : undefined}
                />
                {data.jobsAvailable && agent.lastSeenAt && (
                  <ContasCard kind="nova-conta" jobs={jobs.filter((j) => j.kind === "nova-conta" && !isRegistro(j))} {...cardProps} />
                )}
                {atividades.length > 0 && <ContasCard kind="atividade" jobs={atividades} {...cardProps} />}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <ContaDialog target={contaDialog} onClose={() => setContaDialog(null)} onSaved={() => void load()} />
      <AtividadeDialog target={atividade} onClose={() => setAtividade(null)} onSaved={() => void load()} />

      <ConfirmDialog
        open={!!removingJob}
        onClose={() => setRemovingJob(null)}
        onConfirm={() => {
          if (removingJob) void jobRequest(removingJob, "remover");
          setRemovingJob(null);
        }}
        title={removingJob?.kind === "atividade" ? "Remover esta estruturação da lista?" : "Remover esta conta da lista?"}
        description={
          removingJob?.kind === "atividade"
            ? "Sai da lista e da fila, e as mídias dela são apagadas. O que já foi feito no Instagram fica."
            : "Sai da lista e da fila. A instância que já foi criada continua no MuMu."
        }
        confirmLabel="Remover"
      />

      <ConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} onCreated={() => void load()} />

      <ConfirmDialog
        open={!!disconnecting}
        onClose={() => setDisconnecting(null)}
        onConfirm={() => void disconnect()}
        loading={disconnectBusy}
        title="Desconectar este PC?"
        description="O código dele para de valer na hora. Para voltar, gere um código novo e rode o agente de novo."
        confirmLabel="Desconectar"
      />
    </div>
  );
}
