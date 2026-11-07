import { randomBytes, randomInt } from "node:crypto";

/**
 * Identidade de cada cópia no MuMu (Configurações do dispositivo → Modelo).
 *
 * IMEI = 14 dígitos + 1 dígito verificador (Luhn). Quinze números sorteados
 * sem a conta erram o último dígito 9 em cada 10 vezes, e qualquer checagem de
 * IMEI acusa. Aqui sorteia 12 depois do "35" (prefixo comum de aparelho real) e
 * calcula o 15º.
 */
export function digitoLuhn(corpo) {
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

export function gerarImei() {
  let corpo = "35";
  while (corpo.length < 14) corpo += String(randomInt(10));
  return corpo + digitoLuhn(corpo);
}

export function imeiValido(imei) {
  return /^\d{15}$/.test(imei) && digitoLuhn(imei.slice(0, 14)) === Number(imei[14]);
}

/** Android ID: 16 caracteres hexadecimais, como o do Android. */
export function gerarAndroidId() {
  return randomBytes(8).toString("hex");
}

/** MAC de placa comum: unicast e "de fábrica" (os dois bits baixos do 1º byte zerados). */
export function gerarMac() {
  const bytes = randomBytes(6);
  bytes[0] &= 0xfc;
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(":");
}
