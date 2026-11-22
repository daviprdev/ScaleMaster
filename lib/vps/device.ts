import { randomBytes, randomInt } from "crypto";
import type { DevicePerfil, VpsDeviceSpec } from "./types";

/**
 * Identidade de aparelho de cada conta da VPS. Só no servidor (usa crypto):
 * gerada ao enviar o lote, gravada em vps_devices e mandada ao agente dentro
 * do input criptografado; o agente aplica no boot e confere por getprop.
 */

interface PerfilReal {
  key: Exclude<DevicePerfil, "aleatorio">;
  model: string;
  manufacturer: string;
  brand: string;
  device: string;
  product: string;
  /** Builds reais do Android 13 do aparelho; cada conta sorteia um (igual a agente-vps/lib/fingerprint.mjs). */
  buildIds: readonly string[];
  board: string;
  /** Vai em androidboot.hardware (ro.hardware) e no build.prop. */
  hardware: string;
  platform: string;
  resolucao: string;
  dpi: number;
  buildHost: string;
  buildUser: string;
  versao: number;
  /** Prefixo do serial (Pixel: 12 hex; Samsung: R5C…; Moto: ZY…). */
  serial: () => string;
}

const HEX = "0123456789ABCDEF";
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
const sortearDe = (alfabeto: string, n: number) => Array.from({ length: n }, () => alfabeto[randomInt(alfabeto.length)]).join("");

/** Perfis reais com Android 13 e build coerente entre si (fingerprint = brand/product/device:13/buildId/incremental:user/release-keys). */
export const PERFIS_REAIS: ReadonlyArray<PerfilReal> = [
  {
    key: "pixel7",
    model: "Pixel 7",
    manufacturer: "Google",
    brand: "google",
    device: "panther",
    product: "panther",
    board: "panther",
    hardware: "panther",
    platform: "gs201",
    resolucao: "1080x2400",
    dpi: 420,
    buildHost: "abfarm-release-rbe-64-0002",
    buildUser: "android-build",
    versao: 13,
    buildIds: ["TQ3A.230901.001", "TQ3A.230805.001", "TQ2A.230505.002", "TQ3A.230705.001", "TQ1A.230205.002", "TQ3A.230605.010", "TQ2A.230405.003", "TQ3A.230805.002"],
    serial: () => sortearDe(HEX, 12),
  },
  {
    key: "sm-a546e",
    model: "SM-A546E",
    manufacturer: "samsung",
    brand: "samsung",
    device: "a54x",
    product: "a54xnsxx",
    board: "s5e8835",
    hardware: "s5e8835",
    platform: "exynos1380",
    resolucao: "1080x2340",
    dpi: 450,
    buildHost: "SWDD6822",
    buildUser: "dpi",
    versao: 13,
    buildIds: ["TP1A.220624.014", "TP1A.220624.021", "TP1A.220624.018", "TP1A.220624.024", "TP1A.220624.011", "TP1A.220624.027", "TP1A.220624.016", "TP1A.220624.030"],
    serial: () => `R5CW${sortearDe(ALNUM, 7)}`,
  },
  {
    key: "moto-g84",
    model: "moto g84 5G",
    manufacturer: "motorola",
    brand: "motorola",
    device: "bangkk",
    product: "bangkk_g",
    board: "bangkk",
    hardware: "qcom",
    platform: "holi",
    resolucao: "1080x2400",
    dpi: 405,
    buildHost: "ilclbld35",
    buildUser: "hudsoncm",
    versao: 13,
    buildIds: ["T1TBS33.78-62-7", "T1TBS33.78-62-5", "T1TBS33.78-54-2", "T1TBS33.78-62-9", "T1TBS33.78-45-1", "T1TBS33.78-62-11", "T1TBS33.78-68-3", "T1TBS33.78-62-14"],
    serial: () => `ZY${sortearDe(ALNUM, 10)}`,
  },
  { key: "pixel6a", model: "Pixel 6a", manufacturer: "Google", brand: "google", device: "bluejay", product: "bluejay", board: "bluejay", hardware: "bluejay", platform: "gs101", resolucao: "1080x2400", dpi: 420, buildHost: "abfarm-release-rbe-64-0002", buildUser: "android-build", versao: 13, buildIds: ["TQ3A.230901.001", "TQ3A.230805.001", "TQ2A.230505.002", "TQ3A.230705.001", "TQ1A.230205.002", "TQ3A.230605.010", "TQ2A.230405.003", "TQ3A.230805.002"], serial: () => sortearDe(HEX, 12) },
  { key: "pixel8", model: "Pixel 8", manufacturer: "Google", brand: "google", device: "shiba", product: "shiba", board: "shiba", hardware: "shiba", platform: "zuma", resolucao: "1080x2400", dpi: 420, buildHost: "abfarm-release-rbe-64-0002", buildUser: "android-build", versao: 14, buildIds: ["UQ1A.240205.002", "UQ1A.240105.004", "UP1A.231105.003", "UQ1A.240205.004", "UQ1A.231205.015", "UP1A.231105.001", "UQ1A.240205.007", "UQ1A.240305.002"], serial: () => sortearDe(HEX, 12) },
  { key: "sm-a346e", model: "SM-A346E", manufacturer: "samsung", brand: "samsung", device: "a34x", product: "a34xnsxx", board: "mt6877", hardware: "mt6877", platform: "mt6877", resolucao: "1080x2340", dpi: 450, buildHost: "SWDD6822", buildUser: "dpi", versao: 13, buildIds: ["TP1A.220624.014", "TP1A.220624.021", "TP1A.220624.018", "TP1A.220624.024", "TP1A.220624.011", "TP1A.220624.027", "TP1A.220624.016", "TP1A.220624.030"], serial: () => `R5CW${sortearDe(ALNUM, 7)}` },
  { key: "sm-a155m", model: "SM-A155M", manufacturer: "samsung", brand: "samsung", device: "a15x", product: "a15xnsxx", board: "mt6789", hardware: "mt6789", platform: "mt6789", resolucao: "1080x2340", dpi: 450, buildHost: "SWDD6822", buildUser: "dpi", versao: 14, buildIds: ["UP1A.231005.007", "UP1A.231005.011", "UP1A.231005.014", "UP1A.231005.019", "UP1A.231005.022", "UP1A.231005.026", "UP1A.231005.031", "UP1A.231005.035"], serial: () => `R5CW${sortearDe(ALNUM, 7)}` },
  { key: "moto-g54", model: "moto g54 5G", manufacturer: "motorola", brand: "motorola", device: "devonf", product: "devonf_g", board: "mt6855", hardware: "mt6855", platform: "mt6855", resolucao: "1080x2400", dpi: 405, buildHost: "ilclbld35", buildUser: "hudsoncm", versao: 13, buildIds: ["T1TBS33.78-62-7", "T1TBS33.78-62-5", "T1TBS33.78-54-2", "T1TBS33.78-62-9", "T1TBS33.78-45-1", "T1TBS33.78-62-11", "T1TBS33.78-68-3", "T1TBS33.78-62-14"], serial: () => `ZY${sortearDe(ALNUM, 10)}` },
  { key: "moto-e14", model: "moto e14", manufacturer: "motorola", brand: "motorola", device: "milanf", product: "milanf_g", board: "mt6769", hardware: "mt6769", platform: "mt6769", resolucao: "720x1600", dpi: 270, buildHost: "ilclbld35", buildUser: "hudsoncm", versao: 14, buildIds: ["U1TBS34.33-42-3", "U1TBS34.33-42-5", "U1TBS34.33-38-2", "U1TBS34.33-42-8", "U1TBS34.33-45-1", "U1TBS34.33-42-11", "U1TBS34.33-48-2", "U1TBS34.33-42-14"], serial: () => `ZY${sortearDe(ALNUM, 10)}` },
  { key: "redmi-note-12", model: "Redmi Note 12", manufacturer: "Xiaomi", brand: "Redmi", device: "tapas", product: "tapas_global", board: "holi", hardware: "qcom", platform: "holi", resolucao: "1080x2400", dpi: 395, buildHost: "c5-xm-build-06", buildUser: "builder", versao: 13, buildIds: ["TKQ1.221114.001", "TKQ1.221013.002", "TKQ1.221114.005", "TKQ1.221013.007", "TKQ1.221114.009", "TKQ1.221013.011", "TKQ1.221114.013", "TKQ1.221013.016"], serial: () => sortearDe(ALNUM, 9) },
  { key: "sm-g990e", model: "SM-G990E", manufacturer: "samsung", brand: "samsung", device: "r9q", product: "r9qnsxx", board: "r9q", hardware: "qcom", platform: "lahaina", resolucao: "1080x2340", dpi: 450, buildHost: "SWDD6822", buildUser: "dpi", versao: 13, buildIds: ["TP1A.220624.014", "TP1A.220624.021", "TP1A.220624.018", "TP1A.220624.024", "TP1A.220624.011", "TP1A.220624.027", "TP1A.220624.016", "TP1A.220624.030"], serial: () => `R5CW${sortearDe(ALNUM, 7)}` },
  { key: "moto-g73", model: "moto g73 5G", manufacturer: "motorola", brand: "motorola", device: "devon", product: "devon_g", board: "mt6833", hardware: "mt6833", platform: "mt6833", resolucao: "1080x2400", dpi: 405, buildHost: "ilclbld35", buildUser: "hudsoncm", versao: 13, buildIds: ["T1TBS33.78-62-7", "T1TBS33.78-62-5", "T1TBS33.78-54-2", "T1TBS33.78-62-9", "T1TBS33.78-45-1", "T1TBS33.78-62-11", "T1TBS33.78-68-3", "T1TBS33.78-62-14"], serial: () => `ZY${sortearDe(ALNUM, 10)}` },
];

/** Fuso e idioma pelo país da proxy (ISO-2). Fora da lista: en-US / UTC. */
export const GEO_POR_PAIS: Readonly<Record<string, { timezone: string; locale: string }>> = {
  BR: { timezone: "America/Sao_Paulo", locale: "pt-BR" },
  PT: { timezone: "Europe/Lisbon", locale: "pt-PT" },
  US: { timezone: "America/New_York", locale: "en-US" },
  GB: { timezone: "Europe/London", locale: "en-GB" },
  ES: { timezone: "Europe/Madrid", locale: "es-ES" },
  MX: { timezone: "America/Mexico_City", locale: "es-MX" },
  AR: { timezone: "America/Argentina/Buenos_Aires", locale: "es-AR" },
  CO: { timezone: "America/Bogota", locale: "es-CO" },
  CL: { timezone: "America/Santiago", locale: "es-CL" },
  PE: { timezone: "America/Lima", locale: "es-PE" },
  DE: { timezone: "Europe/Berlin", locale: "de-DE" },
  FR: { timezone: "Europe/Paris", locale: "fr-FR" },
  IT: { timezone: "Europe/Rome", locale: "it-IT" },
  NL: { timezone: "Europe/Amsterdam", locale: "nl-NL" },
  CA: { timezone: "America/Toronto", locale: "en-CA" },
  AU: { timezone: "Australia/Sydney", locale: "en-AU" },
  IN: { timezone: "Asia/Kolkata", locale: "en-IN" },
  JP: { timezone: "Asia/Tokyo", locale: "ja-JP" },
  TR: { timezone: "Europe/Istanbul", locale: "tr-TR" },
  PL: { timezone: "Europe/Warsaw", locale: "pl-PL" },
};

export function geoDoPais(pais: string): { timezone: string; locale: string } {
  return GEO_POR_PAIS[pais.toUpperCase()] ?? { timezone: "UTC", locale: "en-US" };
}

function digitoLuhn(corpo: string): number {
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) {
    let d = Number(corpo[corpo.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
  }
  return (10 - (soma % 10)) % 10;
}

/** IMEI com dígito verificador (decorativo no redroid: só fica guardado). */
export function gerarImei(): string {
  let corpo = "35";
  while (corpo.length < 14) corpo += String(randomInt(10));
  return corpo + digitoLuhn(corpo);
}

/** MAC unicast "de fábrica" (dois bits baixos do 1º byte zerados), fora do 02: que o Docker usa. */
export function gerarMac(): string {
  const bytes = randomBytes(6);
  bytes[0] = (bytes[0] & 0xfc) | 0x00;
  if (bytes[0] === 0x00 || bytes[0] === 0x02) bytes[0] = 0x3c;
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(":");
}

export function gerarAndroidId(): string {
  return randomBytes(8).toString("hex");
}

/** Incremental do build: número de 7 dígitos, como nas builds de fábrica. */
function incremental(): string {
  return String(randomInt(1_000_000, 9_999_999));
}

export const REDE_MAX = 254;

/**
 * Rede de um lote novo: um /24 só dele (10.77.<n>.0/24), n de 1 a 254. Pega o
 * número acima do maior já usado; esgotou, o menor livre. `usadas` = redes das
 * contas que existem nessa VPS (0 = bridge antiga, não conta).
 */
export function proximaRede(usadas: Iterable<number>): number {
  const set = new Set<number>();
  for (const n of usadas) if (Number.isInteger(n) && n >= 1 && n <= REDE_MAX) set.add(n);
  const acima = Math.max(0, ...set) + 1;
  if (acima <= REDE_MAX) return acima;
  for (let n = 1; n <= REDE_MAX; n++) if (!set.has(n)) return n;
  throw new Error("Não há mais rede /24 livre nesta VPS (254 lotes vivos).");
}

/** IP do container na rede do lote (mesma conta de agente-vps/lib/rede.mjs). Rede 0 = bridge antiga (índice + 2). */
export function ipNaRede(rede: number, index: number): string {
  if (rede === 0) return `10.77.0.${index + 2}`;
  return `10.77.${rede}.${2 + (index % 250)}`;
}

/** IP de uma identidade: o gravado ou, nas contas antigas, o da bridge de sempre. */
export function ipDoDevice(device: Pick<VpsDeviceSpec, "index" | "rede" | "ip">): string {
  return device.ip || ipNaRede(device.rede ?? 0, device.index);
}

/** Tela de identidade antiga (antes de 22/11 o perfil não trazia tela; o agente cai nisto sem resolucao/dpi). */
export const RESOLUCAO = "1080x1920";
export const DPI = 420;

/**
 * Identidade imutável de uma conta: perfil real (ou sorteado), serial,
 * Android ID, MAC, fingerprint coerente com o Android 13 e fuso/idioma do país
 * da proxy. `index` = índice do container (ig-<índice>) que o servidor reserva;
 * `rede` = o /24 do lote (proximaRede). Nada aqui sai de constante por conta:
 * serial, Android ID, MAC, IMEI e o incremental do fingerprint são sorteados, e
 * fuso/idioma vêm do país da proxy da própria conta.
 */
export function novoDevice(perfil: DevicePerfil, pais: string, index: number, rede = 0): VpsDeviceSpec {
  const real = perfil === "aleatorio" ? PERFIS_REAIS[randomInt(PERFIS_REAIS.length)] : PERFIS_REAIS.find((p) => p.key === perfil) ?? PERFIS_REAIS[0];
  const { timezone, locale } = geoDoPais(pais);
  const buildId = real.buildIds[randomInt(real.buildIds.length)];
  const fingerprint = `${real.brand}/${real.product}/${real.device}:${real.versao}/${buildId}/${incremental()}:user/release-keys`;
  const patch = new Date(Date.now() - randomInt(30, 120) * 86400000).toISOString().slice(0, 10);
  return {
    androidId: gerarAndroidId(),
    serial: real.serial(),
    mac: gerarMac(),
    imei: gerarImei(),
    model: real.model,
    manufacturer: real.manufacturer,
    brand: real.brand,
    device: real.device,
    product: real.product,
    board: real.board,
    hardware: real.hardware,
    platform: real.platform,
    buildHost: real.buildHost,
    buildUser: real.buildUser,
    fingerprint,
    buildId,
    versao: real.versao,
    securityPatch: patch,
    bootloader: buildId,
    resolucao: real.resolucao,
    dpi: real.dpi,
    timezone,
    locale,
    pais: pais.toUpperCase(),
    container: `ig-${index}`,
    volume: `scalemaster-ig-${index}`,
    index,
    rede,
    ip: ipNaRede(rede, index),
  };
}

/**
 * IP ou MAC da identidade nova que já pertence a outra conta (linhas de
 * vps_devices para o MAC, identidades das contas da VPS para o IP): devolve o
 * motivo, ou null. Com colisão o envio é abortado.
 */
export function colisaoDeIdentidade(
  novo: Pick<VpsDeviceSpec, "mac" | "index" | "rede" | "ip">,
  existentes: ReadonlyArray<{ mac?: string | null; ip?: string | null; container?: string | null }>
): string | null {
  const ip = ipDoDevice(novo);
  for (const e of existentes) {
    if (e.mac && e.mac.toLowerCase() === novo.mac.toLowerCase()) return `o MAC ${novo.mac} já é de ${e.container ?? "outra conta"}`;
    if (e.ip && e.ip === ip) return `o IP ${ip} já é de ${e.container ?? "outra conta"}`;
  }
  return null;
}

/**
 * Próximos índices livres de container numa VPS: acima de tudo o que já
 * existe (retrato do agente, contas da fila e devices gravados). O agente
 * recusa criar se o índice já estiver ocupado no Docker.
 */
export function proximosIndices(ocupados: Iterable<number>, quantidade: number): number[] {
  let maior = 0;
  for (const i of ocupados) if (Number.isInteger(i) && i > maior) maior = i;
  return Array.from({ length: quantidade }, (_, k) => maior + 1 + k);
}
