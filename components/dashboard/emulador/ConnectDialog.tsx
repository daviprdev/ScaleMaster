"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Banner, Button, Dialog } from "@/components/ui";

interface ConnectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Chamado quando o PC novo foi criado (a lista recarrega). */
  onCreated: () => void;
  /** PC que já está na aba e perdeu o código: troca o código dele em vez de criar outro PC. */
  agent?: { id: string; hostname: string | null } | null;
}

/** Gera o código de um PC (novo, ou outro para um que já está na aba) e mostra o comando que liga o agente nele. */
export function ConnectDialog({ open, onClose, onCreated, agent }: ConnectDialogProps) {
  const [token, setToken] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setToken(null);
      setError(null);
      setCopied(false);
    }
  }, [open]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = agent ? `/api/emulador/agentes/${encodeURIComponent(agent.id)}/codigo` : "/api/emulador/agentes";
      const res = await fetch(url, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!res.ok || !body?.token) throw new Error(body?.error ?? "Não foi possível gerar o código. Tente de novo.");
      setToken(body.token);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const command = token ? `node agente.mjs conectar ${token}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não deu para copiar. Selecione o comando e copie com Ctrl+C.");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={agent ? `Novo código para ${agent.hostname ?? "este PC"}` : "Conectar um PC"}
      description={
        agent
          ? "Para quando o código do PC se perdeu. As instâncias e as contas dele continuam aqui."
          : "O agente roda no PC onde está o MuMu e liga esse PC ao Scale Master."
      }
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {error && <Banner tone="danger">{error}</Banner>}
        {!token ? (
          <>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>{agent ? "Gere o código novo aqui. O antigo para de valer na hora." : "Gere o código do PC aqui."}</li>
              <li>
                No PC, abra o terminal na pasta <span className="font-mono text-ink">agente-mumu</span> do Scale Master e
                rode o comando que vai aparecer.
              </li>
              <li>
                {agent
                  ? "O PC volta a ficar Online nesta aba."
                  : "O PC aparece nesta aba como Online, com as instâncias do MuMu."}
              </li>
            </ol>
            <div className="flex justify-end">
              <Button loading={loading} onClick={() => void generate()}>
                Gerar código
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              Rode no terminal, dentro da pasta <span className="font-mono text-ink">agente-mumu</span>:
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{command}</code>
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
                onClick={() => void copy()}
              >
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <Banner tone="warning">
              O código só aparece agora e fica guardado no PC. Se perder, clique em Iniciar agente nesse PC e gere outro
              pelo aviso.
            </Banner>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>
                Pronto
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
