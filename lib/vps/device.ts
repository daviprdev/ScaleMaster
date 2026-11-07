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
  buildId: string;
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
    buildId: "TQ3A.230901.001",
    serial: () => sortearDe(HEX, 12),
  },
  {
    key: "sm-a546e",
    model: "SM-A546E",
    manufacturer: "samsung",
    brand: "samsung",
    device: "a54x",
    product: "a54xnsxx",
    buildId: "TP1A.220624.014",
    serial: () => `R5CW${sortearDe(ALNUM, 7)}`,
  },
  {
    key: "moto-g84",
    model: "moto g84 5G",
    manufacturer: "motorola",
    brand: "motorola",
    device: "bangkk",
    product: "bangkk_g",
    buildId: "T1TBS33.78-62-7",
    serial: () => `ZY${sortearDe(ALNUM, 10)}`,
  },
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

export const RESOLUCAO = "1080x1920";
export const DPI = 420;

/**
 * Identidade imutável de uma conta: perfil real (ou sorteado), serial,
 * Android ID, MAC, fingerprint coerente com o Android 13 e fuso/idioma do país
 * da proxy. `index` = índice do container (ig-<índice>) que o servidor reserva.
 */
export function novoDevice(perfil: DevicePerfil, pais: string, index: number): VpsDeviceSpec {
  const real = perfil === "aleatorio" ? PERFIS_REAIS[randomInt(PERFIS_REAIS.length)] : PERFIS_REAIS.find((p) => p.key === perfil) ?? PERFIS_REAIS[0];
  const { timezone, locale } = geoDoPais(pais);
  const fingerprint = `${real.brand}/${real.product}/${real.device}:13/${real.buildId}/${incremental()}:user/release-keys`;
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
    fingerprint,
    buildId: real.buildId,
    resolucao: RESOLUCAO,
    dpi: DPI,
    timezone,
    locale,
    pais: pais.toUpperCase(),
    container: `ig-${index}`,
    volume: `scalemaster-ig-${index}`,
    index,
  };
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
