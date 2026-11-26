// Scale Master Story — service worker.
// Ícone da extensão abre/fecha o painel na aba do Instagram; o painel (iframe da
// extensão) fala com o content script da aba por aqui, porque não sabe o id da aba.
// O envio da foto sai daqui: rupload_igphoto só aceita a mídia em i.instagram.com
// (pelo www o upload responde ok, mas o configure_to_story devolve 500).

const INSTAGRAM = "https://www.instagram.com/";
const APP_ID = "936619743392459";
const REPASSAR = new Set(["sm-publicar", "sm-conta"]);

chrome.action.onClicked.addListener(async (aba) => {
  try {
    await chrome.tabs.sendMessage(aba.id, { tipo: "sm-alternar" }, { frameId: 0 });
  } catch {
    // decisão: aba sem Instagram (ou sem o content script) abre o Instagram com o painel já aberto.
    await chrome.tabs.create({ url: `${INSTAGRAM}?sm_story=1` });
  }
});

function base64ParaBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function resumoHttp(status, texto) {
  const titulo = /<title[^>]*>([^<]*)<\/title>/i.exec(texto)?.[1];
  let detalhe = titulo || "";
  if (!detalhe) {
    try {
      const j = JSON.parse(texto);
      detalhe = j.message || j.error_type || "";
    } catch {}
  }
  return `HTTP ${status}${detalhe ? `: ${detalhe.replace(/&bull;/g, "·").trim()}` : ""}`;
}

// Pedido do service worker sai com Origin chrome-extension://; o Instagram confere a origem com o csrftoken.
// Regra de sessão reescreve Origin/Referer para www só nos uploads sem aba (tabId -1 = este service worker).
const REGRA_ORIGEM = 1;
async function garantirRegraDeOrigem() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [REGRA_ORIGEM],
      addRules: [
        {
          id: REGRA_ORIGEM,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "origin", operation: "set", value: "https://www.instagram.com" },
              { header: "referer", operation: "set", value: INSTAGRAM },
            ],
          },
          condition: { urlFilter: "||i.instagram.com/rupload_igphoto/", tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ["xmlhttprequest", "other"] },
        },
      ],
    });
  } catch (e) {
    // decisão: sem a regra o envio ainda é tentado; o content script tem outros dois caminhos.
    console.warn("[sm-story] regra de origem não aplicada:", e?.message || e);
  }
}

async function enviarFoto({ imagem, largura, altura, csrf }) {
  await garantirRegraDeOrigem();
  const bytes = base64ParaBytes(imagem);
  const uploadId = String(Date.now());
  const nome = `fb_uploader_${uploadId}`;
  const r = await fetch(`https://i.instagram.com/rupload_igphoto/${nome}`, {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "*/*",
      "content-type": "application/octet-stream",
      offset: "0",
      "x-entity-name": nome,
      "x-entity-type": "image/jpeg",
      "x-entity-length": String(bytes.byteLength),
      "x-ig-app-id": APP_ID,
      "x-csrftoken": csrf,
      "x-instagram-rupload-params": JSON.stringify({
        upload_id: uploadId,
        media_type: 1,
        upload_media_width: largura,
        upload_media_height: altura,
      }),
    },
    body: bytes,
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Envio da foto recusado (${resumoHttp(r.status, texto)})`);
  let j = {};
  try {
    j = JSON.parse(texto);
  } catch {}
  if (j.status === "fail") throw new Error(`Envio da foto recusado: ${j.message || "sem detalhe"}`);
  return String(j.upload_id || uploadId);
}

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (msg?.tipo === "sm-upload") {
    enviarFoto(msg).then(
      (uploadId) => responder({ ok: true, uploadId }),
      (e) => responder({ ok: false, erro: e.message }),
    );
    return true;
  }
  if (!msg || !REPASSAR.has(msg.tipo) || !remetente.tab) return;
  chrome.tabs
    .sendMessage(remetente.tab.id, msg, { frameId: 0 })
    .then(responder, (e) => responder({ ok: false, erro: `Aba do Instagram não respondeu: ${e?.message || e}` }));
  return true;
});
