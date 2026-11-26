# Scale Master Story (extensão Chrome / AdsPower)

Publica story com adesivo de link (texto, cor, tamanho e posição escolhidos) e fixa no destaque, usando a sessão do Instagram do próprio perfil do AdsPower.

## Instalar

- **AdsPower:** rode `scripts\empacotar-extensao-story.ps1` → `dist\scalemaster-story-<versão>.zip`. No AdsPower: Extensões → Enviar extensão → escolha o `.zip` → aplique ao grupo de perfis.
- **Chrome comum (teste):** `chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação → pasta `extensao-story/`.

## Usar

Abra `www.instagram.com` logado no perfil → botão com o logo (canto superior direito) ou ícone da extensão → solte a foto → aba **Link** (endereço, texto, cor, tamanho; arraste o adesivo na arte) → aba **Destaque** (nome; juntar ao existente ou criar outro) → **Publicar agora**. O registro embaixo do botão mostra cada passo e o erro do Instagram quando há.

Os ajustes ficam salvos no perfil (`chrome.storage.local`); a foto não.

## Como publica (`instagram.js`)

1. `POST https://i.instagram.com/rupload_igphoto/fb_uploader_<id>` — arte JPEG 1080×1920 com o adesivo desenhado. Três caminhos em ordem (1.0.2): da página para `i.instagram.com`; do service worker (`background.js`, Origin/Referer reescritos para `www` por regra de sessão do `declarativeNetRequest`); da página para `www` (na 1.0.0 esse subia, mas o configure seguinte dava HTTP 500). O registro diz qual caminho aceitou.
2. `POST /api/v1/media/configure_to_story/` (da página) com `upload_id`, `configure_mode=1`, `source_type=4`, `edits`/`extra` com o tamanho, `_uid`/`_uuid`/`_csrftoken` e `story_link_stickers` `[{x, y, z, width, height, rotation, type: "story_link", is_sticker, link_type: "web", url, tap_state_str_id}]` + `story_sticker_ids=link_sticker_default` (centro e tamanho do adesivo em fração da tela). 500 = foto ainda processando: 4 tentativas.
3. Destaque: `GET /api/v1/highlights/<uid>/highlights_tray/` acha pelo nome normalizado (sem acento, emoji, caixa) → `POST /api/v1/highlights/highlight:<pk>/edit_reel/`; senão `POST /api/v1/highlights/create_reel/` (`source` `self_profile`, depois `story_viewer_profile`). `cover` e `media_ids` levam o ID completo `<pk>_<uid>` tirado do `media.id` em texto: o `pk` numérico passa de 2^53 e perde dígitos no `JSON.parse` (até a 1.0.1 o destaque ia com o ID errado). 3 tentativas.

`/api/v1/media/validate_reel_url/` e `/api/v1/web/create/configure_to_story/` dão 404 pelo `www`.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `manifest.json` | MV3, `storage` + `declarativeNetRequestWithHostAccess`; hosts `www` e `i.instagram.com` |
| `background.js` | ícone abre/fecha o painel; repassa painel ↔ aba |
| `conteudo.js` | botão flutuante, iframe do painel, recebe o pedido |
| `instagram.js` | chamadas ao Instagram |
| `painel.*` | editor (Foto / Link / Destaque / Ajuda), tokens do design system do SaaS |

Ícones e fonte saem do SaaS: `node scripts/extensao-story-icones.mjs`.
