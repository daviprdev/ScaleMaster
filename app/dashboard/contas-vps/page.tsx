"use client";

import * as React from "react";
import { mascaraData } from "@/lib/emulador/view";
import { Plus, Server } from "lucide-react";
import { Banner, Button, ConfirmDialog, Dialog, EmptyState, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import { AgenteVpsCard, ConectarVpsDialog } from "@/components/dashboard/vps/AgenteVpsCard";
import { ContasVpsCard, type EstruturaAction, type JobAction } from "@/components/dashboard/vps/ContasVpsCard";
import { EstruturarDialog, type PastaOpcao } from "@/components/dashboard/vps/EstruturarDialog";
import { PastaCampo } from "@/components/dashboard/vps/PastaCampo";
import { MidiaPicker, useMidiasDaVps } from "@/components/dashboard/vps/MidiaPicker";
import { SEM_PASTA, elegiveisDaPasta, pastasDasContas } from "@/lib/vps/pastas";
import { prontidaoDaConta } from "@/lib/vps/estruturacao";
import { LoteDialog } from "@/components/dashboard/vps/LoteDialog";
import { ProgressoLotePanel } from "@/components/dashboard/vps/ProgressoLotePanel";
import { parseLinhaPortal, parseProxy } from "@/lib/vps/input";
import { ROTULOS_EMAIL } from "@/lib/vps/provedores";
import { busyInstances, instanceAlerts, linkedJobs } from "@/lib/vps/jobs";
import { PROVEDORES_EMAIL, type ProvedorEmail, type VpsAgent, type VpsJob, type VpsResponse } from "@/lib/vps/types";

// O agente faz sync a cada ~3 s; a tela acompanha no mesmo ritmo enquanto está visível.
const POLL_MS = 3000;

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/**
 * Aba Contas VPS: as VPSs conectadas (agente-vps/, kind='vps'), a capacidade
 * de cada uma, os containers redroid e a fila de contas. Os PCs do MuMu ficam
 * na aba Emulador. SQL em supabase/vps_contas.sql.
 */
export default function ContasVpsPage() {
  const [data, setData] = React.useState<VpsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  /** Avisos do último lote enviado (mesma proxy com outro usuário): não bloquearam. */
  const [avisos, setAvisos] = React.useState<string[]>([]);
  const [connectOpen, setConnectOpen] = React.useState(false);
  const [loteFor, setLoteFor] = React.useState<VpsAgent | null>(null);
  const [disconnecting, setDisconnecting] = React.useState<VpsAgent | null>(null);
  const [disconnectBusy, setDisconnectBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<VpsJob | null>(null);
  const [editing, setEditing] = React.useState<VpsJob | null>(null);
  const [refazendo, setRefazendo] = React.useState<VpsJob | null>(null);
  const [estruturando, setEstruturando] = React.useState<VpsJob | null>(null);
  /** Lixeira da lista de containers sem conta no SaaS: apaga só o container. */
  const [excluindoContainer, setExcluindoContainer] = React.useState<{ agent: VpsAgent; index: number; nome: string } | null>(null);
  /** "Estruturar pasta" aberto para esta VPS. */
  const [estruturarPasta, setEstruturarPasta] = React.useState<VpsAgent | null>(null);
  /** Diálogo Mídias (pastas de fotos da VPS). */
  const [midiasAberto, setMidiasAberto] = React.useState(false);
  /** Conta sendo movida de pasta. */
  const [movendo, setMovendo] = React.useState<VpsJob | null>(null);
  /** Pasta sendo renomeada (nome atual). */
  const [renomeando, setRenomeando] = React.useState<string | null>(null);
  /** Pasta aberta na lista de contas (nome ou SEM_PASTA); "" = na grade de pastas. */
  const [filtroPasta, setFiltroPasta] = React.useState("");
  const aoAbrirPasta = React.useCallback((p: string | null) => setFiltroPasta(p ?? ""), []);
  const [jobBusy, setJobBusy] = React.useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = React.useState<ReadonlySet<string>>(new Set());
  const [rebuilding, setRebuilding] = React.useState<ReadonlySet<string>>(new Set());
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/vps", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Não foi possível ler as contas da VPS. Tente de novo."));
      setData((await res.json()) as VpsResponse);
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

  const withSet = (setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>, key: string, on: boolean) =>
    setter((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const request = async (url: string, init: RequestInit, fallback: string) => {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(await readError(res, fallback));
  };

  const jobRequest = async (job: VpsJob, action: JobAction | "responder", resposta?: string) => {
    if (jobBusy.has(job.id)) return;
    setActionError(null);
    withSet(setJobBusy, job.id, true);
    try {
      const base = `/api/vps/contas/${encodeURIComponent(job.id)}`;
      const json = { headers: { "Content-Type": "application/json" } };
      if (action === "remover") await request(base, { method: "DELETE" }, "Não foi possível remover.");
      else if (action === "continuar") await request(`${base}/continuar`, { method: "POST" }, "Não foi possível continuar.");
      else if (action === "responder") await request(`${base}/responder`, { method: "POST", ...json, body: JSON.stringify({ resposta }) }, "Não foi possível responder.");
      else await request(`${base}/pausar`, { method: "POST", ...json, body: JSON.stringify({ pausar: action === "pausar" }) }, "Não foi possível pausar.");
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      withSet(setJobBusy, job.id, false);
    }
  };

  /** Continuar / Remover da segunda linha do card (a estruturação); a conta não é tocada. */
  const estruturaRequest = async (estrutura: VpsJob, action: EstruturaAction) => {
    if (jobBusy.has(estrutura.id)) return;
    setActionError(null);
    withSet(setJobBusy, estrutura.id, true);
    try {
      const url = `/api/vps/estruturacoes/${encodeURIComponent(estrutura.id)}`;
      if (action === "remover") await request(url, { method: "DELETE" }, "Não foi possível remover a estruturação.");
      else await request(url, { method: "POST" }, "Não foi possível continuar a estruturação.");
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      withSet(setJobBusy, estrutura.id, false);
    }
  };

  const sendCommand = async (agent: VpsAgent, index: number, action: "launch" | "shutdown" | "delete") => {
    const key = `${agent.id}:${index}`;
    if (sending.has(key)) return;
    setActionError(null);
    withSet(setSending, key, true);
    try {
      await request(
        "/api/emulador/comandos",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: agent.id, instanceIndex: index, action }) },
        "Não foi possível enviar o comando."
      );
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      withSet(setSending, key, false);
    }
  };

  const rebuild = async (agent: VpsAgent) => {
    if (rebuilding.has(agent.id)) return;
    setActionError(null);
    withSet(setRebuilding, agent.id, true);
    try {
      await request("/api/vps/imagem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: agent.id }) }, "Não foi possível pedir o rebuild.");
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      withSet(setRebuilding, agent.id, false);
    }
  };

  const disconnect = async () => {
    if (!disconnecting) return;
    setDisconnectBusy(true);
    try {
      await request(`/api/vps/agentes/${encodeURIComponent(disconnecting.id)}`, { method: "DELETE" }, "Não foi possível desconectar.");
      setDisconnecting(null);
      await load();
    } catch (e) {
      setActionError((e as Error).message);
      setDisconnecting(null);
    } finally {
      setDisconnectBusy(false);
    }
  };

  const devices = React.useMemo(() => new Map((data?.devices ?? []).map((d) => [d.jobId, d])), [data]);
  const now = Date.now();
  const pastasOn = data?.pastasAvailable === true;
  const conectadasSaas = React.useMemo(() => new Set(data?.conectadasSaas ?? []), [data]);
  const pastas = React.useMemo(() => pastasDasContas(data?.jobs ?? []), [data]);
  const nomesPastas = React.useMemo(() => pastas.map((p) => p.nome), [pastas]);
  const contasTodas = React.useMemo(() => (data?.jobs ?? []).filter((j) => j.kind === "nova-conta"), [data]);

  /** Estruturação mais nova de cada conta, de todas as VPSs. */
  const estruturasDe = React.useMemo(() => {
    const m = new Map<string, VpsJob>();
    for (const j of data?.jobs ?? []) if (j.kind === "estruturacao" && j.contaId && !m.has(j.contaId)) m.set(j.contaId, j);
    return m;
  }, [data]);

  /** Opções do "Estruturar pasta" de uma VPS: cada pasta (e Sem pasta) com quantas contas entram. */
  const opcoesDaPasta = (agent: VpsAgent): PastaOpcao[] => {
    const daVps = contasTodas.filter((j) => j.agentId === agent.id);
    const nomes = [...new Set(daVps.map((j) => j.pasta ?? null))];
    return nomes
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b, "pt-BR")))
      .map((nome) => ({
        value: nome ?? SEM_PASTA,
        label: nome ?? "Sem pasta",
        elegiveis: elegiveisDaPasta(daVps, nome, (id) => estruturasDe.get(id)).elegiveis.length,
      }));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Automação"
        title="Contas VPS"
        description="Contas do Instagram criadas em containers redroid na VPS, uma proxy por conta, sem emulador de tela."
        actions={
          data?.available && data.agents.length > 0 ? (
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setConnectOpen(true)}>
              Conectar outra VPS
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
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando as contas da VPS">
          <Skeleton height="56px" />
          <Skeleton height="220px" />
        </div>
      ) : !data.available ? (
        <Banner tone="warning">
          Para usar esta aba falta aplicar o SQL <span className="font-mono">supabase/vps_contas.sql</span> no Supabase.
        </Banner>
      ) : data.agents.length === 0 ? (
        <EmptyState
          icon={<Server size={18} />}
          title="Nenhuma VPS conectada"
          description="Conecte a VPS onde roda o Docker com redroid para ver os containers aqui."
          action={
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setConnectOpen(true)}>
              Conectar uma VPS
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {error && <Banner tone="warning">{error}</Banner>}
          {avisos.length > 0 && (
            <Banner tone="warning" onClose={() => setAvisos([])}>
              {avisos.join(" ")}
            </Banner>
          )}
          {actionError && (
            <Banner tone="danger" onClose={() => setActionError(null)}>
              {actionError}
            </Banner>
          )}
          {!data.jobsAvailable && (
            <Banner tone="warning">
              Para a fila de contas falta aplicar o SQL <span className="font-mono">supabase/emulador_contas.sql</span> no Supabase.
            </Banner>
          )}
          {data.jobsAvailable && <ProgressoLotePanel jobs={data.jobs} conectadasSaas={conectadasSaas} />}
          {data.jobsAvailable && !pastasOn && (
            <Banner tone="warning">
              Para as pastas falta aplicar o SQL <span className="font-mono">supabase/vps_pastas.sql</span> no Supabase (SQL Editor).
            </Banner>
          )}

          {data.agents.map((agent) => {
            const jobs = data.jobs.filter((j) => j.agentId === agent.id);
            // Estruturação não é linha própria: a mais nova de cada conta vira a segunda barra do card dela.
            const contas = jobs.filter((j) => j.kind !== "estruturacao");
            const estruturas = new Map<string, VpsJob>();
            for (const j of jobs) if (j.kind === "estruturacao" && j.contaId && !estruturas.has(j.contaId)) estruturas.set(j.contaId, j);
            const ligados = linkedJobs(jobs, agent.id, agent.instances);
            // Selo verde "Conectada no SaaS" na lista de containers: a conta está em Contas do Instagram com token
            // (conectada de verdade), ou o Estruturar terminou sem falha.
            const prontas = new Set(
              [...ligados]
                .filter(([, conta]) => conectadasSaas.has(String(conta.label ?? "").toLowerCase()) || prontidaoDaConta(estruturas.get(conta.id)) === "pronta")
                .map(([indice]) => indice)
            );
            return (
              <React.Fragment key={agent.id}>
                <AgenteVpsCard
                  agent={agent}
                  now={now}
                  linked={ligados}
                  prontas={prontas}
                  queued={busyInstances(jobs, agent.id)}
                  alerts={instanceAlerts(jobs, agent.id, agent.instances)}
                  sending={sending}
                  onCommand={(a, index, action) => void sendCommand(a, index, action)}
                  onExcluir={(a, inst, conta) => (conta ? setRemoving(conta) : setExcluindoContainer({ agent: a, index: inst.index, nome: inst.name }))}
                  onLote={setLoteFor}
                  onEstruturarPasta={pastasOn && data.estruturaAvailable !== false ? setEstruturarPasta : undefined}
                  onMidias={() => setMidiasAberto(true)}
                  onRebuild={(a) => void rebuild(a)}
                  onDisconnect={setDisconnecting}
                  rebuilding={rebuilding.has(agent.id)}
                  ramHost={data.ramHost ?? null}
                />
                {data.jobsAvailable && agent.lastSeenAt && (
                  <ContasVpsCard
                    jobs={contas}
                    estruturas={estruturas}
                    onEstruturar={(job) =>
                      data.estruturaAvailable === false ? setActionError("Falta aplicar o SQL supabase/vps_estruturacao.sql no Supabase.") : setEstruturando(job)
                    }
                    onEstrutura={(estrutura, action) => void estruturaRequest(estrutura, action)}
                    devices={devices}
                    busy={jobBusy}
                    now={now}
                    onAction={(job, action) => (action === "remover" ? setRemoving(job) : action === "refazer" ? setRefazendo(job) : void jobRequest(job, action))}
                    onReply={(job, resposta) => void jobRequest(job, "responder", resposta)}
                    onEdit={setEditing}
                    onPasta={pastasOn ? setMovendo : undefined}
                    pastasOn={pastasOn}
                    conectadasSaas={conectadasSaas}
                    onRenomearPasta={pastasOn ? setRenomeando : undefined}
                    onPastaAberta={aoAbrirPasta}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <LoteDialog
        agent={loteFor}
        onClose={() => setLoteFor(null)}
        onSaved={(avisos) => {
          setAvisos(avisos);
          void load();
        }}
      />
      <EditarContaDialog job={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <RefazerContaDialog job={refazendo} onClose={() => setRefazendo(null)} onSaved={() => void load()} />
      <EstruturarDialog job={estruturando} pastas={pastasOn ? nomesPastas : []} onClose={() => setEstruturando(null)} onSaved={() => void load()} />
      <EstruturarDialog
        job={null}
        pastas={pastasOn ? nomesPastas : []}
        pastaDe={estruturarPasta ? { agent: estruturarPasta, opcoes: opcoesDaPasta(estruturarPasta), inicial: filtroPasta } : null}
        onClose={() => setEstruturarPasta(null)}
        onSaved={(resumo) => {
          setAvisos(resumo ?? []);
          void load();
        }}
      />
      <RenomearPastaDialog pasta={renomeando} onClose={() => setRenomeando(null)} onSaved={() => void load()} />
      <MidiasDialog open={midiasAberto} onClose={() => setMidiasAberto(false)} />
      <MoverPastaDialog job={movendo} pastas={nomesPastas} onClose={() => setMovendo(null)} onSaved={() => void load()} />
      <ConectarVpsDialog open={connectOpen} onClose={() => setConnectOpen(false)} onCreated={() => void load()} />

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void jobRequest(removing, "remover");
          setRemoving(null);
        }}
        title="Remover esta conta?"
        description="Sai da lista e da fila. Se o container já existe, a VPS apaga o container, o volume e o device. A conta do Instagram em si não é apagada. Não dá para desfazer."
        confirmLabel="Remover"
      />

      <ConfirmDialog
        open={!!excluindoContainer}
        onClose={() => setExcluindoContainer(null)}
        onConfirm={() => {
          if (excluindoContainer) void sendCommand(excluindoContainer.agent, excluindoContainer.index, "delete");
          setExcluindoContainer(null);
        }}
        title={`Excluir o container ig-${excluindoContainer?.index ?? ""}?`}
        description={`"${excluindoContainer?.nome ?? ""}" não tem conta no SaaS. A VPS apaga o container, o disco e o aparelho dele, e ele sai desta lista. Não dá para desfazer.`}
        confirmLabel="Excluir"
      />

      <ConfirmDialog
        open={!!disconnecting}
        onClose={() => setDisconnecting(null)}
        onConfirm={() => void disconnect()}
        loading={disconnectBusy}
        title="Desconectar esta VPS?"
        description="O código dela para de valer na hora e as contas da fila somem da aba. Os containers continuam na VPS."
        confirmLabel="Desconectar"
      />
    </div>
  );
}

/** Renomear a pasta: todas as contas dela passam para o nome novo (nome que já existe = junta as duas). */
function RenomearPastaDialog({ pasta, onClose, onSaved }: { pasta: string | null; onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (pasta === null) return;
    setNome(pasta);
    setError(null);
  }, [pasta]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pasta === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/vps/pastas/renomear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ de: pasta, para: nome }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível renomear a pasta.");
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={pasta !== null} onClose={onClose} title="Renomear pasta" description="Todas as contas da pasta passam para o nome novo. Se já existir uma pasta com esse nome, as duas viram uma só." className="max-w-md">
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        <Input label="Nome da pasta" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} autoComplete="off" autoFocus required />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!nome.trim() || nome.trim() === pasta}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Mover a conta de pasta (ou tirar de qualquer pasta); só muda a etiqueta, nada na VPS. */
function MoverPastaDialog({ job, pastas, onClose, onSaved }: { job: VpsJob | null; pastas: ReadonlyArray<string>; onClose: () => void; onSaved: () => void }) {
  const [pasta, setPasta] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!job) return;
    setPasta(job.pasta ?? "");
    setError(null);
  }, [job]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!job) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vps/contas/${encodeURIComponent(job.id)}/pasta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pasta }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível mover de pasta.");
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!job}
      onClose={onClose}
      title={`Pasta de ${job?.label ? `@${job.label}` : "a conta"}`}
      description="Só organiza a lista e o Estruturar pasta: nada muda na VPS."
      className="max-w-md"
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        <PastaCampo pastas={pastas} value={pasta} onChange={setPasta} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Tentar de novo de uma conta descartada: proxy e código do hstock novos; device e pessoa novos saem do servidor. */
function RefazerContaDialog({ job, onClose, onSaved }: { job: VpsJob | null; onClose: () => void; onSaved: () => void }) {
  const [proxy, setProxy] = React.useState("");
  const [codigo, setCodigo] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!job) return;
    setProxy("");
    setCodigo("");
    setError(null);
  }, [job]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!job) return;
    if (!parseProxy(proxy)) return setError("Proxy no formato host:porta:usuário:senha.");
    if (!parseLinhaPortal(codigo)) return setError('Código do hstock no formato "link | código".');
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vps/contas/${encodeURIComponent(job.id)}/refazer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy, codigo }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível refazer.");
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!job}
      onClose={onClose}
      title="Tentar de novo"
      description="A conta descartada sai da lista (container e volume já foram apagados). Uma conta nova entra na fila do mesmo lote, do zero: device, proxy, código do portal e pessoa (nome, @, senha, nascimento) novos."
      className="max-w-lg"
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        <Input label="Proxy nova (HTTP)" placeholder="host:porta:usuário:senha" hint="Opcional: o país no fim (:US)." value={proxy} onChange={(e) => setProxy(e.target.value)} autoComplete="off" required />
        <Input
          label="Código do hstock"
          placeholder="https://hridoyhub.shop/OTP/ | SUDXHRAY"
          hint="Linha inteira, no formato link | código."
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          autoComplete="off"
          className="font-mono"
          required
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Criar conta nova
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface Editavel {
  provedorEmail: ProvedorEmail;
  email: string;
  nome: string;
  usuario: string;
  nascimento: string;
  imapHost: string;
  imapPorta: number;
  proxyHost: string;
  pais: string;
}

const FORM_VAZIO = { proxy: "", provedorEmail: "imap" as ProvedorEmail, email: "", senhaEmail: "", imapHost: "", imapPorta: "", senhaIg: "", nome: "", usuario: "", nascimento: "" };

/**
 * Editar: troca a proxy (tira a pausa e refaz da validação) e/ou os dados da
 * conta. Senhas em branco = manter. Em provedor Portal, o campo E-mail é o
 * link do painel e a senha é o código de resgate (um código por conta).
 */
function EditarContaDialog({ job, onClose, onSaved }: { job: VpsJob | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState(FORM_VAZIO);
  const [atual, setAtual] = React.useState<Editavel | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!job) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setAtual(null);
    // Zera antes de buscar: se o GET falhar, nada da conta anterior sobra no formulário.
    setForm(FORM_VAZIO);
    fetch(`/api/vps/contas/${encodeURIComponent(job.id)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (Editavel & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error ?? "Não foi possível ler os dados da conta.");
        if (!alive) return;
        const provedorEmail = PROVEDORES_EMAIL.some((p) => p.key === body.provedorEmail) ? body.provedorEmail : "imap";
        setAtual({ ...body, provedorEmail });
        setForm({
          proxy: "",
          provedorEmail,
          email: body.email,
          senhaEmail: "",
          imapHost: body.imapHost,
          imapPorta: body.imapPorta ? String(body.imapPorta) : "993",
          senhaIg: "",
          nome: body.nome,
          usuario: body.usuario,
          nascimento: body.nascimento,
        });
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [job]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => {
      const valor = e.target.value;
      // Portal: "link | codigo" colado no campo do link separa em link + código.
      if (key === "email" && f.provedorEmail === "portal" && valor.includes("|")) {
        const lida = parseLinhaPortal(valor);
        if (lida) return { ...f, email: lida.link, senhaEmail: lida.codigo };
      }
      return { ...f, [key]: key === "nascimento" ? mascaraData(valor) : valor };
    });
  // Trocar o provedor zera link/e-mail e senha: o que estava guardado era de outro provedor.
  const trocarProvedor = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provedorEmail = e.target.value as ProvedorEmail;
    setForm((f) => ({
      ...f,
      provedorEmail,
      email: atual && provedorEmail === atual.provedorEmail ? atual.email : "",
      senhaEmail: "",
      imapHost: atual && provedorEmail === "imap" && atual.provedorEmail === "imap" ? atual.imapHost : "",
      imapPorta: "993",
    }));
  };
  const rotulos = ROTULOS_EMAIL[form.provedorEmail];
  const mesmoProvedor = atual?.provedorEmail === form.provedorEmail;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!job || !atual) return;
    setSaving(true);
    setError(null);
    try {
      const { proxy, ...conta } = form;
      const res = await fetch(`/api/vps/contas/${encodeURIComponent(job.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy, conta }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível salvar.");
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!job}
      onClose={onClose}
      title="Editar conta"
      description={
        job?.status === "done"
          ? "Conta já criada: salvar só guarda os dados."
          : "Ao salvar a conta volta para a fila. Proxy nova tira a pausa e refaz da validação da proxy em diante; dados novos refazem o cadastro."
      }
      className="max-w-lg"
    >
      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton height="56px" />
          <Skeleton height="160px" />
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          {error && <Banner tone="danger">{error}</Banner>}
          <Input
            label="Proxy (HTTP)"
            placeholder={atual?.proxyHost ? `atual: ${atual.proxyHost} (${atual.pais})` : "host:porta:usuário:senha"}
            hint="Em branco = mantém a atual. Opcional: o país no fim (:US)."
            value={form.proxy}
            onChange={set("proxy")}
            autoComplete="off"
          />
          <Select
            label="Provedor de e-mail"
            value={form.provedorEmail}
            onChange={trocarProvedor}
            options={PROVEDORES_EMAIL.map((p) => ({ value: p.key, label: p.label }))}
            hint={rotulos.descricao}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={rotulos.email}
              type={form.provedorEmail === "portal" ? "url" : "email"}
              placeholder={rotulos.placeholderEmail || undefined}
              value={form.email}
              onChange={set("email")}
              autoComplete="off"
              required
            />
            <Input
              label={rotulos.senha}
              type={form.provedorEmail === "portal" ? "text" : "password"}
              hint={mesmoProvedor ? `Em branco = mantém. ${rotulos.dicaSenha}` : rotulos.dicaSenha}
              value={form.senhaEmail}
              onChange={set("senhaEmail")}
              autoComplete={form.provedorEmail === "portal" ? "off" : "new-password"}
              className={form.provedorEmail === "portal" ? "font-mono uppercase" : undefined}
              required={!mesmoProvedor && form.provedorEmail !== "manual"}
            />
            {form.provedorEmail === "imap" && (
              <>
                <Input label="Host IMAP" value={form.imapHost} onChange={set("imapHost")} autoComplete="off" />
                <Input label="Porta IMAP" inputMode="numeric" value={form.imapPorta} onChange={set("imapPorta")} autoComplete="off" />
              </>
            )}
            <Input label="Senha do Instagram" type="password" hint="Em branco = mantém." value={form.senhaIg} onChange={set("senhaIg")} autoComplete="new-password" />
            <Input label="Nome completo" value={form.nome} onChange={set("nome")} autoComplete="off" required />
            <Input label="Usuário (opcional)" placeholder="sem @" value={form.usuario} onChange={set("usuario")} autoComplete="off" />
            <Input label="Nascimento" placeholder="dd/mm/aaaa" inputMode="numeric" maxLength={10} value={form.nascimento} onChange={set("nascimento")} autoComplete="off" required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!atual}>
              {job?.status === "done" ? "Salvar" : "Salvar e continuar"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** "Mídias": as pastas de fotos que a VPS usa (perfil = fotos de perfil da criação; as outras, para o story do Estruturar). */
function MidiasDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const biblioteca = useMidiasDaVps(open);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mídias"
      description="Pastas de fotos da VPS. A pasta perfil é a das fotos de perfil da criação de conta; as outras ficam para escolher a foto do story no Estruturar."
      className="max-w-3xl"
    >
      <MidiaPicker midias={biblioteca} error={biblioteca.erro ?? undefined} />
    </Dialog>
  );
}
