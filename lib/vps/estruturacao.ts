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
export function parseEstrutura(raw: unknown, midias: ReadonlyArray<string> | null): { value: EstruturaDados } | { error: string } {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const fazerPerfil = r.fazerPerfil !== false;
  const fazerOauth = r.fazerOauth !== false;
  const fazerStory = r.fazerStory !== false;
  const fotoPerfil = texto(r.fotoPerfil);
  const fotoStory = texto(r.fotoStory);
  const bio = texto(r.bio);
  const legenda = texto(r.legenda);
  const destaque = texto(r.destaque);

  const { alvos, erros } = parseAlvos(r.alvos);
  if (erros.length > 0) return { error: erros[0] };
  if (alvos.length < 1) return { error: "Informe ao menos um alvo: @perfil | Nome do destaque | link." };

  if (fazerPerfil && !fotoPerfil) return { error: "Escolha a foto de perfil (ou desligue Foto + bio)." };
  if (fazerStory && !fotoStory) return { error: "Escolha a foto do story (ou desligue Story)." };
  for (const [nome, arquivo, ligado] of [["foto de perfil", fotoPerfil, fazerPerfil], ["foto do story", fotoStory, fazerStory]] as const) {
    if (ligado && midias && !midias.includes(arquivo)) return { error: `A ${nome} "${arquivo}" não está em /opt/scalemaster/midias.` };
  }
  if (bio.length > BIO_MAX) return { error: `A bio passa de ${BIO_MAX} caracteres.` };
  if (legenda.length > LEGENDA_MAX) return { error: `A legenda do story passa de ${LEGENDA_MAX} caracteres.` };
  if (destaque.length > DESTAQUE_MAX) return { error: `O nome do destaque passa de ${DESTAQUE_MAX} caracteres.` };
  if (fazerStory && !destaque) return { error: "Informe o nome do destaque (ou desligue Story)." };
  // Acento e emoji valem: o agente digita pelo teclado ADB (broadcast). Só o nome do destaque não quebra linha.
  if (/[\r\n]/.test(destaque)) return { error: "O nome do destaque não pode ter quebra de linha." };
  if (!fazerPerfil && !fazerOauth && !fazerStory) return { error: "Ligue ao menos um interruptor." };

  const horas = r.agendarHoras === undefined || r.agendarHoras === null || r.agendarHoras === "" ? AGENDAR_PADRAO_H : Number(r.agendarHoras);
  if (!Number.isFinite(horas) || horas < 0 || horas > AGENDAR_MAX_H) return { error: `"Agendar em" vai de 0 a ${AGENDAR_MAX_H} horas.` };

  return {
    value: { fotoPerfil, fotoStory, bio, alvos, legenda, destaque, fazerPerfil, fazerOauth, fazerStory, agendarHoras: Math.round(horas * 100) / 100 },
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

/** Quando o job pode sair da fila; null = agora. */
export function agendadoPara(horas: number, agora = Date.now()): string | null {
  return horas > 0 ? new Date(agora + horas * 3_600_000).toISOString() : null;
}
