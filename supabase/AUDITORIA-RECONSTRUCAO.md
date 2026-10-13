# Auditoria para reconstruir o Supabase

Data: 13/10/2026  
Escopo: leitura do repositório `ScaleMaster`; nenhuma alteração foi feita no Supabase remoto.

## Resultado

É possível reconstruir o banco, mas **o repositório atual não contém um esquema completo e executável para começar do zero**. Há 59 arquivos SQL em `supabase/`, mas só um arquivo dentro de `supabase/migrations/`, não há `supabase/config.toml`, e vários objetos que o aplicativo usa foram criados diretamente no Supabase e não foram versionados aqui.

Por isso, não juntei os fragmentos num script único: aplicado em ordem, o conjunto atual falha em objetos ausentes e não recria toda a estrutura que o código espera.

## Lacunas que bloqueiam um setup confiável

- `story_media`: o aplicativo lista, grava e apaga linhas dessa tabela. O repositório contém `story_media_unique.sql`, que cria um índice nela, mas não contém o `CREATE TABLE`.
- `scheduled_posts.campaign_id`: o aplicativo usa essa coluna e `distribute_campaigns.sql` tenta criar um índice sobre ela; nenhum SQL versionado a adiciona.
- Colunas de campanha ausentes do SQL versionado: `clone_source_profile` é lida pelo aplicativo; `get_views_summary` usa `insights_plays` e `insights_fetched_at`; o código de postagem também grava `story_link_url`. As migrações presentes não definem todas essas colunas.
- RPCs sem definição versionada: `get_campaign_summaries` e `get_account_video_usage` são chamadas pelo aplicativo. A primeira monta o histórico de campanhas; a segunda é usada para evitar repetir vídeos. `admin_user_growth_30d` também é chamada, mas tem fallback no código.
- `automations`: `video_processing_mode.sql` tenta alterar essa tabela, mas o repositório não a cria. As notas do próprio projeto dizem que o módulo foi desativado; ainda existem consultas de compatibilidade no histórico de campanhas.
- `revoke_public_rpc_execute.sql` não é autossuficiente: além de listar funções sem definição nos arquivos, faz `ALTER FUNCTION` incondicional em funções antigas como `update_human_schedule_updated_at()` e `update_automations_updated_at()`. Em banco novo, essa etapa pode interromper a execução.
- `sql/onboarding-story-highlight.sql` altera `onboarding_jobs`, tabela que não é criada no repositório. Os três arquivos em `sql/` não são referenciados pelo código atual e parecem pertencer a um fluxo antigo.

Esses pontos são exemplos confirmados por busca no código e nos SQLs versionados; não são uma lista exaustiva de diferenças de colunas. O arquivo `supabase/schema.sql` é uma base antiga e não substitui o esquema atual.

## O que falta para eu fechar o pacote

Preciso de uma exportação **somente do esquema**, sem linhas de usuários, tokens, senhas ou outras credenciais, do banco que você quer usar como referência. Ela deve incluir os objetos do schema `public`: tabelas e colunas, índices, constraints, funções/RPCs, triggers, políticas e estado de RLS. Inclua também a configuração dos buckets e políticas personalizadas de Storage, se quiser recriá-los.

Se o Supabase CLI já estiver instalado e ligado ao projeto, `supabase db dump --linked --schema public -f supabase/schema-remoto.sql` gera o dump do schema `public` sem os dados. O CLI exclui os schemas gerenciados `auth` e `storage` por padrão, então as políticas customizadas de Storage precisam ser incluídas à parte. Consulte a [referência oficial do `supabase db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump).

Com essa referência, posso comparar o esquema real com este código, separar o que ainda é usado do que ficou legado e entregar um pacote único ordenado para um projeto Supabase vazio, mais a lista de configurações fora do SQL (Auth/URLs e variáveis de ambiente).

## Antes de aplicar qualquer SQL

- Não rode todos os arquivos existentes em sequência no projeto atual: a ordem não está registrada e há dependências ausentes.
- Não use um reset/destructive script no banco que ainda tenha dados. Este repositório documenta um projeto de produção e não temos uma exportação de dados ou do Storage neste diretório.
- O endereço e as chaves do Supabase usados pela aplicação ficam em variáveis de ambiente. A `service_role` deve permanecer somente no servidor.

## Verificações feitas

- Revisei a lista de SQLs, as definições de tabelas/RPCs e as referências `.from()`/`.rpc()` na aplicação.
- O diretório não tem histórico de migrations Supabase completo.
- Não havia uma aba do Supabase aberta nem um conector Supabase disponível nesta sessão; portanto, esta auditoria cobre o código local, não o estado atual do banco remoto.
