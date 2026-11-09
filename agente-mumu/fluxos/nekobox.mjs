import { esperar } from "../lib/processo.mjs";
import { acharId, acharTexto, esperarTela, preencher, tocarNo } from "./tela.mjs";

/**
 * Proxy HTTP no NekoBox (moe.nb4a, já instalado na instância padrão):
 * Add Profile → Manual Settings → HTTP → Profile Name, Server, Remote Port,
 * Username, Password → Apply → toca no perfil novo → Connect → toca no status
 * para testar ("Success: HTTP handshake took …"). Telas mapeadas em
 * 01/11/2026; cada campo abre uma caixa com o texto e o botão OK.
 */

const NEKO = "moe.nb4a";
const id = (nome) => `${NEKO}:id/${nome}`;
// O NekoBox não é o Instagram: aqui a tela é relida logo, sem ritmo de pessoa.
const RAPIDO_MS = 500;

/** http://usuario:senha@host:porta (o servidor já normalizou) → partes. */
export function lerProxy(url) {
  const u = new URL(url);
  if (!u.hostname || !u.port) throw new Error("Proxy sem host ou porta.");
  return {
    host: u.hostname,
    porta: u.port,
    usuario: decodeURIComponent(u.username),
    senha: decodeURIComponent(u.password),
  };
}

async function campo(d, titulo, valor) {
  const linha = await esperarTela(d, (nos) => acharTexto(nos, [titulo], { exato: true }), {
    intervaloMs: RAPIDO_MS,
    descricao: `o campo ${titulo} do NekoBox`,
  });
  await tocarNo(d, linha, 400);
  const caixa = await esperarTela(d, (nos) => acharId(nos, "android:id/edit"), { intervaloMs: RAPIDO_MS, descricao: `a caixa de ${titulo}` });
  if (valor) await preencher(d, caixa, valor);
  else {
    await tocarNo(d, caixa, 300);
    await d.limparCampo();
  }
  const ok = await esperarTela(d, (nos) => acharId(nos, "android:id/button1"), { intervaloMs: RAPIDO_MS, descricao: "o OK da caixa" });
  await tocarNo(d, ok, 400);
}

export async function configurarProxy(d, proxyUrl, nomePerfil, log) {
  const proxy = lerProxy(proxyUrl);
  await d.fecharApp(NEKO);
  await d.abrirApp(NEKO);

  const adicionar = await esperarTela(d, (nos) => acharId(nos, id("action_add")), {
    timeoutMs: 45_000,
    descricao: "o NekoBox",
  });

  // Perfil com esse nome de uma tentativa anterior (Continuar): edita em vez de criar outro.
  let nos = await d.tela();
  const existente = nos.find((n) => n.id === id("profile_name") && n.texto === nomePerfil);
  if (existente) {
    const editar = nos.filter((n) => n.id === id("edit")).find((n) => Math.abs(n.y - existente.y) < 40);
    await tocarNo(d, editar, 1500);
  } else {
    await tocarNo(d, adicionar, 1200);
    await tocarNo(d, await esperarTela(d, (n) => acharTexto(n, ["Manual Settings"], { exato: true })), 1200);
    await tocarNo(d, await esperarTela(d, (n) => acharTexto(n, ["HTTP"], { exato: true })), 1500);
  }

  await campo(d, "Profile Name", nomePerfil);
  await campo(d, "Server", proxy.host);
  await campo(d, "Remote Port", proxy.porta);
  await campo(d, "Username (Optional)", proxy.usuario);
  await campo(d, "Password (Optional)", proxy.senha);
  await tocarNo(d, await esperarTela(d, (n) => acharId(n, id("action_apply")), { descricao: "o Apply" }), 2000);
  log("perfil da proxy salvo");

  // Seleciona o perfil (toque no nome) e conecta.
  nos = await d.tela();
  const perfil = nos.filter((n) => n.id === id("profile_name") && n.texto === nomePerfil).pop();
  if (!perfil) throw new Error("O perfil da proxy não apareceu na lista do NekoBox.");
  await tocarNo(d, perfil, 1200);

  nos = await d.tela();
  const fab = acharId(nos, id("fab"));
  if (fab && /connect/i.test(fab.descricao)) await tocarNo(d, fab, 2500);

  // Primeira conexão de VPN pede permissão ao Android (na padrão já vem liberada).
  nos = await d.tela();
  if (nos.some((n) => n.pacote === "com.android.vpndialogs")) {
    const ok = acharId(nos, "android:id/button1");
    if (ok) await tocarNo(d, ok, 2500);
  }

  await esperarTela(d, (n) => acharTexto(n, ["Connected", "Conectado"]), {
    timeoutMs: 30_000,
    descricao: "o NekoBox conectado",
  });
  return testarProxy(d);
}

/** Teste de conexão com o NekoBox na tela: toca no status e espera Success (ou erro). */
export async function testarProxy(d) {
  let ultimo = "";
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const status = acharId(await d.tela(), id("status"));
    if (status) await tocarNo(d, status, 500);
    const resultado = await esperarTela(
      d,
      (n) => {
        const s = acharId(n, id("status"));
        return s && /success|fail|error|erro/i.test(s.texto) ? s.texto : null;
      },
      { timeoutMs: 25_000, descricao: "o teste da proxy" }
    ).catch((e) => e.message);
    if (/success/i.test(resultado)) return `conectado (${resultado.replace(/^Success:\s*/i, "")})`;
    ultimo = resultado;
    await esperar(3000);
  }
  throw new Error(`A proxy não respondeu no teste do NekoBox: ${ultimo}`);
}

/** A VPN do NekoBox está de pé? (interface tun do Android; a tunl0 de sempre não conta) */
export async function vpnLigada(d) {
  const saida = await d.shell("ip link show 2>/dev/null; true").catch(() => "");
  return /^\d+:\s+tun\d+[:@]/m.test(saida);
}

/**
 * Atividade: liga a proxy que já está no NekoBox da instância (o perfil
 * escolhido na criação) e testa. Sem nenhum perfil, para: o Instagram não abre
 * sem proxy.
 */
export async function ligarProxy(d, log) {
  await d.abrirApp(NEKO);
  await esperarTela(d, (nos) => acharId(nos, id("action_add")), { timeoutMs: 45_000, descricao: "o NekoBox" });

  if (!(await vpnLigada(d))) {
    let nos = await d.tela();
    if (!nos.some((n) => n.id === id("profile_name"))) throw new Error("O NekoBox dessa instância não tem nenhuma proxy.");
    const fab = acharId(nos, id("fab"));
    if (!fab) throw new Error("Não achei o botão de conectar do NekoBox.");
    await tocarNo(d, fab, 2500);

    nos = await d.tela();
    if (nos.some((n) => n.pacote === "com.android.vpndialogs")) {
      const ok = acharId(nos, "android:id/button1");
      if (ok) await tocarNo(d, ok, 2500);
    }
    const limite = Date.now() + 30_000;
    while (!(await vpnLigada(d))) {
      if (Date.now() > limite) throw new Error("O NekoBox não conectou em 30 s.");
      await esperar(1500);
    }
    log("NekoBox conectado");
    await esperar(1500);
  }
  return testarProxy(d);
}
