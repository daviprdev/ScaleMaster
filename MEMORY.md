# AutoScale RPA Worker — Contexto Completo do Projeto

## Visão Geral

Worker standalone que automatiza onboarding de contas Instagram para o SaaS AutoScale-IA (autoscale-ia.vercel.app). Roda em VPS (2.25.244.181) dentro de Docker com Xvfb.

**Repositório:** https://github.com/daviprdev/AutoScale-IA (branch `master` = worker, branch `main` = SaaS)

## Arquitetura

```
Dashboard (SaaS/Next.js) → POST /jobs → Worker SQLite → Instagrapi (mobile) → Playwright (web) → Magic Link → SaaS vincula conta
```

### Fluxo de Onboarding (9 etapas)
1. **Validação** — username, password, TOTP obrigatórios
2. **Login Mobile (Instagrapi)** — autentica via API mobile, valida identidade
3. **Converter para Criador** — muda tipo de conta para creator
4. **Publicar Story com Link** — story OBRIGATÓRIO com link sticker (StoryStickerLink)
5. **Trocar Foto de Perfil** — upload de foto
6. **Criar Destaque** — highlight usando story_pk confirmado
7. **Extrair Cookies** — sessionid do instagrapi → cookies Playwright
8. **Sessão Web (Playwright)** — injeta cookies, valida identidade web por API
9. **Aceitar Convite + Magic Link/OAuth** — vincula conta ao SaaS

## Stack Técnica

- **Python 3.11** + FastAPI + Uvicorn (health server porta 8080)
- **Playwright 1.63.0** — Chromium com `headless=False` + Xvfb (DISPLAY=:99)
- **instagrapi** — git+https://github.com/subzeroid/instagrapi.git@master (CORRIGIR: fixar em commit)
- **SQLite** — fila local de jobs com lease/heartbeat/checkpoint
- **AES-256-GCM** — criptografia de credenciais (SHA-256 key derivation, formato `base64(iv):base64(tag):base64(ct)`)
- **Docker** — docker-compose com Xvfb, PYTHONUNBUFFERED=1, mem_limit 2g, cpus 1.0

## Arquivos Principais

| Arquivo | Função |
|---------|--------|
| `onboarding_rpa.py` | Motor RPA principal — classe InstagramRPA + orquestrador run_onboarding_rpa() |
| `worker.py` | Loop principal — claim jobs, heartbeat, rotação de proxies, orçamento |
| `db.py` | SQLite — schema v2 com lease, checkpoint, stages, proxies |
| `health.py` | FastAPI health server — /health, /stats, /jobs/{id}/stages, pause/resume |
| `config.py` | Configuração via .env — PROFILES_DIR, SAAS_BASE_URL, ENCRYPTION_SECRET, etc. |
| `crypto.py` | Encrypt/decrypt AES-256-GCM |
| `entrypoint.sh` | Inicia Xvfb :99 antes do worker |
| `docker-compose.yml` | Serviço rpa-worker com DISPLAY=:99, volumes profiles/data |
| `Dockerfile` | Python 3.11-slim + ffmpeg + xvfb + Playwright Chromium |

## Estado Atual das Correções (29/09/2026)

### ✅ Correções Aplicadas e Deployadas

1. **Xvfb + DISPLAY=:99** — entrypoint.sh inicia Xvfb, docker-compose.yml exporta DISPLAY
2. **headless=False** — Chromium renderiza como browser real (headless=True retorna HTML vazio de 39 bytes)
3. **domcontentloaded** — em vez de networkidle (Instagram nunca fica idle)
4. **Fallback login UI REMOVIDO** — `await rpa.login()` não é mais chamado quando cookies falham
5. **session_rejected** — novo error code quando sessão web é rejeitada
6. **_extract_cookies_for_playwright() corrigido:**
   - authorization_data tratado como dict (não objeto com .sessionid)
   - cl.token NÃO usado como sessionid (é CSRF)
   - sessionid_missing aborta antes de iniciar browser
   - Domínio normalizado para .instagram.com (não i.instagram.com)
   - Deduplicação por (name, domain, path)
7. **Proxy format conversion** — host:port:user:pass → http://user:pass@host:port para instagrapi
8. **2FA detection** — URL two_step_verification + múltiplos selectors de input
9. **Story link sticker** — StoryStickerLink com story_link.url populado

### ❌ Correções Pendentes (ESPECIFICAÇÃO COMPLETA — 8 requisitos)

#### Req 2: Extração de Sessão — PARCIALMENTE FEITO
- [x] authorization_data como dict
- [x] cl.token removido como sessionid
- [x] sessionid_missing antes do browser
- [x] Domínio normalizado
- [ ] Validar que sessionid não está vazio ANTES de coletar cookies web
- [ ] ds_user_id consistente com identidade mobile autenticada

#### Req 3: Proxy Sticky Entre Etapas — NÃO FEITO
- [ ] _parse_proxy_instagrapi() e _parse_proxy_playwright() geram UUIDs independentes
- [ ] Resolver proxy e session_id UMA ÚNICA VEZ e derivar ambos formatos
- [ ] Preservar associação na retomada
- [ ] Tratar credenciais com caracteres especiais
- [ ] Não trocar proxy por falha de cookie/identidade/DOM

#### Req 4: Validação de Identidade — PARCIALMENTE FEITO
- [x] _is_authenticated_web() usa API /api/v1/accounts/current_user/
- [ ] Confirmar identidade mobile por consulta autenticada ao usuário atual (não user_info_by_username)
- [ ] Injetar cookies ANTES da navegação de validação
- [ ] Se add_cookies falhar, retornar erro explícito (atualmente captura e continua)
- [ ] Evitar conflitos com cookies antigos do perfil persistente
- [ ] Consultar identidade sem depender de seletores DOM primeiro
- [ ] Conferir status HTTP, URL final, content-type (HTTP 200 com HTML de login ≠ autenticação)
- [ ] Confirmar ID web contra ID mobile
- [ ] Usar DOM apenas para diagnóstico, não como prova de sessão inválida

#### Req 5: Orçamento e Retries — PARCIALMENTE FEITO
- [x] MAX_TOTAL_RETRIES=6, JOB_DEADLINE_SECONDS=3600 no db.py
- [x] Heartbeat renova lease a cada 60s
- [ ] Orçamento configurável para etapa playwright_session (abertura + injeção + navegação + validação)
- [ ] Deadline do job aplicado durante execução da etapa
- [ ] No timeout/cancelamento: interromper execução, fechar recursos com prazo, registrar erro, liberar capacidade
- [ ] Diferenciar error codes: sessionid_missing, cookie_injection_failed, session_rejected, identity_mismatch, challenge_required, proxy_error, web_validation_timeout
- [ ] Política centralizada de retry (sessionid_missing é permanente em uma parte, não em outra)

#### Req 6: Retomada e Progresso — PARCIALMENTE FEITO
- [x] Checkpoint por etapa (save_checkpoint/get_completed_stages)
- [x] get_job_stages() deduplica por key (mantém último status)
- [ ] Revalidar autenticação ao retomar (mesmo com checkpoint antigo)
- [ ] Persistir estado final de playwright_session em TODOS os caminhos (falha extração, injeção, timeout, cancelamento, revalidação)
- [ ] /jobs/{id}/stages retornar estado atual por etapa recuperável do banco após reinício
- [ ] Normalizar estados: pending/running/ok/error com key, label, message
- [ ] Não retornar histórico inteiro como etapas simultâneas

#### Req 7: Diagnóstico e Build Reproduzíveis — NÃO FEITO
- [ ] Registrar versão/build, etapa, duração, origem sessão, nomes/domínios cookies, status HTTP, motivo falha
- [ ] Remover credenciais de URLs de proxy e tokens de paths/queries
- [ ] Não registrar senha, TOTP, sessionid, cookies completos, Authorization
- [ ] Fixar instagrapi em versão/commit validado (hoje usa @master móvel)
- [ ] requirements.txt e Dockerfile permitem instalação duplicada de instagrapi

#### Req 8: Testes de Regressão — NÃO FEITO
- [ ] sessionid disponível apenas em authorization_data dict
- [ ] CSRF presente sem sessionid → falhar antes do navegador
- [ ] Cookie originalmente limitado a i.instagram.com
- [ ] Cookies vazios, expirados ou conflitantes
- [ ] Mesma configuração sticky no mobile e Playwright
- [ ] Falha em add_cookies propagada
- [ ] DOM desconhecido com identidade autenticada válida
- [ ] Cookie presente com sessão rejeitada
- [ ] HTTP 200 com HTML de login
- [ ] ID web diferente do ID mobile
- [ ] Challenge e rate limit corretamente classificados
- [ ] Requisição que nunca responde encerrada pelo orçamento
- [ ] Retomada sem repetir ações já concluídas
- [ ] Progresso correto após falha e reinício

## Problema Raiz do Erro "Input de username não encontrado"

**Causa:** O código fazia um SEGUNDO LOGIN via Playwright (await rpa.login()) quando os cookies do instagrapi não autenticavam na web. O Instagram moderno bloqueia automação e não renderiza os inputs de login, causando o erro.

**Solução aplicada:** Remover o fallback de login UI. Se cookies não autenticam → error_code `session_rejected` (sessão expirada/inválida/challenge).

**Por que ainda falha:** A sessão mobile do instagrapi pode estar sendo rejeitada pelo Instagram ao tentar autenticar na web. Isso requer:
1. Verificar se o sessionid extraído é realmente válido
2. Verificar se os cookies estão sendo injetados com domínio/path corretos
3. Verificar se a proxy sticky está funcionando (mesmo IP para mobile e web)
4. Verificar se o Instagram está servindo challenge/CAPTCHA em vez de página autenticada

## VPS e Deploy

- **IP:** 2.25.244.181
- **SSH:** `ssh -i ~/.ssh/id_ed25519 root@2.25.244.181`
- **Path:** /opt/worker-rpa/
- **Container:** worker-rpa-rpa-worker-1
- **Deploy:** `scp arquivo → docker compose build --no-cache → docker compose up -d --force-recreate`
- **Health:** http://localhost:8080/health
- **Stats:** http://localhost:8080/stats

## Próximos Passos Prioritários

1. **Fixar instagrapi** em commit específico (não @master)
2. **Proxy sticky unificado** — resolver session_id uma vez, derivar ambos formatos
3. **Validação de identidade mobile** — usar endpoint autenticado ao usuário atual
4. **Orçamento playwright_session** — deadline + cancelamento gracioso
5. **add_cookies com propagação de erro** — não capturar e continuar
6. **Testes de regressão** — cobrir os 14 cenários da especificação
7. **Validação real** — testar com conta de teste na VPS após todas as correções

## Convenções

- Logs prefixados com `[RPA:{username}]`, `[WORKER]`, `[DB]`, `[CONFIG]`
- Error codes snake_case: sessionid_missing, session_rejected, identity_mismatch, etc.
- Stages: validation, instagrapi_login, convert_creator, post_story, change_photo, highlight, extract_cookies, playwright_session, accept_invite, magic_link
- Status: pending → processing → done/error/expired
- Checkpoints salvos em SQLite (completed_stages column)