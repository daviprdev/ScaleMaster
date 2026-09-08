# Deploy do AutoScale numa VPS (Docker)

Este guia sobe o AutoScale numa VPS limpa (Ubuntu/Debian) usando Docker.
Banco, Auth e Storage continuam no **Supabase** — nada de banco roda aqui.

## Arquitetura da stack

| Serviço         | Imagem / origem                     | Papel                                                        |
|-----------------|-------------------------------------|--------------------------------------------------------------|
| `web`           | `Dockerfile` (raiz)                 | Next.js 15 (`next build` / `next start`), porta interna 3000 |
| `python-server` | `python_server/Dockerfile`          | FastAPI + instagrapi, porta interna 8000                     |
| `caddy`         | `caddy:2-alpine`                    | Reverse proxy + TLS automático (Let's Encrypt), portas 80/443|
| `cron`          | `cron/Dockerfile` (busybox crond)   | Dispara os 13 endpoints de cron, autenticado com `CRON_SECRET` |

Só o `caddy` expõe portas para a internet (80/443). `web` e `python-server`
ficam acessíveis apenas pela rede interna do compose.

## Pré-requisitos

- Docker Engine + Docker Compose v2 (`docker compose version`).
- Um domínio com DNS (registro A/AAAA) apontando para o IP da VPS.
- Portas **80** e **443** liberadas no firewall.
- Um projeto Supabase já existente (com o schema aplicado).

## Passo a passo

```bash
# 1. Clonar o repositório
git clone https://github.com/daviprdev/AutoScale-IA.git
cd AutoScale-IA

# 2. Criar e preencher o .env
cp .env.example .env
nano .env          # preencha TODAS as variáveis (ver notas abaixo)

# 3. Subir a stack (build + up em background)
docker compose up -d --build

# 4. Acompanhar a inicialização
docker compose ps
docker compose logs -f web
```

Ao terminar, acesse `https://SEU_DOMINIO` — o Caddy já terá emitido o
certificado TLS automaticamente (pode levar alguns segundos no primeiro acesso).

### Notas sobre o `.env`

- **`DOMAIN`** e **`ACME_EMAIL`**: usados pelo Caddy para o TLS.
- **`NEXT_PUBLIC_*`**: são embutidas no bundle **em tempo de build**. Se você
  mudar alguma delas depois, precisa **rebuildar** o `web`:
  `docker compose up -d --build web`.
- **`CRON_SECRET`**: precisa ser o mesmo valor que a aplicação valida — o
  serviço `cron` o envia como `Authorization: Bearer <CRON_SECRET>`. Sem ele,
  a aplicação recusa os crons (comportamento fail-closed já existente).
- **`PYTHON_SERVER_URL`**: deixe `http://python-server:8000` (nome interno do
  serviço no compose).

## Conferindo que os crons estão disparando

Os 13 jobs vivem em `cron/crontab` (formato cron padrão de 5 campos, em UTC —
idêntico ao `vercel.json`). O serviço `cron` loga cada disparo:

```bash
docker compose logs -f cron
```

Saída esperada a cada tick (o `HTTP 200` confirma que o `web` respondeu e o
`CRON_SECRET` foi aceito):

```
[cron] iniciando — alvo: http://web:3000 — 13 jobs carregados de /etc/crontabs/root
[cron 2026-09-08T12:01:00Z] /api/cron/publish-scheduled -> HTTP 200
[cron 2026-09-08T12:02:00Z] /api/cron/publish-pending -> HTTP 200
[cron 2026-09-08T12:05:00Z] /api/cron/process-loops -> HTTP 200
```

- `HTTP 401` → `CRON_SECRET` divergente entre o `.env` e o que a app espera.
- `FALHA: ...` (curl) → o `web` ainda não subiu ou não está acessível na rede
  interna. Cheque `docker compose logs web`.

Para testar um endpoint manualmente de dentro da rede do compose:

```bash
docker compose exec cron \
  curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer SEU_CRON_SECRET" \
  http://web:3000/api/cron/publish-scheduled
```

## Os 13 crons (iguais ao vercel.json)

| Schedule (UTC)  | Endpoint                              |
|-----------------|---------------------------------------|
| `*/5 * * * *`   | `/api/cron/prefetch-clone-urls`       |
| `*/5 * * * *`   | `/api/cron/process-videos`            |
| `*/5 * * * *`   | `/api/cron/process-loops`             |
| `*/2 * * * *`   | `/api/cron/publish-pending`           |
| `* * * * *`     | `/api/cron/publish-scheduled`         |
| `0 2 * * *`     | `/api/analytics/sync`                 |
| `0 */12 * * *`  | `/api/cron/refresh-tokens`            |
| `*/30 * * * *`  | `/api/cron/story-templates`           |
| `*/10 * * * *`  | `/api/cron/sync-distribute-accounts`  |
| `*/10 * * * *`  | `/api/cron/process-instagram-logins`  |
| `*/5 * * * *`   | `/api/cron/sync-post-insights`        |
| `*/15 * * * *`  | `/api/cron/daily-profit-notification` |
| `*/10 * * * *`  | `/api/cron/check-health-alerts`       |

## Operação do dia a dia

```bash
docker compose ps                      # status dos serviços
docker compose logs -f web             # logs da aplicação
docker compose logs -f cron            # logs dos crons
docker compose pull && docker compose up -d --build   # atualizar após git pull
docker compose down                    # derrubar a stack (mantém volumes/TLS)
```

Os certificados TLS ficam no volume `caddy_data` e sobrevivem a `down`/`up`.
