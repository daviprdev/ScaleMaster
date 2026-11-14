"use client";

import * as React from "react";
import { ArrowLeft, Check, Folder, ImageOff, Trash2, Upload } from "lucide-react";
import { Button, ConfirmDialog } from "@/components/ui";
import { MIDIA_MAX_BYTES } from "@/lib/vps/estruturacao";
import { cn } from "@/lib/utils";

/** As duas pastas fixas (14/11): perfil = Foto Perfil (sorteio da criação de conta), stories = Stories (Estruturar). */
const PASTAS_FIXAS: ReadonlyArray<{ nome: string; rotulo: string }> = [
  { nome: "perfil", rotulo: "Foto Perfil" },
  { nome: "stories", rotulo: "Stories" },
];

export interface MidiasDaVps {
  /** Caminhos relativos ("pasta/foto.jpg"); null = lendo. */
  arquivos: string[] | null;
  pastas: Array<{ nome: string; fotos: number; rotulo?: string }>;
  erro: string | null;
  recarregar: () => Promise<void>;
}

/** Fotos e pastas de /opt/scalemaster/midias (GET /api/vps/midias). `ativo` = lê ao ligar. */
export function useMidiasDaVps(ativo: boolean): MidiasDaVps {
  const [arquivos, setArquivos] = React.useState<string[] | null>(null);
  const [pastas, setPastas] = React.useState<Array<{ nome: string; fotos: number; rotulo?: string }>>([]);
  const [erro, setErro] = React.useState<string | null>(null);
  const recarregar = React.useCallback(async () => {
    try {
      const res = await fetch("/api/vps/midias", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as {
        files?: Array<{ path: string }>;
        folders?: Array<{ nome: string; fotos: number; rotulo?: string }>;
        error?: string;
      } | null;
      if (!res.ok || !body?.files) throw new Error(body?.error ?? "Não foi possível ler a pasta de mídias.");
      setArquivos(body.files.map((f) => f.path));
      setPastas(body.folders ?? []);
      setErro(null);
    } catch (e) {
      setArquivos((a) => a ?? []);
      setErro((e as Error).message);
    }
  }, []);
  React.useEffect(() => {
    if (!ativo) return;
    setArquivos(null);
    void recarregar();
  }, [ativo, recarregar]);
  return { arquivos, pastas, erro, recarregar };
}

const pastaDoArquivo = (p: string) => (p.includes("/") ? p.slice(0, p.indexOf("/")) : "");
const nomeDoArquivo = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const urlDaFoto = (p: string) => `/api/vps/midias/arquivo?path=${encodeURIComponent(p)}`;
const rotuloDaPasta = (nome: string) => PASTAS_FIXAS.find((p) => p.nome === nome)?.rotulo ?? nome;

interface MidiaPickerProps {
  midias: MidiasDaVps;
  /** Foto escolhida (caminho relativo); com `onChange` a grade vira seletor. */
  value?: string;
  onChange?: (path: string) => void;
  label?: string;
  error?: string;
  /** Pasta que abre primeiro quando nada está escolhido (Estruturar = stories). */
  pastaInicial?: string;
}

/**
 * Pastas de mídia da VPS: os cartões das duas pastas fixas (Foto Perfil e
 * Stories); clicando abre as miniaturas, com "Enviar fotos" para ela e a
 * lixeira em cada foto. Com `onChange`, clicar numa miniatura escolhe a foto
 * (Estruturar); sem, é só para organizar (diálogo Mídias).
 */
export function MidiaPicker({ midias, value = "", onChange, label, error, pastaInicial }: MidiaPickerProps) {
  const { arquivos, recarregar } = midias;
  const [aberta, setAberta] = React.useState<string | null>(value ? pastaDoArquivo(value) : (pastaInicial ?? null));
  const [ocupado, setOcupado] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);
  /** Foto esperando confirmação para excluir. */
  const [excluir, setExcluir] = React.useState<string | null>(null);
  const [excluindo, setExcluindo] = React.useState(false);

  // Foto escolhida de fora (reabriu o diálogo): abre a pasta dela.
  React.useEffect(() => {
    if (value) setAberta(pastaDoArquivo(value));
  }, [value]);

  const cartoes = PASTAS_FIXAS.map((p) => ({ ...p, fotos: (arquivos ?? []).filter((a) => pastaDoArquivo(a) === p.nome).length }));
  const fotosDaPasta = aberta === null ? [] : (arquivos ?? []).filter((p) => pastaDoArquivo(p) === aberta);

  const enviar = async (lista: FileList | null) => {
    if (!lista?.length || !aberta) return;
    setOcupado(true);
    setAviso(null);
    let ultima: string | null = null;
    try {
      for (const arquivo of Array.from(lista)) {
        if (arquivo.size > MIDIA_MAX_BYTES) throw new Error(`"${arquivo.name}" passa de 8 MB.`);
        const corpo = new FormData();
        corpo.append("arquivo", arquivo);
        corpo.append("pasta", aberta);
        const res = await fetch("/api/vps/midias", { method: "POST", body: corpo });
        const body = (await res.json().catch(() => null)) as { path?: string; error?: string } | null;
        if (!res.ok || !body?.path) throw new Error(body?.error ?? `Não foi possível enviar "${arquivo.name}".`);
        ultima = body.path;
      }
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      await recarregar();
      setOcupado(false);
      // Enviou uma só no modo seletor: já fica escolhida.
      if (onChange && ultima && lista.length === 1) onChange(ultima);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setExcluindo(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/vps/midias?path=${encodeURIComponent(excluir)}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível excluir a foto.");
      // A foto escolhida sumiu: o campo volta a ficar vazio.
      if (onChange && excluir === value) onChange("");
      await recarregar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setExcluindo(false);
      setExcluir(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-sm font-medium text-ink">{label}</span>}
      {aberta === null ? (
        <div className="grid grid-cols-2 gap-2">
          {cartoes.map((c) => (
            <button
              key={c.nome}
              type="button"
              onClick={() => setAberta(c.nome)}
              className="flex items-center gap-2 rounded-lg border border-line p-3 text-left transition-colors hover:border-line-control hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Folder size={18} className="shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{c.rotulo}</span>
                <span className="block text-xs text-ink-3">
                  {arquivos === null ? "lendo…" : `${c.fotos} foto${c.fotos === 1 ? "" : "s"}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => setAberta(null)}>
              Pastas
            </Button>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
              <Folder size={15} className="text-accent" />
              {rotuloDaPasta(aberta)}
            </span>
            <span className="text-xs text-ink-3">
              · {fotosDaPasta.length} foto{fotosDaPasta.length === 1 ? "" : "s"}
            </span>
            <label
              className={cn(
                "ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line-control px-3 text-sm text-ink hover:bg-surface-hover",
                ocupado && "pointer-events-none opacity-50"
              )}
            >
              <Upload size={14} />
              {ocupado ? "Enviando…" : "Enviar fotos"}
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={ocupado}
                onChange={(e) => {
                  void enviar(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {fotosDaPasta.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">Pasta vazia. Use &ldquo;Enviar fotos&rdquo;.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {fotosDaPasta.map((p) => (
                <Miniatura key={p} path={p} escolhida={p === value} onEscolher={onChange ? () => onChange(p) : undefined} onExcluir={() => setExcluir(p)} />
              ))}
            </div>
          )}
        </>
      )}
      {value && (
        <span className="text-xs text-ink-2">
          Escolhida: <span className="font-medium text-ink">{nomeDoArquivo(value)}</span> ({rotuloDaPasta(pastaDoArquivo(value))})
        </span>
      )}
      {(aviso || error) && <span className="text-xs text-danger">{aviso ?? error}</span>}
      <ConfirmDialog
        open={excluir !== null}
        onClose={() => (excluindo ? undefined : setExcluir(null))}
        title="Excluir a foto?"
        description={excluir ? `"${nomeDoArquivo(excluir)}" sai da pasta ${rotuloDaPasta(pastaDoArquivo(excluir))} e não volta. A VPS também apaga a cópia dela.` : undefined}
        confirmLabel="Excluir"
        variant="danger"
        loading={excluindo}
        onConfirm={() => void confirmarExclusao()}
      />
    </div>
  );
}

function Miniatura({ path, escolhida, onEscolher, onExcluir }: { path: string; escolhida: boolean; onEscolher?: () => void; onExcluir: () => void }) {
  const [falhou, setFalhou] = React.useState(false);
  const nome = nomeDoArquivo(path);
  const imagem = falhou ? (
    <span className="flex h-full w-full items-center justify-center text-ink-3">
      <ImageOff size={18} />
    </span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={urlDaFoto(path)} alt={nome} loading="lazy" className="h-full w-full object-cover" onError={() => setFalhou(true)} />
  );
  return (
    <div className={cn("group relative aspect-square overflow-hidden rounded-md border bg-surface-raised", escolhida ? "border-accent ring-2 ring-accent" : "border-line")}>
      {onEscolher ? (
        <button
          type="button"
          title={`Usar ${nome}`}
          aria-pressed={escolhida}
          onClick={onEscolher}
          className="block h-full w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {imagem}
        </button>
      ) : (
        imagem
      )}
      {escolhida && (
        <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-accent p-0.5 text-white">
          <Check size={12} />
        </span>
      )}
      <button
        type="button"
        title={`Excluir ${nome}`}
        aria-label={`Excluir ${nome}`}
        onClick={onExcluir}
        className="absolute left-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-80 transition-opacity hover:bg-danger hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 size={13} />
      </button>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white">{nome}</span>
    </div>
  );
}
