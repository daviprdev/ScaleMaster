/**
 * Aba Contas VPS: contas do Instagram criadas em containers redroid numa VPS
 * (agente-vps/). O agente usa o mesmo sync do MuMu; o que separa as abas é
 * emulator_agents.kind = 'vps'. SQL em supabase/vps_contas.sql.
 */

import type { EmulatorJob } from "@/lib/emulador/jobs";
import type { EmulatorInstance } from "@/lib/emulador/types";
import type { PlanoEtapa } from "./estruturacao";

export type AgentKind = "mumu" | "vps";

/** Perfis de aparelho que o lote pode pedir (fingerprint coerente com Android 13). */
export type DevicePerfil = "aleatorio" | "pixel7" | "sm-a546e" | "moto-g84";

export const DEVICE_PERFIS: ReadonlyArray<{ key: DevicePerfil; label: string }> = [
  { key: "aleatorio", label: "Aleatório" },
  { key: "pixel7", label: "Google Pixel 7" },
  { key: "sm-a546e", label: "Samsung Galaxy A54 (SM-A546E)" },
  { key: "moto-g84", label: "Motorola Moto G84" },
];

/** O que a VPS informa no sync (emulator_agents.capacidade). */
export interface VpsCapacidade {
  /** clamp(floor(vCPU / 2), 1, 8): containers ligados ao mesmo tempo. */
  maxLigadas: number;
  /** clamp(floor(vCPU / 2), 1, 4), nunca acima de maxLigadas: jobs rodando ao mesmo tempo. */
  maxCadastro: number;
  /** vCPUs do host (0 = agente antigo, que não informa). */
  vcpu: number;
  ramTotalMb: number;
  ramUsadaMb: number;
  /** Containers ligados agora. */
  ligadas: number;
  /** APKs do Instagram em /opt/scalemaster/apks (versões). */
  versoesIg: string[];
  /** Os 5 processos do host que mais usam RAM (RSS), lidos pelo agente a cada 30 s. */
  topRss: ProcessoRss[];
  /** HOST_TESTE=1 no .env do agente: o bloqueio de RAM do lote vira aviso e o envio passa. */
  hostTeste: boolean;
  /** MemAvailable do host do agente em MB (agente 1.9.5+); null = agente antigo (o app lê o próprio /proc/meminfo). */
  ramDisponivelMb: number | null;
}

export interface ProcessoRss {
  /** Comando (sem o caminho), cortado em 60 caracteres. */
  nome: string;
  rssMb: number;
  /** Container Docker do processo, quando ele roda num (ex.: teste-ig, ig-7). */
  container: string | null;
}

export interface VpsAgent {
  id: string;
  hostname: string | null;
  online: boolean;
  lastSeenAt: string | null;
  agentVersion: string | null;
  /** Versão do Docker/redroid que o agente achou. */
  engineVersion: string | null;
  engineError: string | null;
  instances: EmulatorInstance[];
  capacidade: VpsCapacidade;
  createdAt: string;
}

export type VpsDeviceStatus = "criado" | "proxy-ok" | "proxy-morta" | "ativo" | "descartada";

/** Identidade imutável de uma conta/container (vps_devices). */
export interface VpsDevice {
  id: string;
  jobId: string;
  androidId: string;
  serial: string;
  mac: string;
  model: string;
  manufacturer: string;
  fingerprint: string;
  resolucao: string;
  timezone: string;
  locale: string;
  container: string;
  volume: string;
  status: VpsDeviceStatus;
  createdAt: string;
}

/** Conta da fila da VPS: o job comum mais lote, pausa e versão do IG. */
export interface VpsJob extends Omit<EmulatorJob, "kind"> {
  /** estruturacao = Estruturar desta aba (lib/vps/estruturacao.ts): segunda linha do card da conta. */
  kind: EmulatorJob["kind"] | "estruturacao";
  loteId: string | null;
  pausa: "proxy" | null;
  versaoIg: string | null;
  /** host:porta da proxy da conta (sem credenciais); null se ilegível. */
  proxyHost: string | null;
  /** IP do container na bridge do lote (bloco Isolamento); null se ilegível. */
  ip?: string | null;
  /** Só estruturacao: etapas expandidas na criação do job (emulator_jobs.acoes). */
  plano?: PlanoEtapa[];
  /** Só estruturacao: id da conta (job nova-conta) estruturada. */
  contaId?: string | null;
  /** Só estruturacao: quando sai da fila; null = agora. */
  agendadoPara?: string | null;
  /** Pasta da conta (supabase/vps_pastas.sql); null = sem pasta. */
  pasta?: string | null;
}

export interface VpsResponse {
  /** false = supabase/vps_contas.sql ainda não aplicado. */
  available: boolean;
  /** false = supabase/emulador_contas.sql ainda não aplicado. */
  jobsAvailable: boolean;
  agents: VpsAgent[];
  jobs: VpsJob[];
  devices: VpsDevice[];
  /** false = supabase/vps_estruturacao.sql ainda não aplicado (o botão Estruturar avisa). */
  estruturaAvailable?: boolean;
  /** false = supabase/vps_pastas.sql ainda não aplicado (pastas avisam). */
  pastasAvailable?: boolean;
  /** RAM do host lida na hora pelo servidor (null = não deu para ler). */
  ramHost?: RamHost | null;
}

/** RAM do host no momento da leitura, e o motivo do bloqueio de lote (null = libera). */
export interface RamHost {
  livreMb: number;
  totalMb: number;
  lidaEm: string;
  bloqueio: string | null;
}

/** RAM do lote já decidida para um agente: bloqueia, ou passa com aviso (host de teste), ou passa. */
export interface DecisaoRam {
  bloqueio: string | null;
  aviso: string | null;
}

/**
 * De onde vem o código de confirmação do Instagram. Os campos são os mesmos
 * em todos: em `portal`, `email` guarda o LINK do painel e `senhaEmail` o
 * CÓDIGO DE RESGATE (hstock: "https://hridoyhub.shop/OTP/ | SUDXHRAY");
 * `mailtm` usa endereço + senha da conta no mail.tm; `manual` só o endereço
 * (o código é pedido na aba); `imap` é o antigo (host/porta/senha de app).
 */
export type ProvedorEmail = "portal" | "mailtm" | "imap" | "manual";

export const PROVEDORES_EMAIL: ReadonlyArray<{ key: ProvedorEmail; label: string }> = [
  { key: "portal", label: "Portal (hstock)" },
  { key: "mailtm", label: "Mail.tm" },
  { key: "imap", label: "IMAP" },
  { key: "manual", label: "Manual" },
];

/** Dados de uma conta do lote, já validados (lib/vps/input.ts). */
export interface VpsContaDados {
  provedorEmail: ProvedorEmail;
  email: string;
  senhaEmail: string;
  imapHost: string;
  imapPorta: number;
  senhaIg: string;
  nome: string;
  usuario: string;
  nascimento: string;
}

/** Identidade que o servidor gera e o agente aplica (input.device). */
export interface VpsDeviceSpec {
  androidId: string;
  serial: string;
  mac: string;
  imei: string;
  model: string;
  manufacturer: string;
  brand: string;
  device: string;
  product: string;
  fingerprint: string;
  buildId: string;
  resolucao: string;
  dpi: number;
  timezone: string;
  locale: string;
  pais: string;
  container: string;
  volume: string;
  index: number;
  /** Rede do lote: 10.77.<rede>.0/24 (ausente ou 0 = contas antigas, na bridge de sempre). */
  rede?: number;
  /** IP fixo do container nessa rede. */
  ip?: string;
}

/** O que vai criptografado em emulator_jobs.input_enc de uma conta da VPS. */
export interface VpsContaInput {
  /** URL normalizada, ex.: http://usuario:senha@host:porta */
  proxy: string;
  /** País esperado da proxy (ISO-2); a VPS confere no endpoint de geo. */
  pais: string;
  versaoIg: string;
  perfil: DevicePerfil;
  /** Ausente nas contas antigas = imap. */
  provedorEmail?: ProvedorEmail;
  /** Provedor portal: link do painel e código de resgate, como vieram da linha do hstock (também em conta.email / imap.senha). */
  portalLink?: string;
  portalCodigo?: string;
  /** Quando o agente resgatou o código (só na hora de digitar o e-mail) e quando a sessão de 20 min vence. Ausentes = código intocado. */
  portalResgatadoEm?: string;
  portalExpiraEm?: string;
  conta: {
    /** Endereço; em `portal`, o link do painel. */
    email: string;
    senha: string;
    nome: string;
    usuario: string;
    nascimento: string;
  };
  /** `senha` é a senha do e-mail; em `portal`, o código de resgate. host/porta só em imap. */
  imap: { host: string; porta: number; usuario: string; senha: string };
  device: VpsDeviceSpec;
}
