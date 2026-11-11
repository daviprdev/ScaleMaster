import { esperar } from "../lib/processo.mjs";
import { CONEXAO_OUTRA_CONTA, PROFISSIONAL_FALHOU, SEM_NAVEGADOR, arrobaDaConfirmacao, conferirConexao, hostDoLink } from "../lib/estrutura.mjs";
import { INSTAGRAM } from "./apk.mjs";
import { resumoTela, salvarTela } from "./dono.mjs";
import { CONCLUIR, EDITAR_PERFIL, SEGUINTE, acharAba, botaoDoPerfil, comandoDeepLink, irPara, percorrer, temBarra } from "./instagram.mjs";
import { acharTexto, preencher, temTexto } from "./tela.mjs";

/**
 * Parte do Estruturar que sai do perfil da própria conta: mudar para conta
 * profissional e, por alvo, perfil → destaque → sticker de link → página →
 * Conectar → Permitir → confirmação. Todo toque sai do uiautomator dump (centro
 * dos bounds) e toda espera é por texto na tela (`aguardar`), relendo a cada 1 s.
 *
 * mapa de telas (09/11/2026, por texto; a que não bater fica salva em telas/
 * pelo salvarTela e a etapa falha com o resumo do que estava na tela):
 *   perfil (deep link)      → @ do alvo ou botão Seguir/Seguindo
 *   destaque                → rótulo com o nome do destaque na bandeja do perfil
 *   visualizador do story   → sticker de link (id *link*, host do link ou descrição "link")
 *   "Visitar link"          → folha que o sticker abre antes do navegador
 *   página                  → WebView do Instagram ou Chrome Custom Tab com texto
 *   Conectar                → botão da página
 *   permissão (OAuth)       → Permitir / Allow / Continuar como …
 *   login (sem sessão)      → campos de usuário e senha
 *   confirmação             → texto de conectado/sucesso com o @
 */

export const CHROME = "com.android.chrome";

const VISITAR = ["Visitar link", "Visit link", "Acessar link", "Abrir link", "Open link", "Ver link", "Go to link"];
const CONECTAR = [
  "Conectar com Instagram",
  "Conectar Instagram",
  "Connect with Instagram",
  "Connect Instagram",
  "Continuar com Instagram",
  "Continue with Instagram",
  "Entrar com Instagram",
  "Log in with Instagram",
  "Login with Instagram",
  "Conectar",
  "Connect",
];
const PERMITIR = ["Permitir", "Allow", "Autorizar", "Authorize", "Permitir acesso", "Allow access"];
const ENTRAR = ["Entrar", "Log in", "Log In", "Iniciar sessão"];
const PRIMEIRA_VEZ = ["Accept & continue", "Aceitar e continuar", "Use without an account", "Usar sem uma conta", "No thanks", "Não, obrigado", "Got it", "Entendi"];
const COOKIES = ["Recusar cookies opcionais", "Decline optional cookies", "Permitir todos os cookies", "Allow all cookies"];

const ehBotao = (n) => n.clicavel || /Button/.test(n.classe);
const igual = (n, t) => [n.texto, n.descricao].some((v) => v.trim().toLowerCase() === t.toLowerCase());
const contem = (n, t) => [n.texto, n.descricao].some((v) => v.toLowerCase().includes(t.toLowerCase()));

/** Botão por texto: exato primeiro; depois "contém", só em nó clicável (frase solta da página não conta). */
export function acharBotao(nos, textos) {
  for (const t of textos) {
    const exato = nos.find((n) => igual(n, t) && ehBotao(n)) ?? nos.find((n) => igual(n, t));
    if (exato) return exato;
  }
  for (const t of textos) {
    const parcial = nos.find((n) => contem(n, t) && ehBotao(n));
    if (parcial) return parcial;
  }
  return null;
}

const textosDe = (nos) => nos.filter((n) => !/systemui/.test(n.pacote)).map((n) => n.texto || n.descricao).filter(Boolean);

/** Página aberta (WebView do Instagram ou Chrome) e já com texto. */
export function paginaAberta(nos) {
  const navegador = nos.some((n) => /WebView/i.test(n.classe) || n.pacote === CHROME || /browser|webview/i.test(n.id));
  return navegador && nos.filter((n) => n.texto.trim().length >= 2).length >= 2;
}

/** Tela de permissão do OAuth: devolve o botão (Permitir/Allow ou "Continuar como …"). */
export function botaoDePermissao(nos) {
  for (const t of PERMITIR) {
    const exato = nos.find((n) => igual(n, t));
    if (exato) return exato;
  }
  return nos.find((n) => /^(continuar como|continue as)\b/i.test(n.texto.trim() || n.descricao.trim())) ?? null;
}

/** Tela de login (página sem sessão): campos de texto e algo falando em senha/entrar. */
export function telaDeLogin(nos) {
  const campos = nos.filter((n) => /EditText/.test(n.classe));
  if (campos.length >= 2) return temTexto(nos, ["Senha", "Password", "Palavra-passe", ...ENTRAR]);
  return campos.length === 1 && temTexto(nos, ["Senha", "Password", "Palavra-passe"]);
}

/** Sticker de link no story aberto. */
export function stickerDeLink(nos, host) {
  const ig = nos.filter((n) => n.pacote === INSTAGRAM);
  return (
    ig.find((n) => /link_sticker|story_link|sticker_link|cta_link/i.test(n.id)) ??
    (host ? ig.find((n) => `${n.texto} ${n.descricao}`.toLowerCase().includes(host)) : null) ??
    ig.find((n) => /\b(link|ligação)\b/i.test(n.descricao) && n.y > 250 && n.y < 1650) ??
    null
  );
}

/**
 * Relê a tela a cada 1 s até `teste(nos)` devolver algo. Dump que falha (story
 * animando) conta como tela ainda não pronta. Estourou: erro com o que havia na tela.
 */
export async function aguardar(d, teste, { timeoutMs = 20_000, descricao = "a tela esperada" } = {}) {
  const limite = Date.now() + timeoutMs;
  let nos = [];
  for (;;) {
    nos = await d.tela().catch(() => []);
    const achou = nos.length > 0 ? teste(nos) : null;
    if (achou) return achou;
    if (Date.now() > limite) {
      if (nos.length > 0) salvarTela(nos, `estruturar: não apareceu ${descricao}`);
      throw new Error(`não apareceu ${descricao} em ${Math.round(timeoutMs / 1000)} s (na tela: ${resumoTela(nos) || "sem leitura"})`);
    }
    await esperar(1000);
  }
}

/** `am start` de um endereço num pacote; o endereço vai entre aspas simples (o sh do Android não corta em & nem ?). */
export function comandoAbrirUrl(url, pacote) {
  return ["am", "start", "-a", "android.intent.action.VIEW", "-d", `'${String(url).replace(/'/g, "%27")}'`, "-p", pacote];
}

// ── conta profissional ────────────────────────────────────────────────────

const PAINEL = ["Painel profissional", "Professional dashboard", "Painel do profissional", "Ver painel", "View dashboard"];

/**
 * Perfil → menu → Configurações e atividade → Tipo de conta e ferramentas →
 * Mudar para conta profissional → Criador → telas nativas (Avançar/Concluir).
 * Confirma pelo texto "Painel profissional" no perfil. Qualquer falha sai como
 * PROFISSIONAL_FALHOU (bloqueia só as etapas de OAuth).
 */
export async function tornarProfissional(ctx) {
  const { d, log } = ctx;
  const estado = { menu: false, config: false, mudou: false, criador: false, categoria: false, rolagens: 0 };
  const falhar = (texto, nos) => {
    if (nos) salvarTela(nos, `profissional: ${texto}`);
    throw new Error(texto);
  };
  try {
    await irPara(ctx, "perfil");
    return await percorrer(ctx, {
      nome: "A mudança para conta profissional",
      limiteMs: 8 * 60_000,
      travou: falhar,
      fim: (nos) => (temBarra(nos) && temTexto(nos, PAINEL) ? (estado.mudou ? "conta profissional (Criador)" : "a conta já era profissional") : null),
      telas: [
        {
          nome: "ja-profissional",
          teste: (nos) => acharTexto(nos, ["Mudar para conta pessoal", "Switch to personal account", "Mudar para a conta pessoal"]),
          agir: () => (estado.mudou ? "conta profissional (Criador)" : "a conta já era profissional"),
        },
        {
          nome: "criador",
          teste: (nos) => !estado.criador && temTexto(nos, ["Empresa", "Business"], { exato: true }) && acharBotao(nos, ["Criador de conteúdo", "Criador", "Creator"]),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            estado.criador = true;
            await aguardar(d, (n) => acharBotao(n, [...SEGUINTE, ...CONCLUIR]), { timeoutMs: 10_000, descricao: "o Avançar depois de Criador" }).catch(() => {});
          },
        },
        {
          nome: "categoria",
          teste: (nos) =>
            estado.mudou &&
            !estado.categoria &&
            temTexto(nos, ["categoria", "category", "O que melhor descreve", "What best describes"]) &&
            (nos.find((n) => /RadioButton|CheckBox/.test(n.classe)) ?? acharBotao(nos, ["Criador de conteúdo digital", "Digital creator", "Blogueiro", "Blogger", "Artista", "Artist"])),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            estado.categoria = true;
            await esperar(1000);
          },
        },
        {
          nome: "mudar",
          teste: (nos) => !estado.mudou && acharTexto(nos, ["Mudar para conta profissional", "Switch to professional account", "Mudar para profissional", "Mudar para a conta profissional"]),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            estado.mudou = true;
            await esperar(1500);
          },
        },
        {
          nome: "tipo-de-conta",
          teste: (nos) => !estado.mudou && acharTexto(nos, ["Tipo de conta e ferramentas", "Account type and tools", "Ferramentas e tipo de conta", "Tipo de conta"]),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            await esperar(1500);
          },
        },
        {
          nome: "avancar",
          teste: (nos) => estado.mudou && acharBotao(nos, [...SEGUINTE, ...CONCLUIR]),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            await esperar(1500);
          },
        },
        {
          nome: "fechar-guia",
          teste: (nos) => estado.criador && !temBarra(nos) && nos.find((n) => n.pacote === INSTAGRAM && ["Fechar", "Close"].some((t) => igual(n, t))),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            await esperar(1500);
          },
        },
        {
          // Lista de configurações: "Tipo de conta e ferramentas" fica lá embaixo.
          nome: "rolar-configuracoes",
          teste: (nos) =>
            (estado.menu || estado.config) && !estado.mudou && estado.rolagens < 14 && temTexto(nos, ["Central de Contas", "Accounts Center", "Como você usa o Instagram", "How you use Instagram", "Configurações e atividade", "Settings and activity"]),
          agir: async () => {
            estado.rolagens += 1;
            await d.arrastar(540, 1500, 540, 600, 400);
            await esperar(1000);
          },
        },
        {
          nome: "configuracoes",
          teste: (nos) => !estado.config && acharTexto(nos, ["Configurações e atividade", "Settings and activity", "Configurações e privacidade", "Settings and privacy", "Definições e atividade"]),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            estado.config = true;
            await esperar(1500);
          },
        },
        {
          nome: "menu",
          teste: (nos) =>
            !estado.menu &&
            temBarra(nos) &&
            acharBotao(nos, EDITAR_PERFIL) &&
            nos.find((n) => n.pacote === INSTAGRAM && n.y < 300 && ["Opções", "Options", "Menu", "Definições", "Configurações"].some((t) => igual(n, t))),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            estado.menu = true;
            await esperar(1500);
          },
        },
        {
          nome: "perfil",
          teste: (nos) => !estado.menu && temBarra(nos) && !acharBotao(nos, EDITAR_PERFIL) && acharAba(nos, "perfil"),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            await esperar(1500);
          },
        },
      ],
    });
  } catch (e) {
    log(`conta profissional: ${e.message}`);
    throw new Error(`${PROFISSIONAL_FALHOU}: ${e.message}`);
  }
}

// ── alvo: perfil → destaque → link → Conectar → Permitir → confirmação ────

/** Deep link do perfil e espera (máx 20 s) o @ ou o botão Seguir/Seguindo no dump. */
export async function abrirPerfilAlvo(ctx, usuario) {
  const { d } = ctx;
  const saida = await d.shell(...comandoDeepLink(usuario));
  if (/Error|Exception|does not exist/i.test(saida)) throw new Error(`o deep link de @${usuario} não abriu: ${saida.trim().slice(0, 120)}`);
  await aguardar(d, (nos) => nos.some((n) => n.pacote === INSTAGRAM && n.texto.trim().toLowerCase() === usuario.toLowerCase()) || botaoDoPerfil(nos), {
    timeoutMs: 20_000,
    descricao: `o perfil @${usuario}`,
  });
  return `perfil @${usuario} aberto`;
}

const noPerfil = (nos) => !!botaoDoPerfil(nos) || temBarra(nos);

/** Acha o destaque pelo texto do nome na bandeja do perfil, toca e espera o visualizador abrir. */
export async function abrirDestaque(ctx, nome) {
  const { d } = ctx;
  const alvo = nome.trim().toLowerCase();
  const rotulo = await aguardar(d, (nos) => nos.find((n) => n.pacote === INSTAGRAM && n.y > 300 && (n.texto.trim().toLowerCase() === alvo || n.descricao.trim().toLowerCase().includes(alvo))), {
    timeoutMs: 15_000,
    descricao: `o destaque "${nome}"`,
  });
  // O rótulo fica embaixo do círculo: toca no círculo; se o visualizador não abrir, no próprio rótulo.
  const toques = rotulo.texto ? [[rotulo.x, rotulo.y - 90], [rotulo.x, rotulo.y]] : [[rotulo.x, rotulo.y]];
  for (const [x, y] of toques) {
    await d.tocar(x, y);
    const limite = Date.now() + 8_000;
    while (Date.now() < limite) {
      const nos = await d.tela().catch(() => []);
      // Story tocando costuma deixar o dump sem leitura: com o Instagram na frente, é o visualizador.
      if (nos.length === 0 ? /com\.instagram\.android/.test(await d.focoAtual()) : !noPerfil(nos) && nos.some((n) => n.pacote === INSTAGRAM)) {
        return `destaque "${nome}" aberto`;
      }
      await esperar(1000);
    }
  }
  throw new Error(`toquei no destaque "${nome}" e o story não abriu`);
}

/** Dump com o story parado: segura o toque (pausa a animação) enquanto lê. */
async function lerComPausa(d) {
  const segurando = d.arrastar(540, 330, 540, 330, 9000).catch(() => {});
  const nos = await d.tela().catch(() => []);
  await segurando;
  return nos;
}

/**
 * Com o destaque aberto: acha o sticker de link (passando de story em story,
 * até 6), toca, confirma "Visitar link" se aparecer e espera a página carregar
 * (navegador com texto na tela).
 */
export async function tocarLinkDoDestaque(ctx, link) {
  const { d, log } = ctx;
  const host = hostDoLink(link);
  let sticker = null;
  for (let story = 0; story < 6 && !sticker; story++) {
    let nos = await d.tela().catch(() => []);
    if (nos.length === 0) nos = await lerComPausa(d);
    if (nos.length > 0 && noPerfil(nos)) break;
    sticker = stickerDeLink(nos, host);
    if (!sticker) {
      if (nos.length > 0) salvarTela(nos, "estruturar: story sem sticker de link");
      log(`story ${story + 1} do destaque sem sticker de link: próximo`);
      await d.tocar(980, 900);
      await esperar(1000);
    }
  }
  if (!sticker) throw new Error("nenhum story do destaque mostrou o sticker de link");
  await d.tocar(sticker.x, sticker.y);

  let visitou = false;
  const primeiro = await aguardar(
    d,
    (nos) => {
      if (paginaAberta(nos)) return { pagina: nos };
      const visitar = !visitou && acharBotao(nos, VISITAR);
      return visitar ? { visitar } : null;
    },
    { timeoutMs: 20_000, descricao: "a página do link (ou o Visitar link)" }
  );
  let pagina = primeiro.pagina;
  if (primeiro.visitar) {
    visitou = true;
    await d.tocar(primeiro.visitar.x, primeiro.visitar.y);
    pagina = await aguardar(d, (nos) => (paginaAberta(nos) ? nos : null), { timeoutMs: 40_000, descricao: "a página do link carregar" });
  }
  const titulo = pagina.find((n) => n.texto.trim().length >= 3 && n.pacote !== "com.android.systemui")?.texto.trim().slice(0, 60) ?? "";
  return `página aberta${pagina.some((n) => n.pacote === CHROME) ? " no Chrome" : ""}${titulo ? ` (${titulo})` : ""}`;
}

/** Preenche usuário e senha na tela de login que está na frente e espera sair dela. */
async function preencherLogin(d, conta, log) {
  if (!conta?.usuario || !conta?.senha) throw new Error("a página pediu login e a estruturação veio sem o @ e a senha da conta");
  const limite = Date.now() + 120_000;
  let preencheu = false;
  while (Date.now() < limite) {
    const nos = await d.tela().catch(() => []);
    const campos = nos.filter((n) => /EditText/.test(n.classe)).sort((a, b) => a.y - b.y);
    if (temTexto(nos, ["senha incorreta", "senha está incorreta", "password was incorrect", "incorrect password"])) throw new Error("o Instagram recusou a senha no login da página");
    if (preencheu && nos.length > 0 && campos.length < 2) return;
    const extra = acharBotao(nos, PRIMEIRA_VEZ) ?? acharBotao(nos, COOKIES);
    if (extra && campos.length < 2) {
      await d.tocar(extra.x, extra.y);
    } else if (!preencheu && campos.length >= 2) {
      log("tela de login da página: entrando com o @ e a senha da conta");
      await preencher(d, campos[0], conta.usuario);
      const depois = (await d.tela().catch(() => [])).filter((n) => /EditText/.test(n.classe)).sort((a, b) => a.y - b.y);
      await preencher(d, depois[1] ?? campos[1], conta.senha);
      const entrar = acharBotao(await d.tela().catch(() => []), ENTRAR);
      if (entrar) await d.tocar(entrar.x, entrar.y);
      else await d.tecla("KEYCODE_ENTER");
      preencheu = true;
    }
    await esperar(1000);
  }
  throw new Error("o login da página não terminou em 2 min");
}

/**
 * Página sem sessão: abre o navegador do container, loga com o @ e a senha da
 * conta, reabre o link nele e toca em Conectar de novo (mesma proxy: tudo sai
 * pelo sidecar). Antes de qualquer coisa confere se o pacote do navegador
 * existe: sem ele a etapa falha com SEM_NAVEGADOR (a base precisa ser refeita
 * pelo scripts/vps/golden.sh, que instala o Chrome pinado).
 */
export async function entrarEVoltar(ctx, { link, conta }) {
  const { d, log } = ctx;
  if (!(await d.temApp(CHROME))) {
    throw new Error(`${SEM_NAVEGADOR}: a página abriu sem sessão e o container não tem navegador (${CHROME}); refaça a imagem base (Rebuild imagem)`);
  }
  await d.shell(...comandoAbrirUrl("https://www.instagram.com/accounts/login/", CHROME));
  await aguardar(d, (n) => (n.some((x) => x.pacote === CHROME) ? n : null), { timeoutMs: 30_000, descricao: "o Chrome" });
  await preencherLogin(d, conta, log);
  await d.shell(...comandoAbrirUrl(link, CHROME));
  const botao = await aguardar(d, (n) => paginaAberta(n) && acharBotao(n, CONECTAR), { timeoutMs: 40_000, descricao: "o botão Conectar depois do login" });
  await d.tocar(botao.x, botao.y);
  return "login feito no Chrome";
}

const confirmada = (nos) => arrobaDaConfirmacao(textosDe(nos)).confirmado;

/** Toca em Conectar e espera a tela de permissão; se a página pedir login, entra e refaz. */
export async function conectar(ctx, { link, conta }) {
  const { d } = ctx;
  const botao = await aguardar(d, (nos) => paginaAberta(nos) && acharBotao(nos, CONECTAR), { timeoutMs: 30_000, descricao: "o botão Conectar" });
  await d.tocar(botao.x, botao.y);
  const depois = (descricao) =>
    aguardar(d, (nos) => (botaoDePermissao(nos) ? "permissao" : telaDeLogin(nos) ? "login" : confirmada(nos) ? "confirmada" : null), { timeoutMs: 40_000, descricao });
  let chegou = await depois("a tela de permissão");
  let como = "";
  if (chegou === "login") {
    como = ` (${await entrarEVoltar(ctx, { link, conta })})`;
    chegou = await depois("a tela de permissão depois do login");
    if (chegou === "login") throw new Error("a página voltou para o login depois de entrar");
  }
  return `${chegou === "confirmada" ? "já estava autorizado" : "tela de permissão aberta"}${como}`;
}

/** Toca em Permitir e espera a tela de permissão sair. */
export async function consentir(ctx) {
  const { d } = ctx;
  const nos = await aguardar(d, (n) => (botaoDePermissao(n) || confirmada(n) ? n : null), { timeoutMs: 30_000, descricao: "o botão Permitir" });
  const botao = botaoDePermissao(nos);
  if (!botao) return "já estava autorizado";
  await d.tocar(botao.x, botao.y);
  await aguardar(d, (n) => (!botaoDePermissao(n) ? n : null), { timeoutMs: 30_000, descricao: "a permissão ser aceita" });
  return "permitido";
}

/** Espera a confirmação e confere o @ exibido com o da conta (diferente = CONEXAO_OUTRA_CONTA). */
export async function confirmar(ctx, usuarioDaConta) {
  const { d } = ctx;
  const lido = await aguardar(
    d,
    (nos) => {
      const r = arrobaDaConfirmacao(textosDe(nos));
      return r.confirmado ? r : null;
    },
    { timeoutMs: 45_000, descricao: "a confirmação da conexão" }
  );
  const conferido = conferirConexao(lido.usuario, usuarioDaConta);
  if (!conferido.ok) throw new Error(conferido.mensagem);
  return conferido.mensagem;
}

export { CONEXAO_OUTRA_CONTA, SEM_NAVEGADOR };
