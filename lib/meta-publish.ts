// Tokens gerados via Instagram Login funcionam com graph.instagram.com
const GRAPH_API = "https://graph.instagram.com/v21.0";

// Chamadas à Graph API oficial saem server-to-server: pelo proxy do estoque
// quando o post usa "Usar minhas proxies" (dispatcher vindo do chamador), senão
// pelas proxies da VPS (PUBLISH_PROXIES, lib/vps-publish-proxy) ou direto.
// undici.fetch em vez do fetch global do Next.js: o patch de cache do Next
// pode alterar/reter respostas que aqui precisam ser lidas cruas.
import { randomUUID } from "crypto";
import { fetch as undiciFetch, type Dispatcher } from "undici";
// Import relativo (e não `@/lib/...`) de propósito: a suíte de testes compila
// este arquivo isolado com `tsc`, fora do resolver de paths do Next.
import { validateInstagramCaption, InvalidCaptionError } from "./reel-captions";
import { vpsPublishDispatcher } from "./vps-publish-proxy";

/**
 * Sanitização de TRANSPORTE — e nada além disso.
 *
 * Faz apenas duas transformações, ambas necessárias para o texto atravessar
 * HTTP intacto e ambas explicitamente permitidas:
 *   - remove bytes nulos (`\x00`), que truncam a string na maioria dos parsers;
 *   - remove caracteres de controle C0, exceto \t \n \r, que são válidos em
 *     legenda e precisam sobreviver.
 *   - `trim()` do espaço EXTERNO (a Meta ignora, e evita legenda "vazia" que
 *     é só espaço virar um `caption=%20`).
 *
 * NÃO é um "consertador". Proibido aqui: slice/truncate, remoção automática de
 * hashtags ou @menções, normalização de espaços internos, troca de aspas,
 * lowercase. Legenda fora dos limites do Instagram NÃO é ajustada — é recusada
 * por `assertCaptionValid` logo abaixo.
 *
 * Emojis, acentos, quebras de linha e o resto do Unicode passam intactos.
 */
function sanitizeCaption(raw: string): string {
  return raw
    .replace(/\x00/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

/**
 * DEFESA FINAL, imediatamente antes de montar o payload.
 *
 * As rotas já validam ao resolver a legenda, mas um fluxo legado (ou uma linha
 * gravada direto no banco) pode chegar aqui com uma legenda inválida. Nesse
 * caso o transporte BLOQUEIA — não corta, não conserta, não publica pela
 * metade. Lançar aqui é o que garante que a requisição à Meta nem sai.
 *
 * O log não inclui a legenda: só os números que explicam a recusa.
 */
function assertCaptionValid(caption: string, igAccountId: string): void {
  if (caption === "") return;                 // "sem legenda" é válido
  const validation = validateInstagramCaption(caption);
  if (validation.valid) return;

  console.error(
    `[meta] legenda recusada no transporte ig=${igAccountId.slice(0, 10)}… ` +
    `code=${validation.error?.code} chars=${validation.length} ` +
    `hashtags=${validation.hashtagCount} mentions=${validation.mentionCount}`
  );
  throw new InvalidCaptionError(validation);
}

/**
 * Onde o Reel aparece no perfil (parâmetro `share_to_feed` da Meta).
 *
 * Referência oficial (POST /{ig-user-id}/media):
 *   "When true, indicates that the reel can appear in both the Feed and Reels
 *    tabs. When false, indicates the reel can only appear in the Reels tab."
 *
 * Só existe para media_type=REELS — nunca é enviado em STORIES.
 *
 *   true      → Reels + grade
 *   false     → somente Reels
 *   null/undef→ parâmetro NÃO enviado (comportamento anterior à feature; a Meta
 *               não documenta qual é o default, então não assumimos nenhum).
 */
export type ShareToFeed = boolean | null | undefined;

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
  mediaType: "REELS" | "STORIES" = "REELS",
  shareToFeed: ShareToFeed = null,
  dispatcher?: Dispatcher
): Promise<string> {
  // Sanitiza + normaliza: escopo LOCAL à chamada — nunca compartilhado entre contas.
  // Nunca envia undefined/"undefined" — causaria posts sem legenda de forma silenciosa.
  const captionFinal = sanitizeCaption(typeof caption === "string" ? caption : "");

  // Bloqueia ANTES de qualquer coisa: nenhuma requisição à Meta é montada nem
  // enviada com legenda fora dos limites. Stories não levam caption, então o
  // texto nem chega a ser enviado — mas validar aqui também evita que uma
  // legenda inválida "passe" só porque o destino a ignoraria.
  if (mediaType !== "STORIES") assertCaptionValid(captionFinal, igAccountId);

  // Form-encoded body — único formato documentado pela Meta Graph API para o endpoint
  // POST /{ig-user-id}/media (todos os exemplos oficiais usam curl -d, i.e. form-encoded).
  // JSON body foi testado e causa drop silencioso do campo caption: a Meta cria o container
  // (200 OK + id válido) mas ignora os campos não reconhecidos no formato JSON.
  // encodeURIComponent (RFC 3986) garante %20 para espaços, %0A para \n, %F0%9F… para emojis.
  // caption omitida do payload quando vazia — evita `caption=` que a Meta pode rejeitar.
  // Stories não suportam caption pela API — omitida quando mediaType=STORIES.
  // Para Stories: detecta image_url vs video_url pela extensão da URL.
  // Reels sempre usam video_url.
  const isImageStory = mediaType === "STORIES" && /\.(jpg|jpeg|png)(\?|$)/i.test(videoUrl);
  const mediaUrlKey = isImageStory ? "image_url" : "video_url";

  // share_to_feed: SOMENTE para Reels e SOMENTE quando há uma escolha booleana
  // persistida. O teste `typeof === "boolean"` é proposital — um `if (shareToFeed)`
  // faria o valor `false` (somente Reels) sumir do payload em silêncio.
  const sendsShareToFeed = mediaType === "REELS" && typeof shareToFeed === "boolean";

  const formParts = [
    `media_type=${mediaType}`,
    `${mediaUrlKey}=${encodeURIComponent(videoUrl)}`,
    ...(captionFinal && mediaType !== "STORIES" ? [`caption=${encodeURIComponent(captionFinal)}`] : []),
    ...(sendsShareToFeed ? [`share_to_feed=${String(shareToFeed)}`] : []),
    `access_token=${encodeURIComponent(token)}`,
  ];
  const formBody = formParts.join("&");

  if (mediaType === "REELS") {
    console.log(
      `[meta-reel] share_to_feed=${sendsShareToFeed ? String(shareToFeed) : "não enviado"}`
    );
  }
  console.log(
    `[meta] container ig=${igAccountId.slice(0, 10)}… type=${mediaType} ` +
    `caption_chars=${captionFinal.length}`
  );

  // undiciFetch: evita o fetch global patcheado pelo Next.js (cache/retentativa)
  const fetchOpts: Record<string, unknown> = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    signal: AbortSignal.timeout(45_000),
  };
  if (dispatcher) fetchOpts.dispatcher = dispatcher;
  const res = await undiciFetch(`${GRAPH_API}/${igAccountId}/media`, fetchOpts as any);

  // Lê como texto antes de parsear — captura warnings/messages ocultas que a Meta
  // inclui no body mesmo com 200 OK (ex: campo ignorado, scope insuficiente).
  const rawText = await res.text();

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
  dispatcher?: Dispatcher
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 5_000 : intervalMs));
    const pollOpts: Record<string, unknown> = { signal: AbortSignal.timeout(45_000) };
    if (dispatcher) pollOpts.dispatcher = dispatcher;
    const res = await undiciFetch(
      `${GRAPH_API}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
      pollOpts as any
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
  dispatcher?: Dispatcher
): Promise<string> {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: token,
  });
  console.log(`[meta] publish ig=${igAccountId.slice(0, 10)}… creation=${creationId.slice(0, 10)}…`);
  const pubOpts: Record<string, unknown> = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(45_000),
  };
  if (dispatcher) pubOpts.dispatcher = dispatcher;
  const res = await undiciFetch(`${GRAPH_API}/${igAccountId}/media_publish`, pubOpts as any);
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
  dispatcher?: Dispatcher
): Promise<void> {
  const sanitized = sanitizeCaption(caption);
  if (!sanitized) return;
  const formBody = [
    `caption=${encodeURIComponent(sanitized)}`,
    `comment_enabled=1`,
    `access_token=${encodeURIComponent(token)}`,
  ].join("&");
  const capOpts: Record<string, unknown> = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
    signal: AbortSignal.timeout(45_000),
  };
  if (dispatcher) capOpts.dispatcher = dispatcher;
  const res = await undiciFetch(`${GRAPH_API}/${mediaId}`, capOpts as any);
  const rawText = await res.text();
  if (!res.ok) {
    console.warn(`[meta] caption update falhou media=${mediaId} http=${res.status}`);
  }
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
  mediaType: "REELS" | "STORIES" = "REELS",
  shareToFeed: ShareToFeed = null,
  dispatcher?: Dispatcher
): Promise<string> {
  return createMediaContainer(igAccountId, videoUrl, caption, token, mediaType, shareToFeed, dispatcher);
}

export type ContainerPollStatus = "finished" | "in_progress" | "error";

/**
 * Verifica o status do container UMA vez (sem loop).
 * Retorna "finished", "in_progress" ou "error".
 */
export async function pollContainerStatusOnce(
  creationId: string,
  token: string,
  dispatcher?: Dispatcher
): Promise<ContainerPollStatus> {
  const pollOnceOpts: Record<string, unknown> = { signal: AbortSignal.timeout(45_000) };
  if (dispatcher) pollOnceOpts.dispatcher = dispatcher;
  const res = await undiciFetch(
    `${GRAPH_API}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    pollOnceOpts as any
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
  dispatcher?: Dispatcher
): Promise<string> {
  return publishContainer(igAccountId, creationId, token, dispatcher);
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
  shareToFeed: ShareToFeed = null,
  dispatcher?: Dispatcher
): Promise<MetaPublishResult> {
  try {
    // Fluxo de uma vez só: as três fases saem pela mesma proxy da VPS.
    dispatcher ??= await vpsPublishDispatcher(randomUUID());
    const creationId = await createMediaContainer(
      igBusinessAccountId,
      videoUrl,
      caption,
      metaAccessToken,
      "REELS",
      shareToFeed,
      dispatcher
    );
    // 4 tentativas × 6s = 5s inicial + 3×6s = 23s máx de espera.
    // Se a Meta não processar em 23s, retorna erro "não terminou de processar"
    // que o publish-scheduled trata como retryable (tenta de novo no próximo cron 1min).
    await pollContainerStatus(creationId, metaAccessToken, 4, 6_000, dispatcher);
    const mediaId = await publishContainer(igBusinessAccountId, creationId, metaAccessToken, dispatcher);
    return { status: "ok", media_id: mediaId };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
}
