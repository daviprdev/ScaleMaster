"use client";

import * as React from "react";
import { Banner, Button, Dialog, Input, Select } from "@/components/ui";
import type { EmulatorAgent } from "@/lib/emulador/types";

interface NovaContaDialogProps {
  agent: EmulatorAgent | null;
  onClose: () => void;
  /** Conta posta na fila (a lista recarrega). */
  onCreated: () => void;
}

const EMPTY = { proxy: "", email: "", senha: "", nome: "", usuario: "", nascimento: "" };

/** Formulário Criar instância: instância padrão, proxy do NekoBox e dados da conta no Instagram. */
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
            email: form.email,
            senha: form.senha,
            nome: form.nome,
            usuario: form.usuario,
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
      title="Criar instância"
      description="O agente copia a instância padrão, instala o Instagram, põe a proxy no NekoBox e cria a conta com o Gmail."
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
          label="Proxy (HTTP)"
          placeholder="host:porta:usuário:senha"
          value={form.proxy}
          onChange={set("proxy")}
          autoComplete="off"
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Gmail"
            type="email"
            placeholder="nome@gmail.com"
            hint="O código de confirmação chega aqui; a aba pede para você digitar."
            value={form.email}
            onChange={set("email")}
            autoComplete="off"
            required
          />
          <Input
            label="Senha do Instagram"
            type="password"
            hint="Sem acento."
            value={form.senha}
            onChange={set("senha")}
            autoComplete="new-password"
            required
          />
          <Input label="Nome completo" hint="Sem acento." value={form.nome} onChange={set("nome")} autoComplete="off" required />
          <Input
            label="Usuário (opcional)"
            placeholder="sem @"
            hint="Vazio = aceita a sugestão do Instagram."
            value={form.usuario}
            onChange={set("usuario")}
            autoComplete="off"
          />
          <Input
            label="Data de nascimento"
            placeholder="dd/mm/aaaa"
            value={form.nascimento}
            onChange={set("nascimento")}
            autoComplete="off"
            required
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={template === ""}>
            Criar instância
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
