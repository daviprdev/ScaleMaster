export interface MetaApp {
  id: string;
  name: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Constrói a lista de apps Meta configurados via variáveis de ambiente.
 *
 * Convenção de env vars:
 *   META_APP1_CLIENT_ID     (fallback: NEXT_PUBLIC_META_CLIENT_ID)
 *   META_APP1_CLIENT_SECRET (fallback: META_CLIENT_SECRET)
 *   META_APP1_NAME          (fallback: "App 1")
 *   META_APP2_CLIENT_ID / META_APP2_CLIENT_SECRET / META_APP2_NAME
 *   ... até META_APP10_*
 *
 * Sempre server-side — nunca expor clientSecret ao frontend.
 */
export function getMetaApps(): MetaApp[] {
  const apps: MetaApp[] = [];

  for (let i = 1; i <= 10; i++) {
    const clientId =
      process.env[`META_APP${i}_CLIENT_ID`] ??
      (i === 1 ? process.env.NEXT_PUBLIC_META_CLIENT_ID : undefined);

    const clientSecret =
      process.env[`META_APP${i}_CLIENT_SECRET`] ??
      (i === 1 ? process.env.META_CLIENT_SECRET : undefined);

    if (!clientId || !clientSecret) continue;

    apps.push({
      id: `app${i}`,
      name: process.env[`META_APP${i}_NAME`] ?? `App ${i}`,
      clientId,
      clientSecret,
    });
  }

  return apps;
}

export function getMetaApp(appId: string): MetaApp | null {
  return getMetaApps().find((a) => a.id === appId) ?? null;
}
