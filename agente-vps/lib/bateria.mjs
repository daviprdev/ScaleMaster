/** Bateria de aparelho em uso: descarregando, sem carregador, nível e temperatura variando. */
export async function bateria(d, { nivel } = {}) {
  const l = nivel ?? 62 + Math.floor(Math.random() * 33);
  // Chaves aceitas pelo dumpsys battery set do Android 13: ac, usb, wireless, status, level, temp, present, counter, invalid.
  await d.shell("dumpsys", "battery", "set", "level", String(l));
  // status 3 = BATTERY_STATUS_DISCHARGING (2 é carregando).
  await d.shell("dumpsys", "battery", "set", "status", "3");
  await d.shell("dumpsys", "battery", "set", "ac", "0");
  await d.shell("dumpsys", "battery", "set", "usb", "0");
  await d.shell("dumpsys", "battery", "set", "wireless", "0");
  await d.shell("dumpsys", "battery", "set", "present", "1");
  // decisão: health não é chave do dumpsys battery set; fica a do aparelho.
  await d.shell("dumpsys", "battery", "set", "temp", String(280 + Math.floor(Math.random() * 50)));
  // decisão: devolve o nível para o log da etapa.
  return l;
}
