import { randomBytes, randomInt } from "node:crypto";
import { gerarAndroidId, gerarImei, gerarMac } from "./ids.mjs";

/**
 * Perfil de aparelho de cada conta. O servidor gera a identidade ao enviar o
 * lote (lib/vps/device.ts, mesma lista) e manda em input.device; este módulo
 * sabe transformá-la nas props do Android, gerar uma para teste local e
 * conferir por getprop depois do boot. Identidade é imutável: divergência no
 * boot é falha da etapa, não correção silenciosa.
 */

const HEX = "0123456789ABCDEF";
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
const sortearDe = (alfabeto, n) => Array.from({ length: n }, () => alfabeto[randomInt(alfabeto.length)]).join("");

/** Perfis reais com Android 13 (iguais aos de lib/vps/device.ts). */
export const PERFIS = [
  { key: "pixel7", model: "Pixel 7", manufacturer: "Google", brand: "google", device: "panther", product: "panther", buildId: "TQ3A.230901.001", serial: () => sortearDe(HEX, 12) },
  { key: "sm-a546e", model: "SM-A546E", manufacturer: "samsung", brand: "samsung", device: "a54x", product: "a54xnsxx", buildId: "TP1A.220624.014", serial: () => `R5CW${sortearDe(ALNUM, 7)}` },
  { key: "moto-g84", model: "moto g84 5G", manufacturer: "motorola", brand: "motorola", device: "bangkk", product: "bangkk_g", buildId: "T1TBS33.78-62-7", serial: () => `ZY${sortearDe(ALNUM, 10)}` },
];

export const GEO_POR_PAIS = {
  BR: { timezone: "America/Sao_Paulo", locale: "pt-BR" },
  PT: { timezone: "Europe/Lisbon", locale: "pt-PT" },
  US: { timezone: "America/New_York", locale: "en-US" },
  GB: { timezone: "Europe/London", locale: "en-GB" },
  ES: { timezone: "Europe/Madrid", locale: "es-ES" },
  MX: { timezone: "America/Mexico_City", locale: "es-MX" },
  AR: { timezone: "America/Argentina/Buenos_Aires", locale: "es-AR" },
  CO: { timezone: "America/Bogota", locale: "es-CO" },
  DE: { timezone: "Europe/Berlin", locale: "de-DE" },
  FR: { timezone: "Europe/Paris", locale: "fr-FR" },
  IT: { timezone: "Europe/Rome", locale: "it-IT" },
  CA: { timezone: "America/Toronto", locale: "en-CA" },
};

export function geoDoPais(pais) {
  return GEO_POR_PAIS[String(pais ?? "").toUpperCase()] ?? { timezone: "UTC", locale: "en-US" };
}

/** Identidade nova (teste local: node agente.mjs nova-conta sem input.device). */
export function gerar({ perfil = "aleatorio", pais = "BR", index = 1 } = {}) {
  const real = perfil === "aleatorio" ? PERFIS[randomInt(PERFIS.length)] : PERFIS.find((p) => p.key === perfil) ?? PERFIS[0];
  const { timezone, locale } = geoDoPais(pais);
  const incremental = String(randomInt(1_000_000, 9_999_999));
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
    fingerprint: `${real.brand}/${real.product}/${real.device}:13/${real.buildId}/${incremental}:user/release-keys`,
    buildId: real.buildId,
    resolucao: "1080x1920",
    dpi: 420,
    timezone,
    locale,
    pais: String(pais).toUpperCase(),
    container: `ig-${index}`,
    volume: `scalemaster-ig-${index}`,
    index,
  };
}

/** Segredo de 16 hex quando precisa de um Android ID avulso. */
export function androidIdAvulso() {
  return randomBytes(8).toString("hex");
}

/**
 * Props de identidade que vão nos build.prop do container (system, vendor e
 * product recebem o mesmo mapa: o init do Android deriva ro.product.* da
 * partição de maior prioridade e ro.build.fingerprint vem do system).
 */
export function propsDe(device) {
  const inc = /\/([^/:]+):user/.exec(device.fingerprint)?.[1] ?? "1";
  const descricao = `${device.product}-user 13 ${device.buildId} ${inc} release-keys`;
  const base = {
    "ro.product.model": device.model,
    "ro.product.manufacturer": device.manufacturer,
    "ro.product.brand": device.brand,
    "ro.product.device": device.device,
    "ro.product.name": device.product,
    "ro.build.id": device.buildId,
    "ro.build.display.id": device.buildId,
    "ro.build.version.incremental": inc,
    "ro.build.fingerprint": device.fingerprint,
    "ro.build.description": descricao,
    "ro.build.type": "user",
    "ro.build.tags": "release-keys",
    "ro.build.flavor": `${device.product}-user`,
    "ro.build.product": device.product,
    "ro.build.characteristics": "default",
  };
  for (const parte of ["system", "vendor", "product", "odm", "system_ext"]) {
    base[`ro.product.${parte}.model`] = device.model;
    base[`ro.product.${parte}.manufacturer`] = device.manufacturer;
    base[`ro.product.${parte}.brand`] = device.brand;
    base[`ro.product.${parte}.device`] = device.device;
    base[`ro.product.${parte}.name`] = device.product;
    base[`ro.${parte}.build.fingerprint`] = device.fingerprint;
    base[`ro.${parte}.build.id`] = device.buildId;
    base[`ro.${parte}.build.type`] = "user";
    base[`ro.${parte}.build.tags`] = "release-keys";
  }
  return base;
}

/**
 * Reescreve um build.prop da imagem base com as props da conta: troca as
 * chaves que existem e acrescenta as que faltam no fim. Linhas de comentário
 * ficam como estão.
 */
export function aplicarProps(textoBase, props) {
  const pendentes = new Map(Object.entries(props));
  const linhas = String(textoBase ?? "")
    .split(/\r?\n/)
    .map((linha) => {
      const m = /^([A-Za-z0-9_.\-]+)=(.*)$/.exec(linha);
      if (!m || !pendentes.has(m[1])) return linha;
      const valor = pendentes.get(m[1]);
      pendentes.delete(m[1]);
      return `${m[1]}=${valor}`;
    });
  while (linhas.length && linhas[linhas.length - 1] === "") linhas.pop();
  if (pendentes.size > 0) {
    linhas.push("", "# Scale Master: identidade da conta");
    for (const [k, v] of pendentes) linhas.push(`${k}=${v}`);
  }
  return `${linhas.join("\n")}\n`;
}

/** Props que o boot precisa bater (getprop) com a identidade; divergência = falha da etapa. */
export function conferencias(device) {
  return [
    ["ro.product.model", device.model],
    ["ro.product.manufacturer", device.manufacturer],
    ["ro.build.fingerprint", device.fingerprint],
    ["ro.serialno", device.serial],
    ["persist.sys.timezone", device.timezone],
    ["persist.sys.locale", device.locale],
  ];
}

/** Lê as props no aparelho e devolve a lista das que divergem ([nome, esperado, lido]). */
export async function conferir(d, device) {
  const erradas = [];
  for (const [nome, esperado] of conferencias(device)) {
    const lido = await d.prop(nome);
    if (lido !== esperado) erradas.push([nome, esperado, lido]);
  }
  const androidId = (await d.shell("settings", "get", "secure", "android_id")).trim();
  if (androidId !== device.androidId) erradas.push(["android_id", device.androidId, androidId]);
  return erradas;
}

/** Aplica no aparelho o que não precisa de reboot: Android ID, fuso e idioma. */
export async function aplicarNoAparelho(d, device) {
  await d.root();
  await d.shell("settings", "put", "secure", "android_id", device.androidId);
  await d.setprop("persist.sys.timezone", device.timezone);
  await d.setprop("persist.sys.locale", device.locale);
  // Idioma do sistema: a tela do Instagram sai no idioma do locale.
  await d.shell("setprop", "persist.sys.language", device.locale.split("-")[0]).catch(() => {});
  await d.shell("setprop", "persist.sys.country", device.locale.split("-")[1] ?? "").catch(() => {});
}
