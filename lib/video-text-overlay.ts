/**
 * video-text-overlay.ts — efeito "Texto na tela" do Loop.
 *
 * Por que existe (diagnóstico de 2026-10-19): os Reels são cópias dos perfis
 * das próprias modelos, postadas idênticas em dezenas de contas, e a Meta só
 * recomenda o original quando há conteúdo idêntico. Borda, velocidade, cor e
 * ruído não contam como original; texto contextual próprio conta. Aqui se
 * escolhe uma frase de gancho por conta/publicação e se monta o filtro
 * drawtext que lib/video-effects.ts queima no vídeo.
 *
 * Puro (sem fs nem FFmpeg): o painel do Loop importa a sanitização para avisar
 * o que não vai aparecer no vídeo, e os testes importam o resto direto.
 *
 * O texto NUNCA entra na linha de comando do FFmpeg: vai num arquivo
 * temporário (textfile=) com expansion=none, então aspas, dois-pontos, vírgula,
 * barra e % saem literais sem nenhum escape do conteúdo do usuário.
 */

export type TextOverlayPosition = "top" | "middle";

/** Teto por frase (em caracteres) e por pool — o resto é descartado ao salvar. */
export const TEXT_OVERLAY_MAX_CHARS = 100;
export const TEXT_OVERLAY_MAX_PHRASES = 200;

/** Colunas de public.loops (supabase/loops_text_overlay.sql). */
export const TEXT_OVERLAY_COLUMNS = "effect_text_enabled, effect_text_pool, effect_text_position";
export const TEXT_OVERLAY_COLUMN_NAMES = ["effect_text_enabled", "effect_text_pool", "effect_text_position"] as const;

/** Erro das APIs quando o usuário liga o efeito antes da migração. */
export const TEXT_OVERLAY_MIGRATION_PENDING =
  "O Texto na tela ainda não está disponível: falta aplicar a migração supabase/loops_text_overlay.sql no Supabase.";

export function normalizeTextPosition(value: unknown): TextOverlayPosition {
  return value === "middle" ? "middle" : "top";
}

/**
 * A migração é aplicada à mão no SQL Editor. Até lá o PostgREST responde
 * 42703 (select de coluna inexistente) ou PGRST204 (insert/update) citando a
 * coluna — quem chama cai para a consulta sem o efeito em vez de quebrar o Loop.
 */
export function isMissingTextOverlayColumn(
  err: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  return (err.code === "42703" || err.code === "PGRST204" || /schema cache|does not exist/i.test(msg)) &&
    msg.includes("effect_text");
}

// ── FNV-1a — o mesmo hash determinístico dos outros efeitos ────────────────

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// ── Sanitização ────────────────────────────────────────────────────────────

// A fonte do container (DejaVu Sans Bold) não tem emoji: emoji, bandeira, tom
// de pele, ZWJ, seletor de variação e keycap virariam quadrado (tofu).
const PICTOGRAPHIC_RE =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\p{Variation_Selector}‍⃣]/gu;
// Escritas que a DejaVu cobre. Common/Inherited = dígitos, pontuação e acentos.
const RENDERABLE_RE = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]/u;
const INVISIBLE_RE = /[\p{C}\p{Variation_Selector}\p{Emoji_Modifier}⃣]/u;

function clampChars(s: string): string {
  return Array.from(s).slice(0, TEXT_OVERLAY_MAX_CHARS).join("").trim();
}

/**
 * Texto exatamente como vai para o vídeo. NFKC dobra as "letras estilizadas"
 * do Instagram (𝐁𝐨𝐥𝐝, ｆｕｌｌ ｗｉｄｔｈ) para letras comuns; emoji e escritas
 * sem glifo na fonte são removidos; quebras de linha viram espaço (o layout
 * quebra sozinho).
 */
export function sanitizeOverlayText(raw: unknown): string {
  const text = String(raw ?? "")
    .normalize("NFKC")
    .replace(PICTOGRAPHIC_RE, " ")
    .replace(/\p{C}/gu, " ");
  let out = "";
  for (const ch of text) out += RENDERABLE_RE.test(ch) ? ch : " ";
  return clampChars(out.replace(/\s+/g, " ").trim());
}

/** Caracteres visíveis que o vídeo vai perder (para o aviso do painel). */
export function droppedOverlayChars(raw: string): string[] {
  const seen = new Set<string>();
  for (const ch of String(raw ?? "").normalize("NFKC")) {
    if (/\s/u.test(ch) || INVISIBLE_RE.test(ch)) continue;
    if (!sanitizeOverlayText(ch)) seen.add(ch);
  }
  return Array.from(seen);
}

/**
 * Pool como é SALVO em loops.effect_text_pool: o texto do usuário (emoji
 * incluso — a remoção acontece só na renderização), aparado, sem vazios nem
 * repetidos, dentro dos tetos.
 */
export function normalizeTextPool(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = clampChars(String(item ?? "").replace(/\s+/g, " ").trim());
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= TEXT_OVERLAY_MAX_PHRASES) break;
  }
  return out;
}

/** Frases que de fato renderizam (uma frase só de emoji some do pool). */
export function usableTextPool(pool: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of pool) {
    const s = sanitizeOverlayText(item);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= TEXT_OVERLAY_MAX_PHRASES) break;
  }
  return out;
}

/** Pool efetivo de um Loop: vazio quando o efeito está desligado. */
export function loopTextOverlayPool(loop: {
  effect_text_enabled?: boolean | null;
  effect_text_pool?: unknown;
}): string[] {
  if (loop.effect_text_enabled !== true) return [];
  return usableTextPool(Array.isArray(loop.effect_text_pool) ? loop.effect_text_pool : []);
}

// ── Escolha da frase ───────────────────────────────────────────────────────

/**
 * Frase de uma conta para um vídeo. Determinística (mesma conta + mesmo vídeo
 * + mesmo conjunto de contas → mesma frase), então re-enfileirar não troca o
 * texto; e o job ainda guarda a frase escolhida, então retry nunca troca.
 *
 * Índice = posição estável da conta (ids ordenados) + deslocamento do vídeo.
 * Contas que postam o MESMO vídeo ganham frases DIFERENTES enquanto o pool
 * tiver frases para todas (um hash puro repetiria frase entre contas), e a
 * mesma conta roda o pool de um vídeo para o outro.
 */
export function pickOverlayText(
  pool: readonly unknown[],
  opts: { accountId: string; videoId: string; accountIds: readonly string[] },
): string | null {
  const usable = usableTextPool(pool);
  if (usable.length === 0) return null;
  const ranked = Array.from(new Set(opts.accountIds)).sort();
  const rank = ranked.indexOf(opts.accountId);
  const accountSlot = rank >= 0 ? rank : fnv1a(`text-account:${opts.accountId}`);
  const videoOffset = fnv1a(`text-video:${opts.videoId}`);
  return usable[(accountSlot + videoOffset) % usable.length];
}

// ── Layout ─────────────────────────────────────────────────────────────────

// Fonte = 5,6% da largura útil 9:16 → 40px em 720x1280, 60px em 1080x1920.
const FONT_RATIO = 0.056;
// Largura média de um caractere da DejaVu Sans Bold em em (folgada: maiúsculas
// são mais largas — melhor uma linha a mais do que texto cortado na borda).
const GLYPH_WIDTH_EM = 0.66;
// Margem lateral de 8% de cada lado: fora da borda e dos botões do Reels.
const SAFE_WIDTH = 0.84;
const MAX_LINES = 3;

/** Quebra gulosa por palavra; palavra maior que a linha é cortada. */
export function wrapOverlayText(text: string, maxChars: number): string[] {
  const limit = Math.max(4, Math.floor(maxChars));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter(Boolean)) {
    let w = word;
    while (Array.from(w).length > limit) {
      if (line) { lines.push(line); line = ""; }
      const cps = Array.from(w);
      lines.push(cps.slice(0, limit).join(""));
      w = cps.slice(limit).join("");
    }
    if (!w) continue;
    const candidate = line ? `${line} ${w}` : w;
    if (Array.from(candidate).length <= limit) {
      line = candidate;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Mesmo número de linhas da quebra gulosa, mas com larguras equilibradas
 *  (evita uma última linha com uma palavra só). */
function balancedWrap(text: string, maxChars: number): string[] {
  let best = wrapOverlayText(text, maxChars);
  for (let limit = Math.floor(maxChars) - 1; limit >= Math.max(4, Math.floor(maxChars / 2)); limit--) {
    const attempt = wrapOverlayText(text, limit);
    if (attempt.length > best.length) break;
    best = attempt;
  }
  return best;
}

export interface TextOverlayLayout {
  lines: string[];
  fontSize: number;
  lineSpacing: number;
  boxPadV: number;
  boxPadH: number;
  outline: number;
}

/**
 * Tamanho da fonte e quebra de linha para as dimensões reais do vídeo. Texto
 * longo encolhe a fonte (até 70%) antes de passar de 3 linhas.
 */
export function layoutTextOverlay(
  text: string,
  dims: { width?: number | null; height?: number | null } = {},
): TextOverlayLayout {
  const width = dims.width && dims.width > 0 ? dims.width : 720;
  const height = dims.height && dims.height > 0 ? dims.height : 1280;
  const base = Math.min(width, (height * 9) / 16) * FONT_RATIO;

  let layout: TextOverlayLayout | null = null;
  for (const scale of [1, 0.9, 0.8, 0.7]) {
    const fontSize = Math.max(12, Math.round(base * scale));
    const boxPadH = Math.round(fontSize * 0.5);
    const maxChars = Math.floor((width * SAFE_WIDTH - 2 * boxPadH) / (fontSize * GLYPH_WIDTH_EM));
    layout = {
      lines: balancedWrap(text, maxChars),
      fontSize,
      lineSpacing: Math.round(fontSize * 0.28),
      boxPadV: Math.round(fontSize * 0.32),
      boxPadH,
      outline: Math.max(1, Math.round(fontSize * 0.05)),
    };
    if (layout.lines.length <= MAX_LINES) break;
  }
  return layout!;
}

// ── Filtro FFmpeg ──────────────────────────────────────────────────────────

/**
 * Escapa um valor de opção para os dois níveis de parse do FFmpeg: o valor da
 * opção (\ ' :) e a descrição do filtergraph (\ ' [ ] , ;). Só é aplicado aos
 * caminhos de arquivo — o texto do usuário vai no textfile.
 */
export function escapeFilterValue(value: string): string {
  const optionLevel = value.replace(/[\\':]/g, (c) => `\\${c}`);
  return optionLevel.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}

/**
 * Posição do bloco na safe area do Reels 9:16: o topo fica abaixo dos ~14% do
 * cabeçalho; o meio centra em 44% da altura, acima da legenda/botões que
 * ocupam o terço de baixo.
 */
export function overlayY(position: TextOverlayPosition): string {
  return position === "middle" ? "h*0.44-text_h/2" : "h*0.16";
}

export function buildDrawtextFilter(opts: {
  fontFile: string;
  textFile: string;
  layout: TextOverlayLayout;
  position: TextOverlayPosition;
}): string {
  const l = opts.layout;
  return "drawtext=" + [
    `fontfile=${escapeFilterValue(opts.fontFile)}`,
    `textfile=${escapeFilterValue(opts.textFile)}`,
    "expansion=none",
    `fontsize=${l.fontSize}`,
    "fontcolor=white",
    `line_spacing=${l.lineSpacing}`,
    "text_align=C",
    `borderw=${l.outline}`,
    "bordercolor=black@0.55",
    "box=1",
    "boxcolor=black@0.55",
    `boxborderw=${l.boxPadV}|${l.boxPadH}`,
    "x=(w-text_w)/2",
    `y=${overlayY(opts.position)}`,
  ].join(":");
}
