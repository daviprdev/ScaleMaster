// Scale Master Story — chamadas ao Instagram, rodando dentro de www.instagram.com.
// Usa a sessão do próprio perfil (cookies do AdsPower): mesma origem, sem token.
//
// Fluxo:
//   1. rupload_igphoto/fb_uploader_<id>          → sobe a arte 1080×1920 (adesivo já desenhado nela)
//   2. api/v1/media/validate_reel_url/            → o Instagram confere o link (falha não para)
//   3. api/v1/media/configure_to_story/           → publica com tap_models (área clicável do link)
//   4. api/v1/highlights/<uid>/highlights_tray/   → acha o destaque pelo nome (sem acento/emoji/caixa)
//      api/v1/highlights/highlight:<pk>/edit_reel/ → junta o story ao destaque existente
//      api/v1/highlights/create_reel/             → ou cria um destaque novo com ele de capa
//
// O adesivo no app também é desenhado na mídia; o tap_model só marca onde tocar.

(() => {
  const BASE = "https://www.instagram.com";
  const APP_ID = "936619743392459"; // app web do Instagram
  const ASBD_ID = "129477";
  const RECORTE_CAPA = [0.0, 0.21830457, 1.0, 0.78094524];

  class ErroIG extends Error {
    constructor(status, dados, texto) {
      super(mensagemDeErro(status, dados, texto));
      this.status = status;
      this.dados = dados;
    }
  }

  function mensagemDeErro(status, dados, texto) {
    const m = (dados && (dados.feedback_message || dados.message)) || "";
    if (dados?.message === "login_required" || status === 401) return "Sessão do Instagram caiu neste perfil: entre de novo.";
    if (dados?.message === "checkpoint_required" || dados?.checkpoint_url) return "O Instagram pediu verificação (checkpoint) nesta conta.";
    if (dados?.message === "feedback_required" || dados?.spam) return `Ação bloqueada pelo Instagram: ${dados.feedback_message || dados.feedback_title || m}`;
    if (status === 429) return "Muitas requisições seguidas (429): espere alguns minutos.";
    if (m) return `HTTP ${status}: ${m}`;
    const curto = String(texto || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    return `HTTP ${status}${curto ? `: ${curto}` : ""}`;
  }

  function lerCookie(nome) {
    const par = document.cookie.split("; ").find((c) => c.startsWith(`${nome}=`));
    return par ? decodeURIComponent(par.slice(nome.length + 1)) : "";
  }

  function versaoAjax() {
    const html = document.documentElement.innerHTML;
    const m = html.match(/"rollout_hash":"([^"]+)"/) || html.match(/"server_revision":(\d+)/) || html.match(/"client_revision":(\d+)/);
    return m ? m[1] : "";
  }

  let ajax = null;
  function cabecalhos(extra = {}) {
    if (ajax === null) ajax = versaoAjax();
    const h = {
      "X-CSRFToken": lerCookie("csrftoken"),
      "X-IG-App-ID": APP_ID,
      "X-ASBD-ID": ASBD_ID,
      "X-Requested-With": "XMLHttpRequest",
      "X-IG-WWW-Claim": sessionStorage.getItem("www-claim-v2") || "0",
      ...extra,
    };
    if (ajax) h["X-Instagram-AJAX"] = ajax;
    return h;
  }

  async function chamar(caminho, { metodo = "GET", form, corpo, headers } = {}) {
    const opcoes = { method: metodo, credentials: "include", headers: cabecalhos(headers) };
    if (form) {
      opcoes.body = new URLSearchParams(form);
      opcoes.headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (corpo) {
      opcoes.body = corpo;
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
    return uid;
  }

  async function contaAtual() {
    sessao();
    const d = await chamar("/api/v1/accounts/current_user/?edit=true");
    const u = d.user || {};
    return { username: u.username || "", nome: u.full_name || "", foto: u.profile_pic_url || "" };
  }

  async function subirFoto(bytes, largura, altura) {
    const uploadId = String(Date.now());
    const nome = `fb_uploader_${uploadId}`;
    await chamar(`/rupload_igphoto/${nome}`, {
      metodo: "POST",
      corpo: new Blob([bytes], { type: "image/jpeg" }),
      headers: {
        "Content-Type": "image/jpeg",
        "X-Entity-Name": nome,
        "X-Entity-Length": String(bytes.byteLength),
        "X-Entity-Type": "image/jpeg",
        Offset: "0",
        "X-Instagram-Rupload-Params": JSON.stringify({
          media_type: 1,
          upload_id: uploadId,
          upload_media_height: altura,
          upload_media_width: largura,
        }),
      },
    });
    return uploadId;
  }

  function camposDoStory(uploadId, uid, largura, altura, link) {
    const agora = Math.floor(Date.now() / 1000);
    const campos = {
      upload_id: uploadId,
      source_type: "4",
      configure_mode: "1",
      caption: "",
      creation_surface: "camera",
      capture_type: "normal",
      media_folder: "Camera",
      original_media_type: "photo",
      client_shared_at: String(agora - 5),
      client_timestamp: String(agora),
      timezone_offset: String(-new Date().getTimezoneOffset() * 60),
      extra: JSON.stringify({ source_width: largura, source_height: altura }),
      edits: JSON.stringify({ crop_original_size: [largura, altura], crop_center: [0, 0], crop_zoom: 1 }),
      static_models: "[]",
      _uid: uid,
    };
    if (link) {
      campos.story_sticker_ids = "link_sticker_default";
      campos.tap_models = JSON.stringify([
        {
          x: link.x,
          y: link.y,
          z: 0,
          width: link.width,
          height: link.height,
          rotation: 0,
          type: "story_link",
          is_sticker: true,
          selected_index: 0,
          tap_state: 0,
          link_type: "web",
          url: link.url,
          tap_state_str_id: "link_sticker_default",
        },
      ]);
    }
    return campos;
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

  async function configurar(campos, avisar) {
    // decisão: o Instagram às vezes ainda está processando a foto — tenta de novo algumas vezes.
    for (let tentativa = 1; ; tentativa++) {
      try {
        return { dados: await chamar("/api/v1/media/configure_to_story/", { metodo: "POST", form: campos }), via: "media" };
      } catch (e) {
        const msg = String(e.message || "");
        const processando = e.status === 202 || /transcode|not finished|processing/i.test(msg);
        if (processando && tentativa < 5) {
          avisar(`Instagram processando a foto, tentando de novo (${tentativa}/4)…`);
          await esperar(2500);
          continue;
        }
        const sessaoRuim = /Sessão|checkpoint|bloqueada|429/.test(msg);
        if (sessaoRuim || tentativa > 1) throw e;
        // decisão: caminho do app recusado → tenta o caminho da versão web; o link é conferido depois.
        avisar(`Caminho do app recusou (${msg}); tentando pelo caminho web…`);
        return { dados: await chamar("/api/v1/web/create/configure_to_story/", { metodo: "POST", form: campos }), via: "web" };
      }
    }
  }

  async function bandejaDeDestaques(uid) {
    const d = await chamar(`/api/v1/highlights/${uid}/highlights_tray/`);
    return (d.tray || []).map((h) => ({ id: String(h.id || ""), titulo: h.title || "" }));
  }

  async function juntarAoDestaque(destaqueId, titulo, mediaIds) {
    const pk = destaqueId.replace(/^highlight:/, "");
    const d = await chamar(`/api/v1/highlights/highlight:${pk}/edit_reel/`, {
      metodo: "POST",
      form: {
        source: "story_viewer",
        title: titulo,
        added_media_ids: JSON.stringify(mediaIds),
        removed_media_ids: "[]",
      },
    });
    return d.reel?.id || `highlight:${pk}`;
  }

  async function criarDestaque(titulo, mediaIds) {
    const d = await chamar("/api/v1/highlights/create_reel/", {
      metodo: "POST",
      form: {
        source: "self_profile",
        creation_id: String(Date.now()),
        title: titulo,
        media_ids: JSON.stringify(mediaIds),
        cover: JSON.stringify({ media_id: mediaIds[0], crop_rect: JSON.stringify(RECORTE_CAPA) }),
      },
    });
    return d.reel?.id || "";
  }

  async function destacar(uid, media, destaque, avisar) {
    const titulo = destaque.titulo.trim();
    const formatos = [[media.id], [String(media.pk)]]; // decisão: id "pk_uid" primeiro, pk puro se recusar.
    let existente = null;
    if (destaque.modo !== "novo") {
      try {
        const bandeja = await bandejaDeDestaques(uid);
        existente = bandeja.find((h) => normalizar(h.titulo) === normalizar(titulo)) || null;
        avisar(existente ? `Destaque "${existente.titulo}" encontrado no perfil.` : `Nenhum destaque "${titulo}" no perfil: criando um novo.`);
      } catch (e) {
        avisar(`Não li os destaques do perfil (${e.message}); criando um novo.`);
      }
    }
    let ultimoErro = null;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      for (const ids of formatos) {
        try {
          if (existente) {
            const id = await juntarAoDestaque(existente.id, existente.titulo, ids);
            return { acao: "juntado", id, titulo: existente.titulo };
          }
          const id = await criarDestaque(titulo, ids);
          return { acao: "criado", id, titulo };
        } catch (e) {
          ultimoErro = e;
          if (/Sessão|checkpoint|bloqueada/.test(String(e.message))) throw e;
        }
      }
      avisar(`Destaque ainda não aceitou o story (${ultimoErro?.message}); nova tentativa em ${tentativa * 4} s…`);
      await esperar(tentativa * 4000);
    }
    throw ultimoErro || new Error("Destaque recusado.");
  }

  function base64ParaBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // pedido: { imagem (base64 JPEG), largura, altura, link: {url,x,y,width,height} | null, destaque: {titulo, modo} | null }
  async function publicarStory(pedido, avisar = () => {}) {
    const uid = sessao();
    const bytes = base64ParaBytes(pedido.imagem);

    avisar("Enviando a arte para o Instagram…");
    const uploadId = await subirFoto(bytes, pedido.largura, pedido.altura);

    if (pedido.link) {
      try {
        await chamar("/api/v1/media/validate_reel_url/", { metodo: "POST", form: { url: pedido.link.url, _uid: uid } });
      } catch (e) {
        if (/Sessão|checkpoint|bloqueada/.test(String(e.message))) throw e;
        avisar(`Validação do link respondeu: ${e.message} (seguindo).`);
      }
    }

    avisar("Publicando o story com o adesivo de link…");
    const { dados, via } = await configurar(camposDoStory(uploadId, uid, pedido.largura, pedido.altura, pedido.link), avisar);
    const media = dados.media;
    if (!media?.id) throw new Error("O Instagram não devolveu o story publicado.");
    const linkOk = pedido.link ? temLink(media, pedido.link.url) : true;
    const resultado = { mediaId: media.id, pk: String(media.pk || ""), via, linkOk, destaque: null };

    if (pedido.destaque?.titulo?.trim()) {
      avisar("Story no ar. Esperando o Instagram liberar para o destaque…");
      await esperar(3000);
      try {
        resultado.destaque = await destacar(uid, media, pedido.destaque, avisar);
      } catch (e) {
        resultado.destaque = { erro: e.message };
      }
    }
    return resultado;
  }

  globalThis.SMInstagram = { publicarStory, contaAtual };
})();
