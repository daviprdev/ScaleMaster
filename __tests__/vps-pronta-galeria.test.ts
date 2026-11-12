import { describe, expect, it } from "vitest";
import { comandoLimparMediaStore, fotoUnicaNaGaleria, maisNova } from "../agente-vps/lib/galeria.mjs";
import { itensDaFaixa, noPerfilDe } from "../agente-vps/fluxos/oauth.mjs";
import { expandirEtapas, parseEstrutura, prontidaoDaConta } from "../lib/vps/estruturacao";
import { VPS_FLUXO } from "../lib/vps/jobs";

const IG = "com.instagram.android";
type No = { texto: string; descricao: string; id: string; classe: string; pacote: string; clicavel: boolean; focado: boolean; x: number; y: number };
const no = (extra: Partial<No>): No => ({ texto: "", descricao: "", id: "", classe: "", pacote: IG, clicavel: false, focado: false, x: 540, y: 500, ...extra });
const id = (nome: string) => `${IG}:id/${nome}`;

describe("Galeria com uma foto só (perfil x story)", () => {
  it("apaga as linhas das pastas do agente no MediaStore e lê a mais nova", () => {
    expect(comandoLimparMediaStore()).toBe(`content delete --uri content://media/external/images/media --where "_data LIKE '%/ScaleMaster/%'"`);
    expect(maisNova("Row: 0 _display_name=sm-2.png\nRow: 1 _display_name=sm-1.jpg")).toBe("sm-2.png");
    expect(maisNova("No result found.")).toBeNull();
  });

  it("limpa as duas pastas, envia, põe a data de agora e espera a foto ser a mais nova", async () => {
    const comandos: string[] = [];
    let enviado = "";
    const d = {
      shell: async (...a: string[]) => {
        comandos.push(a.join(" "));
        return a[0].startsWith("content query") ? `Row: 0 _display_name=${enviado.split("/").pop()}` : "";
      },
      enviar: async (_local: string, remoto: string) => {
        enviado = remoto;
      },
    };
    const nome = await fotoUnicaNaGaleria(d, "/opt/scalemaster/midias/perfil/foto.JPG", { pasta: "/sdcard/Pictures/ScaleMaster" });
    expect(nome).toMatch(/^sm-\d+\.jpg$/);
    expect(comandos[0]).toBe("rm -rf /sdcard/Pictures/ScaleMaster /sdcard/DCIM/ScaleMaster; mkdir -p /sdcard/Pictures/ScaleMaster");
    expect(comandos[1]).toBe(comandoLimparMediaStore());
    expect(comandos[2]).toBe(`touch /sdcard/Pictures/ScaleMaster/${nome}`);
    expect(comandos.some((c) => c.includes("MEDIA_SCANNER_SCAN_FILE"))).toBe(true);
  });
});

describe("Perfil do alvo no Continuar", () => {
  const PERFIL_DA_CONTA = [
    no({ texto: "josianecavalcanti85432", id: id("action_bar_title"), x: 491, y: 136 }),
    no({ texto: "Preciso de inspiração…", id: id("pog_bubble_text"), x: 157, y: 381 }),
    no({ descricao: "Seu perfil. Story visto", id: id("row_profile_header_imageview"), x: 158, y: 482 }),
    no({ texto: "Josiane Cavalcanti", id: id("profile_header_full_name_above"), x: 456, y: 387 }),
  ];

  it("reconhece o perfil pelo título e a nota da conta não vira destaque", () => {
    expect(noPerfilDe(PERFIL_DA_CONTA, "link.zada")).toBe(false);
    expect(noPerfilDe(PERFIL_DA_CONTA, "@JosianeCavalcanti85432")).toBe(true);
    expect(itensDaFaixa(PERFIL_DA_CONTA).map((i: { texto: string }) => i.texto)).not.toContain("Preciso de inspiração…");
  });
});

describe("Selo verde: conectada e pronta para postar", () => {
  const lido = parseEstrutura(
    { fotoPerfil: "a.jpg", fotoStory: "b.png", bio: "oi", perfil: "link.zada", nomeDestaque: "AQUI", linkStory: "https://x.com", legendaSticker: "", legendaDestaque: "", agendarHoras: 0 },
    ["a.jpg", "b.png"]
  );
  if (!("value" in lido)) throw new Error(lido.error);
  const plano = expandirEtapas(lido.value);
  const tudo = (status: string, extra: Record<string, { status: string; message?: string }> = {}) =>
    plano.map((p) => ({ key: p.key, status: extra[p.key]?.status ?? status, message: extra[p.key]?.message ?? null }));

  it("concluída com o alvo conectado = pronta; destaque falhou mas conectou = conectada; alvo falhou = nada", () => {
    expect(prontidaoDaConta({ status: "done", plano, steps: tudo("done") })).toBe("pronta");
    expect(prontidaoDaConta({ status: "error", plano, steps: tudo("done", { destacar: { status: "error", message: "travou" } }) })).toBe("conectada");
    expect(prontidaoDaConta({ status: "error", plano, steps: tudo("done", { "link-1": { status: "error", message: "não abriu" } }) })).toBeNull();
    expect(prontidaoDaConta({ status: "running", plano, steps: tudo("done") })).toBeNull();
    expect(prontidaoDaConta(null)).toBeNull();
  });
});

describe("Criação sem bio", () => {
  it("a etapa perfil é só foto e nome", () => {
    expect(VPS_FLUXO.find((s) => s.key === "perfil")?.label).toBe("Foto e nome de exibição");
  });
});
