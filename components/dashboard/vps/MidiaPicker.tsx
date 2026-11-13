"use client";

import * as React from "react";
import { ArrowLeft, Check, Folder, FolderPlus, ImageOff, Upload } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { MIDIA_MAX_BYTES } from "@/lib/vps/estruturacao";
import { cn } from "@/lib/utils";

/** Chave da raiz de /opt/scalemaster/midias (fotos fora de qualquer pasta). */
const RAIZ = "";

export interface MidiasDaVps {
  /** Caminhos relativos ("pasta/foto.jpg"); null = lendo. */
  arquivos: string[] | null;
  pastas: Array<{ nome: string; fotos: number }>;
  erro: string | null;
  recarregar: () => Promise<void>;
}

/** Fotos e pastas de /opt/scalemaster/midias (GET /api/vps/midias). `ativo` = lê ao ligar. */
export function useMidiasDaVps(ativo: boolean): MidiasDaVps {
  const [arquivos, setArquivos] = React.useState<string[] | null>(null);
  const [pastas, setPastas] = React.useState<Array<{ nome: string; fotos: number }>>([]);
  const [erro, setErro] = React.useState<string | null>(null);
  const recarregar = React.useCallback(async () => {
    try {
      const res = await fetch("/api/vps/midias", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { files?: Array<{ path: string }>; folders?: Array<{ nome: string; fotos: number }>; error?: string } | null;
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

const pastaDoArquivo = (p: string) => (p.includes("/") ? p.slice(0, p.indexOf("/")) : RAIZ);
const nomeDoArquivo = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const urlDaFoto = (p: string) => `/api/vps/midias/arquivo?path=${encodeURIComponent(p)}`;

interface MidiaPickerProps {
  midias: MidiasDaVps;
  /** Foto escolhida (caminho relativo); com `onChange` a grade vira seletor. */
  value?: string;
  onChange?: (path: string) => void;
  label?: string;
  error?: string;
}

/**
 * Pastas de mídia da VPS: primeiro os cartões das pastas (com "Nova pasta"),
 * clicando abre as miniaturas da pasta, com "Enviar fotos" para ela. Com
 * `onChange`, clicar numa miniatura escolhe a foto (Estruturar); sem, é só
 * para organizar (diálogo Mídias).
 */
export function MidiaPicker({ midias, value = "", onChange, label, error }: MidiaPickerProps) {
  const { arquivos, pastas, recarregar } = midias;
  const [aberta, setAberta] = React.useState<string | null>(value ? pastaDoArquivo(value) : null);
  const [novaPasta, setNovaPasta] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);

  // Foto escolhida de fora (reabriu o diálogo): abre a pasta dela.
  React.useEffect(() => {
    if (value) setAberta(pastaDoArquivo(value));
  }, [value]);

  const naRaiz = (arquivos ?? []).filter((p) => pastaDoArquivo(p) === RAIZ);
  const cartoes = [...pastas.map((p) => ({ chave: p.nome, nome: p.nome, fotos: p.fotos })), ...(naRaiz.length ? [{ chave: RAIZ, nome: "Sem pasta", fotos: naRaiz.length }] : [])];
  const fotosDaPasta = aberta === null ? [] : (arquivos ?? []).filter((p) => pastaDoArquivo(p) === aberta);
  const nomeAberta = aberta === RAIZ ? "Sem pasta" : aberta;

  const criarPasta = async () => {
    if (!novaPasta?.trim()) return;
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/vps/midias/pastas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: novaPasta }) });
      const body = (await res.json().catch(() => null)) as { nome?: string; error?: string } | null;
      if (!res.ok || !body?.nome) throw new Error(body?.error ?? "Não foi possível criar a pasta.");
      await recarregar();
      setNovaPasta(null);
      setAberta(body.nome);
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async (lista: FileList | null) => {
    if (!lista?.length || aberta === null) return;
    setOcupado(true);
    setAviso(null);
    let ultima: string | null = null;
    try {
      for (const arquivo of Array.from(lista)) {
        if (arquivo.size > MIDIA_MAX_BYTES) throw new Error(`"${arquivo.name}" passa de 8 MB.`);
        const corpo = new FormData();
        corpo.append("arquivo", arquivo);
        if (aberta) corpo.append("pasta", aberta);
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

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-sm font-medium text-ink">{label}</span>}
      {aberta === null ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {cartoes.map((c) => (
              <button
                key={c.chave || "__raiz__"}
                type="button"
                onClick={() => setAberta(c.chave)}
                className="flex items-center gap-2 rounded-lg border border-line p-3 text-left transition-colors hover:border-line-control hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <Folder size={18} className="shrink-0 text-accent" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.nome}</span>
                  <span className="block text-xs text-ink-3">
                    {c.fotos} foto{c.fotos === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            ))}
            {arquivos === null && <span className="p-3 text-sm text-ink-3">lendo as pastas…</span>}
            {arquivos !== null && cartoes.length === 0 && <span className="p-3 text-sm text-ink-3">Nenhuma pasta ainda.</span>}
          </div>
          {novaPasta === null ? (
            <div>
              <Button type="button" variant="secondary" size="sm" icon={<FolderPlus size={14} />} onClick={() => setNovaPasta("")}>
                Nova pasta
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="Nome da pasta"
                  value={novaPasta}
                  autoFocus
                  maxLength={40}
                  onChange={(e) => setNovaPasta(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void criarPasta();
                    }
                  }}
                  hint="Letras e números; espaço vira hífen."
                />
              </div>
              <Button type="button" size="sm" loading={ocupado} onClick={() => void criarPasta()}>
                Criar
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setNovaPasta(null)}>
                Cancelar
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => setAberta(null)}>
              Pastas
            </Button>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
              <Folder size={15} className="text-accent" />
              {nomeAberta}
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
                <Miniatura key={p} path={p} escolhida={p === value} onEscolher={onChange ? () => onChange(p) : undefined} />
              ))}
            </div>
          )}
        </>
      )}
      {value && (
        <span className="text-xs text-ink-2">
          Escolhida: <span className="font-medium text-ink">{value}</span>
        </span>
      )}
      {(aviso || error) && <span className="text-xs text-danger">{aviso ?? error}</span>}
    </div>
  );
}

function Miniatura({ path, escolhida, onEscolher }: { path: string; escolhida: boolean; onEscolher?: () => void }) {
  const [falhou, setFalhou] = React.useState(false);
  const conteudo = (
    <>
      {falhou ? (
        <span className="flex h-full w-full items-center justify-center text-ink-3">
          <ImageOff size={18} />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={urlDaFoto(path)} alt={nomeDoArquivo(path)} loading="lazy" className="h-full w-full object-cover" onError={() => setFalhou(true)} />
      )}
      {escolhida && (
        <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-white">
          <Check size={12} />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white">{nomeDoArquivo(path)}</span>
    </>
  );
  const classe = cn(
    "relative aspect-square overflow-hidden rounded-md border bg-surface-raised",
    escolhida ? "border-accent ring-2 ring-accent" : "border-line"
  );
  if (!onEscolher) return <div className={classe}>{conteudo}</div>;
  return (
    <button type="button" title={`Usar ${nomeDoArquivo(path)}`} aria-pressed={escolhida} onClick={onEscolher} className={cn(classe, "transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus")}>
      {conteudo}
    </button>
  );
}
