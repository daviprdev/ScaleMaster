"use client";

import * as React from "react";
import { Banner, Button, Dialog, Input, Select, Textarea } from "@/components/ui";
import { LOTE_MAX, LOTE_MIN, parseLoteInput, parseProxies } from "@/lib/vps/input";
import { DEVICE_PERFIS, type VpsAgent } from "@/lib/vps/types";

interface LoteDialogProps {
  agent: VpsAgent | null;
  onClose: () => void;
  /** Lote enviado (a lista recarrega). */
  onSaved: () => void;
}

interface LinhaConta {
  email: string;
  senhaEmail: string;
  imapHost: string;
  imapPorta: string;
  senhaIg: string;
  nome: string;
  usuario: string;
  nascimento: string;
}

const LINHA_VAZIA: LinhaConta = { email: "", senhaEmail: "", imapHost: "", imapPorta: "993", senhaIg: "", nome: "", usuario: "", nascimento: "" };

/**
 * "Enviar lote": quantidade (1–20), uma proxy por linha, perfil do aparelho,
 * versão do Instagram (APKs que a VPS tem) e uma linha de conta por unidade.
 * A validação é a mesma do servidor (lib/vps/input.ts).
 */
export function LoteDialog({ agent, onClose, onSaved }: LoteDialogProps) {
  const [quantidade, setQuantidade] = React.useState(1);
  const [proxies, setProxies] = React.useState("");
  const [perfil, setPerfil] = React.useState("aleatorio");
  const [versaoIg, setVersaoIg] = React.useState("");
  const [pais, setPais] = React.useState("BR");
  const [contas, setContas] = React.useState<LinhaConta[]>([LINHA_VAZIA]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const versoes = agent?.capacidade.versoesIg ?? [];

  React.useEffect(() => {
    if (!agent) return;
    setQuantidade(1);
    setProxies("");
    setPerfil("aleatorio");
    setVersaoIg(agent.capacidade.versoesIg[0] ?? "");
    setPais("BR");
    setContas([LINHA_VAZIA]);
    setError(null);
  }, [agent]);

  React.useEffect(() => {
    setContas((atual) => {
      if (atual.length === quantidade) return atual;
      if (atual.length > quantidade) return atual.slice(0, quantidade);
      return [...atual, ...Array.from({ length: quantidade - atual.length }, () => LINHA_VAZIA)];
    });
  }, [quantidade]);

  const setLinha = (i: number, key: keyof LinhaConta) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setContas((lista) => lista.map((c, k) => (k === i ? { ...c, [key]: e.target.value } : c)));

  const proxiesLidas = React.useMemo(() => parseProxies(proxies), [proxies]);
  const proxiesCount = "value" in proxiesLidas ? proxiesLidas.value.length : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const body = { agentId: agent.id, quantidade, proxies, perfil, versaoIg, pais, conta: contas };
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
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível enviar o lote. Tente de novo.");
      onSaved();
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
      description={`De ${LOTE_MIN} a ${LOTE_MAX} contas por envio, uma proxy HTTP fixa por conta. A VPS cria um container redroid por conta, valida a proxy, instala o Instagram, lê o código no e-mail (IMAP), cadastra, aquece e desliga.`}
      className="max-w-3xl"
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="grid gap-4 sm:grid-cols-4">
          <Input
            label="Quantidade"
            type="number"
            min={LOTE_MIN}
            max={LOTE_MAX}
            value={String(quantidade)}
            onChange={(e) => setQuantidade(Math.min(LOTE_MAX, Math.max(LOTE_MIN, Number(e.target.value) || LOTE_MIN)))}
            required
          />
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
        <Textarea
          label={`Proxies (${proxiesCount}/${quantidade})`}
          rows={Math.min(8, Math.max(3, quantidade))}
          placeholder={"host:porta:usuário:senha\nhost:porta:usuário:senha:US"}
          hint={"error" in proxiesLidas ? proxiesLidas.error : "Uma por linha, na ordem das contas. Opcional: o país no fim (:US)."}
          value={proxies}
          onChange={(e) => setProxies(e.target.value)}
          className="font-mono text-xs"
          required
        />
        <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto pr-1">
          {contas.map((c, i) => (
            <fieldset key={i} className="rounded-lg border border-line p-3">
              <legend className="px-1 text-xs font-medium text-ink-2">
                Conta {i + 1}
                {"value" in proxiesLidas && proxiesLidas.value[i] ? ` · proxy ${proxiesLidas.value[i].host}:${proxiesLidas.value[i].porta}` : ""}
              </legend>
              <div className="grid gap-3 sm:grid-cols-4">
                <Input label="E-mail" type="email" value={c.email} onChange={setLinha(i, "email")} autoComplete="off" required />
                <Input
                  label="Senha do e-mail"
                  type="password"
                  hint="Senha de app, se o provedor exigir."
                  value={c.senhaEmail}
                  onChange={setLinha(i, "senhaEmail")}
                  autoComplete="new-password"
                  required
                />
                <Input label="Host IMAP" placeholder="imap.gmail.com" hint="Vazio = pelo domínio." value={c.imapHost} onChange={setLinha(i, "imapHost")} autoComplete="off" />
                <Input label="Porta IMAP" inputMode="numeric" value={c.imapPorta} onChange={setLinha(i, "imapPorta")} autoComplete="off" />
                <Input
                  label="Senha do Instagram"
                  type="password"
                  hint="Sem acento."
                  value={c.senhaIg}
                  onChange={setLinha(i, "senhaIg")}
                  autoComplete="new-password"
                  required
                />
                <Input label="Nome completo" hint="Sem acento." value={c.nome} onChange={setLinha(i, "nome")} autoComplete="off" required />
                <Input label="Usuário (opcional)" placeholder="sem @" value={c.usuario} onChange={setLinha(i, "usuario")} autoComplete="off" />
                <Input label="Nascimento" placeholder="dd/mm/aaaa" value={c.nascimento} onChange={setLinha(i, "nascimento")} autoComplete="off" required />
              </div>
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!versaoIg}>
            Enviar {quantidade} conta{quantidade > 1 ? "s" : ""}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
