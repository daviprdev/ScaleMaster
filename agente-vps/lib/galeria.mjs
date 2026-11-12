import path from "node:path";
import { esperar } from "./processo.mjs";

/**
 * Galeria do container com uma foto só: a que o agente vai usar agora.
 *
 * O Instagram escolhe a 1ª miniatura de "Recentes" (a mais nova). Antes, a foto
 * da criação ficava em /sdcard/DCIM/ScaleMaster e a do Estruturar em
 * /sdcard/Pictures/ScaleMaster; o `adb push` mantém a data do arquivo da VPS e
 * o registro da galeria (MediaStore) de fotos apagadas podia sobrar. Resultado:
 * a foto do story virava foto de perfil (12/11). Agora, a cada envio:
 *   1. apaga os arquivos das pastas do agente e as linhas delas no MediaStore;
 *   2. envia a foto e põe a data de agora (`touch`);
 *   3. pede o scan e espera o MediaStore mostrar a foto como a mais nova.
 */

export const PASTAS_DO_AGENTE = ["/sdcard/Pictures/ScaleMaster", "/sdcard/DCIM/ScaleMaster"];
const IMAGENS = "content://media/external/images/media";

/** Comando que apaga do MediaStore as linhas das pastas do agente (arquivo já apagado ou não). */
export function comandoLimparMediaStore() {
  return `content delete --uri ${IMAGENS} --where "_data LIKE '%/ScaleMaster/%'"`;
}

/** Nome do arquivo mais novo numa saída de `content query ... --projection _display_name` ordenada por data. */
export function maisNova(saida) {
  return /_display_name=([^,\s]+)/.exec(String(saida ?? ""))?.[1] ?? null;
}

/**
 * Envia `local` para `pasta` com a galeria limpa. Devolve o nome no aparelho.
 * @param {{ shell: (...a: string[]) => Promise<string>, enviar: (l: string, r: string) => Promise<void> }} d
 */
export async function fotoUnicaNaGaleria(d, local, { pasta = PASTAS_DO_AGENTE[0], log = () => {}, timeoutMs = 20_000 } = {}) {
  await d.shell(`rm -rf ${PASTAS_DO_AGENTE.join(" ")}; mkdir -p ${pasta}`);
  await d.shell(comandoLimparMediaStore()).catch((e) => log(`galeria: não limpei o MediaStore (${e.message})`));
  const nome = `sm-${Date.now()}${path.extname(local).toLowerCase()}`;
  const remoto = `${pasta}/${nome}`;
  await d.enviar(local, remoto);
  await d.shell("touch", remoto).catch(() => {});
  await d.shell("am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", `file://${remoto}`).catch(() => {});
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const saida = await d
      .shell(`content query --uri ${IMAGENS} --projection _display_name --sort "date_modified DESC"`)
      .catch(() => "");
    const nova = maisNova(saida);
    if (nova === nome) break;
    if (Date.now() > limite) {
      log(`galeria: a mais nova é ${nova ?? "nenhuma"}, não ${nome}; seguindo`);
      break;
    }
    await esperar(1000);
  }
  return nome;
}
