/**
 * lib/publish-failure-alert.ts — Texto do alerta "postagens falharam".
 *
 * Mostra o erro exatamente como a Meta devolveu e quais contas, sem concluir
 * nada sobre o estado da conta: quem decide se é conta, app ou instabilidade da
 * Meta é o usuário.
 */

export interface FailedPostRow {
  error_message: string | null;
  username: string;
}

export interface PublishFailureAlert {
  title: string;
  body: string;
}

export function buildPublishFailureAlert(rows: FailedPostRow[]): PublishFailureAlert | null {
  if (rows.length === 0) return null;

  // Agrupa pelo erro: o mais frequente vai no corpo do push.
  const byError = new Map<string, Set<string>>();
  const countByError = new Map<string, number>();
  for (const r of rows) {
    const err = (r.error_message ?? "Erro sem mensagem").trim();
    if (!byError.has(err)) byError.set(err, new Set());
    byError.get(err)!.add(r.username);
    countByError.set(err, (countByError.get(err) ?? 0) + 1);
  }
  const [topError, topUsers] = [...byError.entries()].sort(
    (a, b) => (countByError.get(b[0]) ?? 0) - (countByError.get(a[0]) ?? 0)
  )[0];

  const users = [...topUsers];
  const shown = users.slice(0, 3).map((u) => `@${u}`).join(", ");
  const more = users.length > 3 ? ` e mais ${users.length - 3}` : "";
  const otherErrors = byError.size - 1;

  const n = rows.length;
  return {
    title: n > 1 ? `⚠️ ${n} postagens falharam` : "⚠️ 1 postagem falhou",
    body:
      `Erro da Meta: "${topError.slice(0, 120)}" em ${shown}${more}.` +
      (otherErrors > 0 ? ` (+${otherErrors} outro${otherErrors > 1 ? "s" : ""} erro${otherErrors > 1 ? "s" : ""})` : "") +
      " Confira no Postar.",
  };
}
