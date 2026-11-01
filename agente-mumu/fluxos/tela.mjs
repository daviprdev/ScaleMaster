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

/** Toca no campo, apaga o que tinha e digita. */
export async function preencher(d, no, valor) {
  await tocarNo(d, no, 600);
  await d.limparCampo();
  await d.digitar(valor);
  await esperar(500);
}
