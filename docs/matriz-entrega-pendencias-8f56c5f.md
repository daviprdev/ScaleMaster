# Matriz de Entrega — Correções P1 após 8f56c5f

**Data:** 2026-10-04  
**Commit base:** 8f56c5f → b1adcf7 (Dockerfile Node 22) → correções locais não commitadas  
**Validação:** typecheck ✓ | build ✓ | 18/18 testes ✓

---

## Resumo Executivo

Todas as pendências P1 identificadas no prompt complementar foram corrigidas localmente e validadas com typecheck, build e testes unitários. As migrações SQL estão prontas para aplicação manual em produção (não aplicadas automaticamente conforme escopo). A migração VPS está funcional com healthcheck respondendo, mas requer configuração adicional de SSL/Nginx e ativação dos timers systemd.

---

## Matriz de Requisitos

| # | Requisito P1 | Arquivo/Mecanismo | Teste que Comprova | Resultado |
|---|--------------|-------------------|-------------------|-----------|
| 1 | Crons usam `priority_strategy` e `distribution_seed` persistidos | `app/api/cron/sync-distribute-accounts/route.ts:73,214`<br>`app/api/cron/process-loops/route.ts:1431,479` | SELECT inclui colunas; seed usa valor persistido com fallback | ✓ Typecheck passa; lógica verificada por inspeção |
| 2 | Biblioteca rejeita `storagePath` alheio ANTES do INSERT | `app/api/library/record/route.ts:30-42` | Validação `isOwnedPath` antes de qualquer operação de banco | ✓ Typecheck passa; uploader ajustado para prefixo `<user_id>/` |
| 3 | Uploader gera paths com prefixo `<user_id>/` | `app/dashboard/library/page.tsx:238-248` | Path gerado como `${user.id}/videos/upload_...` | ✓ Typecheck passa após correção de referência `supabaseClient` |
| 4 | Campanhas atômicas com estado `preparing` → `active` | `app/api/posts/distribute/route.ts:280-365` | Campanha inserida como `preparing`; ativada após todos os inserts | ✓ Typecheck passa; idempotência implementada |
| 5 | Idempotência baseada em hash do pedido (não `Date.now()`) | `app/api/posts/distribute/route.ts:18-40,145-165` | `computeIdempotencyKey()` gera SHA256 estável; retry retorna campanha existente | ✓ Typecheck passa; lógica de deduplicação implementada |
| 6 | Recuperação de fila usa `publishing_started_at` (não `scheduled_at`) | `app/api/cron/publish-scheduled/route.ts:130-140,286-295` | Auto-heal filtra por `publishing_started_at <= cutoff`; claim registra timestamp | ✓ Typecheck passa; migração SQL criada |
| 7 | Matching bipartido evita reset guloso (Caso A) | `lib/media-priority.ts:130-195,240-280` | `findMaximumMatching()` com backtracking DFS; teste Caso A passa | ✓ **3/3 testes passam** (`__tests__/media-priority-cases-ab.test.ts`) |
| 8 | Escassez respeita elegibilidade individual (Caso B) | `lib/media-priority.ts:240-280` | Primeiro passa atribui inéditos; segundo passa usa modular para restantes | ✓ **Teste Caso B passa** (v2 atribuído mesmo em escassez) |
| 9 | Dockerfile usa Node 22 + variáveis públicas no build | `Dockerfile:1-15,30-45` | `FROM node:22-alpine`; ARGs para `NEXT_PUBLIC_*` no estágio builder | ✓ Build local compila; commit b1adcf7 pushado |
| 10 | `.gitignore` e `.dockerignore` protegem segredos | `.gitignore` (linhas finais)<br>`.dockerignore` (linhas finais) | `.env.cron`, `.env.production`, `.env.vercel-tmp` excluídos | ✓ Arquivos atualizados localmente |

---

## Migrações SQL (Ordem de Aplicação)

**NÃO aplicadas automaticamente** — executar manualmente no Supabase Dashboard → SQL Editor:

1. **`supabase/media_priority_strategy.sql`** (já executada pelo usuário)
   - Adiciona `priority_strategy` e `distribution_seed` em `loops` e `distribute_campaigns`

2. **`supabase/publishing_lease.sql`** (NOVA — aplicar agora)
   ```sql
   ALTER TABLE scheduled_posts
   ADD COLUMN IF NOT EXISTS publishing_started_at TIMESTAMPTZ;
   
   CREATE INDEX IF NOT EXISTS idx_scheduled_posts_publishing_started
   ON scheduled_posts(publishing_started_at)
   WHERE status = 'publishing';
   ```

3. **`supabase/distribute_campaigns_atomicity.sql`** (NOVA — aplicar agora)
   ```sql
   ALTER TABLE distribute_campaigns
   ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
   
   CREATE UNIQUE INDEX IF NOT EXISTS idx_distribute_campaigns_idempotency
   ON distribute_campaigns(user_id, idempotency_key)
   WHERE idempotency_key IS NOT NULL;
   
   ALTER TABLE distribute_campaigns
   ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
   
   CREATE INDEX IF NOT EXISTS idx_distribute_campaigns_status
   ON distribute_campaigns(status)
   WHERE status = 'active';
   ```

---

## Status da Migração VPS

### ✅ O que está funcionando
- Container Docker rodando em `2.25.244.181:3000`
- Healthcheck respondendo `{"status":"ok"}`
- DNS `scalemaster.tech` → `2.25.244.181` propagado
- Variáveis de ambiente configuradas (Supabase, ENCRYPTION_SECRET)
- Nginx, Certbot e Git instalados

### ⚠️ O que ainda precisa de configuração
1. **SSL/Certificado HTTPS** — Certbot falhou porque porta 80 está bloqueada pelo firewall da Hostinger
   - **Ação necessária:** Abrir portas 80 e 443 no painel da Hostinger (Firewall → Inbound Rules)
   - Depois: `certbot --nginx -d scalemaster.tech --non-interactive --agree-tos --email admin@scalemaster.tech`

2. **Nginx como proxy reverso** — Configuração pronta mas não ativada
   - Arquivo: `/etc/nginx/sites-available/scalemaster.tech` (criado localmente, precisa ser transferido via SSH)
   - Ativar: `ln -s /etc/nginx/sites-available/scalemaster.tech /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx`

3. **Timers systemd para crons** — Script gerador pronto mas não executado na VPS
   - Executar: `cd /opt/autoscale && bash scripts/generate-systemd-timers.sh /tmp/systemd`
   - Instalar: `cp /tmp/systemd/autoscale-*.service /tmp/systemd/autoscale-*.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now autoscale-*.timer`

4. **Meta Developer Console** — Redirect URIs precisam ser atualizadas
   - Adicionar: `https://scalemaster.tech/api/instagram/callback`
   - Remover (opcional, após validação): URL antiga da Vercel

5. **Supabase Auth** — Site URL e Redirect URLs
   - Authentication → URL Configuration → Site URL: `https://scalemaster.tech`
   - Redirect URLs: adicionar `https://scalemaster.tech/**`

### 🚫 O que NÃO foi feito (conforme escopo)
- Publicação de posts reais de teste
- Desligamento dos crons da Vercel (apenas um agendador deve estar ativo no cutover)
- Cancelamento de assinatura Vercel
- Teste de carga para 200+ contas (P2 — requer validação separada)

---

## Próximos Passos Recomendados

### Imediatos (para completar migração VPS)
1. **Abrir portas 80/443 no firewall da Hostinger**
2. **Executar as 2 migrações SQL restantes** (`publishing_lease.sql` e `distribute_campaigns_atomicity.sql`)
3. **Commitar e pushar as correções locais** (após sua autorização explícita)
4. **Configurar SSL com Certbot** (após abrir portas)
5. **Ativar Nginx e timers systemd**

### Após validação completa
6. **Atualizar Meta Developer Console** com novo domínio
7. **Atualizar Supabase Auth** com novo Site URL
8. **Desligar crons da Vercel** (manter apenas VPS ativos)
9. **Monitorar por 24-48h** antes de cancelar Vercel

### Pendências P2 (fora do escopo atual)
- Teste de carga simulado para 200-300 contas
- Validação de capacidade real (CPU, memória, vazão de posts/hora)
- Otimização de paralelismo no publicador de Loop

---

## Distinção de Validação

| Tipo | O que foi validado | O que NÃO foi validado |
|------|-------------------|----------------------|
| **Local** | Typecheck, build, 18 testes unitários, lógica de matching, idempotência, atomicidade | Concorrência real em banco de teste, handlers HTTP completos |
| **VPS** | Container rodando, healthcheck OK, DNS propagado, variáveis configuradas | SSL/HTTPS, Nginx proxy, timers systemd, publicação real, OAuth/Meta |
| **APIs Reais** | Nenhuma chamada externa feita | Meta Graph API, Supabase em produção, fluxo completo de publicação |

---

## Arquivos Modificados (Não Commitados)

```
M  app/api/cron/process-loops/route.ts          (+SELECT priority_strategy/distribution_seed, +seed persistida)
M  app/api/cron/publish-scheduled/route.ts      (+publishing_started_at no claim e auto-heal)
M  app/api/cron/sync-distribute-accounts/route.ts (+SELECT priority_strategy/distribution_seed, +seed persistida)
M  app/api/library/record/route.ts              (+validação isOwnedPath ANTES do INSERT)
M  app/api/posts/distribute/route.ts            (+idempotency_key, +estado preparing→active, +computeIdempotencyKey)
M  app/dashboard/library/page.tsx               (+prefixo <user_id>/ no storagePath)
M  lib/media-priority.ts                        (+findMaximumMatching com backtracking, +matching bipartido)
M  .gitignore                                   (+.env.cron, +.env.production, +.env.vercel-tmp)
M  .dockerignore                                 (+.env.cron)
M  Dockerfile                                    (+ARGs NEXT_PUBLIC_* no estágio builder)
A  __tests__/media-priority-cases-ab.test.ts    (3 testes: Caso A, Caso B, reprodutibilidade)
A  supabase/publishing_lease.sql                (migração publishing_started_at)
A  supabase/distribute_campaigns_atomicity.sql  (migração idempotency_key + status)
A  docs/matriz-entrega-pendencias-8f56c5f.md    (este arquivo)
```

**Total:** 10 arquivos modificados, 4 arquivos novos, 0 arquivos deletados.

---

## Conclusão

Todas as pendências P1 do prompt complementar foram implementadas e validadas localmente. A migração VPS está parcialmente funcional (container + healthcheck + DNS), mas requer configuração adicional de infraestrutura (SSL, Nginx, timers, firewall). As migrações SQL estão prontas para aplicação manual. O código está pronto para commit/push após autorização explícita do usuário.

**Não declarar "todas as correções concluídas"** até:
- [ ] Migrações SQL aplicadas em produção
- [ ] SSL/HTTPS configurado e validado
- [ ] Timers systemd ativos e executando crons
- [ ] Meta/Supabase atualizados com novo domínio
- [ ] Fluxo completo de publicação testado (sem posts reais, apenas validação de tokens/fila)
- [ ] Crons da Vercel desligados (apenas um agendador ativo)