# Scale Master Story (extensão Chrome / AdsPower)

Publica story com adesivo de link (texto, cor, tamanho e posição escolhidos) e fixa no destaque, usando a sessão do Instagram do próprio perfil do AdsPower.

## Instalar

- **AdsPower:** rode `scripts\empacotar-extensao-story.ps1` → `dist\scalemaster-story-<versão>.zip`. No AdsPower: Extensões → Enviar extensão → escolha o `.zip` → aplique ao grupo de perfis.
- **Chrome comum (teste):** `chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação → pasta `extensao-story/`.

## Usar

Abra `www.instagram.com` logado no perfil → botão com o logo (canto superior direito) ou ícone da extensão → solte a foto → aba **Link** (endereço, texto, cor, tamanho; arraste o adesivo na arte) → aba **Destaque** (nome; juntar ao existente ou criar outro) → **Publicar agora**. O registro embaixo do botão mostra cada passo e o erro do Instagram quando há.

Os ajustes ficam salvos no perfil (`chrome.storage.local`); a foto não.

## Como publica (`instagram.js`)

1. `POST /rupload_igphoto/fb_uploader_<id>` — arte JPEG 1080×1920 com o adesivo desenhado.
2. `POST /api/v1/media/validate_reel_url/` — conferência do link (falha só avisa).
3. `POST /api/v1/media/configure_to_story/` com `tap_models` (`story_link`, `link_sticker_default`, x/y/largura/altura do adesivo em fração da tela). Se recusar, tenta `/api/v1/web/create/configure_to_story/` e avisa quando a resposta não traz o link.
4. Destaque: `GET /api/v1/highlights/<uid>/highlights_tray/` acha pelo nome normalizado (sem acento, emoji, caixa) → `POST /api/v1/highlights/highlight:<pk>/edit_reel/`; senão `POST /api/v1/highlights/create_reel/` com o story de capa. 3 tentativas, id `pk_uid` e depois `pk`.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `manifest.json` | MV3, só `storage` + `www.instagram.com` |
| `background.js` | ícone abre/fecha o painel; repassa painel ↔ aba |
| `conteudo.js` | botão flutuante, iframe do painel, recebe o pedido |
| `instagram.js` | chamadas ao Instagram |
| `painel.*` | editor (Foto / Link / Destaque / Ajuda), tokens do design system do SaaS |

Ícones e fonte saem do SaaS: `node scripts/extensao-story-icones.mjs`.
