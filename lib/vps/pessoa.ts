/**
 * Geração automática da pessoa de uma conta da VPS (só servidor): nome
 * feminino brasileiro, @, senha e data de nascimento. Tudo sem acento (o
 * Android digita por `input text`). Determinístico quando recebe `rng`.
 */

export const NOMES_FEMININOS: readonly string[] = [
  "Ana", "Beatriz", "Camila", "Daniela", "Eduarda", "Fernanda", "Gabriela", "Helena", "Isabela", "Julia",
  "Larissa", "Mariana", "Natalia", "Patricia", "Rafaela", "Sabrina", "Tatiane", "Vanessa", "Yasmin", "Amanda",
  "Bruna", "Carolina", "Debora", "Elaine", "Fabiana", "Giovanna", "Ingrid", "Jessica", "Karina", "Leticia",
  "Marcela", "Nicole", "Priscila", "Raquel", "Simone", "Tais", "Vitoria", "Alice", "Bianca", "Cristina",
  "Diana", "Elisa", "Flavia", "Graziela", "Heloisa", "Iris", "Joana", "Kelly", "Luana", "Michele",
  "Nayara", "Paula", "Renata", "Sofia", "Thais", "Valentina", "Aline", "Barbara", "Clara", "Denise",
  "Emanuelle", "Francine", "Gisele", "Isadora", "Juliana", "Lais", "Manuela", "Noemi", "Pamela", "Rebeca",
  "Silvia", "Tamires", "Viviane", "Adriana", "Brenda", "Cecilia", "Eloa", "Fatima", "Geovana", "Isis",
  "Jaqueline", "Livia", "Maitê", "Nathalia", "Pietra", "Roberta", "Sara", "Talita", "Veronica", "Agatha",
  "Catarina", "Dandara", "Emily", "Franciele", "Gloria", "Joyce", "Lorena", "Melissa", "Olivia", "Regina",
  "Stella", "Tainara", "Aurora", "Carla", "Esther", "Gabrielly", "Lara", "Marina", "Rayssa", "Suelen",
  "Andreia", "Celia", "Eliane", "Josiane", "Luiza", "Monica", "Rosana", "Vera", "Milena", "Rita",
].map(semAcento);

export const SOBRENOMES: readonly string[] = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes",
  "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa",
  "Rocha", "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas",
  "Cardoso", "Ramos", "Goncalves", "Santana", "Teixeira", "Araujo", "Correia", "Cavalcanti", "Monteiro", "Moura",
  "Pinto", "Castro", "Campos", "Azevedo", "Batista", "Barros", "Reis", "Cunha", "Melo", "Farias",
  "Medeiros", "Duarte", "Tavares", "Borges", "Rezende", "Pires", "Sales", "Macedo", "Antunes", "Aguiar",
  "Brito", "Leal", "Fonseca", "Siqueira", "Guimaraes", "Bezerra", "Coelho", "Peixoto", "Dantas", "Camargo",
  "Franco", "Lacerda", "Vasconcelos", "Nogueira", "Pacheco", "Queiroz", "Xavier", "Amaral", "Neves", "Bastos",
].map(semAcento);

export const NOME_MAX = 28;
export const USUARIO_MAX = 30;
export const SENHA_TAMANHO = 14;
export const NASCIMENTO_ANO_MIN = 1988;
export const NASCIMENTO_ANO_MAX = 2006;
export const SIMBOLOS_SENHA = "!@#$%&*.";

/** Gerador [0,1): o padrão é Math.random; os testes injetam um determinístico. */
export type Rng = () => number;

export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function inteiro(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function sortear<T>(lista: readonly T[], rng: Rng): T {
  return lista[Math.min(lista.length - 1, Math.floor(rng() * lista.length))];
}

/** Primeiro nome + 1 ou 2 sobrenomes (sorteios independentes), no máximo 28 caracteres; passou, sorteia de novo. */
export function gerarNome(rng: Rng = Math.random): string {
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const partes = [sortear(NOMES_FEMININOS, rng)];
    const quantos = inteiro(rng, 1, 2);
    for (let i = 0; i < quantos; i++) {
      const s = sortear(SOBRENOMES, rng);
      if (!partes.includes(s)) partes.push(s);
    }
    const nome = partes.join(" ");
    if (nome.length <= NOME_MAX) return nome;
  }
  return `${sortear(NOMES_FEMININOS, rng)} ${sortear(SOBRENOMES, rng)}`.slice(0, NOME_MAX).trim();
}

/** Minúsculas, sem acento, espaço vira `_`, só [a-z0-9._]. */
export function normalizarUsuario(texto: string): string {
  return semAcento(texto)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9._]/g, "");
}

const USUARIO_RE = /^[a-z][a-z0-9._]{0,29}$/;

/** Regras do @: 1–30, começa com letra, só [a-z0-9._], sem `_`/`.` no fim e sem `___`. */
export function usuarioValido(usuario: string): boolean {
  return USUARIO_RE.test(usuario) && !/[_.]$/.test(usuario) && !/___/.test(usuario) && !/\.\./.test(usuario) && usuario.length <= USUARIO_MAX;
}

const VARIANTES: ReadonlyArray<(nome: string, sobrenome: string) => string> = [
  (n, s) => `${n}_${s}`,
  (n, s) => `${n}.${s}`,
  (n, s) => `${n}${s}`,
  (n, s) => `${n}__${s}`,
];

/**
 * @ a partir do nome: uma das variantes nome_sobrenome / nome.sobrenome /
 * nomesobrenome / nome__sobrenome + 3 a 5 dígitos, até 30 caracteres (a base é
 * cortada antes dos dígitos se precisar). Não repete o que está em `usados`
 * (lote + banco); o escolhido entra em `usados`.
 */
export function gerarUsuario(nome: string, { usados = new Set<string>(), rng = Math.random }: { usados?: Set<string>; rng?: Rng } = {}): string {
  const partes = normalizarUsuario(nome).split("_").filter(Boolean);
  const primeiro = partes[0] ?? "conta";
  const sobrenome = partes[partes.length - 1] ?? "ig";
  for (let tentativa = 0; tentativa < 200; tentativa++) {
    const variante = sortear(VARIANTES, rng);
    const digitos = inteiro(rng, 3, 5) + Math.min(2, Math.floor(tentativa / 40));
    const sufixo = String(inteiro(rng, 0, 10 ** digitos - 1)).padStart(digitos, "0");
    let base = variante(primeiro, partes.length > 1 ? sobrenome : "");
    base = base.replace(/[_.]+$/, "");
    base = base.slice(0, USUARIO_MAX - sufixo.length).replace(/[_.]+$/, "");
    const usuario = `${base}${sufixo}`;
    if (!usuarioValido(usuario) || usados.has(usuario)) continue;
    usados.add(usuario);
    return usuario;
  }
  throw new Error("não consegui gerar um @ livre");
}

/**
 * @ alternativo quando o Instagram recusa o atual: tira os dígitos do fim e
 * põe mais dígitos (4 + tentativa, até 7). Mesma regra em agente-vps/lib/usuario.mjs.
 */
export function variarUsuario(atual: string, tentativa: number, rng: Rng = Math.random): string {
  const base = atual.replace(/\d+$/, "").replace(/[_.]+$/, "") || "conta";
  const digitos = Math.min(7, 4 + Math.max(0, tentativa));
  const sufixo = String(inteiro(rng, 0, 10 ** digitos - 1)).padStart(digitos, "0");
  return `${base.slice(0, USUARIO_MAX - digitos).replace(/[_.]+$/, "")}${sufixo}`;
}

const MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem I e O
const MINUSCULAS = "abcdefghijkmnopqrstuvwxyz"; // sem l
const DIGITOS = "23456789"; // sem 0 e 1

/** 14 caracteres com ao menos 1 maiúscula, 1 minúscula, 1 dígito e 1 símbolo de !@#$%&*., sem 0 O 1 l I. */
export function gerarSenha(rng: Rng = Math.random): string {
  const classes = [MAIUSCULAS, MINUSCULAS, DIGITOS, SIMBOLOS_SENHA];
  const todos = classes.join("");
  const chars = classes.map((c) => c[Math.floor(rng() * c.length)]);
  while (chars.length < SENHA_TAMANHO) chars.push(todos[Math.floor(rng() * todos.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function senhaValida(senha: string): boolean {
  return (
    senha.length === SENHA_TAMANHO &&
    /[A-Z]/.test(senha) &&
    /[a-z]/.test(senha) &&
    /\d/.test(senha) &&
    /[!@#$%&*.]/.test(senha) &&
    !/[0O1lI]/.test(senha) &&
    /^[A-Za-z0-9!@#$%&*.]+$/.test(senha)
  );
}

export function bissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

export function diasNoMes(mes: number, ano: number): number {
  return [31, bissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
}

/** dd/mm/aaaa com ano entre 1988 e 2006 e dia válido para o mês e o ano. */
export function gerarNascimento(rng: Rng = Math.random): string {
  const ano = inteiro(rng, NASCIMENTO_ANO_MIN, NASCIMENTO_ANO_MAX);
  const mes = inteiro(rng, 1, 12);
  const dia = inteiro(rng, 1, diasNoMes(mes, ano));
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

export interface Pessoa {
  nome: string;
  usuario: string;
  senha: string;
  nascimento: string;
}

export function gerarPessoa({ usados = new Set<string>(), rng = Math.random }: { usados?: Set<string>; rng?: Rng } = {}): Pessoa {
  const nome = gerarNome(rng);
  return { nome, usuario: gerarUsuario(nome, { usados, rng }), senha: gerarSenha(rng), nascimento: gerarNascimento(rng) };
}

/** "anabela2039!x" → "an••••••39": só as duas pontas aparecem no card. */
export function mascararSenha(senha: string): string {
  if (senha.length <= 4) return "•".repeat(senha.length);
  return `${senha.slice(0, 2)}••••••${senha.slice(-2)}`;
}
