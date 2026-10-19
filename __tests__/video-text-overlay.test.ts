import { describe, it, expect } from "vitest";
import {
  TEXT_OVERLAY_MAX_CHARS,
  buildDrawtextFilter,
  droppedOverlayChars,
  escapeFilterValue,
  isMissingTextOverlayColumn,
  layoutTextOverlay,
  loopTextOverlayPool,
  normalizeTextPool,
  normalizeTextPosition,
  pickOverlayText,
  sanitizeOverlayText,
  usableTextPool,
  wrapOverlayText,
} from "../lib/video-text-overlay";

const ACCOUNTS = Array.from({ length: 8 }, (_, i) => `acc-${String(i).padStart(2, "0")}-uuid`);
const POOL = [
  "Wait for the end",
  "She didn't expect this",
  "POV: you found her page",
  "Watch till the end",
  "This is why she's famous",
  "Nobody saw this coming",
  "Rate her 1-10",
  "Part 2? Comment below",
  "Would you date her?",
  "Hardest edit ever",
];

describe("sanitizeOverlayText", () => {
  it("remove emoji, ZWJ, tom de pele, bandeira e seletor de variação", () => {
    expect(sanitizeOverlayText("Wait for it 😳🔥")).toBe("Wait for it");
    expect(sanitizeOverlayText("family 👨‍👩‍👧 time 👍🏽 🇧🇷 ❤️")).toBe("family time");
    expect(sanitizeOverlayText("1️⃣ first")).toBe("1 first");
  });

  it("mantém acentos, pontuação e caracteres especiais do filtro", () => {
    const tricky = "Ninguém: 100% real, it's [ok]; \\o/ \"quoted\"";
    expect(sanitizeOverlayText(tricky)).toBe(tricky);
  });

  it("dobra letras estilizadas do Instagram (NFKC) e corta escritas sem glifo", () => {
    expect(sanitizeOverlayText("𝐁𝐨𝐥𝐝 ｆｕｌｌ")).toBe("Bold full");
    expect(sanitizeOverlayText("hello 你好 world")).toBe("hello world");
  });

  it("colapsa espaços/quebras e respeita o teto de caracteres sem partir surrogate", () => {
    expect(sanitizeOverlayText("  a \n\t b  ")).toBe("a b");
    const long = "x".repeat(TEXT_OVERLAY_MAX_CHARS + 50);
    expect(Array.from(sanitizeOverlayText(long))).toHaveLength(TEXT_OVERLAY_MAX_CHARS);
  });

  it("frase só de emoji vira vazia e sai do pool", () => {
    expect(sanitizeOverlayText("🔥🔥🔥")).toBe("");
    expect(usableTextPool(["🔥🔥", "  ", "ok", "ok 😳", null])).toEqual(["ok"]);
  });

  it("aponta o que o vídeo vai perder (aviso do painel)", () => {
    expect(droppedOverlayChars("Hi 😳 there 🔥 ❤️")).toEqual(["😳", "🔥", "❤"]);
    expect(droppedOverlayChars("Ninguém: 100%")).toEqual([]);
  });
});

describe("normalizeTextPool / posição / migração", () => {
  it("salva o texto do usuário aparado, sem vazios nem repetidos", () => {
    expect(normalizeTextPool(["  Hi  there ", "", "Hi there", "Yo 😳", 42])).toEqual(["Hi there", "Yo 😳", "42"]);
    expect(normalizeTextPool("not an array")).toEqual([]);
  });

  it("posição desconhecida cai em topo", () => {
    expect(normalizeTextPosition("middle")).toBe("middle");
    expect(normalizeTextPosition("bottom")).toBe("top");
    expect(normalizeTextPosition(undefined)).toBe("top");
  });

  it("pool efetivo é vazio com o efeito desligado (loop antigo = sem texto)", () => {
    expect(loopTextOverlayPool({ effect_text_enabled: false, effect_text_pool: POOL })).toEqual([]);
    expect(loopTextOverlayPool({})).toEqual([]);
    expect(loopTextOverlayPool({ effect_text_enabled: true, effect_text_pool: ["😳", "Go"] })).toEqual(["Go"]);
  });

  it("reconhece o erro do PostgREST de coluna ausente", () => {
    expect(isMissingTextOverlayColumn({ code: "42703", message: "column loops.effect_text_enabled does not exist" })).toBe(true);
    expect(isMissingTextOverlayColumn({ code: "PGRST204", message: "Could not find the 'effect_text_pool' column of 'loops' in the schema cache" })).toBe(true);
    expect(isMissingTextOverlayColumn({ code: "42703", message: "column loops.other does not exist" })).toBe(false);
    expect(isMissingTextOverlayColumn(null)).toBe(false);
  });
});

describe("pickOverlayText", () => {
  it("é determinística: mesma conta + mesmo vídeo → mesma frase", () => {
    const opts = { accountId: ACCOUNTS[3], videoId: "video-a", accountIds: ACCOUNTS };
    expect(pickOverlayText(POOL, opts)).toBe(pickOverlayText(POOL, opts));
    // ordem das contas não importa
    expect(pickOverlayText(POOL, { ...opts, accountIds: [...ACCOUNTS].reverse() })).toBe(pickOverlayText(POOL, opts));
  });

  it("contas que postam o mesmo vídeo recebem frases diferentes", () => {
    for (const videoId of ["video-a", "video-b", "video-c"]) {
      const picks = ACCOUNTS.map(accountId => pickOverlayText(POOL, { accountId, videoId, accountIds: ACCOUNTS }));
      expect(new Set(picks).size).toBe(ACCOUNTS.length);
    }
  });

  it("a mesma conta roda o pool de um vídeo para o outro", () => {
    const picks = new Set(
      Array.from({ length: 20 }, (_, i) =>
        pickOverlayText(POOL, { accountId: ACCOUNTS[0], videoId: `video-${i}`, accountIds: ACCOUNTS })),
    );
    expect(picks.size).toBeGreaterThan(3);
  });

  it("pool menor que o número de contas distribui sem concentrar", () => {
    const small = POOL.slice(0, 3);
    const picks = ACCOUNTS.map(accountId => pickOverlayText(small, { accountId, videoId: "v", accountIds: ACCOUNTS }));
    const counts = small.map(p => picks.filter(x => x === p).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("pool vazio (ou só emoji) → sem texto", () => {
    expect(pickOverlayText([], { accountId: "a", videoId: "v", accountIds: ["a"] })).toBeNull();
    expect(pickOverlayText(["🔥"], { accountId: "a", videoId: "v", accountIds: ["a"] })).toBeNull();
  });

  it("conta fora da lista ainda recebe frase estável", () => {
    const opts = { accountId: "outsider", videoId: "v", accountIds: ACCOUNTS };
    expect(POOL).toContain(pickOverlayText(POOL, opts));
    expect(pickOverlayText(POOL, opts)).toBe(pickOverlayText(POOL, opts));
  });
});

describe("layout", () => {
  it("quebra por palavra e corta palavra maior que a linha", () => {
    expect(wrapOverlayText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapOverlayText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("frase curta em 720x1280: 1 linha, fonte de 40px", () => {
    const l = layoutTextOverlay("Wait for the end", { width: 720, height: 1280 });
    expect(l.lines).toEqual(["Wait for the end"]);
    expect(l.fontSize).toBe(40);
  });

  it("escala com a resolução e equilibra as linhas", () => {
    const l = layoutTextOverlay("Wait for it... she didn't expect THIS", { width: 1080, height: 1920 });
    expect(l.fontSize).toBe(60);
    expect(l.lines).toHaveLength(2);
    const [a, b] = l.lines.map(s => s.length);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(4);
  });

  it("frase no teto de caracteres encolhe a fonte e cabe na largura útil", () => {
    const text = sanitizeOverlayText("word ".repeat(40));
    const l = layoutTextOverlay(text, { width: 720, height: 1280 });
    expect(l.lines.length).toBeLessThanOrEqual(4);
    expect(l.fontSize).toBeLessThan(40);
    // nenhuma linha passa da largura útil estimada
    for (const line of l.lines) {
      expect(line.length * l.fontSize * 0.66).toBeLessThanOrEqual(720 * 0.84);
    }
  });

  it("dimensões desconhecidas usam 720x1280", () => {
    expect(layoutTextOverlay("Hi", {}).fontSize).toBe(40);
  });
});

describe("buildDrawtextFilter", () => {
  const layout = layoutTextOverlay("Hi", { width: 720, height: 1280 });

  it("lê o texto de arquivo, sem expansão, com fonte, caixa e posição", () => {
    const f = buildDrawtextFilter({
      fontFile: "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
      textFile: "/tmp/vpf_txt_1.txt",
      layout,
      position: "top",
    });
    expect(f.startsWith("drawtext=")).toBe(true);
    expect(f).toContain("fontfile=/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf");
    expect(f).toContain("textfile=/tmp/vpf_txt_1.txt");
    expect(f).toContain("expansion=none");
    expect(f).toContain("box=1");
    expect(f).toContain("text_align=C");
    expect(f).toContain("x=(w-text_w)/2");
    expect(f).toContain("y=h*0.16");
    expect(f).not.toMatch(/\s/);
    // sem vírgula/; solta: o filtro é um só elo da cadeia -vf
    expect(f).not.toMatch(/(?<!\\)[,;]/);
  });

  it("meio centra o bloco em 44% da altura", () => {
    const f = buildDrawtextFilter({ fontFile: "/f.ttf", textFile: "/t.txt", layout, position: "middle" });
    expect(f).toContain("y=h*0.44-text_h/2");
  });

  it("escapa caminhos nos dois níveis do FFmpeg (opção e filtergraph)", () => {
    expect(escapeFilterValue("C:\\Temp\\t.txt")).toBe("C\\\\:\\\\\\\\Temp\\\\\\\\t.txt");
    expect(escapeFilterValue("/tmp/it's,[x];y")).toBe("/tmp/it\\\\\\'s\\,\\[x\\]\\;y");
    expect(escapeFilterValue("/tmp/plain_path-1.txt")).toBe("/tmp/plain_path-1.txt");
  });
});
