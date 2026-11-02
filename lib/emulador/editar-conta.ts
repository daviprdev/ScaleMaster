import type { JobStep, NovaContaInput } from "./jobs";
import { parseNovaContaInput } from "./nova-conta-input";

/**
 * Editar dados de uma conta da fila (aba Emulador): o dono troca Gmail, senha,
 * nome, usuário, nascimento ou proxy e a conta volta para a fila. Só no
 * servidor (parseNovaContaInput puxa o leitor de proxy).
 */

/** O que a tela recebe para preencher o formulário. Senha e credenciais da proxy não voltam ao navegador. */
export interface EditableConta {
  email: string;
  nome: string;
  usuario: string;
  nascimento: string;
  /** host:porta da proxy atual, só para mostrar. */
  proxyHost: string;
}

export function editableFrom(input: NovaContaInput): EditableConta {
  let proxyHost = "";
  try {
    const u = new URL(input.proxy);
    proxyHost = `${u.hostname}:${u.port}`;
  } catch {
    /* proxy ilegível: o campo fica vazio */
  }
  const c = input.conta;
  return { email: c.email, nome: c.nome, usuario: c.usuario, nascimento: c.nascimento, proxyHost };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Junta o que veio do formulário com os dados atuais. Senha e proxy em branco = manter. */
export function mergeEdit(current: NovaContaInput, raw: unknown): { value: NovaContaInput } | { error: string } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const conta = body.conta && typeof body.conta === "object" ? (body.conta as Record<string, unknown>) : {};
  return parseNovaContaInput({
    proxy: text(body.proxy) || current.proxy,
    conta: {
      email: text(conta.email),
      senha: text(conta.senha) || current.conta.senha,
      nome: text(conta.nome),
      usuario: text(conta.usuario),
      nascimento: text(conta.nascimento),
    },
  });
}

const CAMPOS_CONTA = ["email", "senha", "nome", "usuario", "nascimento"] as const;

function nomeBase(c: NovaContaInput["conta"]): string {
  return c.usuario || c.email.split("@")[0];
}

/**
 * Etapas que continuam valendo depois da edição (as outras rodam de novo):
 * proxy nova → refaz a proxy; qualquer mudança na conta ou na proxy → limpa o
 * Instagram e refaz o cadastro do zero (e o aquecimento, que é da conta nova);
 * @ ou Gmail novo → renomeia a instância.
 * Sem mudança nenhuma é igual ao Continuar.
 */
export function stepsAfterEdit(steps: readonly JobStep[], before: NovaContaInput, after: NovaContaInput): JobStep[] {
  const proxyMudou = before.proxy !== after.proxy;
  const contaMudou = proxyMudou || CAMPOS_CONTA.some((k) => before.conta[k] !== after.conta[k]);
  const refazer = new Set<string>();
  if (proxyMudou) refazer.add("proxy");
  if (contaMudou) {
    refazer.add("limpar");
    refazer.add("cadastro");
    refazer.add("seguir");
    refazer.add("reels");
  }
  if (nomeBase(before.conta) !== nomeBase(after.conta)) refazer.add("nome");
  return steps.filter((s) => s.status === "done" && !refazer.has(s.key));
}
