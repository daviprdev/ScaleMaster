#!/usr/bin/env node
/**
 * Calibração do mapa de toques dos containers redroid (1080x1920 @ 420 dpi):
 * confere que a tela do container tem o tamanho fixo, que um toque cai onde
 * o uiautomator diz e que a escala do print (para o captcha) é 1.
 *
 *   node scripts/vps/calibrar.mjs <índice>        (container ligado)
 *   node scripts/vps/calibrar.mjs --print 2       (só mede a escala do print)
 *
 * Sai com 0 quando tudo bate; com 1 e o relatório quando algo diverge. Sem
 * dependências (Node 18+).
 */
import { Dispositivo, serialDe } from "../../agente-vps/lib/adb.mjs";

const LARGURA = 1080;
const ALTURA = 1920;
const DPI = 420;

/** Largura e altura de um PNG (cabeçalho IHDR), sem biblioteca. */
export function tamanhoPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

/** Escala entre o print e a tela fixa (1 = as coordenadas do Capsolver viram toques direto). */
export function escalaDoPrint(tamanho) {
  if (!tamanho) return null;
  return Number((tamanho.largura / LARGURA).toFixed(4));
}

async function main(args) {
  const soPrint = args.includes("--print");
  const index = Number(args.find((a) => /^\d+$/.test(a)));
  if (!Number.isInteger(index)) {
    console.log("uso: node scripts/vps/calibrar.mjs [--print] <índice do container ligado>");
    process.exit(2);
  }
  const d = new Dispositivo("adb", serialDe(index));
  await d.conectar();
  const problemas = [];

  const png = await d.print();
  const tam = tamanhoPng(png);
  const escala = escalaDoPrint(tam);
  console.log(`print: ${tam ? `${tam.largura}x${tam.altura}` : "ilegível"} (escala ${escala ?? "?"})`);
  if (escala !== 1) problemas.push(`print com escala ${escala}: o captcha precisa dividir as coordenadas por isso`);
  if (soPrint) return problemas;

  const tela = await d.tamanho();
  console.log(`wm size: ${tela.largura}x${tela.altura}`);
  if (tela.largura !== LARGURA || tela.altura !== ALTURA) problemas.push(`tela ${tela.largura}x${tela.altura}, esperado ${LARGURA}x${ALTURA}`);
  const dpi = Number(/(\d+)/.exec(await d.shell("wm", "density"))?.[1]);
  console.log(`wm density: ${dpi}`);
  if (dpi !== DPI) problemas.push(`dpi ${dpi}, esperado ${DPI}`);

  // Toque de prova: abre as Configurações, lê um item pelo uiautomator, toca no centro dele e confere que a tela mudou.
  await d.shell("am", "start", "-a", "android.settings.SETTINGS");
  await new Promise((r) => setTimeout(r, 3000));
  const nos = await d.tela();
  const alvo = nos.find((n) => n.clicavel && n.texto && n.y > 300) ?? null;
  if (!alvo) problemas.push("não achei um item clicável nas Configurações para o toque de prova");
  else {
    const antes = nos.map((n) => n.texto).join("|");
    await d.tocar(alvo.x, alvo.y);
    await new Promise((r) => setTimeout(r, 2500));
    const depois = (await d.tela()).map((n) => n.texto).join("|");
    console.log(`toque em "${alvo.texto}" @${alvo.x},${alvo.y}: ${antes === depois ? "a tela NÃO mudou" : "a tela mudou"}`);
    if (antes === depois) problemas.push("o toque não abriu o item: o mapa de toques está deslocado");
    await d.tecla("KEYCODE_BACK");
  }
  await d.tecla("KEYCODE_HOME");
  return problemas;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("calibrar.mjs")) {
  main(process.argv.slice(2))
    .then((problemas) => {
      if (problemas.length === 0) {
        console.log("calibração ok");
        process.exit(0);
      }
      console.log(`problemas:\n - ${problemas.join("\n - ")}`);
      process.exit(1);
    })
    .catch((e) => {
      console.log(`erro: ${e.message}`);
      process.exit(1);
    });
}
