import path from "node:path";
import { pastaDeMidias, resolverMidia } from "../lib/midias.mjs";
import { esperar } from "../lib/processo.mjs";
import { criarAjuda } from "./dono.mjs";
import {
  abrirInstagram,
  destacarStory,
  garantirProxy,
  pararInstagram,
  postarStory,
  rolarReels,
  seguirVerificados,
  sortear,
  trocarFoto,
} from "./instagram.mjs";
import { subirSidecar, validarNoNetns } from "../lib/rede.mjs";
import { VERIFICADOS } from "./verificados.mjs";

/**
 * Cópia adaptada de agente-mumu/fluxos/atividade.mjs: a proxy é o sidecar
 * redsocks do container (lib/rede.mjs), não o NekoBox.
 *
 * Atividade numa instância que já tem conta: liga, sobe a proxy ANTES de
 * abrir o Instagram, faz o que o dono marcou e desliga. input = { acoes: ["foto","story"], midias: { foto?, story? }
 * (arquivos marcados na pasta do MuMu, caminho relativo; mais de um = sorteia),
 * story: { link, texto, destaque } }. As chaves batem com ATIVIDADE_FLUXO em
 * lib/emulador/atividade.ts.
 *
 * `sempre`: no Continuar a etapa roda de novo mesmo já feita (a instância pode
 * ter desligado e a proxy caído desde a última vez).
 */

const PASTA_MIDIA = "/sdcard/DCIM/ScaleMaster";

function instancia(estado) {
  if (estado.instanceIndex === null || estado.instanceIndex === undefined) throw new Error("A estruturação veio sem a instância.");
  return estado.instanceIndex;
}

/** Aparelho + ajuda do dono; antes de cada etapa no Instagram confere se a proxy continua de pé. */
async function contexto({ dispositivo, perguntar, log }) {
  const d = await dispositivo();
  await garantirProxy(d);
  return { d, log, ajuda: criarAjuda({ d, perguntar, log }) };
}

/**
 * Sorteia uma das mídias marcadas na aba, da pasta do MuMu no PC, e copia para
 * a galeria da instância. A pasta ScaleMaster fica só com ela, então é a mais
 * nova da galeria (a 1ª que o Instagram mostra). Na /sdcard o Android já
 * registra o arquivo na galeria sozinho (testado em 01/11).
 */
async function midiaNaGaleria(d, marcadas, log) {
  if (!Array.isArray(marcadas) || marcadas.length === 0) {
    throw new Error("A estruturação veio sem mídia. Remova e inicie de novo escolhendo da pasta do MuMu.");
  }
  const raiz = await pastaDeMidias();
  if (!raiz) throw new Error("Não achei a pasta de mídias (/opt/scalemaster/midias) nesta VPS.");
  const escolhida = marcadas[Math.floor(Math.random() * marcadas.length)];
  const local = resolverMidia(raiz, escolhida);
  await d.shell(`rm -rf ${PASTA_MIDIA}; mkdir -p ${PASTA_MIDIA}`);
  await d.enviar(local, `${PASTA_MIDIA}/sm-${Date.now()}${path.extname(local).toLowerCase()}`);
  await esperar(3000);
  log(`mídia na galeria: ${escolhida}${marcadas.length > 1 ? ` (sorteada entre ${marcadas.length})` : ""}`);
  return escolhida;
}

const ETAPAS = {
  abrir: {
    chave: "abrir",
    rotulo: "Ligar a instância",
    sempre: true,
    async rodar({ mumu, estado, log }) {
      await mumu.prepararInstancia(instancia(estado), { log });
      return "Android pronto";
    },
  },
  proxy: {
    chave: "proxy",
    rotulo: "Subir a proxy do container",
    sempre: true,
    async rodar({ mumu, estado, log }) {
      return ligarProxy(mumu, instancia(estado), log);
    },
  },
  instagram: {
    chave: "instagram",
    rotulo: "Abrir o Instagram",
    sempre: true,
    async rodar(ctx) {
      // Só abre com a proxy testada na etapa anterior e a VPN ainda de pé (contexto confere).
      return abrirInstagram(await contexto(ctx));
    },
  },
  foto: {
    chave: "foto",
    rotulo: "Trocar a foto de perfil",
    async rodar(ctx) {
      const c = await contexto(ctx);
      const escolhida = await midiaNaGaleria(c.d, ctx.input.midias?.foto, ctx.log);
      return `${await trocarFoto(c)} (${path.basename(escolhida)})`;
    },
  },
  story: {
    chave: "story",
    rotulo: "Postar o story com link",
    async rodar(ctx) {
      const c = await contexto(ctx);
      const escolhida = await midiaNaGaleria(c.d, ctx.input.midias?.story, ctx.log);
      return `${await postarStory(c, ctx.input.story ?? {})} (${path.basename(escolhida)})`;
    },
  },
  destaque: {
    chave: "destaque",
    rotulo: "Destacar o story",
    async rodar(ctx) {
      return destacarStory(await contexto(ctx), ctx.input.story?.destaque);
    },
  },
  fechar: {
    chave: "fechar",
    rotulo: "Desligar a instância",
    sempre: true,
    async rodar({ mumu, estado, dispositivo }) {
      await pararInstagram(await dispositivo());
      await mumu.fechar(instancia(estado));
      return "Instagram parado e instância desligada";
    },
  },
};

/** Sobe o sidecar com a proxy gravada no retrato do container e confere de dentro do netns. */
export async function ligarProxy(mumu, index, log) {
  const proxy = mumu.proxyDe(index);
  if (!proxy) throw new Error("Esse container não tem proxy gravada. Edite a conta e informe uma.");
  const nome = `ig-${index}`;
  await subirSidecar(nome, proxy);
  const geo = await validarNoNetns(nome, mumu.deviceDe(index)?.pais ?? null);
  log(`proxy de pé (${geo.ip}, ${geo.pais})`);
  return `conectado (${geo.ip}, ${geo.pais})`;
}

/**
 * No Continuar o container pode ter religado com o sidecar bloqueado: sobe a
 * proxy e reabre o Instagram por ela antes de mexer na conta.
 */
async function proxyAntesDoInstagram(ctx) {
  const d = await ctx.dispositivo();
  const { proxyLigada } = await import("./instagram.mjs");
  if (await proxyLigada(d)) return;
  await ligarProxy(ctx.mumu, instancia(ctx.estado), ctx.log);
  await abrirInstagram({ d, log: ctx.log, ajuda: criarAjuda({ d, perguntar: ctx.perguntar, log: ctx.log }) });
}

/** Aquecimento da conta nova (pedido do dono): roda no fim da criação, em fluxos/nova-conta.mjs. */
export const AQUECIMENTO = [
  {
    chave: "seguir",
    rotulo: "Aquecer: seguir perfis verificados",
    async rodar(ctx) {
      await proxyAntesDoInstagram(ctx);
      return seguirVerificados(await contexto(ctx), VERIFICADOS, sortear(2, 3));
    },
  },
  {
    chave: "reels",
    rotulo: "Aquecer: rolar os Reels",
    async rodar(ctx) {
      await proxyAntesDoInstagram(ctx);
      // Pedido do dono: no máximo 2 min de Reels.
      return rolarReels(await contexto(ctx), sortear(90_000, 120_000));
    },
  },
];

/** Etapas do Estruturar, só com o que o dono marcou (foto e/ou story com destaque). */
export function ATIVIDADE(input) {
  const acoes = new Set(Array.isArray(input?.acoes) ? input.acoes : []);
  return [
    ETAPAS.abrir,
    ETAPAS.proxy,
    ETAPAS.instagram,
    ...(acoes.has("foto") ? [ETAPAS.foto] : []),
    ...(acoes.has("story") ? [ETAPAS.story, ETAPAS.destaque] : []),
    ETAPAS.fechar,
  ];
}
