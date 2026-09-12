// Limites de upload de mídia para Stories — compartilhados entre a emissão da
// URL assinada e a confirmação pós-upload.
export const STORY_VALID_TYPES = ["image/jpeg", "image/jpg", "image/png", "video/mp4", "video/quicktime"];
export const STORY_MAX_IMAGE_SIZE = 8 * 1024 * 1024;   // 8 MB
export const STORY_MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB
