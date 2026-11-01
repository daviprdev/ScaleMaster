import { esperar } from "../lib/processo.mjs";
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

export async function instalarInstagram(d, log) {
  if (await d.temApp(INSTAGRAM)) return "já estava instalado";

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
    else await esperar(5000);
  }
  await d.fecharApp(AURORA);
  return "Instagram instalado";
}
