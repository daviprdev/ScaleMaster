/**
 * Integridade da Biblioteca — as definições canônicas.
 *
 * A Biblioteca tem QUATRO operações distintas. Elas nunca se misturam, e é a
 * confusão entre elas que já custou mídia:
 *
 *   1. EXCLUIR PASTA
 *      Remove só a organização. Os vídeos sobrevivem e caem em "Sem pasta"
 *      pela FK `videos_library.folder_id ON DELETE SET NULL`.
 *      NUNCA apaga videos_library. NUNCA apaga Storage.
 *
 *   2. EXCLUIR VÍDEO
 *      Única ação normal que remove registro e arquivo juntos, sob pedido
 *      explícito do dono. Banco primeiro, Storage depois.
 *
 *   3. LIMPAR REGISTRO QUEBRADO   → isBrokenRecord()
 *      Linha existe, arquivo não. Remove SÓ o banco. Nunca chama storage.remove.
 *
 *   4. LIMPAR ARQUIVO ÓRFÃO       → isOrphanFile()
 *      Arquivo existe, nenhuma referência, passou o grace period.
 *      Remove SÓ o Storage. Admin-only.
 *
 * REGRA ABSOLUTA: `folder_id IS NULL` significa "Sem pasta" — um estado
 * perfeitamente válido — e NUNCA é critério de registro quebrado ou de órfão.
 * A versão antiga do cleanup usava exatamente esse critério e por isso podia
 * apagar mídia válida.
 */

/** Quanto tempo um arquivo recém-criado fica imune à limpeza de órfãos. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export type LibraryRow = {
  storage_path: string | null;
  /** Presente só para deixar explícito que NÃO participa da decisão. */
  folder_id?: string | null;
};

/**
 * Registro quebrado: a linha aponta para um arquivo que não está mais no
 * bucket. `existingFiles` precisa ser o inventário COMPLETO e paginado — uma
 * listagem truncada faria arquivos existentes parecerem ausentes.
 *
 * Caminhos `direct/` referenciam URL externa (sem arquivo próprio no bucket) e
 * por isso nunca são quebrados.
 */
export function isBrokenRecord(row: LibraryRow, existingFiles: ReadonlySet<string>): boolean {
  const path = row.storage_path;
  if (!path) return false;
  if (path.startsWith("direct/")) return false;
  return !existingFiles.has(path);
}

/**
 * Arquivo órfão: existe no bucket, nenhuma linha do banco o referencia e já
 * passou do grace period.
 *
 * O grace period fecha a janela entre "upload concluído" e "INSERT gravado":
 * sem ele, uma limpeza concorrente apagaria o arquivo no meio da operação.
 *
 * `references` contém tanto caminhos crus quanto URLs públicas inteiras, por
 * isso a comparação também aceita sufixo.
 */
export function isOrphanFile(
  name: string,
  references: ReadonlySet<string>,
  createdAt: string | number | Date,
  now: number = Date.now(),
  graceMs: number = ORPHAN_GRACE_MS
): boolean {
  if (references.has(name)) return false;
  for (const ref of references) {
    if (ref.endsWith(name)) return false;
  }
  const criadoEm = new Date(createdAt).getTime();
  if (!Number.isFinite(criadoEm)) return false; // sem data confiável, não apaga
  return now - criadoEm > graceMs;
}
