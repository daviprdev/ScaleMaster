"use client";

import * as React from "react";
import { Check, Copy, HardDriveDownload, Plus, Power, PowerOff, Server, Unplug } from "lucide-react";
import { Badge, Banner, Button, Card, Dialog, EmptyState, ProgressBar, type BadgeTone } from "@/components/ui";
import type { EmulatorInstance, InstanceState } from "@/lib/emulador/types";
import { timeAgo } from "@/lib/emulador/view";
import type { VpsAgent, VpsJob } from "@/lib/vps/types";

const STATE_BADGE: Record<InstanceState, { tone: BadgeTone; label: string }> = {
  off: { tone: "neutral", label: "Desligado" },
  starting: { tone: "warning", label: "Ligando" },
  on: { tone: "success", label: "Ligado" },
};

interface AgenteVpsCardProps {
  agent: VpsAgent;
  now: number;
  /** Conta de cada container (pelo índice), para mostrar o @ na linha. */
  linked: ReadonlyMap<number, VpsJob>;
  /** Containers com algo na fila ou rodando (sem Abrir/Fechar). */
  queued: ReadonlySet<number>;
  /** Aviso em vermelho por container. */
  alerts: ReadonlyMap<number, string>;
  sending: ReadonlySet<string>;
  onCommand: (agent: VpsAgent, index: number, action: "launch" | "shutdown") => void;
  onLote: (agent: VpsAgent) => void;
  onRebuild: (agent: VpsAgent) => void;
  onDisconnect: (agent: VpsAgent) => void;
  rebuilding: boolean;
}

/** Uma VPS conectada: online/offline, capacidade, RAM usada, Rebuild imagem e os containers dela. */
export function AgenteVpsCard({ agent, now, linked, queued, alerts, sending, onCommand, onLote, onRebuild, onDisconnect, rebuilding }: AgenteVpsCardProps) {
  const cap = agent.capacidade;
  const neverSeen = !agent.lastSeenAt;
  const ramPct = cap.ramTotalMb > 0 ? Math.round((cap.ramUsadaMb / cap.ramTotalMb) * 100) : 0;
  const details = [
    agent.engineVersion ? `Docker ${agent.engineVersion}` : null,
    agent.agentVersion ? `agente ${agent.agentVersion}` : null,
    neverSeen ? "ainda não conectou" : `visto ${timeAgo(agent.lastSeenAt, now)}`,
  ].filter(Boolean);

  return (
    <Card
      title={agent.hostname ?? "VPS nova"}
      description={details.join(" · ")}
      actions={
        <>
          <Badge tone={agent.online ? "success" : "neutral"} dot>
            {agent.online ? "Online" : "Offline"}
          </Badge>
          <Button size="sm" icon={<Plus size={14} />} disabled={neverSeen} onClick={() => onLote(agent)}>
            Enviar lote
          </Button>
          <Button variant="secondary" size="sm" icon={<HardDriveDownload size={14} />} loading={rebuilding} disabled={!agent.online} onClick={() => onRebuild(agent)}>
            Rebuild imagem
          </Button>
          <Button variant="ghost" size="sm" icon={<Unplug size={14} />} onClick={() => onDisconnect(agent)}>
            Desconectar
          </Button>
        </>
      }
    >
      {neverSeen ? (
        <p className="text-sm text-ink-2">
          Esperando o agente. Na VPS, rode <span className="font-mono text-ink">node agente.mjs conectar &lt;código&gt;</span> na pasta{" "}
          <span className="font-mono text-ink">agente-vps</span> (ou <span className="font-mono text-ink">scripts/vps/instalar.sh</span> antes, na primeira vez).
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {agent.engineError && <Banner tone="warning">{agent.engineError}</Banner>}
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Ligados agora" value={`${cap.ligadas} / ${cap.maxLigadas}`} hint="x86: vCPU ÷ 2 · ARM: RAM ÷ 1,4 GB" />
            <Stat label="Cadastros ao mesmo tempo" value={String(cap.maxCadastro)} hint="x86: 1 · ARM: max(2, vCPU ÷ 2)" />
            <Stat label="APKs do Instagram" value={cap.versoesIg.length ? cap.versoesIg.join(", ") : "nenhum"} hint="/opt/scalemaster/apks" />
            <div className="rounded-lg border border-line p-3">
              <p className="text-xs text-ink-3">RAM usada</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {cap.ramTotalMb > 0 ? `${Math.round(cap.ramUsadaMb / 1024)} / ${Math.round(cap.ramTotalMb / 1024)} GB` : "—"}
              </p>
              <ProgressBar value={ramPct} size="sm" className="mt-2" />
            </div>
          </div>
          {agent.instances.length === 0 ? (
            <EmptyState icon={<Server size={18} />} title="Nenhum container" description="A VPS ainda não criou nenhum container de conta." />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {agent.instances.map((inst) => (
                <InstanceRow
                  key={inst.index}
                  agent={agent}
                  instance={inst}
                  conta={linked.get(inst.index)}
                  alert={inst.alert ?? alerts.get(inst.index)}
                  busy={queued.has(inst.index) || sending.has(`${agent.id}:${inst.index}`)}
                  onCommand={onCommand}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-ink-3">{hint}</p>
    </div>
  );
}

function InstanceRow({
  agent,
  instance,
  conta,
  alert,
  busy,
  onCommand,
}: {
  agent: VpsAgent;
  instance: EmulatorInstance;
  conta: VpsJob | undefined;
  alert: string | undefined;
  busy: boolean;
  onCommand: AgenteVpsCardProps["onCommand"];
}) {
  const badge = STATE_BADGE[instance.state];
  const off = instance.state === "off";
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs text-ink-3">ig-{instance.index}</span>
          <span className="truncate text-sm font-medium text-ink">{instance.name}</span>
          {conta && conta.label && conta.label !== instance.name && <span className="text-xs text-ink-2">@{conta.label}</span>}
          {alert && <span className="text-xs font-semibold text-danger">{alert}</span>}
        </div>
      </div>
      <Badge tone={badge.tone} dot>
        {badge.label}
      </Badge>
      <Button
        variant={off ? "primary" : "secondary"}
        size="sm"
        icon={off ? <Power size={14} /> : <PowerOff size={14} />}
        disabled={busy || !agent.online}
        onClick={() => onCommand(agent, instance.index, off ? "launch" : "shutdown")}
      >
        {off ? "Ligar" : "Desligar"}
      </Button>
    </li>
  );
}

/** Gera o código de uma VPS nova e mostra o comando que liga o agente nela. */
export function ConectarVpsDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [token, setToken] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setToken(null);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/vps/agentes", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!res.ok || !body?.token) throw new Error(body?.error ?? "Não foi possível gerar o código. Tente de novo.");
      setToken(body.token);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const command = token ? `node agente.mjs conectar ${token}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não deu para copiar. Selecione o comando e copie com Ctrl+C.");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Conectar uma VPS" description="O agente roda na VPS (Docker + redroid) e liga a máquina ao Scale Master." className="max-w-lg">
      <div className="flex flex-col gap-4">
        {error && <Banner tone="danger">{error}</Banner>}
        {!token ? (
          <>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>
                Na VPS (Ubuntu 24.04, ARM64), rode uma vez <span className="font-mono text-ink">bash scripts/vps/instalar.sh</span> dentro do checkout.
              </li>
              <li>Gere o código aqui e rode o comando que vai aparecer na pasta <span className="font-mono text-ink">agente-vps</span>.</li>
              <li>A VPS aparece nesta aba como Online, com a capacidade e os containers.</li>
            </ol>
            <div className="flex justify-end">
              <Button loading={loading} onClick={() => void generate()}>
                Gerar código
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              Rode na VPS, dentro de <span className="font-mono text-ink">/opt/scalemaster/agente-vps</span>:
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{command}</code>
              <Button variant="secondary" size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()}>
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <Banner tone="warning">O código só aparece agora. Se perder, desconecte essa VPS e gere outro.</Banner>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>
                Pronto
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
