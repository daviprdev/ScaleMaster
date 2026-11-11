/**
 * "Estruturar" da aba Contas VPS (emulator_jobs.kind = 'estruturacao'): numa
 * conta já criada, o agente sobe a proxy, abre o Instagram, troca foto e bio,
 * muda para conta profissional, percorre os alvos (perfil → destaque → link →
 * Conectar → Permitir → confirmação), posta o story com link e destaca.
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
  /** Link do sticker (https://). */
  link: string;
}

export interface EstruturaDados {
  /** Arquivo de /opt/scalemaster/midias (caminho relativo); "" = sem foto. */
  fotoPerfil: string;
  fotoStory: string;
  bio: string;
  alvos: EstruturaAlvo[];
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

/**
 * Valida o que o diálogo manda. `midias` = arquivos existentes na pasta (null =
 * não conferir, usado só em teste). Regras do botão: sem foto com o
 * interruptor correspondente ligado, ou sem alvo válido, não passa.
 */
/** Campos do diálogo Estruturar que podem ter erro próprio. */
export type CampoEstrutura = "alvos" | "fotoPerfil" | "fotoStory" | "bio" | "legenda" | "destaque" | "agendarHoras" | "interruptores";

function lerEstrutura(raw: unknown) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const horasBruto = r.agendarHoras;
  return {
    fazerPerfil: r.fazerPerfil !== false,
    fazerOauth: r.fazerOauth !== false,
    fazerStory: r.fazerStory !== false,
    fotoPerfil: texto(r.fotoPerfil),
    fotoStory: texto(r.fotoStory),
    bio: texto(r.bio),
    legenda: texto(r.legenda),
    destaque: texto(r.destaque),
    lidos: parseAlvos(r.alvos),
    horas: horasBruto === undefined || horasBruto === null || horasBruto === "" ? AGENDAR_PADRAO_H : Number(horasBruto),
  };
}

/**
 * Todos os erros do formulário, um por campo (o primeiro de cada), na ordem
 * em que aparecem na tela. Vazio = pode enviar. O servidor usa o mesmo
 * (parseEstrutura devolve o primeiro).
 */
export function errosPorCampo(raw: unknown, midias: ReadonlyArray<string> | null): Partial<Record<CampoEstrutura, string>> {
  const f = lerEstrutura(raw);
  const erros: Partial<Record<CampoEstrutura, string>> = {};
  const marcar = (campo: CampoEstrutura, msg: string) => {
    if (!erros[campo]) erros[campo] = msg;
  };

  if (f.lidos.erros.length > 0) marcar("alvos", f.lidos.erros[0]);
  else if (f.lidos.alvos.length < 1) marcar("alvos", "Informe ao menos um alvo: @perfil | Nome do destaque | link.");

  if (f.fazerPerfil && !f.fotoPerfil) marcar("fotoPerfil", "Escolha a foto de perfil (ou desligue Foto + bio).");
  else if (f.fazerPerfil && midias && !midias.includes(f.fotoPerfil)) marcar("fotoPerfil", `A foto de perfil "${f.fotoPerfil}" não está em /opt/scalemaster/midias.`);
  if (f.fazerStory && !f.fotoStory) marcar("fotoStory", "Escolha a foto do story (ou desligue Story).");
  else if (f.fazerStory && midias && !midias.includes(f.fotoStory)) marcar("fotoStory", `A foto do story "${f.fotoStory}" não está em /opt/scalemaster/midias.`);

  if (f.bio.length > BIO_MAX) marcar("bio", `A bio passa de ${BIO_MAX} caracteres (${f.bio.length}).`);
  if (f.legenda.length > LEGENDA_MAX) marcar("legenda", `A legenda do story passa de ${LEGENDA_MAX} caracteres (${f.legenda.length}).`);
  if (f.destaque.length > DESTAQUE_MAX) marcar("destaque", `O nome do destaque passa de ${DESTAQUE_MAX} caracteres.`);
  if (f.fazerStory && !f.destaque) marcar("destaque", "Informe o nome do destaque (ou desligue Story).");
  // Acento e emoji valem: o agente digita pelo teclado ADB (broadcast). Só o nome do destaque não quebra linha.
  if (/[\r\n]/.test(f.destaque)) marcar("destaque", "O nome do destaque não pode ter quebra de linha.");
  if (!f.fazerPerfil && !f.fazerOauth && !f.fazerStory) marcar("interruptores", "Ligue ao menos um interruptor.");
  if (!Number.isFinite(f.horas) || f.horas < 0 || f.horas > AGENDAR_MAX_H) marcar("agendarHoras", `"Agendar em" vai de 0 a ${AGENDAR_MAX_H} horas.`);
  return erros;
}

/** Ordem de prioridade do primeiro erro (a mesma das mensagens antigas). */
const ORDEM_DOS_ERROS: ReadonlyArray<CampoEstrutura> = ["alvos", "fotoPerfil", "fotoStory", "bio", "legenda", "destaque", "interruptores", "agendarHoras"];

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
      alvos: f.lidos.alvos,
      legenda: f.legenda,
      destaque: f.destaque,
      fazerPerfil: f.fazerPerfil,
      fazerOauth: f.fazerOauth,
      fazerStory: f.fazerStory,
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

/** Quando o job pode sair da fila; null = agora. */
export function agendadoPara(horas: number, agora = Date.now()): string | null {
  return horas > 0 ? new Date(agora + horas * 3_600_000).toISOString() : null;
}
