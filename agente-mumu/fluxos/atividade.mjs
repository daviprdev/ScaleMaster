import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { ligarProxy } from "./nekobox.mjs";
import { VERIFICADOS } from "./verificados.mjs";

/**
 * Atividade (aba Emulador) numa instância que já tem conta: liga, conecta a
 * proxy do NekoBox ANTES de abrir o Instagram, faz o que o dono marcou e
 * desliga. input = { acoes: ["aquecer","foto","story"], midias: { foto?, story? }
 * (links assinados do SaaS), story: { link, texto, destaque } }. As chaves batem
 * com ATIVIDADE_FLUXO em lib/emulador/atividade.ts.
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
 * Baixa a mídia do SaaS e põe na galeria da instância. A pasta ScaleMaster fica
 * só com ela, então é a mais nova da galeria (a 1ª que o Instagram mostra). Na
 * /sdcard o Android já registra o arquivo na galeria sozinho (testado em 01/11).
 */
async function midiaNaGaleria(d, midia, job, log) {
  if (!midia?.url) throw new Error("A mídia não veio do SaaS. Remova a estruturação e inicie de novo.");
  const ext = /^\.(jpg|png|mp4|mov)$/i.test(midia.ext ?? "") ? midia.ext.toLowerCase() : ".jpg";
  const res = await fetch(midia.url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Não deu para baixar a mídia (HTTP ${res.status}). O link vale 2 h: clique em Continuar.`);
  const dados = Buffer.from(await res.arrayBuffer());
  const pasta = path.join(os.tmpdir(), "scalemaster-midias");
  mkdirSync(pasta, { recursive: true });
  const local = path.join(pasta, `${job.id}${ext}`);
  writeFileSync(local, dados);
  try {
    await d.shell(`rm -rf ${PASTA_MIDIA}; mkdir -p ${PASTA_MIDIA}`);
    await d.enviar(local, `${PASTA_MIDIA}/sm-${Date.now()}${ext}`);
    await esperar(3000);
    log(`mídia na galeria (${Math.round(dados.length / 1024)} KB)`);
  } finally {
    try {
      unlinkSync(local);
    } catch {
      /* já foi */
    }
  }
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
    rotulo: "Conectar a proxy no NekoBox",
    sempre: true,
    async rodar({ dispositivo, log }) {
      return ligarProxy(await dispositivo(), log);
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
  seguir: {
    chave: "seguir",
    rotulo: "Seguir perfis verificados",
    async rodar(ctx) {
      return seguirVerificados(await contexto(ctx), VERIFICADOS, sortear(2, 3));
    },
  },
  reels: {
    chave: "reels",
    rotulo: "Rolar os Reels",
    async rodar(ctx) {
      // Pedido do dono: no máximo 2 min de Reels.
      return rolarReels(await contexto(ctx), sortear(90_000, 120_000));
    },
  },
  foto: {
    chave: "foto",
    rotulo: "Trocar a foto de perfil",
    async rodar(ctx) {
      const c = await contexto(ctx);
      await midiaNaGaleria(c.d, ctx.input.midias?.foto, ctx.job, ctx.log);
      return trocarFoto(c);
    },
  },
  story: {
    chave: "story",
    rotulo: "Postar o story com link",
    async rodar(ctx) {
      const c = await contexto(ctx);
      await midiaNaGaleria(c.d, ctx.input.midias?.story, ctx.job, ctx.log);
      return postarStory(c, ctx.input.story ?? {});
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

/** Etapas da atividade, só com o que o dono marcou. */
export function ATIVIDADE(input) {
  const acoes = new Set(Array.isArray(input?.acoes) ? input.acoes : []);
  return [
    ETAPAS.abrir,
    ETAPAS.proxy,
    ETAPAS.instagram,
    ...(acoes.has("aquecer") ? [ETAPAS.seguir, ETAPAS.reels] : []),
    ...(acoes.has("foto") ? [ETAPAS.foto] : []),
    ...(acoes.has("story") ? [ETAPAS.story, ETAPAS.destaque] : []),
    ETAPAS.fechar,
  ];
}
