import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { arquivoDeEstado } from "../lib/estado.mjs";
import { esperar, rodar } from "../lib/processo.mjs";
import { acharId, acharTexto, esperarTela, tocarNo } from "./tela.mjs";

/**
 * Instala o Instagram pelo Aurora Store (já instalado e logado na instância
 * padrão). Roda ANTES da proxy: os ~275 MB descem pela internet do PC.
 * Telas mapeadas em 01/11/2026 (Aurora 4.8.4, em pt-PT): Pesquisar → digitar →
 * Enter → 1º "Instagram" → Instalar → confirmação do Android "INSTALAR".
 */

const AURORA = "com.aurora.store";
export const INSTAGRAM = "com.instagram.android";
const INSTALACAO_MAX_MS = 20 * 60_000;

/**
 * Cópia do Instagram que o Aurora instalou, guardada neste PC: a conta seguinte
 * instala dela por adb (uns 20 s) em vez de baixar os ~275 MB de novo. O
 * instalador registrado continua sendo o Aurora (-i), igual à instalação normal.
 */
const PASTA_APK = arquivoDeEstado("apk-instagram");
// decisão: depois de 7 dias a cópia vence e o Aurora baixa a versão atual.
export const APK_VALIDADE_MS = 7 * 24 * 60 * 60_000;

/** Arquivos .apk da cópia guardada, ou null se não há cópia ou ela venceu. */
export function apkGuardado(agora = Date.now(), pasta = PASTA_APK) {
  try {
    const meta = JSON.parse(readFileSync(path.join(pasta, "meta.json"), "utf8"));
    if (!(agora - Number(meta.guardadoEm) < APK_VALIDADE_MS)) return null;
    const apks = readdirSync(pasta).filter((n) => n.endsWith(".apk")).sort().map((n) => path.join(pasta, n));
    return apks.length === meta.arquivos && apks.length > 0 ? apks : null;
  } catch {
    return null;
  }
}

async function instalarDoPc(d, apks) {
  const r = await rodar(d.adb, ["-s", d.serial, "install-multiple", "-r", "-i", AURORA, ...apks], { timeoutMs: 5 * 60_000 });
  if (!/success/i.test(String(r.stdout)) || !(await d.temApp(INSTAGRAM))) throw new Error(String(r.stderr || r.stdout).trim().slice(0, 200));
}

/** Puxa os APKs instalados para o PC; falha aqui não derruba a conta. */
async function guardarApk(d, log) {
  const tmp = `${PASTA_APK}.tmp`;
  try {
    const caminhos = (await d.shell("pm", "path", INSTAGRAM)).split(/\r?\n/).map((l) => l.replace(/^package:/, "").trim()).filter(Boolean);
    if (!caminhos.length) return;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (const remoto of caminhos) {
      const r = await rodar(d.adb, ["-s", d.serial, "pull", remoto, path.join(tmp, path.posix.basename(remoto))], { timeoutMs: 5 * 60_000 });
      if (r.codigo !== 0) throw new Error(String(r.stderr || r.stdout).trim().slice(0, 200));
    }
    writeFileSync(path.join(tmp, "meta.json"), JSON.stringify({ guardadoEm: Date.now(), arquivos: caminhos.length }));
    rmSync(PASTA_APK, { recursive: true, force: true });
    renameSync(tmp, PASTA_APK);
    log("Instagram guardado no PC para as próximas contas");
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    log(`não guardei o Instagram no PC: ${e.message}`);
  }
}

export async function instalarInstagram(d, log) {
  if (await d.temApp(INSTAGRAM)) return "já estava instalado";

  const apks = apkGuardado();
  if (apks) {
    try {
      await instalarDoPc(d, apks);
      return "Instagram instalado (cópia do PC)";
    } catch (e) {
      log(`cópia do PC não instalou (${e.message}); indo pelo Aurora`);
    }
  }

  // A permissão "instalar apps desta fonte" sai por comando; sem ela o Aurora para numa tela de permissão.
  await d.shell("appops", "set", AURORA, "REQUEST_INSTALL_PACKAGES", "allow");
  await d.fecharApp(AURORA);
  await d.abrirApp(AURORA);

  const busca = await esperarTela(d, (nos) => acharTexto(nos, ["Pesquisar", "Search"], { exato: true }), {
    timeoutMs: 60_000,
    descricao: "a busca do Aurora",
  });
  await tocarNo(d, busca);
  await d.digitar("instagram");
  await d.tecla("KEYCODE_ENTER");

  // Resultado: o 1º "Instagram" abaixo da barra de busca (a barra também mostra "instagram").
  const resultado = await esperarTela(
    d,
    (nos) => nos.filter((n) => n.texto === "Instagram" && n.y > 200).sort((a, b) => a.y - b.y)[0],
    { timeoutMs: 45_000, descricao: "o Instagram na busca do Aurora" }
  );
  await tocarNo(d, resultado, 2500);

  const instalar = await esperarTela(d, (nos) => acharTexto(nos, ["Instalar", "Install"], { exato: true }), {
    timeoutMs: 45_000,
    descricao: "o botão Instalar do Aurora",
  });
  await tocarNo(d, instalar, 3000);
  log("download do Instagram começou");

  const limite = Date.now() + INSTALACAO_MAX_MS;
  while (!(await d.temApp(INSTAGRAM))) {
    if (Date.now() > limite) throw new Error("O Instagram não terminou de instalar em 20 min.");
    const nos = await d.tela().catch(() => []);
    // Confirmação do Android ("Instalar esta app?") e, se voltar, a tela de permissão do Aurora.
    const confirmar = acharId(nos, "com.android.packageinstaller:id/install_confirm_question")
      ? acharId(nos, "android:id/button1")
      : null;
    const permitir = acharTexto(nos, ["Permitir", "Allow"], { exato: true });
    if (confirmar) await tocarNo(d, confirmar, 3000);
    else if (permitir && acharTexto(nos, ["Permissão de instalação", "Install permission"])) await tocarNo(d, permitir, 3000);
    else await esperar(3000);
  }
  await d.fecharApp(AURORA);
  await guardarApk(d, log);
  return "Instagram instalado";
}
