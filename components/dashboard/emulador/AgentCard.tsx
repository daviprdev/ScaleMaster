"use client";

import * as React from "react";
import { Activity, AlertTriangle, AppWindow, FilePen, Loader2, Pencil, Play, Plus, Power, PowerOff, Smartphone, Unplug, UserPlus } from "lucide-react";
import { Badge, Banner, Button, Card, Dialog, EmptyState, IconButton, Input, type BadgeTone } from "@/components/ui";
import { PC_INDEX } from "@/lib/emulador/payload";
import { isRegistro, type EmulatorJob } from "@/lib/emulador/jobs";
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

/** Link que agente-mumu/instalar-botao.ps1 registra no PC: sobe o agente sem janela. */
const START_AGENT_URL = "scalemaster-agente:iniciar";
/** Passou disso sem ficar Online, o botão Iniciar agente explica como instalar o link. */
const START_WAIT_MS = 30_000;

export type SendCommand = (
  agent: EmulatorAgent,
  index: number,
  action: CommandAction,
  extra?: { task?: string; params?: Record<string, unknown> }
) => void;

interface AgentCardProps {
  agent: EmulatorAgent;
  latest: ReadonlyMap<string, EmulatorCommand>;
  /** Instâncias com pedido saindo agora (botão em loading). */
  sending: ReadonlySet<string>;
  now: number;
  onCommand: SendCommand;
  onDisconnect: (agent: EmulatorAgent) => void;
  /** Aviso em vermelho por índice de instância (conta travada pedindo telefone). */
  alerts?: ReadonlyMap<number, string>;
  /** Conta de cada instância (para o Editar dados na linha). */
  linked?: ReadonlyMap<number, EmulatorJob>;
  onEditJob?: (agent: EmulatorAgent, job: EmulatorJob) => void;
  /** Editar dados numa instância sem conta do sistema (anota os dados da que já está nela). */
  onRegister?: (agent: EmulatorAgent, instance: EmulatorInstance) => void;
  /** Criar conta numa instância que já existe e não tem conta ligada. */
  onCreateHere?: (agent: EmulatorAgent, instance: EmulatorInstance) => void;
  /** Instâncias com algo na fila ou rodando (sem Criar conta aqui nem Atividade). */
  queued?: ReadonlySet<number>;
  /** Abre a janela Atividade (aquecer, foto, story); ausente = SQL da atividade ainda não aplicado. */
  onAtividade?: (agent: EmulatorAgent, instance: EmulatorInstance) => void;
  /** Abre o formulário Criar instância; ausente = SQL da fila ainda não aplicado. */
  onCreateInstance?: (agent: EmulatorAgent) => void;
}

/** Um PC conectado: estado do agente e as instâncias do MuMu dele. */
export function AgentCard({
  agent,
  latest,
  sending,
  now,
  onCommand,
  onDisconnect,
  alerts,
  linked,
  onEditJob,
  onRegister,
  onCreateHere,
  queued,
  onAtividade,
  onCreateInstance,
}: AgentCardProps) {
  const [taskFor, setTaskFor] = React.useState<EmulatorInstance | null>(null);
  const [renaming, setRenaming] = React.useState<EmulatorInstance | null>(null);
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const neverSeen = !agent.lastSeenAt;
  const starting = !agent.online && startedAt !== null && now - startedAt < START_WAIT_MS;
  const startFailed = !agent.online && startedAt !== null && !starting;
  React.useEffect(() => {
    if (agent.online) setStartedAt(null);
  }, [agent.online]);
  const pcKey = instanceKey(agent.id, PC_INDEX);
  const pcCommand = latest.get(pcKey);
  const pcSending = sending.has(pcKey);
  // Toda instância tem Editar dados: com conta, abre a dela (rodando, só para ver); sem, anota os dados.
  const editDataFor = (inst: EmulatorInstance) => {
    const job = linked?.get(inst.index);
    if (job) return onEditJob ? () => onEditJob(agent, job) : undefined;
    return onRegister ? () => onRegister(agent, inst) : undefined;
  };

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
          {!agent.online && !neverSeen && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Power size={14} />}
              loading={starting}
              onClick={() => {
                setStartedAt(Date.now());
                window.location.href = START_AGENT_URL;
              }}
            >
              {starting ? "Iniciando…" : "Iniciar agente"}
            </Button>
          )}
          {onCreateInstance && (
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={neverSeen || agent.instances.length === 0}
              onClick={() => onCreateInstance(agent)}
            >
              Criar instância
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={<AppWindow size={14} />}
            loading={pcSending}
            disabled={!agent.online || pcSending || isActive(pcCommand)}
            onClick={() => onCommand(agent, PC_INDEX, "launch")}
          >
            Abrir MuMu
          </Button>
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
          {startFailed && (
            <Banner tone="warning">
              O agente não subiu. O botão só funciona no PC do MuMu e precisa ser instalado uma vez: na pasta{" "}
              <span className="font-mono">agente-mumu</span>, rode{" "}
              <span className="font-mono">powershell -ExecutionPolicy Bypass -File instalar-botao.ps1</span>.
            </Banner>
          )}
          {agent.mumuError && <Banner tone="warning">{agent.mumuError}</Banner>}
          <CommandLine command={pcCommand} agent={agent} now={now} />
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
                // Fora da #0 (a padrão de onde as cópias saem) e sem nada na fila nela.
                const livre = inst.index !== 0 && !queued?.has(inst.index);
                const conta = linked?.get(inst.index);
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
                    onRename={() => setRenaming(inst)}
                    alert={inst.alert ?? alerts?.get(inst.index)}
                    onEditData={editDataFor(inst)}
                    onCreateHere={
                      // Dados só anotados não contam como conta criada pelo sistema.
                      onCreateHere && livre && (!conta || isRegistro(conta)) ? () => onCreateHere(agent, inst) : undefined
                    }
                    onAtividade={onAtividade && livre ? () => onAtividade(agent, inst) : undefined}
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
                  if (taskFor) onCommand(agent, taskFor.index, "task", { task: t.name });
                  setTaskFor(null);
                }}
              >
                Rodar
              </Button>
            </li>
          ))}
        </ul>
      </Dialog>

      <RenameDialog
        instance={renaming}
        onClose={() => setRenaming(null)}
        onSave={(inst, nome) => onCommand(agent, inst.index, "rename", { params: { nome } })}
      />
    </Card>
  );
}

/** Troca o nome da instância no MuMu (o agente roda MuMuManager rename). */
function RenameDialog({
  instance,
  onClose,
  onSave,
}: {
  instance: EmulatorInstance | null;
  onClose: () => void;
  onSave: (instance: EmulatorInstance, nome: string) => void;
}) {
  const [nome, setNome] = React.useState("");
  React.useEffect(() => {
    if (instance) setNome(instance.name);
  }, [instance]);

  return (
    <Dialog open={!!instance} onClose={onClose} title="Editar nome" description="O nome muda aqui e no MuMu.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (instance && nome.trim()) onSave(instance, nome.trim());
          onClose();
        }}
      >
        <Input
          label="Nome da instância"
          value={nome}
          maxLength={40}
          onChange={(e) => setNome(e.target.value)}
          hint="Letras, números, espaço, ponto, _ ou -."
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!nome.trim() || nome.trim() === instance?.name}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
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
  onRename: () => void;
  alert?: string;
  /** Abre Editar dados da conta desta instância (ou anota os dados, se ela não tem conta do sistema). */
  onEditData?: () => void;
  /** Abre Criar conta aqui (instância sem conta ligada). */
  onCreateHere?: () => void;
  /** Abre a janela Estruturar desta instância. */
  onAtividade?: () => void;
}

function InstanceRow({
  agent,
  instance,
  command,
  sending,
  now,
  onCommand,
  onPickTask,
  onRename,
  alert,
  onEditData,
  onCreateHere,
  onAtividade,
}: InstanceRowProps) {
  const busy = sending || isActive(command);
  const disabled = busy || !agent.online;
  const badge = STATE_BADGE[instance.state];
  const off = instance.state === "off";

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-ink">{instance.name}</span>
          <span className="font-mono text-xs text-ink-3">#{instance.index}</span>
          <IconButton
            size="sm"
            icon={<Pencil size={13} />}
            aria-label={`Editar o nome de ${instance.name}`}
            title="Editar nome"
            disabled={disabled}
            onClick={onRename}
            className="h-6 w-6"
          />
          {alert && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-danger">
              <AlertTriangle size={13} className="shrink-0" />
              {alert}
            </span>
          )}
        </div>
        <CommandLine command={command} agent={agent} now={now} />
      </div>
      <Badge tone={badge.tone} dot>
        {badge.label}
      </Badge>
      <div className="flex items-center gap-2">
        {onEditData && (
          <Button variant="secondary" size="sm" icon={<FilePen size={14} />} onClick={onEditData}>
            Editar dados
          </Button>
        )}
        {onCreateHere && (
          <Button variant="secondary" size="sm" icon={<UserPlus size={14} />} disabled={disabled} onClick={onCreateHere}>
            Criar conta aqui
          </Button>
        )}
        {onAtividade && (
          <Button variant="secondary" size="sm" icon={<Activity size={14} />} disabled={disabled} onClick={onAtividade}>
            Estruturar
          </Button>
        )}
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
