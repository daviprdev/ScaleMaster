import path from "node:path";
import { fileURLToPath } from "node:url";
import { rodar, trecho } from "../lib/processo.mjs";

/**
 * Botão "Rebuild imagem" da aba Contas VPS: roda scripts/vps/golden.sh
 * (puxa a imagem do redroid, sobe a base, instala o APK, extrai os build.prop
 * e grava o volume scalemaster-base). Roda na "instância" -1, sem container.
 */
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "vps", "golden.sh");

export default {
  nome: "rebuild-imagem",
  rotulo: "Refazer a imagem base",
  descricao: "Roda scripts/vps/golden.sh: base nova com o APK mais recente de /opt/scalemaster/apks.",
  semInstancia: true,

  async rodar({ log }) {
    log("golden.sh começou");
    const r = await rodar("bash", [SCRIPT], { timeoutMs: 30 * 60_000 });
    for (const linha of String(r.stdout ?? "").split(/\r?\n/).filter(Boolean).slice(-15)) log(linha);
    if (r.codigo !== 0) throw new Error(`golden.sh falhou (${r.codigo}): ${trecho(r.stderr || r.stdout, 400)}`);
    const resumo = /RESUMO:\s*(.*)$/m.exec(String(r.stdout ?? ""))?.[1] ?? "ok";
    return { resultado: resumo };
  },
};
