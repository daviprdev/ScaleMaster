// Tokens gerados via Instagram Login funcionam com graph.instagram.com
const GRAPH_API = "https://graph.instagram.com/v21.0";

export interface MetaPublishResult {
  status: "ok" | "error";
  media_id?: string;
  error?: string;
}

async function createMediaContainer(
  igAccountId: string,
  videoUrl: string,
  caption: string,
  token: string
): Promise<string> {
  // Normaliza: remove espaços extremos e respeita limite de 2200 chars da Meta API.
  // Nunca envia undefined/"undefined" — causaria posts sem legenda de forma silenciosa.
  const captionFinal = (typeof caption === "string" ? caption : "").trim().slice(0, 2200);

  // Log obrigatório ANTES da requisição HTTP — prova visual nos logs da Vercel
  // de que a legenda não estava vazia ao chegar na Meta API.
  console.log(
    `[meta-publish] ENVIANDO LEGENDA PARA A META: "${captionFinal.slice(0, 120)}` +
    `${captionFinal.length > 120 ? "…" : ""}" | ${captionFinal.length} char(s) | igId=${igAccountId.slice(0, 10)}…`
  );

  // URLSearchParams codifica espaços como "+" (application/x-www-form-urlencoded),
  // mas a Meta Graph API descarta silenciosamente captions com quebras de linha (\n),
  // emojis ou aspas quando recebe "+" em vez de "%20".
  // encodeURIComponent usa RFC 3986 (%20, %0A, %22, etc.) — sem ambiguidade.
  const bodyParts = [
    `media_type=REELS`,
    `video_url=${encodeURIComponent(videoUrl)}`,
    `access_token=${encodeURIComponent(token)}`,
  ];
  if (captionFinal) {
    bodyParts.push(`caption=${encodeURIComponent(captionFinal)}`);
  }

  const res = await fetch(`${GRAPH_API}/${igAccountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyParts.join("&"),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message ?? "Falha ao criar container de mídia.");
  }
  return data.id;
}

async function pollContainerStatus(
  creationId: string,
  token: string,
  // 6 tentativas × 8s = 48s max — fica dentro do orçamento de 60s do Hobby plan
  maxAttempts = 6,
  intervalMs = 8_000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 5_000 : intervalMs));
    const res = await fetch(
      `${GRAPH_API}/${creationId}?fields=status_code&access_token=${token}`,
      { signal: AbortSignal.timeout(15_000) }
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
  token: string
): Promise<string> {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: token,
  });
  const res = await fetch(`${GRAPH_API}/${igAccountId}/media_publish`, {
    method: "POST",
    body: params,
    signal: AbortSignal.timeout(15_000),
  });
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
 * Cria o container de mídia e retorna o creation_id.
 * Não faz polling — use pollContainerStatusOnce + publishReadyContainer depois.
 */
export async function createMediaContainerOnly(
  igAccountId: string,
  videoUrl: string,
  caption: string,
  token: string
): Promise<string> {
  return createMediaContainer(igAccountId, videoUrl, caption, token);
}

export type ContainerPollStatus = "finished" | "in_progress" | "error";

/**
 * Verifica o status do container UMA vez (sem loop).
 * Retorna "finished", "in_progress" ou "error".
 */
export async function pollContainerStatusOnce(
  creationId: string,
  token: string
): Promise<ContainerPollStatus> {
  const res = await fetch(
    `${GRAPH_API}/${creationId}?fields=status_code&access_token=${token}`,
    { signal: AbortSignal.timeout(15_000) }
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
  token: string
): Promise<string> {
  return publishContainer(igAccountId, creationId, token);
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
  caption: string
): Promise<MetaPublishResult> {
  try {
    const creationId = await createMediaContainer(
      igBusinessAccountId,
      videoUrl,
      caption,
      metaAccessToken
    );
    await pollContainerStatus(creationId, metaAccessToken);
    const mediaId = await publishContainer(igBusinessAccountId, creationId, metaAccessToken);
    return { status: "ok", media_id: mediaId };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
}
