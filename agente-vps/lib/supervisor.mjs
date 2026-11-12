import { readFileSync } from "node:fs";
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

/** MemAvailable do /proc/meminfo deste host em MB (o que o kernel ainda consegue dar); null fora do Linux. */
export function ramDisponivelMb(texto) {
  const m = /^MemAvailable:\s+(\d+)\s*kB/m.exec(String(texto ?? ""));
  return m ? Math.floor(Number(m[1]) / 1024) : null;
}

function lerRamDisponivel() {
  try {
    return ramDisponivelMb(readFileSync("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
}

/**
 * Capacidade desta máquina. Os parâmetros existem para os testes (e para o
 * comando `capacidade`); sem eles lê a máquina real. ramDisponivelMb vai junto:
 * com o agente noutra máquina (12/11) o app decide o bloqueio de RAM do lote
 * por ela, não pelo /proc/meminfo dele.
 * @param {{ arch?: string, vcpu?: number, totalMb?: number, livreMb?: number, disponivelMb?: number | null }} [opcoes]
 */
export function capacidade({ arch = process.arch, vcpu = os.cpus().length || 1, totalMb = Math.floor(os.totalmem() / 1024 / 1024), livreMb = Math.floor(os.freemem() / 1024 / 1024), disponivelMb = lerRamDisponivel() } = {}) {
  const a = archNormalizada(arch);
  // Usada = total − MemAvailable (o cache de arquivos que o kernel devolve na hora não conta como usado).
  return { arch: a, vcpu, ramTotalMb: totalMb, ramUsadaMb: Math.max(0, totalMb - (disponivelMb ?? livreMb)), ...(disponivelMb === null ? {} : { ramDisponivelMb: disponivelMb }), ...limitesPorVcpu(vcpu) };
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

/** Id do container Docker no /proc/<pid>/cgroup ("docker-<64 hex>.scope" ou ".../docker/<64 hex>"), ou null. */
export function containerDoCgroup(texto) {
  return /(?:docker-|docker\/)([0-9a-f]{64})/.exec(String(texto ?? ""))?.[1] ?? null;
}

/** Linhas do `ps -eo pid=,rss=,args= --sort=-rss` → [{ pid, rssMb, nome }] (nome sem o caminho do executável). */
export function lerPs(saida, limite = 5) {
  const out = [];
  for (const linha of String(saida ?? "").split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(linha);
    if (!m) continue;
    const nome = m[3].trim().replace(/^\S*\//, "").replace(/\s+/g, " ").slice(0, 60);
    if (!nome) continue;
    out.push({ pid: Number(m[1]), rssMb: Math.round(Number(m[2]) / 1024), nome });
    if (out.length >= limite) break;
  }
  return out;
}

/**
 * Os 5 processos do host com mais RAM residente, com o container de cada um
 * (pelo cgroup) quando roda dentro de um. Vai no sync em capacity.topRss.
 */
export async function maioresConsumidores({ limite = 5 } = {}) {
  const ps = await rodar("ps", ["-eo", "pid=,rss=,args=", "--sort=-rss"], { timeoutMs: 15_000 });
  const top = lerPs(ps.stdout, limite);
  const nomes = new Map();
  const lista = await rodar("docker", ["ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}"], { timeoutMs: 20_000 });
  for (const l of String(lista.stdout ?? "").split(/\r?\n/)) {
    const [id, nome] = l.trim().split(/\s+/);
    if (id && nome) nomes.set(id, nome);
  }
  const out = [];
  for (const p of top) {
    let cgroup = "";
    try {
      cgroup = readFileSync(`/proc/${p.pid}/cgroup`, "utf8");
    } catch {
      /* o processo acabou */
    }
    const id = containerDoCgroup(cgroup);
    out.push({ nome: p.nome, rssMb: p.rssMb, container: id ? (nomes.get(id) ?? id.slice(0, 12)) : null });
  }
  return out;
}

/** Container órfão só sai depois de parado por este tempo. */
export const ORFAO_PARADO_MS = 24 * 60 * 60_000;

/**
 * Quais containers de conta são órfãos velhos: sem job ativo, sem linha em
 * vps_devices (nem conta na fila) e parados há mais de 24 h.
 * `containers` = [{ nome, rodando, paradoEm, criadoEm }] (datas ISO do docker inspect);
 * `conhecidos` = nomes que o servidor conhece; `ativos` = nomes com job rodando agora.
 * @param {Array<{ nome: string, rodando: boolean, paradoEm?: string | null, criadoEm?: string | null }>} containers
 * @param {{ conhecidos?: Iterable<string>, ativos?: Iterable<string>, agora?: number, paradoMs?: number }} [opcoes]
 */
export function orfaosParaApagar(containers, { conhecidos, ativos = new Set(), agora = Date.now(), paradoMs = ORFAO_PARADO_MS } = {}) {
  const sabe = conhecidos instanceof Set ? conhecidos : new Set(conhecidos ?? []);
  const emUso = ativos instanceof Set ? ativos : new Set(ativos ?? []);
  return containers.filter((c) => {
    if (!/^ig-\d+$/.test(c.nome) || c.rodando || sabe.has(c.nome) || emUso.has(c.nome)) return false;
    // Nunca ligado: o Docker devolve 0001-01-01 em FinishedAt; vale a data de criação.
    const parado = Date.parse(c.paradoEm ?? "");
    const desde = Number.isFinite(parado) && parado > 0 ? parado : Date.parse(c.criadoEm ?? "");
    return Number.isFinite(desde) && agora - desde > paradoMs;
  });
}

/** Containers de conta que existem no Docker, com estado e datas. */
export async function containersDeConta() {
  const lista = await rodar("docker", ["ps", "-a", "--filter", "label=scalemaster.vps=1", "--filter", "label=scalemaster.conta", "--format", "{{.Names}}"], { timeoutMs: 20_000 });
  const out = [];
  for (const nome of String(lista.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter((n) => /^ig-\d+$/.test(n))) {
    const r = await rodar("docker", ["inspect", "--format", "{{.State.Running}}|{{.State.FinishedAt}}|{{.Created}}", nome], { timeoutMs: 20_000 });
    if (r.codigo !== 0) continue;
    const [rodando, paradoEm, criadoEm] = trecho(r.stdout, 300).split("|");
    out.push({ nome, rodando: rodando === "true", paradoEm, criadoEm });
  }
  return out;
}

/**
 * Boot do agente (primeiro sync): container de conta sem job ativo e sem linha
 * em vps_devices, parado há mais de 24 h, vira `docker rm` (ele e o sidecar),
 * com log. O volume e o retrato ficam: nada da conta é apagado aqui.
 * @param {{ conhecidos?: Iterable<string>, ativos?: Iterable<string>, log?: (m: string) => void, agora?: number, listar?: () => Promise<Array<{ nome: string, rodando: boolean, paradoEm?: string | null, criadoEm?: string | null }>>, remover?: (nome: string) => Promise<void> }} [opcoes]
 */
export async function limparOrfaosAntigos({ conhecidos, ativos, log = () => {}, agora = Date.now(), listar = containersDeConta, remover } = {}) {
  const apagar =
    remover ??
    (async (nome) => {
      await rodar("docker", ["rm", "-f", `${nome}-proxy`], { timeoutMs: 60_000 });
      const r = await rodar("docker", ["rm", nome], { timeoutMs: 120_000 });
      if (r.codigo !== 0) throw new Error(trecho(r.stderr || r.stdout));
    });
  const orfaos = orfaosParaApagar(await listar(), { conhecidos, ativos, agora });
  const removidos = [];
  for (const c of orfaos) {
    const horas = Math.round((agora - (Date.parse(c.paradoEm ?? "") > 0 ? Date.parse(c.paradoEm) : Date.parse(c.criadoEm))) / 3_600_000);
    try {
      await apagar(c.nome);
      removidos.push(c.nome);
      log(`órfão: container ${c.nome} sem job e sem linha em vps_devices, parado há ${horas} h: docker rm (volume e retrato mantidos)`);
    } catch (e) {
      log(`órfão: não removi ${c.nome}: ${trecho(e.message)}`);
    }
  }
  return removidos;
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
