"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Banner, Button, Dialog, Input, Select, Switch, Textarea } from "@/components/ui";
import {
  AGENDAR_MAX_H,
  AGENDAR_PADRAO_H,
  ALVOS_MAX,
  BIO_MAX,
  DESTAQUE_MAX,
  LEGENDA_MAX,
  MIDIA_MAX_BYTES,
  expandirEtapas,
  parseAlvos,
  parseEstrutura,
} from "@/lib/vps/estruturacao";
import type { VpsJob } from "@/lib/vps/types";

interface EstruturarDialogProps {
  /** Conta criada que vai ser estruturada; null = fechado. */
  job: VpsJob | null;
  onClose: () => void;
  onSaved: () => void;
}

const VAZIO = {
  fotoPerfil: "",
  fotoStory: "",
  bio: "",
  alvos: "",
  legenda: "",
  destaque: "",
  fazerPerfil: true,
  fazerOauth: true,
  fazerStory: true,
  agendarHoras: String(AGENDAR_PADRAO_H),
};

/**
 * "Estruturar" de uma conta da VPS: fotos de /opt/scalemaster/midias, bio,
 * alvos (`@perfil | Nome do destaque | link`), legenda e nome do destaque, três
 * interruptores e a agenda em horas. A validação é a do servidor
 * (lib/vps/estruturacao.ts); o botão fica bloqueado sem foto com o interruptor
 * correspondente ligado e sem alvo válido.
 */
export function EstruturarDialog({ job, onClose, onSaved }: EstruturarDialogProps) {
  const [form, setForm] = React.useState(VAZIO);
  const [midias, setMidias] = React.useState<string[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [enviando, setEnviando] = React.useState<"fotoPerfil" | "fotoStory" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof typeof VAZIO>(campo: K, valor: (typeof VAZIO)[K]) => setForm((f) => ({ ...f, [campo]: valor }));

  const lerMidias = React.useCallback(async () => {
    const res = await fetch("/api/vps/midias", { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { files?: Array<{ path: string }>; error?: string } | null;
    if (!res.ok || !body?.files) throw new Error(body?.error ?? "Não foi possível ler a pasta de mídias.");
    setMidias(body.files.map((f) => f.path));
  }, []);

  React.useEffect(() => {
    if (!job) return;
    setForm(VAZIO);
    setError(null);
    setMidias(null);
    lerMidias().catch((e: Error) => setError(e.message));
  }, [job, lerMidias]);

  const alvos = React.useMemo(() => parseAlvos(form.alvos), [form.alvos]);
  const validado = React.useMemo(() => parseEstrutura(form, midias), [form, midias]);
  const etapas = "value" in validado ? expandirEtapas(validado.value).length : 0;
  const semFoto = (form.fazerPerfil && !form.fotoPerfil) || (form.fazerStory && !form.fotoStory);
  const semAlvo = alvos.alvos.length < 1 || alvos.erros.length > 0;
  const podeEnviar = !semFoto && !semAlvo && "value" in validado;

  const enviarFoto = async (campo: "fotoPerfil" | "fotoStory", arquivo: File | undefined) => {
    if (!arquivo) return;
    if (arquivo.size > MIDIA_MAX_BYTES) return setError("A foto passa de 8 MB.");
    setEnviando(campo);
    setError(null);
    try {
      const corpo = new FormData();
      corpo.append("arquivo", arquivo);
      const res = await fetch("/api/vps/midias", { method: "POST", body: corpo });
      const body = (await res.json().catch(() => null)) as { path?: string; error?: string } | null;
      if (!res.ok || !body?.path) throw new Error(body?.error ?? "Não foi possível enviar a foto.");
      await lerMidias();
      set(campo, body.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!job) return;
    if ("error" in validado) return setError(validado.error);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vps/contas/${encodeURIComponent(job.id)}/estruturar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível estruturar. Tente de novo.");
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const opcoes = (midias ?? []).map((m) => ({ value: m, label: m }));
  const seletor = (campo: "fotoPerfil" | "fotoStory", rotulo: string, ligado: boolean) => (
    <div className="flex flex-col gap-2">
      <Select
        label={rotulo}
        value={form[campo]}
        onChange={(e) => set(campo, e.target.value)}
        placeholder={midias === null ? "lendo a pasta…" : opcoes.length === 0 ? "nenhuma foto na pasta" : "escolha a foto"}
        options={opcoes}
        disabled={!ligado}
        error={ligado && !form[campo] && midias !== null ? "Escolha uma foto." : undefined}
      />
      <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
        <Upload size={13} />
        {enviando === campo ? "enviando…" : "Enviar foto (jpg, png ou webp, até 8 MB)"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={!ligado || enviando !== null}
          onChange={(e) => {
            void enviarFoto(campo, e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );

  return (
    <Dialog
      open={!!job}
      onClose={onClose}
      title={`Estruturar ${job?.label ? `@${job.label}` : "a conta"}`}
      description="A VPS sobe a proxy da conta, abre o Instagram, troca foto e bio, muda para conta profissional, percorre os alvos (perfil → destaque → link → Conectar → Permitir), posta o story com link, destaca e desliga o container."
      className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
    >
      <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Switch label="Foto + bio" checked={form.fazerPerfil} onChange={(e) => set("fazerPerfil", e.target.checked)} />
            <Switch label="OAuth (alvos)" checked={form.fazerOauth} onChange={(e) => set("fazerOauth", e.target.checked)} />
            <Switch label="Story" checked={form.fazerStory} onChange={(e) => set("fazerStory", e.target.checked)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {seletor("fotoPerfil", "Foto de perfil", form.fazerPerfil)}
            {seletor("fotoStory", "Foto do story", form.fazerStory)}
          </div>
          <Textarea
            label="Bio"
            rows={2}
            maxLength={BIO_MAX}
            showCounter
            value={form.bio}
            onChange={(e) => set("bio", e.target.value)}
            disabled={!form.fazerPerfil}
            hint="Aceita acento e emoji. Em branco = não mexe na bio."
          />
          <Textarea
            label={`Alvos (${alvos.alvos.length}/${ALVOS_MAX})`}
            rows={Math.min(8, Math.max(3, alvos.alvos.length + 1))}
            placeholder={"@perfil | Nome do destaque | https://link\n@outroperfil | Destaque | https://outro.link"}
            value={form.alvos}
            onChange={(e) => set("alvos", e.target.value)}
            className="font-mono text-xs"
            error={alvos.erros[0]}
            hint="Uma linha por alvo. O story usa o link do primeiro alvo."
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Textarea
              label="Legenda do story"
              rows={2}
              maxLength={LEGENDA_MAX}
              showCounter
              value={form.legenda}
              onChange={(e) => set("legenda", e.target.value)}
              disabled={!form.fazerStory}
              hint="Vai como texto do sticker de link. Aceita acento e emoji."
            />
            <div className="flex flex-col gap-4">
              <Input
                label="Nome do destaque"
                maxLength={DESTAQUE_MAX}
                value={form.destaque}
                onChange={(e) => set("destaque", e.target.value)}
                disabled={!form.fazerStory}
                required={form.fazerStory}
              />
              <Input
                label="Agendar em (horas)"
                type="number"
                min={0}
                max={AGENDAR_MAX_H}
                step="0.5"
                value={form.agendarHoras}
                onChange={(e) => set("agendarHoras", e.target.value)}
                hint="0 = agora."
              />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-ink-2">
            {"error" in validado ? validado.error : `${etapas} etapas · ${alvos.alvos.length} alvo${alvos.alvos.length === 1 ? "" : "s"}`}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!podeEnviar}>
              Estruturar
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
