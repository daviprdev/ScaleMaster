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
  { key: "pixel7", model: "Pixel 7", manufacturer: "Google", brand: "google", device: "panther", product: "panther", board: "panther", hardware: "panther", platform: "gs201", resolucao: "1080x2400", dpi: 420, buildHost: "abfarm-release-rbe-64-0002", buildUser: "android-build", versao: 13, buildIds: ["TQ3A.230901.001", "TQ3A.230805.001", "TQ2A.230505.002", "TQ3A.230705.001", "TQ1A.230205.002", "TQ3A.230605.010", "TQ2A.230405.003", "TQ3A.230805.002"], serial: () => sortearDe(HEX, 12) },
  { key: "sm-a546e", model: "SM-A546E", manufacturer: "samsung", brand: "samsung", device: "a54x", product: "a54xnsxx", board: "s5e8835", hardware: "s5e8835", platform: "exynos1380", resolucao: "1080x2340", dpi: 450, buildHost: "SWDD6822", buildUser: "dpi", versao: 13, buildIds: ["TP1A.220624.014", "TP1A.220624.021", "TP1A.220624.018", "TP1A.220624.024", "TP1A.220624.011", "TP1A.220624.027", "TP1A.220624.016", "TP1A.220624.030"], serial: () => `R5CW${sortearDe(ALNUM, 7)}` },
  { key: "moto-g84", model: "moto g84 5G", manufacturer: "motorola", brand: "motorola", device: "bangkk", product: "bangkk_g", board: "bangkk", hardware: "qcom", platform: "holi", resolucao: "1080x2400", dpi: 405, buildHost: "ilclbld35", buildUser: "hudsoncm", versao: 13, buildIds: ["T1TBS33.78-62-7", "T1TBS33.78-62-5", "T1TBS33.78-54-2", "T1TBS33.78-62-9", "T1TBS33.78-45-1", "T1TBS33.78-62-11", "T1TBS33.78-68-3", "T1TBS33.78-62-14"], serial: () => `ZY${sortearDe(ALNUM, 10)}` },
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
  const buildId = real.buildIds[randomInt(real.buildIds.length)];
  const securityPatch = new Date(Date.now() - randomInt(30, 120) * 86400000).toISOString().slice(0, 10);
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
    // decisão: board/hardware/platform/build host e user vão na identidade para o propsDe usar.
    board: real.board,
    hardware: real.hardware,
    platform: real.platform,
    buildHost: real.buildHost,
    buildUser: real.buildUser,
    versao: real.versao,
    securityPatch,
    bootloader: buildId,
    fingerprint: `${real.brand}/${real.product}/${real.device}:${real.versao}/${buildId}/${incremental}:user/release-keys`,
    buildId,
    resolucao: real.resolucao,
    dpi: real.dpi,
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
  const versao = device.versao ?? 13;
  const descricao = `${device.product}-user ${versao} ${device.buildId} ${inc} release-keys`;
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
    "ro.product.board": device.board ?? device.device,
    "ro.board.platform": device.platform ?? device.device,
    "ro.hardware": device.hardware ?? device.device,
    // O hwcomposer do redroid (hwcomposer.redroid.so) era achado pelo ro.hardware; com o hardware do perfil fica fixado aqui.
    "ro.hardware.hwcomposer": "redroid",
    "ro.build.host": device.buildHost ?? "localhost",
    "ro.build.user": device.buildUser ?? "android-build",
    "ro.build.version.release": String(device.versao ?? 13),
    "ro.build.version.security_patch": device.securityPatch,
    "ro.product.marketname": device.model,
    "ro.build.version.base_os": `google/${device.product}/${device.device}:${versao}/${device.buildId}/${inc}:user/release-keys`,
    "ro.product.cpu.abilist": "arm64-v8a,x86_64,armeabi-v7a,x86",
    "ro.product.cpu.abilist64": "arm64-v8a,x86_64",
    "ro.product.cpu.abilist32": "armeabi-v7a,x86",
    "ro.debuggable": "0",
    "ro.secure": "1",
    "ro.adb.secure": "1",
    "ro.serialno": device.serial,
    "ro.boot.serialno": device.serial,
    "ro.kernel.qemu": "",
    "ro.boot.qemu": "",
    "ro.boot.verifiedbootstate": "green",
    "ro.boot.flash.locked": "1",
    "ro.boot.veritymode": "enforcing",
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
    ["ro.product.board", device.board ?? device.device],
    ["ro.board.platform", device.platform ?? device.device],
    ["ro.debuggable", "0"],
    ["ro.build.tags", "release-keys"],
    ["ro.build.version.security_patch", device.securityPatch],
    ["ro.product.marketname", device.model],
    // decisão: ro.serialno já estava na lista; fica uma entrada só.
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
