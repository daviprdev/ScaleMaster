import { casa } from "../lib/adb.mjs";
import { esperar } from "../lib/processo.mjs";
import { INSTAGRAM } from "./aurora.mjs";
import { resumoTela, salvarTela } from "./dono.mjs";
import { vpnLigada } from "./nekobox.mjs";
import { acharId, acharTexto, esperarTela, preencher, temTexto, tocarNo } from "./tela.mjs";

/**
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

const SEGUINTE = ["Seguinte", "Next", "Avançar", "Continuar", "Continue"];
const CONCLUIR = ["Concluído", "Concluir", "Done", "Guardar", "Save", "Salvar"];
const PULAR = ["Agora não", "Not now", "Ignorar", "Skip", "Pular", "Não permitir", "Don't allow", "Don’t allow", "Entendi", "Got it", "OK"];
const SEGUIR = ["Seguir", "Follow", "Seguir também", "Follow back", "Seguir de volta"];
const SEGUINDO = ["A seguir", "Following", "Seguindo", "Pedido feito", "Requested", "Solicitado", "Pedido enviado"];
const EDITAR_PERFIL = ["Editar perfil", "Edit profile"];

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
async function percorrer(ctx, { nome, telas, fim, limiteMs, travou }) {
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
async function tratarGeral(ctx, nos) {
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
 * Trava pedida pelo dono (01/11): o Instagram não pode acessar a internet sem a
 * proxy. O "VPN sempre ativa + bloquear sem VPN" do Android não faz efeito no
 * MuMu (testado), então: antes de desligar, o Instagram é forçado a parar — app
 * parado não acorda sozinho no boot (só quando alguém abre) — e o Android leva
 * uns segundos para gravar isso (com 5 s não gravou, com mais de 15 s gravou).
 */
export async function pararInstagram(d) {
  await d.fecharApp(INSTAGRAM).catch(() => {});
  await esperar(20_000);
}

/** No meio da atividade: a proxy caiu? Para o Instagram na hora (não usa a internet do PC) e encerra a etapa. */
export async function garantirProxy(d) {
  if (await vpnLigada(d)) return;
  await d.fecharApp(INSTAGRAM).catch(() => {});
  throw new Error("A proxy do NekoBox caiu: parei o Instagram. Clique em Continuar.");
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

/** Vai para uma aba (inicio, pesquisa, reels, perfil), fechando o que estiver por cima. */
export async function irPara(ctx, aba) {
  const { d } = ctx;
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const nos = await d.tela().catch(() => []);
    const alvo = acharAba(nos, aba);
    if (alvo) {
      await tocarNo(d, alvo, 2500);
      return;
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
function botaoDoPerfil(nos) {
  const porId = acharId(nos, ig("profile_header_follow_button"));
  if (porId) return porId;
  return (
    nos
      .filter((n) => (n.clicavel || /Button/.test(n.classe)) && [...SEGUIR, ...SEGUINDO].some((t) => casa(n, t, true)))
      .sort((a, b) => a.y - b.y)[0] ?? null
  );
}

const ehUm = (rotulo, lista) => lista.some((t) => t.toLowerCase() === rotulo.toLowerCase());

/** Pesquisa o @, abre o perfil e segue. Devolve "seguiu" ou o motivo de ter pulado. */
async function seguirUm(ctx, usuario, { exigirSelo }) {
  const { d } = ctx;
  const acharCampo = (nos) =>
    campoDeTexto(nos) ?? acharId(nos, ig("action_bar_search_edit_text")) ?? acharTexto(nos, ["Pesquisar", "Search", "Pesquisa"], { exato: true });

  await irPara(ctx, "pesquisa");
  let nos = await d.tela();
  // A aba já estava num perfil aberto antes: o 2º toque volta para o começo da pesquisa.
  if (!acharCampo(nos)) {
    await irPara(ctx, "pesquisa");
    nos = await d.tela();
  }
  let campo = acharCampo(nos) ?? (await esperarTela(d, acharCampo, { timeoutMs: 15_000, descricao: "a pesquisa do Instagram" }));
  if (!/EditText/.test(campo.classe)) {
    await tocarNo(d, campo, 1500);
    campo = await esperarTela(d, campoDeTexto, { timeoutMs: 10_000, descricao: "o campo da pesquisa" });
  }
  await preencher(d, campo, usuario);
  await esperar(sortear(3000, 5000));

  nos = await d.tela();
  const linha = nos.find((n) => n.texto.toLowerCase() === usuario.toLowerCase() && n.y > campo.y + 20);
  if (!linha) return "não apareceu na pesquisa";
  await tocarNo(d, linha, 4000);

  const perfil = await esperarTela(d, (n) => (botaoDoPerfil(n) ? n : null), { timeoutMs: 20_000, descricao: `o perfil @${usuario}` }).catch(
    () => null
  );
  if (!perfil) return "o perfil não abriu";
  const alvo = botaoDoPerfil(perfil);
  const rotulo = rotuloEm(perfil, alvo);
  if (ehUm(rotulo, SEGUINDO)) return "já seguia";
  if (!ehUm(rotulo, SEGUIR)) return `botão desconhecido (${rotulo || "sem texto"})`;
  if (exigirSelo && !temTexto(perfil, ["Verificado", "Verificada", "Verified"])) {
    salvarTela(perfil, `perfil @${usuario} sem selo de verificado à vista`);
    return "sem selo de verificado";
  }

  await esperar(sortear(3000, 8000)); // olha o perfil antes de seguir
  await tocarNo(d, alvo, 3000);
  const depois = await d.tela().catch(() => []);
  if (ehBloqueio(depois)) {
    salvarTela(depois, "seguir bloqueado");
    throw new Error(`O Instagram bloqueou o seguir (${resumoTela(depois)}).`);
  }
  await tratarGeral(ctx, depois);
  return "seguiu";
}

/**
 * Segue `quantos` perfis sorteados da lista, com 20–60 s entre um e outro.
 * Confere o selo azul; se 3 perfis seguidos não mostram selo nenhum (o
 * Instagram pode não expor o selo na leitura da tela), confia na lista.
 */
export async function seguirVerificados(ctx, lista, quantos) {
  const { log } = ctx;
  const fila = embaralhar(lista);
  const seguidos = [];
  let semSelo = 0;
  let tentativas = 0;
  while (seguidos.length < quantos && fila.length > 0 && tentativas < quantos + 8) {
    tentativas += 1;
    const usuario = fila.shift();
    let resultado;
    try {
      resultado = await seguirUm(ctx, usuario, { exigirSelo: !(semSelo >= 3 && seguidos.length === 0) });
    } catch (e) {
      if (/bloqueou|suspendeu|telefone/.test(e.message)) throw e;
      resultado = `falhou: ${e.message}`;
    }
    log(`@${usuario}: ${resultado}`);
    if (resultado === "sem selo de verificado") semSelo += 1;
    if (resultado === "seguiu") {
      seguidos.push(usuario);
      if (seguidos.length < quantos) await esperar(sortear(20_000, 60_000));
    }
  }
  await irPara(ctx, "inicio").catch(() => {});
  if (seguidos.length === 0) throw new Error("Não consegui seguir nenhum perfil verificado.");
  return `seguiu ${seguidos.map((u) => `@${u}`).join(", ")}`;
}

/** A cada poucos reels: confere se ainda está nos Reels (pop-up, saiu do app, abriu um perfil). */
async function conferirReels(ctx) {
  const { d, log } = ctx;
  await garantirProxy(d);
  const nos = await d.tela().catch(() => []);
  if (nos.length === 0) return;
  if (!doInstagram(nos) && !doSistema(nos)) {
    log("fora do Instagram: voltando para os Reels");
    await d.abrirApp(INSTAGRAM);
    await esperar(6000);
    await irPara(ctx, "reels");
    return;
  }
  if (await tratarGeral(ctx, nos)) return;
  if (!acharAba(nos, "reels")) {
    log("saiu dos Reels: voltando");
    await irPara(ctx, "reels");
  }
}

/** Rola os Reels por `ms`: cada um de 4 a 20 s (às vezes até o fim), sem curtir nada. */
export async function rolarReels(ctx, ms) {
  const { d } = ctx;
  await irPara(ctx, "reels");
  await esperar(5000);
  const { largura, altura } = await d.tamanho();
  const fim = Date.now() + ms;
  let vistos = 0;
  while (Date.now() < fim) {
    const assistir = Math.random() < 0.15 ? sortear(20_000, 35_000) : sortear(4_000, 20_000);
    await esperar(Math.min(assistir, Math.max(0, fim - Date.now())));
    if (Date.now() >= fim) break;
    if (vistos % 5 === 4) await conferirReels(ctx);
    const x = Math.round(largura / 2) + sortear(-80, 80);
    await d.arrastar(x, Math.round(altura * 0.75) + sortear(-40, 40), x + sortear(-30, 30), Math.round(altura * 0.25) + sortear(-40, 40), sortear(220, 420));
    vistos += 1;
  }
  await irPara(ctx, "inicio").catch(() => {});
  return `${vistos} reels em ${Math.round(ms / 60_000)} min`;
}

/** Perfil → Editar perfil → Editar foto → Nova foto → 1ª da galeria → Seguinte → Concluído. */
export async function trocarFoto(ctx) {
  const { d, ajuda } = ctx;
  const estado = { abriuMenu: false, escolheu: false, concluiu: false };
  await irPara(ctx, "perfil");
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
          await tocarNo(d, alvo, 6000);
          estado.concluiu = true;
        },
      },
      {
        nome: "seguinte",
        teste: (nos) => estado.escolheu && !estado.concluiu && botao(nos, SEGUINTE),
        agir: (nos, alvo) => tocarNo(d, alvo, 3000),
      },
      {
        nome: "galeria",
        teste: (nos) => estado.abriuMenu && !estado.escolheu && primeiraMidia(nos),
        agir: async (nos, alvo) => {
          await tocarNo(d, alvo, 2500);
          estado.escolheu = true;
        },
      },
      {
        nome: "menu-foto",
        teste: (nos) =>
          !estado.abriuMenu &&
          acharTexto(nos, ["Nova foto de perfil", "Nova foto do perfil", "New profile picture", "Escolher da biblioteca", "Choose from library", "Escolher da galeria", "Choose from gallery", "Carregar foto", "Upload photo"]),
        agir: async (nos, alvo) => {
          await tocarNo(d, alvo, 3500);
          estado.abriuMenu = true;
        },
      },
      {
        nome: "editar-foto",
        teste: (nos) =>
          !estado.abriuMenu &&
          acharTexto(nos, ["Editar foto ou avatar", "Edit picture or avatar", "Alterar foto do perfil", "Change profile photo", "Mudar foto do perfil", "Editar foto", "Edit picture"]),
        agir: (nos, alvo) => tocarNo(d, alvo, 2500),
      },
      {
        nome: "editar-perfil",
        teste: (nos) => !estado.abriuMenu && botao(nos, EDITAR_PERFIL),
        agir: (nos, alvo) => tocarNo(d, alvo, 3000),
      },
      {
        nome: "perfil",
        teste: (nos) => !estado.abriuMenu && temBarra(nos) && acharAba(nos, "perfil"),
        agir: (nos, alvo) => tocarNo(d, alvo, 3000),
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
  if (!link) throw new Error("A atividade veio sem o link do story.");
  const estado = { abriu: false, escolheu: false, stickers: false, pesquisou: false, sticker: false, partilhou: false };
  const aMao = (motivo, nos) => ajuda.terminarAMao(motivo, nos, "o story (sticker de link e postar)");
  await irPara(ctx, "inicio");
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
          await preencher(d, campo, link);
          await esperar(1500);
          let atual = await d.tela();
          if (texto) {
            const personalizar = acharTexto(atual, ["Personalizar texto do sticker", "Customize sticker text", "Personalizar o texto", "Personalizar texto", "Customize text"]);
            if (personalizar) {
              await tocarNo(d, personalizar, 1500);
              atual = await d.tela();
              const campos = atual.filter((n) => /EditText/.test(n.classe));
              const campoTexto = campos.find((n) => !/^https?:/i.test(n.texto) && n.texto !== link.replace(/^https?:\/\//i, "")) ?? campos[campos.length - 1];
              if (campoTexto) await preencher(d, campoTexto, texto);
              atual = await d.tela();
            } else {
              log("não achei Personalizar texto do sticker: fica o endereço");
            }
          }
          const ok = botao(atual, CONCLUIR);
          if (!ok) return;
          await tocarNo(d, ok, 3000);
          estado.sticker = true;
        },
      },
      {
        nome: "sticker-link",
        teste: (nos) => estado.stickers && !estado.sticker && botao(nos, ["LINK", "LIGAÇÃO"]),
        agir: (nos, alvo) => tocarNo(d, alvo, 2500),
      },
      {
        nome: "pesquisar-sticker",
        teste: (nos) => estado.stickers && !estado.sticker && !estado.pesquisou && campoDeTexto(nos),
        agir: async (nos, campo) => {
          await preencher(d, campo, "link");
          estado.pesquisou = true;
          await esperar(2500);
        },
      },
      {
        nome: "stickers",
        teste: (nos) => estado.escolheu && !estado.stickers && acharTexto(nos, ["Autocolantes", "Stickers", "Sticker", "Figurinhas", "Adesivos"], { exato: true }),
        agir: async (nos, alvo) => {
          await tocarNo(d, alvo, 2500);
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
          await tocarNo(d, alvo, 8000);
          estado.partilhou = true;
        },
      },
      {
        nome: "galeria",
        teste: (nos) => estado.abriu && !estado.escolheu && primeiraMidia(nos),
        agir: async (nos, alvo) => {
          await tocarNo(d, alvo, 4000);
          estado.escolheu = true;
        },
      },
      {
        nome: "abrir-galeria",
        teste: (nos) => estado.abriu && !estado.escolheu && acharTexto(nos, ["Galeria", "Gallery", "Abrir galeria", "Open gallery", "Rolo da câmara", "Camera roll"]),
        agir: (nos, alvo) => tocarNo(d, alvo, 3000),
      },
      {
        // Tela de criar (abas PUBLICAÇÃO / STORY / REEL) ou o menu do "+".
        nome: "modo-story",
        teste: (nos) => !estado.escolheu && temTexto(nos, ["PUBLICAÇÃO", "POST", "REEL"], { exato: true }) && botao(nos, ["STORY", "HISTÓRIA"]),
        agir: async (nos, alvo) => {
          await tocarNo(d, alvo, 3000);
          estado.abriu = true;
        },
      },
      {
        nome: "abrir-story",
        teste: (nos) =>
          !estado.abriu && temBarra(nos) && acharTexto(nos, ["O teu story", "Your story", "A tua história", "Seu story", "Adicionar ao story", "Add to story"]),
        agir: async (nos, alvo) => {
          await tocarNo(d, alvo, 4000);
          estado.abriu = true;
        },
      },
      {
        nome: "criar",
        teste: (nos) => !estado.abriu && temBarra(nos) && acharTexto(nos, ["Criar", "Create", "Nova publicação", "New post"], { exato: true }),
        agir: (nos, alvo) => tocarNo(d, alvo, 3000),
      },
    ],
  });
}

/** Perfil → Novo (destaques) → o story → Seguinte → nome → Concluído. */
export async function destacarStory(ctx, nome) {
  const { d, ajuda } = ctx;
  if (!nome) throw new Error("A atividade veio sem o nome do destaque.");
  const estado = { novo: false, escolheu: false, nomeou: false };
  await irPara(ctx, "perfil");
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
          await preencher(d, campo, nome);
          const ok = botao(await d.tela(), ["Concluído", "Done", "Adicionar", "Add", "Guardar", "Save"]);
          if (!ok) return;
          await tocarNo(d, ok, 4000);
          estado.nomeou = true;
        },
      },
      {
        nome: "seguinte",
        teste: (nos) => estado.escolheu && !estado.nomeou && botao(nos, SEGUINTE),
        agir: (nos, alvo) => tocarNo(d, alvo, 2500),
      },
      {
        nome: "escolher-story",
        teste: (nos) => estado.novo && !estado.escolheu && primeiraMidia(nos),
        agir: async (nos, alvo) => {
          await tocarNo(d, alvo, 1500);
          estado.escolheu = true;
        },
      },
      {
        nome: "novo",
        teste: (nos) => !estado.novo && botao(nos, ["Novo", "New"]),
        agir: async (nos, alvo) => {
          await tocarNo(d, alvo, 3000);
          estado.novo = true;
        },
      },
      {
        nome: "abrir-destaques",
        teste: (nos) => !estado.novo && acharTexto(nos, ["Destaques dos stories", "Story highlights", "Destaques de stories", "Destaques do story"]),
        agir: (nos, alvo) => tocarNo(d, alvo, 2000),
      },
      {
        nome: "perfil",
        teste: (nos) => !estado.novo && temBarra(nos) && !botao(nos, EDITAR_PERFIL) && acharAba(nos, "perfil"),
        agir: (nos, alvo) => tocarNo(d, alvo, 3000),
      },
    ],
  });
}
