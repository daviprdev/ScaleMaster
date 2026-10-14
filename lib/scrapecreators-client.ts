/**
 * lib/scrapecreators-client.ts — Cliente HTTP para a API ScrapeCreators.
 *
 * Fonte oficial: https://docs.scrapecreators.com/v1/instagram/user/reels/
 *
 * A chave SCRAPECREATORS_API_KEY vive SOMENTE no backend. Nunca é enviada ao
 * navegador, nem em responses, logs ou mensagens de erro.
 */

const BASE_URL = "https://api.scrapecreators.com";

/** Resposta crua do endpoint /v1/instagram/user/reels */
export interface ReelsListResponse {
  success: boolean;
  credits_remaining: number;
  credits_charged: number;
  items: ReelItem[];
  paging_info: {
    max_id: string | null;
    more_available: boolean;
  };
  status: string;
}

/** Estrutura de um Reel na listagem */
export interface ReelItem {
  media: {
    pk: string;
    id: string;
    code: string;
    url: string; // permalink
    taken_at: number; // unix timestamp seconds
    created_at: string; // ISO 8601 UTC
    caption?: { text: string } | null;
    play_count?: number;
    ig_play_count?: number;
    like_count?: number;
    comment_count?: number;
    video_duration?: number;
    has_audio?: boolean;
    original_width?: number;
    original_height?: number;
    media_type?: number;
    product_type?: string;
    display_uri?: string; // thumbnail
    image_versions2?: {
      candidates?: { url: string; width: number; height: number }[];
    };
    video_versions?: {
      url: string;
      width: number;
      height: number;
      type?: number;
    }[];
    user?: {
      pk: string;
      username: string;
      full_name?: string;
      is_private?: boolean;
      profile_pic_url?: string;
    };
    owner?: {
      pk: string;
      username: string;
      full_name?: string;
      is_private?: boolean;
      profile_pic_url?: string;
    };
    clips_metadata?: {
      reusable_text_attribute_string?: string;
      original_sound_info?: {
        audio_asset_id?: string;
        progressive_download_url?: string;
        ig_artist?: string;
      };
    };
    timeline_pinned_user_ids?: string[];
    clips_tab_pinned_user_ids?: string[];
  };
}

/** Resposta crua do endpoint /v1/instagram/post (detalhe) */
export interface PostDetailResponse {
  success: boolean;
  credits_remaining: number;
  credits_charged: number;
  data?: {
    xdt_shortcode_media?: {
      id: string;
      shortcode: string;
      edge_media_to_caption?: {
        edges: { node: { text: string; created_at: number; id: string } }[];
      };
      taken_at_timestamp: number;
      created_at: string;
      video_url?: string;
      video_duration?: number;
      thumbnail_src?: string;
      display_url?: string;
      dimensions?: { width: number; height: number };
      edge_media_preview_like?: { count: number };
      video_view_count?: number;
      video_play_count?: number;
      edge_media_preview_comment?: { count: number };
      edge_media_to_parent_comment?: { count: number };
      owner?: {
        id: string;
        username: string;
        full_name?: string;
        is_verified?: boolean;
        profile_pic_url?: string;
      };
    };
  };
  status: string;
}

function getApiKey(): string {
  const key = process.env.SCRAPECREATORS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "SCRAPECREATORS_API_KEY não configurado. Adicione a variável de ambiente."
    );
  }
  return key;
}

/**
 * Lista Reels de um perfil público com paginação por cursor.
 *
 * @param handle - Username do Instagram (sem @)
 * @param maxId  - Cursor da página anterior (omitir na primeira chamada)
 */
export async function fetchUserReels(
  handle: string,
  maxId?: string | null
): Promise<ReelsListResponse> {
  const params = new URLSearchParams({ handle });
  if (maxId) params.set("max_id", maxId);

  const url = `${BASE_URL}/v1/instagram/user/reels?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": getApiKey(),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Não vaza a chave nem o corpo completo em erros
    throw new Error(`ScrapeCreators reels: HTTP ${res.status}`);
  }

  return res.json() as Promise<ReelsListResponse>;
}

/**
 * Busca detalhes de um post/Reel por URL canônica.
 * Usado para complementar legendas ausentes na listagem.
 *
 * @param reelUrl - Permalink completo (ex: https://www.instagram.com/reel/ABC/)
 */
export async function fetchPostDetail(
  reelUrl: string
): Promise<PostDetailResponse> {
  const params = new URLSearchParams({ url: reelUrl });
  const url = `${BASE_URL}/v1/instagram/post?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": getApiKey(),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`ScrapeCreators post detail: HTTP ${res.status}`);
  }

  return res.json() as Promise<PostDetailResponse>;
}