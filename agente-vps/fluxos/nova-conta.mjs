import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { limparAlerta, marcarAlerta } from "../lib/alertas.mjs";
import { conferirAbiNoAparelho } from "../lib/android.mjs";
import { aplicarNoAparelho, conferir, gerar as gerarDevice } from "../lib/fingerprint.mjs";
import { fotoUnicaNaGaleria } from "../lib/galeria.mjs";
import { pastaDeMidias, sortearFoto } from "../lib/midias.mjs";
import { garantirTeclado } from "../lib/teclado.mjs";
import { esperar, rodar } from "../lib/processo.mjs";
import { ProxyMorta, provarBloqueio, subirSidecar, validar, validarNoNetns } from "../lib/rede.mjs";
import { INSTAGRAM, instalarInstagram } from "./apk.mjs";
import { AQUECIMENTO, ATIVIDADE, ligarProxy } from "./atividade.mjs";
import { ContaTravada, cadastrarInstagram, deveDescartar } from "./cadastro.mjs";
import { conferirCaixa, criarCaixa, provedorDe } from "./caixa.mjs";
import { criarAjuda } from "./dono.mjs";
import { ESTRUTURACAO } from "./estruturacao.mjs";
import { abrirInstagram, editarPerfil, pararInstagram, proxyLigada, trocarFoto } from "./instagram.mjs";

/**
 * Criar conta na VPS (aba Contas VPS). Cada etapa recebe
 * ctx = { mumu, job, input, estado, log, dispositivo(), perguntar(tipo, texto) }
 * — `mumu` é o driver Android (lib/android.mjs), mesmo slot do MuMu — e
 * devolve uma mensagem curta para a tela. estado.instanceIndex é o container;
 * numa retomada (Continuar) ele já vem preenchido e as etapas concluídas são
 * puladas. As chaves batem com VPS_FLUXO em lib/vps/jobs.ts.
 *
 * input = { proxy, pais, versaoIg, perfil, provedorEmail?, conta, imap, device } (lib/vps/types.ts).
 * provedorEmail: imap (padrão), portal (conta.email = link, imap.senha = código de
 * resgate), mailtm ou manual — ver fluxos/caixa.mjs. Sem input.device (teste
 * local) a identidade é gerada aqui.
 */

export { ALERTA_CAPTCHA, ALERTA_ROBO, ALERTA_TELEFONE, ALERTA_USUARIO, deveDescartar } from "./cadastro.mjs";
export { CODIGO_VENCIDO } from "./caixa.mjs";
// decisão: SCALEMASTER_SESSOES_DIR só existe para os testes não escreverem em /opt.
export const PASTA_SESSOES = process.env.SCALEMASTER_SESSOES_DIR || "/opt/scalemaster/sessoes";

/** Bios curtas (ASCII: o Android digita por input text) quando o lote não traz uma. */

function container(estado) {
  if (estado.instanceIndex === null || estado.instanceIndex === undefined) throw new Error("O container ainda não foi criado.");
  return estado.instanceIndex;
}

const nomeContainer = (estado) => `ig-${container(estado)}`;

/** Nome que a aba mostra: o @ pedido, senão a parte do e-mail antes do @ (no portal o e-mail é um link: vale o nome). */
export function nomeDaInstancia(job, input) {
  const conta = input?.conta ?? {};
  const email = String(conta.email ?? "");
  const base = conta.usuario || (/^https?:\/\//i.test(email) ? String(conta.nome ?? "").toLowerCase().replace(/\s+/g, ".") : email.split("@")[0]);
  const nome = String(base).replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);
  return nome || `conta-${job.id.slice(0, 8)}`;
}

/** Identidade da conta: a do servidor (input.device) ou uma gerada para teste local. */
function deviceDe(input, estado) {
  if (input?.device?.fingerprint) return input.device;
  if (!estado.deviceLocal) estado.deviceLocal = gerarDevice({ perfil: input?.perfil, pais: input?.pais, index: estado.instanceIndex ?? 1 });
  return estado.deviceLocal;
}

/** Pasta das sessões exportadas (0700); devolve o caminho do .tgz da conta. */
export function arquivoSessao(jobId, pasta = PASTA_SESSOES) {
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  chmodSync(pasta, 0o700);
  return path.join(pasta, `${jobId}.tgz`);
}

/** O que entra no tar: só o que guarda a sessão; cache (centenas de MB) fica de fora. */
export const SESSAO_PASTAS = ["shared_prefs", "databases", "files"];
export const SESSAO_EXCLUIR = ["cache", "files/cache", "code_cache", "no_backup"];

/** O serial voltou (adb wait-for-device, 20 s)? O adb root derruba a conexão TCP: reconecta antes de esperar. */
async function esperarSerial(d) {
  await rodar(d.adb, ["connect", d.serial], { timeoutMs: 10_000 });
  const r = await rodar(d.adb, ["-s", d.serial, "wait-for-device"], { timeoutMs: 20_000 });
  return !r.estourou && r.codigo === 0;
}

/**
 * adb root + wait-for-device (20 s). O APK release do Instagram não é
 * debuggable (run-as recusa) e o adb backup não exporta app não-debuggable
 * desde o Android 12; o redroid aceita adb root ("adbd is already running as
 * root" também é sucesso). Devolve o prefixo do shell: [] com root, ["su", "0"]
 * quando o adb root falhou ou o serial não voltou em 20 s.
 */
export async function shellComoRoot(d) {
  const root = await rodar(d.adb, ["-s", d.serial, "root"], { timeoutMs: 30_000 });
  const saida = String(root.stdout ?? "") + String(root.stderr ?? "");
  const okRoot = /already running as root/i.test(saida) || (root.codigo === 0 && !/cannot|failed/i.test(saida));
  if (okRoot && (await esperarSerial(d))) return [];
  await esperarSerial(d);
  return ["su", "0"];
}

/**
 * Sessão da conta: tar de /data/data/com.instagram.android (como root,
 * SELinux permissivo) puxado para a VPS. tar com erro ou arquivo de 0 byte é
 * falha da etapa; só a cópia (adb pull) que falha vira "sessão não exportada".
 * `d` = Dispositivo (adb, serial, shell, puxar). `pasta` = onde gravar (os
 * testes passam um diretório temporário).
 * @param {{ adb: string, serial: string, shell: Function, puxar: Function, conectar: Function }} d
 * @param {string} jobId
 * @param {(m: string) => void} [log]
 * @param {string} [pasta]
 */
export async function exportarSessao(d, jobId, log = () => {}, pasta = PASTA_SESSOES) {
  const remoto = "/data/local/tmp/sessao.tgz";
  const local = arquivoSessao(jobId, pasta);
  try {
    const su = await shellComoRoot(d);
    await d.shell(...su, "setenforce", "0").catch(() => {});
    try {
      // Só shared_prefs, databases e files (sem cache): o diretório inteiro passa de 300 MB.
      await d.shell(...su, "tar", "-czf", remoto, "-C", `/data/data/${INSTAGRAM}`, ...SESSAO_EXCLUIR.map((e) => `--exclude=${e}`), ...SESSAO_PASTAS);
    } catch (e) {
      throw new Error(`tar da sessão falhou: ${e.message}`);
    }
    const tamanho = Number((await d.shell(...su, "stat", "-c", "%s", remoto)).trim());
    if (!Number.isFinite(tamanho) || tamanho <= 0) throw new Error(`tar da sessão saiu com ${Number.isFinite(tamanho) ? tamanho : "?"} byte(s)`);
    log(`sessão: ${Math.round(tamanho / 1024)} KB (${SESSAO_PASTAS.join(", ")}, sem cache)`);
    try {
      await d.puxar(remoto, local);
      chmodSync(local, 0o600);
    } catch (e) {
      log(`sessão não exportada: ${e.message}`);
      return "sessão não exportada";
    }
    return `${path.basename(local)} exportado (${Math.round(tamanho / 1024)} KB)`;
  } finally {
    await d.shell("rm", "-f", remoto).catch(() => {});
  }
}

export const NOVA_CONTA = [
  {
    chave: "copiar",
    rotulo: "Criar o container a partir da imagem base",
    async rodar({ mumu, job, input, estado }) {
      const device = deviceDe(input, estado);
      const { index, criada } = await mumu.clonar(job.templateIndex ?? 0, {
        index: device.index,
        jobId: job.id,
        device,
        nome: nomeDaInstancia(job, input),
      });
      estado.instanceIndex = index;
      // docker_created=<Created> na mensagem: o servidor grava em vps_devices no mesmo sync (lib/emulador/sync-jobs.ts).
      return `container ig-${index} (volume ${device.volume ?? `scalemaster-ig-${index}`})${criada ? ` docker_created=${criada}` : ""}`;
    },
  },
  {
    chave: "ids",
    rotulo: "Android ID, serial e MAC",
    async rodar({ mumu, input, estado }) {
      const index = container(estado);
      const device = deviceDe(input, estado);
      await mumu.simular(index, "android_id", device.androidId);
      await mumu.simular(index, "serial", device.serial);
      await mumu.simular(index, "mac_address", device.mac);
      await mumu.simular(index, "imei", device.imei);
      return `serial ${device.serial}, MAC ${device.mac}`;
    },
  },
  {
    chave: "fingerprint",
    rotulo: "Aplicar o perfil do aparelho",
    async rodar({ mumu, input, estado }) {
      const index = container(estado);
      const device = deviceDe(input, estado);
      for (const chave of ["model", "manufacturer", "brand", "device", "product", "buildId", "fingerprint"]) await mumu.simular(index, chave, device[chave]);
      await mumu.simular(index, "timezone", device.timezone);
      await mumu.simular(index, "locale", device.locale);
      // As props entram no boot (build.prop + cmdline); a conferência por getprop é na etapa "abrir".
      return `${device.manufacturer} ${device.model} · ${device.timezone} · ${device.locale}`;
    },
  },
  {
    chave: "geo",
    rotulo: "Validar a proxy e o país",
    async rodar({ mumu, input, estado, log }) {
      if (!input?.proxy) throw new Error("Essa conta veio sem proxy.");
      const geo = await validar(input.proxy, input.pais);
      await mumu.definirProxy(container(estado), input.proxy);
      log(`proxy ok: ${geo.ip} (${geo.pais})`);
      return `${geo.ip} (${geo.pais})`;
    },
  },
  {
    chave: "nome",
    rotulo: "Dar o nome da conta ao container",
    async rodar({ mumu, job, input, estado }) {
      const nome = nomeDaInstancia(job, input);
      await mumu.renomear(container(estado), nome);
      return nome;
    },
  },
  {
    chave: "abrir",
    rotulo: "Ligar o container",
    async rodar({ mumu, input, estado, dispositivo, log }) {
      // Sem proxy gravada o sidecar sobe bloqueado; se já tem (Continuar), sobe com ela.
      await mumu.prepararInstancia(container(estado), { log });
      const d = await dispositivo();
      const device = deviceDe(input, estado);
      await aplicarNoAparelho(d, device);
      // Reforço do androidboot.selinux=permissive do container (o tar da sessão precisa).
      await d.shell("setenforce", "0").catch(() => {});
      const erradas = await conferir(d, device);
      if (erradas.length > 0) {
        throw new Error(`fingerprint divergente: ${erradas.map(([n, e, l]) => `${n} esperado ${e}, lido ${l || "(vazio)"}`).join("; ")}`);
      }
      // ABI da VPS na abilist (e no Instagram, se já instalado) antes de qualquer APK: falha = ABI_AUSENTE.
      const abi = await conferirAbiNoAparelho(d);
      const nome = nomeContainer(estado);
      const bloqueado = mumu.proxyDe(container(estado)) ? "proxy já gravada" : (await provarBloqueio(nome)) ? "kill switch verificado" : null;
      if (bloqueado === null) throw new Error("O container saiu para a internet sem proxy: kill switch não está valendo.");
      // O abrir() pode ter recriado o container: o Created novo vai para vps_devices.docker_created (sync lê qualquer etapa).
      const { criada } = await mumu.instancia(container(estado));
      return `Android pronto (${abi}), props conferidas, ${bloqueado}${criada ? ` docker_created=${criada}` : ""}`;
    },
  },
  {
    chave: "instagram",
    rotulo: "Instalar o Instagram (APK pinado)",
    async rodar({ dispositivo, input, log }) {
      if (!input?.versaoIg) throw new Error("Essa conta veio sem a versão do Instagram.");
      const d = await dispositivo();
      const instalado = await instalarInstagram(d, input.versaoIg, log);
      // Teclado ADB junto com o Instagram: acento e emoji por broadcast (lib/teclado.mjs); sem ele, input text.
      const teclado = await garantirTeclado(d, log).catch((e) => {
        log(`teclado ADB: ${e.message}`);
        return false;
      });
      return `${instalado}${teclado ? " · teclado ADB" : ""}`;
    },
  },
  {
    chave: "rede",
    rotulo: "Subir a proxy no container (redsocks)",
    sempre: true,
    async rodar({ mumu, input, estado, log }) {
      if (!input?.proxy) throw new Error("Essa conta veio sem proxy.");
      const nome = nomeContainer(estado);
      // Continuar chega com o container desligado (abrir não é "sempre"): liga antes de trocar o sidecar.
      await mumu.prepararInstancia(container(estado), { log });
      await mumu.definirProxy(container(estado), input.proxy);
      await subirSidecar(nome, input.proxy);
      const geo = await validarNoNetns(nome, input.pais);
      log(`proxy no container: ${geo.ip} (${geo.pais})`);
      return `redsocks de pé · saída ${geo.ip} (${geo.pais})`;
    },
  },
  {
    // Instagram zerado antes do cadastro. Só roda de novo quando o dono edita os
    // dados (o servidor tira esta etapa e o cadastro das concluídas).
    chave: "limpar",
    rotulo: "Preparar o Instagram para o cadastro",
    async rodar({ dispositivo }) {
      const d = await dispositivo();
      await d.fecharApp(INSTAGRAM);
      await d.shell("pm", "clear", INSTAGRAM);
      return "dados do Instagram zerados";
    },
  },
  {
    chave: "email",
    rotulo: "Conferir a caixa de e-mail",
    async rodar({ input, estado }) {
      // IMAP/mail.tm: login. Portal: só confere o link (a sessão de 20 min abre no cadastro, na hora de digitar). Manual: nada.
      const mensagem = await conferirCaixa(input);
      // Só e-mails depois daqui valem como código (o cadastro dispara o envio).
      estado.desde = Date.now();
      return mensagem;
    },
  },
  {
    chave: "cadastro",
    rotulo: "Criar a conta no Instagram",
    async rodar({ mumu, estado, dispositivo, input, perguntar, log }) {
      const conta = input?.conta;
      if (!conta?.email || !conta?.senha) throw new Error("Essa conta veio sem e-mail ou senha.");
      const { criada } = await mumu.instancia(container(estado));
      limparAlerta(criada);
      const d = await dispositivo();
      // Continuar com o container religado: o sidecar sobe com a proxy gravada, mas confere antes de abrir o Instagram.
      if (!(await proxyLigada(d))) log(`proxy: ${await ligarProxy(mumu, container(estado), log)}`);
      // O resgate do código do portal acontece só na tela do e-mail; a hora vai no andamento para o input_enc.
      const caixa = criarCaixa(input, {
        log,
        aoResgatar: (portal) => {
          estado.portal = portal;
        },
      });
      log(`caixa de e-mail: ${provedorDe(input)}`);
      try {
        return await cadastrarInstagram({
          d,
          conta,
          perguntar,
          log,
          caixa,
          desde: estado.desde ?? Date.now() - 60_000,
          // @ aceito depois de recusa: vai no andamento para o servidor gravar em input_enc, label e vps_devices.
          aoAceitarUsuario: (usuario) => {
            estado.usuario = usuario;
          },
        });
      } catch (e) {
        if (!(e instanceof ContaTravada)) throw e;
        if (deveDescartar(e.alerta)) {
          // decisão (08/11): captcha ou @ recusado 5 vezes = conta descartada: container, sidecar e volume
          // apagados aqui mesmo (libera RAM, disco e a proxy); o servidor marca vps_devices como descartada.
          log(`${e.message} Descartando a conta: apagando container e volume.`);
          await pararInstagram(await dispositivo()).catch(() => {});
          try {
            await mumu.excluir(container(estado), { log, forcar: true });
            estado.descartada = true;
          } catch (erro) {
            log(`não apagou ${nomeContainer(estado)}: ${erro.message}. Desligando.`);
            await mumu.fechar(container(estado)).catch(() => {});
          }
        } else {
          log(`${e.message} Desligando o container.`);
          marcarAlerta(criada, e.alerta);
          await pararInstagram(await dispositivo()).catch(() => {});
          await mumu.fechar(container(estado)).catch(() => {});
        }
        const aviso = new Error(e.alerta);
        aviso.semPrefixo = true;
        throw aviso;
      }
    },
  },
  {
    chave: "perfil",
    rotulo: "Foto e nome de exibição",
    async rodar(ctx) {
      const { mumu, estado, dispositivo, input, perguntar, log } = ctx;
      const d = await dispositivo();
      if (!(await proxyLigada(d))) await ligarProxy(mumu, container(estado), log);
      const c = { d, log, ajuda: criarAjuda({ d, perguntar, log }) };
      await abrirInstagram(c);
      const feitos = [];
      const raiz = await pastaDeMidias();
      const foto = raiz ? sortearFoto(raiz) : null;
      if (foto) {
        await fotoUnicaNaGaleria(d, foto, { pasta: "/sdcard/DCIM/ScaleMaster", log });
        feitos.push(await trocarFoto(c));
      } else log("sem foto em /opt/scalemaster/midias/perfil (Enviar lote → Fotos de perfil): pulando a foto");
      // Sem bio na criação (12/11): a bio é do Estruturar.
      feitos.push(await editarPerfil(c, { nome: input?.conta?.nome ?? "", bio: "" }));
      return feitos.join(" · ");
    },
  },
  ...AQUECIMENTO,
  {
    chave: "sessao",
    rotulo: "Exportar a sessão",
    async rodar({ job, dispositivo, log }) {
      return exportarSessao(await dispositivo(), job.id, log);
    },
  },
  {
    chave: "fechar",
    rotulo: "Desligar o container",
    sempre: true,
    async rodar({ mumu, estado, dispositivo, log }) {
      await pararInstagram(await dispositivo());
      // decisão (13/11): o docker stop (~40 s) roda fora da vaga; a próxima conta da fila já começa.
      if (mumu.fecharDepois) {
        mumu.fecharDepois(container(estado), { log });
        return "Instagram parado; container desligando fora da vaga";
      }
      await mumu.fechar(container(estado));
      return "Instagram parado e container desligado";
    },
  },
];

/** Fluxos da fila por kind: lista de etapas, ou função do input que monta a lista. */
export const FLUXOS = { "nova-conta": NOVA_CONTA, atividade: ATIVIDADE, estruturacao: ESTRUTURACAO };

export { ProxyMorta };
