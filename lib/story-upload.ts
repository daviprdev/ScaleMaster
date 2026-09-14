// Limites de upload de mídia para Stories — compartilhados entre a emissão da
// URL assinada e a confirmação pós-upload.
export const STORY_VALID_TYPES = ["image/jpeg", "image/jpg", "image/png", "video/mp4", "video/quicktime"];
export const STORY_MAX_IMAGE_SIZE = 8 * 1024 * 1024;   // 8 MB
export const STORY_MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

// O navegador às vezes rotula um JPEG como `image/jpg` (tipo não-canônico). A
// allowlist do bucket `videos-library` só aceita `image/jpeg`, então enviar o
// arquivo direto ao Storage com `image/jpg` era rejeitado — o upload falhava e a
// mídia nunca era salva na biblioteca. Normaliza para o tipo canônico antes de
// mandar os bytes ao Storage.
export function normalizeStoryContentType(type: string): string {
  return type === "image/jpg" ? "image/jpeg" : type;
}

// Deriva o caminho no Storage (`stories/<user_id>/<uuid>.<ext>`) a partir da URL
// pública do bucket `videos-library`. Usado para reencontrar a mídia de um Story
// já postado e garantir que ela fique salva na biblioteca (`story_media`).
// Retorna null se a URL não for do bucket/pasta esperados — nunca chuta caminho.
export function storyStoragePathFromPublicUrl(publicUrl: string, userId: string): string | null {
  const marker = "/storage/v1/object/public/videos-library/";
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  let path = publicUrl.slice(idx + marker.length);
  const q = path.indexOf("?");
  if (q !== -1) path = path.slice(0, q);
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  // Só mídia de Story do próprio usuário — evita gravar caminho alheio/arbitrário.
  if (!path.startsWith(`stories/${userId}/`)) return null;
  return path;
}
