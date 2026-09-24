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

## MÓDULO onboarding_rpa.py — Adaptação Obrigatória

O arquivo `python_server/onboarding_rpa.py` do repositório principal precisa ser
copiado para este repositório e **adaptado**. O original NÃO tem suporte a Magic Link.

### O que o original já contém (não modificar)
- Classe `InstagramRPA` com login, accept_invite, change_photo, post_story, create_highlight
- Função `run_onboarding_rpa()` que orquestra o fluxo
- Helper `_download_to_temp()` para baixar URLs públicas
- Suporte a proxy, TOTP, perfis persistentes
- Logs detalhados `[RPA:username]` em cada etapa
- `wait_until="domcontentloaded"` (NUNCA usar `"networkidle"`)

### Adaptações obrigatórias

#### 1. Adicionar método `complete_magic_link()` à classe `InstagramRPA`

Inserir após `create_highlight_from_story()` (antes da função `run_onboarding_rpa()`):

```python
async def complete_magic_link(self, magic_link_url: str) -> RPAResult:
    """Navega até o Magic Link do SaaS para vincular a conta via OAuth."""
    import base64
    try:
        print(f"[RPA:{self.username}] Navegando para Magic Link...")
        await self.page.goto(magic_link_url, wait_until="domcontentloaded", timeout=30_000)

        # Aguardar redirect para página de sucesso
        try:
            await self.page.wait_for_url("**/add/success**", timeout=15_000)
            print(f"[RPA:{self.username}] ✅ Magic Link aceito — conta vinculada!")
            return RPAResult(True, "magic_link", "Conta vinculada ao SaaS via OAuth")
        except PlaywrightTimeout:
            current = self.page.url
            if "/dashboard" in current or "/accounts" in current:
                print(f"[RPA:{self.username}] ✅ Já no dashboard — conta vinculada!")
                return RPAResult(True, "magic_link", "Conta vinculada (redirect direto)")

            title = await self.page.title()
            screenshot = await self.page.screenshot(type="jpeg", quality=60)
            print(f"[RPA:{self.username}] ❌ Magic Link falhou: {title}")
            return RPAResult(
                False, "magic_link",
                f"Página: {title}. URL final: {current}",
                error_code="magic_link_failed",
            )
    except Exception as e:
        return RPAResult(False, "magic_link", f"Erro no Magic Link: {str(e)}", error_code="magic_link_error")
```

#### 2. Modificar assinatura de `run_onboarding_rpa()`

Adicionar parâmetro `magic_link_url: Optional[str] = None` e remover `app_id: str`:

```python
async def run_onboarding_rpa(
    username: str,
    password: str,
    proxy_url: str,
    totp_secret: Optional[str],
    # app_id: str,          ← REMOVER (não é mais necessário)
    photo_path: Optional[str],
    story_media_path: Optional[str],
    story_link_url: Optional[str],
    highlight_title: Optional[str],
    magic_link_url: Optional[str] = None,  # ← ADICIONAR
    existing_cookies: Optional[list[dict]] = None,
) -> dict:
```

#### 3. Adicionar etapa 6 (Magic Link) no fluxo da função

Inserir após a etapa 5 (create_highlight) e antes do retorno de sucesso:

```python
        # Etapa 6: Vincular conta ao SaaS via Magic Link (se fornecido)
        if magic_link_url:
            magic_result = await rpa.complete_magic_link(magic_link_url)
            if not magic_result.success:
                return {
                    "success": False,
                    "stage": "magic_link",
                    "message": magic_result.message,
                    "error_code": magic_result.error_code,
                    "cookies": await rpa.get_cookies(),
                }
```

#### 4. Remover referências a Supabase/banco compartilhado

O original pode conter imports ou chamadas a `supabase`, `onboarding_jobs`, etc.
Remover tudo — este worker é standalone e não conhece o banco do SaaS.

---

## INTEGRAÇÃO ENTRE MÓDULOS (health ↔ db ↔ worker)

Os três módulos existem mas precisam ser conectados. Sem isso, jobs se perdem.

### Fluxo completo de um job

```
POST /jobs (health.py)
    │
    ├─ Valida auth Bearer + campos obrigatórios
    ├─ Chama db.insert_job(job_data)
    ├─ Retorna 202 Accepted
    │
    ▼
Worker Loop (worker.py) ──── a cada POLL_INTERVAL_SECONDS
    │
    ├─ db.reset_stale_jobs()         ← auto-healing
    ├─ db.claim_next_job()           ← claim atômico
    ├─ Se None → sleep e repetir
    │
    ├─ Decifra credenciais (crypto.decrypt)
    ├─ Executa run_onboarding_rpa(...)
    │
    ├─ Sucesso → db.complete_job(id)
    ├─ Falha permanente → db.fail_job(id, msg, permanent=True)
    └─ Falha transitória → db.fail_job(id, msg, permanent=False)
                           └─ retry_count++, volta pra pending
```

### O que falta implementar

| Módulo | Função | Status | Ação |
|--------|--------|--------|------|
| `health.py` | `POST /jobs` | Tem `# TODO` | Chamar `db.insert_job()` e integrar com fila |
| `health.py` | `GET /jobs` | Não existe | Adicionar endpoint que chama `db.list_recent_jobs()` |
| `worker.py` | Loop principal | Usa `asyncio.Queue` em memória | Substituir por `db.claim_next_job()` |
| `worker.py` | Auto-healing | Não existe | Chamar `db.reset_stale_jobs()` no início de cada ciclo |
| `worker.py` | Resultado | Não persiste | Chamar `db.complete_job()` ou `db.fail_job()` após execução |

### Exemplo de integração no health.py

```python
from db import insert_job, list_recent_jobs, get_stats
import uuid

@app.post("/jobs")
async def submit_job(request: Request):
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    body = await request.json()
    required = ["username", "password_enc", "magic_link_token"]
    missing = [f for f in required if not body.get(f)]
    if missing:
        return JSONResponse({"error": f"Campos ausentes: {', '.join(missing)}"}, status_code=400)

    job_data = {
        "id": str(uuid.uuid4()),
        **body,
    }
    try:
        job_id = insert_job(job_data)
        return JSONResponse({"status": "accepted", "id": job_id}, status_code=202)
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            return JSONResponse({"error": "Job já existe para este username"}, status_code=409)
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/jobs")
async def get_jobs(request: Request):
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {WORKER_API_SECRET}":
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return JSONResponse(list_recent_jobs())

@app.get("/stats")
async def stats():
    return JSONResponse(get_stats())
```

---

## ENDPOINT NO SAAS — Geração de Magic Link Token

O worker precisa receber um `magic_link_token` válido. O SaaS deve expor uma rota
para gerar esse token. Sem isso, não há como testar o fluxo end-to-end.

### Rota: POST /api/onboarding/magic-token

**Auth:** Sessão do usuário logado (cookie NextAuth/Clerk)

**Body:** `{}` (vazio — o user_id vem da sessão)

**Lógica:**
```typescript
// app/api/onboarding/magic-token/route.ts
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: Request) {
  const session = await getSession(); // NextAuth ou Clerk
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase.from("magic_add_tokens").insert({
    user_id: session.user.id,
    token,
    expires_at: expiresAt.toISOString(),
    used: false,
  });

  const url = `${process.env.NEXT_PUBLIC_APP_URL}/add/${token}`;
  return Response.json({ token, url, expires_at: expiresAt.toISOString() });
}
```

### Tabela no Supabase (SaaS)

```sql
CREATE TABLE IF NOT EXISTS magic_add_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_magic_tokens_token ON magic_add_tokens(token);
```

### Rota: GET /add/[token] (já existe no SaaS)

Esta rota recebe o token, valida, faz o OAuth linking da conta Instagram ao
user_id associado, seta o cookie `ig_oauth_magic_user_id`, e redireciona para
`/add/success` ou `/dashboard/accounts`. O RPA apenas navega até esta URL —
toda a lógica de vinculação está no SaaS.

### Fluxo E2E completo

```
1. Operador clica "Gerar Magic Link" no dashboard do SaaS
2. SaaS chama POST /api/onboarding/magic-token → retorna { token, url }
3. Operador copia a URL e inclui no payload do POST /jobs do worker
   OU o SaaS chama diretamente POST /jobs do worker passando o token
4. Worker executa RPA → última etapa navega até /add/{token}
5. SaaS valida token, vincula conta ao user_id, redireciona para /add/success
6. Worker detecta redirect → marca job como done
7. Dashboard do SaaS mostra conta vinculada em tempo real
```

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