/**
 * link-base-url.ts — domínio público dos Links Gerenciáveis, versão client-safe.
 *
 * `lib/managed-links.ts` importa `node:crypto` e por isso não pode ser
 * importado por componente "use client". Este arquivo tem só a parte que a UI
 * precisa (montar a URL pública) e nenhuma dependência de Node.
 */

/** Base configurada, sem barra no fim. Vazia quando a env var não existe. */
export function configuredRedirectBase(): string {
  return (process.env.NEXT_PUBLIC_REDIRECT_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

/**
 * Base efetiva do link público.
 *
 * Sem `NEXT_PUBLIC_REDIRECT_BASE_URL`, cai para a origem atual — o mesmo
 * deploy serve `/r/*`, então o link funciona igual. A UI mostra um aviso nesse
 * caso para ninguém divulgar uma URL `*.vercel.app` achando que é o domínio
 * definitivo.
 */
export function redirectBase(): string {
  const configured = configuredRedirectBase();
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** URL pública completa: {base}/r/{slug}. */
export function publicLinkUrl(slug: string): string {
  return `${redirectBase()}/r/${slug}`;
}

/** true quando o domínio público veio da env var (e não do fallback). */
export function hasConfiguredDomain(): boolean {
  return configuredRedirectBase().length > 0;
}
