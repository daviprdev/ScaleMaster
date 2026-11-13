import path from "node:path";
import { etapaDoAlvo, motivoParaPular } from "../lib/estrutura.mjs";
import { pastaDeMidias, resolverMidia } from "../lib/midias.mjs";
import { fotoUnicaNaGaleria } from "../lib/galeria.mjs";
import { ProxyMorta, subirSidecar, validar, validarNoNetns } from "../lib/rede.mjs";
import { INSTAGRAM } from "./apk.mjs";
import { salvarTela } from "./dono.mjs";
import { garantirTeclado } from "../lib/teclado.mjs";
import { conferirSessao, destacarStory, editarPerfil, garantirProxy, iniciarInstagram, pararInstagram, postarStory, trocarFoto } from "./instagram.mjs";
import { abrirDestaque, abrirPerfilAlvo, conectar, confirmar, consentir, garantirPerfilAlvo, tocarLinkDoDestaque, tornarProfissional } from "./oauth.mjs";

/**
 * Estruturar uma conta da VPS (emulator_jobs.kind = 'estruturacao'). As etapas
 * vêm prontas do servidor em input.plano ([{ key, label }], expandidas por alvo
 * em lib/vps/estruturacao.ts): aqui cada chave ganha o que rodar.
 *
 *   rede, abrir, instagram, sessao    — param tudo se falharem (proxy morta = PROXY_MORTA, conta deslogada =
 *                                       SESSAO_PERDIDA; a conta fica como está, nada é descartado)
 *   foto, bio, story, destacar        — `segue`: a falha é registrada e a próxima etapa independente roda
 *   profissional                      — `segue`: falha = PROFISSIONAL_FALHOU e só as etapas de OAuth são bloqueadas
 *   perfil-N … confirmar-N (por alvo) — `segue`: falha em uma pula o resto do alvo N e vai para o alvo seguinte
 *   fechar                            — sempre: para o Instagram e desliga o container (não apaga)
 *
 * `pular(falhas)` devolve o motivo quando outra etapa que falhou bloqueia esta
 * (lib/estrutura.mjs). O rodarJob de agente.mjs trata `segue` e `pular` e tira
 * o print da tela no fim de cada etapa.
 */

const PASTA_FOTOS = "/sdcard/Pictures/ScaleMaster";

function container(estado) {
  if (estado.instanceIndex === null || estado.instanceIndex === undefined) throw new Error("A estruturação veio sem o container.");
  return estado.instanceIndex;
}

/**
 * Sem dono na frente (a estruturação costuma rodar agendada): tela que a
 * automação não resolve vira falha da etapa, com a tela salva em telas/.
 */
function ajudaSemDono(log) {
  const falhar = (texto, nos) => {
    if (nos) salvarTela(nos, `estruturar: ${texto}`);
    log(`sem saída: ${texto}`);
    throw new Error(texto);
  };
  return { manual: falhar, terminarAMao: falhar, perguntarVigiando: async () => null };
}

/** Aparelho com a proxy conferida (sidecar de pé) antes de cada etapa no Instagram. */
async function contexto({ dispositivo, log, input }) {
  const d = await dispositivo();
  await garantirProxy(d);
  // usuario: o Instagram abre e reabre direto no perfil da conta (deep link), sem passar pelo feed.
  return { d, log, ajuda: ajudaSemDono(log), usuario: input?.conta?.usuario ?? "" };
}

/**
 * A foto (de perfil ou do story) vira a única das pastas do agente na galeria
 * e a mais nova dela (lib/galeria.mjs): a foto do story virava foto de perfil.
 */
async function fotoNaGaleria(d, relativo, log) {
  const raiz = await pastaDeMidias();
  if (!raiz) throw new Error("não achei a pasta de mídias (/opt/scalemaster/midias) nesta VPS");
  const local = resolverMidia(raiz, relativo);
  await fotoUnicaNaGaleria(d, local, { pasta: PASTA_FOTOS, log });
  log(`foto na galeria: ${relativo}`);
  return path.basename(relativo);
}

/**
 * O que vai no story: o link do sticker configurado no diálogo (jobs antigos:
 * o do primeiro alvo) e a legenda do sticker, numa linha só.
 */
export function dadosDoStory(input) {
  return {
    link: input?.linkStory || input?.alvos?.[0]?.link || "",
    texto: String(input?.legenda || "").replace(/\s*\r?\n\s*/g, " "),
  };
}

/** Nome do destaque que a conta cria com o story (vai por broadcast, com emoji). */
export function nomeDoDestaqueDaConta(input) {
  return String(input?.destaque || input?.alvos?.[0]?.destaque || "").trim();
}

const FIXAS = {
  rede: {
    rotulo: "Validar a proxy e subir o sidecar",
    sempre: true,
    async rodar({ mumu, estado, input, log }) {
      const i = container(estado);
      const proxy = mumu.proxyDe(i);
      if (!proxy) throw new ProxyMorta("o container não tem proxy gravada");
      const pais = mumu.deviceDe(i)?.pais ?? input?.pais ?? null;
      // Primeiro de fora (sem ligar nada): proxy morta encerra aqui, sem mexer na conta.
      await validar(proxy, pais);
      await mumu.prepararInstancia(i, { log });
      await subirSidecar(`ig-${i}`, proxy);
      const geo = await validarNoNetns(`ig-${i}`, pais);
      return `proxy de pé · saída ${geo.ip} (${geo.pais})`;
    },
  },
  abrir: {
    rotulo: "Ligar o container",
    sempre: true,
    async rodar({ mumu, estado, log }) {
      await mumu.prepararInstancia(container(estado), { log });
      return "Android pronto";
    },
  },
  instagram: {
    rotulo: "Abrir o Instagram",
    sempre: true,
    async rodar(ctx) {
      const c = await contexto(ctx);
      // Sem reinstalar: o app e a sessão são os do cadastro.
      if (!(await c.d.temApp(INSTAGRAM))) throw new Error("o Instagram não está instalado nesse container");
      // Teclado ADB (acento e emoji na bio, na legenda e no destaque): instala se o container ainda não tem.
      const teclado = await garantirTeclado(c.d, ctx.log);
      return `${await iniciarInstagram(c)}${teclado ? " · teclado ADB ativo" : " · sem teclado ADB (só ASCII)"}`;
    },
  },
  sessao: {
    rotulo: "Conferir que a conta está logada",
    sempre: true,
    async rodar(ctx) {
      // Antes da foto e de tudo o que mexe na conta: sem sessão o job para com SESSAO_PERDIDA (nada é descartado).
      return conferirSessao(await contexto(ctx), ctx.input?.conta?.usuario);
    },
  },
  foto: {
    rotulo: "Trocar a foto de perfil",
    segue: true,
    async rodar(ctx) {
      if (!ctx.input?.fotoPerfil) throw new Error("a estruturação veio sem a foto de perfil");
      const c = await contexto(ctx);
      const nome = await fotoNaGaleria(c.d, ctx.input.fotoPerfil, ctx.log);
      return `${await trocarFoto(c)} (${nome})`;
    },
  },
  bio: {
    rotulo: "Preencher a bio",
    segue: true,
    async rodar(ctx) {
      await editarPerfil(await contexto(ctx), { nome: "", bio: String(ctx.input?.bio ?? "") });
      return "bio salva";
    },
  },
  profissional: {
    rotulo: "Mudar para conta profissional (Criador)",
    segue: true,
    async rodar(ctx) {
      return tornarProfissional(await contexto(ctx));
    },
  },
  story: {
    rotulo: "Postar o story com link",
    segue: true,
    async rodar(ctx) {
      const { input } = ctx;
      const { link, texto } = dadosDoStory(input);
      if (!link) throw new Error("a estruturação veio sem o link do story");
      if (!input?.fotoStory) throw new Error("a estruturação veio sem a foto do story");
      const c = await contexto(ctx);
      const nome = await fotoNaGaleria(c.d, input.fotoStory, ctx.log);
      return `${await postarStory(c, { link, texto })} (${nome})`;
    },
  },
  destacar: {
    rotulo: "Destacar o story",
    segue: true,
    async rodar(ctx) {
      // O nome vai digitado pelo teclado ADB (broadcast): o emoji de "AQUI 🔗👆" entra como está.
      return destacarStory(await contexto(ctx), nomeDoDestaqueDaConta(ctx.input));
    },
  },
  fechar: {
    rotulo: "Desligar o container",
    sempre: true,
    async rodar({ mumu, estado, dispositivo, log }) {
      await pararInstagram(await dispositivo()).catch(() => {});
      // decisão (13/11): o docker stop (~40 s) roda fora da vaga, igual ao fim da criação de conta.
      if (mumu.fecharDepois) {
        mumu.fecharDepois(container(estado), { log });
        return "Instagram parado; container desligando fora da vaga (nada apagado)";
      }
      await mumu.fechar(container(estado));
      return "Instagram parado e container desligado (nada apagado)";
    },
  },
};

const DO_ALVO = {
  perfil: (ctx, c, alvo) => abrirPerfilAlvo(c, alvo.perfil),
  destaque: async (ctx, c, alvo) => {
    await garantirPerfilAlvo(c, alvo.perfil);
    return abrirDestaque(c, alvo.destaque);
  },
  // O destaque vai junto: o story dura ~5 s e, se acabar entre as etapas, o link reabre o destaque.
  // e o perfil: no Continuar a etapa pode começar fora do perfil do alvo.
  link: (ctx, c, alvo) => tocarLinkDoDestaque(c, { link: alvo.link, destaque: alvo.destaque, perfil: alvo.perfil }),
  conectar: (ctx, c, alvo) => conectar(c, { link: alvo.link, conta: ctx.input?.conta }),
  consentir: (ctx, c) => consentir(c, ctx.input?.conta?.usuario),
  confirmar: (ctx, c) => confirmar(c, ctx.input?.conta?.usuario),
};

/** Etapas do job a partir do plano que o servidor gravou (chave desconhecida vira etapa que falha e segue). */
export function ESTRUTURACAO(input) {
  const plano = Array.isArray(input?.plano) ? input.plano : [];
  return plano.map(({ key, label }) => {
    const pular = (falhas) => motivoParaPular(key, falhas);
    const fixa = FIXAS[key];
    if (fixa) return { ...fixa, chave: key, rotulo: label || fixa.rotulo, pular };
    const doAlvo = etapaDoAlvo(key);
    const alvo = doAlvo ? input?.alvos?.[doAlvo.n - 1] : null;
    return {
      chave: key,
      rotulo: label || key,
      segue: true,
      pular,
      async rodar(ctx) {
        if (!doAlvo || !alvo) throw new Error(`este agente não conhece a etapa "${key}"`);
        return DO_ALVO[doAlvo.tipo](ctx, await contexto(ctx), alvo);
      },
    };
  });
}
