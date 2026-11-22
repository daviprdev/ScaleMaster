// Scale Master Story — service worker.
// Ícone da extensão abre/fecha o painel na aba do Instagram; o painel (iframe da
// extensão) fala com o content script da aba por aqui, porque não sabe o id da aba.

const INSTAGRAM = "https://www.instagram.com/";
const REPASSAR = new Set(["sm-publicar", "sm-conta"]);

chrome.action.onClicked.addListener(async (aba) => {
  try {
    await chrome.tabs.sendMessage(aba.id, { tipo: "sm-alternar" }, { frameId: 0 });
  } catch {
    // decisão: aba sem Instagram (ou sem o content script) abre o Instagram com o painel já aberto.
    await chrome.tabs.create({ url: `${INSTAGRAM}?sm_story=1` });
  }
});

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (!msg || !REPASSAR.has(msg.tipo) || !remetente.tab) return;
  chrome.tabs
    .sendMessage(remetente.tab.id, msg, { frameId: 0 })
    .then(responder, (e) => responder({ ok: false, erro: `Aba do Instagram não respondeu: ${e?.message || e}` }));
  return true;
});
