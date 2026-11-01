/**
 * Automações que o agente sabe rodar. Cada uma é um módulo com:
 *   nome      — id em minúsculas com hífen (é o que o SaaS manda)
 *   rotulo    — nome que aparece na aba Emulador
 *   descricao — uma frase
 *   rodar(ctx) — ctx = { instancia, dispositivo, mumu, params, log }; o que
 *                devolver (objeto pequeno) aparece no SaaS como resultado.
 * Antes de rodar, o agente já abriu a instância, esperou o Android e conectou
 * o adb (ctx.dispositivo, ver lib/adb.mjs). Automação nova = arquivo novo aqui
 * + uma linha na lista; ela aparece no SaaS no próximo sync.
 */
import testeAdb from "./teste-adb.mjs";

export const TAREFAS = [testeAdb];
