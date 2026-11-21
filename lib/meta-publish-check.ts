/**
 * lib/meta-publish-check.ts — Verificação de publicação, só leitura.
 *
 * Duas leituras na Graph API (Instagram Login), nenhuma publica nada:
 *   GET /{ig-id}?fields=account_type            → BUSINESS / MEDIA_CREATOR / PERSONAL
 *   GET /{ig-id}/content_publishing_limit       → só responde se a Meta libera publicar
 * O resultado mostra o que a Meta respondeu, sem concluir que a conta "caiu".
 */

export interface MetaError {
  message?: string;
  code?: number;
  error_subcode?: number;
}

export interface PublishCheck {
  /** true = a Meta respondeu a cota de publicação (publicar está liberado para o token). */
  can_publish: boolean;
  account_type: string | null;
  /** Posts usados nas últimas 24 h, segundo a Meta. */
  quota_usage: number | null;
  quota_total: number | null;
  /** Erro exato devolvido pela Meta, quando houver. */
  meta_error: string | null;
  /** Frase pronta para a tela. */
  summary: string;
}

export function summarizePublishCheck(input: {
  accountType: { account_type?: string; error?: MetaError } | null;
  limit: { data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>; error?: MetaError } | null;
}): PublishCheck {
  const accountType = input.accountType?.account_type ?? null;
  const limitRow = input.limit?.data?.[0];
  const canPublish = !!limitRow && !input.limit?.error;
  const err = input.limit?.error ?? input.accountType?.error ?? null;
  const metaError = err?.message ? `${err.message}${err.code != null ? ` (code ${err.code})` : ""}` : null;

  const tipo = accountType === "PERSONAL" ? "pessoal" : accountType ? accountType.toLowerCase() : "tipo não informado";
  let summary: string;
  if (canPublish) {
    summary = `Publicação liberada pela Meta · conta ${tipo} · ${limitRow?.quota_usage ?? 0}/${limitRow?.config?.quota_total ?? "?"} posts nas últimas 24 h.`;
  } else if (accountType === "PERSONAL") {
    summary = "A Meta informa que a conta é pessoal — a API só publica em conta profissional (criador ou empresa).";
  } else {
    summary = `A Meta não liberou a consulta de publicação · conta ${tipo}${metaError ? ` · resposta: ${metaError}` : ""}.`;
  }

  return {
    can_publish: canPublish,
    account_type: accountType,
    quota_usage: limitRow?.quota_usage ?? null,
    quota_total: limitRow?.config?.quota_total ?? null,
    meta_error: metaError,
    summary,
  };
}
