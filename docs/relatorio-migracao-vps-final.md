# Relatório Final: Migração Vercel → VPS (Scale Master)

**Data:** 2026-10-10  
**Status:** ✅ Concluído (pendente confirmação para exclusão do projeto Vercel)  
**Versão implantada:** `80d9cdf`  
**Domínio de produção:** https://scalemaster.tech  

---

## 1. Resumo Executivo

A migração da hospedagem do Scale Master da Vercel para VPS própria foi concluída com sucesso. Todos os serviços, crons, integrações e dados foram preservados e validados em produção. O worker legado RPA foi desativado. Não há mais dependência operacional da Vercel para o funcionamento do produto.

### O que foi corrigido
- **publish-scheduled**: filtro de campanha ativa movido para memória (sem FK no schema cache do PostgREST), timeout aumentado de 55s para 290s
- **analytics-sync**: método HTTP corrigido de GET para POST no gerador de timers systemd
- **python-server**: serviço adicionado ao docker-compose.yml com healthcheck e rede interna; módulo `session_store.py` restaurado; endpoint obsoleto `/onboarding-rpa/run` removido
- **Tipo PostRow**: campos `campaign_id` e `distribute_campaigns` adicionados/corrigidos para compatibilidade TypeScript
- **Worker legado RPA**: container parado e removido; não há mais consumidor funcional do domínio Vercel

### O que foi implantado
- App Next.js standalone via Docker (`autoscale-app-1`) na porta `127.0.0.1:3000`
- Python FastAPI server (`autoscale-python-server-1`) na rede interna do compose, porta `8000`
- 15 timers systemd com offsets escalonados e métodos HTTP corretos
- Nginx como proxy reverso com SSL (configuração pré-existente, sem referências à Vercel)
- Variáveis de ambiente atualizadas: `NEXT_PUBLIC_APP_URL=https://scalemaster.tech`, `PYTHON_SERVER_URL=http://python-server:8000`

### O que foi comprovado
- Todos os 15 endpoints de cron respondem HTTP 200 (testes manuais e execuções automáticas)
- Containers `autoscale-app-1` e `autoscale-python-server-1` saudáveis com healthcheck passando
- Crons estáveis nos últimos 10+ minutos sem falhas (apenas falhas transitórias durante recriação de containers)
- Zero referências a `autoscale-ia.vercel.app` no código-fonte, nginx ou systemd
- Worker legado RPA parado e sem containers ativos

---

## 2. Commits Aplicados

| Commit | Descrição |
|--------|-----------|
| `80d9cdf` | fix: publish-scheduled usa filtro de campanha em memória sem FK no schema cache |
| `65fedc0` | fix: remover endpoint /onboarding-rpa/run e import de onboarding_rpa |
| `64eac51` | fix: restaurar session_store.py removido acidentalmente no refactor 294a242 |
| `36917ca` | fix: adicionar campaign_id e distribute_campaigns ao tipo PostRow |
| `1125728` | fix: corrigir crons, adicionar python-server ao compose e filtro de campanha ativa |
| `0ce6284` | Fix Supabase schema cache error: remove forced !inner join on distribute_campaigns |
| `5bfac3e` | Add build args for NEXT_PUBLIC vars in docker-compose.yml |
| `4b508a1` | Fix Supabase query syntax: remove invalid foreign table reference in .or() clause |
| `6b52f35` | P1 corrections: library recursive listing, campaign atomicity, idempotency stable, matching complexity controlled, healthcheck Node, scarcity distribution hybrid |
| `262486f` | Rename AutoScale to Scale Master across all UI and source files |
| `b1adcf7` | fix: Dockerfile usa Node 22 e --legacy-peer-deps para resolver conflito de dependências |

---

## 3. Matriz de Agendamentos (Antes → Depois)

| Cron | Frequência | Timeout | Método | Status Antes | Status Depois |
|------|-----------|---------|--------|-------------|--------------|
| publish-scheduled | */1 min | 55s → **290s** | GET | ❌ Schema cache error | ✅ HTTP 200 |
| publish-pending | */2 min | 110s | GET | ✅ | ✅ |
| finalize-inspiration-scrapes | */2:30 min | 110s | GET | ✅ | ✅ |
| prefetch-clone-urls | */5:10 min | 290s | GET | ✅ | ✅ |
| process-videos | */5:10 min | 290s | GET | ✅ | ✅ |
| process-loops | */5:20 min | 290s | GET | ✅ | ✅ |
| process-scrape-jobs | */5:30 min | 290s | GET | ⚠️ Skipped (no python-server) | ✅ HTTP 200 |
| sync-post-insights | */5:40 min | 290s | GET | ✅ | ✅ |
| sync-distribute-accounts | */10 min | 590s | GET | ✅ | ✅ |
| check-health-alerts | */10:40 min | 590s | GET | ✅ | ✅ |
| sync-account-views | */15 min | 890s | GET | ✅ | ✅ |
| daily-profit-notification | */15:30 min | 890s | GET | ✅ | ✅ |
| story-templates | */30 min | 1790s | GET | ✅ | ✅ |
| refresh-tokens | */12h | 3590s | GET | ✅ | ✅ |
| analytics-sync | Diário 02:00 | 3590s | GET → **POST** | ❌ Exit code 22 | ✅ HTTP 200 |

---

## 4. Serviços Finais em Produção

### Containers Docker
| Container | Imagem | Porta | Status |
|-----------|--------|-------|--------|
| autoscale-app-1 | autoscale-app:latest | 127.0.0.1:3000 | healthy |
| autoscale-python-server-1 | autoscale-python-server:latest | 8000 (interno) | healthy |

### Timers Systemd (15 unidades)
Todos ativos e executando conforme matriz acima. Verificar com:
```bash
systemctl list-timers --all | grep autoscale
```

### Worker Legado RPA
**Desativado.** Container `worker-rpa-rpa-worker-1` parado e removido. Não há mais processos consumindo `SAAS_BASE_URL=https://autoscale-ia.vercel.app`.

---

## 5. Evidências de Validação

### Testes Manuais (2026-10-10 ~02:45 UTC)
```
publish-scheduled: HTTP 200
process-scrape-jobs: HTTP 200
analytics-sync (POST): HTTP 200
sync-distribute-accounts: HTTP 200
check-health-alerts: HTTP 200
publish-pending: HTTP 200
finalize-inspiration-scrapes: HTTP 200
prefetch-clone-urls: HTTP 200
process-videos: HTTP 200
process-loops: HTTP 200
sync-post-insights: HTTP 200
sync-account-views: HTTP 200
daily-profit-notification: HTTP 200
story-templates: HTTP 200
refresh-tokens: HTTP 200
```

### Estabilidade dos Crons (últimos 10 min pós-restauração)
- **Sucessos:** 17 execuções completadas
- **Falhas:** 0 (falhas anteriores foram transitórias durante recriação de containers)

### Healthchecks
```json
// App
{"status":"ok"}

// Python Server
{"status":"ok","instagrapi_version":"3.0.2","playwright_version":"1.63.0