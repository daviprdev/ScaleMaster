import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Dispositivo, PORTA_BASE, serialDe } from "./adb.mjs";
import { apagarVolume, conferirQuota, copiarVolume, prune } from "./disco.mjs";
import { aplicarProps, propsDe } from "./fingerprint.mjs";
import { esperar, rodar, trecho } from "./processo.mjs";
import { IMAGEM_SIDECAR, REDE, garantirBridge, ipDe, nomeSidecar, pararSidecar, subirSidecar } from "./rede.mjs";

/**
 * Driver dos containers redroid. Mesma superfície da classe MuMu de
 * agente-mumu/lib/mumu.mjs (os fluxos recebem este objeto em ctx.mumu e só
 * chamam clonar, simular, renomear, prepararInstancia, instancia, instancias,
 * fechar, abrir, excluir), sem GUI: tudo é docker + adb + props.
 *
 * Cada conta = um container `ig-<índice>` (porta adb 6000+índice em
 * 127.0.0.1, IP e MAC fixos na bridge vpsnet, volume /data de 4 GB) + o
 * sidecar redsocks (lib/rede.mjs). A identidade (model, fingerprint, serial,
 * MAC…) entra por build.prop montados por cima dos da imagem e por
 * androidboot.serialno; o que não precisa de boot (Android ID, fuso, idioma)
 * entra por adb. O retrato de cada container fica em
 * /opt/scalemaster/vps/instancias/ig-N.json: índice, nome, job, identidade,
 * proxy (chmod 600) e `criada` (identidade estável, como o created_timestamp
 * do MuMu, que não muda quando o container é recriado para aplicar props).
 */

/**
 * Arquitetura da VPS normalizada: "x86_64" ou "arm64" (aceita process.arch e uname -m).
 * @param {string} [arch]
 */
export function archDe(arch = process.arch) {
  const a = String(arch ?? "").toLowerCase();
  if (a === "x64" || a === "x86_64" || a === "amd64") return "x86_64";
  if (a === "arm64" || a === "aarch64") return "arm64";
  throw new Error(`Arquitetura sem imagem do redroid: ${arch}`);
}

/**
 * Imagem do redroid por arquitetura. A tag _64only não tem ABI ARM de 32 bits e
 * é a que roda nativo em ARM; em x86_64 é a 13.0.0-latest (traz x86_64 na
 * abilist; o Instagram tem que ser o build x86_64, o arm64 crasha em libnb.so).
 * @param {string} [arch]
 */
export function imagemPorArch(arch = process.arch) {
  return archDe(arch) === "arm64" ? "redroid/redroid:13.0.0_64only-latest" : "redroid/redroid:13.0.0-latest";
}

/**
 * ABI que o Android do container tem que anunciar (e o Instagram instalado usar).
 * @param {string} [arch]
 */
export function abiEsperada(arch = process.arch) {
  return archDe(arch) === "arm64" ? "arm64-v8a" : "x86_64";
}

/**
 * Confere a ABI do container depois do boot, ANTES de instalar qualquer APK:
 * a abilist precisa trazer a ABI da VPS e, se o Instagram já estiver
 * instalado, o primaryCpuAbi dele tem que ser essa mesma ABI. Falha =
 * ABI_AUSENTE. `primaryCpuAbi` null = Instagram ainda não instalado.
 * @param {{ abilist: string | null | undefined, primaryCpuAbi?: string | null }} lido
 * @param {string} [arch]
 */
export function conferirAbi({ abilist, primaryCpuAbi = null }, arch = process.arch) {
  const abi = abiEsperada(arch);
  const lista = String(abilist ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!lista.includes(abi)) throw new Error(`ABI_AUSENTE: ro.product.cpu.abilist=${lista.join(",") || "(vazio)"} não traz ${abi}`);
  if (primaryCpuAbi !== null && primaryCpuAbi !== undefined && String(primaryCpuAbi).trim() !== abi) {
    throw new Error(`ABI_AUSENTE: o Instagram instalado é ${String(primaryCpuAbi).trim() || "?"}, esta VPS exige ${abi}`);
  }
  return abi;
}

/**
 * Lê abilist e primaryCpuAbi do aparelho e confere (lança ABI_AUSENTE).
 * @param {{ prop: (nome: string) => Promise<string>, abiPrimaria: (pacote: string) => Promise<string | null> }} d
 * @param {string} [arch]
 */
export async function conferirAbiNoAparelho(d, arch = process.arch) {
  const abilist = await d.prop("ro.product.cpu.abilist");
  const primaryCpuAbi = await d.abiPrimaria("com.instagram.android");
  return conferirAbi({ abilist, primaryCpuAbi }, arch);
}

export const ARCH = archDe(process.arch);
export const IMAGEM = imagemPorArch(ARCH);
export const BASE_VOLUME = "scalemaster-base";
// decisão: SCALEMASTER_VPS_DIR só existe para os testes apontarem a pasta dos retratos para um diretório temporário.
export const PASTA_VPS = process.env.SCALEMASTER_VPS_DIR || "/opt/scalemaster/vps";
export const PASTA_INSTANCIAS = path.join(PASTA_VPS, "instancias");
export const PASTA_PROPS = path.join(PASTA_VPS, "props");
export const PASTA_BASE_PROPS = path.join(PASTA_VPS, "base");
const LABEL = "scalemaster.vps=1";
const MEMORIA = "1400m";
/** Props que só entram no boot (build.prop / cmdline): mudar uma delas recria o container. */
const CHAVES_DE_BOOT = new Set(["model", "manufacturer", "brand", "device", "product", "fingerprint", "buildId", "serial", "mac"]);
/** Props aplicadas por adb com o container ligado. */
const CHAVES_VIVAS = new Set(["android_id", "timezone", "locale"]);
/** Partições cujo build.prop é montado por cima (origem = PASTA_BASE_PROPS/<nome>.prop, extraído por scripts/vps/golden.sh). */
const PARTICOES = [
  { nome: "system", destino: "/system/build.prop" },
  { nome: "vendor", destino: "/vendor/build.prop" },
  { nome: "product", destino: "/product/etc/build.prop" },
];

const ARGS_REDROID = [
  "androidboot.redroid_gpu_mode=guest",
  "androidboot.redroid_width=1080",
  "androidboot.redroid_height=1920",
  "androidboot.redroid_dpi=420",
  "androidboot.redroid_fps=30",
  // decisão: kernel sem ashmem (Ubuntu 26.04 / 7.0): o redroid usa memfd, igual ao teste-ig que já roda nesta VPS.
  "androidboot.use_memfd=true",
  // dns1 = IP do próprio container (unbound do sidecar na 53): entra por container em criarContainer.
  "androidboot.redroid_net_ndns=1",
];

function nomeDe(index) {
  return `ig-${index}`;
}

function arquivoSpec(index) {
  return path.join(PASTA_INSTANCIAS, `${nomeDe(index)}.json`);
}

function lerSpec(index) {
  try {
    return JSON.parse(readFileSync(arquivoSpec(index), "utf8"));
  } catch {
    return null;
  }
}

/** Escrita atômica: o retrato nunca fica pela metade se o processo morrer no meio. */
function gravarSpec(spec) {
  mkdirSync(PASTA_INSTANCIAS, { recursive: true, mode: 0o700 });
  const alvo = arquivoSpec(spec.index);
  writeFileSync(`${alvo}.tmp`, `${JSON.stringify(spec, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${alvo}.tmp`, alvo);
}

const FORMATO_INSPECT =
  '{{.State.Status}}|{{.Created}}|{{index .Config.Labels "scalemaster.nome"}}|{{index .Config.Labels "scalemaster.conta"}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}|{{range .NetworkSettings.Networks}}{{.MacAddress}}{{end}}';

/** Um docker inspect só: estado, Created, labels de nome e conta, volume de /data e MAC. null = não existe. */
async function inspecionar(nome) {
  const r = await rodar("docker", ["inspect", "--format", FORMATO_INSPECT, nome], { timeoutMs: 20_000 });
  if (r.codigo !== 0) return null;
  const [status, criada, nomeLabel, jobId, volume, mac] = trecho(r.stdout, 1000).split("|");
  return { status: status || null, criada: criada || null, nomeLabel: nomeLabel || null, jobId: jobId || null, volume: volume || null, mac: mac || null };
}

/** Nome mostrado na aba: retrato → label scalemaster.nome → "Instância N". Nunca vazio. */
export function resolverNome(index, spec, inspecao) {
  return String(spec?.nome || inspecao?.nomeLabel || `Instância ${index}`);
}

async function docker(args, timeoutMs = 60_000) {
  const r = await rodar("docker", args, { timeoutMs });
  if (r.estourou) throw new Error(`docker ${args[0]} demorou demais.`);
  if (r.codigo !== 0) throw new Error(`docker ${args.slice(0, 2).join(" ")} falhou: ${trecho(r.stderr || r.stdout)}`);
  return String(r.stdout);
}

/** Estado do container pelo Docker: "running", "exited", "created" ou null (não existe). */
async function estadoDocker(nome) {
  return (await inspecionar(nome))?.status ?? null;
}

export class Android {
  constructor() {
    this.adb = "adb";
    this.manager = "docker";
    /** Containers cujo Android já terminou de ligar (evita um adb por sync). */
    this.prontos = new Set();
  }

  /** Confere docker, a bridge, a imagem do redroid, a do sidecar e a base (volume + props). */
  static async localizar() {
    const v = await rodar("docker", ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 20_000 });
    if (v.codigo !== 0) throw new Error(`Docker não está rodando nesta VPS: ${trecho(v.stderr)}`);
    const adb = await rodar("adb", ["version"], { timeoutMs: 20_000 });
    if (adb.codigo !== 0) throw new Error("adb não encontrado (apt install android-tools-adb).");
    await garantirBridge();
    const faltam = [];
    if ((await rodar("docker", ["image", "inspect", IMAGEM], { timeoutMs: 20_000 })).codigo !== 0) faltam.push(`imagem ${IMAGEM}`);
    if ((await rodar("docker", ["image", "inspect", IMAGEM_SIDECAR], { timeoutMs: 20_000 })).codigo !== 0) faltam.push(`imagem ${IMAGEM_SIDECAR}`);
    if ((await rodar("docker", ["volume", "inspect", BASE_VOLUME], { timeoutMs: 20_000 })).codigo !== 0) faltam.push(`volume base ${BASE_VOLUME}`);
    for (const p of PARTICOES) if (!existsSync(path.join(PASTA_BASE_PROPS, `${p.nome}.prop`))) faltam.push(`${PASTA_BASE_PROPS}/${p.nome}.prop`);
    const driver = new Android();
    driver.versao_ = trecho(v.stdout);
    driver.faltam = faltam;
    if (faltam.length > 0) throw new Error(`Falta preparar a VPS (rode scripts/vps/instalar.sh e golden.sh): ${faltam.join(", ")}.`);
    await driver.reconstruir();
    return driver;
  }

  /**
   * Boot: todo container de conta no Docker precisa de retrato. Sem ele (ou
   * corrompido: o processo morreu antes da escrita), regrava com o que a label
   * guarda — nome, conta, volume, MAC — para a aba não perder a ligação nem o
   * delete apagar o container errado. Devolve os índices reconstruídos.
   */
  async reconstruir() {
    const r = await rodar("docker", ["ps", "-a", "--filter", `label=${LABEL}`, "--filter", "label=scalemaster.conta", "--format", "{{.Names}}"], { timeoutMs: 20_000 });
    const refeitos = [];
    for (const nome of String(r.stdout ?? "").split(/\r?\n/).map((l) => l.trim())) {
      const m = /^ig-(\d+)$/.exec(nome);
      if (!m || lerSpec(Number(m[1]))) continue;
      const index = Number(m[1]);
      const i = await inspecionar(nome);
      if (!i) continue;
      gravarSpec({
        index,
        nome: resolverNome(index, null, i),
        jobId: i.jobId,
        volume: i.volume ?? `scalemaster-${nome}`,
        device: { mac: i.mac, index, container: nome },
        proxy: null,
        criada: i.criada,
        recriar: false,
        reconstruido: true,
      });
      refeitos.push(index);
    }
    return refeitos;
  }

  async versao() {
    return this.versao_ ?? trecho(await docker(["version", "--format", "{{.Server.Version}}"], 20_000));
  }

  async normalizar(spec) {
    const nome = nomeDe(spec.index);
    const inspecao = await inspecionar(nome);
    const status = inspecao?.status ?? null;
    let state = "off";
    if (status === "running") {
      if (this.prontos.has(spec.index)) state = "on";
      else {
        const pronto = await this.bootCompleto(spec.index).catch(() => false);
        if (pronto) {
          this.prontos.add(spec.index);
          state = "on";
        } else state = "starting";
      }
    } else this.prontos.delete(spec.index);
    return {
      index: spec.index,
      name: resolverNome(spec.index, spec, inspecao),
      state,
      adb: state === "off" ? null : serialDe(spec.index),
      // Created do Docker é o que o delete confere; sem container (ainda não criado), vale o do retrato.
      criada: inspecao?.criada ?? (spec.criada ? String(spec.criada) : null),
      container: nome,
      jobId: spec.jobId ?? null,
    };
  }

  /** Todos os containers do Scale Master, em ordem de índice. */
  async instancias() {
    mkdirSync(PASTA_INSTANCIAS, { recursive: true, mode: 0o700 });
    const specs = readdirSync(PASTA_INSTANCIAS)
      .filter((f) => /^ig-\d+\.json$/.test(f))
      .map((f) => lerSpec(Number(/\d+/.exec(f)[0])))
      .filter((s) => s && Number.isInteger(s.index))
      .sort((a, b) => a.index - b.index);
    const out = [];
    for (const spec of specs) out.push(await this.normalizar(spec));
    return out;
  }

  async instancia(index) {
    const spec = lerSpec(index);
    if (!spec) throw new Error(`O container #${index} não existe.`);
    return this.normalizar(spec);
  }

  async bootCompleto(index) {
    const serial = serialDe(index);
    // O adb não conecta sozinho numa porta fora de 5555–5585 (e fechar() desconecta): conecta a cada checagem.
    await rodar("adb", ["connect", serial], { timeoutMs: 10_000 });
    const r = await rodar("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"], { timeoutMs: 8000 });
    return trecho(r.stdout) === "1";
  }

  /** Volumes das contas que existem no retrato (para o prune não tocar neles). */
  volumesVivos() {
    mkdirSync(PASTA_INSTANCIAS, { recursive: true, mode: 0o700 });
    return readdirSync(PASTA_INSTANCIAS)
      .filter((f) => /^ig-\d+\.json$/.test(f))
      .map((f) => lerSpec(Number(/\d+/.exec(f)[0])))
      .map((s) => s?.volume)
      .filter(Boolean);
  }

  /** Maior índice livre acima dos existentes (reaproveita o menor buraco, igual ao MuMu, quando pedido). */
  async indiceLivre() {
    const usados = new Set((await this.instancias()).map((i) => i.index));
    let n = 1;
    while (usados.has(n)) n += 1;
    return n;
  }

  /** Arquivos de build.prop da conta: os da base com a identidade por cima. */
  gerarProps(spec) {
    const pasta = path.join(PASTA_PROPS, nomeDe(spec.index));
    mkdirSync(pasta, { recursive: true });
    const props = propsDe(spec.device);
    for (const p of PARTICOES) {
      const base = readFileSync(path.join(PASTA_BASE_PROPS, `${p.nome}.prop`), "utf8");
      writeFileSync(path.join(pasta, `${p.nome}.prop`), aplicarProps(base, props), { mode: 0o644 });
    }
    return pasta;
  }

  /** docker create com tudo o que a identidade pede. O container nasce parado. */
  async criarContainer(spec) {
    const nome = nomeDe(spec.index);
    if (!spec.device?.fingerprint || !spec.device?.mac || !spec.device?.serial) {
      throw new Error(`O retrato de ${nome} foi reconstruído sem a identidade do aparelho: não dá para recriar o container.`);
    }
    const props = this.gerarProps(spec);
    const args = [
      "create", "--name", nome, "--privileged",
      "--label", LABEL, "--label", `scalemaster.conta=${spec.jobId ?? ""}`, "--label", `scalemaster.nome=${spec.nome ?? nome}`,
      "--network", REDE, "--ip", ipDe(spec.index), "--mac-address", spec.device.mac,
      "-p", `127.0.0.1:${PORTA_BASE + spec.index}:5555`,
      "-v", `${spec.volume}:/data`,
      "--memory", MEMORIA, "--memory-swap", MEMORIA, "--restart", "no",
      // SELinux permissivo: o tar da sessão em /data/data é bloqueado mesmo como root com enforcing.
      "-e", "androidboot.selinux=permissive",
    ];
    for (const p of PARTICOES) args.push("-v", `${path.join(props, `${p.nome}.prop`)}:${p.destino}:ro`);
    // decisão: além do -e, o mesmo androidboot.selinux vai na cmdline, que é de onde o redroid lê os androidboot.*.
    args.push(IMAGEM, ...ARGS_REDROID, `androidboot.redroid_net_dns1=${ipDe(spec.index)}`, "androidboot.selinux=permissive", `androidboot.serialno=${spec.device.serial}`);
    await docker(args, 120_000);
    spec.recriar = false;
    // O retrato guarda o Created vivo: o abrir() recria o container e o excluir confere por ele (ig-4, 08/11: ficou defasado).
    const viva = (await inspecionar(nomeDe(spec.index)))?.criada;
    if (viva) spec.criada = viva;
    gravarSpec(spec);
  }

  /**
   * Cria um container novo a partir da base (templateIndex 0 = volume
   * scalemaster-base; outro índice = o volume daquele container). Opções:
   * index desejado (o servidor reserva), jobId, device (identidade do servidor)
   * e nome. Devolve { index, criada } (Created do container, string crua do
   * inspect, que o servidor guarda em vps_devices.docker_created).
   */
  async clonar(templateIndex, { index, jobId = null, device, nome } = {}) {
    const alvo = Number.isInteger(index) && index > 0 ? index : await this.indiceLivre();
    const existente = lerSpec(alvo);
    // Continuar depois de uma queda no meio do copiar: o retrato é desta mesma conta, reaproveita.
    if (existente && jobId && existente.jobId === jobId) {
      if (!(await estadoDocker(nomeDe(alvo)))) await this.criarContainer(existente);
      return { index: alvo, criada: (await inspecionar(nomeDe(alvo)))?.criada ?? existente.criada ?? null };
    }
    if (existente || (await estadoDocker(nomeDe(alvo)))) throw new Error(`O índice ${alvo} já está ocupado na VPS (container ${nomeDe(alvo)}).`);
    const origem = templateIndex === 0 || templateIndex === undefined ? BASE_VOLUME : lerSpec(templateIndex)?.volume;
    if (!origem) throw new Error(`O container #${templateIndex} não existe para copiar.`);
    const { gerar } = await import("./fingerprint.mjs");
    const identidade = device ?? gerar({ index: alvo });
    const spec = {
      index: alvo,
      nome: nome ?? nomeDe(alvo),
      jobId,
      volume: identidade.volume ?? `scalemaster-${nomeDe(alvo)}`,
      device: { ...identidade, index: alvo, container: nomeDe(alvo) },
      proxy: null,
      criada: new Date().toISOString(),
      recriar: false,
    };
    await copiarVolume(origem, spec.volume);
    gravarSpec(spec);
    try {
      await this.criarContainer(spec);
    } catch (e) {
      // docker create recusou: nada fica para trás (o Continuar refaz o copiar do zero).
      rmSync(arquivoSpec(alvo), { force: true });
      rmSync(path.join(PASTA_PROPS, nomeDe(alvo)), { recursive: true, force: true });
      await apagarVolume(spec.volume).catch(() => {});
      throw e;
    }
    return { index: alvo, criada: (await inspecionar(nomeDe(alvo)))?.criada ?? spec.criada ?? null };
  }

  /**
   * Mesma ideia do `simulation` do MuMu: chave = android_id, mac_address,
   * imei, model, manufacturer, fingerprint, serial, timezone, locale… Props de
   * boot ficam gravadas e valem na próxima ligada (o container é recriado);
   * as vivas entram por adb na hora, se o container estiver ligado. Confere
   * por getprop quando dá.
   */
  async simular(index, chave, valor) {
    const spec = lerSpec(index);
    if (!spec) throw new Error(`O container #${index} não existe.`);
    const nomeChave = chave === "mac_address" ? "mac" : chave;
    if (nomeChave === "imei") {
      spec.device.imei = String(valor);
      gravarSpec(spec);
      return;
    }
    if (CHAVES_DE_BOOT.has(nomeChave)) {
      spec.device[nomeChave] = String(valor);
      spec.recriar = true;
      gravarSpec(spec);
      return;
    }
    if (!CHAVES_VIVAS.has(nomeChave)) throw new Error(`Chave desconhecida para simular: ${chave}`);
    const campo = nomeChave === "android_id" ? "androidId" : nomeChave;
    spec.device[campo] = String(valor);
    gravarSpec(spec);
    if ((await estadoDocker(nomeDe(index))) !== "running") return;
    const d = new Dispositivo(this.adb, serialDe(index));
    await d.conectar();
    await d.root();
    if (nomeChave === "android_id") {
      await d.shell("settings", "put", "secure", "android_id", String(valor));
      const lido = (await d.shell("settings", "get", "secure", "android_id")).trim();
      if (lido !== String(valor)) throw new Error(`O Android não confirmou android_id: ${lido}`);
      return;
    }
    const prop = nomeChave === "timezone" ? "persist.sys.timezone" : "persist.sys.locale";
    await d.setprop(prop, String(valor));
    const lido = await d.prop(prop);
    if (lido !== String(valor)) throw new Error(`O Android não confirmou ${prop}: ${lido}`);
  }

  /** Nome que a aba mostra. O nome do container no Docker continua ig-N (porta, sidecar e IP dependem dele). */
  async renomear(index, nome) {
    const spec = lerSpec(index);
    if (!spec) throw new Error(`O container #${index} não existe.`);
    spec.nome = String(nome);
    gravarSpec(spec);
    // decisão: o label scalemaster.nome é atualizado na próxima recriação; docker rename quebraria a convenção ig-N.
  }

  /** Guarda a proxy da conta no retrato (o sidecar sobe em modo proxy nas próximas ligadas). */
  async definirProxy(index, proxy) {
    const spec = lerSpec(index);
    if (!spec) throw new Error(`O container #${index} não existe.`);
    spec.proxy = proxy ?? null;
    gravarSpec(spec);
  }

  proxyDe(index) {
    return lerSpec(index)?.proxy ?? null;
  }

  jobDe(index) {
    return lerSpec(index)?.jobId ?? null;
  }

  deviceDe(index) {
    return lerSpec(index)?.device ?? null;
  }

  /** Liga: recria o container se alguma prop de boot mudou, docker start, sidecar (bloqueado ou proxy) e adb. */
  async abrir(index) {
    const spec = lerSpec(index);
    if (!spec) throw new Error(`O container #${index} não existe.`);
    const nome = nomeDe(index);
    const status = await estadoDocker(nome);
    if (status === "running") {
      // Ligado tem que estar com o sidecar: sem ele o container sairia pelo IP da VPS.
      const vivo = await rodar("docker", ["inspect", "--format", "{{.State.Running}}", nomeSidecar(nome)], { timeoutMs: 20_000 });
      if (trecho(vivo.stdout) === "true") return;
      try {
        await subirSidecar(nome, spec.proxy);
      } catch (e) {
        await this.fechar(index).catch(() => {});
        throw e;
      }
      return;
    }
    await conferirQuota(spec.volume);
    if (spec.recriar || status === null) {
      if (status !== null) await docker(["rm", "-f", nome], 120_000);
      await pararSidecar(nome);
      await this.criarContainer(spec);
    }
    await docker(["start", nome], 120_000);
    this.prontos.delete(index);
    // O sidecar entra junto: sem proxy gravada, bloqueado (nada sai); com proxy, redsocks.
    // Se ele não subir, o container não fica ligado sem kill switch.
    try {
      await subirSidecar(nome, spec.proxy);
    } catch (e) {
      await docker(["stop", "-t", "5", nome], 60_000).catch(() => {});
      await pararSidecar(nome);
      throw e;
    }
  }

  /** Desliga: docker stop (o fluxo já parou o Instagram), sidecar fora, adb desconectado. */
  async fechar(index) {
    const nome = nomeDe(index);
    const status = await estadoDocker(nome);
    if (status === null) throw new Error(`O container #${index} não existe.`);
    await rodar("adb", ["disconnect", serialDe(index)], { timeoutMs: 10_000 });
    if (status === "running") await docker(["stop", "-t", "30", nome], 120_000);
    await pararSidecar(nome);
    this.prontos.delete(index);
  }

  /**
   * Apaga container, sidecar, volume, props e retrato, e faz o prune. `criada`
   * é o vps_devices.docker_created que a aba mandou e `nome` o que ela mostrou:
   * o Created ao vivo (inspect) tem que bater com o do banco e com o do
   * retrato; sem valor no banco vale só o inspect (logado). Nome "Instância N"
   * é só rótulo de container sem retrato: com o Created batendo, aceita.
   * @param {number} index
   * `forcar` = o próprio job está descartando o seu container (identidade garantida pelo índice): pula as conferências.
   * @param {{ log?: (m: string) => void, nome?: string | null, criada?: string | null, forcar?: boolean }} [opcoes]
   */
  async excluir(index, { log = () => {}, nome: nomeEsperado, criada: criadaEsperada, forcar = false } = {}) {
    const spec = lerSpec(index);
    const nome = nomeDe(index);
    const inspecao = await inspecionar(nome);
    const status = inspecao?.status ?? null;
    const criadaViva = inspecao?.criada ?? null;
    const criadaBanco = typeof criadaEsperada === "string" && criadaEsperada ? criadaEsperada : null;
    if (!forcar) {
      if (criadaBanco && criadaViva && criadaBanco !== criadaViva) {
        throw new Error(`O container ${nome} não é o mesmo: criado em ${criadaViva}, o banco tem ${criadaBanco}. Nada foi apagado.`);
      }
      if (!criadaBanco) log(`docker_created ausente para ${nome}: conferindo só pelo inspect`);
      if (spec?.criada && criadaViva && spec.criada !== criadaViva) {
        throw new Error(`O container ${nome} não é o mesmo: criado em ${criadaViva}, o retrato tem ${spec.criada}. Nada foi apagado.`);
      }
      const nomeAtual = resolverNome(index, spec, inspecao);
      const rotuloGenerico = typeof nomeEsperado === "string" && nomeEsperado === `Instância ${index}`;
      if (nomeEsperado !== undefined && nomeEsperado !== null && nomeAtual !== String(nomeEsperado) && !(rotuloGenerico && criadaViva)) {
        throw new Error(`O container ${nome} agora se chama "${nomeAtual}", a aba esperava "${nomeEsperado}". Nada foi apagado.`);
      }
    }
    if (status === "running") {
      log(`desligando ${nome} antes de apagar`);
      await this.fechar(index).catch(() => {});
    }
    await pararSidecar(nome);
    if (status !== null) await docker(["rm", "-f", nome], 120_000);
    if (spec?.volume) await apagarVolume(spec.volume);
    rmSync(path.join(PASTA_PROPS, nome), { recursive: true, force: true });
    rmSync(arquivoSpec(index), { force: true });
    this.prontos.delete(index);
    await prune([BASE_VOLUME, ...this.volumesVivos()]);
    log(`${nome} apagado (container, volume ${spec?.volume ?? "?"}, props)`);
  }

  /** Liga o container (se preciso) e espera o Android ficar pronto com adb. */
  async prepararInstancia(index, { timeoutMs = 180_000, log = () => {} } = {}) {
    let atual = await this.instancia(index);
    if (atual.state === "off") {
      log(`ligando ${nomeDe(index)}`);
      await this.abrir(index);
    } else {
      // Ligado sem sidecar (ele caiu ou foi removido): abrir() repõe o kill switch/proxy sem reiniciar o Android.
      const vivo = await rodar("docker", ["inspect", "--format", "{{.State.Running}}", nomeSidecar(nomeDe(index))], { timeoutMs: 20_000 });
      if (trecho(vivo.stdout) !== "true") {
        log(`${nomeDe(index)} ligado sem sidecar: repondo`);
        await this.abrir(index);
      }
    }
    const limite = Date.now() + timeoutMs;
    while (!(atual.state === "on" && atual.adb)) {
      if (Date.now() > limite) throw new Error(`O container #${index} não terminou de ligar em ${Math.round(timeoutMs / 1000)} s.`);
      await esperar(3000);
      atual = await this.instancia(index);
    }
    return atual;
  }
}
