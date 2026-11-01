"use client";

import * as React from "react";
import { Banner, Button, Dialog, Input, Select, Skeleton } from "@/components/ui";
import type { EmulatorJob } from "@/lib/emulador/jobs";
import type { EmulatorAgent } from "@/lib/emulador/types";

/** Criar: agent sem job. Editar: o job da conta (os dados vêm do servidor, sem senha nem credenciais da proxy). */
export type ContaDialogTarget = { agent: EmulatorAgent; job?: EmulatorJob } | null;

interface ContaDialogProps {
  target: ContaDialogTarget;
  onClose: () => void;
  /** Conta criada ou salva (a lista recarrega). */
  onSaved: () => void;
}

const EMPTY = { proxy: "", email: "", senha: "", nome: "", usuario: "", nascimento: "" };

interface Editable {
  email: string;
  nome: string;
  usuario: string;
  nascimento: string;
  proxyHost: string;
}

/**
 * Formulário da conta: "Criar instância" (instância padrão, proxy do NekoBox e
 * dados do Instagram) ou "Editar dados" de uma conta que parou ou está na fila
 * (senha e proxy em branco = manter; salvar devolve a conta para a fila).
 */
export function ContaDialog({ target, onClose, onSaved }: ContaDialogProps) {
  const editing = target?.job ?? null;
  const [form, setForm] = React.useState(EMPTY);
  const [proxyHost, setProxyHost] = React.useState("");
  const [template, setTemplate] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!target) return;
    setForm(EMPTY);
    setProxyHost("");
    setError(null);
    setTemplate(target.agent.instances[0] ? String(target.agent.instances[0].index) : "");
    if (!target.job) return;

    let alive = true;
    setLoading(true);
    fetch(`/api/emulador/contas/${encodeURIComponent(target.job.id)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (Editable & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error ?? "Não foi possível ler os dados da conta.");
        if (!alive) return;
        setForm({ ...EMPTY, email: body.email, nome: body.nome, usuario: body.usuario, nascimento: body.nascimento });
        setProxyHost(body.proxyHost);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [target]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setSaving(true);
    setError(null);
    const conta = { email: form.email, senha: form.senha, nome: form.nome, usuario: form.usuario, nascimento: form.nascimento };
    try {
      const res = editing
        ? await fetch(`/api/emulador/contas/${encodeURIComponent(editing.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxy: form.proxy, conta }),
          })
        : await fetch("/api/emulador/contas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: target.agent.id, templateIndex: Number(template), proxy: form.proxy, conta }),
          });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível salvar. Tente de novo.");
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const keepHint = editing ? "Em branco = mantém o atual." : undefined;

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      title={editing ? "Editar dados" : "Criar instância"}
      description={
        editing
          ? "Ao salvar a conta volta para a fila. O que mudou roda de novo: com Gmail ou dados novos o Instagram é zerado e o cadastro recomeça."
          : "O agente copia a instância padrão, instala o Instagram, põe a proxy no NekoBox e cria a conta com o Gmail."
      }
      className="max-w-lg"
    >
      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando os dados da conta">
          <Skeleton height="56px" />
          <Skeleton height="160px" />
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          {error && <Banner tone="danger">{error}</Banner>}
          {!editing && (
            <Select
              label="Instância padrão"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              options={(target?.agent.instances ?? []).map((i) => ({ value: String(i.index), label: `#${i.index} · ${i.name}` }))}
            />
          )}
          <Input
            label="Proxy (HTTP)"
            placeholder={editing && proxyHost ? `atual: ${proxyHost}` : "host:porta:usuário:senha"}
            hint={keepHint}
            value={form.proxy}
            onChange={set("proxy")}
            autoComplete="off"
            required={!editing}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Gmail"
              type="email"
              placeholder="nome@gmail.com"
              hint={editing ? undefined : "O código de confirmação chega aqui; a aba pede para você digitar."}
              value={form.email}
              onChange={set("email")}
              autoComplete="off"
              required
            />
            <Input
              label="Senha do Instagram"
              type="password"
              hint={keepHint ?? "Sem acento."}
              value={form.senha}
              onChange={set("senha")}
              autoComplete="new-password"
              required={!editing}
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
            <Button type="submit" loading={saving} disabled={!editing && template === ""}>
              {editing ? (editing.status === "error" ? "Salvar e continuar" : "Salvar") : "Criar instância"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
