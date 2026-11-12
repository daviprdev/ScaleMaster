"use client";

import * as React from "react";
import { Banner, Button, Dialog, Input, Select, Textarea } from "@/components/ui";
import { LOTE_MAX, parseLinhasPortal, parseLoteInput, parseProxies } from "@/lib/vps/input";
import { DEVICE_PERFIS, type VpsAgent } from "@/lib/vps/types";
import { PastaCampo } from "./PastaCampo";

interface LoteDialogProps {
  agent: VpsAgent | null;
  /** Pastas que já existem (para escolher; dá para criar uma nova no próprio campo). */
  pastas: ReadonlyArray<string>;
  /** Pasta que vem marcada (a do filtro da aba). */
  pastaInicial?: string;
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
export function LoteDialog({ agent, pastas, pastaInicial = "", onClose, onSaved }: LoteDialogProps) {
  const [proxies, setProxies] = React.useState("");
  const [codigos, setCodigos] = React.useState("");
  const [perfil, setPerfil] = React.useState("aleatorio");
  const [versaoIg, setVersaoIg] = React.useState("");
  const [pais, setPais] = React.useState("BR");
  const [pasta, setPasta] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const versoes = agent?.capacidade.versoesIg ?? [];

  React.useEffect(() => {
    if (!agent) return;
    setProxies("");
    setCodigos("");
    setPerfil("aleatorio");
    setVersaoIg(agent.capacidade.versoesIg[0] ?? "");
    setPais("BR");
    setPasta(pastaInicial);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a pasta inicial só vale ao abrir.
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
    const body = { agentId: agent.id, proxies, perfil, versaoIg, pais, codigos, pasta };
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
          <PastaCampo pastas={pastas} value={pasta} onChange={setPasta} hint="As contas do lote entram nessa pasta (dá para trocar depois no card)." />
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
