/**
 * Botão "Atividade" na aba Emulador: numa instância que já tem conta, o agente
 * liga, conecta a proxy do NekoBox, abre o Instagram e faz o que o dono marcou.
 * Vai na mesma fila de emulator_jobs (kind 'atividade', SQL em
 * supabase/emulador_atividade.sql); o lado do PC fica em
 * agente-mumu/fluxos/atividade.mjs, com as mesmas chaves de etapa.
 */

export type AtividadeAcao = "aquecer" | "foto" | "story";

/** Bucket das mídias (pasta emulador/<user_id>/, fora da varredura de órfãos de app/api/admin/storage-orphans). */
export const MIDIA_BUCKET = "videos-library";
export type MidiaUso = "foto" | "story";

export const ATIVIDADE_ACOES: ReadonlyArray<{ key: AtividadeAcao; label: string; description: string }> = [
  { key: "aquecer", label: "Aquecer", description: "Segue 2 ou 3 perfis verificados e rola até 2 min de Reels." },
  { key: "foto", label: "Trocar a foto de perfil", description: "Com a foto que você escolher (ou sorteada de uma pasta)." },
  { key: "story", label: "Story com link e destaque", description: "Posta o story com o sticker de link e destaca no perfil." },
];

/** Etapas na ordem; as com `acao` só entram quando ela foi marcada. */
export const ATIVIDADE_FLUXO: ReadonlyArray<{ key: string; label: string; acao?: AtividadeAcao }> = [
  { key: "abrir", label: "Ligar a instância" },
  { key: "proxy", label: "Conectar a proxy no NekoBox" },
  { key: "instagram", label: "Abrir o Instagram" },
  { key: "seguir", label: "Seguir perfis verificados", acao: "aquecer" },
  { key: "reels", label: "Rolar os Reels", acao: "aquecer" },
  { key: "foto", label: "Trocar a foto de perfil", acao: "foto" },
  { key: "story", label: "Postar o story com link", acao: "story" },
  { key: "destaque", label: "Destacar o story", acao: "story" },
  { key: "fechar", label: "Desligar a instância" },
];

export function atividadeSteps(acoes: readonly AtividadeAcao[]): ReadonlyArray<{ key: string; label: string }> {
  return ATIVIDADE_FLUXO.filter((s) => !s.acao || acoes.includes(s.acao));
}

const ACOES: ReadonlySet<string> = new Set(ATIVIDADE_ACOES.map((a) => a.key));

/** Ações válidas, sem repetir, na ordem da lista. */
export function parseAcoes(raw: unknown): AtividadeAcao[] {
  if (!Array.isArray(raw)) return [];
  const marcadas = new Set(raw.filter((a): a is AtividadeAcao => typeof a === "string" && ACOES.has(a)));
  return ATIVIDADE_ACOES.map((a) => a.key).filter((k) => marcadas.has(k));
}

/** Tipos que cada mídia aceita (o bucket videos-library só aceita image/jpeg, não image/jpg). */
export const MIDIA_TIPOS: Record<MidiaUso, readonly string[]> = {
  foto: ["image/jpeg", "image/png"],
  story: ["image/jpeg", "image/png", "video/mp4", "video/quicktime"],
};
export const MIDIA_MAX_IMAGEM = 8 * 1024 * 1024;
export const MIDIA_MAX_VIDEO = 100 * 1024 * 1024;

export function normalizarTipo(type: string): string {
  return type === "image/jpg" ? "image/jpeg" : type;
}

export function extensaoDoTipo(type: string): string {
  return { "image/png": ".png", "video/mp4": ".mp4", "video/quicktime": ".mov" }[normalizarTipo(type)] ?? ".jpg";
}

/** Erro de tipo/tamanho para a mídia, ou null se ela serve. */
export function erroDaMidia(uso: MidiaUso, type: string, size: number): string | null {
  const tipo = normalizarTipo(type);
  if (!MIDIA_TIPOS[uso].includes(tipo)) {
    return uso === "foto" ? "A foto de perfil tem que ser JPG ou PNG." : "A mídia do story tem que ser JPG, PNG, MP4 ou MOV.";
  }
  const max = tipo.startsWith("image/") ? MIDIA_MAX_IMAGEM : MIDIA_MAX_VIDEO;
  if (!Number.isFinite(size) || size <= 0) return "Arquivo vazio.";
  if (size > max) return `Arquivo grande demais (${(size / 1024 / 1024).toFixed(1)} MB). Máximo: ${max / 1024 / 1024} MB.`;
  return null;
}

/** Caminho no bucket de uma mídia do usuário (o servidor escolhe o nome). */
export function midiaPathRe(userId: string): RegExp {
  const id = userId.replace(/[^0-9a-f-]/gi, "");
  return new RegExp(`^emulador/${id}/[0-9a-f-]{36}\\.(jpg|png|mp4|mov)$`, "i");
}

export interface StoryDados {
  link: string;
  /** Texto do sticker de link; vazio = o Instagram mostra o endereço. */
  texto: string;
  /** Nome do destaque no perfil. */
  destaque: string;
}

export interface AtividadeInput {
  acoes: AtividadeAcao[];
  midias: { foto?: string; story?: string };
  story: StoryDados | null;
}

const ASCII_RE = /^[\x20-\x7E]*$/;
export const STICKER_MAX = 40;
/** Limite de caracteres do nome de destaque no Instagram. */
export const DESTAQUE_MAX = 15;

/**
 * Link, texto do sticker e nome do destaque. Tudo sem acento nem emoji: o
 * agente digita pelo `input text` do Android, que só aceita ASCII.
 */
export function parseStoryDados(raw: unknown): { value: StoryDados } | { error: string } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  let link = str(r.link);
  const texto = str(r.texto).replace(/\s+/g, " ");
  const destaque = str(r.destaque).replace(/\s+/g, " ");

  if (!link) return { error: "Informe o link do story." };
  if (!/^https?:\/\//i.test(link)) link = `https://${link}`;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { error: "Link inválido." };
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".") || /\s/.test(link) || link.length > 300 || !ASCII_RE.test(link)) {
    return { error: "Link inválido (sem espaço, acento ou emoji)." };
  }
  if (texto.length > STICKER_MAX || !ASCII_RE.test(texto)) {
    return { error: `Texto do sticker: até ${STICKER_MAX} caracteres, sem acento nem emoji.` };
  }
  if (!destaque) return { error: "Informe o nome do destaque." };
  if (destaque.length > DESTAQUE_MAX || !ASCII_RE.test(destaque)) {
    return { error: `Nome do destaque: até ${DESTAQUE_MAX} caracteres, sem acento nem emoji.` };
  }
  return { value: { link, texto, destaque } };
}

/** Corpo do POST /api/emulador/atividades → o que vai criptografado na fila. */
export function parseAtividadeInput(body: Record<string, unknown>, userId: string): { value: AtividadeInput } | { error: string } {
  const acoes = parseAcoes(body.acoes);
  if (acoes.length === 0) return { error: "Marque pelo menos uma coisa para fazer." };

  const re = midiaPathRe(userId);
  const raw = body.midias && typeof body.midias === "object" ? (body.midias as Record<string, unknown>) : {};
  const midias: AtividadeInput["midias"] = {};
  if (acoes.includes("foto")) {
    if (typeof raw.foto !== "string" || !re.test(raw.foto) || !/\.(jpg|png)$/i.test(raw.foto)) {
      return { error: "Escolha a foto de perfil." };
    }
    midias.foto = raw.foto;
  }

  let story: StoryDados | null = null;
  if (acoes.includes("story")) {
    if (typeof raw.story !== "string" || !re.test(raw.story)) return { error: "Escolha a mídia do story." };
    midias.story = raw.story;
    const dados = parseStoryDados(body.story);
    if ("error" in dados) return dados;
    story = dados.value;
  }
  return { value: { acoes, midias, story } };
}

/** Caminhos das mídias de uma atividade (para apagar do bucket no fim). */
export function midiaPaths(input: Partial<AtividadeInput> | null | undefined): string[] {
  const m = input?.midias;
  return [m?.foto, m?.story].filter((p): p is string => typeof p === "string" && p.startsWith("emulador/"));
}
