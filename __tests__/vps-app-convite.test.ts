import { describe, expect, it } from "vitest";
import { APP_GLOBAL, errosPorCampo, expandirEtapas, parseEstrutura, resultadoPorAlvo } from "../lib/vps/estruturacao";
import { etapaDoAlvo, motivoParaPular } from "../agente-vps/lib/estrutura.mjs";
import { ESTRUTURACAO } from "../agente-vps/fluxos/estruturacao.mjs";
import { botaoAceitarConvite, linkInvalido, naEscolhaDeApp, opcaoDoApp } from "../agente-vps/fluxos/oauth.mjs";

/** Estruturar com o app escolhido (21/11): convite de testador antes do OAuth, moda antiga. */
const BASE = {
  fotoStory: "story.png",
  bio: "",
  perfil: "@link.zada",
  nomeDestaque: "LINKADA",
  linkStory: "https://exemplo.com/oferta",
  legendaSticker: "",
  legendaDestaque: "",
  agendarHoras: "0",
};
const MIDIAS = ["story.png"];
const UUID = "cb9d3eb4-5db6-4636-b494-b58a4c66545a";

const web = (extra: Record<string, unknown>) => ({ texto: "", descricao: "", id: "", classe: "android.view.View", pacote: "com.instagram.android", clicavel: false, x: 540, y: 900, ...extra });
const webview = web({ classe: "android.webkit.WebView" });

describe("Estruturar: escolha do app", () => {
  it("o app vai no job; sem o campo (API antiga) vale o app global; vazio ou inválido bloqueia", () => {
    const comApp = parseEstrutura({ ...BASE, app: UUID }, MIDIAS);
    expect("value" in comApp && comApp.value.app).toEqual({ chave: UUID, nome: "", igAppId: "" });
    const semCampo = parseEstrutura(BASE, MIDIAS);
    expect("value" in semCampo && semCampo.value.app?.chave).toBe(APP_GLOBAL);
    expect(errosPorCampo({ ...BASE, app: "" }, MIDIAS).app).toMatch(/Escolha o app/);
    expect(errosPorCampo({ ...BASE, app: "x'; drop" }, MIDIAS).app).toMatch(/App inválido/);
    expect(errosPorCampo({ ...BASE, app: APP_GLOBAL }, MIDIAS).app).toBeUndefined();
  });

  it("com app: convite-N entre link-N e conectar-N, e o Conectar leva o nome do app", () => {
    const r = parseEstrutura({ ...BASE, app: UUID }, MIDIAS);
    if (!("value" in r)) throw new Error(r.error);
    const plano = expandirEtapas({ ...r.value, app: { chave: UUID, nome: "APP Scale (PRINCIPAL)", igAppId: "29415721201449674" } });
    const chaves = plano.map((p) => p.key);
    expect(chaves.slice(chaves.indexOf("link-1"), chaves.indexOf("confirmar-1") + 1)).toEqual(["link-1", "convite-1", "conectar-1", "consentir-1", "confirmar-1"]);
    expect(plano.find((p) => p.key === "conectar-1")?.label).toBe('Alvo 1: Conectar pelo app "APP Scale (PRINCIPAL)"');
    // Sem app (jobs antigos): sem convite.
    expect(expandirEtapas({ ...r.value, app: undefined }).map((p) => p.key)).not.toContain("convite-1");
    // O agente conhece a etapa e a falha do convite pula o resto do alvo.
    expect(etapaDoAlvo("convite-1")).toEqual({ tipo: "convite", n: 1 });
    expect(motivoParaPular("conectar-1", new Set(["convite-1"]))).toBe("pulada: convite-1 falhou");
    expect(motivoParaPular("convite-1", new Set(["link-1"]))).toBe("pulada: link-1 falhou");
    const fluxo = ESTRUTURACAO({ ...r.value, plano }) as Array<{ chave: string }>;
    expect(fluxo.map((e) => e.chave)).toEqual(chaves);
    // Card: convite concluído e confirmar concluído = conectado.
    const steps = ["perfil-1", "destaque-1", "link-1", "convite-1", "conectar-1", "consentir-1", "confirmar-1"].map((key) => ({ key, status: "done" }));
    expect(resultadoPorAlvo(plano, steps)[0].resultado).toBe("conectado");
  });
});

describe("Agente: página de escolha do app e convites de testador", () => {
  const escolha = [
    webview,
    web({ texto: "Em qual app conectar?" }),
    web({ texto: "Aceitar convites de testador", clicavel: true, y: 400 }),
    web({ texto: "App global", y: 600 }),
    web({ texto: "ID 29415721201449674", y: 630 }),
    web({ texto: "APP Scale (PRINCIPAL)", y: 700 }),
    web({ texto: "ID 29415721201449674", y: 730 }),
    web({ texto: "Scale APP 02", y: 800 }),
    web({ texto: "ID 1083625921182417", y: 830 }),
  ];

  it("reconhece a escolha do app e acha o app pelo nome exato; sem o nome, pelo ID", () => {
    expect(naEscolhaDeApp(escolha)).toBe(true);
    expect(opcaoDoApp(escolha, { nome: "APP Scale (PRINCIPAL)", igAppId: "29415721201449674" })?.y).toBe(700);
    expect(opcaoDoApp(escolha, { nome: "app global", igAppId: "29415721201449674" })?.y).toBe(600);
    expect(opcaoDoApp(escolha, { nome: "Renomeado", igAppId: "1083625921182417" })?.y).toBe(830);
    expect(opcaoDoApp(escolha, { nome: "Outro", igAppId: "999" })).toBeNull();
  });

  it("Aceitar do convite só por texto exato (não o botão do SaaS nem o dos cookies)", () => {
    expect(botaoAceitarConvite(escolha)).toBeNull();
    expect(botaoAceitarConvite([webview, web({ texto: "Aceitar e continuar", clicavel: true })])).toBeNull();
    const convites = [webview, web({ texto: "ScaleMaster APP-IG" }), web({ texto: "Recusar", clicavel: true, x: 300 }), web({ texto: "Aceitar", clicavel: true, x: 800 })];
    expect(botaoAceitarConvite(convites)?.x).toBe(800);
    expect(botaoAceitarConvite([webview, web({ texto: "Accept", clicavel: true, x: 700 })])?.x).toBe(700);
  });

  it("link mágico vencido (página de erro do SaaS) é reconhecido", () => {
    expect(linkInvalido([webview, web({ texto: "Link inválido ou expirado" }), web({ texto: "Este link não existe mais." })])).toBe(true);
    expect(linkInvalido(escolha)).toBe(false);
  });
});
