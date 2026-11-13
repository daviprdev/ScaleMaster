"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Banner, Button, Dialog, Input, Select, Textarea } from "@/components/ui";
import { MIDIA_MAX_BYTES } from "@/lib/vps/estruturacao";
import { LOTE_MAX, parseLinhasPortal, parseLoteInput, parseProxies } from "@/lib/vps/input";
import { DEVICE_PERFIS, type VpsAgent } from "@/lib/vps/types";

interface LoteDialogProps {
  agent: VpsAgent | null;
  onClose: () => void;
  /** Lote enviado (a lista recarrega); `avisos` = o que passou mas merece atenção (proxy com outro usuário). */
  onSaved: (avisos: string[]) => void;
}

/**
 * "Enviar lote": só dois textareas — proxies (uma por linha) e códigos do hstock
 * ("link | código", uma linha por conta). A quantidade é o número de códigos;
 * nome, @, senha e nascimento são gerados no servidor (lib/vps/pessoa.ts). A
 * validação é a mesma do servidor (lib/vps/input.ts).
 */
// decisão (13/11): sem campo Pasta — a conta fica em RODANDO enquanto cria e vai sozinha para CRIADAS ou FALHAS.
export function LoteDialog({ agent, onClose, onSaved }: LoteDialogProps) {
  const [proxies, setProxies] = React.useState("");
  const [codigos, setCodigos] = React.useState("");
  const [perfil, setPerfil] = React.useState("aleatorio");
  const [versaoIg, setVersaoIg] = React.useState("");
  const [pais, setPais] = React.useState("BR");
  /** Fotos de perfil (midias/perfil/): a criação sorteia uma por conta. null = lendo. */
  const [fotosPerfil, setFotosPerfil] = React.useState<string[] | null>(null);
  const [enviandoFotos, setEnviandoFotos] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const versoes = agent?.capacidade.versoesIg ?? [];

  const lerFotosPerfil = async () => {
    setFotosPerfil(null);
    try {
      const res = await fetch("/api/vps/midias", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { files?: Array<{ path: string }> } | null;
      setFotosPerfil((body?.files ?? []).map((f) => f.path).filter((p) => p.startsWith("perfil/")));
    } catch {
      setFotosPerfil([]);
    }
  };

  /** Sobe as fotos escolhidas para midias/perfil/ (uma por vez). */
  const enviarFotosPerfil = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    setEnviandoFotos(true);
    setError(null);
    try {
      for (const arquivo of Array.from(arquivos)) {
        if (arquivo.size > MIDIA_MAX_BYTES) throw new Error(`"${arquivo.name}" passa de 8 MB.`);
        const corpo = new FormData();
        corpo.append("arquivo", arquivo);
        corpo.append("pasta", "perfil");
        const res = await fetch("/api/vps/midias", { method: "POST", body: corpo });
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? `Não foi possível enviar "${arquivo.name}".`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviandoFotos(false);
      void lerFotosPerfil();
    }
  };

  React.useEffect(() => {
    if (!agent) return;
    setProxies("");
    setCodigos("");
    setPerfil("aleatorio");
    setVersaoIg(agent.capacidade.versoesIg[0] ?? "");
    setPais("BR");
    setError(null);
    void lerFotosPerfil();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reabre o formulário só quando troca de VPS.
  }, [agent]);

  const linhasCodigo = React.useMemo(() => parseLinhasPortal(codigos), [codigos]);
  const quantidade = linhasCodigo.length;
  const codigosInvalidos = linhasCodigo.filter((l) => l === null).length;
  const proxiesLidas = React.useMemo(() => parseProxies(proxies), [proxies]);
  const proxiesCount = "value" in proxiesLidas ? proxiesLidas.value.length : 0;
  const faltamProxies = Math.max(0, quantidade - proxiesCount);
  const podeEnviar = !!versaoIg && quantidade >= 1 && quantidade <= LOTE_MAX && codigosInvalidos === 0 && !("error" in proxiesLidas) && faltamProxies === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const body = { agentId: agent.id, proxies, perfil, versaoIg, pais, codigos };
    const parsed = parseLoteInput(body, versoes);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/vps/contas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; avisos?: string[] } | null;
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível enviar o lote. Tente de novo.");
      onSaved(Array.isArray(data?.avisos) ? data.avisos : []);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!agent}
      onClose={onClose}
      title="Enviar lote"
      description={`Até ${LOTE_MAX} contas por envio: uma proxy HTTP fixa e um código do hstock por conta. A VPS cria um container redroid por conta, valida a proxy, instala o Instagram, abre a sessão do portal na hora do e-mail, cadastra, aquece e desliga.`}
      className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
    >
      {/* Só o corpo rola: cabeçalho (do Dialog) e rodapé ficam sempre visíveis. */}
      <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Perfil do aparelho"
              value={perfil}
              onChange={(e) => setPerfil(e.target.value)}
              options={DEVICE_PERFIS.map((p) => ({ value: p.key, label: p.label }))}
            />
            <Select
              label="Versão do Instagram"
              value={versaoIg}
              onChange={(e) => setVersaoIg(e.target.value)}
              placeholder={versoes.length === 0 ? "nenhum APK na VPS" : undefined}
              options={versoes.map((v) => ({ value: v, label: v }))}
              hint={versoes.length === 0 ? "Na VPS: x86-<versão>/base.apk+split (x86_64) ou instagram-<versão>.apk (ARM) em /opt/scalemaster/apks." : undefined}
            />
            <Input
              label="País das proxies"
              value={pais}
              maxLength={2}
              onChange={(e) => setPais(e.target.value.toUpperCase())}
              hint="ISO-2 (BR, US…). Vale para as linhas sem país."
              required
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Fotos de perfil</p>
              <p className="text-xs text-ink-3">
                {fotosPerfil === null
                  ? "lendo a pasta…"
                  : fotosPerfil.length === 0
                    ? "Nenhuma foto em midias/perfil: as contas ficam sem foto de perfil."
                    : `${fotosPerfil.length} foto${fotosPerfil.length === 1 ? "" : "s"} em midias/perfil · cada conta recebe uma sorteada.`}
              </p>
            </div>
            <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-line-control px-3 text-sm text-ink hover:bg-surface-hover">
              <Upload size={14} />
              {enviandoFotos ? "Enviando…" : "Enviar fotos"}
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={enviandoFotos}
                onChange={(e) => {
                  void enviarFotosPerfil(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <Textarea
            label="Códigos do hstock"
            rows={Math.min(8, Math.max(3, quantidade))}
            placeholder={"https://hridoyhub.shop/OTP/ | SUDXHRAY\nhttps://hridoyhub.shop/OTP/ | OUTROCOD\nSOCODIGO (usa o link padrão)"}
            hint={
              codigosInvalidos > 0
                ? `Linha ${linhasCodigo.findIndex((l) => l === null) + 1} fora do formato "link | código" (${codigosInvalidos} inválida${codigosInvalidos === 1 ? "" : "s"}).`
                : quantidade > LOTE_MAX
                  ? `${quantidade} contas: no máximo ${LOTE_MAX} por envio.`
                  : `${quantidade} conta${quantidade === 1 ? "" : "s"} · uma linha por conta (link | código); só o código usa o link padrão.`
            }
            value={codigos}
            onChange={(e) => setCodigos(e.target.value)}
            className="font-mono text-xs"
            required
          />
          <Textarea
            label={`Proxies (${proxiesCount}/${quantidade || "—"})`}
            rows={Math.min(8, Math.max(3, quantidade))}
            placeholder={"host:porta:usuário:senha\nhost:porta:usuário:senha:US"}
            hint={
              "error" in proxiesLidas
                ? proxiesLidas.error
                : faltamProxies > 0
                  ? `${proxiesCount} proxies para ${quantidade} contas: falta${faltamProxies === 1 ? "" : "m"} ${faltamProxies}.`
                  : proxiesLidas.avisos.length > 0
                    ? `Aviso (não bloqueia): ${proxiesLidas.avisos.join(" ")}`
                    : "Uma por linha, na ordem dos códigos. Opcional: o país no fim (:US). A mesma proxy com o mesmo usuário não pode repetir."
            }
            value={proxies}
            onChange={(e) => setProxies(e.target.value)}
            className="font-mono text-xs"
            required
          />
        </div>
        <div className="flex shrink-0 flex-col gap-3 border-t border-line pt-3">
          <p className="text-xs text-ink-2">Nome, @, senha e nascimento são gerados automaticamente (nomes femininos brasileiros); aparecem no card em &quot;Dados&quot;.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!podeEnviar}>
              Enviar {quantidade || ""} conta{quantidade === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
