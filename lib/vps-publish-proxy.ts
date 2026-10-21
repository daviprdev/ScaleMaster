/**
 * lib/vps-publish-proxy.ts — Proxies da VPS para a publicação na Meta.
 *
 * PUBLISH_PROXIES (.env.production, URLs separadas por vírgula) vale para todo
 * post que NÃO usa o estoque do usuário (use_proxy_pool=false). Cada post cai
 * numa das proxies pelo hash do seu id: posts diferentes se espalham entre
 * elas, e as fases do mesmo post (criar container, conferir status, publicar)
 * saem pelo mesmo IP mesmo em execuções diferentes do cron.
 *
 * Antes de usar, a proxy é testada (resultado guardado por 2 min). A que não
 * responde (CONNECT recusado, 407/466 do provedor, timeout) é pulada e o post
 * vai para a próxima viva. Sem nenhuma viva, ou sem PUBLISH_PROXIES, a chamada
 * sai direto da VPS, como antes.
 */

// Sem imports `@/`: meta-publish.ts usa este módulo e é compilado isolado pela
// suíte de testes, fora do resolver de paths do Next.
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

const CHECK_TTL_MS = 2 * 60_000;
const CHECK_TIMEOUT_MS = 8_000;

interface VpsProxy {
  label: string; // host:porta — nunca a credencial
  agent: ProxyAgent;
  alive: boolean;
  checkedAt: number;
  pending?: Promise<boolean>;
}

// globalThis: cada rota do Next tem seu bundle, e o estado (agentes e saúde)
// precisa ser um só no processo.
const store = globalThis as unknown as {
  __vpsPublishProxies?: { raw: string; list: VpsProxy[] };
};

function loadProxies(): VpsProxy[] {
  const raw = process.env.PUBLISH_PROXIES ?? "";
  if (store.__vpsPublishProxies?.raw === raw) return store.__vpsPublishProxies.list;

  const list: VpsProxy[] = [];
  raw.split(",").map((s) => s.trim()).filter(Boolean).forEach((url, i) => {
    try {
      const label = `#${i + 1} ${new URL(url).host}`;
      list.push({ label, agent: new ProxyAgent(url), alive: false, checkedAt: 0 });
    } catch {
      console.warn(`[vps-proxy] PUBLISH_PROXIES #${i + 1} inválida — ignorada.`);
    }
  });
  store.__vpsPublishProxies = { raw, list };
  return list;
}

function isAlive(p: VpsProxy): Promise<boolean> {
  if (Date.now() - p.checkedAt < CHECK_TTL_MS) return Promise.resolve(p.alive);
  p.pending ??= (async () => {
    const wasAlive = p.alive;
    try {
      // Qualquer resposta HTTP serve: só importa o túnel até a Meta abrir.
      const res = await undiciFetch("https://graph.instagram.com/", {
        dispatcher: p.agent,
        redirect: "manual",
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      } as any);
      await res.body?.cancel().catch(() => {});
      p.alive = true;
      if (!wasAlive && p.checkedAt > 0) console.log(`[vps-proxy] ✓ ${p.label} voltou a responder.`);
    } catch (e) {
      p.alive = false;
      const cause = (e as { cause?: { message?: string } })?.cause?.message ?? (e instanceof Error ? e.message : String(e));
      console.warn(`[vps-proxy] ⚠ ${p.label} não respondeu (${cause.slice(0, 120)}) — fora por 2 min.`);
    } finally {
      p.checkedAt = Date.now();
      p.pending = undefined;
    }
    return p.alive;
  })();
  return p.pending;
}

// FNV-1a 32 bits: mesmo id → mesma proxy em qualquer execução.
function hashIndex(key: string, size: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % size;
}

/**
 * Dispatcher da proxy da VPS para esta publicação, ou undefined para sair
 * direto da VPS (PUBLISH_PROXIES vazio ou nenhuma proxy viva).
 * `key` é o id estável do post/container.
 */
export async function vpsPublishDispatcher(key: string): Promise<Dispatcher | undefined> {
  const list = loadProxies();
  if (list.length === 0) return undefined;

  const start = hashIndex(key, list.length);
  for (let i = 0; i < list.length; i++) {
    const p = list[(start + i) % list.length];
    if (await isAlive(p)) {
      console.log(`[vps-proxy] ${key.slice(0, 8)}… → ${p.label}`);
      return p.agent;
    }
  }
  console.error(`[vps-proxy] ⛔ nenhuma das ${list.length} proxies da VPS respondeu — ${key.slice(0, 8)}… sai direto da VPS.`);
  return undefined;
}
