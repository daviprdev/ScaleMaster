/**
 * lib/limites-borda.ts — o que o Nginx da VPS fazia na frente do app
 * (nginx/nginx.conf): limit_req por rota e client_max_body_size 10M.
 * Aplicado em custom-worker.ts antes do Next, com o Rate Limiting do Workers
 * (bindings "ratelimits" do wrangler.jsonc). Sem import de nada do app.
 */

export type Limitador = { limit(opts: { key: string }): Promise<{ success: boolean }> };

export interface LimitesEnv {
  LIMITE_LOGIN?: Limitador;
  LIMITE_LOGIN_GERAL?: Limitador;
  LIMITE_AUTH?: Limitador;
  LIMITE_BUSCA?: Limitador;
  LIMITE_POLL?: Limitador;
  LIMITE_VIDEO?: Limitador;
}

/** Mesmo teto do client_max_body_size do Nginx. */
export const MAX_CORPO = 10 * 1024 * 1024;

/** Limitadores que valem para o caminho, com a chave de cada um. Mesmo mapa das locations do Nginx. */
export function limitesDoCaminho(pathname: string, ip: string, env: LimitesEnv): [Limitador | undefined, string][] {
  if (pathname === "/api/auth/login" || pathname === "/auth/callback") {
    return [
      [env.LIMITE_LOGIN, ip],
      [env.LIMITE_LOGIN_GERAL, "todos"],
    ];
  }
  if (pathname.startsWith("/api/auth/")) return [[env.LIMITE_AUTH, ip]];
  if (/^\/api\/(inspirations\/scrape(-account)?|clone\/search)$/.test(pathname)) return [[env.LIMITE_BUSCA, ip]];
  if (/^\/api\/(inspirations\/scrape(-account)?|clone\/search)\//.test(pathname)) return [[env.LIMITE_POLL, ip]];
  if (pathname === "/api/video/process") return [[env.LIMITE_VIDEO, ip]];
  return [];
}

function json(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
}

/** Resposta de bloqueio (413/429) ou null para seguir até o app. */
export async function bloqueioNaBorda(request: Request, env: LimitesEnv): Promise<Response | null> {
  const tamanho = Number(request.headers.get("content-length") ?? 0);
  if (tamanho > MAX_CORPO) return json(413, "Arquivo grande demais (máx. 10 MB).");
  const ip = request.headers.get("cf-connecting-ip") ?? "sem-ip";
  const { pathname } = new URL(request.url);
  for (const [limitador, chave] of limitesDoCaminho(pathname, ip, env)) {
    // decisão: binding ausente (wrangler dev antigo, next dev) não bloqueia.
    if (limitador && !(await limitador.limit({ key: chave })).success) {
      return json(429, "Muitas requisições. Aguarde um pouco e tente de novo.");
    }
  }
  return null;
}
