// Scale Master Story — chamadas ao Instagram, rodando dentro de www.instagram.com.
// Usa a sessão do próprio perfil (cookies do AdsPower): mesma origem, sem token.
//
// Fluxo (1.0.2; a 1.0.0 mandava a foto pelo www e o configure dava 500):
//   1. i.instagram.com/rupload_igphoto/fb_uploader_<id>   → foto 1080×1920 com o adesivo desenhado
//      (da página; senão do service worker, background.js "sm-upload"; por último www)
//   2. www /api/v1/media/configure_to_story/              → upload_id + configure_mode=1 + campos do app +
//      story_link_stickers [{x,y,width,height,type:"story_link",link_type:"web",url,…}] (centro e tamanho em fração)
//      IDs saem do texto cru (pk passa de 2^53); destaque usa "<pk>_<uid>"
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
    const saida = dados ?? {};
    Object.defineProperty(saida, "__texto", { value: texto, enumerable: false });
    return saida;
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
    const s = sessao();
    let u = {};
    try {
      u = (await chamar("/api/v1/accounts/current_user/?edit=true")).user || {};
    } catch (e) {
      if (erroDeConta(e)) throw e;
      // decisão: current_user recusado no web → info pública do próprio uid.
      u = (await chamar(`/api/v1/users/${s.uid}/info/`)).user || {};
    }
    return { username: u.username || "", nome: u.full_name || "", foto: u.profile_pic_url || "" };
  }

  function base64ParaBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Envio direto da página (origem www, cookies do perfil). Em i.instagram.com é o mesmo caminho
  // que o próprio site usa no "Criar"; o CORS do i. libera a origem www.
  async function uploadDaPagina(host, pedido, csrf) {
    const bytes = base64ParaBytes(pedido.imagem);
    const uploadId = String(Date.now());
    const nome = `fb_uploader_${uploadId}`;
    const r = await fetch(`https://${host}/rupload_igphoto/${nome}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "image/jpeg",
        Offset: "0",
        "X-Entity-Name": nome,
        "X-Entity-Type": "image/jpeg",
        "X-Entity-Length": String(bytes.byteLength),
        "X-IG-App-ID": APP_ID,
        "X-ASBD-ID": ASBD_ID,
        "X-CSRFToken": csrf,
        "X-Instagram-Rupload-Params": JSON.stringify({
          upload_id: uploadId,
          media_type: 1,
          upload_media_width: pedido.largura,
          upload_media_height: pedido.altura,
        }),
      },
      body: bytes,
    });
    const texto = await r.text();
    let j = null;
    try {
      j = JSON.parse(texto);
    } catch {}
    if (!r.ok || j?.status === "fail") throw new ErroIG(r.status, j, texto);
    return String(j?.upload_id || uploadId);
  }

  // decisão: três caminhos em ordem; o primeiro que aceitar a foto segue para o configure.
  //   1. página → i.instagram.com (origem www, igual ao site)
  //   2. service worker → i.instagram.com (Origin/Referer reescritos para www pelo background)
  //   3. página → www.instagram.com (o da 1.0.0: sobe, mas o configure já deu 500 com ele)
  async function subirFoto(pedido, csrf, avisar) {
    const caminhos = [
      ["página → i.instagram.com", () => uploadDaPagina("i.instagram.com", pedido, csrf)],
      [
        "extensão → i.instagram.com",
        async () => {
          const r = await chrome.runtime.sendMessage({ tipo: "sm-upload", imagem: pedido.imagem, largura: pedido.largura, altura: pedido.altura, csrf });
          if (!r?.ok) throw new Error(r?.erro || "o service worker da extensão não respondeu");
          return r.uploadId;
        },
      ],
      ["página → www.instagram.com", () => uploadDaPagina("www.instagram.com", pedido, csrf)],
    ];
    const erros = [];
    for (const [nome, enviar] of caminhos) {
      try {
        const uploadId = await enviar();
        avisar(`Foto enviada (${nome}).`);
        return { uploadId, caminho: nome };
      } catch (e) {
        if (erroDeConta(e)) throw e;
        erros.push(`${nome}: ${e.message}`);
        avisar(`Envio da foto recusado (${nome}: ${e.message}); tentando outro caminho…`);
      }
    }
    throw new Error(`O Instagram recusou a foto pelos três caminhos. ${erros.join(" | ")}`);
  }

  async function configurar(s, uploadId, pedido, avisar) {
    const agora = String(Math.floor(Date.now() / 1000));
    const form = {
      ...camposDeSessao(s),
      upload_id: uploadId,
      configure_mode: "1",
      source_type: "4",
      capture_type: "normal",
      audience: "default",
      client_shared_at: agora,
      client_timestamp: agora,
      edits: JSON.stringify({ crop_original_size: [pedido.largura, pedido.altura], crop_center: [0, 0], crop_zoom: 1 }),
      extra: JSON.stringify({ source_width: pedido.largura, source_height: pedido.altura }),
    };
    const link = pedido.link;
    if (link) {
      // decisão: mesmo formato do app (type/is_sticker/tap_state_str_id); sem eles o IG guarda a área mas não abre o link.
      form.story_link_stickers = JSON.stringify([
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
      form.story_sticker_ids = "link_sticker_default";
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

  // IDs do Instagram passam de 2^53: o pk numérico perde dígitos no JSON.parse. Lê do texto cru.
  function idsDoStory(dados, uid) {
    const media = dados.media || {};
    // decisão: media.id ("<pk>_<uid>") vem como texto e é exato; o regex no texto cru é só plano B.
    if (typeof media.id === "string" && /^\d+_\d+$/.test(media.id)) return { pk: media.id.split("_")[0], id: media.id };
    let pk = typeof media.pk_id === "string" && /^\d+$/.test(media.pk_id) ? media.pk_id : "";
    if (!pk) pk = /"media"\s*:\s*\{\s*(?:"[a-z_]+"\s*:\s*[^{}\[\],]+,\s*)*?"pk"\s*:\s*"?(\d{6,})/.exec(dados.__texto || "")?.[1] || "";
    if (!pk) return null;
    return { pk, id: `${pk}_${uid}` };
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

  async function juntarAoDestaque(s, destaque, mediaId) {
    const id = destaque.id.replace(/^highlight:/, "");
    const d = await chamar(`/api/v1/highlights/highlight:${id}/edit_reel/`, {
      metodo: "POST",
      form: {
        ...camposDeSessao(s),
        source: "story_viewer",
        title: destaque.titulo,
        added_media_ids: JSON.stringify([mediaId]),
        removed_media_ids: "[]",
      },
    });
    return d.reel?.id || `highlight:${id}`;
  }

  async function criarDestaque(s, titulo, mediaId, source) {
    const d = await chamar("/api/v1/highlights/create_reel/", {
      metodo: "POST",
      form: {
        ...camposDeSessao(s),
        source,
        creation_id: String(Date.now()),
        title: titulo,
        cover: JSON.stringify({ media_id: mediaId, crop_rect: JSON.stringify([0, 0.21830457, 1, 0.78094524]) }),
        media_ids: JSON.stringify([mediaId]),
      },
    });
    return d.reel?.id || "";
  }

  // mediaId = "<pk>_<uid>" (formato que edit_reel/create_reel esperam).
  async function destacar(s, mediaId, destaque, avisar) {
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
        if (existente) return { acao: "juntado", id: await juntarAoDestaque(s, existente, mediaId), titulo: existente.titulo };
        // decisão: "self_profile" primeiro; o Instagram aceita "story_viewer_profile" quando recusa o outro.
        for (const source of ["self_profile", "story_viewer_profile"]) {
          try {
            return { acao: "criado", id: await criarDestaque(s, titulo, mediaId, source), titulo };
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
    const { uploadId } = await subirFoto(pedido, s.csrf, avisar);
    await esperar(2000);

    avisar("Publicando o story com o adesivo de link…");
    const dados = await configurar(s, uploadId, pedido, avisar);
    const media = dados.media;
    const ids = idsDoStory(dados, s.uid);
    if (!ids) throw new Error("O Instagram respondeu sem o ID do story. Confira o perfil antes de publicar de novo.");
    const resultado = { mediaId: ids.id, pk: ids.pk, linkOk: pedido.link ? temLink(media, pedido.link.url) : true, destaque: null };

    if (pedido.destaque?.titulo?.trim()) {
      avisar("Story no ar. Esperando o Instagram liberar para o destaque…");
      await esperar(4000);
      try {
        resultado.destaque = await destacar(s, ids.id, pedido.destaque, avisar);
      } catch (e) {
        resultado.destaque = { erro: e.message };
      }
    }
    return resultado;
  }

  globalThis.SMInstagram = { publicarStory, contaAtual };
})();
