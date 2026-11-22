// Scale Master Story — painel (iframe da extensão dentro do Instagram).
// Monta a arte 1080×1920 com o adesivo desenhado, guarda os ajustes e pede a
// publicação ao content script da aba (via background).

const W = 1080;
const H = 1920;
const MAX_BYTES = 20 * 1024 * 1024;

const temExtensao = typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.storage?.local;

const PADRAO = {
  url: "",
  texto: "CLIQUE AQUI | CLICK HERE",
  cor: "branco-azul",
  tamanho: 100,
  x: 0.5,
  y: 0.62,
  enquadramento: "preencher",
  posFoto: 50,
  destaqueAtivo: true,
  destaqueNome: "LINKADA",
  destaqueModo: "juntar",
};

const CORES = {
  "branco-azul": { fundo: "#ffffff", tinta: "#2f7bf5" },
  "branco-preto": { fundo: "#ffffff", tinta: "#111111" },
  "azul-branco": { fundo: "#2f7bf5", tinta: "#ffffff" },
  "preto-branco": { fundo: "rgba(17,17,17,0.92)", tinta: "#ffffff" },
  vidro: { fundo: "rgba(255,255,255,0.22)", tinta: "#ffffff", borda: "rgba(255,255,255,0.6)" },
};

const $ = (id) => document.getElementById(id);
const el = {
  palco: $("palco"),
  soltar: $("soltar"),
  previa: $("previa"),
  dica: $("dica-arrastar"),
  arquivo: $("arquivo"),
  publicar: $("publicar"),
  log: $("log"),
  url: $("url"),
  urlErro: $("url-erro"),
  texto: $("texto"),
  textoConta: $("texto-conta"),
  cor: $("cor"),
  tamanho: $("tamanho"),
  tamanhoValor: $("tamanho-valor"),
  posFoto: $("pos-foto"),
  posFotoValor: $("pos-foto-valor"),
  destaqueAtivo: $("destaque-ativo"),
  destaqueNome: $("destaque-nome"),
  conta: $("conta"),
  contaTexto: $("conta-texto"),
};

let estado = { ...PADRAO };
let foto = null;
let conta = null;
let publicando = false;
let publicouUma = false;
let jobAtual = null;
let geo = null;
const base = document.createElement("canvas");
base.width = W;
base.height = H;

// ── ajustes salvos ─────────────────────────────────────
async function carregarEstado() {
  try {
    if (temExtensao) {
      const { sm } = await chrome.storage.local.get("sm");
      return { ...PADRAO, ...(sm || {}) };
    }
    return { ...PADRAO, ...JSON.parse(localStorage.getItem("sm-story") || "{}") };
  } catch {
    return { ...PADRAO };
  }
}

let salvarTimer = 0;
function salvar() {
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(() => {
    try {
      if (temExtensao) chrome.storage.local.set({ sm: estado });
      else localStorage.setItem("sm-story", JSON.stringify(estado));
    } catch {}
  }, 250);
}

// ── desenho ────────────────────────────────────────────
function desenharBase() {
  const c = base.getContext("2d");
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  if (!foto) return;
  const iw = foto.width;
  const ih = foto.height;
  const cobrir = Math.max(W / iw, H / ih);
  if (estado.enquadramento === "inteira") {
    const bw = iw * cobrir * 1.15;
    const bh = ih * cobrir * 1.15;
    c.save();
    c.filter = "blur(40px) brightness(0.6)";
    c.drawImage(foto, (W - bw) / 2, (H - bh) / 2, bw, bh);
    c.restore();
    const caber = Math.min(W / iw, H / ih);
    const cw = iw * caber;
    const ch = ih * caber;
    c.drawImage(foto, (W - cw) / 2, (H - ch) / 2, cw, ch);
  } else {
    const p = estado.posFoto / 100;
    const dw = iw * cobrir;
    const dh = ih * cobrir;
    c.drawImage(foto, (W - dw) * p, (H - dh) * p, dw, dh);
  }
}

function geometria(ctx) {
  const texto = estado.texto.trim() || "LINK";
  let esc = estado.tamanho / 100;
  let g;
  for (let i = 0; i < 8; i++) {
    const h = 140 * esc;
    const fs = h * 0.36;
    const icone = h * 0.46;
    const padX = h * 0.34;
    const gap = h * 0.2;
    ctx.font = `500 ${fs}px Geist, system-ui, sans-serif`;
    const tw = ctx.measureText(texto).width;
    g = { w: padX + icone + gap + tw + padX, h, fs, icone, padX, gap, texto };
    if (g.w <= W - 40) break;
    esc *= (W - 40) / g.w; // decisão: texto comprido encolhe o adesivo inteiro em vez de cortar.
  }
  const margem = 12;
  const minX = (g.w / 2 + margem) / W;
  const minY = (g.h / 2 + margem) / H;
  estado.x = Math.min(1 - minX, Math.max(minX, estado.x));
  estado.y = Math.min(1 - minY, Math.max(minY, estado.y));
  g.cx = estado.x * W;
  g.cy = estado.y * H;
  return g;
}

function desenharElo(ctx, cx, cy, s, cor) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.strokeStyle = cor;
  ctx.lineWidth = s * 0.13;
  const lw = s * 0.62;
  const lh = s * 0.36;
  const off = s * 0.2;
  for (const dx of [-off, off]) {
    ctx.beginPath();
    ctx.roundRect(dx - lw / 2, -lh / 2, lw, lh, lh / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function desenharAdesivo(ctx, g) {
  const cor = CORES[estado.cor] || CORES["branco-azul"];
  const x0 = g.cx - g.w / 2;
  const y0 = g.cy - g.h / 2;
  const raio = g.h * 0.3;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = g.h * 0.25;
  ctx.shadowOffsetY = g.h * 0.05;
  ctx.beginPath();
  ctx.roundRect(x0, y0, g.w, g.h, raio);
  ctx.fillStyle = cor.fundo;
  ctx.fill();
  ctx.restore();
  if (cor.borda) {
    ctx.save();
    ctx.lineWidth = Math.max(2, g.h * 0.025);
    ctx.strokeStyle = cor.borda;
    ctx.beginPath();
    ctx.roundRect(x0, y0, g.w, g.h, raio);
    ctx.stroke();
    ctx.restore();
  }
  desenharElo(ctx, x0 + g.padX + g.icone / 2, g.cy, g.icone, cor.tinta);
  ctx.fillStyle = cor.tinta;
  ctx.font = `500 ${g.fs}px Geist, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(g.texto, x0 + g.padX + g.icone + g.gap, g.cy + g.fs * 0.05);
}

let quadro = 0;
function renderizar() {
  if (quadro) return;
  quadro = requestAnimationFrame(() => {
    quadro = 0;
    const ctx = el.previa.getContext("2d");
    ctx.drawImage(base, 0, 0);
    geo = geometria(ctx);
    desenharAdesivo(ctx, geo);
  });
}

function ajustarPrevia() {
  const r = el.palco.getBoundingClientRect();
  const h = Math.max(100, Math.min(r.height - 24, ((r.width - 24) * 16) / 9));
  el.previa.style.height = `${h}px`;
  el.previa.style.width = `${(h * 9) / 16}px`;
}

// ── foto ───────────────────────────────────────────────
async function carregarFoto(arquivo) {
  if (!arquivo) return;
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) {
    logar(`Formato não aceito (${arquivo.type || "desconhecido"}): use JPG, PNG ou WEBP.`, "erro");
    return;
  }
  if (arquivo.size > MAX_BYTES) {
    logar("A foto passa de 20 MB.", "erro");
    return;
  }
  try {
    foto = await createImageBitmap(arquivo);
  } catch {
    logar("Não consegui abrir essa imagem.", "erro");
    return;
  }
  el.soltar.hidden = true;
  el.previa.hidden = false;
  el.dica.hidden = false;
  ajustarPrevia();
  desenharBase();
  renderizar();
  atualizarBotao();
}

el.arquivo.addEventListener("change", () => {
  carregarFoto(el.arquivo.files[0]);
  el.arquivo.value = "";
});
$("escolher").addEventListener("click", () => el.arquivo.click());
$("trocar").addEventListener("click", () => el.arquivo.click());

["dragenter", "dragover"].forEach((t) =>
  window.addEventListener(t, (e) => {
    e.preventDefault();
    el.palco.classList.add("arrastando-arquivo");
  }),
);
["dragleave", "drop"].forEach((t) =>
  window.addEventListener(t, (e) => {
    e.preventDefault();
    if (t === "dragleave" && e.relatedTarget) return;
    el.palco.classList.remove("arrastando-arquivo");
  }),
);
window.addEventListener("drop", (e) => carregarFoto(e.dataTransfer?.files?.[0]));

// ── arrastar o adesivo ─────────────────────────────────
let arrasto = null;
function ponto(e) {
  const r = el.previa.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
}
function sobreAdesivo(p) {
  return geo && Math.abs(p.x - geo.cx) <= geo.w / 2 && Math.abs(p.y - geo.cy) <= geo.h / 2;
}
el.previa.addEventListener("pointerdown", (e) => {
  const p = ponto(e);
  if (!sobreAdesivo(p)) return;
  arrasto = { dx: p.x - geo.cx, dy: p.y - geo.cy };
  el.previa.setPointerCapture(e.pointerId);
  el.previa.classList.add("movendo");
  el.dica.hidden = true;
});
el.previa.addEventListener("pointermove", (e) => {
  const p = ponto(e);
  if (!arrasto) {
    el.previa.classList.toggle("sobre-adesivo", !!sobreAdesivo(p));
    return;
  }
  estado.x = (p.x - arrasto.dx) / W;
  estado.y = (p.y - arrasto.dy) / H;
  renderizar();
});
const soltarAdesivo = () => {
  if (!arrasto) return;
  arrasto = null;
  el.previa.classList.remove("movendo");
  salvar();
};
el.previa.addEventListener("pointerup", soltarAdesivo);
el.previa.addEventListener("pointercancel", soltarAdesivo);

// ── campos ─────────────────────────────────────────────
function validarUrl(v) {
  const bruto = String(v || "").trim();
  if (!bruto) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

function mostrarErroUrl(msg) {
  el.urlErro.textContent = msg || "";
  el.urlErro.hidden = !msg;
  el.url.classList.toggle("invalido", !!msg);
}

el.url.addEventListener("input", () => {
  estado.url = el.url.value.trim();
  mostrarErroUrl("");
  salvar();
  atualizarBotao();
});
el.url.addEventListener("blur", () => {
  if (!estado.url || estado.url === "https://") return;
  const ok = validarUrl(estado.url);
  if (ok) {
    el.url.value = estado.url = ok;
    salvar();
  } else mostrarErroUrl("Link inválido: use um endereço como https://site.com/pagina");
});
el.texto.addEventListener("input", () => {
  estado.texto = el.texto.value;
  el.textoConta.textContent = `${[...estado.texto].length}/40`;
  renderizar();
  salvar();
  atualizarBotao();
});
el.cor.addEventListener("change", () => {
  estado.cor = el.cor.value;
  renderizar();
  salvar();
});
el.tamanho.addEventListener("input", () => {
  estado.tamanho = Number(el.tamanho.value);
  el.tamanhoValor.textContent = estado.tamanho;
  renderizar();
  salvar();
});
$("centralizar").addEventListener("click", () => {
  estado.x = 0.5;
  estado.y = 0.5;
  renderizar();
  salvar();
});
el.posFoto.addEventListener("input", () => {
  estado.posFoto = Number(el.posFoto.value);
  el.posFotoValor.textContent = `${estado.posFoto}%`;
  desenharBase();
  renderizar();
  salvar();
});
el.destaqueAtivo.addEventListener("change", () => {
  estado.destaqueAtivo = el.destaqueAtivo.checked;
  el.destaqueNome.disabled = !estado.destaqueAtivo;
  salvar();
  atualizarBotao();
});
el.destaqueNome.addEventListener("input", () => {
  estado.destaqueNome = el.destaqueNome.value;
  salvar();
  atualizarBotao();
});

function ligarSegmento(id, chave, aoMudar) {
  const caixa = $(id);
  const marcar = () =>
    caixa.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.valor === estado[chave])));
  caixa.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    estado[chave] = b.dataset.valor;
    marcar();
    salvar();
    aoMudar?.();
  });
  return marcar;
}
const marcarEnquadramento = ligarSegmento("enquadramento", "enquadramento", () => {
  desenharBase();
  renderizar();
});
const marcarModo = ligarSegmento("destaque-modo", "destaqueModo");

// ── abas ───────────────────────────────────────────────
function abrirAba(nome) {
  document.querySelectorAll(".abas button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === nome)));
  document.querySelectorAll(".painel-aba").forEach((p) => (p.hidden = p.dataset.painel !== nome));
}
document.querySelector(".abas").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-aba]");
  if (b) abrirAba(b.dataset.aba);
});

// ── registro ───────────────────────────────────────────
function logar(texto, nivel = "", link) {
  const li = document.createElement("li");
  if (nivel) li.className = nivel;
  li.append(document.createTextNode(texto));
  if (link) {
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = link.texto;
    li.append(" ", a);
  }
  el.log.append(li);
  li.scrollIntoView({ block: "nearest" });
}

function atualizarBotao() {
  el.publicar.disabled = publicando || !foto;
  el.publicar.textContent = publicando ? "Publicando…" : publicouUma ? "Publicar de novo" : "Publicar agora";
}

// ── publicar ───────────────────────────────────────────
function paraBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function publicar() {
  if (publicando || !foto) return;
  const url = validarUrl(estado.url);
  if (!url) {
    abrirAba("link");
    mostrarErroUrl("Cole o link para onde o adesivo leva.");
    el.url.focus();
    return;
  }
  if (!estado.texto.trim()) {
    abrirAba("link");
    el.texto.focus();
    return;
  }
  if (estado.destaqueAtivo && !estado.destaqueNome.trim()) {
    abrirAba("destaque");
    el.destaqueNome.focus();
    return;
  }
  el.log.textContent = "";
  if (!temExtensao) {
    logar("Abra o painel pelo Instagram (ícone da Scale Master) para publicar.", "erro");
    return;
  }

  publicando = true;
  atualizarBotao();
  jobAtual = crypto.randomUUID();
  try {
    logar(`Montando a arte 1080 × 1920${conta ? ` para @${conta.username}` : ""}…`);
    const ctx = el.previa.getContext("2d");
    ctx.drawImage(base, 0, 0);
    geo = geometria(ctx);
    desenharAdesivo(ctx, geo);
    const blob = await new Promise((ok) => el.previa.toBlob(ok, "image/jpeg", 0.92));
    const pedido = {
      imagem: paraBase64(new Uint8Array(await blob.arrayBuffer())),
      largura: W,
      altura: H,
      link: { url, x: geo.cx / W, y: geo.cy / H, width: geo.w / W, height: geo.h / H },
      destaque: estado.destaqueAtivo ? { titulo: estado.destaqueNome.trim(), modo: estado.destaqueModo } : null,
    };
    const resp = await chrome.runtime.sendMessage({ tipo: "sm-publicar", job: jobAtual, pedido });
    if (!resp?.ok) throw new Error(resp?.erro || "Sem resposta da aba do Instagram.");
    const r = resp.resultado;
    publicouUma = true;
    logar(
      "Story publicado.",
      "ok",
      conta?.username ? { href: `https://www.instagram.com/stories/${conta.username}/`, texto: "Abrir o story" } : null,
    );
    if (!r.linkOk) logar(`O Instagram publicou, mas a resposta não trouxe o adesivo de link (caminho ${r.via}). Abra o story e confira o toque no adesivo.`, "aviso");
    if (r.destaque?.erro) logar(`Destaque falhou: ${r.destaque.erro} O story continua publicado.`, "erro");
    else if (r.destaque) logar(r.destaque.acao === "criado" ? `Destaque "${r.destaque.titulo}" criado com o story.` : `Story juntado ao destaque "${r.destaque.titulo}".`, "ok");
  } catch (e) {
    logar(e?.message || String(e), "erro");
  } finally {
    publicando = false;
    jobAtual = null;
    atualizarBotao();
  }
}
el.publicar.addEventListener("click", publicar);

if (temExtensao) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.tipo === "sm-progresso" && msg.job && msg.job === jobAtual) logar(msg.texto);
  });
}

// ── conta e fechar ─────────────────────────────────────
async function lerConta() {
  if (!temExtensao) {
    el.contaTexto.textContent = "Fora do Instagram (só pré-visualização)";
    return;
  }
  try {
    const resp = await chrome.runtime.sendMessage({ tipo: "sm-conta" });
    if (!resp?.ok) throw new Error(resp?.erro || "sem resposta");
    conta = resp.conta;
    el.conta.classList.add("ok");
    el.contaTexto.textContent = conta.username ? `Publicando em @${conta.username}` : "Conta logada";
  } catch (e) {
    el.conta.classList.add("erro");
    el.contaTexto.textContent = e.message;
    el.conta.title = e.message;
  }
}

function fechar() {
  if (publicando) return;
  window.parent.postMessage({ sm: "fechar" }, "*");
}
$("fechar").addEventListener("click", fechar);
$("fundo").addEventListener("click", fechar);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fechar();
});

// ── início ─────────────────────────────────────────────
(async () => {
  estado = await carregarEstado();
  el.url.value = estado.url;
  el.texto.value = estado.texto;
  el.textoConta.textContent = `${[...estado.texto].length}/40`;
  el.cor.value = estado.cor;
  el.tamanho.value = estado.tamanho;
  el.tamanhoValor.textContent = estado.tamanho;
  el.posFoto.value = estado.posFoto;
  el.posFotoValor.textContent = `${estado.posFoto}%`;
  el.destaqueAtivo.checked = estado.destaqueAtivo;
  el.destaqueNome.value = estado.destaqueNome;
  el.destaqueNome.disabled = !estado.destaqueAtivo;
  marcarEnquadramento();
  marcarModo();
  atualizarBotao();
  new ResizeObserver(() => !el.previa.hidden && ajustarPrevia()).observe(el.palco);
  try {
    await document.fonts.load("500 40px Geist");
  } catch {}
  lerConta();
})();
