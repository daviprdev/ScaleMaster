import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { limparAlerta, marcarAlerta } from "../lib/alertas.mjs";
import { aplicarNoAparelho, conferir, gerar as gerarDevice } from "../lib/fingerprint.mjs";
import { testarLogin } from "../lib/imap.mjs";
import { pastaDeMidias, sortearFoto } from "../lib/midias.mjs";
import { esperar } from "../lib/processo.mjs";
import { ProxyMorta, provarBloqueio, subirSidecar, validar, validarNoNetns } from "../lib/rede.mjs";
import { INSTAGRAM, instalarInstagram } from "./apk.mjs";
import { AQUECIMENTO, ATIVIDADE, ligarProxy } from "./atividade.mjs";
import { ContaTravada, cadastrarInstagram } from "./cadastro.mjs";
import { criarAjuda } from "./dono.mjs";
import { abrirInstagram, editarPerfil, pararInstagram, proxyLigada, trocarFoto } from "./instagram.mjs";

/**
 * Criar conta na VPS (aba Contas VPS). Cada etapa recebe
 * ctx = { mumu, job, input, estado, log, dispositivo(), perguntar(tipo, texto) }
 * — `mumu` é o driver Android (lib/android.mjs), mesmo slot do MuMu — e
 * devolve uma mensagem curta para a tela. estado.instanceIndex é o container;
 * numa retomada (Continuar) ele já vem preenchido e as etapas concluídas são
 * puladas. As chaves batem com VPS_FLUXO em lib/vps/jobs.ts.
 *
 * input = { proxy, pais, versaoIg, perfil, conta, imap, device } (lib/vps/types.ts).
 * Sem input.device (teste local) a identidade é gerada aqui.
 */

export { ALERTA_CAPTCHA, ALERTA_TELEFONE } from "./cadastro.mjs";
export const PASTA_SESSOES = "/opt/scalemaster/sessoes";

/** Bios curtas (ASCII: o Android digita por input text) quando o lote não traz uma. */
const BIOS = ["living the moment", "good vibes only", "coffee, music and sun", "exploring new places", "simple life, big dreams", "always learning"];

function container(estado) {
  if (estado.instanceIndex === null || estado.instanceIndex === undefined) throw new Error("O container ainda não foi criado.");
  return estado.instanceIndex;
}

const nomeContainer = (estado) => `ig-${container(estado)}`;

/** Nome que a aba mostra: o @ pedido, senão a parte do e-mail antes do @. */
export function nomeDaInstancia(job, input) {
  const conta = input?.conta ?? {};
  const base = conta.usuario || String(conta.email ?? "").split("@")[0];
  const nome = String(base).replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);
  return nome || `conta-${job.id.slice(0, 8)}`;
}

/** Identidade da conta: a do servidor (input.device) ou uma gerada para teste local. */
function deviceDe(input, estado) {
  if (input?.device?.fingerprint) return input.device;
  if (!estado.deviceLocal) estado.deviceLocal = gerarDevice({ perfil: input?.perfil, pais: input?.pais, index: estado.instanceIndex ?? 1 });
  return estado.deviceLocal;
}

/** Guarda a sessão exportada do container em /opt/scalemaster/sessoes/<jobId>.json. */
export function gravarSessao(jobId, dados) {
  mkdirSync(PASTA_SESSOES, { recursive: true, mode: 0o700 });
  const arquivo = path.join(PASTA_SESSOES, `${jobId}.json`);
  writeFileSync(arquivo, `${JSON.stringify(dados, null, 2)}\n`, { mode: 0o600 });
  return arquivo;
}

export const NOVA_CONTA = [
  {
    chave: "copiar",
    rotulo: "Criar o container a partir da imagem base",
    async rodar({ mumu, job, input, estado }) {
      const device = deviceDe(input, estado);
      estado.instanceIndex = await mumu.clonar(job.templateIndex ?? 0, {
        index: device.index,
        jobId: job.id,
        device,
        nome: nomeDaInstancia(job, input),
      });
      return `container ig-${estado.instanceIndex} (volume ${device.volume ?? `scalemaster-ig-${estado.instanceIndex}`})`;
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
      const erradas = await conferir(d, device);
      if (erradas.length > 0) {
        throw new Error(`fingerprint divergente: ${erradas.map(([n, e, l]) => `${n} esperado ${e}, lido ${l || "(vazio)"}`).join("; ")}`);
      }
      const nome = nomeContainer(estado);
      const bloqueado = mumu.proxyDe(container(estado)) ? "proxy já gravada" : (await provarBloqueio(nome)) ? "kill switch verificado" : null;
      if (bloqueado === null) throw new Error("O container saiu para a internet sem proxy: kill switch não está valendo.");
      return `Android pronto, props conferidas, ${bloqueado}`;
    },
  },
  {
    chave: "instagram",
    rotulo: "Instalar o Instagram (APK pinado)",
    async rodar({ dispositivo, input, log }) {
      if (!input?.versaoIg) throw new Error("Essa conta veio sem a versão do Instagram.");
      return instalarInstagram(await dispositivo(), input.versaoIg, log);
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
    rotulo: "Conferir a caixa de e-mail (IMAP)",
    async rodar({ input, estado }) {
      const imap = input?.imap;
      if (!imap?.host || !imap?.senha) throw new Error("Essa conta veio sem os dados do IMAP.");
      await testarLogin({ host: imap.host, porta: imap.porta || 993, usuario: imap.usuario || input.conta?.email, senha: imap.senha });
      // Só e-mails depois daqui valem como código (o cadastro dispara o envio).
      estado.desde = Date.now();
      return `${imap.host}:${imap.porta || 993} ok`;
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
      try {
        return await cadastrarInstagram({ d, conta, perguntar, log, imap: input.imap ?? null, desde: estado.desde ?? Date.now() - 60_000 });
      } catch (e) {
        if (!(e instanceof ContaTravada)) throw e;
        log(`${e.message} Desligando o container.`);
        marcarAlerta(criada, e.alerta);
        await pararInstagram(await dispositivo()).catch(() => {});
        await mumu.fechar(container(estado)).catch(() => {});
        const aviso = new Error(e.alerta);
        aviso.semPrefixo = true;
        throw aviso;
      }
    },
  },
  {
    chave: "perfil",
    rotulo: "Foto, nome de exibição e bio",
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
        await d.shell("rm -rf /sdcard/DCIM/ScaleMaster; mkdir -p /sdcard/DCIM/ScaleMaster");
        await d.enviar(foto, `/sdcard/DCIM/ScaleMaster/sm-${Date.now()}${path.extname(foto).toLowerCase()}`);
        await esperar(3000);
        feitos.push(await trocarFoto(c));
      } else log("sem foto em /opt/scalemaster/midias: pulando a foto");
      const bio = input?.conta?.bio || BIOS[Math.floor(Math.random() * BIOS.length)];
      feitos.push(await editarPerfil(c, { nome: input?.conta?.nome ?? "", bio }));
      return feitos.join(" · ");
    },
  },
  ...AQUECIMENTO,
  {
    chave: "sessao",
    rotulo: "Exportar a sessão",
    async rodar({ job, input, estado, dispositivo }) {
      const d = await dispositivo();
      await d.root();
      // Sessão = o que o app guarda (shared_prefs com os cookies e tokens, e os bancos): tar via adb, gravado só na VPS.
      const tgz = await d.binario("tar", "-czf", "-", "-C", `/data/data/${INSTAGRAM}`, "shared_prefs", "databases");
      const arquivo = gravarSessao(job.id, {
        jobId: job.id,
        container: nomeContainer(estado),
        usuario: input?.conta?.usuario || null,
        email: input?.conta?.email || null,
        device: deviceDe(input, estado),
        proxy: input?.proxy ? new URL(input.proxy).host : null,
        exportadoEm: new Date().toISOString(),
        arquivos: { "sessao.tgz": tgz.toString("base64") },
      });
      return `${path.basename(arquivo)} (${Math.round(tgz.length / 1024)} KB)`;
    },
  },
  {
    chave: "fechar",
    rotulo: "Desligar o container",
    sempre: true,
    async rodar({ mumu, estado, dispositivo }) {
      await pararInstagram(await dispositivo());
      await mumu.fechar(container(estado));
      return "Instagram parado e container desligado";
    },
  },
];

/** Fluxos da fila por kind: lista de etapas, ou função do input que monta a lista. */
export const FLUXOS = { "nova-conta": NOVA_CONTA, atividade: ATIVIDADE };

export { ProxyMorta };
