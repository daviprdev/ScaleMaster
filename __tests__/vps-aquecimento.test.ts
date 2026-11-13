import { describe, it, expect, vi } from "vitest";
import { CODIGO_VENCIDO, parseJobUpdates } from "../lib/emulador/jobs";
import { ehAlertaVps } from "../lib/vps/jobs";
import { comandoDeepLink, seguirUm } from "../agente-vps/fluxos/instagram.mjs";
import { CODIGO_VENCIDO as VENCIDO_AGENTE, codigoVencido, conferirCaixa, criarCaixa } from "../agente-vps/fluxos/caixa.mjs";
import { codigoValido, mascarar } from "../agente-vps/lib/portal.mjs";

const LINK = "https://hridoyhub.shop/OTP/";

describe("Aquecimento: seguir por deep link", () => {
  it("monta o am start do deep link do perfil", () => {
    expect(comandoDeepLink("realmadrid")).toEqual([
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "instagram://user?username=realmadrid",
      "-p",
      "com.instagram.android",
      "-f",
      "0x20000000",
    ]);
  });

  it("deep link falhou → tenta a pesquisa uma vez; falhando, devolve o motivo e o chamador pula", async () => {
    const logs: string[] = [];
    const ctx = { d: {}, log: (m: string) => logs.push(m) };
    const abrir = vi.fn(async () => null);
    const porPesquisa = vi.fn(async () => "seguiu");
    expect(await seguirUm(ctx, "natgeo", { abrir, porPesquisa })).toBe("seguiu");
    expect(porPesquisa).toHaveBeenCalledTimes(1);
    expect(logs[0]).toContain("deep link não abriu");
    const pesquisaFalha = vi.fn(async () => {
      throw new Error("Não apareceu a pesquisa do Instagram em 15 s.");
    });
    expect(await seguirUm(ctx, "natgeo", { abrir, porPesquisa: pesquisaFalha })).toMatch(/^falhou na pesquisa:/);
    const bloqueio = vi.fn(async () => {
      throw new Error("O Instagram bloqueou o seguir.");
    });
    await expect(seguirUm(ctx, "natgeo", { abrir, porPesquisa: bloqueio })).rejects.toThrow(/bloqueou/);
  });

  it("deep link abriu: toca Seguir e confirma 'Seguindo'", async () => {
    const no = (extra: Record<string, unknown>) => ({ texto: "", descricao: "", id: "", classe: "android.view.View", pacote: "com.instagram.android", clicavel: false, x: 0, y: 0, ...extra });
    const antes = [
      no({ id: "com.instagram.android:id/profile_header_followers_stacked_familiar", descricao: "241 miseguidores", y: 400 }),
      no({ id: "com.instagram.android:id/profile_header_follow_button", texto: "Seguir", descricao: "Seguir Neymar Jr", clicavel: true, x: 300, y: 600 }),
    ];
    const depois = [no({ id: "com.instagram.android:id/profile_header_follow_button", texto: "Seguindo", descricao: "Seguindo", clicavel: true, x: 300, y: 600 })];
    const toques: number[][] = [];
    const d = { tocar: async (x: number, y: number) => toques.push([x, y]), tela: async () => depois };
    const resultado = await seguirUm({ d, log: () => {} }, "neymarjr", { abrir: async () => antes, porPesquisa: vi.fn() });
    expect(resultado).toBe("seguiu");
    expect(toques).toEqual([[300, 600]]);
  }, 20_000);
});

describe("Código do portal vencido", () => {
  const input = { provedorEmail: "portal", portalLink: LINK, portalCodigo: "SUDXHRAY", conta: { email: LINK }, imap: { senha: "SUDXHRAY" } };
  const portalBase = () => ({ mascarar, codigoValido, verificarPortal: vi.fn(async () => true), statusDoCodigo: vi.fn(async () => ({ acabou: false, temOtp: false })), abrir: vi.fn(), fechar: vi.fn(async () => {}), mensagensVistas: vi.fn(async () => null) });

  it("mesmo texto no agente e no servidor, e sai em vermelho no card", () => {
    expect(VENCIDO_AGENTE).toBe(CODIGO_VENCIDO);
    expect(ehAlertaVps(CODIGO_VENCIDO)).toBe(true);
  });

  it("código nunca resgatado: a etapa email só confere o form; nada de /status nem resgate", async () => {
    const portal = portalBase();
    expect(await codigoVencido(input, portal)).toBeNull();
    const msg = await conferirCaixa(input, { portal });
    expect(msg).toContain("portal acessível");
    expect(portal.verificarPortal).toHaveBeenCalledWith(LINK);
    expect(portal.statusDoCodigo).not.toHaveBeenCalled();
    expect(portal.abrir).not.toHaveBeenCalled();
  });

  it("resgatado há mais de 20 min: o /status decide, não o relógio (sem OTP e reativável = segue; com OTP = vencido)", async () => {
    const antigo = { ...input, portalResgatadoEm: new Date(Date.now() - 25 * 60_000).toISOString() };
    const reativavel = portalBase();
    reativavel.statusDoCodigo = vi.fn(async () => ({ acabou: true, temOtp: false, podeRenovar: true }));
    expect(await conferirCaixa(antigo, { portal: reativavel })).toContain("portal acessível");
    expect(reativavel.abrir).not.toHaveBeenCalled();
    const gasto = portalBase();
    gasto.statusDoCodigo = vi.fn(async () => ({ acabou: true, temOtp: true, podeRenovar: false }));
    await expect(conferirCaixa(antigo, { portal: gasto })).rejects.toMatchObject({ message: CODIGO_VENCIDO, semPrefixo: true, manterContainer: true });
    const semReativar = portalBase();
    semReativar.statusDoCodigo = vi.fn(async () => ({ acabou: true, temOtp: false, podeRenovar: false }));
    await expect(conferirCaixa(antigo, { portal: semReativar })).rejects.toThrow(CODIGO_VENCIDO);
    const foraDoAr = portalBase();
    foraDoAr.statusDoCodigo = vi.fn(async () => { throw new Error("HTTP 502"); });
    expect(await conferirCaixa(antigo, { portal: foraDoAr })).toContain("portal acessível");
  });

  it("resgatado há pouco: consulta o /status; OTP já recebido = vencido; ativa = segue", async () => {
    const recente = { ...input, portalResgatadoEm: new Date(Date.now() - 5 * 60_000).toISOString(), portalExpiraEm: new Date(Date.now() + 15 * 60_000).toISOString() };
    const comOtp = portalBase();
    comOtp.statusDoCodigo = vi.fn(async () => ({ acabou: true, temOtp: true }));
    await expect(conferirCaixa(recente, { portal: comOtp })).rejects.toThrow(CODIGO_VENCIDO);
    const ativa = portalBase();
    expect(await conferirCaixa(recente, { portal: ativa })).toContain("sessão ainda válida");
    expect(ativa.statusDoCodigo).toHaveBeenCalledWith(LINK, "SUDXHRAY");
  });

  it("a sessão só é resgatada na hora do endereço, e o resgate avisa a hora e o fim", async () => {
    const portal = portalBase();
    const fimEm = Date.now() + 20 * 60_000;
    portal.abrir = vi.fn(async () => ({ sessao: { modo: "http", email: "x@gmail.com", fimEm }, email: "x@gmail.com" }));
    const resgates: Array<{ resgatadoEm: string; expiraEm: string }> = [];
    const caixa = criarCaixa(input, { portal, aoResgatar: (p: { resgatadoEm: string; expiraEm: string }) => resgates.push(p) });
    await conferirCaixa(input, { portal });
    expect(portal.abrir).not.toHaveBeenCalled();
    expect(resgates).toEqual([]);
    expect(await caixa.endereco()).toBe("x@gmail.com");
    expect(portal.abrir).toHaveBeenCalledTimes(1);
    expect(resgates).toHaveLength(1);
    expect(Date.parse(resgates[0].expiraEm)).toBe(new Date(fimEm).getTime());
  });

  it("código já gasto ao abrir a sessão: endereco() lança CODIGO_VENCIDO (container fica, card pede outro)", async () => {
    const portal = portalBase();
    portal.abrir = vi.fn(async () => {
      const e = new Error("o código SU****AY já foi usado (sessão encerrada com OTP recebido)") as Error & { codigoVencido?: boolean };
      e.codigoVencido = true;
      throw e;
    });
    const caixa = criarCaixa(input, { portal });
    await expect(caixa.endereco()).rejects.toMatchObject({ message: CODIGO_VENCIDO, manterContainer: true });
  });

  it("o andamento leva as horas do resgate para o servidor (parseJobUpdates)", () => {
    const [u] = parseJobUpdates([
      { id: "11111111-1111-4111-8111-111111111111", status: "running", steps: [], portal: { resgatadoEm: "2026-11-08T20:00:00.000Z", expiraEm: "2026-11-08T20:20:00.000Z" } },
    ]);
    expect(u.portal).toEqual({ resgatadoEm: "2026-11-08T20:00:00.000Z", expiraEm: "2026-11-08T20:20:00.000Z" });
    const [semPortal] = parseJobUpdates([{ id: "11111111-1111-4111-8111-111111111111", status: "running", steps: [], portal: { resgatadoEm: "ontem" } }]);
    expect(semPortal.portal).toBeUndefined();
  });
});
