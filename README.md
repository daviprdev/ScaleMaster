# AutoScale RPA Worker

Worker standalone de onboarding de contas Instagram via Playwright.
**Completamente separado do SaaS** — sem banco compartilhado, sem chamadas HTTP diretas.

## Arquitetura

```
┌─────────────────────┐       ┌─────────────────────┐
│   SaaS (Vercel)     │       │  Worker RPA (VPS)    │
│                     │       │                      │
│ - Gera Magic Link   │       │ - Recebe jobs via API│
│ - /add/{token}      │◀──────│ - Executa RPA        │
│ - OAuth callback    │  URL  │ - Navega Magic Link  │
│ - Dashboard         │       │ - Zero DB compartilhado│
└─────────────────────┘       └─────────────────────┘
```

A conexão entre conta e SaaS acontece **apenas** quando o RPA navega até
`https://autoscale-ia.vercel.app/add/{token}` como última etapa da automação.
O SaaS reconhece o cookie OAuth e vincula a conta ao usuário automaticamente.

## Stack

- Python 3.11 + Playwright (Chromium)
- FastAPI para health check e API de jobs
- Docker + docker-compose
- VPS: Hetzner Cloud CPX21 (€7.49/mês)

## Setup Rápido

```bash
# 1. Clonar
git clone https://github.com/daviprdev/autoscale-rpa-worker.git
cd autoscale-rpa-worker

# 2. Configurar
cp .env.example .env
nano .env

# 3. Subir
docker compose up -d

# 4. Verificar
docker compose logs -f rpa-worker
curl http://localhost:8080/health
```

## Fluxo do Onboarding

1. Login no Instagram (com proxy + 2FA se necessário)
2. Aceitar convite de tester do App (se aplicável)
3. Trocar foto de perfil
4. Postar story com link
5. Criar destaque do story
6. **Navegar até Magic Link** → conta vinculada ao SaaS automaticamente

## Escala

| Contas/dia | Workers | VPS | Custo |
|-----------|---------|-----|-------|
| 50 | 1 | CPX21 (4GB) | €7.49/mês |
| 200 | 1 | CPX31 (8GB) | €14.99/mês |
| 500 | 2 | 2x CPX21 | €14.98/mês |

## Licença

Proprietário — uso interno AutoScale IA.