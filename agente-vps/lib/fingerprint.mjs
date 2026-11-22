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
  { key: "pixel7", model: "Pixel 7", manufacturer: "Google", brand: "google", device: "panther", product: "panther", board: "panther", hardware: "panther", platform: "gs201", resolucao: "1080x2400", dpi: 420, buildHost: "abfarm-release-rbe-64-0002", buildUser: "android-build", buildIds: ["TQ3A.230901.001", "TQ3A.230805.001", "TQ2A.230505.002", "TQ3A.230705.001", "TQ1A.230205.002", "TQ3A.230605.010", "TQ2A.230405.003", "TQ3A.230805.002"], serial: () => sortearDe(HEX, 12) },
  { key: "sm-a546e", model: "SM-A546E", manufacturer: "samsung", brand: "samsung", device: "a54x", product: "a54xnsxx", board: "s5e8835", hardware: "s5e8835", platform: "exynos1380", resolucao: "1080x2340", dpi: 450, buildHost: "SWDD6822", buildUser: "dpi", buildIds: ["TP1A.220624.014", "TP1A.220624.021", "TP1A.220624.018", "TP1A.220624.024", "TP1A.220624.011", "TP1A.220624.027", "TP1A.220624.016", "TP1A.220624.030"], serial: () => `R5CW${sortearDe(ALNUM, 7)}` },
  { key: "moto-g84", model: "moto g84 5G", manufacturer: "motorola", brand: "motorola", device: "bangkk", product: "bangkk_g", board: "bangkk", hardware: "qcom", platform: "holi", resolucao: "1080x2400", dpi: 405, buildHost: "ilclbld35", buildUser: "hudsoncm", buildIds: ["T1TBS33.78-62-7", "T1TBS33.78-62-5", "T1TBS33.78-54-2", "T1TBS33.78-62-9", "T1TBS33.78-45-1", "T1TBS33.78-62-11", "T1TBS33.78-68-3", "T1TBS33.78-62-14"], serial: () => `ZY${sortearDe(ALNUM, 10)}` },
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
    fingerprint: `${real.brand}/${real.product}/${real.device}:13/${buildId}/${incremental}:user/release-keys`,
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
    "ro.product.board": device.board ?? device.device,
    "ro.board.platform": device.platform ?? device.device,
    "ro.hardware": device.hardware ?? device.device,
    // O hwcomposer do redroid (hwcomposer.redroid.so) era achado pelo ro.hardware; com o hardware do perfil fica fixado aqui.
    "ro.hardware.hwcomposer": "redroid",
    "ro.build.host": device.buildHost ?? "localhost",
    "ro.build.user": device.buildUser ?? "android-build",
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
