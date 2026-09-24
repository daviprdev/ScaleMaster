# Worker RPA de Onboarding — Arquitetura Separada do SaaS

## Visão Geral

A automação de onboarding (RPA via Playwright) é um **serviço independente** do SaaS Next.js. O SaaS apenas grava jobs na tabela `onboarding_jobs` no Supabase; o worker Python faz polling, executa o RPA e atualiza os resultados.

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   SaaS (Vercel) │────▶│  Supabase DB │◀────│ Worker RPA (VPS)│
│  Next.js App    │     │ onboarding_  │     │ Python + Playwr │
│                 │     │    jobs      │     │                 │
│ - Dashboard     │     │              │     │ - Polling 30s   │
│ - Upload mídias │     │ - pending    │     │ - Executa RPA   │
│ - Import CSV    │     │ - processing │     │ - Atualiza status│
│ - Templates     │     │ - done/error │     │ - Retry c/ proxy│
└─────────────────┘     └──────────────┘     └─────────────────┘
```

## Por que separado?

| Motivo | Explicação |
|--------|-----------|
| **Recursos** | Playwright + Chromium consome 400-600MB RAM por sessão. Vercel serverless tem limite de 1GB e timeout de 5min. |
| **Persistência** | Perfis de navegador precisam de disco persistente (cookies, storage state). Serverless é efêmero. |
| **Controle** | Worker dedicado permite gerenciar concorrência, retry, proxy swap e logs sem limitações de plataforma. |
| **Custo** | VPS €7/mês aguenta 5-8 sessões simultâneas. No Railway/Vercel custaria 3-5x mais. |
| **Isolamento** | Falhas no RPA não afetam o SaaS. Deploy independente. |

## Infraestrutura Recomendada

### VPS: Hetzner Cloud CPX21
- **3 vCPU, 4GB RAM, 80GB NVMe**
- **€7.49/mês** (~R$45)
- Datacenter Europa (latência baixa para Instagram)
- Ubuntu 22.04 LTS

### Alternativas
| Provedor | Plano | Preço | Obs |
|----------|-------|-------|-----|
| DigitalOcean | Basic 2GB | $6/mês | Limite apertado para Playwright |
| Contabo | Cloud S | €4.99/mês | 8GB RAM mas rede mais lenta |
| Railway | Service separado | ~$10/mês | Zero config, menos controle |

---

## Como as contas se conectam ao SaaS

### Fluxo Completo

```
1. Usuário cria template no SaaS (app_id, foto, story, highlight)
2. Usuário importa contas via CSV (username, senha, proxy, 2FA opcional)
3. SaaS grava jobs na tabela `onboarding_jobs` com status=pending
4. Worker detecta job pending → marca processing → executa RPA
5. RPA faz: login → aceita convite → troca foto → posta story → cria destaque
6. Worker atualiza status=done (ou error com motivo)
7. SaaS mostra resultado no dashboard em tempo real
```

### A conexão SaaS ↔ Worker acontece via Supabase

O SaaS e o Worker compartilham a **mesma tabela** `onboarding_jobs` no Supabase:

- **SaaS escreve**: insere jobs com credenciais criptografadas
- **Worker lê**: faz polling a cada 30s buscando `status=pending`
- **Worker escreve**: atualiza `status`, `stage_status`, `error_message`, `processed_at`
- **SaaS lê**: dashboard consulta a mesma tabela para mostrar progresso

Não há chamada HTTP direta entre SaaS e Worker. O Supabase é o barramento.

### Segurança das Credenciais

- Senha, 2FA e proxy são criptografados com AES-256-GCM antes de gravar no banco
- Chave de criptografia (`ENCRYPTION_SECRET`) está no Vercel (SaaS) e na VPS (Worker)
- Worker decifra apenas em memória, nunca loga credenciais
- Colunas sensíveis (`password_enc`, `two_factor_enc`, `proxy_url_enc`) não são expostas via API pública

---

## Prompt Completo para Desenvolvimento do Worker

### Contexto para IA / Desenvolvedor

```
Você vai desenvolver um worker Python standalone que executa automação RPA
de onboarding de contas Instagram. Este worker é SEPARADO do SaaS Next.js
e roda em uma VPS dedicada.

## ARQUITETURA

O worker faz polling na tabela `onboarding_jobs` do Supabase, executa o
fluxo RPA via Playwright, e atualiza os resultados na mesma tabela. Não
há comunicação HTTP com o SaaS — tudo via banco compartilhado.

## TABELA onboarding_jobs

Colunas relevantes:
- id (uuid PK)
- user_id (uuid FK)
- username (text)
- stage (text): 'photo' | 'story' | 'highlight' | 'done'
- stage_status (jsonb): {rpa: {state, reason}}
- status (text): 'pending' | 'processing' | 'done' | 'error'
- password_enc (text): senha criptografada AES-256-GCM
- two_factor_enc (text): TOTP secret criptografado (nullable)
- proxy_url_enc (text): proxy criptografada
- photo_url (text): URL pública da foto no Supabase Storage
- story_media_url (text): URL pública do vídeo/imagem do story
- story_link_url (text): URL do sticker de link no story
- highlight_title (text): título do destaque
- retry_count (int): tentativas já feitas
- retry_after (timestamptz): quando pode tentar novamente
- error_message (text): último erro
- processed_at (timestamptz): quando terminou
- created_at (timestamptz)
- updated_at (timestamptz)

## FLUXO DO WORKER

Loop principal (a cada 30 segundos):

1. Buscar até N jobs com status='pending' AND (retry_after IS NULL OR
   retry_after <= NOW()), ordenados por retry_after ASC
2. Para cada job:
   a. Claim atômico: UPDATE SET status='processing' WHERE id=X AND
      status='pending' (evita race condition com múltiplos workers)
   b. Se claim falhou → pular (outro worker pegou)
   c. Decifrar credenciais (senha, 2FA, proxy)
   d. Validar proxy (se ausente/inválida → voltar pra pending com
      retry_after + 15min)
   e. Baixar mídias (photo_url, story_media_url) para /tmp via httpx
   f. Executar run_onboarding_rpa() do módulo onboarding_rpa.py
   g. Se sucesso → status='done', stage='done'
   h. Se falha permanente (needs_2fa, challenge_required, login_failed)
      → status='error'
   i. Se falha transitória → retry_count++, backoff exponencial
      (5min * 2^retry_count, max 60min), status='pending'
   j. Limpar arquivos temporários
3. Auto-healing: jobs presos em 'processing' há >15min voltam pra 'pending'
4. Sleep 30s até próximo ciclo

## MÓDULO onboarding_rpa.py (JÁ EXISTE)

O arquivo python_server/onboarding_rpa.py já contém:
- Classe InstagramRPA com métodos: start(), stop(), login(),
  accept_tester_invite(), change_profile_photo(), post_story_with_link(),
  create_highlight_from_story()
- Função run_onboarding_rpa() que orquestra o fluxo completo
- Helper _download_to_temp() para baixar URLs públicas
- Suporte a proxy, TOTP, perfis persistentes
- Logs detalhados [RPA:username] em cada etapa

O worker deve importar e usar este módulo diretamente (sem HTTP).

## CRIPTOGRAFIA

As credenciais usam AES-256-GCM com ENCRYPTION_SECRET.
Implementar decrypt(encrypted_text) usando cryptography.Fernet ou
AES-GCM compatível com lib/encrypt.ts do SaaS.

## CONFIGURAÇÃO VIA ENV VARS

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ENCRYPTION_SECRET=base64_encoded_key
ONBOARDING_PROFILES_DIR=/opt/rpa/profiles
MAX_CONCURRENT_JOBS=3
POLL_INTERVAL_SECONDS=30
PYTHON_SERVER_SECRET=shared_secret (opcional, para health check)

## DEPLOY NA VPS

1. Docker Compose com imagem python:3.11-slim + Playwright + Chromium
2. Systemd service para restart automático
3. Logs via journald ou arquivo rotacionado
4. Health check endpoint simples (FastAPI ou Flask) na porta 8080
5. Variáveis de ambiente via .env file

## REGRAS IMPORTANTES

- NUNCA logar senhas, tokens ou proxies em texto claro
- Sempre limpar arquivos temporários após execução
- Usar claim atômico para evitar processamento duplicado
- Respeitar retry_after para não sobrecarregar o Instagram
- Manter perfis persistentes por conta (mesmo IP = mesmo usuário)
- Timeout máximo de 3 minutos por job
- Se worker morrer, auto-healing recupera jobs presos
```

---

## Estrutura de Arquivos do Worker

```
worker-rpa/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── requirements.txt
├── worker.py              # Loop principal de polling
├── crypto.py              # Decrypt compatível com lib/encrypt.ts
├── config.py              # Env vars e constantes
├── onboarding_rpa.py      # Copiado de python_server/onboarding_rpa.py
└── health.py              # Endpoint /health simples (opcional)
```

## Dockerfile do Worker

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps --no-shell chromium \
    && rm -rf /var/lib/apt/lists/*

COPY . .

CMD ["python", "-u", "worker.py"]
```

## docker-compose.yml

```yaml
services:
  rpa-worker:
    build: .
    restart: always
    env_file: .env
    volumes:
      - ./profiles:/opt/rpa/profiles
    mem_limit: 3g
    cpus: 2.5
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Setup na VPS (Hetzner)

```bash
# 1. SSH na VPS
ssh root@SEU_IP

# 2. Instalar Docker
curl -fsSL https://get.docker.com | sh

# 3. Clonar repositório
git clone https://github.com/daviprdev/AutoScale-IA.git
cd AutoScale-IA/worker-rpa

# 4. Configurar env vars
cp .env.example .env
nano .env  # Preencher SUPABASE_URL, SERVICE_ROLE_KEY, ENCRYPTION_SECRET

# 5. Subir worker
docker compose up -d

# 6. Verificar logs
docker compose logs -f rpa-worker
```

## Monitoramento

- `docker compose logs -f` — logs em tempo real
- `docker compose ps` — status do container
- `curl http://localhost:8080/health` — health check
- Dashboard do SaaS — mostra status dos jobs em tempo real
- Supabase Dashboard — consulta direta à tabela `onboarding_jobs`

## Escala

| Contas/dia | Workers | VPS | Custo |
|-----------|---------|-----|-------|
| 50 | 1 | CPX21 (4GB) | €7.49/mês |
| 200 | 1 | CPX31 (8GB) | €14.99/mês |
| 500 | 2 | 2x CPX21 | €14.98/mês |
| 1000+ | 3+ | 3x CPX21 ou CX32 | €22+/mês |

Para escalar horizontalmente, basta subir mais instâncias do worker — o claim atômico garante que nenhum job é processado duas vezes.