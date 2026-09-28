# AutoScale RPA Worker — Briefing Completo para Debug

## 1. ARQUITETURA GERAL

```
┌─────────────────────────────────────────────────────────┐
│  SaaS Frontend (autoscale-ia.vercel.app)                │
│  - Dashboard para adicionar contas Instagram            │
│  - Submete job via POST /api/jobs                       │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP POST (job data)
                       ▼
┌─────────────────────────────────────────────────────────┐
│  VPS (2.25.244.181) — Docker Container                  │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │ health.py   │───▶│ db.py        │◀───│ worker.py │  │
│  │ POST /jobs  │    │ SQLite local │    │ Poll loop │  │
│  └─────────────┘    └──────────────┘    └─────┬─────┘  │
│                                               │         │
│                                    ┌──────────▼──────┐  │
│                                    │onboarding_rpa.py│  │
│                                    │ InstagramRPA    │  │
│                                    │ class           │  │
│                                    └─────────────────┘  │
│                                                         │
│  Infra: Xvfb :99, Chromium, Python 3.11                 │
│  Proxies: residenciais sticky (host:port:user:pass)     │
└─────────────────────────────────────────────────────────┘
```

## 2. FLUXO DE ONBOARDING (run_onboarding_rpa)

```
FASE 1: PLAYWRIGHT WEB LOGIN (até 6 tentativas com backoff)
  1. Navegar para instagram.com/accounts/login/
  2. Preencher usuário + senha
  3. Clicar "Entrar" (div[role="button"])
  4. Detectar 2FA (URL contém "two_step_verification")
  5. Preencher TOTP (pyotp)
  6. Clicar "Continuar"
  7. Verificar login OK (_is_logged_in)
  → save_checkpoint("playwright_login")

FASE 2: OPERAÇÕES VIA API WEB (fetch no page.evaluate)
  2a. Postar story com link sticker
      → save_checkpoint("post_story")
  2b. Trocar foto de perfil
      → save_checkpoint("change_photo")  
  2c. Criar destaque (highlight)
      → save_checkpoint("highlight")

FASE 3: CONVERSÃO + CONVITE + MAGIC LINK
  3a. Converter para conta profissional
      → save_checkpoint("convert")
  3b. Aceitar convite de tester
      → save_checkpoint("accept_invite")
  3c. Navegar Magic Link do SaaS
      → save_checkpoint("magic_link")
```

**Checkpointing**: Se uma etapa falhar DEPOIS do login, ao retentar pula etapas já completas. As 6 tentativas são SOMENTE para o login.

## 3. BUGS IDENTIFICADOS NOS LOGS

### Bug #1: `_has_2fa_prompt` não existe (CRÍTICO)

**Erro nos logs:**
```
File "/app/onboarding_rpa.py", line 736, in _playwright_login
    if "two_step_verification" in self.page.url or await self._has_2fa_prompt():
AttributeError: 'InstagramRPA' object has no attribute '_has_2fa_prompt'
```

**Causa**: O método `_has_2fa_prompt()` foi referenciado em patches anteriores (patch_2fa.py) mas nunca foi adicionado à classe `InstagramRPA`. O patch tentou substituir um bloco antigo que continha esse método, mas a substituição falhou silenciosamente porque o texto exato não foi encontrado.

**Impacto**: Toda conta que NÃO redireciona imediatamente para `two_step_verification` após clicar "Entrar" crasha aqui. A conta `helenabatista2810` fica presa em `/accounts/login/` (URL não muda), então o código entra no `or await self._has_2fa_prompt()` → AttributeError → retry infinito.

**Fix necessário**: Adicionar o método `_has_2fa_prompt` à classe OU remover a chamada e usar apenas a verificação por URL.

### Bug #2: Conta `helenabatista2810` não redireciona para 2FA

**Log:**
```
[RPA:helenabatista2810] URL apos login: https://www.instagram.com/accounts/login/
```

A URL permanece em `/accounts/login/` após clicar "Entrar". Possíveis causas:
- Instagram mostrando tela de "challenge" (verificação de segurança) antes do 2FA
- Instagram detectando automação e bloqueando silenciosamente
- Campos de login não foram preenchidos corretamente (selectors errados)
- Botão "Entrar" não foi clicado corretamente

**Observação**: A conta `sofiamoura6387` FUNCIONA parcialmente — redireciona para `two_step_verification`, preenche TOTP, clica Continuar, mas fica presa na tela de 2FA (não completa o redirect pós-2FA).

### Bug #3: 2FA não completa o redirect (sofiamoura6387)

**Log:**
```
[RPA:sofiamoura6387] 2FA detectado, preenchendo TOTP...
[RPA:sofiamoura6387] Codigo 2FA preenchido via fallback
[RPA:sofiamoura6387] Botao Continuar clicado
[RPA:sofiamoura6387] Sem redirect pos-2FA. URL: .../two_step_verification?...
[RPA:sofiamoura6387] Login web FALHOU. URL: .../two_step_verification?...
```

O TOTP é preenchido e o botão Continuar é clicado, mas a página não sai da tela de 2FA. Possíveis causas:
- O código TOTP está sendo preenchido no input errado (fallback pegou um input genérico)
- O botão "Continuar" clicado não é o correto
- O Instagram requer um passo adicional após o 2FA (ex: "Save this device?")
- O TOTP expirou entre geração e preenchimento

## 4. CÓDIGO ATUAL DO _playwright_login (LINHAS 668-808)

```python
async def _playwright_login(self):
    """Login completo via Playwright: usuario + senha + 2FA TOTP."""
    try:
        print(f"[RPA:{self.username}] Login web via Playwright...")
        
        # Navegação com retry (domcontentloaded)
        for attempt in range(3):
            try:
                await self.page.goto(
                    "https://www.instagram.com/accounts/login/",
                    wait_until="domcontentloaded",
                    timeout=60000,
                )
                break
            except Exception as nav_err:
                if attempt < 2:
                    wait = 10 * (attempt + 1)
                    await self.page.wait_for_timeout(wait * 1000)
                else:
                    raise
        await self.page.wait_for_timeout(3000)

        # Preencher usuario
        user_input = await self.page.query_selector('input[name="username"]')
        if not user_input:
            user_input = await self.page.query_selector('input[name="email"]')
        if not user_input:
            user_input = await self.page.query_selector('input[type="text"]')
        if user_input:
            await user_input.fill(self.username)
        else:
            return False

        # Preencher senha
        pass_input = await self.page.query_selector('input[name="password"]')
        if not pass_input:
            pass_input = await self.page.query_selector('input[type="password"]')
        if pass_input:
            await pass_input.fill(self.password)
        else:
            return False

        await self.page.wait_for_timeout(500)

        # Clicar Entrar
        login_btn = await self.page.query_selector('div[role="button"]:has-text("Entrar")')
        if not login_btn:
            login_btn = await self.page.query_selector('div[role="button"]:has-text("Log In")')
        if not login_btn:
            login_btn = await self.page.query_selector('button[type="submit"]')
        if login_btn:
            await login_btn.click()
        else:
            return False

        await self.page.wait_for_timeout(5000)

        # ⚠️ BUG AQUI: _has_2fa_prompt NÃO EXISTE
        if "two_step_verification" in self.page.url or await self._has_2fa_prompt():
            # ... preenche TOTP, clica Continuar ...
            pass

        # Verificar login
        if await self._is_logged_in():
            return True
        else:
            return False

    except Exception as e:
        print(f"[RPA:{self.username}] Erro login web: {traceback.format_exc()}")
        return False
```

## 5. SELECTORES DO INSTAGRAM MODERNO (2025-2026)

O Instagram moderno usa padrões diferentes do HTML tradicional:

| Elemento | Selector Antigo | Selector Moderno |
|----------|----------------|-----------------|
| Input usuário | `input[name="username"]` | `input[name="username"]` ou `input[name="email"]` |
| Input senha | `input[name="password"]` | `input[name="password"]` ou `input[type="password"]` |
| Botão Entrar | `button[type="submit"]` | `div[role="button"]:has-text("Entrar")` |
| Input 2FA | `input[name="verificationCode"]` | `input[inputmode="numeric"]` ou `input[type="tel"]` |
| Botão Continuar | `button[type="submit"]` | `div[role="button"]:has-text("Continuar")` |

**Importante**: O Instagram pode usar 6 inputs individuais (maxlength="1") para o código 2FA em vez de um único input.

## 6. CONFIGURAÇÃO DO PLAYWRIGHT

```python
self.context = await self.playwright.chromium.launch_persistent_context(
    user_data_dir=str(self.profile_dir),
    headless=False,  # Requer Xvfb :99
    proxy={"server": "http://host:port", "username": "user", "password": "pass"},
    viewport={"width": 1920, "height": 1080},
    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    locale="pt-BR",
    timezone_id="America/Sao_Paulo",
    args=[
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-gpu",
    ],
    ignore_default_args=["--enable-automation"],
)

# Anti-detection
await self.context.add_init_script("""
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'languages', {get: () => ['pt-BR', 'pt', 'en']});
    window.chrome = {runtime: {}};
""")
```

## 7. WORKER LOOP (worker.py)

```python
class RPAWorker:
    MAX_PROXY_ATTEMPTS = 6  # Rotação de proxies
    
    async def process_job(self, job):
        for attempt in range(1, 7):
            proxy = get_next_proxy(exclude_ids=tried)
            result = await run_onboarding_rpa(..., proxy_url=proxy)
            
            if result["success"]:
                complete_job(job_id)
                break
            
            error_code = result.get("error_code")
            if error_code in permanent_errors:
                break  # Não adianta trocar proxy
            
            if error_code in proxy_retryable:
                mark_proxy_failed(proxy_id)
                await asyncio.sleep(backoff)  # 10s, 20s, 40s, 80s, 160s
                continue
```

## 8. BANCO DE DADOS (db.py)

```sql
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_enc TEXT NOT NULL,        -- AES-256-GCM
    two_factor_enc TEXT,               -- TOTP secret encrypted
    proxy_url_enc TEXT,                -- host:port:user:pass encrypted
    photo_url TEXT,                    -- base64 data URI
    story_media_url TEXT,              -- base64 data URI
    story_link_url TEXT,
    story_link_text TEXT,
    highlight_title TEXT,
    magic_link_token TEXT NOT NULL,
    status TEXT DEFAULT 'pending',     -- pending/processing/done/error
    completed_stages TEXT DEFAULT '',  -- checkpoint: "playwright_login,post_story,..."
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at REAL,
    updated_at REAL
);

CREATE TABLE proxies (
    id TEXT PRIMARY KEY,
    proxy_url_enc TEXT NOT NULL,       -- host:port:user:pass (plaintext in new proxies)
    is_active INTEGER DEFAULT 1,
    failure_count INTEGER DEFAULT 0,
    last_used_at REAL,
    last_error TEXT
);
```

## 9. PERGUNTAS PARA O CODEX RESOLVER

1. **Como corrigir o `_has_2fa_prompt` ausente?** Deve ser implementado ou a lógica deve usar apenas verificação por URL?

2. **Por que `helenabatista2810` não redireciona após clicar "Entrar"?** O Instagram está mostrando uma tela intermediária (challenge/captcha)? Os selectors estão corretos para o DOM atual do Instagram?

3. **Por que o 2FA de `sofiamoura6387` não completa o redirect?** O TOTP está sendo preenchido no input correto? O botão Continuar está sendo clicado corretamente? Há um passo adicional após o 2FA (ex: "Save this device?", "Turn on notifications")?

4. **Como detectar e lidar com telas intermediárias do Instagram?** (challenge, captcha, "save device", "suspicious login attempt", etc.) — precisamos de uma função genérica que detecta qualquer tela que não seja login, 2FA ou feed.

5. **Os selectors do Instagram mudaram recentemente?** Precisamos inspecionar o DOM atual da página de login e 2FA do Instagram para confirmar os selectors corretos. O Instagram pode ter mudado de `input[name="username"]` para outro atributo, ou de `div[role="button"]` para `<button>`.

6. **Por que `helenabatista2810` fica em `/accounts/login/` após clicar Entrar?** Possibilidades:
   - Senha errada (mas o erro seria diferente)
   - Instagram mostrando "Suspicious Login Attempt" / challenge antes do 2FA
   - O botão "Entrar" não foi realmente clicado (elemento errado)
   - O Instagram detectou automação e bloqueou silenciosamente
   - Precisamos de screenshot + HTML dump após clicar Entrar para diagnosticar

## 12. FIX IMEDIATO NECESSÁRIO (Bug #1)

Adicionar o método `_has_2fa_prompt` à classe `InstagramRPA` OU remover a chamada:

**Opção A — Adicionar o método:**
```python
async def _has_2fa_prompt(self) -> bool:
    """Detecta se a tela de 2FA está presente por múltiplos indicadores."""
    try:
        # Verificar por URL
        if "two_step_verification" in self.page.url:
            return True
        # Verificar por inputs de código
        for sel in ['input[inputmode="numeric"]', 'input[type="tel"]',
                    'input[maxlength="6"]', 'input[name="verificationCode"]',
                    'input[autocomplete="one-time-code"]']:
            el = await self.page.query_selector(sel)
            if el and await el.is_visible():
                return True
        # Verificar por texto na página
        body_text = await self.page.inner_text('body')
        if any(kw in body_text.lower() for kw in ['código de verificação', 'verification code', 'autenticador']):
            return True
        return False
    except Exception:
        return False
```

**Opção B — Remover a chamada (mais simples):**
Trocar linha 736 de:
```python
if "two_step_verification" in self.page.url or await self._has_2fa_prompt():
```
Para:
```python
if "two_step_verification" in self.page.url:
```
E adicionar um wait + re-check após 3 segundos caso a URL não tenha mudado:
```python
await self.page.wait_for_timeout(3000)
if "two_step_verification" not in self.page.url:
    # Verificar se apareceu tela de 2FA sem mudar URL
    for sel in ['input[inputmode="numeric"]', 'input[type="tel"]', 'input[maxlength="6"]']:
        el = await self.page.query_selector(sel)
        if el and await el.is_visible():
            print(f"[RPA:{self.username}] 2FA detectado por input (URL nao mudou)")
            break
    else:
        # Nem URL nem input de 2FA — verificar outras telas
        body = await self.page.inner_text('body')
        print(f"[RPA:{self.username}] Tela desconhecida apos login: {body[:200]}")
        await self.page.screenshot(path=f"/tmp/unknown_screen_{self.username}.png")
        return False
```

## 13. DIAGNÓSTICO NECESSÁRIO PARA Bug #2 e #3

Para resolver por que `helenabatista2810` não redireciona e por que `sofiamoura6387` fica presa no 2FA, precisamos:

1. **Screenshot após clicar "Entrar"** — salvar em `/tmp/after_login_{username}.png`
2. **HTML dump da página** — salvar em `/tmp/after_login_{username}.html` (primeiros 5000 chars)
3. **Listar todos os inputs visíveis** — type, name, placeholder, aria-label
4. **Listar todos os div[role="button"]** — text content
5. **Verificar se há iframe** — o Instagram pode usar iframes para challenge/captcha

Código de diagnóstico para adicionar após `await self.page.wait_for_timeout(5000)`:
```python
# DIAGNÓSTICO: dump estado da página após login
print(f"[RPA:{self.username}] URL: {self.page.url}")
await self.page.screenshot(path=f"/tmp/after_login_{self.username}.png")
html = await self.page.content()
with open(f"/tmp/after_login_{self.username}.html", "w") as f:
    f.write(html[:10000])
inputs = await self.page.query_selector_all('input:not([type="hidden"])')
for i, inp in enumerate(inputs):
    attrs = await inp.evaluate("""el => ({
        type: el.type, name: el.name, placeholder: el.placeholder,
        ariaLabel: el.getAttribute('aria-label'),
        id: el.id, maxLength: el.maxLength,
        inputMode: el.inputMode, visible: el.offsetParent !== null
    })""")
    print(f"[RPA:{self.username}] Input {i}: {attrs}")
buttons = await self.page.query_selector_all('div[role="button"], button')
for i, btn in enumerate(buttons[:10]):
    text = await btn.evaluate("el => el.textContent.trim().substring(0, 50)")
    print(f"[RPA:{self.username}] Button {i}: '{text}'")
```

## 14. RESUMO DOS ARQUIVOS

| Arquivo | Localização | Função |
|---------|------------|--------|
| `onboarding_rpa.py` | `/app/onboarding_rpa.py` (VPS) | Motor RPA: login, story, foto, highlight, converter, magic link |
| `worker.py` | `/app/worker.py` (VPS) | Loop principal: polling SQLite, rotação de proxies, retry |
| `db.py` | `/app/db.py` (VPS) | SQLite: jobs, proxies, checkpointing |
| `config.py` | `/app/config.py` (VPS) | Config: ENCRYPTION_SECRET, PROFILES_DIR, SAAS_BASE_URL |
| `crypto.py` | `/app/crypto.py` (VPS) | AES-256-GCM encrypt/decrypt |
| `health.py` | `/app/health.py` (VPS) | HTTP server: POST /jobs, GET /health, GET /stats |
| `entrypoint.sh` | `/app/entrypoint.sh` (VPS) | Inicia Xvfb :99 + exec python worker.py |
| `Dockerfile` | `/opt/worker-rpa/Dockerfile` (VPS) | Python 3.11 + Playwright + Xvfb + ffmpeg |
| `docker-compose.yml` | `/opt/worker-rpa/docker-compose.yml` (VPS) | Container config, volumes, ports |

## 15. COMANDOS ÚTEIS

```bash
# Ver logs do worker
ssh root@2.25.244.181 'docker logs worker-rpa-rpa-worker-1 --tail 100'

# Parar worker
ssh root@2.25.244.181 'cd /opt/worker-rpa && docker compose stop'

# Rebuild e iniciar
ssh root@2.25.244.181 'cd /opt/worker-rpa && docker compose down && docker compose up -d --build'

# Reset job para pending
ssh root@2.25.244.181 'docker exec worker-rpa-rpa-worker-1 python -c "
import sqlite3
c = sqlite3.connect(\"/app/data/jobs.db\")
c.execute(\"UPDATE jobs SET status=?, retry_count=0, error_message=NULL, completed_stages=? WHERE status != ?\", (\"pending\", \"\", \"completed\"))
c.commit()
print(\"Jobs resetados\")
c.close()
"'

# Testar proxy contra Instagram
ssh root@2.25.244.181 'docker exec worker-rpa-rpa-worker-1 python -c "
import sqlite3, urllib.request, urllib.error
c = sqlite3.connect(\"/app/data/jobs.db\")
proxies = c.execute(\"SELECT id, proxy_url_enc FROM proxies WHERE is_active=1 LIMIT 3\").fetchall()
for pid, praw in proxies:
    parts = praw.split(\":\", 3)
    url = f\"http://{parts[2]}:{parts[3]}@{parts[0]}:{parts[1]}\"
    handler = urllib.request.ProxyHandler({\"http\": url, \"https\": url})
    opener = urllib.request.build_opener(handler)
    try:
        resp = opener.open(\"https://www.instagram.com/accounts/login/\", timeout=10)
        print(f\"{pid[:8]}: HTTP {resp.status} OK\")
    except urllib.error.HTTPError as e:
        print(f\"{pid[:8]}: HTTP {e.code} BLOCKED\")
    except Exception as e:
        print(f\"{pid[:8]}: {e}\")
c.close()
"'

# Ver screenshots de debug
ssh root@2.25.244.181 'ls -la /tmp/*.png /tmp/*.html 2>/dev/null'

# Copiar screenshot para local
scp root@2.25.244.181:/tmp/after_login_USERNAME.png ./debug/
```

## 16. PRIORIDADES DE FIX

1. **P0 — Bug #1**: Adicionar `_has_2fa_prompt()` ou remover chamada → desbloqueia `helenabatista2810`
2. **P0 — Diagnóstico**: Adicionar screenshot + HTML dump após login → entender por que URL não muda
3. **P1 — Bug #3**: Investigar por que 2FA não completa redirect → pode ser input errado, botão errado, ou tela intermediária
4. **P2 — Telas intermediárias**: Implementar detecção genérica de challenge/captcha/save-device
5. **P2 — Selectors**: Confirmar selectors atuais do Instagram via inspeção DOMta?** O TOTP está sendo preenchido no input correto? O botão Continuar está sendo clicado corretamente? Há um passo adicional após o 2FA?

4. **Como detectar e lidar com telas intermediárias do Instagram?** (challenge, captcha, "save device", etc.)

5. **Os selectors do Instagram mudaram recentemente?** Precisamos inspecionar o DOM atual da página de login e 2FA do Instagram para confirmar os selectors corretos.

## 10. AMBIENTE

- **VPS**: 2.25.244.181 (Ubuntu, Docker)
- **Container**: worker-rpa-rpa-worker-1
- **Python**: 3.11-slim
- **Playwright**: chromium-1243
- **Display**: Xvfb :99 (1920x1080x24)
- **Proxies**: residenciais sticky (gmproxys.com) — HTTP 200 confirmado
- **SQLite**: /app/data/jobs.db
- **Perfis browser**: /opt/rpa/profiles/{username}

## 11. LOGS COMPLETOS (última execução)

```
[RPA:helenabatista2810] Login web via Playwright...
[RPA:helenabatista2810] Usuario preenchido
[RPA:helenabatista2810] Senha preenchida
[RPA:helenabatista2810] Botao Entrar clicado
[RPA:helenabatista2810] URL apos login: https://www.instagram.com/accounts/login/
[RPA:helenabatista2810] Erro login web: AttributeError: 'InstagramRPA' object has no attribute '_has_2fa_prompt'
[RPA:helenabatista2810] Login tentativa 1/6 falhou

[RPA:sofiamoura6387] Login web via Playwright...
[RPA:sofiamoura6387] Usuario preenchido
[RPA:sofiamoura6387] Senha preenchida
[RPA:sofiamoura6387] Botao Entrar clicado
[RPA:sofiamoura6387] URL apos login: https://www.instagram.com/accounts/login/two_step_verification?...
[RPA:sofiamoura6387] 2FA detectado, preenchendo TOTP...
[RPA:sofiamoura6387] Codigo TOTP: 660351
[RPA:sofiamoura6387] Codigo 2FA preenchido via fallback
[RPA:sofiamoura6387] Botao Continuar clicado
[RPA:sofiamoura6387] Sem redirect pos-2FA. URL: .../two_step_verification?...
[RPA:sofiamoura6387] Login web FALHOU.
```