import { resolver as resolverCaptcha, tocarPontos } from "../lib/captcha.mjs";
import { esperar } from "../lib/processo.mjs";
import { INSTAGRAM } from "./apk.mjs";
import { criarCaixa } from "./caixa.mjs";
import { criarAjuda, resumoTela, salvarTela } from "./dono.mjs";
import { acharId, acharTexto, preencher, temTexto, tocarNo } from "./tela.mjs";

/**
 * Cria a conta no Instagram com o e-mail, já com a proxy ligada. Cópia
 * adaptada de agente-mumu/fluxos/cadastro.mjs para a VPS: o código de
 * confirmação é lido na caixa de e-mail por IMAP (lib/imap.mjs) antes de
 * perguntar ao dono, e o captcha de imagem vai para o Capsolver
 * (lib/captcha.mjs) antes de encerrar com o aviso.
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

/** Avisos em vermelho na linha da instância (iguais aos ALERTA_* de lib/emulador/jobs.ts). */
export const ALERTA_TELEFONE = "Conta ERRO CRIAÇÃO, verificar com numero telefone";
export const ALERTA_CAPTCHA = "Conta ERRO CRIAÇÃO, verificar captcha";
/** Captcha/verificação de humano que a automação não resolve: encerra a conta e a aba mostra isto em vermelho (pedido do dono, 08/11). */
export const ALERTA_ROBO = "Confirme que você não é um robô";

/**
 * O Instagram travou a conta nova numa tela que a automação não resolve
 * (telefone, código da imagem): a etapa encerra e a instância fica marcada com
 * `alerta` (pedido do dono).
 */
export class ContaTravada extends Error {
  constructor(alerta, motivo) {
    super(motivo);
    this.name = "ContaTravada";
    this.alerta = alerta;
  }
}

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

function ehTelaEmail(nos) {
  return !ehTelaCodigo(nos) && temTexto(nos, ["Qual é o teu e-mail", "What's your email", "Qual é o seu email", "Qual é o seu e-mail", "Qual é seu email", "Qual é seu e-mail"]);
}

function ehTelaCodigo(nos) {
  return temTexto(nos, ["código de confirmação", "confirmation code", "Introduz o código", "Insira o código", "Enter the code", "Digite o código", "Insira o código que enviamos"]);
}

function botao(nos, textos) {
  return acharTexto(nos, textos, { exato: true });
}

async function seguinte(d, nos) {
  const b = botao(nos, SEGUINTE);
  if (!b) throw new Error("Não achei o botão Seguinte.");
  await tocarNo(d, b, 3000);
}

/** Data de nascimento: campo de texto, ou o seletor de rolar do Android (dia/mês/ano). */
/** As três rodas do DatePicker (dia, mês, ano) pela posição horizontal; null se o diálogo não está aberto. */
export function rodasDoPicker(nos) {
  const rodas = nos.filter((n) => n.id === "android:id/numberpicker_input").sort((a, b) => a.x - b.x);
  return rodas.length === 3 ? rodas : null;
}

export function valorDaRoda(roda, { dia, mes, ano }) {
  const atual = roda.texto.toLowerCase().replace(/\./g, "").trim();
  if (/^\d{4}$/.test(atual)) return { atual: Number(atual), alvo: ano, tipo: "ano" };
  if (/^\d{1,2}$/.test(atual)) return { atual: Number(atual), alvo: dia, tipo: "dia" };
  const lingua = MESES.pt.includes(atual.slice(0, 3)) ? "pt" : "en";
  const i = MESES[lingua].indexOf(atual.slice(0, 3));
  return { atual: i < 0 ? null : i + 1, alvo: mes, tipo: "mes" };
}

/**
 * Gira uma roda do DatePicker tocando no item de cima (valor anterior) ou de
 * baixo (próximo) até bater: digitar no numberpicker_input não fixa o valor
 * (ig-2, 08/11: a data ficou em "hoje" e o Instagram devolveu "informações
 * incorretas"). Lê a tela de novo a cada volta.
 */
export async function girarRoda(d, indice, data) {
  for (let volta = 0; volta < 6; volta++) {
    const nos = await d.tela();
    const rodas = rodasDoPicker(nos);
    if (!rodas) return false;
    const roda = rodas[indice];
    const { atual, alvo, tipo } = valorDaRoda(roda, data);
    if (atual === alvo) return true;
    if (atual === null) return false;
    const botoes = nos.filter((n) => /Button/.test(n.classe) && Math.abs(n.x - roda.x) < 12 && n.y !== roda.y);
    const acima = botoes.filter((n) => n.y < roda.y).sort((a, b) => b.y - a.y)[0];
    const abaixo = botoes.filter((n) => n.y > roda.y).sort((a, b) => a.y - b.y)[0];
    let passos = alvo - atual;
    if (tipo === "mes" && Math.abs(passos) > 6) passos -= Math.sign(passos) * 12;
    const botao = passos > 0 ? abaixo : acima;
    if (!botao) return false;
    for (let i = 0; i < Math.min(Math.abs(passos), 80); i++) {
      await d.tocar(botao.x, botao.y);
      await esperar(220);
    }
    await esperar(600);
  }
  return false;
}

export async function preencherNascimento(d, nos, nascimento) {
  const [dia, mes, ano] = nascimento.split("/").map(Number);
  const data = { dia, mes, ano };
  const texto = nos.find((n) => /EditText/.test(n.classe) && n.id !== "android:id/numberpicker_input");
  if (texto && !rodasDoPicker(nos)) {
    await preencher(d, texto, nascimento);
    return true;
  }
  if (!rodasDoPicker(nos)) {
    const campo = campoPor(nos, ["Data de nascimento", "Birthday", "Aniversário", "Data de aniversário"]);
    if (!campo) return false;
    await tocarNo(d, campo, 1500);
    if (!rodasDoPicker(await d.tela())) return false;
  }
  for (const indice of [2, 1, 0]) {
    if (!(await girarRoda(d, indice, data))) return false;
  }
  const ok = acharId(await d.tela(), "android:id/button1");
  if (!ok) return false;
  await tocarNo(d, ok, 1500);
  return true;
}

/**
 * ctx = { d, conta, perguntar(tipo, texto) → Promise<resposta>, log, caixa?, imap?, desde? }.
 * caixa = a caixa de e-mail da conta (fluxos/caixa.mjs: IMAP, portal, mail.tm
 * ou manual); sem `caixa`, imap = { host, porta, usuario, senha } monta uma
 * caixa IMAP (compatível). desde = quando o cadastro começou (só e-mails depois
 * disso valem). Devolve a mensagem final ("conta criada (@usuario)").
 */
export async function cadastrarInstagram({ d, conta, perguntar, log, caixa = null, imap = null, desde = Date.now() }) {
  const estado = { errosIdioma: 0, termosAceitos: false, usuarioFinal: conta.usuario || null, ultima: null, repeticoes: 0, desconhecidas: 0, toquesSugestoes: 0, codigosImap: 0, captchas: 0 };
  const mail = caixa ?? criarCaixa({ provedorEmail: "imap", conta, imap: imap ?? {} }, { log });
  // O endereço de verdade (no portal só existe depois de abrir a sessão); até lá, o que veio no input.
  const enderecoAtual = () => mail.email || conta.email;
  try {
    return await rodarCadastro({ d, conta, perguntar, log, mail, enderecoAtual, estado, desde });
  } finally {
    // Sessão do portal/browser fechada sempre, inclusive em erro.
    await mail.fechar().catch(() => {});
  }
}

async function rodarCadastro({ d, conta, perguntar, log, mail, enderecoAtual, estado, desde }) {
  // Pergunta vigiando a tela: o dono pode resolver direto na instância (ver dono.mjs).
  const ajuda = criarAjuda({ d, perguntar, log });
  const { perguntarVigiando } = ajuda;
  const manual = async (texto, nos) => {
    await ajuda.manual(texto, nos);
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
      // O captcha "Confirma que és uma pessoa" (imagens) vai para o Capsolver até 3 vezes; tipo
      // que ele não resolve vira pedido manual; esgotou, encerra com o aviso em vermelho
      // (ALERTA_CAPTCHA), como no MuMu. Antes do "codigo" ("Enter the code…").
      nome: "verificacao-pessoa",
      teste: (nos) =>
        temTexto(nos, ["Confirma que és uma pessoa", "Confirm you're a person", "Confirm that you're a person", "Confirme que você é uma pessoa"]),
      agir: async (nos) => {
        estado.captchas += 1;
        if (estado.captchas > 3) {
          salvarTela(nos, "captcha: confirma que és uma pessoa (3 tentativas)");
          throw new ContaTravada(ALERTA_ROBO, "O Instagram pediu o código da imagem (captcha) e o Capsolver não passou em 3 tentativas.");
        }
        const instrucao = resumoTela(nos);
        // resolver nunca lança: null = sem chave, tipo que ele não resolve, erro ou timeout.
        const pontos = await resolverCaptcha(await d.print(), { instrucao, log });
        if (!pontos) {
          // decisão: sem Capsolver a conta encerra na hora (container desligado) e a aba mostra o aviso em vermelho; nada fica esperando o dono.
          salvarTela(nos, "captcha sem solução automática");
          throw new ContaTravada(ALERTA_ROBO, `O Instagram pediu um captcha que a automação não resolve (${instrucao}).`);
        }
        log(`captcha: ${pontos.length} toque(s) do Capsolver`);
        await tocarPontos(d, pontos);
        const depois = await d.tela();
        const confirmar = botao(depois, ["Verificar", "Verify", "Confirmar", "Confirm", "Enviar", "Submit", ...SEGUINTE]);
        if (confirmar) await tocarNo(d, confirmar, 4000);
      },
    },
    {
      nome: "verificacao",
      teste: (nos) =>
        temTexto(nos, ["Confirma que és tu", "Confirm it's you", "Confirme que é você", "reCAPTCHA", "não és um robô", "not a robot", "Ajuda-nos a confirmar", "Help us confirm", "suspendemos", "suspended"]),
      agir: (nos) => {
        salvarTela(nos, "verificação de humano/checkpoint");
        throw new ContaTravada(ALERTA_ROBO, `O Instagram pediu uma verificação (${resumoTela(nos)}).`);
      },
    },
    {
      // Depois dos termos o Instagram pode travar a conta nova até confirmar um telefone (sem "Ignorar").
      nome: "verificacao-telefone",
      teste: (nos) =>
        temTexto(nos, ["Insere o teu número de telemóvel", "Enter your mobile number", "Insira seu número de celular", "Insira o seu número de celular"]) &&
        temTexto(nos, ["SMS", "WhatsApp"]),
      agir: (nos) => {
        salvarTela(nos, "verificação por telefone");
        throw new ContaTravada(ALERTA_TELEFONE, "O Instagram pediu um número de telefone para confirmar a conta.");
      },
    },
    {
      nome: "codigo",
      teste: (nos) => ehTelaCodigo(nos),
      agir: async (nos) => {
        const recusado = temTexto(nos, ["não é válido", "isn't valid", "inválido", "incorreto", "incorrect", "expirou", "expired"]);
        // Primeiro a caixa de e-mail (IMAP/portal/mail.tm, até 2 tentativas); só sem código lá a aba pergunta ao dono.
        let codigo = null;
        if (estado.codigosImap < 2 && !recusado) {
          estado.codigosImap += 1;
          // Enquanto espera a caixa, vigia a tela: se o código já foi aceito (a tela passou), para de esperar.
          const controle = new AbortController();
          let saiu = false;
          const vigia = (async () => {
            while (!controle.signal.aborted) {
              await esperar(3000);
              const agora = await d.tela().catch(() => null);
              if (agora && agora.length > 0 && !ehTelaCodigo(agora)) {
                saiu = true;
                controle.abort();
              }
            }
          })();
          try {
            codigo = await Promise.race([
              mail.esperarCodigo({ desde, sinal: controle.signal }),
              new Promise((resolve) => controle.signal.addEventListener("abort", () => resolve(null), { once: true })),
            ]).catch((e) => {
              log(`caixa (${mail.provedor}) falhou: ${e.message}`);
              return null;
            });
          } finally {
            controle.abort();
            await vigia;
          }
          if (saiu) {
            log("a tela do código já passou: seguindo");
            return;
          }
          if (!codigo && mail.provedor !== "manual") log(`código não veio da caixa (${mail.provedor}): perguntando na aba`);
        }
        if (!codigo) {
          codigo = await perguntarVigiando(
            "codigo",
            recusado
              ? `O Instagram não aceitou o código. Confira o último e-mail em ${enderecoAtual()} e digite de novo.`
              : `Digite o código que o Instagram mandou para ${enderecoAtual()}.`,
            (agora) => ehTelaCodigo(agora)
          );
        }
        if (codigo === null) {
          log("código digitado direto na instância: seguindo");
          return;
        }
        const atual = await d.tela();
        const campo = campoPor(atual, ["Código", "Code", "Confirmation code", "Código de confirmação"]);
        if (!campo) throw new Error("Não achei o campo do código.");
        await preencher(d, campo, codigo.replace(/\D/g, ""));
        // Com o código completo o Instagram às vezes confirma sozinho e já sai da tela (giuliaboschin_934,
        // 02/11: "Não achei o botão Seguinte"). Só toca em Seguinte se ainda estiver no código.
        await esperar(2500);
        const depois = await d.tela();
        const proximo = ehTelaCodigo(depois) ? botao(depois, SEGUINTE) : null;
        if (proximo) await tocarNo(d, proximo, 3000);
      },
    },
    {
      nome: "email",
      teste: (nos) => ehTelaEmail(nos),
      agir: async (nos) => {
        if (temTexto(nos, ["já está a ser utilizado", "já está sendo usado", "already", "já tem uma conta", "já existe"])) {
          throw new Error(`O Instagram diz que ${enderecoAtual()} já tem conta.`);
        }
        const campo = campoPor(nos, ["E-mail", "Email"]);
        if (!campo) throw new Error("Não achei o campo do e-mail.");
        // No portal a sessão de 20 min abre aqui, na hora de digitar; a caixa devolve null se o portal falhou.
        let endereco = await mail.endereco();
        if (!endereco) {
          endereco = await perguntarVigiando(
            "codigo",
            `A caixa de e-mail (${mail.provedor}) não respondeu. Abra o portal, pegue o endereço e digite-o aqui (ou preencha o e-mail direto na instância).`,
            (agora) => !!campoPor(agora, ["E-mail", "Email"])
          );
          if (endereco === null) {
            log("e-mail digitado direto na instância: seguindo");
            return;
          }
          endereco = String(endereco).trim().toLowerCase();
        }
        // A sessão do portal pode ter levado segundos: confere que ainda é a tela do e-mail antes de digitar
        // (senão o endereço iria para o campo do código — ig-2, 08/11).
        const agora = await d.tela();
        if (!ehTelaEmail(agora)) return;
        const campoAgora = campoPor(agora, ["E-mail", "Email"]) ?? campo;
        await preencher(d, campoAgora, endereco);
        await seguinte(d, await d.tela());
        // O Instagram manda o código e troca de tela em 3–15 s pela proxy: espera sair da tela do e-mail.
        for (let i = 0; i < 10 && ehTelaEmail(await d.tela().catch(() => [])); i++) await esperar(2000);
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
      nome: "picker-data",
      teste: (nos) => !!rodasDoPicker(nos),
      agir: async (nos) => {
        if (!(await preencherNascimento(d, nos, conta.nascimento))) {
          await manual(`Não consegui girar o seletor de data (${conta.nascimento}).`, nos);
          return;
        }
        await seguinte(d, await d.tela());
      },
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
      teste: (nos) => temTexto(nos, ["Como te chamas", "Qual é o teu nome", "What's your name", "Qual é o seu nome", "Qual é seu nome", "Como você se chama"]),
      agir: async (nos) => {
        const campo = campoPor(nos, ["Nome completo", "Full name", "Nome"]);
        if (!campo) throw new Error("Não achei o campo do nome.");
        await preencher(d, campo, conta.nome);
        await seguinte(d, await d.tela());
      },
    },
    {
      // Login puro ("Nome de usuário, email ou celular" + Entrar + Esqueceu a senha?) sem o botão de criar
      // conta: o Instagram caiu aqui ao religar o container (ig-2, 08/11). Voltar leva à tela de boas-vindas.
      nome: "login-sem-criar",
      teste: (nos) =>
        temTexto(nos, ["Esqueceu a senha?", "Forgot password?", "Esqueceste-te da palavra-passe?"]) &&
        botao(nos, ["Entrar", "Log in", "Iniciar sessão"]) &&
        !botao(nos, ["Criar conta nova", "Create new account", "Criar nova conta"]),
      agir: async () => {
        await d.tecla("KEYCODE_BACK");
        await esperar(2500);
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
      // Outra abertura do Instagram novo (vista em 01/11): "Aderir ao Instagram" → Começar.
      nome: "abertura",
      teste: (nos) =>
        temTexto(nos, ["Aderir ao Instagram", "Join Instagram", "Entrar no Instagram", "Junte-se ao Instagram"]) &&
        botao(nos, ["Começar", "Get started", "Comece agora"]),
      agir: async (nos, alvo) => tocarNo(d, alvo, 4000),
    },
    {
      // O Ignorar abaixo abre esta confirmação ("Queres encontrar amigos mais depressa?"): "Não, ignorar".
      // Antes ela não era reconhecida e o pular tocava de novo no Ignorar do fundo, fechando a caixa.
      // Vem antes: o texto dela também fala em "sugestões de amizade".
      nome: "confirmar-ignorar-amigos",
      teste: (nos) =>
        temTexto(nos, ["encontrar amigos mais depressa", "find friends faster", "find your friends faster"]) &&
        botao(nos, ["Não, ignorar", "No, skip", "Não, pular", "Não, ignore"]),
      agir: async (nos, alvo) => tocarNo(d, alvo, 3000),
    },
    {
      // "Segue 5 ou mais pessoas" (lista de sugestões para seguir): o dono pediu Ignorar, no canto de cima
      // (o Seguir de baixo seguiria a lista toda). A lista demora a carregar; o Ignorar já vale antes.
      nome: "seguir-pessoas",
      teste: (nos) =>
        temTexto(nos, ["Segue 5 ou mais pessoas", "Follow 5 or more people", "Siga 5 ou mais pessoas"]) &&
        (acharId(nos, ig("action_bar_action_text")) ?? botao(nos, ["Ignorar", "Skip"])),
      agir: async (nos, alvo) => {
        await d.arrastar(alvo.x, alvo.y, alvo.x, alvo.y, 150);
        await esperar(3000);
      },
    },
    {
      // "Obtém sugestões de amizade" (ligar ao Facebook): o dono pediu Ignorar, no canto de cima.
      // Toque segurado de 150 ms, mudando um pouco o ponto a cada volta.
      nome: "sugestoes-amizade",
      teste: (nos) =>
        temTexto(nos, ["sugestões de amizade", "friend suggestions"]) &&
        (acharId(nos, ig("action_bar_action_text")) ?? botao(nos, ["Ignorar", "Skip"])),
      agir: async (nos, alvo) => {
        const dx = [0, -25, 25][estado.toquesSugestoes++ % 3];
        await d.arrastar(alvo.x + dx, alvo.y, alvo.x + dx, alvo.y, 150);
        await esperar(3000);
      },
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
