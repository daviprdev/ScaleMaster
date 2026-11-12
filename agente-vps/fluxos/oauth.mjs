import { esperar } from "../lib/processo.mjs";
import { CONEXAO_OUTRA_CONTA, PROFISSIONAL_FALHOU, SEM_NAVEGADOR, arrobaDaConfirmacao, arrobaDaPermissao, conferirConexao, hostDoLink } from "../lib/estrutura.mjs";
import { INSTAGRAM } from "./apk.mjs";
import { resumoTela, salvarTela } from "./dono.mjs";
import { SEGUINTE, xDoMetaVerified, atividadeNoTopo, botaoDoPerfil, comandoDeepLink, irPara, noProprioPerfil, percorrer, temBarra } from "./instagram.mjs";
import { acharId, acharTexto, esperarMudar, preencher, preencherEsperando, temTexto } from "./tela.mjs";

/**
 * Parte do Estruturar que sai do perfil da própria conta: mudar para conta
 * profissional e, por alvo, perfil → destaque → sticker de link → página →
 * Conectar → Permitir → confirmação. Todo toque sai do uiautomator dump (centro
 * dos bounds) e toda espera é por texto na tela (`aguardar`), relendo a cada 1 s.
 *
 * mapa de telas (ig-10, Instagram 454 x86_64, 11/11/2026; a que não bater fica
 * salva em telas/ pelo salvarTela e a etapa falha com o resumo da tela):
 *   perfil (deep link)      → @ do alvo ou botão Seguir/Seguindo
 *   destaque                → círculo da faixa (descrição "Story do destaque de …", rótulo embaixo)
 *   visualizador do story   → sticker de link: nó clicável sem texto no meio da tela
 *                             (o story dura ~5 s: acabou, reabre o destaque)
 *   balão "Acessar link"    → aparece acima do sticker e não sai no dump: toque ~205 px acima
 *   página                  → navegador do Instagram (ig_browser_*), ex.: "Para onde você quer ir?" → OAUTH
 *   permissão (OAuth)       → "… está solicitando acesso a: <@>" → Permitir (@ diferente = CONEXAO_OUTRA_CONTA)
 *   login (sem sessão)      → campos de usuário e senha
 *   confirmação             → "Conta conectada!" → Fechar navegador (volta ao Instagram)
 */

export const CHROME = "com.android.chrome";

const VISITAR = ["Visitar link", "Visit link", "Acessar link", "Abrir link", "Open link", "Ver link", "Go to link"];
const CONECTAR = [
  "OAUTH",
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
    // Nesta build o sticker sai no dump como um nó clicável sem texto, id nem descrição, no meio da tela (ig-10, 11/11).
    ig.find((n) => n.clicavel && !n.texto && !n.descricao && !n.id && n.y > 250 && n.y < 1600) ??
    null
  );
}

/** Visualizador de story na frente (ids reel_viewer_*, barra de mensagem do story). */
export const noVisualizador = (nos) => nos.some((n) => /reel_viewer|story_viewer|viewer_toolbar|message_composer/.test(n.id));

// decisão: o balão "Acessar link" que o sticker abre não sai no dump (overlay); fica ~205 px acima do centro do sticker (ig-10, 11/11).
export const BALAO_ACIMA_PX = 205;

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

const TIPO_DE_CONTA = ["Tipo e ferramentas da conta", "Tipo de conta e ferramentas", "Account type and tools", "Ferramentas e tipo de conta"];
const TROCAR_PROFISSIONAL = ["Trocar para conta profissional", "Mudar para conta profissional", "Switch to professional account", "Mudar para a conta profissional"];
const JA_PROFISSIONAL = ["Trocar para conta pessoal", "Mudar para conta pessoal", "Switch to personal account", "Mudar para a conta pessoal"];
const CATEGORIA_CRIADOR = ["Criador de conteúdo digital", "Digital creator"];
const CONFIGURACOES = ["Configurações e atividade", "Settings and activity", "Configurações e privacidade", "Settings and privacy", "Definições e atividade"];
const OPCOES = ["Opções", "Options", "Menu", "Definições", "Configurações"];

/**
 * Conta profissional (Criador), pelo caminho desta build (Instagram 454 x86_64,
 * ig-10, 11/11):
 *   perfil (aba)                          → Opções (≡, topo à direita)
 *   Configurações e atividade             → rola até "Tipo e ferramentas da conta"
 *   Tipo e ferramentas da conta           → "Trocar para conta profissional"
 *                                           ("Trocar para conta pessoal" = já é profissional)
 *   Troque para uma conta profissional    → Avançar
 *   Qual categoria mais bem descreve você? → pesquisa "Criador de conteúdo" →
 *                                           "Criador de conteúdo digital" → Trocar para conta profissional
 *   Que tipo de profissional você é?      → Criador de conteúdo → Avançar
 *   Alterações nas configurações de segurança → OK
 *   Emails promocionais                   → Avançar
 *   Configure sua conta profissional      → Fechar → perfil
 * Qualquer falha sai como PROFISSIONAL_FALHOU (bloqueia só as etapas de OAuth).
 */
export async function tornarProfissional(ctx) {
  const { d, log } = ctx;
  const estado = { menu: false, tipo: false, trocou: false, pesquisou: false, categoria: false, confirmou: false, criador: false, fechou: false, rolagens: 0, tentativasTipo: 0 };
  const falhar = (texto, nos) => {
    if (nos) salvarTela(nos, `profissional: ${texto}`);
    throw new Error(texto);
  };
  // A pesquisa de categoria pode abrir em tela cheia (search_bar_real_field, sem o título; josiane, 11/11).
  const naCategoria = (nos) =>
    temTexto(nos, ["Qual categoria", "categoria mais bem", "What best describes", "Choose a category"]) ||
    nos.some((n) => ["search_bar_real_field", "categories_header_text", "suggested_categories_header"].some((id) => n.id.endsWith(`:id/${id}`)));
  const tocarEsperar = async (nos, alvo) => {
    await d.tocar(alvo.x, alvo.y);
    await esperarMudar(d, nos, { timeoutMs: 6000 });
  };
  try {
    await irPara(ctx, "perfil", { abas: true });
    return await percorrer(ctx, {
      nome: "A mudança para conta profissional",
      limiteMs: 8 * 60_000,
      travou: falhar,
      fim: (nos) => (estado.fechou && noProprioPerfil(nos) ? "conta profissional (Criador)" : null),
      telas: [
        {
          nome: "fechar-guia",
          teste: (nos) =>
            temTexto(nos, ["Configure sua conta profissional", "Set up your professional account"]) &&
            (acharId(nos, `${INSTAGRAM}:id/action_bar_button_action`) ?? acharBotao(nos, ["Fechar", "Close"])),
          agir: async (nos, alvo) => {
            await tocarEsperar(nos, alvo);
            estado.fechou = true;
          },
        },
        {
          nome: "emails",
          teste: (nos) => temTexto(nos, ["Emails promocionais", "E-mails promocionais", "Promotional emails"]) && acharBotao(nos, SEGUINTE),
          agir: tocarEsperar,
        },
        {
          nome: "seguranca",
          teste: (nos) => temTexto(nos, ["configurações de segurança", "security settings"]) && acharBotao(nos, ["OK"]),
          agir: tocarEsperar,
        },
        {
          nome: "tipo-profissional",
          teste: (nos) =>
            temTexto(nos, ["Que tipo de profissional", "What type of professional"]) &&
            (estado.criador ? acharBotao(nos, SEGUINTE) : acharTexto(nos, ["Criador de conteúdo", "Creator"], { exato: true })),
          agir: async (nos, alvo) => {
            if (estado.criador) return tocarEsperar(nos, alvo);
            // O cartão Criador costuma vir marcado: o toque pode não mudar nada no dump.
            await d.tocar(alvo.x, alvo.y);
            await esperar(800);
            estado.criador = true;
          },
        },
        {
          nome: "categoria-confirmar",
          teste: (nos) => naCategoria(nos) && estado.categoria && !estado.confirmou && acharBotao(nos, TROCAR_PROFISSIONAL),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            estado.confirmou = true;
            await esperarMudar(d, nos, { timeoutMs: 15_000 });
          },
        },
        {
          nome: "categoria-escolher",
          teste: (nos) => naCategoria(nos) && !estado.categoria && acharTexto(nos, CATEGORIA_CRIADOR, { exato: true }),
          agir: async (nos, alvo) => {
            await d.tocar(alvo.x, alvo.y);
            await esperar(800);
            estado.categoria = true;
          },
        },
        {
          nome: "categoria-pesquisar",
          teste: (nos) =>
            naCategoria(nos) &&
            !estado.categoria &&
            !estado.pesquisou &&
            (acharId(nos, `${INSTAGRAM}:id/search_edit_text`) ?? nos.find((n) => /EditText/.test(n.classe)) ?? acharTexto(nos, ["Pesquisar categorias", "Search categories"])),
          agir: async (nos, campo) => {
            await preencherEsperando(d, campo, "Criador de conteúdo", nos);
            estado.pesquisou = true;
          },
        },
        {
          nome: "intro",
          teste: (nos) => temTexto(nos, ["Troque para uma conta profissional", "Switch to a professional account"]) && acharBotao(nos, SEGUINTE),
          agir: tocarEsperar,
        },
        {
          // "Trocar para conta pessoal", ou a página Tipo de conta mostrando "Profissional"/"Criador" no lugar de "Pessoal".
          nome: "ja-profissional",
          teste: (nos) =>
            acharTexto(nos, JA_PROFISSIONAL) ??
            (temTexto(nos, ["Tipo de conta", "Account type"]) &&
              !acharTexto(nos, TROCAR_PROFISSIONAL) &&
              acharTexto(nos, ["Profissional", "Criador de conteúdo", "Criador", "Empresa", "Professional", "Creator", "Business"], { exato: true })),
          agir: () => (estado.trocou ? "conta profissional (Criador)" : "a conta já era profissional"),
        },
        {
          nome: "trocar",
          teste: (nos) => !estado.trocou && temTexto(nos, ["Tipo de conta", "Account type"]) && acharTexto(nos, TROCAR_PROFISSIONAL),
          agir: async (nos, alvo) => {
            estado.trocou = true;
            await tocarEsperar(nos, alvo);
          },
        },
        {
          nome: "tipo-de-conta",
          teste: (nos) => !estado.tipo && temTexto(nos, CONFIGURACOES) && nos.find((n) => TIPO_DE_CONTA.some((t) => n.texto.trim() === t) && n.y < 1800),
          agir: async (nos, alvo) => {
            estado.tipo = true;
            await tocarEsperar(nos, alvo);
          },
        },
        {
          // Tocou em "Tipo e ferramentas da conta" e continuou nas configurações (toque perdido no fim da
          // rolagem; joana, 12/11): libera a rolagem para achar e tocar de novo, até 3 vezes.
          nome: "tipo-nao-abriu",
          teste: (nos) => estado.tipo && !estado.trocou && estado.tentativasTipo < 3 && temTexto(nos, CONFIGURACOES) && !temTexto(nos, ["Tipo de conta", "Account type"]),
          agir: () => {
            estado.tentativasTipo += 1;
            estado.tipo = false;
          },
        },
        {
          // Lista de configurações: "Tipo e ferramentas da conta" fica lá embaixo (4 rolagens nesta build).
          nome: "rolar-configuracoes",
          // Rola tudo numa volta só: a lista leva 4–5 rolagens (josiane, 11/11) e o percorrer dava "não avançou" na 4ª.
          teste: (nos) => estado.menu && !estado.tipo && temTexto(nos, [...CONFIGURACOES, "Sua conta", "Your account", "Como você usa o Instagram", "How you use Instagram"]),
          agir: async (nos) => {
            let atual = nos;
            for (let i = 0; i < 14; i++) {
              const alvo = atual.find((n) => TIPO_DE_CONTA.some((t) => n.texto.trim() === t) && n.y < 1800);
              if (alvo) {
                estado.tipo = true;
                // Depois de uma rolagem a lista ainda desliza: lê de novo parada e toca na posição final (joana, 12/11).
                let parado = alvo;
                if (i > 0) {
                  await esperar(700);
                  const releitura = await d.tela().catch(() => []);
                  parado = releitura.find((n) => TIPO_DE_CONTA.some((t) => n.texto.trim() === t) && n.y < 1800) ?? alvo;
                  if (releitura.length > 0) atual = releitura;
                }
                await tocarEsperar(atual, parado);
                return;
              }
              await d.arrastar(540, 1500, 540, 600, 400);
              const depois = await esperarMudar(d, atual, { timeoutMs: 3000 });
              // Fim da lista sem o item: a tela não muda mais.
              if (!depois) break;
              atual = depois;
            }
            falhar("rolei as configurações até o fim e não achei \"Tipo e ferramentas da conta\"", atual);
          },
        },
        {
          nome: "opcoes",
          teste: (nos) => !estado.menu && noProprioPerfil(nos) && nos.find((n) => n.pacote === INSTAGRAM && n.y < 300 && OPCOES.some((t) => igual(n, t))),
          agir: async (nos, alvo) => {
            estado.menu = true;
            await tocarEsperar(nos, alvo);
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

/** O perfil na frente é o do @ (título da barra de cima)? */
export function noPerfilDe(nos, usuario) {
  const u = String(usuario ?? "").replace(/^@/, "").trim().toLowerCase();
  return !!u && nos.some((n) => n.pacote === INSTAGRAM && n.id.endsWith(":id/action_bar_title") && n.texto.trim().toLowerCase() === u);
}

/**
 * Garante o perfil do alvo na frente. O Continuar retoma da etapa que falhou
 * (ex.: link-1) com o Instagram aberto no perfil da própria conta: sem isto a
 * nota dela virava "destaque" e o toque caía no Meta Verified (josiane, 12/11).
 */
export async function garantirPerfilAlvo(ctx, usuario) {
  if (!usuario) return;
  const nos = await ctx.d.tela().catch(() => []);
  if (noPerfilDe(nos, usuario) || noVisualizador(nos) || paginaAberta(nos)) return;
  ctx.log?.(`fora do perfil @${usuario}: abrindo pelo deep link`);
  await abrirPerfilAlvo(ctx, usuario);
}

// Pelos ids do cabeçalho: o "Seguir" do visualizador de story (reel_header_unconnected_follow) não conta como perfil.
const noPerfil = (nos) => nos.some((n) => n.pacote === INSTAGRAM && /:id\/(row_)?profile_header/.test(n.id)) || temBarra(nos);

export const DESTAQUE_POR_PREFIXO_FALHOU = "DESTAQUE_POR_PREFIXO_FALHOU";

/**
 * Texto de destaque para comparar: sem emoji, sem acento, sem nada que não
 * seja letra, em minúsculas. "AQUI 🔗👆" → "aqui"; "Aquí" → "aqui"; "" → "".
 */
export function normalizarDestaque(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** O texto do dump bate com o nome configurado pelo prefixo normalizado ("AQUI 🔗👆", "Aqui", "AQUI…" cortado). */
export function bateDestaque(textoDaTela, nome) {
  const alvo = normalizarDestaque(nome);
  const visto = normalizarDestaque(textoDaTela);
  if (!alvo || !visto) return false;
  return visto.startsWith(alvo) || (visto.length >= 3 && alvo.startsWith(visto));
}

/** Rótulos do topo do perfil que ficam na mesma altura da faixa e não são destaques. */
const NAO_E_DESTAQUE = /^(novo|new|seguir|follow|seguindo|following|mensagem|message|editar perfil|edit profile|compartilhar perfil|share profile|e-mail|email|ligar|call|publica[cç][oõ]es|posts|seguidores|followers)$/i;

/**
 * Itens da faixa de destaques do perfil (rótulo embaixo da capa), da esquerda
 * para a direita. Pelo id do Instagram quando o dump traz; senão, pela
 * descrição; senão, a linha de textos curtos na mesma altura (≥ 2 itens).
 */
export function itensDaFaixa(nos) {
  // A nota do perfil ("Preciso de inspiração…", pog_bubble_text) fica na mesma altura e não é destaque.
  const doApp = nos.filter((n) => n.pacote === INSTAGRAM && n.y > 250 && n.y < 1500 && !/pog_|note_bubble|bubble_text/.test(n.id));
  const rotuloDe = (n) => (n.texto || n.descricao).trim();
  const validos = (lista) => lista.filter((n) => rotuloDe(n) && !NAO_E_DESTAQUE.test(rotuloDe(n))).sort((a, b) => a.x - b.x);
  const porId = validos(doApp.filter((n) => /highlight|reel_tray|story_tray|tray_item/i.test(n.id) && n.texto));
  if (porId.length > 0) return porId.map((n) => ({ no: n, texto: rotuloDe(n) }));
  // Círculo com a descrição "Story do destaque de <perfil> na coluna …": o nome é o texto logo embaixo dele.
  const rotuloAbaixo = (c) =>
    doApp
      .filter((n) => n.texto.trim() && Math.abs(n.x - c.x) <= 80 && n.y > c.y && n.y - c.y <= 220 && !NAO_E_DESTAQUE.test(n.texto.trim()))
      .sort((a, b) => a.y - b.y)[0] ?? null;
  const porDescricao = doApp.filter((n) => /destaque|highlight/i.test(n.descricao)).sort((a, b) => a.x - b.x);
  if (porDescricao.length > 0) {
    const vistos = new Set();
    const itens = [];
    for (const c of porDescricao) {
      const r = rotuloAbaixo(c);
      const item = r ? { no: r, texto: r.texto.trim() } : { no: c, texto: rotuloDe(c).replace(/^(destaque|highlight)\s*/i, "") };
      const chave = `${item.no.x},${item.no.y}`;
      if (vistos.has(chave) || !item.texto || NAO_E_DESTAQUE.test(item.texto)) continue;
      vistos.add(chave);
      itens.push(item);
    }
    if (itens.length > 0) return itens;
  }
  // Último recurso: textos curtos alinhados numa linha horizontal (a faixa), abaixo do cabeçalho.
  const curtos = doApp.filter((n) => n.texto && [...n.texto].length <= 30 && !NAO_E_DESTAQUE.test(n.texto.trim()) && !/^\d|\d$/.test(n.texto.trim()));
  const linhas = new Map();
  for (const n of curtos) {
    const chave = [...linhas.keys()].find((y) => Math.abs(y - n.y) <= 12) ?? n.y;
    linhas.set(chave, [...(linhas.get(chave) ?? []), n]);
  }
  const faixa = [...linhas.values()].filter((l) => l.length >= 2).sort((a, b) => b.length - a.length)[0] ?? [];
  return validos(faixa).map((n) => ({ no: n, texto: rotuloDe(n) }));
}

/**
 * Qual destaque abrir: o que bate pelo prefixo normalizado; sem nenhum, o
 * primeiro da faixa (porPrefixo = false); faixa vazia = null.
 */
export function escolherDestaque(nos, nome) {
  const itens = itensDaFaixa(nos);
  if (itens.length === 0) return null;
  const achado = itens.find((i) => bateDestaque(i.texto, nome));
  return achado ? { ...achado, porPrefixo: true } : { ...itens[0], porPrefixo: false };
}

/**
 * Acha o destaque pelo prefixo do nome (sem emoji, acento nem caixa: "AQUI 🔗👆",
 * "Aqui" e "AQUI" batem), toca e espera o visualizador abrir. Não achou: abre o
 * primeiro da faixa e loga DESTAQUE_POR_PREFIXO_FALHOU; faixa vazia: a etapa
 * falha com o dump salvo.
 */
export async function abrirDestaque(ctx, nome) {
  const { d, log = () => {} } = ctx;
  let ultimo = [];
  const escolha = await aguardar(
    d,
    (nos) => {
      ultimo = nos;
      return escolherDestaque(nos, nome);
    },
    { timeoutMs: 15_000, descricao: `a faixa de destaques (procurando "${nome}")` }
  ).catch((e) => {
    if (ultimo.length > 0) salvarTela(ultimo, "estruturar: faixa de destaques vazia");
    throw new Error(`a faixa de destaques do perfil está vazia: ${e.message}`);
  });
  if (!escolha.porPrefixo) {
    log(`${DESTAQUE_POR_PREFIXO_FALHOU}: nenhum destaque bate com "${nome}"; abrindo o primeiro da faixa ("${escolha.texto}")`);
    salvarTela(ultimo, `estruturar: ${DESTAQUE_POR_PREFIXO_FALHOU}`);
  }
  const rotulo = escolha.no;
  // O rótulo fica embaixo do círculo: toca no círculo; se o visualizador não abrir, no próprio rótulo.
  const toques = rotulo.texto ? [[rotulo.x, rotulo.y - 90], [rotulo.x, rotulo.y]] : [[rotulo.x, rotulo.y]];
  for (const [x, y] of toques) {
    await d.tocar(x, y);
    const limite = Date.now() + 8_000;
    while (Date.now() < limite) {
      const nos = await d.tela().catch(() => []);
      // Story tocando costuma deixar o dump sem leitura: com o Instagram na frente, é o visualizador.
      if (nos.length === 0 ? /com\.instagram\.android/.test(await d.focoAtual()) : !noPerfil(nos) && nos.some((n) => n.pacote === INSTAGRAM)) {
        return escolha.porPrefixo ? `destaque "${escolha.texto}" aberto` : `${DESTAQUE_POR_PREFIXO_FALHOU}: abri o primeiro destaque ("${escolha.texto}")`;
      }
      await esperar(1000);
    }
  }
  throw new Error(`toquei no destaque "${nome}" e o story não abriu`);
}

/** Dump com o story parado: segura o toque (pausa a animação) enquanto lê. */
async function lerComPausa(d) {
  const segurando = d.arrastar(540, 330, 540, 330, 4500).catch(() => {});
  const nos = await d.tela().catch(() => []);
  await segurando;
  return nos;
}

/** Reabre o destaque pela faixa do perfil (o story dele acabou e o perfil voltou). */
async function reabrirDestaque(d, nos, destaque, log) {
  const escolha = escolherDestaque(nos, destaque ?? "");
  if (!escolha) throw new Error("o story do destaque fechou e a faixa de destaques não aparece mais");
  log(`o story do destaque acabou: reabrindo "${escolha.texto}"`);
  await d.tocar(escolha.no.x, escolha.no.texto ? escolha.no.y - 90 : escolha.no.y);
  await esperar(1000);
}

const descreverPagina = (nos) => {
  const titulo =
    nos.find((n) => /ig_browser_text_subtitle/.test(n.id))?.texto.trim() ??
    nos.find((n) => n.texto.trim().length >= 3 && n.pacote !== "com.android.systemui")?.texto.trim().slice(0, 60) ??
    "";
  return `página aberta${nos.some((n) => n.pacote === CHROME) ? " no Chrome" : ""}${titulo ? ` (${titulo})` : ""}`;
};

const NAVEGADOR_RE = /inappbrowser|BrowserLite|com\.android\.chrome/i;

/**
 * Com o destaque aberto: lê a posição do sticker com o story pausado (dedo
 * segurando), solta, toca no sticker e logo no balão "Acessar link" (sem ler a
 * tela no meio: o story de foto dura ~5 s e um dump leva ~2,3 s; o toque caía
 * no perfil, josiane 11/11) e espera a página no navegador do Instagram. Se o
 * story acabou, reabre o destaque e repete, até 5 tentativas.
 */
export async function tocarLinkDoDestaque(ctx, { link = "", destaque = "", perfil = "" } = {}) {
  const { d, log = () => {} } = ctx;
  const host = hostDoLink(link);
  let sticker = null;
  let ultima = [];
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    let nos = await d.tela().catch(() => []);
    if (paginaAberta(nos)) return descreverPagina(nos);
    if (nos.length > 0 && !noVisualizador(nos) && perfil && !noPerfilDe(nos, perfil)) {
      log(`fora do perfil @${perfil}: abrindo pelo deep link`);
      await abrirPerfilAlvo(ctx, perfil);
      nos = await d.tela().catch(() => []);
    }
    if (nos.length > 0) ultima = nos;
    if (nos.length > 0 && noPerfil(nos) && !noVisualizador(nos)) await reabrirDestaque(d, nos, destaque, log);

    if (!sticker) {
      const pausada = await lerComPausa(d);
      if (pausada.length > 0) ultima = pausada;
      sticker = stickerDeLink(pausada, host);
      if (!sticker) {
        if (pausada.length > 0 && !(noPerfil(pausada) && !noVisualizador(pausada))) {
          salvarTela(pausada, "estruturar: story sem sticker de link");
          log(`story do destaque sem sticker de link (tentativa ${tentativa}): próximo story`);
          await d.tocar(980, 900);
          await esperar(1000);
        }
        continue;
      }
    }

    await d.tocar(sticker.x, sticker.y);
    await esperar(700);
    // Sticker que abre direto o navegador (outra build): não toca no balão por cima da página.
    if (!NAVEGADOR_RE.test(await atividadeNoTopo(d))) {
      log("balão do link: tocando acima do sticker");
      await d.tocar(sticker.x, Math.max(150, sticker.y - BALAO_ACIMA_PX));
    }

    const limite = Date.now() + 25_000;
    while (Date.now() < limite) {
      const tela = await d.tela().catch(() => []);
      if (tela.length > 0) ultima = tela;
      if (paginaAberta(tela)) return descreverPagina(tela);
      const visitar = acharBotao(tela, VISITAR);
      const xMeta = xDoMetaVerified(tela);
      if (xMeta) {
        log("oferta do Meta Verified na frente: fechando no X");
        await d.tocar(xMeta.x, xMeta.y);
        await esperar(1500);
        break;
      }
      if (visitar) await d.tocar(visitar.x, visitar.y);
      // O story acabou (perfil de volta): reabre na próxima tentativa.
      else if (tela.length > 0 && noPerfil(tela) && !noVisualizador(tela)) break;
      await esperar(1000);
    }
    log(`a página do link não abriu (tentativa ${tentativa}/5; na tela: ${resumoTela(ultima) || "sem leitura"})`);
  }
  if (ultima.length > 0) salvarTela(ultima, "estruturar: a página do link não abriu");
  throw new Error(`toquei no sticker e no balão 5 vezes e a página do link não abriu (na tela: ${resumoTela(ultima) || "sem leitura"})`);
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
  // O link da página vem do sticker do destaque; sem ele não dá para reabrir no navegador.
  if (!link) throw new Error("a página de permissões pediu login e o link do sticker não foi capturado para reabrir no navegador");
  await d.shell(...comandoAbrirUrl(link, CHROME));
  const botao = await aguardar(d, (n) => paginaAberta(n) && acharBotao(n, CONECTAR), { timeoutMs: 40_000, descricao: "o botão Conectar depois do login" });
  await d.tocar(botao.x, botao.y);
  return "login feito no Chrome";
}

const confirmada = (nos) => arrobaDaConfirmacao(textosDe(nos)).confirmado;

/**
 * Toca no botão da página (OAUTH / Conectar) e espera a tela de permissão; se
 * a página já abriu no Permitir (ou já confirmou), não toca em nada; se pedir
 * login, entra e refaz.
 */
export async function conectar(ctx, { link, conta }) {
  const { d } = ctx;
  const achado = await aguardar(
    d,
    (nos) => {
      if (botaoDePermissao(nos)) return { permissao: true };
      if (paginaAberta(nos) && confirmada(nos)) return { confirmada: true };
      const botao = paginaAberta(nos) && acharBotao(nos, CONECTAR);
      return botao ? { botao } : null;
    },
    { timeoutMs: 30_000, descricao: "o botão da página (OAUTH/Conectar) ou a tela de permissão" }
  );
  if (achado.permissao) return "tela de permissão aberta (a página foi direto)";
  if (achado.confirmada) return "já estava autorizado";
  const botao = achado.botao;
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

/**
 * Confere o @ da tela de permissão ("… está solicitando acesso a: <@>") com o
 * da conta, toca em Permitir e espera a tela sair. @ diferente =
 * CONEXAO_OUTRA_CONTA, sem tocar em Permitir.
 */
export async function consentir(ctx, usuarioDaConta) {
  const { d } = ctx;
  const nos = await aguardar(d, (n) => (botaoDePermissao(n) || confirmada(n) ? n : null), { timeoutMs: 30_000, descricao: "o botão Permitir" });
  const botao = botaoDePermissao(nos);
  if (!botao) return "já estava autorizado";
  const pedida = arrobaDaPermissao(textosDe(nos));
  const conta = String(usuarioDaConta ?? "").replace(/^@/, "").toLowerCase();
  if (pedida && conta && pedida !== conta) {
    salvarTela(nos, `estruturar: ${CONEXAO_OUTRA_CONTA}`);
    throw new Error(`${CONEXAO_OUTRA_CONTA}: a tela de permissão é de @${pedida}, a conta é @${conta} (não toquei em Permitir)`);
  }
  await d.tocar(botao.x, botao.y);
  await aguardar(d, (n) => (!botaoDePermissao(n) ? n : null), { timeoutMs: 30_000, descricao: "a permissão ser aceita" });
  return pedida ? `permitido para @${pedida}` : "permitido";
}

/** Fecha o navegador do Instagram (X do topo) e volta para o app. */
export async function fecharNavegador(d) {
  const nos = await d.tela().catch(() => []);
  const x = acharId(nos, `${INSTAGRAM}:id/ig_browser_close_button`) ?? nos.find((n) => /^(fechar navegador|close browser)$/i.test(n.descricao.trim()));
  if (!x) return false;
  await d.tocar(x.x, x.y);
  await esperarMudar(d, nos, { timeoutMs: 4000 });
  return true;
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
  // "Você já pode fechar esta aba": fecha o navegador e o fluxo segue no Instagram.
  const fechou = await fecharNavegador(d).catch(() => false);
  return `${conferido.mensagem}${fechou ? " · navegador fechado" : ""}`;
}

export { CONEXAO_OUTRA_CONTA, SEM_NAVEGADOR };
