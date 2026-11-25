/**
 * lib/self-fetch.ts — chama uma rota do próprio app pelo lado de dentro.
 *
 * No Cloudflare Workers um fetch para o próprio domínio não volta para o mesmo
 * Worker; usamos o service binding WORKER_SELF_REFERENCE (wrangler.jsonc). Fora
 * do Workers (Docker/dev), cai no INTERNAL_APP_URL como antes.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

type SelfBinding = { fetch(input: Request): Promise<Response> };

export async function selfFetch(path: string, init?: RequestInit): Promise<Response> {
  let binding: SelfBinding | undefined;
  try {
    const env = getCloudflareContext().env as unknown as { WORKER_SELF_REFERENCE?: SelfBinding };
    binding = env.WORKER_SELF_REFERENCE;
  } catch {
    binding = undefined; // fora do Workers
  }
  if (binding) {
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://scalemaster.tech";
    return binding.fetch(new Request(new URL(path, base), init));
  }
  const baseUrl = process.env.INTERNAL_APP_URL || "http://127.0.0.1:3000";
  return fetch(`${baseUrl}${path}`, { cache: "no-store", ...init });
}
