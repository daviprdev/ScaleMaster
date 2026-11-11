import { casa } from "../lib/adb.mjs";
import { esperar } from "../lib/processo.mjs";

/**
 * Ajudantes para as etapas que mexem na tela: achar um elemento por texto
 * (em qualquer das línguas que a instância pode mostrar) ou por id, e esperar
 * uma tela aparecer.
 */

/** Primeiro nó que mostra algum dos textos. */
export function acharTexto(nos, alvos, { exato = false, clicavel = false } = {}) {
  for (const alvo of alvos) {
    const no = nos.find((n) => casa(n, alvo, exato) && (!clicavel || n.clicavel));
    if (no) return no;
  }
  return null;
}

export function temTexto(nos, alvos, opcoes) {
  return acharTexto(nos, alvos, opcoes) !== null;
}

export function acharId(nos, id) {
  return nos.find((n) => n.id === id) ?? null;
}

/** Lê a tela até `teste(nos)` devolver algo (que é retornado) ou estourar o tempo. */
export async function esperarTela(d, teste, { timeoutMs = 30_000, intervaloMs = 1500, descricao = "a tela esperada" } = {}) {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const nos = await d.tela();
    const achou = teste(nos);
    if (achou) return achou;
    if (Date.now() > limite) {
      const visiveis = nos.map((n) => n.texto || n.descricao).filter(Boolean).slice(0, 6).join(" | ");
      throw new Error(`Não apareceu ${descricao} em ${Math.round(timeoutMs / 1000)} s. Na tela: ${visiveis || "nada legível"}`);
    }
    await esperar(intervaloMs);
  }
}

export async function tocarNo(d, no, pausaMs = 1200) {
  await d.tocar(no.x, no.y);
  await esperar(pausaMs);
}

/** Intervalo entre as releituras de tela das esperas por mudança (os testes baixam). */
export const TEMPOS = { intervaloMs: 700 };

/** Retrato do dump para comparar duas telas: ids, textos, descrições e posições. */
export function assinatura(nos) {
  return (nos ?? []).map((n) => `${n.id}|${n.texto}|${n.descricao}|${n.x},${n.y}`).join("\n");
}

/**
 * Relê a tela até o dump ficar diferente de `antes` (nós ou assinatura).
 * Devolve a tela nova, ou null se nada mudou em `timeoutMs`.
 */
export async function esperarMudar(d, antes, { timeoutMs = 6000 } = {}) {
  const base = typeof antes === "string" ? antes : assinatura(antes);
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const nos = await d.tela().catch(() => null);
    if (nos && nos.length > 0 && assinatura(nos) !== base) return nos;
    if (Date.now() >= limite) return null;
    await esperar(TEMPOS.intervaloMs);
  }
}

/**
 * Toca e espera a tela reagir (dump diferente do de antes do toque), em vez de
 * uma pausa fixa. Nada mudou no tempo: toca de novo, até `tentativas`. Toque
 * que não pode repetir (publicar, salvar) usa tentativas = 1. Devolve a tela
 * nova ou null.
 */
export async function tocarAteMudar(d, no, antes, { timeoutMs = 6000, tentativas = 2 } = {}) {
  const base = assinatura(antes);
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    await d.tocar(no.x, no.y);
    const depois = await esperarMudar(d, base, { timeoutMs });
    if (depois) return depois;
  }
  return null;
}

/**
 * preencher() sem pausa fixa: toca no campo e espera ele ganhar o foco (ou a
 * tela mudar), apaga, digita e espera o texto aparecer no dump. Devolve por
 * onde o texto foi ("broadcast" ou "input").
 */
export async function preencherEsperando(d, no, valor, antes) {
  const base = assinatura(antes ?? []);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    await d.tocar(no.x, no.y);
    const limite = Date.now() + 3000;
    let pronto = false;
    while (!pronto) {
      const nos = await d.tela().catch(() => null);
      pronto = !!nos && nos.length > 0 && (nos.some((n) => n.focado && /EditText/.test(n.classe)) || assinatura(nos) !== base);
      if (pronto || Date.now() >= limite) break;
      await esperar(TEMPOS.intervaloMs);
    }
    if (pronto) break;
  }
  await d.limparCampo();
  const vazio = await d.tela().catch(() => []);
  const via = await d.digitar(valor);
  if (String(valor) !== "") await esperarMudar(d, vazio, { timeoutMs: 5000 });
  return via;
}

/** Toca no campo, apaga o que tinha e digita. */
export async function preencher(d, no, valor) {
  await tocarNo(d, no, 600);
  await d.limparCampo();
  await d.digitar(valor);
  await esperar(500);
}
