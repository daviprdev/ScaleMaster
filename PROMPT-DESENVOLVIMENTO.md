# Prompt Completo — Worker RPA Standalone (OAuth/Magic Link)

## Contexto para IA / Desenvolvedor

Você vai desenvolver um worker Python **standalone** que executa automação RPA
de onboarding de contas Instagram. Este worker é **COMPLETAMENTE SEPARADO** do
SaaS Next.js — não compartilha banco de dados, não faz chamadas HTTP ao SaaS,
não lê/escreve em tabelas Supabase.

A conexão entre a conta Instagram e o SaaS acontece **APENAS** na última etapa
da automação, quando o Playwright navega até um Magic Link gerado pelo SaaS.

---

## ARQUITETURA

```
┌─────────────────────┐         ┌─────────────────────┐
│   SaaS (Vercel)     │         │  Worker RPA (VPS)   │
│                     │         │                     │
│ - Gera Magic Link   │  URL    │ - Fila interna      │
│   /add/{token}      │◀────────│ - Executa RPA       │
│ - OAuth callback    │  (RPA   │ - Navega Magic Link │
│ - Dashboard         │  navega)│ - Zero DB SaaS      │
│ - Supabase          │         │ - Perfis persistentes│
└─────────────────────┘         └─────────────────────┘
```

### Princípios Fundamentais

1. **Zero acoplamento**: Worker NÃO conhece Supabase, NÃO tem `SUPABASE_URL`,
   NÃO importa nada do SaaS. Se o SaaS cair, o worker continua processando jobs.
2. **Conexão via navegador**: A única interação worker→SaaS é o Playwright
   abrindo `https://autoscale-ia.vercel.app/add/{token}` como última etapa.
3. **Jobs via API REST**: O SaaS (ou operador humano) submete jobs via
   `POST /jobs` no health server do worker. Autenticação por Bearer token.
4. **Persistência local**: Jobs são persistidos em SQLite local (`jobs.db`).
   Se o worker reiniciar, retoma jobs pendentes. Sem banco externo.
5. **Credenciais cifradas**: Senha, 2FA e proxy chegam criptografados
   (AES-256-GCM, mesma chave do SaaS). Decifrados apenas em memória.

---

## FLUXO COMPLETO DO ONBOARDING

Para cada job, o RPA executa estas etapas **em ordem**:

```
1. LOGIN        → instagram.com/accounts/login (com proxy + 2FA)
2. CONVITE      → Aceitar convite de tester do App (se aplicável)
3. FOTO         → Trocar foto de perfil (download da URL → upload via file input)
4. STORY        → Postar story com link sticker (download da mídia → upload)
5. DESTAQUE     → Criar destaque a partir do story postado
6. MAGIC LINK   → Navegar até https://saas-url/add/{token}
                  → Aguardar redirect para /add/success ou /dashboard/accounts
                  → Confirmar que cookie ig_oauth_magic_user_id foi setado
7. DONE         → Marcar job como concluído
```

### Etapa 6 — Magic Link (CRÍTICA)

Esta é a ÚNICA etapa que conecta a conta ao SaaS:

```python
async def complete_magic_link(self, magic_link_url: str) -> dict:
    """Navega até o Magic Link do SaaS para vincular a conta."""
    print(f"[RPA:{self.username}] Navegando para Magic Link...")
    
    # Navegar até a URL do Magic Link
    await self.page.goto(magic_link_url, wait_until="domcontentloaded", timeout=30_000)
    
    # Aguardar redirect (o SaaS redireciona para /add/success ou /dashboard/accounts)
    try:
        await self.page.wait_for_url("**/add/success**", timeout=15_000)
        print(f"[RPA:{self.username}] ✅ Magic Link aceito — conta vinculada!")
        return {"success": True}
    except Exception:
        # Verificar se já está no dashboard (alguns fluxos redirecionam direto)
        current = self.page.url
        if "/dashboard" in current or "/accounts" in current:
            print(f"[RPA:{self.username}] ✅ Já no dashboard — conta vinculada!")
            return {"success": True}
        
        # Capturar estado da página para diagnóstico
        title = await self.page.title()
        body_text = await self.page.inner_text("body")[:500]
        screenshot = await self.page.screenshot(type="jpeg", quality=60)
        
        print(f"[RPA:{self.username}] ❌ Magic Link falhou: {title}")
        return {
            "success": False,
            "error_code": "magic_link_failed",
            "error_message": f"Página: {title}. URL: {current}",
            "screenshot_base64": base64.b64encode(screenshot).decode(),
        }
```

### Como o SaaS gera o Magic Link

O SaaS cria um token único por job de onboarding:

```typescript
// No SaaS (app/api/onboarding/magic-token/route.ts)
// Gera token, grava em magic_add_tokens com user_id do usuário logado
// Retorna { token: "abc123...", url: "https://autoscale-ia.vercel.app/add/abc123..." }
```

O operador copia esse token/URL e inclui no payload do `POST /jobs` do worker.
Ou o SaaS pode chamar diretamente `POST /jobs` do worker passando o token.

---

## ENDPOINT DE SUBMISSÃO DE JOBS

### POST /jobs

Submete um novo job de onboarding à fila do worker.

**Auth:** `Authorization: Bearer {WORKER_API_SECRET}`

**Body:**
```json
{
  "username": "conta_instagram",
  "password_enc": "base64_aes256gcm_nonce+ciphertext+tag",
  "two_factor_enc": "base64_aes256gcm..." | null,
  "proxy_url_enc": "base64_aes256gcm..." | null,
  "photo_url": "https://storage.supabase.co/.../foto.jpg" | null,
  "story_media_url": "https://storage.supabase.co/.../video.mp4" | null,
  "story_link_url": "https://exemplo.com/promo" | null,
  "highlight_title": "Destaques" | null,
  "magic_link_token": "token-gerado-pelo-saas"
}
```

**Respostas:**
- `202 Accepted` — Job enfileirado
- `400 Bad Request` — Campos obrigatórios ausentes
- `401 Unauthorized` — Token inválido
- `409 Conflict` — Job para este username já existe na fila

### GET /jobs

Lista jobs recentes (últimos 50). Mesma auth.

### GET /health

Health check público (sem auth). Retorna `{"status": "ok"}`.

---

## PERSISTÊNCIA LOCAL (SQLite)

O worker usa SQLite para persistir jobs entre reinícios:

```sql
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_enc TEXT NOT NULL,
    two_factor_enc TEXT,
    proxy_url_enc TEXT,
    photo_url TEXT,
    story_media_url TEXT,
    story_link_url TEXT,
    highlight_title TEXT,
    magic_link_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|done|error
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at REAL NOT NULL,
    processed_at REAL,
    updated_at REAL NOT NULL
);

CREATE INDEX idx_jobs_status ON jobs(status);
```

### Regras de Persistência

- Job inserido com `status='pending'` ao receber `POST /jobs`
- Claim atômico: `UPDATE SET status='processing' WHERE id=? AND status='pending'`
- Sucesso: `status='done'`, `processed_at=now()`
- Falha permanente: `status='error'`, `error_message=...`
- Falha transitória: `retry_count++`, backoff exponencial, volta pra `pending`
- Auto-healing: jobs em `processing` há >15min voltam pra `pending`

---

## CRIPTOGRAFIA

As credenciais usam AES-256-GCM com `ENCRYPTION_SECRET`.

**Compatibilidade obrigatória:** O formato deve ser idêntico ao `lib/encrypt.ts`
do SaaS para que o worker possa decifrar valores cifrados pelo SaaS.

```python
# Formato: base64(nonce_12bytes + ciphertext + tag_16bytes)
# Chave derivada: SHA-256(ENCRYPTION_SECRET)
```

---

## CONFIGURAÇÃO VIA ENV VARS

```env
# Obrigatórias
ENCRYPTION_SECRET=mesma-chave-do-saas
WORKER_API_SECRET=secret-para-proteger-endpoints

# Opcionais
ONBOARDING_PROFILES_DIR=/opt/rpa/profiles
MAX_CONCURRENT_JOBS=3
POLL_INTERVAL_SECONDS=30
SAAS_BASE_URL=https://autoscale-ia.vercel.app
HEALTH_PORT=8080
BROWSER_HEADLESS=1
SQLITE_DB_PATH=/app/data/jobs.db
```

---

## MÓDULO onboarding_rpa.py

Copiar `python_server/onboarding_rpa.py` do repositório principal para este
repositório. Adicionar o método `complete_magic_link()` descrito acima.

O módulo já contém:
- Classe `InstagramRPA` com login, accept_invite, change_photo, post_story, create_highlight
- Função `run_onboarding_rpa()` que orquestra o fluxo
- Helper `_download_to_temp()` para baixar URLs públicas
- Suporte a proxy, TOTP, perfis persistentes
- Logs detalhados `[RPA:username]` em cada etapa
- `wait_until="domcontentloaded"` (NUNCA usar `"networkidle"`)

**Adição necessária:** O parâmetro `magic_link_url` em `run_onboarding_rpa()`
e a chamada a `complete_magic_link()` como última etapa antes de retornar.

---

## DEPLOY NA VPS (Hetzner Cloud CPX21)

### Infraestrutura Recomendada

- **Plano:** Hetzner Cloud CPX21 (3 vCPU, 4GB RAM, 80GB NVMe)
- **Preço:** €7.49/mês (~R$45)
- **OS:** Ubuntu 22.04 LTS
- **Datacenter:** Europa (latência baixa para Instagram)

### Setup

```bash
# 1. SSH na VPS
ssh root@SEU_IP

# 2. Instalar Docker
curl -fsSL https://get.docker.com | sh

# 3. Clonar repositório
git clone https://github.com/daviprdev/autoscale-rpa-worker.git
cd autoscale-rpa-worker

# 4. Configurar env vars
cp .env.example .env
nano .env  # Preencher ENCRYPTION_SECRET e WORKER_API_SECRET

# 5. Subir worker
docker compose up -d

# 6. Verificar logs
docker compose logs -f rpa-worker

# 7. Testar health check
curl http://localhost:8080/health
```

### Monitoramento

```bash
# Logs em tempo real
docker compose logs -f

# Status do container
docker compose ps

# Health check
curl http://localhost:8080/health

# Jobs ativos
curl -H "Authorization: Bearer $WORKER_API_SECRET" http://localhost:8080/jobs
```

---

## ESCALA

| Contas/dia | Workers | VPS              | Custo        |
|-----------|---------|------------------|--------------|
| 50        | 1       | CPX21 (4GB)      | €7.49/mês    |
| 200       | 1       | CPX31 (8GB)      | €14.99/mês   |
| 500       | 2       | 2x CPX21         | €14.98/mês   |
| 1000+     | 3+      | 3x CPX21 ou CX32 | €22+/mês     |

Para escalar horizontalmente: subir mais instâncias do worker. Cada uma tem
sua própria fila SQLite local. Distribuir jobs via load balancer ou roteamento
manual.

---

## REGRAS IMPORTANTES

1. **NUNCA logar senhas, tokens ou proxies em texto claro**
2. **Sempre limpar arquivos temporários** após execução (fotos/vídeos baixados)
3. **Usar claim atômico** para evitar processamento duplicado
4. **Perfis persistentes por conta** — mesmo IP = mesmo usuário para o Instagram
5. **Timeout máximo de 3 minutos por job** (hard kill se ultrapassar)
6. **Se worker morrer, auto-healing recupera jobs presos** no próximo ciclo
7. **Nunca usar `wait_until="networkidle"`** — sempre `"domcontentloaded"`
8. **Proxy é obrigatório para login** — sem proxy, pular o job
9. **Magic Link é a ÚLTIMA etapa** — só navegar após completar todo o onboarding
10. **Não fazer fallback para IP da VPS** — se proxy falhar, marcar erro e retry

---

## ESTRUTURA DE ARQUIVOS

```
autoscale-rpa-worker/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .gitignore
├── requirements.txt
├── README.md
├── PROMPT-DESENVOLVIMENTO.md    ← Este arquivo
├── config.py                    ← Env vars e constantes
├── crypto.py                    ← AES-256-GCM compatível com lib/encrypt.ts
├── db.py                        ← SQLite local para persistência de jobs
├── health.py                    ← FastAPI: /health, /jobs, /status
├── worker.py                    ← Loop principal + fila + concorrência
├── onboarding_rpa.py            ← Motor RPA (copiado + magic_link adicionado)
└── data/                        ← Diretório do SQLite (volume Docker)
    └── jobs.db
```