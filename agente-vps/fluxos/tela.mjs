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

/** Dump guardado do aparelho quando ele tem cache (lib/adb.mjs); senão, um dump novo. */
export function telaAtual(d) {
  return typeof d.telaAtual === "function" ? d.telaAtual() : d.tela();
}

/**
 * Espera o teclado abrir depois do toque no campo, SEM uiautomator: lê o
 * mInputShown do dumpsys input_method (uns 60 ms por leitura, contra 2,3 s de
 * um dump). Devolve true quando abriu; no fim do tempo segue assim mesmo.
 */
export async function esperarTeclado(d, { timeoutMs = 1500, intervaloMs = 120 } = {}) {
  if (typeof d.shell !== "function") return false;
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const saida = await d.shell("dumpsys", "input_method").catch(() => "");
    if (/mInputShown=true/.test(saida)) return true;
    if (Date.now() >= limite) return false;
    await esperar(intervaloMs);
  }
}

const ehCampo = (n) => /EditText/.test(n.classe);

/** O texto digitado está na tela (ou, em campo de senha, o conteúdo dos campos mudou em relação a `antes`)? */
export function campoPreenchido(depois, valor, antes) {
  const texto = String(valor);
  if (depois.some((n) => n.texto.includes(texto))) return true;
  const campos = (nos) => (nos ?? []).filter(ehCampo).map((n) => n.texto).join("\n");
  return campos(depois) !== campos(antes) && depois.filter(ehCampo).some((n) => n.texto !== "");
}

/**
 * Preenche um campo com o mínimo de leituras de tela:
 *   1. o dump que achou o campo é o de quem chama (`antes`), não se repete;
 *   2. um toque;
 *   3. espera do teclado pelo dumpsys (sem dump);
 *   4. apaga só se o campo já tinha texto, e manda o texto (broadcast do teclado ADB);
 *   5. um dump de verificação — que fica guardado no aparelho para quem chama (telaAtual).
 * Se a verificação mostra o campo ainda vazio, repete do toque uma vez, sem
 * nenhum dump a mais antes de digitar. Devolve por onde o texto foi
 * ("broadcast" ou "input").
 */
export async function preencherEsperando(d, no, valor, antes, { limpar: sempreLimpar = false } = {}) {
  const texto = String(valor);
  // sempreLimpar: campo que abre outra tela (bio) — o nó tocado não mostra o texto que está lá dentro.
  let limpar = sempreLimpar || !!no.texto;
  let via = "input";
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    await d.tocar(no.x, no.y);
    await esperarTeclado(d);
    if (limpar) await d.limparCampo();
    via = await d.digitar(texto);
    if (texto === "") return via;
    const depois = await d.tela();
    if (campoPreenchido(depois, texto, antes)) return via;
    // Segunda volta: só apaga se o campo ficou com algum texto que não é o pedido.
    limpar = depois.some((n) => ehCampo(n) && n.texto !== "" && Math.abs(n.y - no.y) < 200);
  }
  return via;
}

/** Toca no campo, apaga o que tinha e digita. */
export async function preencher(d, no, valor) {
  await tocarNo(d, no, 600);
  await d.limparCampo();
  await d.digitar(valor);
  await esperar(500);
}
