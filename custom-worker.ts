/**
 * custom-worker.ts — Worker do Cloudflare: o app Next (OpenNext) + os crons.
 *
 * Cada expressão de `triggers.crons` do wrangler.jsonc dispara as rotas da
 * tabela abaixo, com o mesmo Bearer CRON_SECRET que os timers systemd da VPS
 * mandavam. As rotas são chamadas pelo service binding WORKER_SELF_REFERENCE:
 * cada uma vira uma requisição própria, com seus próprios limites de CPU.
 *
 * Saíram da lista (sem equivalente no Workers): process-videos (FFmpeg) e
 * process-scrape-jobs (python-server).
 */
// @ts-ignore — `.open-next/worker.js` é gerado no build (opennextjs-cloudflare build)
import { default as handler } from "./.open-next/worker.js";

interface Env {
  CRON_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
  WORKER_SELF_REFERENCE: { fetch(input: Request): Promise<Response> };
}

type Rota = string | { path: string; method: "POST" };

export const CRONS: Record<string, Rota[]> = {
  "* * * * *": ["/api/cron/publish-scheduled"],
  "*/2 * * * *": ["/api/cron/publish-pending", "/api/cron/finalize-inspiration-scrapes"],
  "*/5 * * * *": [
    "/api/cron/prefetch-clone-urls",
    "/api/cron/process-loops",
    "/api/cron/sync-post-insights",
  ],
  "*/10 * * * *": ["/api/cron/sync-distribute-accounts", "/api/cron/check-health-alerts"],
  "*/15 * * * *": ["/api/cron/sync-account-views", "/api/cron/daily-profit-notification"],
  "*/30 * * * *": ["/api/cron/story-templates"],
  "0 * * * *": ["/api/cron/check-views-goal"],
  "0 */12 * * *": ["/api/cron/refresh-tokens"],
  "0 2 * * *": [{ path: "/api/analytics/sync", method: "POST" }],
};

async function chamar(env: Env, rota: Rota): Promise<void> {
  const path = typeof rota === "string" ? rota : rota.path;
  const method = typeof rota === "string" ? "GET" : rota.method;
  const base = env.NEXT_PUBLIC_APP_URL || "https://scalemaster.tech";
  const inicio = Date.now();
  const res = await env.WORKER_SELF_REFERENCE.fetch(
    new Request(new URL(path, base), {
      method,
      headers: { Authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
    })
  );
  const corpo = await res.text().catch(() => "");
  const linha = `[cron] ${path} → HTTP ${res.status} em ${Date.now() - inicio} ms`;
  if (res.ok) console.log(linha);
  else console.error(`${linha}: ${corpo.slice(0, 300)}`);
  if (!res.ok) throw new Error(linha);
}

export default {
  fetch: handler.fetch,

  async scheduled(event: { cron: string }, env: Env): Promise<void> {
    const rotas = CRONS[event.cron];
    if (!rotas) {
      console.error(`[cron] expressão sem rotas: ${event.cron}`);
      return;
    }
    const resultados = await Promise.allSettled(rotas.map((r) => chamar(env, r)));
    const falhas = resultados.filter((r) => r.status === "rejected").length;
    // Falha marca a execução como erro no painel (igual ao `Failed` do systemd).
    if (falhas > 0) throw new Error(`[cron] ${falhas} de ${rotas.length} rota(s) falharam em ${event.cron}`);
  },
};
