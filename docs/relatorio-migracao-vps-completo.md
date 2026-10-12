# Relatório Completo: Migração Vercel → VPS (Scale Master)

**Data de Atualização:** 2026-10-12
**Commit Final:** \`d077506\`
**Domínio de Produção:** https://scalemaster.tech
**VPS:** \`2.25.244.181\` (IPv6: \`2a02:4780:75:828b::1\`)
**Status:** ✅ Hospedagem Independente e Validada

---

## 1. Resumo Executivo

A migração da hospedagem do Scale Master da Vercel para VPS própria foi concluída e validada em produção. A infraestrutura crítica (App Next.js + Python Server) está operacional, segura e versionada. Não existem dependências operacionais da Vercel para o funcionamento do site, agendamentos ou integrações críticas.

### Evidências de Independência
- **Infraestrutura:** 2 containers saudáveis (\`autoscale-app-1\`, \`autoscale-python-server-1\`) com compose versionado e reproduzível.
- **Código:** 0 referências funcionais a \`vercel.app\` ou \`autoscale-ia\` no código-fonte, nginx ou timers.
- **Segurança:** Webhooks SharkBot/ApexVips corrigidos para fail-closed (HTTP 401/500 sem segredo); logs OAuth sanitizados.
- **Agendamentos:** 15 timers systemd ativos e estáveis na VPS; worker legado RPA removido.
- **Integrações:** Meta OAuth, Push VAPID e Apify configurados no ambiente da VPS.

---

## 2. Correções e Commits Recentes (Outubro 2026)

| Commit | Descrição | Impacto |
|--------|-----------|---------|
| \`d077506\` | fix: remover referência residual a autoscale-ia.com em app-url | Elimina última menção ao domínio antigo em mensagens de erro |
| \`1efe6ad\` | fix: webhooks fail-closed com sintaxe corrigida | Segurança: webhooks rejeitam requisições sem autenticação |
| \`836411f\` | fix: webhooks fail-closed e logs OAuth sanitizados | Previne vazamento de tokens em logs de produção |
| \`3411763\` | fix: restaurar python-server no compose com newline | Recupera serviço Python essencial para scraping/vídeo |

---

## 3. Matriz de Integrações

| Integração | Estado | Evidência | Pendência |
|------------|--------|-----------|-----------|
| Meta/Instagram OAuth | ✅ Implementado | Código oficial Graph API, credenciais por usuário, callback scalemaster.tech | Validação funcional requer conta de teste Meta |
| Webhooks SharkBot/ApexVips | ✅ Seguro | Fail-closed validado (HTTP 401 sem auth), commit 1efe6ad | Configurar segredos reais nos provedores |
| Push Notifications (VAPID) | ✅ Configurado | Variáveis presentes, endpoint /api/push/vapid-public-key ativo | Teste de inscrição requer navegador real |
| Apify Scraper | ⚠️ Configurado | Token presente no .env.production | Validar token real e billing da conta Apify |
| Supabase Auth/DB | ✅ Preservado | Projeto nulhkxjpsulkoygmralf, dados intactos | Nenhuma |

---

## 4. Procedimento de Deploy/Rollback

### Deploy Controlado
\`\`\`bash
cd /opt/autoscale
git pull origin main
docker compose --env-file .env.production up -d --build app python-server
curl -sf http://127.0.0.1:3000/api/health  # Deve retornar 200
\`\`\`

### Rollback
\`\`\`bash
cd /opt/autoscale
git revert HEAD  # Ou checkout do commit anterior conhecido
docker compose --env-file .env.production up -d --build app
\`\`\`

### Verificações Pré-Deploy
- [ ] Git sem rebase/merge pendente
- [ ] Compose contém serviços \`app\` e \`python-server\`
- [ ] Arquivo termina com quebra de linha
- [ ] Segredos presentes em \`.env.production\`

---

## 5. Veredito Final

**Vercel pronta para exclusão, aguardando confirmação.**

A hospedagem está completamente independente. A exclusão do projeto \`autoscale-ia\` na Vercel não afetará a operação do ScaleMaster.

### Ação Requerida do Usuário
1. Confirmar exclusão do projeto Vercel \`autoscale-ia\`
2. Cancelar assinatura/cobrança da Vercel separadamente (exclusão ≠ cancelamento)
3. Validar configurações externas nos painéis Meta/Apify/SharkBot apontando para scalemaster.tech

---

*Relatório gerado automaticamente. Última validação: 2026-10-12 ~21h UTC.*