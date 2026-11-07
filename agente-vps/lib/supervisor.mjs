import os from "node:os";
import { rodar, trecho } from "./processo.mjs";

/**
 * Pool de workers da VPS: dois semáforos (containers ligados e cadastros ao
 * mesmo tempo), um watchdog por conta e a limpeza de órfãos no boot.
 *
 *   maxLigadas  = RAM_MB / 1400   (cada redroid com o Instagram fica em ~1,4 GB)
 *   maxCadastro = max(2, vCPU / 2)
 *
 * O servidor já entrega no máximo maxCadastro contas por vez (vai no sync como
 * capacity); o semáforo aqui é a trava local para o caso de o servidor e o
 * agente discordarem (versão antiga do SaaS).
 */

export const MB_POR_CONTAINER = 1400;
/** Conta sem progresso de etapa por mais que isso é morta pelo watchdog (o cadastro em si tem limite próprio de 45 min). */
export const TRAVADO_MS = 60 * 60_000;

export function capacidade() {
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  const livreMb = Math.floor(os.freemem() / 1024 / 1024);
  const vcpu = os.cpus().length || 1;
  return {
    maxLigadas: Math.max(1, Math.floor(totalMb / MB_POR_CONTAINER)),
    maxCadastro: Math.max(2, Math.floor(vcpu / 2)),
    ramTotalMb: totalMb,
    ramUsadaMb: Math.max(0, totalMb - livreMb),
  };
}

/** Semáforo simples: `pegar()` espera uma vaga e devolve a função que solta. */
export class Semaforo {
  constructor(max) {
    this.max = max;
    this.usadas = 0;
    this.fila = [];
  }

  get livres() {
    return this.max - this.usadas;
  }

  pegar() {
    return new Promise((resolve) => {
      const conceder = () => {
        this.usadas += 1;
        let solto = false;
        resolve(() => {
          if (solto) return;
          solto = true;
          this.usadas -= 1;
          const proximo = this.fila.shift();
          if (proximo) proximo();
        });
      };
      if (this.usadas < this.max) conceder();
      else this.fila.push(conceder);
    });
  }
}

/**
 * Watchdog de uma conta: `bater()` a cada etapa concluída; se passar TRAVADO_MS
 * sem bater, chama `matar()` (fecha o container) e a etapa em curso falha.
 */
export function criarWatchdog(matar, { travadoMs = TRAVADO_MS } = {}) {
  let timer = null;
  const armar = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      matar();
    }, travadoMs);
    timer.unref?.();
  };
  armar();
  return {
    bater: armar,
    parar: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Containers do Scale Master que estão ligados agora (nome → id). */
export async function containersLigados() {
  const r = await rodar("docker", ["ps", "--filter", "label=scalemaster.vps=1", "--filter", "label=scalemaster.conta", "--format", "{{.Names}}"], { timeoutMs: 20_000 });
  return String(r.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((n) => /^ig-\d+$/.test(n));
}

/**
 * Boot do agente: nenhum container de conta deve estar ligado sem uma conta
 * em andamento (o agente caiu no meio). Desliga todos: o Continuar na aba
 * religa o que precisar, e desligado não tem Instagram rodando sem proxy.
 */
export async function limparOrfaos(fechar, log = () => {}) {
  const ligados = await containersLigados();
  for (const nome of ligados) {
    const index = Number(nome.slice(3));
    log(`container ${nome} ligado sem conta em andamento: desligando`);
    try {
      await fechar(index);
    } catch (e) {
      log(`não desliguei ${nome}: ${trecho(e.message)}`);
    }
  }
  return ligados.length;
}
