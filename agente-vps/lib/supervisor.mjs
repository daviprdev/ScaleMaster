import os from "node:os";
import { rodar, trecho } from "./processo.mjs";

/**
 * Pool de workers da VPS: dois semáforos (containers ligados e cadastros ao
 * mesmo tempo), um watchdog por conta e a limpeza de órfãos no boot.
 *
 * Concorrência pela CPU da máquina (igual em x86_64 e arm64):
 *   maxLigadas  = clamp(floor(vCPU / 2), 1, 8)   containers de pé ao mesmo tempo
 *   maxCadastro = clamp(floor(vCPU / 2), 1, 4)   jobs rodando ao mesmo tempo, nunca acima de maxLigadas
 * Cada container roda com --cpus 1 e --memory 1536m (lib/android.mjs); com
 * menos de 4 vCPU é um por vez e a aba avisa "host pequeno".
 *
 * O servidor já entrega no máximo maxCadastro contas por vez (vai no sync como
 * capacity); o semáforo aqui é a trava local para o caso de o servidor e o
 * agente discordarem (versão antiga do SaaS).
 */

export const MB_POR_CONTAINER = 1536;
export const MAX_LIGADAS = 8;
export const MAX_CADASTRO = 4;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Os dois limites a partir das vCPUs: maxCadastro nunca passa de maxLigadas. */
export function limitesPorVcpu(vcpu) {
  const metade = Math.floor((Number.isFinite(vcpu) && vcpu > 0 ? vcpu : 1) / 2);
  const maxLigadas = clamp(metade, 1, MAX_LIGADAS);
  return { maxLigadas, maxCadastro: Math.min(clamp(metade, 1, MAX_CADASTRO), maxLigadas) };
}
/** Conta sem progresso de etapa por mais que isso é morta pelo watchdog (o cadastro em si tem limite próprio de 45 min). */
export const TRAVADO_MS = 60 * 60_000;

/** "x86_64" ou "arm64" a partir de process.arch / uname -m (igual a android.mjs, sem importar o driver). */
function archNormalizada(arch) {
  const a = String(arch ?? "").toLowerCase();
  if (a === "arm64" || a === "aarch64") return "arm64";
  return "x86_64";
}

/**
 * Capacidade desta máquina. Os parâmetros existem para os testes (e para o
 * comando `capacidade`); sem eles lê a máquina real.
 * @param {{ arch?: string, vcpu?: number, totalMb?: number, livreMb?: number }} [opcoes]
 */
export function capacidade({ arch = process.arch, vcpu = os.cpus().length || 1, totalMb = Math.floor(os.totalmem() / 1024 / 1024), livreMb = Math.floor(os.freemem() / 1024 / 1024) } = {}) {
  const a = archNormalizada(arch);
  return { arch: a, vcpu, ramTotalMb: totalMb, ramUsadaMb: Math.max(0, totalMb - livreMb), ...limitesPorVcpu(vcpu) };
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
