import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esperar } from "../lib/processo.mjs";
import { INSTAGRAM } from "./aurora.mjs";
import { acharId, acharTexto, preencher, temTexto, tocarNo } from "./tela.mjs";

/**
 * Cria a conta no Instagram com o Gmail, já com a proxy ligada.
 *
 * Em vez de uma sequência fixa, olha a tela a cada volta e reage pelo título
 * (o Instagram muda a ordem das telas e a língua: a instância está em pt-PT e
 * às vezes ele cai para inglês). Telas conhecidas até o e-mail foram vistas em
 * 01/11/2026; as seguintes seguem o cadastro padrão do Instagram e ainda serão
 * confirmadas na primeira conta real.
 *
 * Quando precisa do dono: o código que chega no Gmail (pergunta "codigo") e
 * qualquer tela desconhecida, captcha ou checkpoint (pergunta "manual": ele
 * resolve na instância e manda continuar). Cada tela desconhecida é salva em
 * agente-mumu/telas/ para virar automação depois.
 */

const PASTA_TELAS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "telas");
const ig = (nome) => `${INSTAGRAM}:id/${nome}`;

const SEGUINTE = ["Seguinte", "Next", "Avançar", "Continuar", "Continue"];
const PULAR = ["Ignorar", "Skip", "Pular", "Agora não", "Not now", "Não permitir", "Don't allow", "Don’t allow"];
const MESES = {
  pt: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
  en: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
};
const TEMPO_MAX_MS = 45 * 60_000;

/**
 * Campo de digitar: o nó clicável cuja descrição começa com o rótulo ("E-mail,");
 * senão um que contenha o rótulo sem ser botão ("Campo de introdução do código" —
 * o botão "Não recebi o código" fica de fora); senão o 1º EditText.
 */
function campoPor(nos, rotulos) {
  const desc = (n) => n.descricao.toLowerCase();
  for (const rotulo of rotulos) {
    const no = nos.find((n) => n.clicavel && desc(n).startsWith(rotulo.toLowerCase()));
    if (no) return no;
  }
  for (const rotulo of rotulos) {
    const no = nos.find((n) => n.clicavel && !/Button/.test(n.classe) && desc(n).includes(rotulo.toLowerCase()));
    if (no) return no;
  }
  return nos.find((n) => /EditText/.test(n.classe)) ?? null;
}

function botao(nos, textos) {
  return acharTexto(nos, textos, { exato: true });
}

async function seguinte(d, nos) {
  const b = botao(nos, SEGUINTE);
  if (!b) throw new Error("Não achei o botão Seguinte.");
  await tocarNo(d, b, 3000);
}

function salvarTela(nos, motivo) {
  try {
    mkdirSync(PASTA_TELAS, { recursive: true });
    const linhas = nos
      .filter((n) => n.texto || n.descricao || n.id)
      .map((n) => `${n.texto || "(desc) " + n.descricao} @${n.x},${n.y} ${n.clicavel ? "[clic] " : ""}${n.classe} ${n.id}`);
    const arquivo = path.join(PASTA_TELAS, `${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);
    writeFileSync(arquivo, `${motivo}\n\n${linhas.join("\n")}\n`);
  } catch {
    /* sem pasta: só não guarda */
  }
}

function resumoTela(nos) {
  return nos
    .map((n) => n.texto || n.descricao)
    .filter((t) => t && t.length < 80)
    .slice(0, 5)
    .join(" | ");
}

/** Data de nascimento: campo de texto, ou o seletor de rolar do Android (dia/mês/ano). */
async function preencherNascimento(d, nos, nascimento) {
  const [dia, mes, ano] = nascimento.split("/").map(Number);
  const texto = nos.find((n) => /EditText/.test(n.classe));
  if (texto) {
    await preencher(d, texto, nascimento);
    return true;
  }
  const campo = campoPor(nos, ["Data de nascimento", "Birthday", "Aniversário", "Data de aniversário"]);
  if (!campo) return false;
  await tocarNo(d, campo, 1500);

  const rodas = (await d.tela()).filter((n) => n.id === "android:id/numberpicker_input").sort((a, b) => a.x - b.x);
  if (rodas.length !== 3) return false;
  for (const roda of rodas) {
    const atual = roda.texto.toLowerCase().replace(/\./g, "");
    let valor;
    if (/^\d{4}$/.test(atual)) valor = String(ano);
    else if (/^\d{1,2}$/.test(atual)) valor = String(dia);
    else {
      const lingua = MESES.pt.includes(atual.slice(0, 3)) ? "pt" : "en";
      valor = MESES[lingua][mes - 1];
    }
    await preencher(d, roda, valor);
  }
  const ok = acharId(await d.tela(), "android:id/button1");
  if (!ok) return false;
  await tocarNo(d, ok, 1500);
  return true;
}

/**
 * ctx = { d, conta, perguntar(tipo, texto) → Promise<resposta>, log }.
 * Devolve a mensagem final ("conta criada (@usuario)").
 */
export async function cadastrarInstagram({ d, conta, perguntar, log }) {
  const estado = { errosIdioma: 0, termosAceitos: false, usuarioFinal: conta.usuario || null, ultima: null, repeticoes: 0, desconhecidas: 0 };
  const manual = async (texto, nos) => {
    if (nos) salvarTela(nos, texto);
    log(`esperando você: ${texto}`);
    await perguntar("manual", `${texto} Resolva na instância e clique em "Já resolvi, continuar".`);
    estado.repeticoes = 0;
    estado.desconhecidas = 0;
  };

  const telas = [
    {
      nome: "carregando-idioma",
      teste: (nos) => acharId(nos, ig("language_pack_loading_message")),
      agir: () => esperar(3000),
    },
    {
      // Pacote de idioma pela proxy às vezes falha: tenta de novo uma vez, depois segue em inglês.
      nome: "erro-idioma",
      teste: (nos) => acharId(nos, ig("language_pack_loading_failed_message")),
      agir: async (nos) => {
        estado.errosIdioma += 1;
        const alvo = estado.errosIdioma <= 1 ? acharId(nos, ig("retry_button")) : acharId(nos, ig("use_english_button"));
        await tocarNo(d, alvo, 10_000);
      },
    },
    {
      nome: "verificacao",
      teste: (nos) =>
        temTexto(nos, ["Confirma que és tu", "Confirm it's you", "Confirme que é você", "reCAPTCHA", "não és um robô", "not a robot", "Ajuda-nos a confirmar", "Help us confirm", "suspendemos", "suspended"]),
      agir: (nos) => manual(`O Instagram pediu uma verificação (${resumoTela(nos)}).`, nos),
    },
    {
      nome: "codigo",
      teste: (nos) => temTexto(nos, ["código de confirmação", "confirmation code", "Introduz o código", "Insira o código", "Enter the code"]),
      agir: async (nos) => {
        const recusado = temTexto(nos, ["não é válido", "isn't valid", "inválido", "incorreto", "incorrect", "expirou", "expired"]);
        const codigo = await perguntar(
          "codigo",
          recusado
            ? `O Instagram não aceitou o código. Confira o último e-mail em ${conta.email} e digite de novo.`
            : `Digite o código que o Instagram mandou para ${conta.email}.`
        );
        const atual = await d.tela();
        const campo = campoPor(atual, ["Código", "Code", "Confirmation code", "Código de confirmação"]);
        if (!campo) throw new Error("Não achei o campo do código.");
        await preencher(d, campo, codigo.replace(/\D/g, ""));
        await seguinte(d, await d.tela());
      },
    },
    {
      nome: "email",
      teste: (nos) => temTexto(nos, ["Qual é o teu e-mail", "What's your email", "Qual é o seu email", "Qual é o seu e-mail"]),
      agir: async (nos) => {
        if (temTexto(nos, ["já está a ser utilizado", "já está sendo usado", "already", "já tem uma conta", "já existe"])) {
          throw new Error(`O Instagram diz que ${conta.email} já tem conta.`);
        }
        const campo = campoPor(nos, ["E-mail", "Email"]);
        if (!campo) throw new Error("Não achei o campo do e-mail.");
        await preencher(d, campo, conta.email);
        await seguinte(d, await d.tela());
      },
    },
    {
      nome: "telefone",
      teste: (nos) => botao(nos, ["Registar com e-mail", "Sign up with email", "Cadastrar-se com o email", "Cadastre-se com o email", "Cadastrar com email"]),
      agir: async (nos, alvo) => tocarNo(d, alvo, 3000),
    },
    {
      nome: "senha",
      teste: (nos) => temTexto(nos, ["Criar uma palavra-passe", "Cria uma palavra-passe", "Create a password", "Crie uma senha", "Criar uma senha"]),
      agir: async (nos) => {
        const campo = campoPor(nos, ["Palavra-passe", "Password", "Senha"]);
        if (!campo) throw new Error("Não achei o campo da senha.");
        await preencher(d, campo, conta.senha);
        await seguinte(d, await d.tela());
      },
    },
    {
      nome: "salvar-login",
      teste: (nos) =>
        temTexto(nos, ["Guardar as tuas informações", "Save your login info", "Salvar suas informações", "Guardar informações de início"]) &&
        botao(nos, ["Guardar", "Save", "Salvar"]),
      agir: async (nos, alvo) => tocarNo(d, alvo, 3000),
    },
    {
      nome: "nascimento",
      teste: (nos) => temTexto(nos, ["data de nascimento", "birthday", "aniversário"]),
      agir: async (nos) => {
        if (!(await preencherNascimento(d, nos, conta.nascimento))) {
          await manual(`Não consegui preencher a data de nascimento (${conta.nascimento}).`, nos);
          return;
        }
        await seguinte(d, await d.tela());
      },
    },
    {
      nome: "nome",
      teste: (nos) => temTexto(nos, ["Qual é o teu nome", "What's your name", "Qual é o seu nome"]),
      agir: async (nos) => {
        const campo = campoPor(nos, ["Nome completo", "Full name", "Nome"]);
        if (!campo) throw new Error("Não achei o campo do nome.");
        await preencher(d, campo, conta.nome);
        await seguinte(d, await d.tela());
      },
    },
    {
      nome: "usuario",
      teste: (nos) => temTexto(nos, ["Criar um nome de utilizador", "Cria um nome de utilizador", "Create a username", "Crie um nome de usuário", "Criar um nome de usuário"]),
      agir: async (nos) => {
        const campo = campoPor(nos, ["Nome de utilizador", "Username", "Nome de usuário"]);
        if (conta.usuario && campo) {
          await preencher(d, campo, conta.usuario);
          await esperar(2500);
          const depois = await d.tela();
          if (temTexto(depois, ["não está disponível", "isn't available", "is not available", "indisponível"])) {
            await manual(`O usuário @${conta.usuario} não está livre: escolha outro.`, depois);
          }
        }
        const atual = await d.tela();
        const final = campoPor(atual, ["Nome de utilizador", "Username", "Nome de usuário"]);
        if (final?.texto && !final.texto.includes(" ")) estado.usuarioFinal = final.texto.replace(/^@/, "");
        await seguinte(d, atual);
      },
    },
    {
      nome: "termos",
      teste: (nos) =>
        temTexto(nos, ["termos e políticas", "terms and policies", "Termos e Políticas", "termos e as políticas"]) &&
        botao(nos, ["Concordo", "I agree", "Aceito", "Concordar", "Aceitar"]),
      agir: async (nos, alvo) => {
        await tocarNo(d, alvo, 5000);
        estado.termosAceitos = true;
      },
    },
    {
      nome: "login",
      teste: (nos) => botao(nos, ["Criar conta nova", "Create new account", "Criar nova conta"]),
      agir: async (nos, alvo) => tocarNo(d, alvo, 4000),
    },
    {
      nome: "pular",
      teste: (nos) => botao(nos, PULAR),
      agir: async (nos, alvo) => tocarNo(d, alvo, 3000),
    },
  ];

  const ehInicio = (nos) =>
    temTexto(nos, ["Página inicial", "Home", "Início"], { exato: true }) &&
    temTexto(nos, ["Pesquisar e explorar", "Search and explore", "Explorar", "Reels"]);

  await d.abrirApp(INSTAGRAM);
  await esperar(6000);
  const limite = Date.now() + TEMPO_MAX_MS;

  while (Date.now() < limite) {
    const nos = await d.tela().catch(() => []);
    if (ehInicio(nos)) {
      log("chegou no início do Instagram");
      return `conta criada${estado.usuarioFinal ? ` (@${estado.usuarioFinal})` : ""}`;
    }

    let tratou = false;
    for (const tela of telas) {
      const alvo = tela.teste(nos);
      if (!alvo) continue;
      tratou = true;
      estado.repeticoes = estado.ultima === tela.nome ? estado.repeticoes + 1 : 0;
      estado.ultima = tela.nome;
      estado.desconhecidas = 0;
      if (estado.repeticoes >= 4 && tela.nome !== "carregando-idioma") {
        await manual(`A tela "${tela.nome}" não avançou (${resumoTela(nos)}).`, nos);
        break;
      }
      log(`tela: ${tela.nome}`);
      await tela.agir(nos, alvo);
      break;
    }
    if (tratou) continue;

    // Fora do Instagram (ele fecha ao trocar de língua) e sem diálogo do sistema: abre de novo.
    const doInstagram = nos.some((n) => n.pacote === INSTAGRAM);
    const doSistema = nos.some((n) => /permissioncontroller|packageinstaller|vpndialogs/.test(n.pacote));
    if (!doInstagram && !doSistema) {
      await d.abrirApp(INSTAGRAM);
      await esperar(6000);
      continue;
    }

    estado.desconhecidas += 1;
    if (estado.desconhecidas < 3) {
      await esperar(2500);
      continue;
    }
    // Depois dos termos, as telas de boas-vindas costumam só pedir "Seguinte".
    const proximo = estado.termosAceitos ? botao(nos, SEGUINTE) : null;
    if (proximo) {
      await tocarNo(d, proximo, 3000);
      estado.desconhecidas = 0;
      continue;
    }
    await manual(`Tela que eu ainda não conheço: ${resumoTela(nos) || "sem texto"}.`, nos);
  }
  throw new Error("O cadastro passou de 45 min sem terminar.");
}
