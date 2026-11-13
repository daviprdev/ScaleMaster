import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esperar } from "../lib/processo.mjs";

/**
 * Quando a automação precisa do dono: guarda a tela que ela não conhece em
 * agente-mumu/telas/ (para virar automação depois) e pergunta na aba Emulador.
 */

const PASTA_TELAS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "telas");

export function salvarTela(nos, motivo) {
  try {
    mkdirSync(PASTA_TELAS, { recursive: true });
    const linhas = nos
      .filter((n) => n.texto || n.descricao || n.id)
      .map((n) => `${n.texto || "(desc) " + n.descricao} @${n.x},${n.y} ${n.clicavel ? "[clic] " : ""}${n.classe} ${n.id}`);
    const arquivo = path.join(PASTA_TELAS, `${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);
    writeFileSync(arquivo, `${motivo}\n\n${linhas.join("\n")}\n`);
  } catch {
    /* sem pasta: só não guarda */
  }
}

export function resumoTela(nos) {
  return nos
    .map((n) => n.texto || n.descricao)
    .filter((t) => t && t.length < 80)
    .slice(0, 5)
    .join(" | ");
}

/**
 * ctx = { d, perguntar(tipo, texto, { sinal }), log }. Devolve:
 *   perguntarVigiando(tipo, texto, aindaIgual) — pergunta e, enquanto espera,
 *     olha a tela a cada 3 s: se `aindaIgual` deixar de valer, o dono resolveu
 *     direto na instância e segue sozinha (devolve null);
 *   manual(texto, nos) — "resolva na instância": segue quando ele clica ou a tela muda;
 *   terminarAMao(texto, nos, oQue) — ele termina a tarefa inteira à mão; sem
 *     vigiar a tela, porque a automação não pode repetir o que ele fez (postar
 *     o story duas vezes). Devolve a mensagem da etapa.
 */
export function criarAjuda({ d, perguntar, log }) {
  const perguntarVigiando = async (tipo, texto, aindaIgual) => {
    const controle = new AbortController();
    const vigia = (async () => {
      while (!controle.signal.aborted) {
        await esperar(3000);
        const agora = await d.tela().catch(() => null);
        if (agora && agora.length > 0 && !aindaIgual(agora)) controle.abort();
      }
    })();
    try {
      return await perguntar(tipo, texto, { sinal: controle.signal });
    } finally {
      controle.abort();
      await vigia;
    }
  };

  const manual = async (texto, nos) => {
    if (nos) salvarTela(nos, texto);
    log(`esperando você: ${texto}`);
    const antes = nos ? resumoTela(nos) : null;
    const resposta = await perguntarVigiando(
      "manual",
      `${texto} Resolva na instância e clique em "Já resolvi, continuar".`,
      (agora) => antes === null || resumoTela(agora) === antes
    );
    if (resposta === null) log("a tela mudou na instância: seguindo");
  };

  const terminarAMao = async (texto, nos, oQue) => {
    if (nos) salvarTela(nos, texto);
    log(`esperando você terminar à mão: ${texto}`);
    await perguntar("manual", `${texto} Termine ${oQue} à mão na instância e clique em "Já resolvi, continuar".`);
    return `${oQue} feito à mão`;
  };

  return { perguntarVigiando, manual, terminarAMao };
}

/** Texto da pergunta virado motivo da falha: sem o "Resolva na instância…" do fim. */
export function semPerguntar(texto) {
  return String(texto ?? "Parou esperando resposta.").replace(/s*(Resolva|Termine) .*$/s, "").trim() || "Parou esperando resposta.";
}
