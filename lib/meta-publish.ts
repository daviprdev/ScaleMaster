// Tokens gerados via Instagram Login funcionam com graph.instagram.com
const GRAPH_API = "https://graph.instagram.com/v21.0";

import type { ProxyAgent } from "undici";
import { proxyInit } from "@/lib/proxy";

/**
 * Remove caracteres que corrompem envios em lote silenciosamente:
 *   - Bytes nulos ( ) — causam truncamento na maioria dos parsers HTTP
 *   - Caracteres de controle C0 (exceto \t=0x09, \n=0x0A, \r=0x0D que são válidos em legendas)
 * Aplica trim + limite de 2200 chars da Meta API.
 * Chamada por conta, antes do encodeURIComponent, para isolar cada legenda.
 */
function sanitizeCaption(raw: string): string {
  return raw
    .replace(/\x00/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .slice(0, 2200);
}

export interface MetaPublishResult {
  status: "ok" | "error";
  media_id?: string;
  error?: string;
}

async function createMediaContainer(
  igAccountId: string,
  videoUrl: string,
  caption: string,
  token: string,
  proxy: ProxyAgent | null = null
): Promise<string> {
  // Sanitiza + normaliza: escopo LOCAL à chamada — nunca compartilhado entre contas.
  // Nunca envia undefined/"undefined" — causaria posts sem legenda de forma silenciosa.
  const captionFinal = sanitizeCaption(typeof caption === "string" ? caption : "");

  // Form-encoded body — único formato documentado pela Meta Graph API para o endpoint
  // POST /{ig-user-id}/media (todos os exemplos oficiais usam curl -d, i.e. form-encoded).
  // JSON body foi testado e causa drop silencioso do campo caption: a Meta cria o container
  // (200 OK + id válido) mas ignora os campos não reconhecidos no formato JSON.
  // encodeURIComponent (RFC 3986) garante %20 para espaços, %0A para \n, %F0%9F… para emojis.
  // caption omitida do payload quando vazia — evita `caption=` que a Meta pode rejeitar.
  const formParts = [
    `media_type=REELS`,
    `video_url=${encodeURIComponent(videoUrl)}`,
    ...(captionFinal ? [`caption=${encodeURIComponent(captionFinal)}`] : []),
    `access_token=${encodeURIComponent(token)}`,
  ];
  const formBody = formParts.join("&");

  // Log imediatamente antes do fetch — prova visual nos logs da Vercel
  console.log('Enviando para Meta API. Legenda:', captionFinal);
  console.log(
    `[meta-publish] igId=${igAccountId.slice(0, 10)}… | ` +
    `proxy=${proxy ? "SIM" : "não"} | ` +
    `caption=${captionFinal.length} char(s): "${captionFinal.slice(0, 120)}${captionFinal.length > 120 ? "…" : ""}" | ` +
    `body[0..150]: ${formBody.slice(0, 150)}…`
  );

  const res = await fetch(`${GRAPH_API}/${igAccountId}/media`, proxyInit(proxy, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    signal: AbortSignal.timeout(15_000),
  }));

  // Lê como texto antes de parsear — captura warnings/messages ocultas que a Meta
  // inclui no body mesmo com 200 OK (ex: campo ignorado, scope insuficiente).
  const rawText = await res.text();
  console.log("META API RAW RESPONSE:", rawText);

  let data: { id?: string; error?: { message: string }; [key: string]: unknown };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    throw new Error(`Resposta não-JSON da Meta API (HTTP ${res.status}): ${rawText.slice(0, 300)}`);
  }

  if (!res.ok || !data.id) {
    throw new Error(data.error?.message ?? `Falha ao criar container (HTTP ${res.status}).`);
  }
  return data.id as string;
}

async function pollContainerStatus(
  creationId: string,
  token: string,
  // 6 tentativas × 8s = 48s max — fica dentro do orçamento de 60s do Hobby plan
  maxAttempts = 6,
  intervalMs = 8_000,
  proxy: ProxyAgent | null = null
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 5_000 : intervalMs));
    const res = await fetch(
      `${GRAPH_API}/${creationId}?fields=status_code&access_token=${token}`,
      proxyInit(proxy, { signal: AbortSignal.timeout(15_000) })
    );
    const data = (await res.json()) as {
      status_code?: string;
      error?: { message: string };
    };
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error(`Processamento de vídeo falhou com status: ${data.status_code}.`);
    }
    // IN_PROGRESS — continua aguardando
  }
  throw new Error("Timeout: o vídeo não terminou de processar no tempo esperado.");
}

async function publishContainer(
  igAccountId: string,
  creationId: string,
  token: string,
  proxy: ProxyAgent | null = null
): Promise<string> {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: token,
  });
  const res = await fetch(`${GRAPH_API}/${igAccountId}/media_publish`, proxyInit(proxy, {
    method: "POST",
    body: params,
    signal: AbortSignal.timeout(15_000),
  }));
  const data = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message ?? "Falha ao publicar o container de mídia.");
  }
  return data.id;
}

// ─────────────────────────────────────────────────────────────
// Exports para o motor de duas fases (process-loops + publish-pending)
// ─────────────────────────────────────────────────────────────

/**
 * Atualiza (ou restaura) a legenda de um post já publicado.
 * Chamada após publishReadyContainer para garantir que a Meta não dropou a
 * legenda silenciosamente durante o processamento do container.
 * Falha de forma silenciosa — não cancela o publish se o update falhar.
 */
export async function updatePostCaption(
  mediaId: string,
  caption: string,
  token: string,
  proxy: ProxyAgent | null = null
): Promise<void> {
  const sanitized = sanitizeCaption(caption);
  if (!sanitized) return;
  const formBody = [
    `caption=${encodeURIComponent(sanitized)}`,
    `comment_enabled=1`,
    `access_token=${encodeURIComponent(token)}`,
  ].join("&");
  const res = await fetch(`${GRAPH_API}/${mediaId}`, proxyInit(proxy, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    signal: AbortSignal.timeout(15_000),
  }));
  const rawText = await res.text();
  const isRateLimit = /rate.?limit|too many/i.test(rawText) || res.status === 429;
  const isOAuthErr = /OAuthException|invalid.token|token.expired/i.test(rawText);
  console.log(
    `[META DOUBLE-TAP RAW] mediaId=${mediaId} | HTTP=${res.status} | proxy=${proxy ? "SIM" : "não"} | ` +
    `caption_chars=${sanitized.length} | ` +
    `rate_limited=${isRateLimit ? "SIM!!!" : "não"} | ` +
    `oauth_err=${isOAuthErr ? "SIM!!!" : "não"} | ` +
    `raw=${rawText}`
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (JSON.parse(rawText) as { error?: { message: string } }).error?.message ?? msg; } catch { /* noop */ }
    throw new Error(msg);
  }
}

/**
 * Cria o container de mídia e retorna o creation_id.
 * Não faz polling — use pollContainerStatusOnce + publishReadyContainer depois.
 */
export async function createMediaContainerOnly(
  igAccountId: string,
  videoUrl: string,
  caption: string,
  token: string,
  proxy: ProxyAgent | null = null
): Promise<string> {
  return createMediaContainer(igAccountId, videoUrl, caption, token, proxy);
}

export type ContainerPollStatus = "finished" | "in_progress" | "error";

/**
 * Verifica o status do container UMA vez (sem loop).
 * Retorna "finished", "in_progress" ou "error".
 */
export async function pollContainerStatusOnce(
  creationId: string,
  token: string,
  proxy: ProxyAgent | null = null
): Promise<ContainerPollStatus> {
  const res = await fetch(
    `${GRAPH_API}/${creationId}?fields=status_code&access_token=${token}`,
    proxyInit(proxy, { signal: AbortSignal.timeout(15_000) })
  );
  const data = (await res.json()) as {
    status_code?: string;
    error?: { message: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? "Erro ao verificar status do container.");
  if (data.status_code === "FINISHED") return "finished";
  if (data.status_code === "ERROR" || data.status_code === "EXPIRED") return "error";
  return "in_progress";
}

/**
 * Publica um container que já está com status FINISHED.
 * Retorna o media_id do post publicado.
 */
export async function publishReadyContainer(
  igAccountId: string,
  creationId: string,
  token: string,
  proxy: ProxyAgent | null = null
): Promise<string> {
  return publishContainer(igAccountId, creationId, token, proxy);
}

// ─────────────────────────────────────────────────────────────

/**
 * Publica um vídeo como Reel via Meta Graph API.
 * Fluxo: criar container → aguardar processamento → publicar.
 */
export async function publishViaMetaAPI(
  igBusinessAccountId: string,
  metaAccessToken: string,
  videoUrl: string,
  caption: string,
  proxy: ProxyAgent | null = null
): Promise<MetaPublishResult> {
  try {
    const creationId = await createMediaContainer(
      igBusinessAccountId,
      videoUrl,
      caption,
      metaAccessToken,
      proxy
    );
    await pollContainerStatus(creationId, metaAccessToken, 6, 8_000, proxy);
    const mediaId = await publishContainer(igBusinessAccountId, creationId, metaAccessToken, proxy);
    return { status: "ok", media_id: mediaId };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
}
