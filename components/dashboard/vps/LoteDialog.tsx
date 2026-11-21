"use client";

import * as React from "react";
import { Banner, Button, Checkbox, Dialog, Input, Select, Textarea } from "@/components/ui";
import { rotuloEstadoProxy, sobrasDoLote, type ProblemaProxy } from "@/lib/vps/lote-sobras";
import { FOTOS_PERFIL_MIN, LOTE_MAX, parseFotosPerfil, parseLinhasPortal, parseLoteInput, parseProxies } from "@/lib/vps/input";
import { DEVICE_PERFIS, type VpsAgent } from "@/lib/vps/types";
import { MidiaPicker, useMidiasDaVps } from "./MidiaPicker";

interface LoteDialogProps {
  agent: VpsAgent | null;
  onClose: () => void;
  /** Lote enviado (a lista recarrega); `avisos` = o que passou mas merece atenção (proxy com outro usuário). */
  onSaved: (avisos: string[]) => void;
}

/** Linha do "Testar proxies" (sem credencial: host:porta, estado, motivo, IP e país de saída). */
interface TesteProxyLinha extends ProblemaProxy {
  n: number;
  ms: number | null;
  ip: string | null;
  pais: string | null;
  rotacao: boolean;
  aviso: string | null;
  entra: boolean;
}

const CHAVE_REMOVER_USADAS = "vps-lote-remover-usadas";

function lerPreferencia(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravarPreferencia(chave: string, valor: string) {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    /* sem storage: vale só nesta aba */
  }
}

/**
 * "Enviar lote": códigos do hstock (uma linha por conta) e proxies HTTP, uma
 * por conta, na ordem (as excedentes cobrem as que morrerem no teste). Nome, @,
 * senha e nascimento são gerados no servidor (lib/vps/pessoa.ts); a validação é
 * a mesma (lib/vps/input.ts).
 */
// decisão (21/11): voltou a ser uma proxy HTTP por linha, sem seletor de tipo nem sufixo de sessão (pedido do dono). O
// servidor ainda aceita tipo/sufixo pela API; linha com socks5:// continua valendo como SOCKS5.
// decisão (13/11): sem campo Pasta — a conta fica em RODANDO enquanto cria e vai sozinha para CRIADAS ou FALHAS.
// decisão (16/11): o envio testa as proxies no servidor; só as vivas entram e as que ficaram fora aparecem numa
// lista à parte com o motivo. O diálogo só fecha sozinho quando tudo entrou.
export function LoteDialog({ agent, onClose, onSaved }: LoteDialogProps) {
  const [proxies, setProxies] = React.useState("");
  const [codigos, setCodigos] = React.useState("");
  const [perfil, setPerfil] = React.useState("aleatorio");
  const [versaoIg, setVersaoIg] = React.useState("");
  const [pais, setPais] = React.useState("BR");
  /** Fotos de perfil marcadas na pasta Foto Perfil (mínimo 2): cada conta recebe uma delas, sorteada no servidor. */
  const [fotosPerfil, setFotosPerfil] = React.useState<string[]>([]);
  const biblioteca = useMidiasDaVps(!!agent);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Proxies/sessões que ficaram fora do último envio, com o motivo. */
  const [foraDoLote, setForaDoLote] = React.useState<ProblemaProxy[]>([]);
  /** Resumo do último envio que deixou sobras (o diálogo fica aberto para o próximo). */
  const [resumo, setResumo] = React.useState<string | null>(null);
  const [testando, setTestando] = React.useState(false);
  const [teste, setTeste] = React.useState<TesteProxyLinha[] | null>(null);
  /** Explicação do servidor quando nenhuma passou (tipo da porta errado, sufixo recusado pelo provedor). */
  const [diagnostico, setDiagnostico] = React.useState<string | null>(null);
  const [removerUsadas, setRemoverUsadas] = React.useState(true);

  const versoes = agent?.capacidade.versoesIg ?? [];

  React.useEffect(() => {
    if (!agent) return;
    setProxies("");
    setCodigos("");
    setPerfil("aleatorio");
    setVersaoIg(agent.capacidade.versoesIg[0] ?? "");
    setPais("BR");
    setError(null);
    setFotosPerfil([]);
    setForaDoLote([]);
    setResumo(null);
    setTeste(null);
    setRemoverUsadas(lerPreferencia(CHAVE_REMOVER_USADAS) !== "0");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reabre o formulário só quando troca de VPS.
  }, [agent]);

  const linhasCodigo = React.useMemo(() => parseLinhasPortal(codigos), [codigos]);
  const quantidade = linhasCodigo.length;
  const codigosInvalidos = linhasCodigo.filter((l) => l === null).length;
  const proxiesLidas = React.useMemo(() => parseProxies(proxies), [proxies]);
  const proxiesCount = "value" in proxiesLidas ? proxiesLidas.value.length : 0;
  const faltamProxies = Math.max(0, quantidade - proxiesCount);
  // Marcadas que ainda existem na pasta (foto excluída some da seleção).
  const fotosValidas = biblioteca.arquivos ? fotosPerfil.filter((p) => biblioteca.arquivos?.includes(p)) : fotosPerfil;
  const fotosOk = "value" in parseFotosPerfil(fotosValidas, biblioteca.arquivos);
  const podeEnviar =
    !!versaoIg && quantidade >= 1 && quantidade <= LOTE_MAX && codigosInvalidos === 0 && !("error" in proxiesLidas) && faltamProxies === 0 && fotosOk;

  const alternarRemoverUsadas = (v: boolean) => {
    setRemoverUsadas(v);
    gravarPreferencia(CHAVE_REMOVER_USADAS, v ? "1" : "0");
  };

  const testarProxies = async () => {
    setTestando(true);
    setError(null);
    setTeste(null);
    setDiagnostico(null);
    try {
      const res = await fetch("/api/vps/proxies/testar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxies }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; resultados?: TesteProxyLinha[]; diagnostico?: string | null } | null;
      if (!res.ok || !data?.resultados) throw new Error(data?.error ?? "Não deu para testar as proxies agora.");
      setTeste(data.resultados);
      setDiagnostico(data.diagnostico ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTestando(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const body = { agentId: agent.id, proxies, perfil, versaoIg, pais, codigos, fotosPerfil: fotosValidas };
    const fotos = parseFotosPerfil(fotosValidas, biblioteca.arquivos);
    if ("error" in fotos) {
      setError(fotos.error);
      return;
    }
    const parsed = parseLoteInput(body, versoes);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    setResumo(null);
    try {
      const res = await fetch("/api/vps/contas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        avisos?: string[];
        problemas?: ProblemaProxy[];
        enviadas?: number;
        codigosSobrando?: number;
        linhasUsadas?: number[];
        modoSessao?: boolean;
        sessoesUsadas?: string[];
      } | null;
      const problemas = Array.isArray(data?.problemas) ? data.problemas : [];
      if (!res.ok) {
        setForaDoLote(problemas);
        throw new Error(data?.error ?? "Não foi possível enviar o lote. Tente de novo.");
      }
      onSaved(Array.isArray(data?.avisos) ? data.avisos : []);
      const enviadas = data?.enviadas ?? quantidade;
      const sobrando = data?.codigosSobrando ?? 0;
      const sobras = sobrasDoLote(codigos, proxies, { enviadas, linhasUsadas: data?.linhasUsadas ?? [], problemas, modoSessao: !!data?.modoSessao }, removerUsadas);
      if (problemas.length === 0 && sobrando === 0) {
        if (removerUsadas) setProxies(sobras.proxies);
        onClose();
        return;
      }
      // Sobrou algo: as caixas ficam só com o que não entrou e a lista à parte mostra o motivo de cada proxy fora.
      setCodigos(sobras.codigos);
      setProxies(sobras.proxies);
      setForaDoLote(problemas);
      setTeste(null);
      setResumo(
        `${enviadas} conta${enviadas === 1 ? "" : "s"} enviada${enviadas === 1 ? "" : "s"}.` +
          (problemas.length ? ` ${problemas.length} proxy${problemas.length === 1 ? "" : "s"} ficou fora (lista abaixo).` : "") +
          (sobrando ? ` ${sobrando} código${sobrando === 1 ? "" : "s"} ficou na caixa por falta de proxy viva: cole mais proxies e envie de novo.` : "")
      );
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
      description={`Até ${LOTE_MAX} contas por envio: uma proxy HTTP fixa e um código do hstock por conta. Antes de enviar, cada proxy é testada (até 3 vezes, 25 s cada): só as vivas entram; mortas e lentas ficam numa lista à parte com o motivo, e proxies a mais cobrem as que caírem.`}
      className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"
    >
      {/* Só o corpo rola: cabeçalho (do Dialog) e rodapé ficam sempre visíveis. */}
      <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        {resumo && <Banner tone="success">{resumo}</Banner>}
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
          <div className="flex flex-col gap-1 rounded-lg border border-line p-3">
            <MidiaPicker
              midias={biblioteca}
              pastas={["perfil"]}
              label={`Fotos de perfil (${fotosValidas.length} marcada${fotosValidas.length === 1 ? "" : "s"})`}
              selecionadas={fotosValidas}
              onSelecionar={setFotosPerfil}
              error={biblioteca.erro ?? undefined}
            />
            <p className={fotosValidas.length >= FOTOS_PERFIL_MIN ? "text-xs text-ink-3" : "text-xs text-warning"}>
              {fotosValidas.length >= FOTOS_PERFIL_MIN
                ? `Cada conta recebe uma das ${fotosValidas.length} fotos marcadas, sorteada.`
                : `Marque no mínimo ${FOTOS_PERFIL_MIN} fotos (clique na miniatura). Cada conta recebe uma delas, sorteada.`}
            </p>
          </div>
          <Textarea
            label="Códigos do hstock"
            rows={Math.min(8, Math.max(3, quantidade))}
            placeholder={"https://portalapi.shop/mail | SUDXHRAY\nhttps://portalapi.shop/mail | OUTROCOD\nSOCODIGO (usa o link padrão)"}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox label="Remover da lista as proxies usadas depois do envio" checked={removerUsadas} onChange={(e) => alternarRemoverUsadas(e.target.checked)} />
            <Button type="button" variant="secondary" size="sm" loading={testando} disabled={proxiesCount === 0 || "error" in proxiesLidas || saving} onClick={() => void testarProxies()}>
              Testar proxies
            </Button>
          </div>
          {diagnostico && <Banner tone="warning">{diagnostico}</Banner>}
          {teste && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line p-3 text-xs">
              <p className="font-medium text-ink-2">
                Teste: {teste.filter((t) => t.entra).length} de {teste.length} entram no lote
                {teste.some((t) => !t.entra) ? ` · ${teste.filter((t) => !t.entra).length} ficam fora` : ""}
                {teste.some((t) => t.rotacao) ? ` · ${teste.filter((t) => t.rotacao).length} com rotação detectada` : ""}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {teste.map((t) => (
                  <li key={`${t.n}-${t.sessao ?? t.linha}`} className={!t.entra ? "text-danger" : t.rotacao ? "text-warning" : "text-ink-3"}>
                    {t.sessao ? `conta ${t.n} · sessão ` : `linha ${t.linha} · `}
                    <span className="font-mono">{t.sessao ?? t.hostPorta}</span> · {rotuloEstadoProxy(t.estado)}
                    {t.ip ? ` · ${t.ip}${t.pais ? ` (${t.pais})` : ""}` : ""} — {t.motivo}
                    {t.aviso ? ` · ${t.aviso}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {foraDoLote.length > 0 && (
            <div className="rounded-lg border border-danger/40 p-3 text-xs">
              <p className="font-medium text-danger">Fora do lote ({foraDoLote.length})</p>
              <ul className="mt-2 flex flex-col gap-1">
                {foraDoLote.map((p) => (
                  <li key={`${p.linha}-${p.hostPorta}-${p.sessao ?? ""}`} className="text-ink-2">
                    linha {p.linha}
                    {p.sessao ? ` · sessão ${p.sessao}` : ""} · <span className="font-mono">{p.hostPorta}</span> · <span className="text-danger">{rotuloEstadoProxy(p.estado)}</span> — {p.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-3 border-t border-line pt-3">
          <p className="text-xs text-ink-2">Nome, @, senha e nascimento são gerados automaticamente (nomes femininos brasileiros); aparecem no card em &quot;Dados&quot;.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!podeEnviar || testando}>
              {saving ? "Testando as proxies e enviando…" : `Testar e enviar ${quantidade || ""} conta${quantidade === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
