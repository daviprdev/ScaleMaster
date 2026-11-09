import { parseProxyLine } from "@/lib/proxy-pool";
import { gerarNascimento, gerarSenha } from "@/lib/vps/pessoa";
import type { NovaContaInput } from "./jobs";

/** Só no servidor (proxy-pool puxa undici): valida o formulário Criar instância. */

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const BIRTH_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseNovaContaInput(raw: unknown): { value: NovaContaInput } | { error: string } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const conta = body.conta && typeof body.conta === "object" ? (body.conta as Record<string, unknown>) : {};

  const proxyLine = field(body.proxy, 300);
  const proxy = proxyLine ? parseProxyLine(proxyLine) : null;
  if (!proxy) return { error: "Proxy no formato host:porta:usuário:senha." };

  const value: NovaContaInput = {
    proxy,
    conta: {
      email: field(conta.email, 100).toLowerCase(),
      senha: field(conta.senha, 100),
      nome: field(conta.nome, 60),
      usuario: field(conta.usuario, 30).replace(/^@/, ""),
      nascimento: field(conta.nascimento, 10),
    },
  };
  const c = value.conta;
  // Senha e nascimento em branco são sorteados aqui, na hora de criar (pedido do dono, 09/11):
  // senha de 14 caracteres com as quatro classes e data entre 1988 e 2007 (lib/vps/pessoa.ts).
  if (!c.senha) c.senha = gerarSenha();
  if (!c.nascimento) c.nascimento = gerarNascimento();

  if (!EMAIL_RE.test(c.email)) return { error: "Informe o Gmail da conta." };
  if (c.senha.length < 6) return { error: "A senha do Instagram precisa de pelo menos 6 caracteres." };
  if (/[^\x20-\x7E]/.test(c.senha)) return { error: "A senha não pode ter acento nem emoji (o Android não digita)." };
  if (!c.nome) return { error: "Informe o nome completo." };
  if (/[^\x20-\x7E]/.test(c.nome)) return { error: "O nome não pode ter acento nem emoji (o Android não digita)." };
  if (c.usuario && !USERNAME_RE.test(c.usuario)) {
    return { error: "Usuário do Instagram só pode ter letras, números, ponto e _ (até 30)." };
  }
  const m = BIRTH_RE.exec(c.nascimento);
  const date = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
  if (!m || !date || date.getDate() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1) {
    return { error: "Data de nascimento no formato dd/mm/aaaa." };
  }
  return { value };
}
