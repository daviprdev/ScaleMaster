import { readFileSync } from "node:fs";
import { bloqueioPorRam, type RamHost } from "./jobs";

/**
 * RAM do host lida na hora (só servidor). O container do app enxerga o
 * /proc/meminfo do host (o Docker não isola o meminfo), e o app roda na mesma
 * VPS que o agente: é a memória que os containers de conta vão disputar.
 */
// decisão: app e agente-vps na mesma VPS (scalemaster.tech). Com o agente noutra máquina esta leitura seria a do app.
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

/** Memória do host agora, com o bloqueio já calculado para `maxLigadas`. null = não deu para ler. */
export function ramDoHost(maxLigadas: number, arquivo = process.env.VPS_MEMINFO || "/proc/meminfo"): RamHost | null {
  try {
    const lida = lerMeminfo(readFileSync(arquivo, "utf8"));
    if (!lida) return null;
    return { ...lida, lidaEm: new Date().toISOString(), bloqueio: bloqueioPorRam(lida.livreMb, maxLigadas) };
  } catch {
    return null;
  }
}
