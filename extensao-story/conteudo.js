// Scale Master Story — content script de www.instagram.com.
// Põe o botão flutuante, abre o painel (iframe da extensão) e publica pelo SMInstagram.

(() => {
  if (window.top !== window || window.__smStory) return;
  window.__smStory = true;

  const URL_PAINEL = chrome.runtime.getURL("painel.html");
  let host = null;
  let iframe = null;
  let overflowAntes = "";

  function abrir() {
    if (host) return;
    host = document.createElement("div");
    host.id = "sm-story-host";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:transparent;";
    iframe = document.createElement("iframe");
    iframe.src = URL_PAINEL;
    iframe.title = "Scale Master Story";
    iframe.allow = "clipboard-read; clipboard-write";
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:transparent;color-scheme:dark;";
    host.appendChild(iframe);
    document.documentElement.appendChild(host);
    overflowAntes = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (botao) botao.style.display = "none";
  }

  function fechar() {
    if (!host) return;
    host.remove();
    host = null;
    iframe = null;
    document.documentElement.style.overflow = overflowAntes;
    if (botao) botao.style.display = "";
  }

  const alternar = () => (host ? fechar() : abrir());

  // Botão flutuante: o ícone da extensão às vezes fica escondido na barra do AdsPower.
  let botao = null;
  function criarBotao() {
    botao = document.createElement("button");
    botao.type = "button";
    botao.title = "Scale Master · Story com link";
    botao.setAttribute("aria-label", "Abrir Scale Master Story");
    botao.style.cssText = [
      "position:fixed",
      "top:14px",
      "right:14px",
      "z-index:2147483646",
      "width:44px",
      "height:44px",
      "padding:0",
      "border-radius:12px",
      "border:1px solid #1b2333",
      "background:#0a0e17",
      "box-shadow:0 8px 24px rgba(0,0,0,.45)",
      "cursor:pointer",
      "overflow:hidden",
    ].join(";");
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icones/48.png");
    img.alt = "";
    img.style.cssText = "width:100%;height:100%;display:block;pointer-events:none;";
    botao.appendChild(img);
    botao.addEventListener("click", abrir);
    document.documentElement.appendChild(botao);
  }

  window.addEventListener("message", (e) => {
    if (!iframe || e.source !== iframe.contentWindow) return;
    if (e.data?.sm === "fechar") fechar();
  });

  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo === "sm-alternar") {
      alternar();
      responder({ ok: true });
      return;
    }
    if (msg?.tipo === "sm-conta") {
      SMInstagram.contaAtual().then(
        (conta) => responder({ ok: true, conta }),
        (e) => responder({ ok: false, erro: e.message }),
      );
      return true;
    }
    if (msg?.tipo === "sm-publicar") {
      const avisar = (texto) => chrome.runtime.sendMessage({ tipo: "sm-progresso", job: msg.job, texto }).catch(() => {});
      SMInstagram.publicarStory(msg.pedido, avisar).then(
        (resultado) => responder({ ok: true, resultado }),
        (e) => responder({ ok: false, erro: e.message }),
      );
      return true;
    }
  });

  criarBotao();
  if (new URLSearchParams(location.search).has("sm_story")) abrir();
})();
