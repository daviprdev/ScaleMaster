import { describe, expect, it } from "vitest";
import { arrobaDaPermissao } from "../agente-vps/lib/estrutura.mjs";
import { comandoLimpar } from "../agente-vps/lib/teclado.mjs";
import { comandoTelaPrincipal, destacarStory, midiaSelecionada, naEdicao, noProprioPerfil, primeiraMidia } from "../agente-vps/fluxos/instagram.mjs";
import { BALAO_ACIMA_PX, consentir, escolherDestaque, noVisualizador, stickerDeLink, tocarLinkDoDestaque } from "../agente-vps/fluxos/oauth.mjs";

/**
 * Dumps reais do ig-10 (Instagram 454 x86_64, 11/11/2026), resumidos aos nós
 * que importam: galeria da foto, perfil x página de edição, faixa de
 * destaques do link.zada, visualizador do story e tela de permissão do OAuth.
 */

const IG = "com.instagram.android";
type No = { texto: string; descricao: string; id: string; classe: string; pacote: string; clicavel: boolean; focado: boolean; x: number; y: number };
const no = (extra: Partial<No>): No => ({ texto: "", descricao: "", id: "", classe: "", pacote: IG, clicavel: false, focado: false, x: 540, y: 500, ...extra });
const id = (nome: string) => `${IG}:id/${nome}`;

const GALERIA_FOTO: No[] = [
  no({ descricao: "Cancelar", id: id("action_bar_cancel"), clicavel: true, x: 73, y: 136 }),
  no({ texto: "Concluir", descricao: "Concluir", id: id("next_button_textview"), clicavel: true, x: 964, y: 136 }),
  no({ texto: "Recentes", id: id("gallery_folder_menu_tv"), clicavel: true, x: 172, y: 1358 }),
  no({ clicavel: true, x: 136, y: 1564 }),
  no({ descricao: "Selecionado Miniatura da foto com criação", id: id("gallery_grid_item_thumbnail"), clicavel: true, x: 136, y: 1564 }),
];

const GALERIA_STORY: No[] = [
  no({ descricao: "Voltar para a página inicial", id: id("gallery_cancel_button"), clicavel: true, x: 68, y: 79 }),
  no({ texto: "Adicionar ao story", id: id("gallery_title_text"), x: 540, y: 79 }),
  no({ descricao: "Configurações da câmera", id: id("gallery_settings_gear"), clicavel: true, x: 1011, y: 79 }),
  no({ id: id("gallery_destination_item"), clicavel: true, x: 176, y: 284 }),
  no({ texto: "Recentes", id: id("gallery_folder_menu_tv"), clicavel: true, x: 151, y: 489 }),
  no({ descricao: "Câmera", id: id("gallery_grid_camera_item_icon"), x: 181, y: 877 }),
  no({ descricao: "Não selecionado Miniatura de foto com criação", id: id("gallery_grid_item_thumbnail"), clicavel: true, x: 540, y: 876 }),
];

const PERFIL: No[] = [
  no({ texto: "aline.guimaraes82807", id: id("action_bar_title"), x: 536, y: 136 }),
  no({ descricao: "Seu perfil. Story visto", id: id("row_profile_header_imageview"), x: 158, y: 482 }),
  no({ texto: "Aline Guimaraes", id: id("profile_header_full_name_above"), x: 456, y: 387 }),
  no({ descricao: "Editar perfil", id: id("button_container"), clicavel: true, x: 257, y: 931 }),
  no({ texto: "Editar perfil", x: 257, y: 930 }),
];

const EDICAO: No[] = [
  no({ texto: "Editar perfil", id: id("action_bar_title"), x: 300, y: 136 }),
  no({ descricao: "Edite a foto do perfil", id: id("profile_pic_imageview"), clicavel: true, x: 421, y: 355 }),
  no({ texto: "Editar foto ou avatar", id: id("change_avatar_button"), clicavel: true, x: 540, y: 522 }),
  no({ id: id("bio"), clicavel: true, x: 540, y: 1168 }),
];

const PERFIL_LINKZADA: No[] = [
  no({ texto: "link.zada", id: id("action_bar_title"), x: 289, y: 136 }),
  no({ descricao: "Foto do perfil", id: id("row_profile_header_imageview"), x: 158, y: 341 }),
  no({ texto: "NOVO", id: id("suggested_user_card_new_badge"), x: 157, y: 441 }),
  no({ texto: "LINKAZDA CONNECT", id: id("profile_header_full_name_above"), x: 499, y: 281 }),
  no({ texto: "Seguir", descricao: "Seguir LINKAZDA CONNECT", id: id("profile_header_follow_button"), clicavel: true, x: 282, y: 558 }),
  no({ descricao: "Mensagem", id: id("button_container"), clicavel: true, x: 798, y: 558 }),
  no({ id: id("outer_container"), clicavel: true, x: 127, y: 769 }),
  no({ descricao: "Story de link.zada, 0 de 0, Visualizado.", clicavel: true, x: 127, y: 740 }),
  no({ descricao: "Story do destaque de link.zada na coluna 1", id: id("avatar_image_view"), x: 126, y: 745 }),
  no({ texto: "LINKADA", id: id("username"), x: 127, y: 869 }),
];

const STORY_DO_DESTAQUE: No[] = [
  no({ clicavel: true, x: 540, y: 897 }),
  no({ descricao: "Enviar mensagem ou reação", id: id("message_composer_container"), clicavel: true, x: 372, y: 1710 }),
  no({ texto: "Enviar mensagem", id: id("composer_text"), x: 214, y: 1710 }),
  no({ descricao: "Curtir story", id: id("toolbar_like_button"), clicavel: true, x: 901, y: 1709 }),
  no({ id: id("reel_viewer_profile_picture"), clicavel: true, x: 74, y: 91 }),
  no({ descricao: "Título do destaque LINKADA, story 1 de 1", id: id("reel_viewer_text_container"), clicavel: true, x: 420, y: 117 }),
  no({ texto: "Seguir", descricao: "Seguir LINKAZDA CONNECT", id: id("reel_header_unconnected_follow"), clicavel: true, x: 855, y: 88 }),
];

const PERMISSAO = (usuario: string): No[] => [
  no({ descricao: "Fechar navegador", id: id("ig_browser_close_button"), clicavel: true, x: 63, y: 63 }),
  no({ texto: "instagram.com", id: id("ig_browser_text_subtitle"), x: 561, y: 42 }),
  no({ texto: "Inst Provider A20-IG", x: 257, y: 531 }),
  no({ texto: ` está solicitando acesso a: ${usuario}. `, x: 506, y: 557 }),
  no({ texto: "Ver perfil e acessar mídia (obrigatório)", x: 472, y: 733 }),
  no({ texto: "Permitir", clicavel: true, x: 540, y: 1576 }),
  no({ texto: "Cancelar", clicavel: true, x: 540, y: 1734 }),
];

describe("Galeria: a foto, nunca o Recentes", () => {
  it("foto de perfil: a miniatura da grade (já marcada) e não o menu de álbuns, que fica mais acima", () => {
    const m = primeiraMidia(GALERIA_FOTO);
    expect(m?.id).toBe(id("gallery_grid_item_thumbnail"));
    expect(midiaSelecionada(m)).toBe(true);
  });

  it("story: pula cancelar, engrenagem, Modelos/Música, Recentes e a câmera", () => {
    const m = primeiraMidia(GALERIA_STORY);
    expect(m).toMatchObject({ x: 540, y: 876 });
    expect(midiaSelecionada(m)).toBe(false);
  });
});

describe("Perfil x página de edição", () => {
  it("o título 'Editar perfil' da edição não conta como estar no perfil", () => {
    expect(noProprioPerfil(PERFIL)).toBe(true);
    expect(naEdicao(PERFIL)).toBe(false);
    expect(noProprioPerfil(EDICAO)).toBe(false);
    expect(naEdicao(EDICAO)).toBe(true);
    // Perfil de outra conta (sem Editar perfil) também não.
    expect(noProprioPerfil(PERFIL_LINKZADA)).toBe(false);
  });

  it("tela principal por CLEAR_TOP (tira as páginas empilhadas pelo deep link)", () => {
    expect(comandoTelaPrincipal()).toEqual(["am", "start", "-n", `${IG}/com.instagram.mainactivity.InstagramMainActivity`, "-f", "0x04000000"]);
  });

  it("apagar o campo inteiro pelo teclado ADB", () => {
    expect(comandoLimpar()).toEqual(["am", "broadcast", "--receiver-foreground", "-a", "ADB_CLEAR_TEXT"]);
  });
});

describe("Destaque do link.zada → sticker → navegador", () => {
  it("o destaque sai pelo rótulo embaixo do círculo e bate pelo nome", () => {
    const e = escolherDestaque(PERFIL_LINKZADA, "LINKADA");
    expect(e).toMatchObject({ texto: "LINKADA", porPrefixo: true });
    expect(e?.no).toMatchObject({ x: 127, y: 869 });
  });

  it("visualizador: o sticker é o nó clicável sem texto no meio; o Seguir do topo não é perfil", () => {
    expect(noVisualizador(STORY_DO_DESTAQUE)).toBe(true);
    expect(noVisualizador(PERFIL_LINKZADA)).toBe(false);
    expect(stickerDeLink(STORY_DO_DESTAQUE, "")).toMatchObject({ x: 540, y: 897 });
  });

  it("o story acabou entre as etapas: reabre o destaque, toca no sticker e no balão acima dele até a página abrir", async () => {
    const toques: Array<[number, number]> = [];
    let tela: "perfil" | "story" | "balao" | "pagina" = "perfil";
    const PAGINA = [
      no({ descricao: "Fechar navegador", id: id("ig_browser_close_button"), clicavel: true, x: 63, y: 63 }),
      no({ texto: "scalemasterconexoes.lovable.app", id: id("ig_browser_text_subtitle"), x: 562, y: 42 }),
      no({ texto: "Instagram", id: id("ig_browser_text_title"), x: 540, y: 83 }),
    ];
    const d = {
      tela: async () => (tela === "perfil" ? PERFIL_LINKZADA : tela === "pagina" ? PAGINA : STORY_DO_DESTAQUE),
      tocar: async (x: number, y: number) => {
        toques.push([x, y]);
        if (tela === "perfil") tela = "story";
        else if (tela === "story" && y === 897) tela = "balao";
        else if (tela === "balao" && y === 897 - BALAO_ACIMA_PX) tela = "pagina";
      },
      arrastar: async () => {},
      // Visualizador no topo (não é o navegador): o agente toca no balão.
      shell: async () => "  topResumedActivity=ActivityRecord{1 u0 com.instagram.android/com.instagram.modal.TransparentModalActivity} t39}",
    };
    const logs: string[] = [];
    const r = await tocarLinkDoDestaque({ d, log: (m: string) => logs.push(m) }, { link: "", destaque: "LINKADA" });
    expect(r).toBe("página aberta (scalemasterconexoes.lovable.app)");
    expect(toques).toEqual([
      [127, 869 - 90],
      [540, 897],
      [540, 897 - BALAO_ACIMA_PX],
    ]);
    expect(logs[0]).toBe('o story do destaque acabou: reabrindo "LINKADA"');
  }, 20_000);
});

describe("Permissão do OAuth: confere o @ antes de Permitir", () => {
  it("lê o @ da frase 'está solicitando acesso a'", () => {
    expect(arrobaDaPermissao(PERMISSAO("aline.guimaraes82807").map((n) => n.texto))).toBe("aline.guimaraes82807");
    expect(arrobaDaPermissao(["App is requesting access to: @Maria_Silva."])).toBe("maria_silva");
    expect(arrobaDaPermissao(["Permitir", "Cancelar"])).toBeNull();
  });

  it("@ da conta: toca em Permitir; outro @: CONEXAO_OUTRA_CONTA sem tocar", async () => {
    const toques: Array<[number, number]> = [];
    let tela = PERMISSAO("aline.guimaraes82807");
    const d = {
      tela: async () => tela,
      tocar: async (x: number, y: number) => {
        toques.push([x, y]);
        tela = [no({ texto: "Conta conectada!" })];
      },
    };
    expect(await consentir({ d }, "@Aline.Guimaraes82807")).toBe("permitido para @aline.guimaraes82807");
    expect(toques).toEqual([[540, 1576]]);

    const outros: Array<[number, number]> = [];
    const d2 = { tela: async () => PERMISSAO("outra.conta"), tocar: async (x: number, y: number) => void outros.push([x, y]) };
    await expect(consentir({ d: d2 }, "aline.guimaraes82807")).rejects.toThrow(/^CONEXAO_OUTRA_CONTA: a tela de permissão é de @outra\.conta, a conta é @aline\.guimaraes82807/);
    expect(outros).toEqual([]);
  });
});

describe("Destacar pelo próprio story (josiane, ig-8)", () => {
  const BARRA: No[] = [
    no({ descricao: "Página inicial", id: id("feed_tab"), clicavel: true, x: 108, y: 1731 }),
    no({ descricao: "Pesquisar e explorar", id: id("search_tab"), clicavel: true, x: 756, y: 1731 }),
    no({ descricao: "Perfil", id: id("profile_tab"), clicavel: true, x: 972, y: 1731 }),
  ];
  const PERFIL_SEM_DESTAQUES: No[] = [
    no({ texto: "Não vejo a hora de…", id: id("pog_bubble_text"), x: 157, y: 276 }),
    no({ id: id("row_profile_header_imageview_f"), clicavel: true, x: 158, y: 394 }),
    no({ descricao: "Seu perfil. Story visto", id: id("row_profile_header_imageview"), x: 158, y: 394 }),
    no({ descricao: "Adicionar ao story", id: id("reel_empty_badge"), clicavel: true, x: 226, y: 462 }),
    no({ texto: "Josiane Cavalcanti", id: id("profile_header_full_name_above"), x: 480, y: 299 }),
    no({ descricao: "Editar perfil", id: id("button_container"), clicavel: true, x: 257, y: 843 }),
    no({ texto: "Editar perfil", x: 257, y: 842 }),
    no({ descricao: "Ignorar", id: id("dismiss_button_prism_style"), clicavel: true, x: 402, y: 1150 }),
    ...BARRA,
  ];
  const MEU_STORY: No[] = [
    no({ clicavel: true, x: 540, y: 897 }),
    no({ descricao: "Destacar", id: id("toolbar_highlights_button"), clicavel: true, x: 476, y: 1670 }),
    no({ texto: "Destacar", id: id("highlights_label"), x: 476, y: 1733 }),
    no({ id: id("reel_viewer_profile_picture"), clicavel: true, x: 109, y: 91 }),
  ];
  const SHEET = (nome: string): No[] => [
    ...MEU_STORY,
    no({ descricao: "Ignorar", id: id("background_dimmer"), clicavel: true, x: 540, y: 897 }),
    no({ texto: "Adicionar ao destaque", id: id("header_text"), x: 540, y: 1285 }),
    no({ texto: nome, id: id("highlight_title"), classe: "android.widget.EditText", clicavel: true, focado: true, x: 540, y: 1602 }),
    no({ texto: "Adicionar", id: id("action_button"), clicavel: true, x: 540, y: 1720 }),
  ];

  it("conta sem destaque: foto → Destacar → nome no campo do sheet → Adicionar → fecha o story; nunca toca no Ignorar do fundo", async () => {
    let tela: "perfil" | "story" | "sheet" | "story2" = "perfil";
    let nome = "Destaques";
    let criado = false;
    const toques: string[] = [];
    const d = {
      tela: async () => (tela === "perfil" ? PERFIL_SEM_DESTAQUES : tela === "sheet" ? SHEET(nome) : MEU_STORY),
      tocar: async (x: number, y: number) => {
        const alvo = (tela === "perfil" ? PERFIL_SEM_DESTAQUES : tela === "sheet" ? SHEET(nome) : MEU_STORY).find((n) => n.x === Math.round(x) && n.y === Math.round(y));
        toques.push(`${tela}:${alvo?.texto || alvo?.descricao || alvo?.id.split("/")[1] || "?"}`);
        if (tela === "perfil" && y === 394 + 25) tela = "story";
        else if (tela === "story" && y === 1670) tela = "sheet";
        else if (tela === "sheet" && y === 1720) {
          criado = true;
          tela = "story2";
        }
      },
      tecla: async (k: string) => {
        toques.push(k);
        if (tela === "story2") tela = "perfil";
      },
      limparCampo: async () => {
        nome = "";
      },
      digitar: async (v: string) => {
        nome = v;
        return "broadcast";
      },
      focoAtual: async () => `${IG}/com.instagram.mainactivity.InstagramMainActivity`,
      shell: async () => "  topResumedActivity=ActivityRecord{1 u0 com.instagram.android/com.instagram.modal.TransparentModalActivity} t17}",
      abrirApp: async () => "",
    };
    const semDono = (texto: string) => {
      throw new Error(texto);
    };
    const r = await destacarStory({ d, log: () => {}, ajuda: { manual: semDono, terminarAMao: semDono } }, "AQUI 🔗👆");
    expect(r).toBe(`destaque "AQUI 🔗👆" criado`);
    expect(criado).toBe(true);
    expect(nome).toBe("AQUI 🔗👆");
    expect(toques.filter((t) => /Ignorar/.test(t))).toEqual([]);
    // Foto um pouco abaixo do centro (a nota cobre o alto) e o Destacar logo em seguida, sem ler a tela no meio.
    expect(toques[0]).toBe("perfil:?");
    expect(toques[1]).toBe("story:Destacar");
    expect(toques).toContain("sheet:Adicionar");
    expect(toques[toques.length - 1]).toBe("KEYCODE_BACK");
  }, 20_000);
});
