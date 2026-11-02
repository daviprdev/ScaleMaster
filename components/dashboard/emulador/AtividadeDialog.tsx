"use client";

import * as React from "react";
import { FileImage, FolderOpen, ImageIcon } from "lucide-react";
import { Banner, Button, Checkbox, Dialog, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import {
  ATIVIDADE_ACOES,
  DESTAQUE_MAX,
  MIDIA_BUCKET,
  MIDIA_TIPOS,
  STICKER_MAX,
  erroDaMidia,
  normalizarTipo,
  parseStoryDados,
  type AtividadeAcao,
  type MidiaUso,
} from "@/lib/emulador/atividade";
import type { EmulatorAgent, EmulatorInstance } from "@/lib/emulador/types";

export type AtividadeTarget = { agent: EmulatorAgent; instance: EmulatorInstance } | null;

type Passo = "acoes" | "midias" | "story";

/** Mídia escolhida: o arquivo e, se veio de uma pasta, de quantos foi sorteado. */
interface Escolha {
  file: File;
  daPasta: number | null;
}

const ROTULO: Record<MidiaUso, string> = { foto: "Foto de perfil", story: "Mídia do story" };

function tipoDe(file: File): string {
  if (file.type) return normalizarTipo(file.type);
  const ext = file.name.toLowerCase().split(".").pop();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp4: "video/mp4", mov: "video/quicktime" }[ext ?? ""] ?? "";
}

function tamanho(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface AtividadeDialogProps {
  target: AtividadeTarget;
  onClose: () => void;
  /** Atividade na fila (a lista recarrega). */
  onSaved: () => void;
}

/**
 * Atividade numa instância que já tem conta, em até três passos: o que fazer;
 * as mídias (arquivo ou pasta — da pasta sai uma sorteada); link, texto do
 * sticker e nome do destaque. Ao iniciar, as mídias sobem direto ao Storage e
 * a atividade entra na fila do PC.
 */
export function AtividadeDialog({ target, onClose, onSaved }: AtividadeDialogProps) {
  const [passo, setPasso] = React.useState<Passo>("acoes");
  const [acoes, setAcoes] = React.useState<ReadonlySet<AtividadeAcao>>(new Set(["aquecer"]));
  const [midias, setMidias] = React.useState<Partial<Record<MidiaUso, Escolha>>>({});
  const [story, setStory] = React.useState({ link: "", texto: "", destaque: "" });
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!target) return;
    setPasso("acoes");
    setAcoes(new Set(["aquecer"]));
    setMidias({});
    setStory({ link: "", texto: "", destaque: "" });
    setSaving(null);
    setError(null);
  }, [target]);

  const usos: MidiaUso[] = (["foto", "story"] as const).filter((u) => acoes.has(u));
  const passos: Passo[] = ["acoes", ...(usos.length ? (["midias"] as const) : []), ...(acoes.has("story") ? (["story"] as const) : [])];
  const ultimo = passos[passos.length - 1] === passo;

  const alternar = (acao: AtividadeAcao) =>
    setAcoes((atual) => {
      const next = new Set(atual);
      if (next.has(acao)) next.delete(acao);
      else next.add(acao);
      return next;
    });

  const escolher = (uso: MidiaUso, files: FileList | null, pasta: boolean) => {
    setError(null);
    const lista = Array.from(files ?? []).filter((f) => MIDIA_TIPOS[uso].includes(tipoDe(f)));
    if (lista.length === 0) {
      setError(pasta ? `Essa pasta não tem ${uso === "foto" ? "JPG ou PNG" : "JPG, PNG, MP4 ou MOV"}.` : erroDaMidia(uso, "", 0));
      return;
    }
    const file = lista[Math.floor(Math.random() * lista.length)];
    const erro = erroDaMidia(uso, tipoDe(file), file.size);
    if (erro) {
      setError(pasta ? `${file.name}: ${erro}` : erro);
      return;
    }
    setMidias((m) => ({ ...m, [uso]: { file, daPasta: pasta ? lista.length : null } }));
  };

  const avancar = () => {
    setError(null);
    if (passo === "acoes" && acoes.size === 0) return setError("Marque pelo menos uma coisa para fazer.");
    if (passo === "midias") {
      const falta = usos.find((u) => !midias[u]);
      if (falta) return setError(`Escolha a ${ROTULO[falta].toLowerCase()}.`);
    }
    if (passo === "story") {
      const dados = parseStoryDados(story);
      if ("error" in dados) return setError(dados.error);
    }
    if (!ultimo) return setPasso(passos[passos.indexOf(passo) + 1]);
    void iniciar();
  };

  const subir = async (uso: MidiaUso, escolha: Escolha): Promise<string> => {
    const type = tipoDe(escolha.file);
    const res = await fetch("/api/emulador/atividades/midia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uso, type, size: escolha.file.size }),
    });
    const sign = (await res.json().catch(() => null)) as { path?: string; token?: string; error?: string } | null;
    if (!res.ok || !sign?.path || !sign.token) throw new Error(sign?.error ?? "Não foi possível preparar o envio da mídia.");
    const { error: upErr } = await createClient()
      .storage.from(MIDIA_BUCKET)
      .uploadToSignedUrl(sign.path, sign.token, escolha.file, { contentType: type });
    if (upErr) throw new Error(`Falha no envio de ${escolha.file.name}: ${upErr.message}`);
    return sign.path;
  };

  const iniciar = async () => {
    if (!target) return;
    setError(null);
    try {
      const caminhos: Partial<Record<MidiaUso, string>> = {};
      for (const uso of usos) {
        const escolha = midias[uso];
        if (!escolha) continue;
        setSaving(`Enviando ${ROTULO[uso].toLowerCase()}…`);
        caminhos[uso] = await subir(uso, escolha);
      }
      setSaving("Pondo na fila…");
      const res = await fetch("/api/emulador/atividades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: target.agent.id,
          instanceIndex: target.instance.index,
          acoes: [...acoes],
          midias: caminhos,
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
      setSaving(null);
    }
  };

  const titulo = { acoes: "Estruturar", midias: "Mídias", story: "Link e legenda" }[passo];
  const descricao = {
    acoes: target ? `Na instância #${target.instance.index} (${target.instance.name}). Ela liga, conecta a proxy do NekoBox, faz o que você marcar e desliga.` : undefined,
    midias: "Escolha um arquivo, ou uma pasta para sortear um deles.",
    story: "Sem acento nem emoji: o agente digita pelo teclado do Android.",
  }[passo];

  return (
    <Dialog open={!!target} onClose={onClose} preventClose={!!saving} title={titulo} description={descricao} className="max-w-lg">
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
            <MidiaPicker key={uso} uso={uso} escolha={midias[uso]} onPick={(files, pasta) => escolher(uso, files, pasta)} />
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
          {saving && <span className="mr-auto text-xs text-ink-2">{saving}</span>}
          <Button
            type="button"
            variant="secondary"
            disabled={!!saving}
            onClick={() => (passo === "acoes" ? onClose() : setPasso(passos[passos.indexOf(passo) - 1]))}
          >
            {passo === "acoes" ? "Cancelar" : "Voltar"}
          </Button>
          <Button type="submit" loading={!!saving} disabled={passo === "acoes" && acoes.size === 0}>
            {ultimo ? "Iniciar" : "Seguinte"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Uma mídia: escolher arquivo ou pasta, e o que ficou escolhido. */
function MidiaPicker({
  uso,
  escolha,
  onPick,
}: {
  uso: MidiaUso;
  escolha: Escolha | undefined;
  onPick: (files: FileList | null, pasta: boolean) => void;
}) {
  const arquivo = React.useRef<HTMLInputElement>(null);
  const pasta = React.useRef<HTMLInputElement>(null);
  const aceita = MIDIA_TIPOS[uso].join(",");

  React.useEffect(() => {
    // webkitdirectory não está nos tipos do React: liga direto no elemento.
    pasta.current?.setAttribute("webkitdirectory", "");
  }, []);

  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-[13px] font-medium text-ink">{ROTULO[uso]}</p>
      <p className="text-xs text-ink-2">{uso === "foto" ? "JPG ou PNG." : "JPG, PNG, MP4 ou MOV."}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" icon={<FileImage size={14} />} onClick={() => arquivo.current?.click()}>
          Escolher arquivo
        </Button>
        <Button type="button" variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={() => pasta.current?.click()}>
          Escolher pasta
        </Button>
      </div>
      {escolha && (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-ink">
          <ImageIcon size={13} className="shrink-0 text-ink-3" />
          <span className="truncate">{escolha.file.name}</span>
          <span className="shrink-0 text-ink-3">
            · {tamanho(escolha.file.size)}
            {escolha.daPasta !== null && ` · sorteada entre ${escolha.daPasta}`}
          </span>
        </p>
      )}
      <input
        ref={arquivo}
        type="file"
        accept={aceita}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files, false);
          e.target.value = "";
        }}
      />
      <input
        ref={pasta}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files, true);
          e.target.value = "";
        }}
      />
    </div>
  );
}
