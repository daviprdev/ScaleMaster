"use client";

import * as React from "react";
import { Input, Select } from "@/components/ui";
import { PASTA_MAX } from "@/lib/vps/pastas";

const NOVA = "__nova_pasta__";

interface PastaCampoProps {
  label?: string;
  hint?: string;
  /** Pastas que já existem (nomes). */
  pastas: ReadonlyArray<string>;
  /** Nome da pasta escolhida/digitada; "" = sem pasta. */
  value: string;
  onChange: (pasta: string) => void;
  /** Texto da opção vazia (padrão "Sem pasta"). */
  rotuloVazio?: string;
}

/**
 * Pasta da conta: escolhe uma que já existe, "Sem pasta" ou "Nova pasta…"
 * (aí aparece o campo do nome). Usado no Enviar lote e no Mover de pasta.
 */
export function PastaCampo({ label = "Pasta", hint, pastas, value, onChange, rotuloVazio = "Sem pasta" }: PastaCampoProps) {
  const existe = value === "" || pastas.includes(value);
  const [nova, setNova] = React.useState(!existe);
  // Valor vindo de fora (abrir o diálogo de outra conta) volta para o seletor quando a pasta já existe.
  React.useEffect(() => {
    // Nome que não está na lista (pasta renomeada, destino lembrado) abre o campo de texto com ele.
    setNova(!(value === "" || pastas.includes(value)));
  }, [value, pastas]);

  return (
    <div className="flex flex-col gap-3">
      <Select
        label={label}
        hint={nova ? undefined : hint}
        value={nova ? NOVA : value}
        onChange={(e) => {
          if (e.target.value === NOVA) {
            setNova(true);
            onChange("");
          } else {
            setNova(false);
            onChange(e.target.value);
          }
        }}
        options={[{ value: "", label: rotuloVazio }, ...pastas.map((p) => ({ value: p, label: p })), { value: NOVA, label: "+ Nova pasta…" }]}
      />
      {nova && (
        <Input
          label="Nome da pasta nova"
          value={value}
          maxLength={PASTA_MAX}
          placeholder="ex.: Lote novembro"
          hint={hint}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      )}
    </div>
  );
}
