"use client";

import * as React from "react";
import { mascaraData } from "@/lib/emulador/view";
import { Plus, Server } from "lucide-react";
import { Banner, Button, ConfirmDialog, Dialog, EmptyState, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import { AgenteVpsCard, ConectarVpsDialog } from "@/components/dashboard/vps/AgenteVpsCard";
import { ContasVpsCard, type JobAction } from "@/components/dashboard/vps/ContasVpsCard";
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
  const [connectOpen, setConnectOpen] = React.useState(false);
  const [loteFor, setLoteFor] = React.useState<VpsAgent | null>(null);
  const [disconnecting, setDisconnecting] = React.useState<VpsAgent | null>(null);
  const [disconnectBusy, setDisconnectBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<VpsJob | null>(null);
  const [editing, setEditing] = React.useState<VpsJob | null>(null);
  const [refazendo, setRefazendo] = React.useState<VpsJob | null>(null);
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

  const sendCommand = async (agent: VpsAgent, index: number, action: "launch" | "shutdown") => {
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
          {data.jobsAvailable && <ProgressoLotePanel jobs={data.jobs} />}
          {data.agents.map((agent) => {
            const jobs = data.jobs.filter((j) => j.agentId === agent.id);
            return (
              <React.Fragment key={agent.id}>
                <AgenteVpsCard
                  agent={agent}
                  now={now}
                  linked={linkedJobs(jobs, agent.id, agent.instances)}
                  queued={busyInstances(jobs, agent.id)}
                  alerts={instanceAlerts(jobs, agent.id, agent.instances)}
                  sending={sending}
                  onCommand={(a, index, action) => void sendCommand(a, index, action)}
                  onLote={setLoteFor}
                  onRebuild={(a) => void rebuild(a)}
                  onDisconnect={setDisconnecting}
                  rebuilding={rebuilding.has(agent.id)}
                />
                {data.jobsAvailable && agent.lastSeenAt && (
                  <ContasVpsCard
                    jobs={jobs}
                    devices={devices}
                    busy={jobBusy}
                    now={now}
                    onAction={(job, action) => (action === "remover" ? setRemoving(job) : action === "refazer" ? setRefazendo(job) : void jobRequest(job, action))}
                    onReply={(job, resposta) => void jobRequest(job, "responder", resposta)}
                    onEdit={setEditing}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <LoteDialog agent={loteFor} onClose={() => setLoteFor(null)} onSaved={() => void load()} />
      <EditarContaDialog job={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <RefazerContaDialog job={refazendo} onClose={() => setRefazendo(null)} onSaved={() => void load()} />
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
