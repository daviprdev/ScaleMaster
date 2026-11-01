import { existsSync } from "node:fs";
import path from "node:path";
import { esperar, rodar, trecho } from "./processo.mjs";

/**
 * MuMu Player pelo MuMuManager.exe (linha de comando oficial, vem com o MuMu):
 *   info -v all             → instâncias (índice, nome, ligada, porta do adb)
 *   main launch             → abre só a janela principal do MuMu
 *   control -v N launch     → liga a instância N (abre o MuMu se preciso)
 *   control -v N shutdown   → desliga
 * O adb.exe usado nas automações é o que vem na mesma pasta.
 */

const PASTAS_PADRAO = [
  "C:\\Program Files\\Netease\\MuMuPlayer",
  "C:\\Program Files\\Netease\\MuMuPlayer-12.0",
  "C:\\Program Files\\Netease\\MuMu Player 12",
];
const SUBPASTAS = ["nx_main", "shell"];

function managerEm(pasta) {
  for (const sub of SUBPASTAS) {
    const arquivo = path.join(pasta, sub, "MuMuManager.exe");
    if (existsSync(arquivo)) return arquivo;
  }
  return null;
}

/** Pastas de instalação do MuMu registradas no Windows (desinstaladores). */
async function pastasDoRegistro() {
  const chaves = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  ];
  const pastas = [];
  for (const chave of chaves) {
    const { stdout } = await rodar("reg", ["query", chave, "/s", "/v", "InstallLocation"], { timeoutMs: 15_000 });
    for (const linha of String(stdout).split(/\r?\n/)) {
      const m = /InstallLocation\s+REG_\w+\s+(.+)$/.exec(linha.trim());
      if (m && /mumu/i.test(m[1])) pastas.push(m[1].trim().replace(/^"|"$/g, ""));
    }
  }
  return pastas;
}

function estadoDe(info) {
  if (info.is_android_started === true) return "on";
  if (info.is_process_started === true) return "starting";
  return "off";
}

function normalizar(info) {
  const host = info.adb_host_ip || info.adb_host;
  const porta = info.adb_port;
  return {
    index: Number(info.index),
    name: String(info.name ?? `Instância ${info.index}`),
    state: estadoDe(info),
    adb: host && porta ? `${host}:${porta}` : null,
  };
}

export class MuMu {
  constructor(manager) {
    this.manager = manager;
    const adb = path.join(path.dirname(manager), "adb.exe");
    this.adb = existsSync(adb) ? adb : null;
  }

  /** Acha o MuMuManager.exe: caminho do config, pastas padrão e registro do Windows. */
  static async localizar(caminhoConfig) {
    if (caminhoConfig) {
      if (existsSync(caminhoConfig)) return new MuMu(caminhoConfig);
      throw new Error(`MuMuManager não encontrado em ${caminhoConfig} (campo mumuManager do config.json).`);
    }
    for (const pasta of [...PASTAS_PADRAO, ...(await pastasDoRegistro())]) {
      const manager = managerEm(pasta);
      if (manager) return new MuMu(manager);
    }
    throw new Error("MuMu não encontrado neste PC. Instale o MuMu Player ou informe mumuManager no config.json.");
  }

  async json(args, timeoutMs = 60_000) {
    const r = await rodar(this.manager, args, { timeoutMs });
    if (r.estourou) throw new Error(`MuMuManager ${args.join(" ")} demorou demais.`);
    let dados = null;
    try {
      dados = JSON.parse(r.stdout);
    } catch {
      /* saída não é JSON: vira erro abaixo se o código também falhou */
    }
    const erroMuMu = dados && typeof dados === "object" ? Number(dados.errcode ?? dados.error_code ?? 0) : 0;
    if (r.codigo !== 0 || erroMuMu !== 0 || dados === null) {
      const detalhe = trecho(dados?.errmsg ?? dados?.error ?? r.stdout ?? r.stderr) || `código ${r.codigo}`;
      throw new Error(`MuMuManager ${args.join(" ")} falhou: ${detalhe}`);
    }
    return dados;
  }

  async versao() {
    const dados = await this.json(["version"], 15_000);
    return typeof dados.version === "string" ? dados.version : null;
  }

  /** Todas as instâncias, em ordem de índice. */
  async instancias() {
    const dados = await this.json(["info", "-v", "all"], 30_000);
    // Com uma instância só o MuMu devolve o objeto dela direto; com várias, um mapa índice → objeto.
    const lista = dados.index !== undefined ? [dados] : Object.values(dados);
    return lista
      .filter((i) => i && typeof i === "object" && i.index !== undefined)
      .map(normalizar)
      .filter((i) => Number.isInteger(i.index))
      .sort((a, b) => a.index - b.index);
  }

  async instancia(index) {
    return normalizar(await this.json(["info", "-v", String(index)], 30_000));
  }

  /** Só a janela principal do MuMu (lista de instâncias), sem ligar nenhuma. */
  async abrirMuMu() {
    await this.json(["main", "launch"], 60_000);
  }

  async abrir(index) {
    await this.json(["control", "-v", String(index), "launch"], 120_000);
  }

  async fechar(index) {
    await this.json(["control", "-v", String(index), "shutdown"], 120_000);
  }

  /** Copia a instância e devolve o índice da cópia (o MuMu responde { "<novo>": { errcode } }). */
  async clonar(index) {
    const dados = await this.json(["clone", "-v", String(index)], 300_000);
    const entrada = Object.entries(dados).find(([chave]) => /^\d+$/.test(chave));
    if (!entrada) throw new Error(`O MuMu não disse qual instância criou: ${trecho(JSON.stringify(dados))}`);
    const [novo, info] = entrada;
    if (Number(info?.errcode ?? 0) !== 0) {
      throw new Error(`O MuMu não copiou a instância: ${trecho(info?.errmsg) || `erro ${info?.errcode}`}`);
    }
    return Number(novo);
  }

  /** Mesmo campo de Configurações do dispositivo → Modelo → IMEI. Vale a partir do próximo boot. */
  async definirImei(index, imei) {
    const dados = await this.json(["simulation", "-v", String(index), "-sk", "imei", "-sv", imei], 60_000);
    if (dados.imei !== imei) throw new Error(`O MuMu não confirmou o IMEI novo: ${trecho(JSON.stringify(dados))}`);
  }

  async renomear(index, nome) {
    await this.json(["rename", "-v", String(index), "-n", nome], 60_000);
  }

  /** Liga a instância (se preciso) e espera o Android ficar pronto com adb. */
  async prepararInstancia(index, { timeoutMs = 180_000, log = () => {} } = {}) {
    let atual = await this.instancia(index);
    if (atual.state === "off") {
      log(`abrindo a instância ${index}`);
      await this.abrir(index);
    }
    const limite = Date.now() + timeoutMs;
    while (!(atual.state === "on" && atual.adb)) {
      if (Date.now() > limite) throw new Error(`A instância ${index} não terminou de ligar em ${Math.round(timeoutMs / 1000)} s.`);
      await esperar(2000);
      atual = await this.instancia(index);
    }
    return atual;
  }
}
