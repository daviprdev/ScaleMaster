/**
 * Automações que o agente da VPS sabe rodar (mesmo contrato do agente do MuMu):
 *   nome, rotulo, descricao, rodar(ctx) — ctx = { instancia, dispositivo, mumu, params, log }.
 * "rebuild-imagem" roda na "instância" -1 (a VPS em si): refaz o container base.
 */
import rebuildImagem from "./rebuild-imagem.mjs";
import testeAdb from "./teste-adb.mjs";

export const TAREFAS = [testeAdb, rebuildImagem];
