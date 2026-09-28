# Diagnóstico Completo — AutoScale RPA Worker

**Data:** 2026-09-27  
**Status:** Login web falhando consistentemente em múltiplas contas  
**Worker:** `worker-rpa-rpa-worker-1` @ VPS 2.25.244.181 (healthy)  
**SaaS:** `autoscale-ia.vercel.app` (deploy `547259a` READY em Production)

---

## 1. Arquitetura Atual

### 1.1 Fluxo Completo de Onboarding

```
Dashboard (Vercel) → POST /api/admin/rpa/jobs → Worker (VPS:8080) → SQLite → RPA Engine
```

**Fases do RPA (Playwright-only, sem instagrapi):**

1. **Login Web** (até 6 tentativas com backoff exponencial)
   - Navega para `https://www.instagram.com/accounts/login/`
   - Preenche `input[name="email"]` + `input[name="pass"]`
   - Clica em `div[role="button"]:has-text("Entrar")`
   - Detecta 2FA por URL (`two_step_verification`) ou inputs habilitados
   - Preenche TOTP via `pyotp` em input único ou 6 inputs individuais
   - Clica em `div[role="button"]:has-text("Continuar")`
   - Aguarda redirect para URL fora de `/accounts/login`

2. **Story + Link** (via API web do Instagram)
   - Upload via `rupload_igvideo` ou `rupload_igphoto`
   - Configure com `story_sticker_ids: 'link_sticker_default'`

3. **Foto de Perfil** (via API web)
   - POST para `/api/v1/accounts/change_picture/`

4. **Destaque** (via API web)
   - Verifica highlights existentes
   - Cria com `highlight_create_reel`

5. **Converter para Profissional**
   - Navega para `/accounts/settings/`
   - Clica em "Mudar para conta profissional" → "Criador de conteúdo"

6. **Aceitar Convite Tester**
   - Navega para `/accounts/manage_access/`
   - Clica em "Aceitar" se existir

7. **Magic Link OAuth**
   - Navega para `{SAAS_BASE_URL}/add/{token}?username={user}`
   - Aguarda redirect para `/add/success` ou `/dashboard`

### 1.2 Componentes

| Componente | Localização | Função |
|------------|-------------|--------|
| **Dashboard RPA** | `app/dashboard/rpa/page.tsx` | UI para submeter jobs, gerenciar proxies, monitorar progresso |
| **API Routes** | `app/api/admin/rpa/*/route.ts` | Proxy entre frontend e worker (jobs, stats, proxies, magic-link) |
| **Worker Loop** | `worker.py` | Polling SQLite a cada 30s, claim jobs, rotação de proxies (até 6 tentativas) |
| **RPA Engine** | `onboarding_rpa.py` | Playwright login + operações via API web |
| **Health Server** | `health.py` | FastAPI em `:8080` com endpoints `/health`, `/jobs`, `/stats`, `/proxies` |
| **SQLite DB** | `/app/data/jobs.db` | Jobs (pending/processing/completed/failed), proxies, checkpoints |
| **Docker** | VPS 2.25.244.181 | Container com Xvfb :99, Chromium, Python 3.11, Playwright |

### 1.3 Configuração Crítica

```python
# config.py
MAX_CONCURRENT_JOBS = 3
POLL_INTERVAL_SECONDS = 30
PROFILES_DIR = "/opt/rpa/profiles"
SAAS_BASE_URL = "https://autoscale-ia.vercel.app"
WORKER_API_SECRET = "<env var>"
ENCRYPTION_SECRET = "<env var>"  # AES-256-GCM com SHA-256 key derivation
```

---

## 2. Erros Identificados nos Logs Reais

### 2.1 Padrão de Falha Observado (últimas 120 linhas)

**Conta `fernandabarbosa4825`:**
```
✅ Usuario preenchido
✅ Senha preenchida
✅ Botao Entrar clicado
✅ URL apos login: .../two_step_verification?encrypted_context=...&flow=two_factor_login
✅ 2FA detectado, aguardando inputs habilitados...
✅ Input 2FA fallback habilitado (round 1)
✅ Codigo TOTP: 949933
✅ Codigo 2FA preenchido em input unico
✅ Botao Continuar habilitado via: div[role="button"]:has-text("Continuar") (round 0)
✅ Botao Continuar clicado
✅ Redirect pos-2FA: https://www.instagram.com/accounts/onetap/
❌ Login web FALHOU. URL: https://www.instagram.com/accounts/onetap/
```

**Conta `sofiamoura6387`:**
```
✅ Usuario preenchido
✅ Senha preenchida
✅ Botao Entrar clicado
❌ URL apos login: https://www.instagram.com/accounts/login/
❌ Login web FALHOU. URL: https://www.instagram.com/accounts/login/
(Repete 6 vezes com backoff 10s → 20s → 40s → 80s → 120s)
```

**Conta `andreiamoura719883`:**
```
❌ Input de usuario nao encontrado!
(Repete 6 vezes — página não carrega ou DOM diferente)
```

### 2.2 Três Padrões de Falha Distintos

| Padrão | Contas Afetadas | Causa Provável |
|--------|-----------------|----------------|
| **A: Login OK mas `/onetap/` rejeitado** | `fernandabarbosa4825` | `_is_logged_in()` não reconhece `/accounts/onetap/` como sucesso |
| **B: Volta para `/accounts/login/`** | `sofiamoura6387` | Credenciais inválidas, conta bloqueada, ou Instagram detectou automação |
| **C: Input de usuário não encontrado** | `andreiamoura719883` | Página não carregou, DOM mudou, ou proxy bloqueado |

---

## 3. Análise Técnica dos Erros

### 3.1 Erro Crítico #1: `/accounts/onetap/` não reconhecido como login bem-sucedido

**Código atual (`onboarding_rpa.py:660-683`):**
```python
async def _is_logged_in(self):
    url = self.page.url
    bad_paths = ["/accounts/login", "/accounts/suspended",
                 "/accounts/disabled", "/challenge/", "/checkpoint/"]
    if any(p in url for p in bad_paths):
        return False
    if "instagram.com" not in url:
        return False
    nav = await self.page.query_selector('nav[aria-label="Home"]')
    if nav:
        return True
    profile_link = await self.page.query_selector('a[href^="/"][aria-label*="profile"]')
    if profile_link:
        return True
    if "/accounts/" not in url:
        return True
    return False
```

**Problema:** A URL `https://www.instagram.com/accounts/onetap/` contém `/accounts/`, então a última condição (`if "/accounts/" not in url`) retorna `False`. O método não verifica se `/onetap/` é uma tela de sucesso pós-login.

**Evidência nos logs:**
```
[RPA:fernandabarbosa4825] Redirect pos-2FA: https://www.instagram.com/accounts/onetap/
[RPA:fernandabarbosa4825] Login web FALHOU. URL: https://www.instagram.com/accounts/onetap/
```

O 2FA foi completado com sucesso (código preenchido, botão clicado, redirect ocorreu), mas o `_is_logged_in()` rejeitou a URL porque contém `/accounts/`.

### 3.2 Erro Crítico #2: Login volta para `/accounts/login/` sem erro explícito

**Contas afetadas:** `sofiamoura6387` (e outras)

**Possíveis causas:**
1. **Credenciais inválidas** — senha incorreta ou conta desativada
2. **Instagram detectou automação** — mesmo com anti-detection, o Instagram pode estar bloqueando baseado em:
   - IP do proxy residencial (se já usado muitas vezes)
   - Padrão de comportamento (preenchimento muito rápido, sem mouse movements)
   - User-Agent ou fingerprint do browser
3. **Challenge/Captcha silencioso** — Instagram pode estar mostrando um challenge que não é detectado pelo código (não é 2FA, não é `/challenge/` explícito)

**Evidência:** Não há mensagem de erro específica — apenas "URL apos login: https://www.instagram.com/accounts/login/" repetindo. O código não captura o motivo da falha (não há screenshot dump ou HTML dump nesse caminho).

### 3.3 Erro Crítico #3: Input de usuário não encontrado

**Contas afetadas:** `andreiamoura719883`, `fernandabarbosa4825` (tentativas 3-6)

**Código atual (`onboarding_rpa.py:730-742`):**
```python
user_input = await self.page.query_selector('input[name="email"]')
if not user_input:
    user_input = await self.page.query_selector('input[name="username"]')
if not user_input:
    user_input = await self.page.query_selector('input[type="text"]')
if user_input:
    await user_input.fill(self.username)
else:
    print(f"[RPA:{self.username}] Input de usuario nao encontrado!")
    await self.page.screenshot(path=f"/tmp/no_user_input_{self.username}.png")
    return False
```

**Possíveis causas:**
1. **Página não carregou completamente** — `wait_until="domcontentloaded"` pode ser insuficiente; o Instagram usa React hydration que pode demorar
2. **Proxy bloqueado ou lento** — timeout de 60s pode não ser suficiente se o proxy estiver congestionado
3. **Instagram mudou o DOM** — selectors `name="email"` podem ter mudado (improvável, mas possível)
4. **Página de erro/bloqueio** — Instagram pode estar mostrando uma tela de "Verificação de segurança" que não tem inputs de login

**Evidência:** O código salva screenshot em `/tmp/no_user_input_{username}.png`, mas não há HTML dump. Sem ver o screenshot, não é possível saber o que está na página.

---

## 4. Por Que Não Funciona Corretamente — Minha Visão

### 4.1 Problema Raiz #1: `_is_logged_in()` é muito restritivo

O método rejeita qualquer URL contendo `/accounts/`, mas o Instagram usa várias URLs pós-login que começam com `/accounts/`:
- `/accounts/onetap/` — tela de "login rápido" após 2FA
- `/accounts/activity/` — página de atividade
- `/accounts/edit/` — edição de perfil

**Impacto:** Contas que completam o 2FA com sucesso são marcadas como falha porque o redirect vai para `/accounts/onetap/`.

### 4.2 Problema Raiz #2: Falta de diagnóstico granular

Quando o login falha e volta para `/accounts/login/`, o código não captura:
- Screenshot da página no momento da falha
- HTML dump para inspecionar se há mensagem de erro oculta
- Network requests para ver se houve resposta 4xx/5xx do Instagram
- Cookies presentes após a tentativa

Sem isso, é impossível saber se a falha é por credenciais inválidas, bloqueio por automação, ou outro motivo.

### 4.3 Problema Raiz #3: Anti-detection insuficiente

O código atual tem:
```python
args=[
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
]
ignore_default_args=["--enable-automation"]
await self.context.add_init_script("""
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['pt-BR', 'pt', 'en']});
window.chrome = {runtime: {}};
""")
```

**O que falta:**
- **Mouse movements reais** — o código usa `fill()` e `click()` diretamente, sem simular movimentos de mouse. O Instagram pode detectar isso.
- **Delays aleatórios** — os timeouts são fixos (3s, 5s), não há jitter aleatório para parecer humano
- **Canvas/WebGL fingerprint** — não há override de `canvas.toDataURL()` ou WebGL renderer
- **TLS fingerprint** — Playwright usa Chromium padrão, que tem TLS fingerprint diferente de Chrome real (JA3 hash)

### 4.4 Problema Raiz #4: Proxies residenciais podem estar saturados

O worker usa rotação de proxies (até 6 tentativas), mas:
- Se todos os 20 proxies no pool já foram usados recentemente, o Instagram pode ter marcado os IPs
- Proxies residenciais têm sessão sticky, mas se a sessão expirar durante o job, o IP muda e o Instagram invalida a sessão
- Não há verificação de qualidade do proxy antes de usar (ex: testar se o proxy consegue acessar instagram.com antes de iniciar o job)

### 4.5 Problema Raiz #5: Concorrência alta pode triggerar rate-limit

O worker roda até 3 jobs concorrentes (`MAX_CONCURRENT_JOBS = 3`). Se os 3 jobs usam proxies do mesmo provider ou faixa de IP, o Instagram pode detectar padrão de automação e bloquear todos.

---

## 5. Possíveis Soluções (sem implementar agora)

### 5.1 Corrigir `_is_logged_in()` para aceitar `/accounts/onetap/`

Adicionar `/onetap/` à lista de URLs válidas pós-login, ou mudar a lógica para aceitar qualquer URL que não seja explicitamente de erro.

### 5.2 Adicionar diagnóstico granular em falhas de login

Quando o login falha e volta para `/accounts/login/`, capturar:
- Screenshot
- HTML dump (primeiros 10KB)
- Cookies presentes
- Últimas 10 network requests (status codes)

### 5.3 Melhorar anti-detection

- Adicionar mouse movements aleatórios antes de preencher inputs
- Adicionar delays aleatórios (jitter) entre ações
- Considerar usar `playwright-stealth` ou patches adicionais de fingerprint

### 5.4 Validar proxy antes de usar

Antes de iniciar o job, fazer um request simples para `https://www.instagram.com/` via proxy e verificar se retorna 200. Se falhar, marcar proxy como failed e pegar próximo.

### 5.5 Reduzir concorrência ou espalhar proxies

- Reduzir `MAX_CONCURRENT_JOBS` para 1 temporariamente para testar se é rate-limit
- Garantir que cada job use proxy de provider/faixa de IP diferente

---

## 6. Estado Atual do Sistema

### 6.1 Worker (VPS)

```
Container: worker-rpa-rpa-worker-1 Up 16 minutes (healthy)
DB: 0 jobs (limpo após reset)
Proxies ativos: 20
Health: {"status":"ok","service":"rpa-worker"} @ http://localhost:8080/health
Logs: Xvfb :99, concorrência máx 3, poll 30s
```

### 6.2 SaaS (Vercel)

```
Deploy: dpl_CYnaUuK1cz8oHigQkRUGVSdQYHTZ (commit 547259a)
Status: READY em Production
URL: https://autoscale-ia.vercel.app
Último deploy real: 547259a (force redeploy com empty commit)
```

### 6.3 Código Deployado

Correções confirmadas no container:
- ✅ Selectors `input[name="email"]` e `input[name="pass"]` (3 ocorrências)
- ✅ `_has_2fa_prompt()` implementado (2 ocorrências)
- ✅ Espera ativa por inputs 2FA habilitados com polling 15s (1 ocorrência)
- ✅ Detecção de conta suspensa `/accounts/suspended/` (1 ocorrência)
- ✅ Fallback 2FA verifica `is_enabled()` (4 ocorrências)

---

## 7. Conclusão

O sistema está tecnicamente funcional (worker healthy, SaaS deployado, comunicação Vercel→Worker confirmada via teste direto), mas o **login web falha consistentemente** por três motivos principais:

1. **`_is_logged_in()` rejeita URLs válidas pós-login** (`/accounts/onetap/`) — isso causa falha falsa em contas que completaram o 2FA com sucesso
2. **Falta de diagnóstico granular** — quando o login falha e volta para `/accounts/login/`, não há evidência (screenshot, HTML, cookies) para saber o motivo real
3. **Anti-detection pode ser insuficiente** — o Instagram pode estar detectando automação baseado em comportamento (sem mouse movements, delays fixos) ou fingerprint (TLS, canvas)

**Próximo passo recomendado:** Submeter uma conta real pelo dashboard e capturar logs + screenshots em tempo real para confirmar qual dos três padrões de falha está acontecendo. Com essa evidência, é possível priorizar qual correção implementar primeiro.

---

**Documento gerado automaticamente baseado em:**
- Código fonte: `onboarding_rpa.py`, `worker.py`, `db.py`, `health.py`, `config.py`
- Logs reais do worker: últimas 120 linhas capturadas em 2026-09-27
- Estado do banco SQLite: 0 jobs, 20 proxies ativos
- Deploy Vercel: commit `547259a` READY em Production