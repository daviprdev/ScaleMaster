"use client";

import * as React from "react";
import { Banner, Button, Checkbox, Dialog, Input } from "@/components/ui";
import {
  ATIVIDADE_ACOES,
  DESTAQUE_MAX,
  MIDIA_TIPOS,
  STICKER_MAX,
  parseStoryDados,
  type AtividadeAcao,
  type MediaFile,
  type MidiaUso,
} from "@/lib/emulador/atividade";
import type { EmulatorAgent, EmulatorInstance } from "@/lib/emulador/types";

export type AtividadeTarget = { agent: EmulatorAgent; instance: EmulatorInstance } | null;

type Passo = "acoes" | "midias" | "story";

const ROTULO: Record<MidiaUso, string> = { foto: "Foto de perfil", story: "Mídia do story" };

function tamanho(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface AtividadeDialogProps {
  target: AtividadeTarget;
  onClose: () => void;
  /** Estruturar na fila (a lista recarrega). */
  onSaved: () => void;
}

/**
 * Estruturar numa instância que já tem conta, em até três passos: o que fazer;
 * as mídias, marcadas da pasta do MuMu no PC (que o agente lista — mais de uma
 * marcada, ou a pasta inteira, e ele sorteia na hora); link, texto do sticker e
 * nome do destaque. Nada sobe para a internet: o agente copia direto do PC.
 */
export function AtividadeDialog({ target, onClose, onSaved }: AtividadeDialogProps) {
  const [passo, setPasso] = React.useState<Passo>("acoes");
  const [acoes, setAcoes] = React.useState<ReadonlySet<AtividadeAcao>>(new Set(["aquecer"]));
  const [midias, setMidias] = React.useState<Record<MidiaUso, ReadonlySet<string>>>({ foto: new Set(), story: new Set() });
  const [story, setStory] = React.useState({ link: "", texto: "", destaque: "" });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!target) return;
    setPasso("acoes");
    setAcoes(new Set(["aquecer"]));
    setMidias({ foto: new Set(), story: new Set() });
    setStory({ link: "", texto: "", destaque: "" });
    setSaving(false);
    setError(null);
  }, [target]);

  const usos: MidiaUso[] = (["foto", "story"] as const).filter((u) => acoes.has(u));
  const passos: Passo[] = ["acoes", ...(usos.length ? (["midias"] as const) : []), ...(acoes.has("story") ? (["story"] as const) : [])];
  const ultimo = passos[passos.length - 1] === passo;
  const media = target?.agent.media ?? { root: null, files: [] };

  const alternar = (acao: AtividadeAcao) =>
    setAcoes((atual) => {
      const next = new Set(atual);
      if (next.has(acao)) next.delete(acao);
      else next.add(acao);
      return next;
    });

  const avancar = () => {
    setError(null);
    if (passo === "acoes" && acoes.size === 0) return setError("Marque pelo menos uma coisa para fazer.");
    if (passo === "midias") {
      const falta = usos.find((u) => midias[u].size === 0);
      if (falta) return setError(`Marque a ${ROTULO[falta].toLowerCase()}.`);
    }
    if (passo === "story") {
      const dados = parseStoryDados(story);
      if ("error" in dados) return setError(dados.error);
    }
    if (!ultimo) return setPasso(passos[passos.indexOf(passo) + 1]);
    void iniciar();
  };

  const iniciar = async () => {
    if (!target) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/emulador/atividades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: target.agent.id,
          instanceIndex: target.instance.index,
          acoes: [...acoes],
          midias: Object.fromEntries(usos.map((u) => [u, [...midias[u]]])),
          story: acoes.has("story") ? story : undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível pôr na fila. Tente de novo.");
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const titulo = { acoes: "Estruturar", midias: "Mídias", story: "Link e legenda" }[passo];
  const descricao = {
    acoes: target ? `Na instância #${target.instance.index} (${target.instance.name}). Ela liga, conecta a proxy do NekoBox, faz o que você marcar e desliga.` : undefined,
    midias: `Da pasta do MuMu no PC${media.root ? ` (${media.root})` : ""}. Marque uma, ou várias (ou a pasta inteira) para sortear uma na hora.`,
    story: "Sem acento nem emoji: o agente digita pelo teclado do Android.",
  }[passo];

  return (
    <Dialog open={!!target} onClose={onClose} preventClose={saving} title={titulo} description={descricao} className="max-w-lg">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          avancar();
        }}
      >
        {error && <Banner tone="danger">{error}</Banner>}

        {passo === "acoes" && (
          <ul className="flex flex-col gap-2">
            {ATIVIDADE_ACOES.map((a) => (
              <li key={a.key} className="rounded-lg border border-line px-3 py-2.5">
                <Checkbox label={a.label} checked={acoes.has(a.key)} onChange={() => alternar(a.key)} />
                <p className="mt-1 pl-6 text-xs text-ink-2">{a.description}</p>
              </li>
            ))}
          </ul>
        )}

        {passo === "midias" &&
          usos.map((uso) => (
            <MidiaLista
              key={uso}
              uso={uso}
              root={media.root}
              files={media.files.filter((f) => MIDIA_TIPOS[uso].includes(f.tipo))}
              marcadas={midias[uso]}
              onChange={(next) => setMidias((m) => ({ ...m, [uso]: next }))}
            />
          ))}

        {passo === "story" && (
          <div className="flex flex-col gap-4">
            <Input
              label="Link do sticker"
              placeholder="https://..."
              value={story.link}
              onChange={(e) => setStory((s) => ({ ...s, link: e.target.value }))}
              autoComplete="off"
              autoFocus
              required
            />
            <Input
              label="Texto do sticker (opcional)"
              hint={`Até ${STICKER_MAX} caracteres. Vazio = o Instagram mostra o endereço.`}
              maxLength={STICKER_MAX}
              value={story.texto}
              onChange={(e) => setStory((s) => ({ ...s, texto: e.target.value }))}
              autoComplete="off"
            />
            <Input
              label="Nome do destaque"
              hint={`Até ${DESTAQUE_MAX} caracteres.`}
              maxLength={DESTAQUE_MAX}
              value={story.destaque}
              onChange={(e) => setStory((s) => ({ ...s, destaque: e.target.value }))}
              autoComplete="off"
              required
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => (passo === "acoes" ? onClose() : setPasso(passos[passos.indexOf(passo) - 1]))}
          >
            {passo === "acoes" ? "Cancelar" : "Voltar"}
          </Button>
          <Button type="submit" loading={saving} disabled={passo === "acoes" && acoes.size === 0}>
            {ultimo ? "Iniciar" : "Seguinte"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Mídias de um uso, por pasta: marcar a pasta marca todos os arquivos dela. */
function MidiaLista({
  uso,
  root,
  files,
  marcadas,
  onChange,
}: {
  uso: MidiaUso;
  root: string | null;
  files: readonly MediaFile[];
  marcadas: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const pastas = React.useMemo(() => {
    const porPasta = new Map<string, MediaFile[]>();
    for (const f of files) {
      const pasta = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      porPasta.set(pasta, [...(porPasta.get(pasta) ?? []), f]);
    }
    return [...porPasta.entries()];
  }, [files]);

  const trocar = (paths: string[], marcar: boolean) => {
    const next = new Set(marcadas);
    for (const p of paths) {
      if (marcar) next.add(p);
      else next.delete(p);
    }
    onChange(next);
  };

  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-[13px] font-medium text-ink">{ROTULO[uso]}</p>
      <p className="text-xs text-ink-2">
        {uso === "foto" ? "JPG ou PNG." : "JPG, PNG, MP4 ou MOV."}
        {marcadas.size > 1 ? ` ${marcadas.size} marcadas: o agente sorteia uma.` : marcadas.size === 1 ? " 1 marcada." : ""}
      </p>
      {files.length === 0 ? (
        <p className="mt-2.5 text-xs text-ink-2">
          {root
            ? `Nenhum arquivo assim em ${root}. Coloque lá e espere uns 30 s para o agente ver.`
            : "O agente não achou a pasta do MuMu (Documentos\\MuMuSharedFolder) no PC."}
        </p>
      ) : (
        <div className="mt-2.5 flex max-h-56 flex-col gap-2 overflow-y-auto">
          {pastas.map(([pasta, itens]) => {
            const paths = itens.map((f) => f.path);
            const todas = paths.every((p) => marcadas.has(p));
            return (
              <div key={pasta}>
                <Checkbox
                  label={`${pasta || "Pasta principal"} (pasta inteira, ${itens.length})`}
                  checked={todas}
                  onChange={() => trocar(paths, !todas)}
                />
                <ul className="mt-1 flex flex-col gap-1 pl-6">
                  {itens.map((f) => (
                    <li key={f.path} className="flex items-center gap-2">
                      <Checkbox
                        label={f.path.slice(f.path.lastIndexOf("/") + 1)}
                        checked={marcadas.has(f.path)}
                        onChange={() => trocar([f.path], !marcadas.has(f.path))}
                      />
                      <span className="text-xs text-ink-3">{tamanho(f.size)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
