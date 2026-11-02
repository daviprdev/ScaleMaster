/**
 * Botão "Estruturar" na aba Emulador (por dentro, kind 'atividade'): numa
 * instância que já tem conta, o agente liga, conecta a proxy do NekoBox, abre o
 * Instagram e faz o que o dono marcou. As mídias saem da pasta do MuMu no PC
 * (o agente manda a lista em emulator_agents.media; nada sobe para o Storage).
 * Vai na mesma fila de emulator_jobs (SQL em supabase/emulador_atividade.sql);
 * o lado do PC fica em agente-mumu/fluxos/atividade.mjs, com as mesmas chaves de etapa.
 */

export type AtividadeAcao = "aquecer" | "foto" | "story";
export type MidiaUso = "foto" | "story";

export const ATIVIDADE_ACOES: ReadonlyArray<{ key: AtividadeAcao; label: string; description: string }> = [
  { key: "aquecer", label: "Aquecer", description: "Segue 2 ou 3 perfis verificados e rola até 2 min de Reels." },
  { key: "foto", label: "Trocar a foto de perfil", description: "Com a foto que você escolher da pasta do MuMu (ou sorteada entre várias)." },
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

/** Arquivo da pasta do MuMu que o agente encontrou (caminho relativo com "/"). */
export interface MediaFile {
  path: string;
  size: number;
  tipo: "imagem" | "video";
}

/** O que cada uso aceita: foto de perfil só imagem; story imagem ou vídeo. */
export const MIDIA_TIPOS: Record<MidiaUso, ReadonlyArray<MediaFile["tipo"]>> = {
  foto: ["imagem"],
  story: ["imagem", "video"],
};
/** Até quantos arquivos dá para marcar (mais de um = o agente sorteia na hora). */
export const MIDIA_MAX_MARCADAS = 200;

export interface StoryDados {
  link: string;
  /** Texto do sticker de link; vazio = o Instagram mostra o endereço. */
  texto: string;
  /** Nome do destaque no perfil. */
  destaque: string;
}

export interface AtividadeInput {
  acoes: AtividadeAcao[];
  /** Arquivos marcados de cada uso; o agente sorteia um deles. */
  midias: { foto?: string[]; story?: string[] };
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

/** Marcadas de um uso: só arquivos que o agente listou, do tipo certo, sem repetir. */
export function parseMarcadas(raw: unknown, uso: MidiaUso, files: readonly MediaFile[]): string[] | null {
  if (!Array.isArray(raw)) return null;
  const aceitos = new Set(files.filter((f) => MIDIA_TIPOS[uso].includes(f.tipo)).map((f) => f.path));
  const out = [...new Set(raw.filter((p): p is string => typeof p === "string" && aceitos.has(p)))];
  return out.length > 0 && out.length <= MIDIA_MAX_MARCADAS && out.length === raw.length ? out : null;
}

/** Corpo do POST /api/emulador/atividades → o que vai criptografado na fila. `files` = mídias que o agente do PC listou. */
export function parseAtividadeInput(body: Record<string, unknown>, files: readonly MediaFile[]): { value: AtividadeInput } | { error: string } {
  const acoes = parseAcoes(body.acoes);
  if (acoes.length === 0) return { error: "Marque pelo menos uma coisa para fazer." };

  const raw = body.midias && typeof body.midias === "object" ? (body.midias as Record<string, unknown>) : {};
  const midias: AtividadeInput["midias"] = {};
  if (acoes.includes("foto")) {
    const foto = parseMarcadas(raw.foto, "foto", files);
    if (!foto) return { error: "Escolha a foto de perfil na pasta do MuMu (JPG ou PNG)." };
    midias.foto = foto;
  }

  let story: StoryDados | null = null;
  if (acoes.includes("story")) {
    const marcadas = parseMarcadas(raw.story, "story", files);
    if (!marcadas) return { error: "Escolha a mídia do story na pasta do MuMu." };
    midias.story = marcadas;
    const dados = parseStoryDados(body.story);
    if ("error" in dados) return dados;
    story = dados.value;
  }
  return { value: { acoes, midias, story } };
}
