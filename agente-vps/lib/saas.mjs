import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Agente e app em máquinas diferentes (12/11, agente na KVM 8): o app guarda
 * as fotos enviadas no Estruturar e mostra os prints das etapas, cada um na
 * sua pasta. Aqui o agente:
 *   - baixa do app as fotos que faltam em /opt/scalemaster/midias
 *     (GET /api/emulador/agente/midias e .../midias/arquivo?path=);
 *   - manda cada print para o app (POST /api/emulador/agente/prints?job=&etapa=).
 * Mesma máquina: as fotos já batem de tamanho (nada desce) e o print sobe
 * igual (o app grava o mesmo arquivo). Tudo com o código do agente (Bearer smag_).
 */

let alvo = null;

/** Endereço do SaaS e código do agente (definidos no início do laço do agente). */
export function definirSaas(url, token) {
  alvo = url && token ? { url: String(url).replace(/\/+$/, ""), token } : null;
}

const cabecalho = () => ({ Authorization: `Bearer ${alvo.token}` });

/** Caminho relativo seguro (sem absoluto, sem "..", sem barra invertida); null se não for. */
export function relativoSeguro(rel) {
  const r = String(rel ?? "");
  if (!r || r.startsWith("/") || r.includes("\\") || r.includes("\0")) return null;
  const partes = r.split("/");
  if (partes.some((p) => !p || p === "." || p === "..")) return null;
  return r;
}

/** Manda o PNG do print da etapa para o app. true = gravado lá. Nunca lança. */
export async function enviarPrint(jobId, etapa, png, { fetcher = fetch } = {}) {
  if (!alvo || !png?.length) return false;
  try {
    const res = await fetcher(`${alvo.url}/api/emulador/agente/prints?job=${encodeURIComponent(jobId)}&etapa=${encodeURIComponent(etapa)}`, {
      method: "POST",
      headers: { ...cabecalho(), "Content-Type": "image/png" },
      body: png,
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Baixa do app as fotos que faltam (ou com tamanho diferente) na pasta de
 * mídias desta máquina. Devolve quantas baixou; erro de rede = lança.
 */
export async function sincronizarMidias(raiz, { log = () => {}, fetcher = fetch } = {}) {
  if (!alvo) return 0;
  const res = await fetcher(`${alvo.url}/api/emulador/agente/midias`, { headers: cabecalho(), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`o SaaS respondeu ${res.status} na lista de fotos`);
  const { files } = await res.json();
  let baixadas = 0;
  for (const f of Array.isArray(files) ? files : []) {
    const rel = relativoSeguro(f?.path);
    if (!rel) continue;
    const local = path.join(raiz, rel);
    try {
      if (existsSync(local) && statSync(local).size === f.size) continue;
    } catch {
      /* baixa de novo */
    }
    const r = await fetcher(`${alvo.url}/api/emulador/agente/midias/arquivo?path=${encodeURIComponent(rel)}`, { headers: cabecalho(), signal: AbortSignal.timeout(120_000) });
    if (!r.ok) {
      log(`foto ${rel}: o SaaS respondeu ${r.status}`);
      continue;
    }
    mkdirSync(path.dirname(local), { recursive: true });
    writeFileSync(local, Buffer.from(await r.arrayBuffer()));
    baixadas += 1;
  }
  if (baixadas) log(`fotos: ${baixadas} baixada(s) do SaaS para ${raiz}`);
  return baixadas;
}
