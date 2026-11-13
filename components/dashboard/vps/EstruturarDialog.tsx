"use client";

import * as React from "react";
import { Banner, Button, Dialog, Input, Select, Textarea } from "@/components/ui";
import {
  AGENDAR_MAX_H,
  AGENDAR_PADRAO_H,
  BIO_MAX,
  DESTAQUE_MAX,
  LEGENDA_MAX,
  NOME_DESTAQUE_PADRAO,
  PERFIL_PADRAO,
  contarCaracteres,
  errosPorCampo,
  expandirEtapas,
  parseEstrutura,
} from "@/lib/vps/estruturacao";
import type { VpsAgent, VpsJob } from "@/lib/vps/types";
import { PastaCampo } from "./PastaCampo";
import { MidiaPicker, useMidiasDaVps } from "./MidiaPicker";

const CHAVE_DESTINO = "vps-pasta-destino-estruturar";

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
  /** Pastas que existem (para o "Ao concluir, mover para a pasta"); vazio = o campo não aparece. */
  pastas?: ReadonlyArray<string>;
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
  linkStory: "",
  legendaSticker: "",
  legendaDestaque: "",
  agendarHoras: String(AGENDAR_PADRAO_H),
};

type Campo = keyof typeof VAZIO;

/** Contador por code point (emoji conta 1), no rótulo do campo. */
const contador = (valor: string, max: number) => `${contarCaracteres(valor)}/${max}`;

/**
 * "Estruturar" de uma conta da VPS, com campos fixos: as duas fotos de
 * /opt/scalemaster/midias (com envio), a bio, o perfil com o destaque e o nome
 * do destaque (texto embaixo da capa), o link e a legenda do sticker do story,
 * a legenda do destaque e a agenda. Cada campo mostra o seu erro; a validação é
 * a do servidor (lib/vps/estruturacao.ts).
 */
export function EstruturarDialog({ job, pastaDe = null, pastas = [], onClose, onSaved }: EstruturarDialogProps) {
  const aberto = !!job || !!pastaDe;
  const [form, setForm] = React.useState(VAZIO);
  const [pasta, setPasta] = React.useState("");
  /** "Ao concluir, mover para a pasta" ("" = não mover); lembra a última escolha neste navegador. */
  const [pastaDestino, setPastaDestino] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (campo: Campo, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  // Pastas e fotos de /opt/scalemaster/midias: a foto do story é escolhida pela miniatura (MidiaPicker).
  const biblioteca = useMidiasDaVps(aberto);
  const midias = biblioteca.arquivos;

  React.useEffect(() => {
    if (!aberto) return;
    setForm(VAZIO);
    setError(null);
    try {
      setPastaDestino(window.localStorage.getItem(CHAVE_DESTINO) ?? "");
    } catch {
      setPastaDestino("");
    }
    if (pastaDe) setPasta(pastaDe.inicial && pastaDe.opcoes.some((o) => o.value === pastaDe.inicial) ? pastaDe.inicial : (pastaDe.opcoes.find((o) => o.elegiveis > 0)?.value ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reabre o formulário só quando o diálogo abre.
  }, [job, pastaDe?.agent.id, aberto]);
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
    try {
      const url = pastaDe ? "/api/vps/pastas/estruturar" : `/api/vps/contas/${encodeURIComponent(job!.id)}/estruturar`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pastaDe ? { ...form, agentId: pastaDe.agent.id, pasta, pastaDestino } : { ...form, pastaDestino }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; criadas?: Array<{ label: string | null }>; puladas?: Array<{ label: string; motivo: string }> } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível estruturar. Tente de novo.");
      try {
        window.localStorage.setItem(CHAVE_DESTINO, pastaDestino);
      } catch {
        /* sem storage */
      }
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
      description="A VPS sobe a proxy, abre o Instagram, troca a bio, muda para conta profissional, entra no perfil e no destaque configurados, toca no link, aceita as permissões, posta o story com o link, destaca e desliga o container."
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
          <MidiaPicker midias={biblioteca} label="Foto do story" value={form.fotoStory} onChange={(p) => set("fotoStory", p)} error={erros.fotoStory ?? biblioteca.erro ?? undefined} />
          <PastaCampo
            label="Ao concluir, mover para a pasta"
            rotuloVazio="Não mover"
            pastas={pastas}
            value={pastaDestino}
            onChange={setPastaDestino}
            hint="Quando a estruturação terminar com a conta conectada no SaaS, ela vai sozinha para essa pasta (aba Estruturadas)."
          />
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
