"use client";

import * as React from "react";
import { Banner, Button, Dialog, Input, Select, Textarea } from "@/components/ui";
import {
  AGENDAR_MAX_H,
  AGENDAR_PADRAO_H,
  APP_GLOBAL,
  BIO_MAX,
  DESTAQUE_MAX,
  LEGENDA_MAX,
  NOME_APP_GLOBAL,
  NOME_DESTAQUE_PADRAO,
  PERFIL_PADRAO,
  contarCaracteres,
  errosPorCampo,
  expandirEtapas,
  parseEstrutura,
} from "@/lib/vps/estruturacao";
import type { VpsAgent, VpsJob } from "@/lib/vps/types";
import { MidiaPicker, useMidiasDaVps } from "./MidiaPicker";

/** Uma opção do seletor de pasta do "Estruturar pasta". */
export interface PastaOpcao {
  /** Nome da pasta, ou "__sem_pasta__". */
  value: string;
  label: string;
  /** Contas da pasta que entram (criadas, sem estruturação na fila e ainda não prontas). */
  elegiveis: number;
}

interface EstruturarDialogProps {
  /** Conta criada que vai ser estruturada; null = fechado (ou modo pasta). */
  job: VpsJob | null;
  /** "Estruturar pasta": a VPS e as pastas com quantas contas entram; null = fechado (ou modo conta). */
  pastaDe?: { agent: VpsAgent; opcoes: ReadonlyArray<PastaOpcao>; inicial?: string } | null;
  onClose: () => void;
  /** `avisos`: resumo do Estruturar pasta (criadas e puladas). */
  onSaved: (avisos?: string[]) => void;
}

const VAZIO = {
  fotoPerfil: "",
  fotoStory: "",
  bio: "",
  perfil: `@${PERFIL_PADRAO}`,
  nomeDestaque: NOME_DESTAQUE_PADRAO,
  app: "",
  linkStory: "",
  legendaSticker: "",
  legendaDestaque: "",
  agendarHoras: String(AGENDAR_PADRAO_H),
};

type Campo = keyof typeof VAZIO;

// Última escolha de app fica no navegador (vale para o próximo Estruturar).
const APP_SALVO = "vps-estruturar-app";

function lerAppSalvo(): string {
  try {
    return window.localStorage.getItem(APP_SALVO) ?? "";
  } catch {
    return "";
  }
}

function salvarApp(valor: string) {
  try {
    window.localStorage.setItem(APP_SALVO, valor);
  } catch {
    /* sem storage: só não lembra */
  }
}

interface AppOpcao {
  value: string;
  label: string;
}

/**
 * Apps em que a conta pode conectar: o global (.env) e os de Meus Apps, na
 * mesma ordem da página /add/<token>/apps, onde o agente toca no escolhido.
 */
function useAppsDeConexao(aberto: boolean): { opcoes: AppOpcao[]; carregando: boolean; erro: string | null } {
  const [estado, setEstado] = React.useState<{ opcoes: AppOpcao[]; carregando: boolean; erro: string | null }>({ opcoes: [], carregando: false, erro: null });
  React.useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    fetch("/api/apps")
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { apps?: Array<{ id: string; app_name: string; ig_app_id: string }>; error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? "Não deu para ler Meus Apps.");
        const global = process.env.NEXT_PUBLIC_META_CLIENT_ID;
        const opcoes: AppOpcao[] = [
          ...(global ? [{ value: APP_GLOBAL, label: `${NOME_APP_GLOBAL} · ${global}` }] : []),
          ...(body?.apps ?? []).map((a) => ({ value: a.id, label: `${a.app_name} · ${a.ig_app_id}` })),
        ];
        if (vivo) setEstado({ opcoes, carregando: false, erro: null });
      })
      .catch((err: Error) => vivo && setEstado({ opcoes: [], carregando: false, erro: err.message }));
    return () => {
      vivo = false;
    };
  }, [aberto]);
  return estado;
}

/** Contador por code point (emoji conta 1), no rótulo do campo. */
const contador = (valor: string, max: number) => `${contarCaracteres(valor)}/${max}`;

/**
 * "Estruturar" de uma conta da VPS, com campos fixos: as duas fotos de
 * /opt/scalemaster/midias (com envio), a bio, o perfil com o destaque e o nome
 * do destaque (texto embaixo da capa), o link e a legenda do sticker do story,
 * a legenda do destaque e a agenda. Cada campo mostra o seu erro; a validação é
 * a do servidor (lib/vps/estruturacao.ts).
 */
// decisão (16/11): sem "Ao concluir, mover para a pasta" — concluída e conectada no SaaS a conta é apagada da VPS
// (lib/vps/remover-conta.ts) e com erro vai sozinha para FALHAS; não há destino a escolher.
export function EstruturarDialog({ job, pastaDe = null, onClose, onSaved }: EstruturarDialogProps) {
  const aberto = !!job || !!pastaDe;
  const [form, setForm] = React.useState(VAZIO);
  const [pasta, setPasta] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (campo: Campo, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  // Pastas e fotos de /opt/scalemaster/midias: a foto do story é escolhida pela miniatura (MidiaPicker).
  const biblioteca = useMidiasDaVps(aberto);
  const midias = biblioteca.arquivos;
  const apps = useAppsDeConexao(aberto);

  React.useEffect(() => {
    if (!aberto) return;
    setForm(VAZIO);
    setError(null);
    if (pastaDe) setPasta(pastaDe.inicial && pastaDe.opcoes.some((o) => o.value === pastaDe.inicial) ? pastaDe.inicial : (pastaDe.opcoes.find((o) => o.elegiveis > 0)?.value ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reabre o formulário só quando o diálogo abre.
  }, [job, pastaDe?.agent.id, aberto]);

  // Com a lista carregada: a última escolha, se ainda existe; senão o primeiro app.
  React.useEffect(() => {
    if (!aberto || apps.opcoes.length === 0) return;
    setForm((f) => {
      if (f.app && apps.opcoes.some((o) => o.value === f.app)) return f;
      const salvo = lerAppSalvo();
      return { ...f, app: apps.opcoes.some((o) => o.value === salvo) ? salvo : apps.opcoes[0].value };
    });
  }, [aberto, apps.opcoes]);
  const opcaoPasta = pastaDe?.opcoes.find((o) => o.value === pasta) ?? null;

  const validado = React.useMemo(() => parseEstrutura(form, midias), [form, midias]);
  const erros = React.useMemo(() => errosPorCampo(form, midias), [form, midias]);
  const etapas = "value" in validado ? expandirEtapas(validado.value).length : 0;
  const qtdErros = Object.keys(erros).length;
  const podeEnviar = qtdErros === 0 && "value" in validado && (!pastaDe || (opcaoPasta?.elegiveis ?? 0) > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!job && !pastaDe) return;
    if ("error" in validado) return setError(validado.error);
    setSaving(true);
    setError(null);
    salvarApp(form.app);
    try {
      const url = pastaDe ? "/api/vps/pastas/estruturar" : `/api/vps/contas/${encodeURIComponent(job!.id)}/estruturar`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pastaDe ? { ...form, agentId: pastaDe.agent.id, pasta } : form),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; criadas?: Array<{ label: string | null }>; puladas?: Array<{ label: string; motivo: string }> } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível estruturar. Tente de novo.");
      if (pastaDe) {
        const criadas = body?.criadas?.length ?? 0;
        const puladas = body?.puladas ?? [];
        onSaved([
          `Estruturar pasta "${opcaoPasta?.label ?? pasta}": ${criadas} conta${criadas === 1 ? "" : "s"} na fila (a VPS roda ${pastaDe.agent.capacidade.maxCadastro} por vez).`,
          ...(puladas.length ? [`Puladas: ${puladas.map((p) => `${p.label} (${p.motivo})`).join(", ")}.`] : []),
        ]);
      } else onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={aberto}
      onClose={onClose}
      title={pastaDe ? "Estruturar pasta" : `Estruturar ${job?.label ? `@${job.label}` : "a conta"}`}
      description="A VPS sobe a proxy, abre o Instagram, troca a bio, muda para conta profissional, entra no perfil e no destaque configurados, toca no link, aceita o convite de testador do app escolhido, conecta por ele, posta o story com o link, destaca e desliga o container."
      className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
    >
      <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {pastaDe && (
            <Select
              label="Pasta de contas criadas"
              value={pasta}
              onChange={(e) => setPasta(e.target.value)}
              placeholder={pastaDe.opcoes.length === 0 ? "nenhuma conta criada nesta VPS" : "escolha a pasta"}
              options={pastaDe.opcoes.map((o) => ({ value: o.value, label: `${o.label} · ${o.elegiveis} para estruturar` }))}
              error={opcaoPasta && opcaoPasta.elegiveis === 0 ? "Nenhuma conta dessa pasta para estruturar (já prontas, na fila ou ainda sendo criadas)." : undefined}
              hint={`Entram as contas criadas da pasta que ainda não estão prontas; a VPS roda até ${pastaDe.agent.capacidade.maxCadastro} ao mesmo tempo e o resto espera na fila.`}
            />
          )}
          <MidiaPicker midias={biblioteca} label="Foto do story (pasta Stories)" pastas={["stories"]} value={form.fotoStory} onChange={(p) => set("fotoStory", p)} error={erros.fotoStory ?? biblioteca.erro ?? undefined} />
          <Textarea
            label={`Bio (${contador(form.bio, BIO_MAX)})`}
            rows={2}
            value={form.bio}
            onChange={(e) => set("bio", e.target.value)}
            error={erros.bio}
            hint="Aceita acento e emoji. Em branco = não mexe na bio."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Perfil com o destaque"
              value={form.perfil}
              onChange={(e) => set("perfil", e.target.value)}
              error={erros.perfil}
              hint="O agente abre esse perfil pelo deep link."
              autoComplete="off"
            />
            <Input
              label={`Nome do destaque (${contador(form.nomeDestaque, DESTAQUE_MAX)})`}
              value={form.nomeDestaque}
              onChange={(e) => set("nomeDestaque", e.target.value)}
              error={erros.nomeDestaque}
              hint="O texto embaixo da capa. Também vira o nome do destaque da conta."
              autoComplete="off"
            />
          </div>
          <Select
            label="App para conectar"
            value={form.app}
            onChange={(e) => set("app", e.target.value)}
            placeholder={apps.carregando ? "carregando Meus Apps…" : apps.opcoes.length === 0 ? "nenhum app cadastrado" : "escolha o app"}
            options={apps.opcoes}
            error={apps.erro ?? erros.app}
            hint="A conta aceita o convite de testador desse app e conecta por ele (o agente escolhe na página do link do destaque)."
          />
          <Input
            label="Link do sticker do story"
            type="url"
            placeholder="https://"
            value={form.linkStory}
            onChange={(e) => set("linkStory", e.target.value)}
            error={erros.linkStory}
            autoComplete="off"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Textarea
              label={`Legenda do sticker do link (${contador(form.legendaSticker, LEGENDA_MAX)})`}
              rows={2}
              value={form.legendaSticker}
              onChange={(e) => set("legendaSticker", e.target.value)}
              error={erros.legendaSticker}
              hint="Texto que aparece no sticker. Em branco = o endereço do link."
            />
            <div className="flex flex-col gap-4">
              <Input
                label={`Legenda do destaque (${contador(form.legendaDestaque, DESTAQUE_MAX)})`}
                value={form.legendaDestaque}
                onChange={(e) => set("legendaDestaque", e.target.value)}
                error={erros.legendaDestaque}
                hint="Nome do destaque criado na conta. Em branco = o nome do destaque acima."
                autoComplete="off"
              />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Agendar em (horas)"
                    type="number"
                    min={0}
                    max={AGENDAR_MAX_H}
                    step="0.5"
                    value={form.agendarHoras}
                    onChange={(e) => set("agendarHoras", e.target.value)}
                    error={erros.agendarHoras}
                    hint="0 = agora."
                  />
                </div>
                <Button
                  type="button"
                  variant={form.agendarHoras === "0" ? "primary" : "secondary"}
                  size="md"
                  className="mt-[26px]"
                  onClick={() => set("agendarHoras", "0")}
                >
                  Agora
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-ink-2">
            {qtdErros > 0
              ? `${qtdErros} campo${qtdErros === 1 ? "" : "s"} para corrigir`
              : `${etapas} etapas${form.agendarHoras === "0" ? " · roda agora" : ` · em ${form.agendarHoras} h`}`}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!podeEnviar}>
              {pastaDe ? `Estruturar ${opcaoPasta?.elegiveis ?? 0} conta${opcaoPasta?.elegiveis === 1 ? "" : "s"}` : "Estruturar"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
