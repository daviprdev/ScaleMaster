/**
 * "Estruturar" da aba Contas VPS (emulator_jobs.kind = 'estruturacao'): numa
 * conta já criada, o agente sobe a proxy, abre o Instagram, troca foto e bio,
 * muda para conta profissional, entra no perfil e no destaque configurados,
 * toca no link (página de permissões da Meta), aceita as permissões, posta o
 * story com o link, destaca e desliga o container. O formulário tem campos
 * fixos (um perfil com destaque); as etapas por alvo continuam valendo.
 *
 * As etapas são expandidas AQUI, na criação do job (uma leva por alvo), e vão
 * em emulator_jobs.acoes como [{ key, label }]: a tela e o agente
 * (agente-vps/fluxos/estruturacao.mjs) usam esse array, nunca uma constante.
 * SQL em supabase/vps_estruturacao.sql. Validação única para diálogo e servidor.
 */

export const BIO_MAX = 150;
export const LEGENDA_MAX = 200;
export const DESTAQUE_MAX = 30;
export const ALVOS_MAX = 10;
export const AGENDAR_PADRAO_H = 24;
export const AGENDAR_MAX_H = 720;

export const MIDIA_MAX_BYTES = 8 * 1024 * 1024;
export const MIDIA_EXTENSOES: ReadonlyArray<string> = [".jpg", ".jpeg", ".png", ".webp"];

/** A conta não está logada no Instagram do container: o job para (a conta não é descartada). */
export const SESSAO_PERDIDA = "SESSAO_PERDIDA";
/** A página abriu sem sessão e o container não tem navegador para o login. */
export const SEM_NAVEGADOR = "SEM_NAVEGADOR";
/** Falha da etapa profissional: só as etapas de OAuth ficam bloqueadas. */
export const PROFISSIONAL_FALHOU = "PROFISSIONAL_FALHOU";
/** A página confirmou um @ diferente do da conta. */
export const CONEXAO_OUTRA_CONTA = "CONEXAO_OUTRA_CONTA";

export interface EstruturaAlvo {
  /** @ do perfil, sem o @. */
  perfil: string;
  /** Nome do destaque do alvo onde está o link. */
  destaque: string;
  /** Link do sticker do destaque do alvo; "" = não informado (o agente acha o sticker na tela). */
  link: string;
}

export interface EstruturaDados {
  /** Arquivo de /opt/scalemaster/midias (caminho relativo); "" = sem foto. */
  fotoPerfil: string;
  fotoStory: string;
  bio: string;
  alvos: EstruturaAlvo[];
  /** Link do sticker do story (jobs antigos: ausente, vale o link do 1º alvo). */
  linkStory?: string;
  /** Legenda do sticker de link do story. */
  legenda: string;
  /** Nome do destaque criado na conta com o story. */
  destaque: string;
  fazerPerfil: boolean;
  fazerOauth: boolean;
  fazerStory: boolean;
  /** 0 = agora. */
  agendarHoras: number;
}

export interface PlanoEtapa {
  key: string;
  label: string;
}

/** O que vai criptografado em input_enc do job de estruturação. */
export interface EstruturaInput extends EstruturaDados {
  plano: PlanoEtapa[];
  /** @ e senha da conta (login pelo Chrome quando a página abre sem sessão). */
  conta: { usuario: string; senha: string };
  pais: string;
}

const PERFIL_RE = /^[a-z0-9._]{1,30}$/;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Textarea "Alvos": uma linha por alvo, `@perfil | Nome do destaque | link`.
 * Linha em branco é ignorada; `erros` traz o motivo de cada linha ruim.
 */
export function parseAlvos(raw: unknown): { alvos: EstruturaAlvo[]; erros: string[] } {
  const alvos: EstruturaAlvo[] = [];
  const erros: string[] = [];
  const linhas = String(typeof raw === "string" ? raw : "").split(/\r?\n/);
  linhas.forEach((linha, i) => {
    if (!linha.trim()) return;
    const n = i + 1;
    const partes = linha.split("|").map((p) => p.trim());
    if (partes.length !== 3) return void erros.push(`Linha ${n}: use "@perfil | Nome do destaque | link".`);
    const perfil = partes[0].replace(/^@/, "").toLowerCase();
    if (!PERFIL_RE.test(perfil)) return void erros.push(`Linha ${n}: @ inválido.`);
    if (!partes[1] || partes[1].length > 60) return void erros.push(`Linha ${n}: nome do destaque vazio ou com mais de 60 caracteres.`);
    let url: URL;
    try {
      url = new URL(partes[2]);
    } catch {
      return void erros.push(`Linha ${n}: link inválido.`);
    }
    if (url.protocol !== "https:" || !url.hostname.includes(".")) return void erros.push(`Linha ${n}: o link precisa começar com https://.`);
    alvos.push({ perfil, destaque: partes[1], link: url.toString() });
  });
  if (alvos.length > ALVOS_MAX) erros.push(`No máximo ${ALVOS_MAX} alvos por estruturação.`);
  return { alvos, erros };
}

/** Perfil com o destaque que leva à página de permissões (padrão do campo). */
export const PERFIL_PADRAO = "link.zada";
/** Texto embaixo da capa do destaque do perfil configurado (padrão do campo). */
export const NOME_DESTAQUE_PADRAO = "AQUI 🔗👆";

/** Caracteres contados por code point (o que a pessoa vê): emoji conta 1, não 2. */
export function contarCaracteres(valor: string): number {
  return [...valor].length;
}

/** Campos do diálogo Estruturar, na ordem da tela. */
export type CampoEstrutura =
  | "fotoPerfil"
  | "fotoStory"
  | "bio"
  | "perfil"
  | "nomeDestaque"
  | "linkStory"
  | "legendaSticker"
  | "legendaDestaque"
  | "agendarHoras";

const ORDEM_DOS_ERROS: ReadonlyArray<CampoEstrutura> = [
  "fotoPerfil",
  "fotoStory",
  "bio",
  "perfil",
  "nomeDestaque",
  "linkStory",
  "legendaSticker",
  "legendaDestaque",
  "agendarHoras",
];

function lerEstrutura(raw: unknown) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const horasBruto = r.agendarHoras;
  return {
    fotoPerfil: texto(r.fotoPerfil),
    fotoStory: texto(r.fotoStory),
    bio: texto(r.bio),
    // Campo ausente (API sem o campo) = o padrão; campo enviado vazio = vazio (bloqueia).
    perfil: (r.perfil === undefined ? PERFIL_PADRAO : texto(r.perfil)).replace(/^@/, "").toLowerCase(),
    nomeDestaque: r.nomeDestaque === undefined ? NOME_DESTAQUE_PADRAO : texto(r.nomeDestaque),
    linkStory: texto(r.linkStory),
    legendaSticker: texto(r.legendaSticker),
    legendaDestaque: texto(r.legendaDestaque),
    horas: horasBruto === undefined || horasBruto === null || horasBruto === "" ? AGENDAR_PADRAO_H : Number(horasBruto),
  };
}

function linkHttps(valor: string): boolean {
  try {
    const u = new URL(valor);
    return u.protocol === "https:" && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Um erro por campo (o primeiro de cada), na ordem da tela. Vazio = pode
 * enviar. Bloqueiam: sem foto de perfil, sem foto do story, sem perfil, sem
 * nome do destaque e sem link do story (sem ele não há sticker). Limites
 * contados por code point. O servidor usa o mesmo (parseEstrutura devolve o primeiro).
 */
export function errosPorCampo(raw: unknown, midias: ReadonlyArray<string> | null): Partial<Record<CampoEstrutura, string>> {
  const f = lerEstrutura(raw);
  const erros: Partial<Record<CampoEstrutura, string>> = {};
  const marcar = (campo: CampoEstrutura, msg: string) => {
    if (!erros[campo]) erros[campo] = msg;
  };

  if (!f.fotoPerfil) marcar("fotoPerfil", "Escolha a foto de perfil.");
  else if (midias && !midias.includes(f.fotoPerfil)) marcar("fotoPerfil", `A foto de perfil "${f.fotoPerfil}" não está em /opt/scalemaster/midias.`);
  if (!f.fotoStory) marcar("fotoStory", "Escolha a foto do story.");
  else if (midias && !midias.includes(f.fotoStory)) marcar("fotoStory", `A foto do story "${f.fotoStory}" não está em /opt/scalemaster/midias.`);

  if (contarCaracteres(f.bio) > BIO_MAX) marcar("bio", `A bio passa de ${BIO_MAX} caracteres (${contarCaracteres(f.bio)}).`);

  if (!f.perfil) marcar("perfil", "Informe o perfil com o destaque.");
  else if (!PERFIL_RE.test(f.perfil)) marcar("perfil", "@ inválido: só letras, números, ponto e _ (até 30).");

  if (!f.nomeDestaque) marcar("nomeDestaque", "Informe o nome do destaque (o texto embaixo da capa).");
  else if (contarCaracteres(f.nomeDestaque) > DESTAQUE_MAX) marcar("nomeDestaque", `O nome do destaque passa de ${DESTAQUE_MAX} caracteres.`);
  else if (/[\r\n]/.test(f.nomeDestaque)) marcar("nomeDestaque", "O nome do destaque não pode ter quebra de linha.");

  if (!f.linkStory) marcar("linkStory", "Informe o link do sticker do story.");
  else if (!linkHttps(f.linkStory)) marcar("linkStory", "O link precisa começar com https://.");

  if (contarCaracteres(f.legendaSticker) > LEGENDA_MAX) marcar("legendaSticker", `A legenda do sticker passa de ${LEGENDA_MAX} caracteres (${contarCaracteres(f.legendaSticker)}).`);
  if (contarCaracteres(f.legendaDestaque) > DESTAQUE_MAX) marcar("legendaDestaque", `A legenda do destaque passa de ${DESTAQUE_MAX} caracteres.`);
  else if (/[\r\n]/.test(f.legendaDestaque)) marcar("legendaDestaque", "A legenda do destaque não pode ter quebra de linha.");

  if (!Number.isFinite(f.horas) || f.horas < 0 || f.horas > AGENDAR_MAX_H) marcar("agendarHoras", `"Agendar em" vai de 0 a ${AGENDAR_MAX_H} horas.`);
  return erros;
}

/**
 * Formulário → dados do job. Um alvo só: o perfil configurado, achado pelo
 * nome do destaque; o link do alvo é o do sticker do destaque dele (não é
 * informado: o agente acha o sticker na tela). O story usa o link e a legenda
 * do sticker configurados.
 */
export function parseEstrutura(raw: unknown, midias: ReadonlyArray<string> | null): { value: EstruturaDados } | { error: string } {
  const erros = errosPorCampo(raw, midias);
  const primeiro = ORDEM_DOS_ERROS.find((c) => erros[c]);
  if (primeiro) return { error: erros[primeiro] as string };
  const f = lerEstrutura(raw);
  return {
    value: {
      fotoPerfil: f.fotoPerfil,
      fotoStory: f.fotoStory,
      bio: f.bio,
      alvos: [{ perfil: f.perfil, destaque: f.nomeDestaque, link: "" }],
      linkStory: f.linkStory,
      legenda: f.legendaSticker,
      // decisão: o destaque da conta leva o nome do destaque configurado; a "legenda do destaque", se preenchida, substitui.
      destaque: f.legendaDestaque || f.nomeDestaque,
      fazerPerfil: true,
      fazerOauth: true,
      fazerStory: true,
      agendarHoras: Math.round(f.horas * 100) / 100,
    },
  };
}

/** Sufixos das etapas de cada alvo, na ordem. */
export const ETAPAS_DO_ALVO: ReadonlyArray<string> = ["perfil", "destaque", "link", "conectar", "consentir", "confirmar"];

/** Etapas do job, expandidas por alvo. A ordem é a de execução. */
export function expandirEtapas(d: Pick<EstruturaDados, "alvos" | "bio" | "fazerPerfil" | "fazerOauth" | "fazerStory">): PlanoEtapa[] {
  const plano: PlanoEtapa[] = [
    { key: "rede", label: "Validar a proxy e subir o sidecar" },
    { key: "abrir", label: "Ligar o container" },
    { key: "instagram", label: "Abrir o Instagram" },
    { key: "sessao", label: "Conferir que a conta está logada" },
  ];
  if (d.fazerPerfil) {
    plano.push({ key: "foto", label: "Trocar a foto de perfil" });
    if (d.bio) plano.push({ key: "bio", label: "Preencher a bio" });
  }
  if (d.fazerOauth) {
    plano.push({ key: "profissional", label: "Mudar para conta profissional (Criador)" });
    d.alvos.forEach((alvo, i) => {
      const n = i + 1;
      plano.push(
        { key: `perfil-${n}`, label: `Alvo ${n}: abrir o perfil @${alvo.perfil}` },
        { key: `destaque-${n}`, label: `Alvo ${n}: abrir o destaque "${alvo.destaque}"` },
        { key: `link-${n}`, label: `Alvo ${n}: tocar no link do destaque` },
        { key: `conectar-${n}`, label: `Alvo ${n}: Conectar` },
        { key: `consentir-${n}`, label: `Alvo ${n}: Permitir` },
        { key: `confirmar-${n}`, label: `Alvo ${n}: confirmar a conta conectada` }
      );
    });
  }
  if (d.fazerStory) {
    plano.push({ key: "story", label: "Postar o story com link" }, { key: "destacar", label: "Destacar o story" });
  }
  plano.push({ key: "fechar", label: "Desligar o container" });
  return plano;
}

const KEY_RE = /^[a-z0-9-]{1,30}$/;

/** Lê emulator_jobs.acoes de um job de estruturação. */
export function parsePlano(raw: unknown): PlanoEtapa[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanoEtapa[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.key !== "string" || !KEY_RE.test(r.key) || typeof r.label !== "string") continue;
    out.push({ key: r.key, label: r.label.slice(0, 120) });
  }
  return out;
}

/** Barra da segunda linha do card: etapas concluídas sobre o array do job. */
export function progressoEstrutura(job: {
  plano: ReadonlyArray<PlanoEtapa>;
  steps: ReadonlyArray<{ key: string; status: string }>;
  status: string;
}): { label: string; pct: number; feitas: number; total: number; falhas: number } {
  const porChave = new Map(job.steps.map((s) => [s.key, s.status]));
  const total = job.plano.length;
  const feitas = job.plano.filter((p) => porChave.get(p.key) === "done").length;
  const falhas = job.plano.filter((p) => porChave.get(p.key) === "error").length;
  const atual = job.plano.find((p) => porChave.get(p.key) === "running");
  const pct = total === 0 ? 0 : Math.round(((feitas + falhas) / total) * 100);
  const label =
    job.status === "done"
      ? "Estruturada"
      : job.status === "queued"
        ? "Na fila"
        : atual
          ? atual.label
          : job.status === "error"
            ? `Parou (${falhas} etapa${falhas === 1 ? "" : "s"} com falha)`
            : "Rodando";
  return { label, pct: job.status === "done" ? 100 : pct, feitas, total, falhas };
}

export type ResultadoAlvo = "conectado" | "falhou" | "pulado" | "rodando" | "pendente";

export interface AlvoResultado {
  n: number;
  /** @ do alvo (do rótulo da etapa perfil-N). */
  perfil: string;
  /** Nome do destaque (do rótulo da etapa destaque-N). */
  destaque: string;
  resultado: ResultadoAlvo;
  /** Mensagem que decide o resultado: a confirmação, a falha (ex.: CONEXAO_OUTRA_CONTA) ou o motivo do salto. */
  mensagem: string | null;
  /** Etapa que falhou, se falhou (para o print). */
  etapaComFalha: string | null;
  /** Chaves das etapas do alvo que já rodaram (concluídas ou com falha): uma miniatura de print cada. */
  tentativas: string[];
}

const PULADA_RE = /^(pulada:|PROFISSIONAL_FALHOU)/;

/**
 * Resultado de cada alvo do job, a partir do plano e do andamento:
 * conectado = confirmar-N concluída; falhou = alguma etapa do alvo falhou de
 * verdade (CONEXAO_OUTRA_CONTA inclusive); pulado = só saltos (profissional
 * falhou, ou etapa anterior do alvo); rodando / pendente.
 */
export function resultadoPorAlvo(plano: ReadonlyArray<PlanoEtapa>, steps: ReadonlyArray<{ key: string; status: string; message?: string | null }>): AlvoResultado[] {
  const porChave = new Map(steps.map((s) => [s.key, s]));
  const numeros = [...new Set(plano.map((p) => /^perfil-(\d+)$/.exec(p.key)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  return numeros.map((n) => {
    const rotulo = (tipo: string) => plano.find((p) => p.key === `${tipo}-${n}`)?.label ?? "";
    const perfil = /@([a-z0-9._]+)/.exec(rotulo("perfil"))?.[1] ?? "";
    const destaque = /"(.*)"/.exec(rotulo("destaque"))?.[1] ?? "";
    const doAlvo = ETAPAS_DO_ALVO.map((tipo) => ({ key: `${tipo}-${n}`, step: porChave.get(`${tipo}-${n}`) }));
    const tentativas = doAlvo.filter((e) => e.step && (e.step.status === "done" || (e.step.status === "error" && !PULADA_RE.test(e.step.message ?? "")))).map((e) => e.key);
    const falha = doAlvo.find((e) => e.step?.status === "error" && !PULADA_RE.test(e.step.message ?? ""));
    const salto = doAlvo.find((e) => e.step?.status === "error" && PULADA_RE.test(e.step.message ?? ""));
    const confirmar = porChave.get(`confirmar-${n}`);
    const base = { n, perfil, destaque, tentativas };
    if (falha) return { ...base, resultado: "falhou" as const, mensagem: falha.step?.message ?? null, etapaComFalha: falha.key };
    if (confirmar?.status === "done") return { ...base, resultado: "conectado" as const, mensagem: confirmar.message ?? null, etapaComFalha: null };
    if (salto) return { ...base, resultado: "pulado" as const, mensagem: salto.step?.message ?? null, etapaComFalha: null };
    if (doAlvo.some((e) => e.step?.status === "running")) return { ...base, resultado: "rodando" as const, mensagem: null, etapaComFalha: null };
    return { ...base, resultado: "pendente" as const, mensagem: null, etapaComFalha: null };
  });
}

/** Resumo de uma linha no fim do job: "N de M alvos conectados". null = job sem alvos. */
export function resumoDosAlvos(alvos: ReadonlyArray<Pick<AlvoResultado, "resultado">>): string | null {
  if (alvos.length === 0) return null;
  const conectados = alvos.filter((a) => a.resultado === "conectado").length;
  return `${conectados} de ${alvos.length} ${alvos.length === 1 ? "alvo conectado" : "alvos conectados"}`;
}

/**
 * Selo verde do card da conta (12/11):
 *   "pronta"    — estruturação concluída sem falha e todos os alvos conectados
 *                 (conectada no SaaS e pronta para receber postagens);
 *   "conectada" — todos os alvos conectados, mas alguma etapa de fora (ex.: destaque) falhou;
 *   null        — sem estruturação, rodando, ou algum alvo sem conexão.
 */
export type Prontidao = "pronta" | "conectada" | null;

export function prontidaoDaConta(
  estrutura: { status: string; plano?: ReadonlyArray<PlanoEtapa> | null; steps: ReadonlyArray<{ key: string; status: string; message?: string | null }> } | null | undefined
): Prontidao {
  if (!estrutura || (estrutura.status !== "done" && estrutura.status !== "error")) return null;
  const alvos = resultadoPorAlvo(estrutura.plano ?? [], estrutura.steps);
  const todos = alvos.length > 0 && alvos.every((a) => a.resultado === "conectado");
  if (estrutura.status === "done" && (todos || alvos.length === 0)) return "pronta";
  return todos ? "conectada" : null;
}

/** Quando o job pode sair da fila; null = agora. */
export function agendadoPara(horas: number, agora = Date.now()): string | null {
  return horas > 0 ? new Date(agora + horas * 3_600_000).toISOString() : null;
}
