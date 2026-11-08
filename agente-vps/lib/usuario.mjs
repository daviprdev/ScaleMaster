/**
 * @ alternativo quando o Instagram diz que o usuário não está disponível:
 * tira os dígitos do fim e põe mais dígitos (4 + tentativa, até 7), sempre
 * dentro de 30 caracteres. Mesma regra de lib/vps/pessoa.ts (variarUsuario).
 */
export const USUARIO_MAX = 30;

export function variarUsuario(atual, tentativa = 0, rng = Math.random) {
  const base = String(atual ?? "").replace(/\d+$/, "").replace(/[_.]+$/, "") || "conta";
  const digitos = Math.min(7, 4 + Math.max(0, Number(tentativa) || 0));
  const sufixo = String(Math.floor(rng() * 10 ** digitos)).padStart(digitos, "0").slice(-digitos);
  return `${base.slice(0, USUARIO_MAX - digitos).replace(/[_.]+$/, "")}${sufixo}`;
}
