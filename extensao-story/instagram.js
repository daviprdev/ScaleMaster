// Scale Master Story — chamadas ao Instagram, rodando dentro de www.instagram.com.
// Usa a sessão do próprio perfil (cookies do AdsPower): mesma origem, sem token.
//
// Fluxo (1.0.1, conferido em 22/11 — a 1.0.0 mandava a foto pelo www e o configure dava 500):
//   1. i.instagram.com/rupload_igphoto/fb_uploader_<id>   → foto 1080×1920 com o adesivo desenhado
//      (sai do service worker: background.js, "sm-upload")
//   2. www /api/v1/media/configure_to_story/              → upload_id + configure_mode=1 +
//      story_link_stickers [{x,y,width,height,rotation,link_type:"web",url}] (centro e tamanho em fração da tela)
//   3. www /api/v1/highlights/<uid>/highlights_tray/      → acha o destaque pelo nome (sem acento/emoji/caixa)
//      www /api/v1/highlights/highlight:<pk>/edit_reel/   → junta o story ao destaque existente
//      www /api/v1/highlights/create_reel/                → ou cria um destaque novo com o story de capa
// O adesivo é desenhado na foto; story_link_stickers só marca onde tocar.
// (/api/v1/media/validate_reel_url/ e /api/v1/web/create/configure_to_story/ dão 404 pelo www.)

(() => {
  const BASE = "https://www.instagram.com";
  const APP_ID = "936619743392459"; // app web do Instagram
  const ASBD_ID = "129477";

  class ErroIG extends Error {
    constructor(status, dados, texto) {
      super(mensagemDeErro(status, dados, texto));
      this.status = status;
      this.dados = dados;
    }
  }

  function textoDoHtml(texto) {
    const titulo = /<title[^>]*>([^<]*)<\/title>/i.exec(String(texto || ""))?.[1];
    return titulo ? titulo.replace(/&bull;/g, "·").replace(/&amp;/g, "&").trim() : "";
  }

  function mensagemDeErro(status, dados, texto) {
    const m = (dados && (dados.feedback_message || dados.message || dados.error_type)) || "";
    if (dados?.message === "login_required" || status === 401) return "Sessão do Instagram caiu neste perfil: entre de novo.";
    if (dados?.message === "checkpoint_required" || dados?.checkpoint_url) return "O Instagram pediu verificação (checkpoint) nesta conta.";
    if (dados?.message === "feedback_required" || dados?.spam) return `Ação bloqueada pelo Instagram: ${dados.feedback_message || dados.feedback_title || m}`;
    if (status === 429) return "Muitas requisições seguidas (429): espere alguns minutos.";
    if (m) return `HTTP ${status}: ${m}`;
    const titulo = textoDoHtml(texto);
    if (titulo) return `HTTP ${status}: ${titulo}`;
    const curto = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 160);
    return `HTTP ${status}${curto && !curto.startsWith("<") ? `: ${curto}` : ""}`;
  }

  function lerCookie(nome) {
    const par = document.cookie.split("; ").find((c) => c.startsWith(`${nome}=`));
    return par ? decodeURIComponent(par.slice(nome.length + 1)) : "";
  }

  function cabecalhos(extra = {}) {
    return {
      "X-CSRFToken": lerCookie("csrftoken"),
      "X-IG-App-ID": APP_ID,
      "X-ASBD-ID": ASBD_ID,
      "X-Requested-With": "XMLHttpRequest",
      "X-IG-WWW-Claim": sessionStorage.getItem("www-claim-v2") || "0",
      ...extra,
    };
  }

  async function chamar(caminho, { metodo = "GET", form, headers } = {}) {
    const opcoes = { method: metodo, credentials: "include", headers: cabecalhos(headers) };
    if (form) {
      opcoes.body = new URLSearchParams(form);
      opcoes.headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const r = await fetch(BASE + caminho, opcoes);
    const claim = r.headers.get("x-ig-set-www-claim");
    if (claim) sessionStorage.setItem("www-claim-v2", claim);
    const texto = await r.text();
    let dados = null;
    try {
      dados = JSON.parse(texto);
    } catch {}
    if (!r.ok || dados?.status === "fail") throw new ErroIG(r.status, dados, texto);
    return dados ?? {};
  }

  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const erroDeConta = (e) => /Sessão|checkpoint|bloqueada|429/.test(String(e?.message));

  function normalizar(t) {
    return String(t || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toLowerCase();
  }

  function sessao() {
    const uid = lerCookie("ds_user_id");
    const csrf = lerCookie("csrftoken");
    if (!uid || !csrf) throw new Error("Nenhuma conta logada no Instagram neste perfil.");
    return { uid, csrf };
  }

  async function contaAtual() {
    sessao();
    const d = await chamar("/api/v1/accounts/current_user/?edit=true");
    const u = d.user || {};
    return { username: u.username || "", nome: u.full_name || "", foto: u.profile_pic_url || "" };
  }

  async function subirFoto(pedido, csrf) {
    const r = await chrome.runtime.sendMessage({ tipo: "sm-upload", imagem: pedido.imagem, largura: pedido.largura, altura: pedido.altura, csrf });
    if (!r?.ok) throw new Error(r?.erro || "O service worker da extensão não respondeu ao envio da foto.");
    return r.uploadId;
  }

  async function configurar(uploadId, link, avisar) {
    const form = { upload_id: uploadId, configure_mode: "1" };
    if (link) {
      form.story_link_stickers = JSON.stringify([
        { x: link.x, y: link.y, width: link.width, height: link.height, rotation: 0, link_type: "web", url: link.url },
      ]);
    }
    // decisão: o Instagram às vezes ainda está processando a foto (500/202) — 4 tentativas com espera crescente.
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await chamar("/api/v1/media/configure_to_story/", { metodo: "POST", form });
      } catch (e) {
        if (erroDeConta(e) || tentativa >= 4) throw e;
        avisar(`Instagram ainda processando a foto (${e.message}); nova tentativa ${tentativa + 1}/4 em ${tentativa * 3} s…`);
        await esperar(tentativa * 3000);
      }
    }
  }

  function temLink(media, url) {
    if (!media) return false;
    if (media.story_link_stickers?.length || media.story_cta?.length) return true;
    try {
      return JSON.stringify(media).includes(new URL(url).host);
    } catch {
      return false;
    }
  }

  async function bandejaDeDestaques(uid) {
    const d = await chamar(`/api/v1/highlights/${uid}/highlights_tray/`);
    return (d.tray || []).map((h) => ({ id: String(h.id || ""), titulo: h.title || "" }));
  }

  function camposDeSessao(s) {
    return { _csrftoken: s.csrf, _uid: s.uid, _uuid: crypto.randomUUID() };
  }

  async function juntarAoDestaque(s, destaque, pk) {
    const id = destaque.id.replace(/^highlight:/, "");
    const d = await chamar(`/api/v1/highlights/highlight:${id}/edit_reel/`, {
      metodo: "POST",
      form: {
        ...camposDeSessao(s),
        source: "story_viewer",
        title: destaque.titulo,
        added_media_ids: JSON.stringify([pk]),
        removed_media_ids: "[]",
      },
    });
    return d.reel?.id || `highlight:${id}`;
  }

  async function criarDestaque(s, titulo, pk, source) {
    const d = await chamar("/api/v1/highlights/create_reel/", {
      metodo: "POST",
      form: {
        ...camposDeSessao(s),
        source,
        creation_id: String(Date.now()),
        title: titulo,
        cover: JSON.stringify({ media_id: pk }),
        media_ids: JSON.stringify([pk]),
      },
    });
    return d.reel?.id || "";
  }

  async function destacar(s, pk, destaque, avisar) {
    const titulo = destaque.titulo.trim().slice(0, 30);
    let existente = null;
    if (destaque.modo !== "novo") {
      try {
        const bandeja = await bandejaDeDestaques(s.uid);
        existente = bandeja.find((h) => normalizar(h.titulo) === normalizar(titulo)) || null;
        avisar(existente ? `Destaque "${existente.titulo}" encontrado no perfil.` : `Nenhum destaque "${titulo}" no perfil: criando um novo.`);
      } catch (e) {
        if (erroDeConta(e)) throw e;
        avisar(`Não li os destaques do perfil (${e.message}); criando um novo.`);
      }
    }
    let ultimoErro = null;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        if (existente) return { acao: "juntado", id: await juntarAoDestaque(s, existente, pk), titulo: existente.titulo };
        // decisão: "self_profile" primeiro; o Instagram aceita "story_viewer_profile" quando recusa o outro.
        for (const source of ["self_profile", "story_viewer_profile"]) {
          try {
            return { acao: "criado", id: await criarDestaque(s, titulo, pk, source), titulo };
          } catch (e) {
            ultimoErro = e;
            if (erroDeConta(e)) throw e;
          }
        }
      } catch (e) {
        ultimoErro = e;
        if (erroDeConta(e)) throw e;
      }
      if (tentativa < 3) {
        avisar(`Destaque ainda não aceitou o story (${ultimoErro?.message}); nova tentativa em ${tentativa * 4} s…`);
        await esperar(tentativa * 4000);
      }
    }
    throw ultimoErro || new Error("Destaque recusado.");
  }

  // pedido: { imagem (base64 JPEG), largura, altura, link: {url,x,y,width,height} | null, destaque: {titulo, modo} | null }
  async function publicarStory(pedido, avisar = () => {}) {
    const s = sessao();

    avisar("Enviando a foto para o Instagram…");
    const uploadId = await subirFoto(pedido, s.csrf);
    await esperar(2000);

    avisar("Publicando o story com o adesivo de link…");
    const dados = await configurar(uploadId, pedido.link, avisar);
    const media = dados.media;
    const pk = String(media?.pk || String(media?.id || "").split("_")[0] || "");
    if (!/^\d+$/.test(pk)) throw new Error("O Instagram respondeu sem o ID do story. Confira o perfil antes de publicar de novo.");
    const resultado = { mediaId: String(media.id || pk), pk, linkOk: pedido.link ? temLink(media, pedido.link.url) : true, destaque: null };

    if (pedido.destaque?.titulo?.trim()) {
      avisar("Story no ar. Esperando o Instagram liberar para o destaque…");
      await esperar(4000);
      try {
        resultado.destaque = await destacar(s, pk, pedido.destaque, avisar);
      } catch (e) {
        resultado.destaque = { erro: e.message };
      }
    }
    return resultado;
  }

  globalThis.SMInstagram = { publicarStory, contaAtual };
})();
