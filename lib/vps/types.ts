/**
 * Aba Contas VPS: contas do Instagram criadas em containers redroid numa VPS
 * (agente-vps/). O agente usa o mesmo sync do MuMu; o que separa as abas é
 * emulator_agents.kind = 'vps'. SQL em supabase/vps_contas.sql.
 */

import type { EmulatorJob } from "@/lib/emulador/jobs";
import type { EmulatorInstance } from "@/lib/emulador/types";

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
  /** RAM_MB / 1400: containers ligados ao mesmo tempo. */
  maxLigadas: number;
  /** max(2, vCPU / 2): cadastros rodando ao mesmo tempo. */
  maxCadastro: number;
  ramTotalMb: number;
  ramUsadaMb: number;
  /** Containers ligados agora. */
  ligadas: number;
  /** APKs do Instagram em /opt/scalemaster/apks (versões). */
  versoesIg: string[];
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

export type VpsDeviceStatus = "criado" | "proxy-ok" | "proxy-morta" | "ativo";

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
export interface VpsJob extends EmulatorJob {
  loteId: string | null;
  pausa: "proxy" | null;
  versaoIg: string | null;
}

export interface VpsResponse {
  /** false = supabase/vps_contas.sql ainda não aplicado. */
  available: boolean;
  /** false = supabase/emulador_contas.sql ainda não aplicado. */
  jobsAvailable: boolean;
  agents: VpsAgent[];
  jobs: VpsJob[];
  devices: VpsDevice[];
}

/** Dados de uma conta do lote, já validados (lib/vps/input.ts). */
export interface VpsContaDados {
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
}

/** O que vai criptografado em emulator_jobs.input_enc de uma conta da VPS. */
export interface VpsContaInput {
  /** URL normalizada, ex.: http://usuario:senha@host:porta */
  proxy: string;
  /** País esperado da proxy (ISO-2); a VPS confere no endpoint de geo. */
  pais: string;
  versaoIg: string;
  perfil: DevicePerfil;
  conta: {
    email: string;
    senha: string;
    nome: string;
    usuario: string;
    nascimento: string;
  };
  imap: { host: string; porta: number; usuario: string; senha: string };
  device: VpsDeviceSpec;
}
