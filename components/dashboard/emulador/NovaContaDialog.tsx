"use client";

import * as React from "react";
import { Banner, Button, Dialog, Input, Select } from "@/components/ui";
import { NOVA_CONTA_FLUXO } from "@/lib/emulador/jobs";
import type { EmulatorAgent } from "@/lib/emulador/types";

interface NovaContaDialogProps {
  agent: EmulatorAgent | null;
  onClose: () => void;
  /** Conta posta na fila (a lista recarrega). */
  onCreated: () => void;
}

const EMPTY = { proxy: "", nome: "", usuario: "", senha: "", contato: "", nascimento: "" };

const PENDING = NOVA_CONTA_FLUXO.filter((s) => !s.ready).map((s) => s.label.toLowerCase());

/** Formulário Nova conta: instância padrão, proxy e dados da conta no Instagram. */
export function NovaContaDialog({ agent, onClose, onCreated }: NovaContaDialogProps) {
  const [form, setForm] = React.useState(EMPTY);
  const [template, setTemplate] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!agent) return;
    setForm(EMPTY);
    setError(null);
    setTemplate(agent.instances[0] ? String(agent.instances[0].index) : "");
  }, [agent]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent || template === "") return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/emulador/contas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          templateIndex: Number(template),
          proxy: form.proxy,
          conta: {
            nome: form.nome,
            usuario: form.usuario,
            senha: form.senha,
            contato: form.contato,
            nascimento: form.nascimento,
          },
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível criar. Tente de novo.");
      onCreated();
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
      title="Nova conta"
      description="O agente copia a instância padrão e cria a conta nessa cópia."
      className="max-w-lg"
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="danger">{error}</Banner>}
        <Select
          label="Instância padrão"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          options={(agent?.instances ?? []).map((i) => ({ value: String(i.index), label: `#${i.index} · ${i.name}` }))}
        />
        <Input
          label="Proxy"
          placeholder="host:porta:usuário:senha"
          value={form.proxy}
          onChange={set("proxy")}
          autoComplete="off"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome completo" value={form.nome} onChange={set("nome")} autoComplete="off" />
          <Input
            label="Usuário"
            placeholder="sem @"
            hint="Vira o nome da instância no MuMu."
            value={form.usuario}
            onChange={set("usuario")}
            autoComplete="off"
          />
          <Input label="Senha" type="password" value={form.senha} onChange={set("senha")} autoComplete="new-password" />
          <Input label="E-mail ou telefone" value={form.contato} onChange={set("contato")} autoComplete="off" />
          <Input
            label="Data de nascimento"
            placeholder="dd/mm/aaaa"
            value={form.nascimento}
            onChange={set("nascimento")}
            autoComplete="off"
          />
        </div>
        {PENDING.length > 0 && (
          <Banner tone="info">
            Por enquanto o agente copia a instância, troca o IMEI, dá o nome e liga. Ainda falta automatizar:{" "}
            {PENDING.join(", ")}. Os dados ficam guardados para essas etapas.
          </Banner>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={template === ""}>
            Criar conta
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
