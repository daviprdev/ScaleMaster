import { casa } from "../lib/adb.mjs";
import { esperar } from "../lib/processo.mjs";
import { proxyAtiva } from "../lib/rede.mjs";
import { INSTAGRAM } from "./apk.mjs";
import { VERIFICADOS as VERIFICADOS_AQUECIMENTO } from "./verificados.mjs";
import { resumoTela, salvarTela } from "./dono.mjs";
import { SESSAO_PERDIDA } from "../lib/estrutura.mjs";
import { acharId, acharTexto, esperarMudar, esperarTela, preencher, preencherEsperando, temTexto, tocarAteMudar, tocarNo } from "./tela.mjs";

/**
 * Cópia adaptada de agente-mumu/fluxos/instagram.mjs para a VPS: a proxy não é
 * a VPN do NekoBox, é o sidecar redsocks no netns do container (lib/rede.mjs),
 * então garantirProxy olha o sidecar. O resto (telas) é igual.
 *
 * Instagram já logado, para a Atividade (aba Emulador): abrir, andar pelas
 * abas, seguir verificados, rolar Reels, trocar a foto de perfil, postar story
 * com sticker de link e destacar. Mesmo jeito do cadastro: lê a tela a cada
 * volta e reage pelo texto (a instância está em pt-PT; às vezes vem inglês).
 *
 * Nenhuma dessas telas foi vista ainda numa conta real (01/11/2026): a que não
 * for reconhecida fica salva em agente-mumu/telas/ e vira pergunta na aba.
 * Foto, story e destaque, se travarem, pedem para o dono terminar à mão — a
 * automação não pode arriscar fazer de novo o que ele fez (story duplicado).
 *
 * ctx = { d, log, ajuda } — ajuda = criarAjuda() de dono.mjs.
 */

const ig = (nome) => `${INSTAGRAM}:id/${nome}`;

export const sortear = (min, max) => Math.round(min + Math.random() * (max - min));

export function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

export const SEGUINTE = ["Seguinte", "Next", "Avançar", "Continuar", "Continue"];
export const CONCLUIR = ["Concluído", "Concluir", "Done", "Guardar", "Save", "Salvar"];
const PULAR = ["Agora não", "Not now", "Ignorar", "Skip", "Pular", "Não permitir", "Don't allow", "Don’t allow", "Entendi", "Got it", "OK"];
const SEGUIR = ["Seguir", "Follow", "Seguir também", "Follow back", "Seguir de volta"];
const SEGUINDO = ["A seguir", "Following", "Seguindo", "Pedido feito", "Requested", "Solicitado", "Pedido enviado"];
export const EDITAR_PERFIL = ["Editar perfil", "Edit profile"];

/** Galeria e câmera liberadas antes: foto e story não param no pedido do Android. */
const PERMISSOES = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
];

function botao(nos, textos) {
  return acharTexto(nos, textos, { exato: true });
}

const doInstagram = (nos) => nos.some((n) => n.pacote === INSTAGRAM);
const doSistema = (nos) => nos.some((n) => /permissioncontroller|packageinstaller|vpndialogs/.test(n.pacote));
const campoDeTexto = (nos) => nos.find((n) => /EditText/.test(n.classe) && n.pacote === INSTAGRAM) ?? null;

/** Barra de abas à vista: logado e numa tela principal (a mesma conta que o cadastro usa para "chegou no início"). */
export function temBarra(nos) {
  return (
    temTexto(nos, ["Página inicial", "Home", "Início"], { exato: true }) &&
    temTexto(nos, ["Pesquisar e explorar", "Search and explore", "Explorar", "Reels"])
  );
}

const ABAS = {
  inicio: { id: "feed_tab", textos: ["Página inicial", "Home", "Início"] },
  pesquisa: { id: "search_tab", textos: ["Pesquisar e explorar", "Search and explore", "Pesquisar", "Search", "Explorar", "Explore"] },
  reels: { id: "clips_tab", textos: ["Reels"] },
  perfil: { id: "profile_tab", textos: ["Perfil", "Profile", "O teu perfil", "Your profile"] },
};

export function acharAba(nos, aba) {
  const def = ABAS[aba];
  const porId = acharId(nos, ig(def.id));
  if (porId) return porId;
  const fundo = Math.max(0, ...nos.map((n) => n.y));
  const naBarra = nos.filter((n) => n.y > fundo - 120);
  const porTexto = naBarra.find((n) => def.textos.some((t) => casa(n, t, true)));
  if (porTexto) return porTexto;
  // O perfil às vezes vem com o @ como descrição: é a última aba à direita.
  if (aba === "perfil" && temBarra(nos)) return naBarra.filter((n) => n.clicavel).sort((a, b) => b.x - a.x)[0] ?? null;
  return null;
}

function ehBloqueio(nos) {
  return (
    temTexto(nos, ["Ação bloqueada", "Action blocked"]) ||
    (temTexto(nos, ["Tenta novamente mais tarde", "Tente novamente mais tarde", "Try again later"]) &&
      temTexto(nos, ["restring", "restrict", "proteger a nossa comunidade", "protect our community"]))
  );
}

/** Primeira mídia da galeria do Instagram (a mais nova: a que o agente acabou de pôr). */
function primeiraMidia(nos) {
  return (
    nos
      .filter(
        (n) =>
          n.clicavel &&
          n.pacote === INSTAGRAM &&
          (/gallery|thumbnail|media_picker|grid_item|media_item/i.test(n.id) || /^(foto|photo|vídeo|video|imagem|image)\b/i.test(n.descricao)) &&
          !/câmara|câmera|camera/i.test(`${n.descricao} ${n.id}`)
      )
      .sort((a, b) => a.y - b.y || a.x - b.x)[0] ?? null
  );
}

/** Telas que podem aparecer em qualquer ponto: avisos que param tudo, pedidos ao dono e pop-ups. */
function telasGerais({ d, ajuda }) {
  return [
    {
      nome: "suspensa",
      teste: (nos) =>
        temTexto(nos, ["suspendemos a tua conta", "We suspended your account", "A tua conta foi suspensa", "has been suspended", "A tua conta foi desativada", "has been disabled", "desativámos a tua conta"]),
      agir: (nos) => {
        salvarTela(nos, "conta suspensa");
        throw new Error(`O Instagram suspendeu ou desativou a conta (${resumoTela(nos)}).`);
      },
    },
    {
      nome: "verificacao-telefone",
      teste: (nos) =>
        temTexto(nos, ["Insere o teu número de telemóvel", "Enter your mobile number", "Insira seu número de celular", "Insira o seu número de celular"]) &&
        temTexto(nos, ["SMS", "WhatsApp"]),
      agir: (nos) => {
        salvarTela(nos, "verificação por telefone");
        throw new Error("O Instagram está pedindo um número de telefone nessa conta.");
      },
    },
    {
      nome: "bloqueio",
      teste: ehBloqueio,
      agir: (nos) => {
        salvarTela(nos, "ação bloqueada");
        throw new Error(`O Instagram bloqueou a ação (${resumoTela(nos)}).`);
      },
    },
    {
      nome: "verificacao",
      teste: (nos) =>
        temTexto(nos, ["Confirma que és tu", "Confirm it's you", "Confirme que é você", "reCAPTCHA", "não és um robô", "not a robot", "Ajuda-nos a confirmar", "Help us confirm"]),
      agir: (nos) => ajuda.manual(`O Instagram pediu uma verificação (${resumoTela(nos)}).`, nos),
    },
    {
      nome: "sessao",
      teste: (nos) =>
        temTexto(nos, ["Continuar como", "Continue as"]) ||
        (botao(nos, ["Iniciar sessão", "Log in", "Entrar"]) && temTexto(nos, ["Palavra-passe", "Password", "Senha"])),
      agir: (nos) => ajuda.manual("A conta saiu do Instagram: entre nela na instância.", nos),
    },
    {
      nome: "salvar-login",
      teste: (nos) =>
        temTexto(nos, ["Guardar as tuas informações", "Save your login info", "Salvar suas informações", "Guardar informações de início"]) &&
        botao(nos, ["Guardar", "Save", "Salvar"]),
      agir: (nos, alvo) => tocarNo(d, alvo, 3000),
    },
    {
      // Pedido do Android: mídia/câmera libera (já vem liberado pelo pm grant); o resto (notificação) recusa.
      nome: "permissao",
      teste: (nos) => {
        if (!nos.some((n) => /permissioncontroller/.test(n.pacote))) return null;
        const midia = temTexto(nos, ["foto", "photo", "vídeo", "video", "multimédia", "media", "câmara", "câmera", "camera", "microfone", "microphone", "áudio", "audio"]);
        return midia
          ? botao(nos, ["Permitir tudo", "Allow all", "Permitir", "Allow", "Durante a utilização da app", "While using the app", "Só desta vez", "Only this time"])
          : botao(nos, ["Não permitir", "Don't allow", "Don’t allow"]);
      },
      agir: (nos, alvo) => tocarNo(d, alvo, 2000),
    },
    {
      nome: "pular",
      teste: (nos) => doInstagram(nos) && botao(nos, PULAR),
      agir: (nos, alvo) => tocarNo(d, alvo, 2500),
    },
  ];
}

/**
 * Lê a tela até `fim(nos)` devolver a mensagem da etapa. Em cada volta usa a
 * primeira tela conhecida (as do fluxo, depois as gerais); `agir` que devolve
 * texto encerra com ele. Tela que não avança 4 vezes ou desconhecida 3 vezes
 * seguidas vai para `travou` (padrão: o dono resolve e a automação segue);
 * `travou` que devolve texto também encerra.
 */
export async function percorrer(ctx, { nome, telas, fim, limiteMs, travou }) {
  const { d, log, ajuda } = ctx;
  const todas = [...telas, ...telasGerais(ctx)];
  const parar = travou ?? ((texto, nos) => ajuda.manual(texto, nos));
  const estado = { ultima: null, repeticoes: 0, desconhecidas: 0 };
  const limite = Date.now() + limiteMs;

  while (Date.now() < limite) {
    const nos = await d.tela().catch(() => []);
    if (nos.length === 0) {
      await esperar(2000);
      continue;
    }
    const pronto = fim(nos);
    if (pronto) return pronto;

    let achou = null;
    for (const tela of todas) {
      const alvo = tela.teste(nos);
      if (alvo) {
        achou = { tela, alvo };
        break;
      }
    }
    if (achou) {
      const { tela, alvo } = achou;
      estado.repeticoes = estado.ultima === tela.nome ? estado.repeticoes + 1 : 0;
      estado.ultima = tela.nome;
      estado.desconhecidas = 0;
      if (estado.repeticoes >= 4) {
        estado.repeticoes = 0;
        estado.ultima = null;
        const saida = await parar(`A tela "${tela.nome}" não avançou (${resumoTela(nos)}).`, nos);
        if (typeof saida === "string" && saida) return saida;
        continue;
      }
      log(`tela: ${tela.nome}`);
      const saida = await tela.agir(nos, alvo);
      if (typeof saida === "string" && saida) return saida;
      continue;
    }

    if (!doInstagram(nos) && !doSistema(nos)) {
      log("fora do Instagram: abrindo de novo");
      await d.abrirApp(INSTAGRAM);
      await esperar(6000);
      continue;
    }
    estado.desconhecidas += 1;
    if (estado.desconhecidas < 3) {
      await esperar(2500);
      continue;
    }
    estado.desconhecidas = 0;
    const saida = await parar(`Tela que eu ainda não conheço: ${resumoTela(nos) || "sem texto"}.`, nos);
    if (typeof saida === "string" && saida) return saida;
  }
  throw new Error(`${nome} passou de ${Math.round(limiteMs / 60_000)} min sem terminar.`);
}

/** Uma volta das telas gerais (pop-up, aviso); true = tratou alguma. */
export async function tratarGeral(ctx, nos) {
  for (const tela of telasGerais(ctx)) {
    const alvo = tela.teste(nos);
    if (!alvo) continue;
    ctx.log(`tela: ${tela.nome}`);
    await tela.agir(nos, alvo);
    return true;
  }
  return false;
}

/**
 * Antes de desligar, o Instagram é forçado a parar: app parado não acorda
 * sozinho no boot, e o container só liga com o sidecar (sem proxy gravada,
 * bloqueado: nada sai). O Android leva uns segundos para gravar o estado.
 */
export async function pararInstagram(d) {
  await d.fecharApp(INSTAGRAM).catch(() => {});
  await esperar(10_000);
}

/** A proxy do container está de pé (sidecar em modo proxy)? */
export async function proxyLigada(d) {
  if (d.index === null || d.index === undefined) return false;
  return proxyAtiva(`ig-${d.index}`);
}

/** No meio da atividade: o sidecar caiu? Para o Instagram na hora (o kill switch já segura a rede) e encerra a etapa. */
export async function garantirProxy(d) {
  if (await proxyLigada(d)) return;
  await d.fecharApp(INSTAGRAM).catch(() => {});
  throw new Error("A proxy do container caiu: parei o Instagram. Clique em Continuar.");
}

/** Abre o Instagram do zero (já com a proxy ligada) e espera a barra de abas: a conta está logada. */
export async function abrirInstagram(ctx) {
  const { d } = ctx;
  await d.fecharApp(INSTAGRAM);
  for (const p of PERMISSOES) await d.shell("pm", "grant", INSTAGRAM, p).catch(() => {});
  await d.abrirApp(INSTAGRAM);
  await esperar(8000);
  return percorrer(ctx, {
    nome: "Abrir o Instagram",
    limiteMs: 10 * 60_000,
    telas: [],
    fim: (nos) => (temBarra(nos) ? "logado" : null),
  });
}

/**
 * Abre o Instagram do zero e espera só o app aparecer na tela (sem exigir a
 * barra de abas): quem diz se a conta está logada é conferirSessao.
 */
export async function iniciarInstagram(ctx) {
  const { d } = ctx;
  await d.fecharApp(INSTAGRAM);
  for (const p of PERMISSOES) await d.shell("pm", "grant", INSTAGRAM, p).catch(() => {});
  await d.abrirApp(INSTAGRAM);
  await esperarTela(d, (nos) => (doInstagram(nos) ? nos : null), { timeoutMs: 60_000, intervaloMs: 1000, descricao: "o Instagram abrir" });
  return "Instagram aberto";
}

/**
 * Estado da sessão pelo dump da tela inicial: "logada" (barra de navegação ou
 * o @ da conta na tela), "deslogada" (tela de login ou "Continuar como") ou
 * "indefinida" (pop-up, tela carregando).
 */
export function estadoDaSessao(nos, usuario) {
  const arroba = String(usuario ?? "").replace(/^@/, "").toLowerCase();
  const doApp = nos.filter((n) => n.pacote === INSTAGRAM);
  if (temBarra(nos)) return "logada";
  if (arroba && doApp.some((n) => [n.texto, n.descricao].some((v) => v.trim().toLowerCase().replace(/^@/, "") === arroba))) return "logada";
  const entrar = botao(doApp, ["Iniciar sessão", "Log in", "Entrar"]);
  const login = entrar && temTexto(doApp, ["Palavra-passe", "Password", "Senha", "Criar nova conta", "Create new account", "Esqueceu a senha", "Forgot password"]);
  if (login || temTexto(doApp, ["Continuar como", "Continue as"])) return "deslogada";
  return "indefinida";
}

/**
 * Antes de mexer na conta: confere que ela está logada. Tela de login, ou 90 s
 * sem a barra nem o @, = SESSAO_PERDIDA (o job para; a conta não é descartada).
 */
export async function conferirSessao(ctx, usuario, { timeoutMs = 90_000 } = {}) {
  const { d } = ctx;
  const perdida = (motivo, nos) => {
    if (nos?.length) salvarTela(nos, `sessão perdida: ${motivo}`);
    const erro = new Error(`${SESSAO_PERDIDA}: ${motivo}`);
    erro.semPrefixo = true;
    return erro;
  };
  const limite = Date.now() + timeoutMs;
  let nos = [];
  for (;;) {
    nos = await d.tela().catch(() => []);
    const estado = nos.length > 0 ? estadoDaSessao(nos, usuario) : "indefinida";
    if (estado === "logada") return temBarra(nos) ? "logada (barra de navegação)" : `logada (@${String(usuario).replace(/^@/, "")} na tela)`;
    if (estado === "deslogada") throw perdida(`o Instagram abriu na tela de login (${resumoTela(nos)})`, nos);
    if (Date.now() > limite) throw perdida(`sem a barra de navegação nem o @ em ${Math.round(timeoutMs / 1000)} s (na tela: ${resumoTela(nos) || "sem leitura"})`, nos);
    // Pop-up por cima (salvar login, permissão, "Agora não"): trata e relê.
    if (nos.length === 0 || !(await tratarGeral(ctx, nos))) await esperar(1000);
  }
}

/** Vai para uma aba (inicio, pesquisa, reels, perfil), fechando o que estiver por cima. */
/**
 * Centro de cada aba na barra de baixo em 1080x1920 (RESOLUCAO/DPI fixos de lib/vps/device.ts):
 * 5 abas de 216 px; barra de ~131 px acima da navegação do sistema (app=1080x1794).
 * Usado quando o uiautomator não lê o feed (vídeo tocando: dump vazio ou travado — ig-6, 08/11).
 */
// Ordem desta build (454, medida no ig-6): início, reels, mensagens, pesquisa, perfil.
const ABA_XY = { inicio: [108, 1731], reels: [324, 1731], pesquisa: [756, 1731], perfil: [972, 1731] };

export async function irPara(ctx, aba, { porMudanca = false } = {}) {
  const { d, log = () => {} } = ctx;
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const nos = await d.tela().catch(() => []);
    const alvo = acharAba(nos, aba);
    if (alvo) {
      // porMudanca (foto, bio, story, destaque): espera a tela reagir ao toque em vez da pausa fixa.
      if (porMudanca) await tocarAteMudar(d, alvo, nos, { timeoutMs: 4000 });
      else await tocarNo(d, alvo, 2500);
      return;
    }
    // Feed sem leitura (dump vazio) mas com o Instagram na frente: toca a aba pela posição fixa da barra.
    if (nos.length === 0 || !doInstagram(nos)) {
      const foco = await d.focoAtual();
      if (/com\.instagram\.android\/.*MainTabActivity/.test(foco) && ABA_XY[aba]) {
        log(`aba ${aba} pela posição (tela sem leitura)`);
        await d.tocar(...ABA_XY[aba]);
        await esperar(2500);
        return;
      }
    }
    if (nos.length > 0 && !doInstagram(nos) && !doSistema(nos)) {
      await d.abrirApp(INSTAGRAM);
      await esperar(6000);
      continue;
    }
    if (nos.length > 0 && (await tratarGeral(ctx, nos))) continue;
    await d.tecla("KEYCODE_BACK");
    await esperar(1500);
  }
  throw new Error(`Não achei a aba ${aba} do Instagram.`);
}

/** Texto do botão (às vezes fica num filho na mesma posição). */
function rotuloEm(nos, no) {
  if (no.texto || no.descricao) return no.texto || no.descricao;
  return nos.find((n) => n.texto && Math.abs(n.x - no.x) < 30 && Math.abs(n.y - no.y) < 30)?.texto ?? "";
}

/** Botão Seguir/A seguir do topo do perfil (não os das sugestões, mais abaixo). */
export function botaoDoPerfil(nos) {
  const porId = acharId(nos, ig("profile_header_follow_button"));
  if (porId) return porId;
  return (
    nos
      .filter((n) => (n.clicavel || /Button/.test(n.classe)) && [...SEGUIR, ...SEGUINDO].some((t) => casa(n, t, true)))
      .sort((a, b) => a.y - b.y)[0] ?? null
  );
}

const ehUm = (rotulo, lista) => lista.some((t) => t.toLowerCase() === rotulo.toLowerCase());

/**
 * "290 M seguidores", "1,2 M", "850 mil": conta grande (100 mil ou mais).
 * null = a linha não mostra seguidores (aí vale a lista, que já é de famosos).
 */
export function contaGrande(texto) {
  // "241 miseguidores" (content-desc do cabeçalho do perfil vem com a unidade colada na palavra).
  const t = String(texto ?? "")
    .toLowerCase()
    .replace(/(mil|mi|m|k)(seguidores|followers)/, "$1 $2");
  if (!/seguidores|followers/.test(t)) return null;
  const m = /([\d.,]+)\s*(mil|mi|m|k)\b/.exec(t);
  if (!m) return false;
  const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return m[2] === "mil" || m[2] === "k" ? n >= 100 : true;
}

/**
 * Pesquisa o @ e segue. Vista na 1ª conta real (02/11): a linha do resultado já
 * traz o Seguir (row_search_user_follow_button) e o nome com os seguidores
 * ("Nike • 290 M seguidores"), e tocar no @ nem sempre abria o perfil a tempo.
 * Então segue da própria pesquisa; sem Seguir na linha, abre o perfil.
 * Devolve "seguiu" ou o motivo de ter pulado.
 */
async function seguirPorPesquisa(ctx, usuario) {
  const { d, log = () => {} } = ctx;
  const acharCampo = (nos) =>
    campoDeTexto(nos) ?? acharId(nos, ig("action_bar_search_edit_text")) ?? acharTexto(nos, ["Pesquisar", "Search", "Pesquisa"], { exato: true });
  // Na grade do Explorar (reels tocando) o uiautomator ora devolve "null root node", ora a janela do launcher
  // por trás (ig-6, 08/11): só vale leitura com nós do Instagram; o foco (dumpsys) diz se ele está na frente.
  const lerIg = async () => {
    const nos = await d.tela().catch(() => []);
    return nos.some((n) => n.pacote === INSTAGRAM) ? nos : [];
  };
  const igNaFrente = async () => /com\.instagram\.android\//.test(await d.focoAtual());

  // Caminho do dono: pesquisar o @, abrir a conta (ou a aba Contas) e tocar em Seguir — nada de deep link.
  await irPara(ctx, "pesquisa");
  let nos = await lerIg();
  if (!acharCampo(nos)) {
    if (!(await igNaFrente())) {
      await d.abrirApp(INSTAGRAM);
      await esperar(6000);
      await irPara(ctx, "pesquisa");
    }
    // A barra "Pesquisar" fica fixa no topo do Explorar (1080x1920): toque pela posição, sem depender da leitura.
    log("pesquisa: barra pela posição");
    await d.tocar(540, 133);
    await esperar(3000);
    nos = await lerIg();
  }
  let campo = acharCampo(nos);
  if (campo && !/EditText/.test(campo.classe)) {
    await tocarNo(d, campo, 1500);
    campo = await esperarTela(d, campoDeTexto, { timeoutMs: 10_000, descricao: "o campo da pesquisa" }).catch(() => null);
  }
  if (campo) {
    await preencher(d, campo, usuario);
  } else {
    // Tela de digitar sem leitura: o foco já é o campo da pesquisa; digita direto e lê os resultados.
    if (!(await igNaFrente())) throw new Error("o Instagram saiu da frente ao abrir a pesquisa");
    log("pesquisa: campo sem leitura, digitando direto");
    await d.digitar(usuario);
  }
  const topoLista = campo?.y ?? 150;
  await esperar(sortear(3000, 5000));

  // A lista que aparece ao digitar tem a sugestão de pesquisa (o termo, com a lupa) e as contas.
  // Pedido do dono (02/11): tocar na CONTA (row_search_user_username), não na sugestão — ela abre
  // a página de resultados e atrasava tudo.
  const alvoUsuario = usuario.toLowerCase();
  const acharConta = (lista) => lista.find((n) => n.id === ig("row_search_user_username") && n.texto.toLowerCase() === alvoUsuario) ?? null;
  nos = await d.tela();
  let linha = acharConta(nos);
  if (!linha) {
    await esperar(2500);
    nos = await d.tela();
    linha = acharConta(nos);
  }
  if (!linha) {
    // Só veio a sugestão: abre o resultado e vai na aba "Contas" (em "Para ti" a lista de contas pode vir vazia).
    const termo = nos.find((n) => n.texto.toLowerCase() === alvoUsuario && n.y > topoLista + 20);
    if (!termo) return "não apareceu na pesquisa";
    await tocarNo(d, termo, 3000);
    nos = await d.tela();
    const abaContas = nos.find((n) => n.clicavel && /^(Contas|Accounts)\b/i.test(n.descricao) && /TabWidget/.test(n.classe));
    if (abaContas) {
      await tocarNo(d, abaContas, sortear(2500, 4000));
      nos = await d.tela();
    }
    linha = acharConta(nos);
    if (!linha) return "não apareceu na pesquisa";
  }
  const mesmaLinha = (n) => Math.abs(n.y - linha.y) < 60;
  const resumo = nos.find((n) => n.id === ig("row_search_user_fullname") && mesmaLinha(n))?.texto ?? "";
  if (contaGrande(resumo) === false) return `conta pequena (${resumo})`;

  let tela = nos;
  let alvo = nos.find((n) => n.id === ig("row_search_user_follow_button") && mesmaLinha(n));
  if (alvo) {
    await esperar(sortear(2000, 5000)); // olha o resultado antes de seguir
  } else {
    await tocarNo(d, linha, 4000);
    tela = await esperarTela(d, (n) => (botaoDoPerfil(n) ? n : null), { timeoutMs: 20_000, descricao: `o perfil @${usuario}` }).catch(() => null);
    if (!tela) return "o perfil não abriu";
    alvo = botaoDoPerfil(tela);
    await esperar(sortear(3000, 8000)); // olha o perfil antes de seguir
  }
  const rotulo = rotuloEm(tela, alvo);
  if (ehUm(rotulo, SEGUINDO)) return "já seguia";
  if (!ehUm(rotulo, SEGUIR)) return `botão desconhecido (${rotulo || "sem texto"})`;

  await tocarNo(d, alvo, 3000);
  const depois = await d.tela().catch(() => []);
  if (ehBloqueio(depois)) {
    salvarTela(depois, "seguir bloqueado");
    throw new Error(`O Instagram bloqueou o seguir (${resumoTela(depois)}).`);
  }
  await tratarGeral(ctx, depois);
  return "seguiu";
}

/** `am start` do deep link do perfil (sem passar pelo Explorar, que derruba o Instagram no x86). */
export function comandoDeepLink(usuario) {
  return ["am", "start", "-a", "android.intent.action.VIEW", "-d", `instagram://user?username=${usuario}`, "-p", INSTAGRAM, "-f", "0x20000000"];
}

/**
 * Abre o perfil pelo deep link e espera o botão Seguir/Seguindo aparecer no
 * dump (até 20 s). Devolve a tela do perfil ou null (deep link falhou ou a
 * página não carregou).
 */
export async function abrirPerfil(ctx, usuario) {
  const { d, log = () => {} } = ctx;
  const saida = await d.shell(...comandoDeepLink(usuario)).catch((e) => {
    log(`deep link @${usuario}: ${e.message}`);
    return null;
  });
  if (saida === null || /Error|Exception|does not exist/i.test(saida)) return null;
  await esperar(sortear(2500, 4500));
  return esperarTela(d, (n) => (botaoDoPerfil(n) ? n : null), { timeoutMs: 20_000, descricao: `o perfil @${usuario}` }).catch(() => null);
}

/**
 * Segue um perfil: deep link primeiro; se a página não carregar, tenta a
 * pesquisa uma vez; falhando, devolve o motivo e o chamador pula o verificado.
 * Depois do toque confirma que o botão virou "Seguindo".
 */
export async function seguirUm(ctx, usuario, { abrir = abrirPerfil, porPesquisa = seguirPorPesquisa } = {}) {
  const { d, log = () => {} } = ctx;
  const tela = await abrir(ctx, usuario);
  if (!tela) {
    log(`@${usuario}: deep link não abriu o perfil em 20 s, tentando a pesquisa`);
    try {
      return await porPesquisa(ctx, usuario);
    } catch (e) {
      if (/bloqueou|suspendeu|telefone/.test(e.message)) throw e;
      return `falhou na pesquisa: ${e.message}`;
    }
  }
  const seguidores = tela.find((n) => /seguidores|followers/i.test(n.descricao + " " + n.texto) && /[0-9]/.test(n.descricao + " " + n.texto));
  const resumo = seguidores ? seguidores.descricao || seguidores.texto : "";
  if (contaGrande(resumo) === false) return `conta pequena (${resumo})`;
  const alvo = botaoDoPerfil(tela);
  const rotulo = rotuloEm(tela, alvo);
  if (ehUm(rotulo, SEGUINDO)) return "já seguia";
  if (!ehUm(rotulo, SEGUIR) && !/^(Seguir|Follow)/i.test(alvo.descricao)) return `botão desconhecido (${rotulo || "sem texto"})`;
  await esperar(sortear(3000, 8000)); // olha o perfil antes de seguir
  await tocarNo(d, alvo, 3000);
  const depois = await d.tela().catch(() => []);
  if (ehBloqueio(depois)) {
    salvarTela(depois, "seguir bloqueado");
    throw new Error(`O Instagram bloqueou o seguir (${resumoTela(depois)}).`);
  }
  await tratarGeral(ctx, depois);
  const confirmado = botaoDoPerfil(depois);
  const rotuloDepois = confirmado ? rotuloEm(depois, confirmado) : "";
  if (ehUm(rotuloDepois, SEGUINDO) || /^(Seguindo|A seguir|Following|Pedido|Requested)/i.test(confirmado?.descricao ?? "")) return "seguiu";
  return rotuloDepois ? `seguiu (botão: ${rotuloDepois})` : "seguiu";
}

/**
 * Rola a página aberta (grade do perfil ou feed) por `ms`, alternando a
 * direção, sem tocar em nada. Confere que o Instagram segue na frente; se ele
 * caiu, reabre e para de rolar.
 */
export async function rolarPerfil(ctx, ms) {
  const { d, log = () => {} } = ctx;
  const { largura, altura } = await d.tamanho().catch(() => ({ largura: 1080, altura: 1920 }));
  const fim = Date.now() + ms;
  let passos = 0;
  while (Date.now() < fim) {
    const paraCima = passos % 3 !== 2; // dois para baixo (conteúdo sobe), um de volta
    const x = Math.round(largura / 2) + sortear(-120, 120);
    const yA = Math.round(altura * (paraCima ? 0.7 : 0.35)) + sortear(-40, 40);
    const yB = Math.round(altura * (paraCima ? 0.35 : 0.7)) + sortear(-40, 40);
    await d.arrastar(x, yA, x + sortear(-20, 20), yB, sortear(350, 700));
    passos += 1;
    await esperar(Math.min(sortear(2500, 6000), Math.max(0, fim - Date.now())));
    if (passos % 3 === 0 && !/com\.instagram\.android\//.test(await d.focoAtual())) {
      log("o Instagram saiu da frente durante a rolagem: reabrindo");
      await d.abrirApp(INSTAGRAM);
      await esperar(6000);
      return { passos, caiu: true };
    }
  }
  return { passos, caiu: false };
}

/**
 * Segue `quantos` perfis sorteados da lista (deep link), rolando a grade do
 * perfil por ~25 s entre um e outro. Lista de famosos; a página ainda confere
 * que a conta é grande.
 */
export async function seguirVerificados(ctx, lista, quantos) {
  const { log } = ctx;
  const fila = embaralhar(lista);
  const seguidos = [];
  let tentativas = 0;
  while (seguidos.length < quantos && fila.length > 0 && tentativas < quantos + 8) {
    tentativas += 1;
    const usuario = fila.shift();
    let resultado;
    try {
      resultado = await seguirUm(ctx, usuario);
    } catch (e) {
      if (/bloqueou|suspendeu|telefone/.test(e.message)) throw e;
      resultado = `falhou: ${e.message}`;
    }
    log(`@${usuario}: ${resultado}`);
    if (resultado.startsWith("seguiu")) {
      seguidos.push(usuario);
      if (seguidos.length < quantos) await rolarPerfil(ctx, sortear(20_000, 30_000));
    }
  }
  await irPara(ctx, "inicio").catch(() => {});
  if (seguidos.length === 0) throw new Error("Não consegui seguir nenhum perfil da lista.");
  return `seguiu ${seguidos.map((u) => `@${u}`).join(", ")}`;
}

/**
 * Aquecimento sem Explorar/Reels (a grade de reels derruba o Instagram no x86):
 * alterna ~25 s rolando a grade de um perfil verificado (deep link) e ~25 s
 * rolando o feed inicial, enquanto o feed não derrubar o app. Devolve o resumo.
 */
export async function rolarReels(ctx, ms) {
  const { log = () => {} } = ctx;
  const fim = Date.now() + ms;
  const fila = embaralhar(VERIFICADOS_AQUECIMENTO);
  let perfis = 0;
  let feed = 0;
  let feedOk = true;
  while (Date.now() < fim) {
    const usuario = fila.shift() ?? "instagram";
    const tela = await abrirPerfil(ctx, usuario);
    if (tela) {
      const r = await rolarPerfil(ctx, Math.min(25_000, Math.max(5000, fim - Date.now())));
      perfis += 1;
      log(`rolou o perfil @${usuario} (${r.passos} arrastos)`);
      if (r.caiu) continue;
    } else {
      log(`@${usuario}: perfil não abriu, pulando`);
    }
    if (Date.now() >= fim) break;
    if (feedOk) {
      await irPara(ctx, "inicio").catch(() => {});
      const r = await rolarPerfil(ctx, Math.min(25_000, Math.max(5000, fim - Date.now())));
      if (r.caiu) {
        feedOk = false;
        log("o feed derrubou o Instagram: o resto do aquecimento fica só nos perfis");
      } else {
        feed += 1;
      }
    }
  }
  await irPara(ctx, "inicio").catch(() => {});
  return `${perfis} perfil(is) e ${feed} rodada(s) de feed em ${Math.round(ms / 60_000)} min`;
}

/**
 * Toque dos fluxos de foto, bio, story e destaque: toca e espera a tela reagir
 * (dump diferente), com nova tentativa se nada mudou — sem pausa fixa. `unico`
 * = toque que não pode repetir (publicar, salvar): uma tentativa só, com mais tempo.
 */
function toque(d, nos, alvo, { unico = false, timeoutMs } = {}) {
  return tocarAteMudar(d, alvo, nos, { tentativas: unico ? 1 : 2, timeoutMs: timeoutMs ?? (unico ? 15_000 : 6_000) });
}

/** Fecha o teclado (BACK) e espera a tela mudar; devolve a tela de depois. */
async function fecharTeclado(d) {
  const antes = await d.tela().catch(() => []);
  await d.tecla("KEYCODE_BACK").catch(() => {});
  return (await esperarMudar(d, antes, { timeoutMs: 3000 })) ?? (await d.tela().catch(() => []));
}

/** Perfil → Editar perfil → Editar foto → Nova foto → 1ª da galeria → Seguinte → Concluído. */
export async function trocarFoto(ctx) {
  const { d, ajuda } = ctx;
  const estado = { abriuMenu: false, escolheu: false, concluiu: false };
  await irPara(ctx, "perfil", { porMudanca: true });
  return percorrer(ctx, {
    nome: "A troca da foto",
    limiteMs: 8 * 60_000,
    travou: (texto, nos) => ajuda.terminarAMao(texto, nos, "a troca da foto de perfil"),
    fim: (nos) => (estado.concluiu && (temBarra(nos) || temTexto(nos, EDITAR_PERFIL, { exato: true })) ? "foto trocada" : null),
    telas: [
      {
        nome: "concluir",
        teste: (nos) => estado.escolheu && !estado.concluiu && botao(nos, CONCLUIR),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo, { unico: true });
          estado.concluiu = true;
        },
      },
      {
        nome: "seguinte",
        teste: (nos) => estado.escolheu && !estado.concluiu && botao(nos, SEGUINTE),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
      {
        nome: "galeria",
        teste: (nos) => estado.abriuMenu && !estado.escolheu && primeiraMidia(nos),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.escolheu = true;
        },
      },
      {
        nome: "menu-foto",
        teste: (nos) =>
          !estado.abriuMenu &&
          acharTexto(nos, ["Nova foto de perfil", "Nova foto do perfil", "New profile picture", "Escolher da biblioteca", "Choose from library", "Escolher da galeria", "Choose from gallery", "Carregar foto", "Upload photo"]),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.abriuMenu = true;
        },
      },
      {
        nome: "editar-foto",
        teste: (nos) =>
          !estado.abriuMenu &&
          acharTexto(nos, ["Editar foto ou avatar", "Edit picture or avatar", "Alterar foto do perfil", "Change profile photo", "Mudar foto do perfil", "Editar foto", "Edit picture"]),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
      {
        nome: "editar-perfil",
        teste: (nos) => !estado.abriuMenu && botao(nos, EDITAR_PERFIL),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
      {
        nome: "perfil",
        teste: (nos) => !estado.abriuMenu && temBarra(nos) && acharAba(nos, "perfil"),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
    ],
  });
}

/**
 * Perfil → Editar perfil → campos Nome e Bio → Concluído. Só na VPS (etapa
 * "perfil" de fluxos/nova-conta.mjs e "bio" do Estruturar). Campo que não
 * aparecer é pulado.
 */
export async function editarPerfil(ctx, { nome, bio }) {
  const { d, log, ajuda } = ctx;
  const estado = { editando: false, preencheu: false, concluiu: false };
  const campoRotulado = (nos, rotulos) => {
    const rotulo = acharTexto(nos, rotulos, { exato: true });
    if (!rotulo) return null;
    // O EditText fica logo abaixo (ou ao lado) do rótulo.
    return (
      nos
        .filter((n) => /EditText/.test(n.classe) && n.pacote === INSTAGRAM && n.y >= rotulo.y - 20 && n.y <= rotulo.y + 160)
        .sort((a, b) => a.y - b.y)[0] ?? null
    );
  };
  await irPara(ctx, "perfil", { porMudanca: true });
  return percorrer(ctx, {
    nome: "A edição do perfil",
    limiteMs: 6 * 60_000,
    travou: (texto, nos) => ajuda.terminarAMao(texto, nos, "o nome e a bio"),
    fim: (nos) => (estado.concluiu && (temBarra(nos) || botao(nos, EDITAR_PERFIL)) ? "nome e bio preenchidos" : null),
    telas: [
      {
        nome: "concluir",
        teste: (nos) => estado.preencheu && !estado.concluiu && (botao(nos, CONCLUIR) ?? acharId(nos, ig("action_bar_button_action"))),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo, { unico: true, timeoutMs: 10_000 });
          estado.concluiu = true;
        },
      },
      {
        nome: "campos",
        teste: (nos) => estado.editando && !estado.preencheu && (campoRotulado(nos, ["Nome", "Name"]) ?? campoRotulado(nos, ["Bio", "Biografia"])),
        agir: async (nos) => {
          const campoNome = campoRotulado(nos, ["Nome", "Name"]);
          // O nome do cadastro já é o da conta: se a linha já mostra ele, não mexe. Nesta build a linha "Nome" abre
          // uma tela própria e o texto era acrescentado ("Amanda LopesLopes" → pedido de confirmação; ig-7, 09/11).
          const nomeJaCerto = !!nome && nos.some((n) => n.texto.trim().toLowerCase() === nome.trim().toLowerCase());
          if (campoNome && nome && !nomeJaCerto) {
            await preencherEsperando(d, campoNome, nome.slice(0, 64), nos);
            const conf = await fecharTeclado(d);
            // Confirmação "Quer mesmo alterar seu nome para X?": só confirma se X for o nome pedido; senão cancela e sai.
            if (temTexto(conf, ["Quer mesmo alterar seu nome", "alterar o teu nome", "change your name"])) {
              const certo = conf.some((n) => n.texto.includes(`${nome}?`));
              const alvoConf = botao(conf, certo ? ["Alterar nome", "Change name"] : ["Cancelar", "Cancel"]);
              if (alvoConf) await toque(d, conf, alvoConf);
              if (!certo) await fecharTeclado(d);
            }
          }
          const atual = await d.tela();
          const campoBio = campoRotulado(atual, ["Bio", "Biografia"]);
          if (campoBio && bio) {
            await preencherEsperando(d, campoBio, bio.slice(0, 150), atual);
            await fecharTeclado(d);
          } else if (!campoBio) log("não achei o campo Bio: só o nome");
          estado.preencheu = true;
        },
      },
      {
        nome: "editar-perfil",
        teste: (nos) => !estado.editando && botao(nos, EDITAR_PERFIL),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.editando = true;
        },
      },
      {
        nome: "perfil",
        teste: (nos) => !estado.editando && temBarra(nos) && acharAba(nos, "perfil"),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
    ],
  });
}

/**
 * Início → "O teu story" (ou Criar → Story) → galeria → 1ª mídia → Autocolantes
 * → Link → endereço e texto do sticker → Concluído → "O teu story".
 */
export async function postarStory(ctx, { link, texto }) {
  const { d, log, ajuda } = ctx;
  if (!link) throw new Error("A estruturação veio sem o link do story.");
  const estado = { abriu: false, escolheu: false, stickers: false, pesquisou: false, sticker: false, partilhou: false };
  const aMao = (motivo, nos) => ajuda.terminarAMao(motivo, nos, "o story (sticker de link e postar)");
  await irPara(ctx, "inicio", { porMudanca: true });
  return percorrer(ctx, {
    nome: "O story",
    limiteMs: 12 * 60_000,
    travou: aMao,
    fim: (nos) => (estado.partilhou && temBarra(nos) ? "story postado" : null),
    telas: [
      {
        // Voltou para o início com a mídia já escolhida e sem postar: não dá para saber se saiu.
        nome: "sem-saber",
        teste: (nos) => estado.escolheu && !estado.partilhou && temBarra(nos),
        agir: (nos) => aMao("Voltei para o início sem saber se o story saiu (se já saiu, só clique no botão).", nos),
      },
      {
        nome: "link",
        teste: (nos) =>
          !estado.sticker && temTexto(nos, ["Adicionar link", "Add link", "Adicionar ligação", "Add a link", "URL"]) && campoDeTexto(nos),
        agir: async (nos, campo) => {
          await preencherEsperando(d, campo, link, nos);
          let atual = await d.tela();
          if (texto) {
            const personalizar = acharTexto(atual, ["Personalizar texto do sticker", "Customize sticker text", "Personalizar o texto", "Personalizar texto", "Customize text"]);
            if (personalizar) {
              atual = (await toque(d, atual, personalizar)) ?? (await d.tela());
              const campos = atual.filter((n) => /EditText/.test(n.classe));
              const campoTexto = campos.find((n) => !/^https?:/i.test(n.texto) && n.texto !== link.replace(/^https?:\/\//i, "")) ?? campos[campos.length - 1];
              if (campoTexto) await preencherEsperando(d, campoTexto, texto, atual);
              atual = await d.tela();
            } else {
              log("não achei Personalizar texto do sticker: fica o endereço");
            }
          }
          const ok = botao(atual, CONCLUIR);
          if (!ok) return;
          await toque(d, atual, ok);
          estado.sticker = true;
        },
      },
      {
        nome: "sticker-link",
        teste: (nos) => estado.stickers && !estado.sticker && botao(nos, ["LINK", "LIGAÇÃO"]),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
      {
        nome: "pesquisar-sticker",
        teste: (nos) => estado.stickers && !estado.sticker && !estado.pesquisou && campoDeTexto(nos),
        agir: async (nos, campo) => {
          await preencherEsperando(d, campo, "link", nos);
          estado.pesquisou = true;
        },
      },
      {
        nome: "stickers",
        teste: (nos) => estado.escolheu && !estado.stickers && acharTexto(nos, ["Autocolantes", "Stickers", "Sticker", "Figurinhas", "Adesivos"], { exato: true }),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.stickers = true;
        },
      },
      {
        nome: "partilhar",
        teste: (nos) =>
          estado.sticker &&
          !estado.partilhou &&
          botao(nos, ["O teu story", "Your story", "Seu story", "A tua história", "Os teus stories", "Your stories", "Partilhar", "Share", "Compartilhar"]),
        agir: async (nos, alvo) => {
          // Publicar não repete: um toque só e até 20 s para a tela sair do editor.
          await toque(d, nos, alvo, { unico: true, timeoutMs: 20_000 });
          estado.partilhou = true;
        },
      },
      {
        nome: "galeria",
        teste: (nos) => estado.abriu && !estado.escolheu && primeiraMidia(nos),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.escolheu = true;
        },
      },
      {
        nome: "abrir-galeria",
        teste: (nos) => estado.abriu && !estado.escolheu && acharTexto(nos, ["Galeria", "Gallery", "Abrir galeria", "Open gallery", "Rolo da câmara", "Camera roll"]),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
      {
        // Tela de criar (abas PUBLICAÇÃO / STORY / REEL) ou o menu do "+".
        nome: "modo-story",
        teste: (nos) => !estado.escolheu && temTexto(nos, ["PUBLICAÇÃO", "POST", "REEL"], { exato: true }) && botao(nos, ["STORY", "HISTÓRIA"]),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.abriu = true;
        },
      },
      {
        nome: "abrir-story",
        teste: (nos) =>
          !estado.abriu && temBarra(nos) && acharTexto(nos, ["O teu story", "Your story", "A tua história", "Seu story", "Adicionar ao story", "Add to story"]),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.abriu = true;
        },
      },
      {
        nome: "criar",
        teste: (nos) => !estado.abriu && temBarra(nos) && acharTexto(nos, ["Criar", "Create", "Nova publicação", "New post"], { exato: true }),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
    ],
  });
}

/** Perfil → Novo (destaques) → o story → Seguinte → nome → Concluído. */
export async function destacarStory(ctx, nome) {
  const { d, ajuda } = ctx;
  if (!nome) throw new Error("A estruturação veio sem o nome do destaque.");
  const estado = { novo: false, escolheu: false, nomeou: false };
  await irPara(ctx, "perfil", { porMudanca: true });
  return percorrer(ctx, {
    nome: "O destaque",
    limiteMs: 8 * 60_000,
    travou: (texto, nos) => ajuda.terminarAMao(texto, nos, `o destaque "${nome}"`),
    fim: (nos) => (estado.nomeou && (temBarra(nos) || botao(nos, EDITAR_PERFIL)) ? `destaque "${nome}" criado` : null),
    telas: [
      {
        nome: "nome",
        teste: (nos) => estado.escolheu && !estado.nomeou && campoDeTexto(nos),
        agir: async (nos, campo) => {
          await preencherEsperando(d, campo, nome, nos);
          const atual = await d.tela();
          const ok = botao(atual, ["Concluído", "Done", "Adicionar", "Add", "Guardar", "Save"]);
          if (!ok) return;
          await toque(d, atual, ok, { unico: true, timeoutMs: 10_000 });
          estado.nomeou = true;
        },
      },
      {
        nome: "seguinte",
        teste: (nos) => estado.escolheu && !estado.nomeou && botao(nos, SEGUINTE),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
      {
        nome: "escolher-story",
        teste: (nos) => estado.novo && !estado.escolheu && primeiraMidia(nos),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.escolheu = true;
        },
      },
      {
        nome: "novo",
        teste: (nos) => !estado.novo && botao(nos, ["Novo", "New"]),
        agir: async (nos, alvo) => {
          await toque(d, nos, alvo);
          estado.novo = true;
        },
      },
      {
        nome: "abrir-destaques",
        teste: (nos) => !estado.novo && acharTexto(nos, ["Destaques dos stories", "Story highlights", "Destaques de stories", "Destaques do story"]),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
      {
        nome: "perfil",
        teste: (nos) => !estado.novo && temBarra(nos) && !botao(nos, EDITAR_PERFIL) && acharAba(nos, "perfil"),
        agir: (nos, alvo) => toque(d, nos, alvo),
      },
    ],
  });
}
