import { readFileSync } from "node:fs";
import { bloqueioPorRam, type RamHost } from "./jobs";
import type { VpsCapacidade } from "./types";

/**
 * RAM do host lida na hora (só servidor). O container do app enxerga o
 * /proc/meminfo do host (o Docker não isola o meminfo), e o app roda na mesma
 * VPS que o agente: é a memória que os containers de conta vão disputar.
 */
export function lerMeminfo(texto: string): { livreMb: number; totalMb: number } | null {
  const kb = (campo: string) => {
    const m = new RegExp(`^${campo}:\\s+(\\d+)\\s*kB`, "m").exec(texto);
    return m ? Number(m[1]) : null;
  };
  const total = kb("MemTotal");
  const livre = kb("MemAvailable") ?? kb("MemFree");
  if (total === null || livre === null) return null;
  return { livreMb: Math.floor(livre / 1024), totalMb: Math.floor(total / 1024) };
}

/**
 * RAM do host do agente: a que ele mandou no último sync (capacity.ramDisponivelMb,
 * agente 1.9.5+, ~3 s de atraso). É a que vale com o agente noutra máquina (12/11);
 * sem ela (agente antigo), cai na leitura do /proc/meminfo do app (mesma VPS).
 */
export function ramDoAgente(cap: Pick<VpsCapacidade, "ramDisponivelMb" | "ramTotalMb" | "maxLigadas">, maxLigadas = cap.maxLigadas): RamHost | null {
  if (cap.ramDisponivelMb === null || cap.ramDisponivelMb === undefined) return ramDoHost(maxLigadas);
  return { livreMb: cap.ramDisponivelMb, totalMb: cap.ramTotalMb, lidaEm: new Date().toISOString(), bloqueio: bloqueioPorRam(cap.ramDisponivelMb, maxLigadas) };
}

/** Memória do host do app agora, com o bloqueio já calculado para `maxLigadas`. null = não deu para ler. */
export function ramDoHost(maxLigadas: number, arquivo = process.env.VPS_MEMINFO || "/proc/meminfo"): RamHost | null {
  try {
    const lida = lerMeminfo(readFileSync(arquivo, "utf8"));
    if (!lida) return null;
    return { ...lida, lidaEm: new Date().toISOString(), bloqueio: bloqueioPorRam(lida.livreMb, maxLigadas) };
  } catch {
    return null;
  }
}
