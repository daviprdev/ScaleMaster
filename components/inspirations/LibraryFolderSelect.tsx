"use client";

import { useEffect, useState } from "react";
import { Folder, Loader2 } from "lucide-react";

interface LibraryFolder {
  id: string;
  name: string;
}

interface LibraryFolderSelectProps {
  value: string;
  onChange: (folderId: string) => void;
}

/**
 * Seletor de pasta de destino para "Salvar na Biblioteca" das Inspirações.
 *
 * Existe porque a Biblioteca não tem mais "Sem pasta": todo vídeo salvo precisa
 * cair dentro de uma pasta, senão fica invisível na UI. Busca as pastas uma vez;
 * quando não há nenhuma, orienta o usuário a criar na Biblioteca.
 */
export function LibraryFolderSelect({ value, onChange }: LibraryFolderSelectProps) {
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/library/folders", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { folders?: LibraryFolder[] }) => {
        if (!alive) return;
        const list = data.folders ?? [];
        setFolders(list);
        // Seleção automática quando há exatamente uma pasta.
        if (!value && list.length === 1) onChange(list[0].id);
      })
      .catch(() => { if (alive) setFolders([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
        style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
        <Loader2 size={11} className="animate-spin" />Pastas...
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <a
        href="/dashboard/library"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
        style={{ background: "rgba(255,180,0,0.08)", border: "0.5px solid rgba(255,180,0,0.25)", color: "rgba(255,200,60,0.9)" }}
        title="Crie uma pasta na Biblioteca para poder salvar"
      >
        <Folder size={11} />Crie uma pasta na Biblioteca
      </a>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
      style={{
        background: value ? "rgba(0,229,255,0.08)" : "rgba(255,180,0,0.08)",
        border: value ? "0.5px solid rgba(0,229,255,0.25)" : "0.5px solid rgba(255,180,0,0.3)",
      }}>
      <Folder size={11} style={{ color: value ? "rgba(0,229,255,0.9)" : "rgba(255,200,60,0.9)" }} />
      <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Salvar em:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-xs font-semibold outline-none cursor-pointer"
        style={{ color: value ? "rgba(0,229,255,0.95)" : "rgba(255,200,60,0.95)" }}
      >
        <option value="" disabled style={{ color: "#000" }}>Selecione…</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id} style={{ color: "#000" }}>{f.name}</option>
        ))}
      </select>
    </div>
  );
}
