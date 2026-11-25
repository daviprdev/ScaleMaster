# Migração VPS → Cloudflare Workers

Branch `migracao-cloudflare`. Worker `scalemaster` (plano Workers Paid), app via OpenNext.

## O que mudou no app
- Sem FFmpeg: todo vídeo vai como está na Biblioteca (modo original). Efeitos e texto na tela do Loop são ignorados.
- Sem proxies: "Usar minhas proxies" e `PUBLISH_PROXIES` não têm efeito; tudo sai direto do Cloudflare.
- Sem python-server: `process-scrape-jobs` fica de fora; Inspirações seguem pela HikerAPI.
- Aba Contas VPS sem agente (as rotas que liam disco só não acham os arquivos).
- "Salvar na Biblioteca" sobe o vídeo em fluxo (o Worker tem 128 MB de memória).
- 14 dos 16 timers viram Cron Triggers (`custom-worker.ts`), atrás de `CRONS_LIGADOS`.

## Passo a passo
1. Dono: assinar Workers Paid e rodar `npx wrangler login` no PC.
2. Deploy sem domínio e com crons desligados (responde em `scalemaster.<conta>.workers.dev`):
   `npm run cf:deploy` e depois `npx wrangler secret bulk cf-secrets.json`
   (`cf-secrets.json` é gerado do `.env.production` da VPS, sem `PYTHON_SERVER_*`, `PUBLISH_PROXIES` e `NEXT_PUBLIC_APP_URL`; fica fora do git).
3. Testar no workers.dev: login, dashboard, Biblioteca, Inspirações → Salvar, agendar um post.
4. Dono: adicionar `scalemaster.tech` na Cloudflare (plano Free de DNS), conferir os registros importados e trocar os nameservers na Hostinger. Esperar a zona ficar Active.
5. Virada, no mesmo minuto:
   - VPS: `systemctl disable --now 'scalemaster-*.timer'`
   - `wrangler.jsonc`: `"routes": [{ "pattern": "scalemaster.tech", "custom_domain": true }]` e `CRONS_LIGADOS: "1"`; `npm run cf:deploy`.
6. Conferir: `https://scalemaster.tech/api/health`, logs dos crons no painel (Workers → scalemaster → Logs), webhook SharkBot/ApexVips (mesma URL), login da Meta (mesmo domínio).
7. Merge da branch na `main`, atualizar o CLAUDE.md e só depois cancelar a VPS.

## Voltar para a VPS
Remover o custom domain do Worker, apontar o A de `scalemaster.tech` para `2.25.244.181` no DNS da Cloudflare e `systemctl enable --now 'scalemaster-*.timer'` na VPS.
