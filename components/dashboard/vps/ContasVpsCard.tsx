"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Circle, Contact, Copy, Folder, Layers, Loader2, PauseCircle, RefreshCw, RotateCw, Send, Shield, ShieldAlert, ShieldCheck, Trash2, UserPlus, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, ProgressBar, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ALERTA_ROBO, type JobStatus } from "@/lib/emulador/jobs";
import { timeAgo } from "@/lib/emulador/view";
import { PrintThumb, PrintViewer, type PrintItem } from "./PrintViewer";
import { progressoEstrutura, prontidaoDaConta, resultadoPorAlvo, resumoDosAlvos, type AlvoResultado, type ResultadoAlvo } from "@/lib/vps/estruturacao";
import { VPS_FLUXO, ehAlertaVps, ehDescartada, ehProxyMorta, estadoIsolamento, progresso, type Isolamento } from "@/lib/vps/jobs";
import { rotuloAlerta } from "@/lib/vps/painel";
import type { VpsDevice, VpsJob } from "@/lib/vps/types";

const STATUS_BADGE: Record<JobStatus, { tone: BadgeTone; label: string }> = {
  queued: { tone: "neutral", label: "Na fila" },
  running: { tone: "info", label: "Rodando" },
  done: { tone: "success", label: "Conta criada" },
  error: { tone: "danger", label: "Parou" },
};

export type JobAction = "continuar" | "remover" | "pausar" | "despausar" | "refazer";
export type EstruturaAction = "continuar" | "remover";

interface ContasVpsCardProps {
  jobs: readonly VpsJob[];
  devices: ReadonlyMap<string, VpsDevice>;
  /** Contas com pedido saindo agora (botão em loading). */
  busy: ReadonlySet<string>;
  now: number;
  onAction: (job: VpsJob, action: JobAction) => void;
  onReply: (job: VpsJob, resposta: string) => void;
  onEdit: (job: VpsJob) => void;
  /** Estruturação mais nova de cada conta (id da conta → job kind estruturacao): segunda linha do card. */
  estruturas: ReadonlyMap<string, VpsJob>;
  /** Abre o diálogo Estruturar da conta. */
  onEstruturar: (job: VpsJob) => void;
  onEstrutura: (estrutura: VpsJob, action: EstruturaAction) => void;
  /** Mover a conta de pasta; sem ele (SQL das pastas não aplicado) o botão some. */
  onPasta?: (job: VpsJob) => void;
}

/** Uma linha por conta da VPS: índice do container, @, etapa atual com barra, Continuar, Remover, Pausar proxy e avisos. */
export function ContasVpsCard({ jobs, devices, busy, now, onAction, onReply, onEdit, estruturas, onEstruturar, onEstrutura, onPasta }: ContasVpsCardProps) {
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
            <JobRow
              key={job.id}
              job={job}
              device={devices.get(job.id)}
              busy={busy.has(job.id)}
              now={now}
              onAction={onAction}
              onReply={onReply}
              onEdit={onEdit}
              onPasta={onPasta}
              isolamento={isolamentoDe(job, devices.get(job.id))}
              doLote={jobs.filter((j) => (job.loteId ? j.loteId === job.loteId : j.id === job.id) && !ehDescartada(j)).map((j) => isolamentoDe(j, devices.get(j.id)))}
              estrutura={estruturas.get(job.id)}
              estruturaBusy={busy.has(estruturas.get(job.id)?.id ?? "")}
              onEstruturar={onEstruturar}
              onEstrutura={onEstrutura}
            />
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
  onPasta: ContasVpsCardProps["onPasta"];
  isolamento: Isolamento;
  /** Isolamento de todas as contas vivas do mesmo lote (esta incluída). */
  doLote: readonly Isolamento[];
  estrutura: VpsJob | undefined;
  estruturaBusy: boolean;
  onEstruturar: ContasVpsCardProps["onEstruturar"];
  onEstrutura: ContasVpsCardProps["onEstrutura"];
}

/** IP (identidade da conta), MAC, modelo, serial e Android ID (vps_devices) de uma conta. */
function isolamentoDe(job: VpsJob, device: VpsDevice | undefined): Isolamento {
  return { ip: job.ip ?? null, mac: device?.mac ?? null, modelo: device?.model ?? null, serial: device?.serial ?? null, androidId: device?.androidId ?? null };
}

const ESCUDO = {
  unico: { cor: "text-success", Icone: ShieldCheck, texto: "únicos no lote" },
  repetido: { cor: "text-danger", Icone: ShieldAlert, texto: "valor repetido no lote" },
  neutro: { cor: "text-ink-3", Icone: Shield, texto: "MAC ou outro valor ainda desconhecido" },
} as const;

/**
 * Bloco "Isolamento": IP, MAC, modelo, serial e Android ID da conta. Escudo
 * verde quando os quatro identificadores existem e são únicos no lote,
 * vermelho quando algum repete, neutro (cinza) quando falta algum — container
 * antigo sem MAC conhecido não conta como único.
 */
function IsolamentoBox({ isolamento, doLote }: { isolamento: Isolamento; doLote: readonly Isolamento[] }) {
  const escudo = ESCUDO[estadoIsolamento(isolamento, doLote)];
  const itens: Array<[string, string | null]> = [
    ["IP", isolamento.ip],
    ["MAC", isolamento.mac],
    ["Modelo", isolamento.modelo],
    ["Serial", isolamento.serial],
    ["Android ID", isolamento.androidId],
  ];
  return (
    <div className="mt-3 rounded-lg border border-line p-3">
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", escudo.cor)}>
        <escudo.Icone size={14} className="shrink-0" />
        Isolamento · {escudo.texto}
      </p>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-5">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-ink-3">{rotulo}</dt>
            <dd className="truncate font-mono text-ink" title={valor ?? undefined}>
              {valor ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function JobRow({ job, device, busy, now, onAction, onReply, onEdit, onPasta, isolamento, doLote, estrutura, estruturaBusy, onEstruturar, onEstrutura }: JobRowProps) {
  const [aberto, setAberto] = React.useState(false);
  const [dados, setDados] = React.useState(false);
  const badge = STATUS_BADGE[job.status];
  const steps = new Map(job.steps.map((s) => [s.key, s]));
  const prog = progresso(job);
  // Avisos de fim de conta (telefone, captcha, proxy morta) em vermelho; o captcha ganha o rótulo próprio.
  const alerta = ehAlertaVps(job.error) || ehProxyMorta(job.error) ? rotuloAlerta(job.error) : null;
  const pausada = job.pausa === "proxy";
  // Descartada (captcha ou @ recusado 5 vezes): container e volume já apagados; sem Continuar, só Tentar de novo.
  const descartada = ehDescartada(job);
  const badgeDescartada = job.error === ALERTA_ROBO ? "Captcha — conta descartada" : "@ recusado — conta descartada";
  const indice = job.instanceIndex ?? Number(/^ig-(\d+)$/.exec(device?.container ?? "")?.[1] ?? NaN);
  const onde = Number.isFinite(indice) ? `ig-${indice}` : "container a criar";
  // Estruturar: só em conta criada e sem estruturação na fila ou rodando.
  const estruturaAtiva = estrutura?.status === "queued" || estrutura?.status === "running";
  // Selo verde: estruturada e conectada no SaaS (pronta para postar), ou só conectada.
  const prontidao = prontidaoDaConta(estrutura);

  return (
    <li className={cn("rounded-lg border p-4", prontidao === "pronta" ? "border-success" : "border-line")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            <span className="font-mono text-xs text-ink-3">{onde}</span> · {job.label ?? "Conta"}
          </p>
          <p className="text-xs text-ink-3">
            {device ? `${device.model} · ${device.serial}` : "sem device"} · {job.versaoIg ? `IG ${job.versaoIg}` : ""} · {timeAgo(job.updatedAt, now)}
          </p>
          {onPasta && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-3">
              <Folder size={12} />
              {job.pasta ?? "Sem pasta"}
            </p>
          )}
        </div>
        <Badge tone={job.prompt ? "warning" : pausada ? "warning" : descartada ? "danger" : badge.tone} dot>
          {job.prompt ? "Esperando você" : pausada ? "Pausada (proxy)" : descartada ? badgeDescartada : badge.label}
        </Badge>
        {prontidao && (
          <Badge tone="success">
            <CheckCircle2 size={12} className="mr-1 inline" />
            {prontidao === "pronta" ? "Conectada · pronta para postar" : "Conectada"}
          </Badge>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {descartada && (
            <Button size="sm" icon={<RefreshCw size={14} />} loading={busy} onClick={() => onAction(job, "refazer")}>
              Tentar de novo
            </Button>
          )}
          {job.status === "error" && !pausada && !descartada && (
            <Button size="sm" icon={<RotateCw size={14} />} loading={busy} onClick={() => onAction(job, "continuar")}>
              Continuar
            </Button>
          )}
          {job.status === "done" && !estruturaAtiva && (
            <Button size="sm" icon={<Layers size={14} />} disabled={busy} onClick={() => onEstruturar(job)}>
              Estruturar
            </Button>
          )}
          {onPasta && !descartada && (
            <Button variant="secondary" size="sm" icon={<Folder size={14} />} disabled={busy} onClick={() => onPasta(job)}>
              Pasta
            </Button>
          )}
          {job.status !== "running" && !descartada && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onEdit(job)}>
              Editar
            </Button>
          )}
          <Button variant="secondary" size="sm" icon={<Contact size={14} />} onClick={() => setDados((v) => !v)}>
            {dados ? "Ocultar informações" : "Informações"}
          </Button>
          {(job.status === "queued" || job.status === "error") && !pausada && !descartada && (
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

      {!descartada && <IsolamentoBox isolamento={isolamento} doLote={doLote} />}

      {dados && <InformacoesBox jobId={job.id} />}

      {aberto && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {VPS_FLUXO.map((def) => {
            const step = steps.get(def.key);
            return (
              <li key={def.key} className="flex items-center gap-2 text-sm">
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

      {estrutura && <EstruturaLinha estrutura={estrutura} busy={estruturaBusy} now={now} onEstrutura={onEstrutura} />}
    </li>
  );
}

const ESTRUTURA_BADGE: Record<JobStatus, { tone: BadgeTone; label: string }> = {
  queued: { tone: "neutral", label: "Na fila" },
  running: { tone: "info", label: "Estruturando" },
  done: { tone: "success", label: "Estruturada" },
  error: { tone: "danger", label: "Parou" },
};

/**
 * Segunda linha do card: a estruturação da conta, com a barra e a checklist
 * montadas do array de etapas do próprio job (expandido por alvo) e a
 * miniatura do print de cada etapa. Falha aqui não muda o status da conta.
 */
function EstruturaLinha({ estrutura, busy, now, onEstrutura }: { estrutura: VpsJob; busy: boolean; now: number; onEstrutura: ContasVpsCardProps["onEstrutura"] }) {
  const [aberto, setAberto] = React.useState(false);
  const [ampliado, setAmpliado] = React.useState<string | null>(null);
  const plano = estrutura.plano ?? [];
  const steps = new Map(estrutura.steps.map((s) => [s.key, s]));
  const prog = progressoEstrutura({ plano, steps: estrutura.steps, status: estrutura.status });
  const agenda = estrutura.agendadoPara ? Date.parse(estrutura.agendadoPara) : NaN;
  const agendada = estrutura.status === "queued" && Number.isFinite(agenda) && agenda > now;
  const badge = agendada
    ? { tone: "neutral" as BadgeTone, label: `Agendada · ${new Date(agenda).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` }
    : ESTRUTURA_BADGE[estrutura.status];
  const print = (key: string) => `/api/vps/estruturacoes/${encodeURIComponent(estrutura.id)}/prints/${key}`;
  const alvos = resultadoPorAlvo(plano, estrutura.steps);
  // Etapas com print (concluídas ou com falha), na ordem do job: o visualizador passa entre elas.
  const comPrint: PrintItem[] = plano
    .map((def) => ({ def, step: steps.get(def.key) }))
    .filter(({ def, step }) => (step?.status === "done" || step?.status === "error") && def.key !== "fechar")
    .map(({ def, step }) => ({ key: def.key, label: def.label, status: step?.status, message: step?.message ?? null }));
  // Resumo em uma linha quando o job terminou (concluído ou parado): "N de M alvos conectados".
  const resumo = estrutura.status === "done" || estrutura.status === "error" ? resumoDosAlvos(alvos) : null;

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-xs font-medium text-ink-2">Estruturação · {timeAgo(estrutura.updatedAt, now)}</p>
        <Badge tone={badge.tone} dot>
          {badge.label}
        </Badge>
        {estrutura.status === "error" && (
          <Button size="sm" icon={<RotateCw size={14} />} loading={busy} onClick={() => onEstrutura(estrutura, "continuar")}>
            Continuar
          </Button>
        )}
        {estrutura.status !== "running" && (
          <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={() => onEstrutura(estrutura, "remover")}>
            Remover
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <ProgressBar value={prog.pct} size="sm" />
        </div>
        <button type="button" className="shrink-0 text-xs text-ink-2 hover:text-ink" onClick={() => setAberto((v) => !v)}>
          {prog.label} · {prog.feitas}/{prog.total} {aberto ? "▲" : "▼"}
        </button>
      </div>

      {resumo && <p className="mt-2 text-xs font-semibold text-ink">{resumo}</p>}
      {estrutura.status === "error" && estrutura.error && <p className="mt-2 text-xs text-danger">{estrutura.error}</p>}

      <AlvosResultado
        alvos={alvos}
        print={print}
        ampliar={(key) => setAmpliado(key)}
      />

      {aberto && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {plano.map((def) => {
            const step = steps.get(def.key);
            const temPrint = (step?.status === "done" || step?.status === "error") && def.key !== "fechar";
            return (
              <li key={def.key} className="flex items-center gap-2 text-sm">
                <StepIcon status={step?.status} />
                <span className="min-w-0 flex-1 text-ink">
                  {def.label}
                  {step?.message && <span className={cn("text-xs", step.status === "error" ? "text-danger" : "text-ink-2")}> · {step.message}</span>}
                </span>
                {temPrint && <PrintThumb src={print(def.key)} label={def.label} erro={step?.status === "error"} onOpen={() => setAmpliado(def.key)} />}
              </li>
            );
          })}
        </ol>
      )}

      {ampliado && comPrint.some((i) => i.key === ampliado) && (
        <PrintViewer itens={comPrint} atual={ampliado} src={print} onChange={setAmpliado} onClose={() => setAmpliado(null)} />
      )}
    </div>
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

interface InformacoesAlvo {
  perfil: string;
  destaque: string;
  link: string;
  resultado: ResultadoAlvo;
  mensagem: string | null;
}

interface Informacoes {
  nome: string;
  usuario: string;
  nascimento: string;
  senha: string;
  senhaMascarada: string;
  estruturacao: {
    status: string;
    criadaEm: string;
    atualizadaEm: string;
    agendadoPara: string | null;
    bio: string;
    linkStory: string;
    legendaSticker: string;
    destaqueDaConta: string;
    resumo: string | null;
    alvos: InformacoesAlvo[];
  } | null;
}

const RESULTADO_ALVO: Record<ResultadoAlvo, { tone: BadgeTone; label: string }> = {
  conectado: { tone: "success", label: "Conectado" },
  falhou: { tone: "danger", label: "Falhou" },
  pulado: { tone: "neutral", label: "Pulado" },
  rodando: { tone: "info", label: "Rodando" },
  pendente: { tone: "neutral", label: "Pendente" },
};

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * Bloco "Informações" da conta (recolhível pelo botão do card): nome, @,
 * nascimento, senha com copiar e, da estruturação mais nova, a bio, os alvos
 * configurados, a data e o resultado de cada alvo. A senha inteira só vai para
 * a área de transferência.
 */
function InformacoesBox({ jobId }: { jobId: string }) {
  const [info, setInfo] = React.useState<Informacoes | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [copiado, setCopiado] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/vps/contas/${encodeURIComponent(jobId)}/pessoa`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (Informacoes & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error ?? "Não foi possível ler os dados.");
        if (alive) setInfo(body);
      })
      .catch((e: Error) => alive && setErro(e.message));
    return () => {
      alive = false;
    };
  }, [jobId]);

  const copiar = async (chave: string, valor: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(chave);
      window.setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 1500);
    } catch {
      setErro("Não deu para copiar.");
    }
  };

  if (erro) return <p className="mt-3 text-xs text-danger">{erro}</p>;
  if (!info) return <p className="mt-3 text-xs text-ink-3">Lendo as informações…</p>;
  const linhas: Array<[string, string, string, string]> = [
    ["Nome", info.nome, info.nome, "nome"],
    ["Usuário", `@${info.usuario}`, info.usuario, "usuario"],
    ["Nascimento", info.nascimento, info.nascimento, "nascimento"],
    ["Senha", info.senhaMascarada, info.senha, "senha"],
  ];
  const est = info.estruturacao;
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-3 text-xs">
      <p className="font-medium text-ink-2">Informações</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {linhas.map(([rotulo, mostrar, valor, chave]) => (
          <div key={chave} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <dt className="text-ink-3">{rotulo}</dt>
              <dd className={cn("truncate text-ink", chave === "senha" && "font-mono")}>{mostrar}</dd>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-ink-3 hover:bg-surface-hover hover:text-ink"
              aria-label={`Copiar ${rotulo.toLowerCase()}`}
              onClick={() => void copiar(chave, valor)}
            >
              {copiado === chave ? <CheckCircle2 size={14} className="text-success" /> : <Copy size={14} />}
            </button>
          </div>
        ))}
      </dl>
      {est ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-ink-3">Bio</p>
              <p className="whitespace-pre-wrap break-words text-ink">{est.bio || "— (não mexe na bio)"}</p>
            </div>
            <div className="min-w-0">
              <p className="text-ink-3">Estruturação</p>
              <p className="text-ink">
                criada {dataHora(est.criadaEm)} · última atualização {dataHora(est.atualizadaEm)}
                {est.agendadoPara ? ` · agendada para ${dataHora(est.agendadoPara)}` : ""}
              </p>
              {est.resumo && <p className="font-medium text-ink">{est.resumo}</p>}
            </div>
            <div className="min-w-0">
              <p className="text-ink-3">Story</p>
              <p className="break-all text-ink">{est.linkStory || "—"}</p>
              {est.legendaSticker && <p className="text-ink-2">sticker: “{est.legendaSticker}”</p>}
            </div>
            <div className="min-w-0">
              <p className="text-ink-3">Destaque da conta</p>
              <p className="text-ink">{est.destaqueDaConta || "—"}</p>
            </div>
          </div>
          <div>
            <p className="text-ink-3">Alvos configurados</p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {est.alvos.map((a, i) => (
                <li key={`${a.perfil}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge tone={RESULTADO_ALVO[a.resultado].tone} dot>
                    {RESULTADO_ALVO[a.resultado].label}
                  </Badge>
                  <span className="font-mono text-ink">@{a.perfil}</span>
                  <span className="text-ink-2">· destaque “{a.destaque}”</span>
                  {a.link && (
                    <a href={a.link} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate text-accent hover:underline">
                      {a.link}
                    </a>
                  )}
                  {a.mensagem && <span className={cn("w-full", a.resultado === "falhou" ? "text-danger" : "text-ink-3")}>{a.mensagem}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="border-t border-line pt-3 text-ink-3">Esta conta ainda não foi estruturada.</p>
      )}
    </div>
  );
}

/**
 * Resultado por alvo dentro do bloco Estruturação: conectado, falhou (com a
 * mensagem, ex.: CONEXAO_OUTRA_CONTA) ou pulado, e o print de cada tentativa
 * (uma miniatura por etapa do alvo que rodou). Um alvo vermelho não derruba
 * os outros.
 */
function AlvosResultado({ alvos, print, ampliar }: { alvos: AlvoResultado[]; print: (key: string) => string; ampliar: (key: string) => void }) {
  if (alvos.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {alvos.map((a) => (
        <li key={a.n} className={cn("rounded-lg border p-2.5", a.resultado === "falhou" ? "border-danger" : "border-line")}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Badge tone={RESULTADO_ALVO[a.resultado].tone} dot>
              {RESULTADO_ALVO[a.resultado].label}
            </Badge>
            <span className="font-medium text-ink">
              Alvo {a.n} · @{a.perfil}
            </span>
            {a.destaque && <span className="text-ink-2">· destaque “{a.destaque}”</span>}
          </div>
          {a.mensagem && <p className={cn("mt-1 text-xs", a.resultado === "falhou" ? "font-semibold text-danger" : "text-ink-3")}>{a.mensagem}</p>}
          {a.tentativas.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {a.tentativas.map((key) => (
                <PrintThumb key={key} src={print(key)} label={key} erro={key === a.etapaComFalha} onOpen={() => ampliar(key)} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function StepIcon({ status }: { status: string | undefined }) {
  const cls = "mt-0.5 shrink-0";
  if (status === "done") return <CheckCircle2 size={15} className={cn(cls, "text-success")} />;
  if (status === "running") return <Loader2 size={15} className={cn(cls, "animate-spin text-accent")} />;
  if (status === "error") return <XCircle size={15} className={cn(cls, "text-danger")} />;
  return <Circle size={15} className={cn(cls, "text-ink-3")} />;
}
