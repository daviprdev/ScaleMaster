/**
 * reel-captions.ts — modos de legenda e resolução da legenda final.
 *
 * REGRA PERMANENTE: mídia e legenda são coisas separadas. Nada aqui toca em
 * bytes de vídeo, Storage, `video_processing_mode`, FFmpeg ou efeitos. É só
 * texto.
 *
 * FLUXO: configuração → escolhe o vídeo → resolve a legenda AQUI → grava o
 * resultado no post concreto (`scheduled_posts.caption` /
 * `pending_containers.caption`). Depois disso o texto está congelado: editar o
 * vídeo na Biblioteca ou mudar o Loop não altera post que já nasceu.
 *
 * SEM FALLBACK SILENCIOSO: `original` sem legenda disponível publica SEM
 * legenda. Nunca cai para legenda automática, legenda personalizada nem
 * legenda de outro vídeo.
 */

// ── Limite da Meta ──────────────────────────────────────────────────────────

/**
 * Referência oficial (Instagram Platform → IG User Media, POST
 * /{ig-user-id}/media), consultada em 2026-09-07:
 *   "Maximum 2200 characters, 30 hashtags, and 20 @ tags."
 *
 * Estas são as ÚNICAS fontes desses números no projeto. Nenhuma rota deve
 * repetir 2200/30/20 literal.
 */
export const INSTAGRAM_CAPTION_MAX_LENGTH = 2200;
export const INSTAGRAM_CAPTION_MAX_HASHTAGS = 30;
export const INSTAGRAM_CAPTION_MAX_MENTIONS = 20;

// ── Modos ───────────────────────────────────────────────────────────────────

export type CaptionMode = "original" | "custom" | "none";

export const CAPTION_MODES: readonly CaptionMode[] = ["original", "custom", "none"] as const;

/**
 * Modo assumido quando a configuração não diz nada (coluna NULL, registro
 * anterior à feature, corpo de request sem o campo).
 *
 * `custom` é o comportamento HISTÓRICO de Loop e Postar: a legenda vinha do
 * pool que o usuário digitou (`loops.captions` / `distribute_campaigns.captions`)
 * ou do gerador automático. Manter `custom` como padrão é o que garante que
 * nenhuma configuração existente mude de conduta sozinha.
 *
 * Clone é a exceção e tem padrão próprio — ver `DEFAULT_CAPTION_MODE_CLONE`.
 */
export const DEFAULT_CAPTION_MODE: CaptionMode = "custom";

/**
 * Clone sempre publicou a legenda original do Reel raspado
 * (`caption: reel.caption` em `posts/clone/create`), a menos que o usuário
 * ligasse legenda automática. Então lá o padrão é `original` — preservar o
 * comportamento histórico é a regra, e nesse fluxo o histórico é esse.
 */
export const DEFAULT_CAPTION_MODE_CLONE: CaptionMode = "original";

export function normalizeCaptionMode(
  value: unknown,
  fallback: CaptionMode = DEFAULT_CAPTION_MODE
): CaptionMode {
  return typeof value === "string" && (CAPTION_MODES as readonly string[]).includes(value)
    ? (value as CaptionMode)
    : fallback;
}

// ── Hashtags e @menções ─────────────────────────────────────────────────────

/**
 * Hashtag em Unicode de verdade.
 *
 * `/#\w+/g` quebraria em `#ação`, `#português` e `#日本語`, porque `\w` é
 * `[A-Za-z0-9_]`. As classes `\p{L}` (qualquer letra) e `\p{N}` (qualquer
 * número), com a flag `u`, cobrem acento, cedilha, kanji, cirílico e o resto.
 * `\p{M}` entra para não cortar marcas de combinação (ex.: acento solto em
 * texto decomposto NFD).
 */
const HASHTAG_RE = /#[\p{L}\p{N}\p{M}_]+/gu;

/**
 * @menção do Instagram. O username lá é ASCII restrito — letras, números,
 * ponto e underscore — então aqui NÃO se usa `\p{L}`: seria abrangente demais
 * e comeria texto normal depois de um "@" solto.
 */
const MENTION_RE = /@[A-Za-z0-9._]+/g;

export function countHashtags(text: string): number {
  return (text.match(HASHTAG_RE) ?? []).length;
}

export function countMentions(text: string): number {
  return (text.match(MENTION_RE) ?? []).length;
}

// ── Validação (a política: VALIDAR, NUNCA TRUNCAR) ──────────────────────────

export type CaptionErrorCode =
  | "CAPTION_TOO_LONG"
  | "CAPTION_TOO_MANY_HASHTAGS"
  | "CAPTION_TOO_MANY_MENTIONS";

export interface CaptionValidation {
  valid: boolean;
  /** Tamanho em CODE POINTS — ver comentário em `captionLength`. */
  length: number;
  hashtagCount: number;
  mentionCount: number;
  error?: { code: CaptionErrorCode; message: string };
}

/**
 * Unidade de contagem: CODE POINTS Unicode (`[...text].length`), não unidades
 * UTF-16.
 *
 * `"😂".length` é 2 em JavaScript porque emoji fora do BMP ocupa dois surrogate
 * halves; contar assim faria uma legenda com muitos emojis ser recusada antes
 * da hora. Code point conta cada emoji como 1, que é a leitura intuitiva e a
 * mais próxima do que o Instagram mostra.
 *
 * Não é grapheme cluster: uma família 👨‍👩‍👧 (com ZWJ) ainda conta como vários.
 * Chegar em cluster exigiria `Intl.Segmenter` e complicaria sem ganho real
 * perto do limite de 2200 — a diferença só apareceria em legendas feitas quase
 * só de emojis compostos. Fica registrado como escolha consciente.
 *
 * Em nenhum caso o texto é alterado para caber: contar é só medir.
 */
export function captionLength(text: string): number {
  return [...text].length;
}

/**
 * VALIDADOR CENTRAL. Todo caminho que envia legenda passa por aqui — rotas de
 * agendamento, cron do Loop, publicação imediata e o transporte da Meta.
 *
 * Nunca modifica o texto. Devolve o veredito e os números; quem chama decide
 * como reportar. Legenda vazia é válida (é o modo "sem legenda").
 */
export function validateInstagramCaption(caption: string): CaptionValidation {
  const length = captionLength(caption);
  const hashtagCount = countHashtags(caption);
  const mentionCount = countMentions(caption);

  const base: CaptionValidation = { valid: true, length, hashtagCount, mentionCount };

  if (length > INSTAGRAM_CAPTION_MAX_LENGTH) {
    return {
      ...base,
      valid: false,
      error: {
        code: "CAPTION_TOO_LONG",
        message:
          `Legenda possui ${length} caracteres. ` +
          `Máximo permitido: ${INSTAGRAM_CAPTION_MAX_LENGTH}.`,
      },
    };
  }

  if (hashtagCount > INSTAGRAM_CAPTION_MAX_HASHTAGS) {
    return {
      ...base,
      valid: false,
      error: {
        code: "CAPTION_TOO_MANY_HASHTAGS",
        message:
          `Legenda possui ${hashtagCount} hashtags. ` +
          `O Instagram permite no máximo ${INSTAGRAM_CAPTION_MAX_HASHTAGS}.`,
      },
    };
  }

  if (mentionCount > INSTAGRAM_CAPTION_MAX_MENTIONS) {
    return {
      ...base,
      valid: false,
      error: {
        code: "CAPTION_TOO_MANY_MENTIONS",
        message:
          `Legenda possui ${mentionCount} menções. ` +
          `O Instagram permite no máximo ${INSTAGRAM_CAPTION_MAX_MENTIONS}.`,
      },
    };
  }

  return base;
}

/**
 * Erro do transporte: última barreira antes de montar o payload da Meta.
 * Existe como classe própria para o chamador conseguir distinguir "legenda
 * recusada aqui" de "a Meta recusou".
 */
export class InvalidCaptionError extends Error {
  readonly code: CaptionErrorCode;
  constructor(validation: CaptionValidation) {
    super(validation.error?.message ?? "Legenda inválida.");
    this.name = "InvalidCaptionError";
    this.code = validation.error?.code ?? "CAPTION_TOO_LONG";
  }
}

/**
 * Faxina APENAS do buraco deixado pela remoção. Tirar "#foo" de "a #foo b"
 * deixa "a  b"; juntar esses dois espaços é consequência direta da operação
 * que o usuário pediu, não normalização por conta própria.
 *
 * O que NÃO acontece aqui: mexer em quebras de linha, colapsar espaços que já
 * existiam no texto original, alterar emoji, aspas ou caixa. Este helper só
 * roda quando um dos toggles de remoção está ligado.
 */
function limparBuracos(text: string): string {
  return text
    .replace(/[^\S\r\n]{2,}/g, " ")   // runs de espaço/tab, sem tocar em \n
    .replace(/[^\S\r\n]+$/gm, "")     // espaço sobrando no fim de cada linha
    .replace(/\n{3,}/g, "\n\n")       // no máximo uma linha em branco seguida
    .trim();
}

export function stripHashtags(text: string): string {
  return limparBuracos(text.replace(HASHTAG_RE, ""));
}

export function stripMentions(text: string): string {
  return limparBuracos(text.replace(MENTION_RE, ""));
}

// ── Resolução ───────────────────────────────────────────────────────────────

export interface CaptionResolutionInput {
  mode: CaptionMode;
  /** `videos_library.caption` do vídeo concreto, ou a do Reel raspado. */
  originalCaption?: string | null;
  /** Legenda do mecanismo atual (pool manual ou legenda automática). */
  customCaption?: string | null;
  /** Só têm efeito em `mode: "original"`. */
  stripHashtags?: boolean;
  stripMentions?: boolean;
}

export interface CaptionResolution {
  /** Texto final. É este que vai para o snapshot e para a Meta. */
  caption: string;
  mode: CaptionMode;
  /** `original` pedido, mas o vídeo não tem legenda original disponível. */
  missingOriginal: boolean;
  /**
   * Veredito sobre o TEXTO FINAL — ou seja, DEPOIS de aplicar os toggles de
   * remoção. Uma legenda com 34 hashtags e `stripHashtags: true` resolve para
   * 0 hashtags e é válida; validar antes do strip reprovaria sem motivo.
   */
  validation: CaptionValidation;
  length: number;
  hashtags: number;
  mentions: number;
}

/**
 * Resolve a legenda final de UM post concreto.
 *
 * Função pura: recebe a configuração e o vídeo escolhido, devolve o texto. É
 * o único ponto onde `caption_mode` vira texto — Loop, Postar, Clone e
 * "Postar agora" chamam todos aqui.
 */
export function resolveCaption(input: CaptionResolutionInput): CaptionResolution {
  const { mode } = input;

  let caption = "";
  let missingOriginal = false;

  if (mode === "none") {
    caption = "";
  } else if (mode === "custom") {
    caption = input.customCaption ?? "";
  } else {
    // original
    const original = input.originalCaption;
    if (original === null || original === undefined || original === "") {
      // SEM FALLBACK: publica sem legenda. Nunca troca por custom/automática.
      caption = "";
      missingOriginal = true;
    } else {
      caption = original;
      if (input.stripHashtags) caption = stripHashtags(caption);
      if (input.stripMentions) caption = stripMentions(caption);
    }
  }

  // A ordem importa: strip (quando o usuário pediu) já aconteceu acima, então
  // o que se valida aqui é exatamente o texto que será enviado.
  const validation = validateInstagramCaption(caption);

  return {
    caption,
    mode,
    missingOriginal,
    validation,
    length: validation.length,
    hashtags: validation.hashtagCount,
    mentions: validation.mentionCount,
  };
}

/**
 * Mensagem de recusa, com o contexto de qual mídia causou o problema.
 * A frase do limite vem do validador — não é reescrita aqui.
 */
export function captionRejectionMessage(
  validation: CaptionValidation,
  contexto?: string
): string {
  const alvo = contexto ? ` (${contexto})` : "";
  const detalhe = validation.error?.message ?? "Legenda inválida.";
  return `${detalhe}${alvo} O texto não é cortado automaticamente — ajuste a legenda ou escolha outro modo.`;
}

/** Um vídeo tem legenda original aproveitável? */
export function hasOriginalCaption(caption: string | null | undefined): boolean {
  return typeof caption === "string" && caption !== "";
}
