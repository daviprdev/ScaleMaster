"use client";

import * as React from "react";
import { Loader2, Play, Power, PowerOff, Smartphone, Unplug } from "lucide-react";
import { Badge, Banner, Button, Card, Dialog, EmptyState, type BadgeTone } from "@/components/ui";
import type { CommandAction, EmulatorAgent, EmulatorCommand, EmulatorInstance, InstanceState } from "@/lib/emulador/types";
import {
  RECENT_OUTCOME_MS,
  activeText,
  instanceKey,
  isActive,
  resultPairs,
  taskLabel,
  timeAgo,
} from "@/lib/emulador/view";

const STATE_BADGE: Record<InstanceState, { tone: BadgeTone; label: string }> = {
  off: { tone: "neutral", label: "Desligada" },
  starting: { tone: "warning", label: "Ligando" },
  on: { tone: "success", label: "Ligada" },
};

export type SendCommand = (agent: EmulatorAgent, index: number, action: CommandAction, task?: string) => void;

interface AgentCardProps {
  agent: EmulatorAgent;
  latest: ReadonlyMap<string, EmulatorCommand>;
  /** Instâncias com pedido saindo agora (botão em loading). */
  sending: ReadonlySet<string>;
  now: number;
  onCommand: SendCommand;
  onDisconnect: (agent: EmulatorAgent) => void;
}

/** Um PC conectado: estado do agente e as instâncias do MuMu dele. */
export function AgentCard({ agent, latest, sending, now, onCommand, onDisconnect }: AgentCardProps) {
  const [taskFor, setTaskFor] = React.useState<EmulatorInstance | null>(null);
  const neverSeen = !agent.lastSeenAt;

  const details = [
    agent.mumuVersion ? `MuMu ${agent.mumuVersion}` : null,
    agent.agentVersion ? `agente ${agent.agentVersion}` : null,
    neverSeen ? "ainda não conectou" : `visto ${timeAgo(agent.lastSeenAt, now)}`,
  ].filter(Boolean);

  return (
    <Card
      title={agent.hostname ?? "PC novo"}
      description={details.join(" · ")}
      actions={
        <>
          <Badge tone={agent.online ? "success" : "neutral"} dot>
            {agent.online ? "Online" : "Offline"}
          </Badge>
          <Button variant="ghost" size="sm" icon={<Unplug size={14} />} onClick={() => onDisconnect(agent)}>
            Desconectar
          </Button>
        </>
      }
    >
      {neverSeen ? (
        <p className="text-sm text-ink-2">
          Esperando o agente. No PC, rode <span className="font-mono text-ink">node agente.mjs conectar &lt;código&gt;</span>{" "}
          na pasta <span className="font-mono text-ink">agente-mumu</span>.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {agent.mumuError && <Banner tone="warning">{agent.mumuError}</Banner>}
          {agent.instances.length === 0 ? (
            <EmptyState
              icon={<Smartphone size={18} />}
              title="Nenhuma instância"
              description="O agente não encontrou instâncias no MuMu desse PC."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {agent.instances.map((inst) => {
                const key = instanceKey(agent.id, inst.index);
                return (
                  <InstanceRow
                    key={key}
                    agent={agent}
                    instance={inst}
                    command={latest.get(key)}
                    sending={sending.has(key)}
                    now={now}
                    onCommand={onCommand}
                    onPickTask={() => setTaskFor(inst)}
                  />
                );
              })}
            </ul>
          )}
        </div>
      )}

      <Dialog
        open={!!taskFor}
        onClose={() => setTaskFor(null)}
        title="Rodar automação"
        description={taskFor ? `Na instância ${taskFor.name}. Se ela estiver desligada, o agente abre antes.` : undefined}
      >
        <ul className="flex flex-col gap-2">
          {agent.tasks.map((t) => (
            <li key={t.name} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{t.label}</p>
                {t.description && <p className="text-xs text-ink-2">{t.description}</p>}
              </div>
              <Button
                size="sm"
                icon={<Play size={14} />}
                onClick={() => {
                  if (taskFor) onCommand(agent, taskFor.index, "task", t.name);
                  setTaskFor(null);
                }}
              >
                Rodar
              </Button>
            </li>
          ))}
        </ul>
      </Dialog>
    </Card>
  );
}

interface InstanceRowProps {
  agent: EmulatorAgent;
  instance: EmulatorInstance;
  command: EmulatorCommand | undefined;
  sending: boolean;
  now: number;
  onCommand: SendCommand;
  onPickTask: () => void;
}

function InstanceRow({ agent, instance, command, sending, now, onCommand, onPickTask }: InstanceRowProps) {
  const busy = sending || isActive(command);
  const disabled = busy || !agent.online;
  const badge = STATE_BADGE[instance.state];
  const off = instance.state === "off";

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{instance.name}</span>
          <span className="font-mono text-xs text-ink-3">#{instance.index}</span>
        </div>
        <CommandLine command={command} agent={agent} now={now} />
      </div>
      <Badge tone={badge.tone} dot>
        {badge.label}
      </Badge>
      <div className="flex items-center gap-2">
        {agent.tasks.length > 0 && (
          <Button variant="ghost" size="sm" icon={<Play size={14} />} disabled={disabled} onClick={onPickTask}>
            Automação
          </Button>
        )}
        <Button
          variant={off ? "primary" : "secondary"}
          size="sm"
          icon={off ? <Power size={14} /> : <PowerOff size={14} />}
          loading={sending}
          disabled={disabled}
          onClick={() => onCommand(agent, instance.index, off ? "launch" : "shutdown")}
        >
          {off ? "Abrir" : "Fechar"}
        </Button>
      </div>
    </li>
  );
}

function CommandLine({ command, agent, now }: { command: EmulatorCommand | undefined; agent: EmulatorAgent; now: number }) {
  if (!command) return null;

  if (isActive(command)) {
    return (
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
        <Loader2 size={12} className="animate-spin" />
        {activeText(command, agent.tasks)}
      </p>
    );
  }

  const finished = command.finishedAt ? Date.parse(command.finishedAt) : NaN;
  if (!Number.isFinite(finished) || now - finished > RECENT_OUTCOME_MS) return null;

  if (command.status === "error") {
    return <p className="mt-0.5 text-xs text-danger">{command.error}</p>;
  }
  if (command.action !== "task") return null;

  const pairs = resultPairs(command.result);
  return (
    <p className="mt-0.5 text-xs text-success">
      {taskLabel(command.task, agent.tasks)} concluída
      {pairs.length > 0 && (
        <span className="text-ink-2"> · {pairs.map(([k, v]) => `${k}: ${v}`).join(" · ")}</span>
      )}
    </p>
  );
}
