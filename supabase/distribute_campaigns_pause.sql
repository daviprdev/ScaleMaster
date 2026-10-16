-- Migration: pausar/retomar campanhas da aba Postar
-- Data: 2026-10-16
-- Aplicação: após distribute_campaigns_atomicity.sql. Idempotente.
--
-- Pausar uma campanha congela SÓ a fila dela: distribute_campaigns.status
-- passa a 'paused' e os posts continuam 'pending'. O cron publish-scheduled
-- exclui da busca os posts de campanhas pausadas e o sync-distribute-accounts
-- já só matricula contas em campanhas 'active'. As outras campanhas seguem
-- publicando normalmente.
--
-- Ao retomar, todos os posts pendentes da campanha são empurrados pelo tempo
-- que ela ficou pausada (now() - paused_at): cada post mantém o mesmo atraso
-- restante que tinha no momento da pausa, em vez de tudo que venceu durante a
-- pausa sair de uma vez.

ALTER TABLE distribute_campaigns
  ADD COLUMN IF NOT EXISTS paused_at timestamptz;

COMMENT ON COLUMN distribute_campaigns.status IS
'Estado da campanha: preparing (montando posts), active (publicando), paused (fila congelada pelo usuário) ou failed';

COMMENT ON COLUMN distribute_campaigns.paused_at IS
'Início da pausa atual (NULL quando não está pausada). Base do deslocamento dos horários ao retomar.';

-- Retomada atômica: desloca os horários e reativa a campanha na mesma
-- transação. Reativar antes de deslocar abriria uma janela em que o cron
-- pegaria de uma vez todos os posts que venceram durante a pausa.
-- Retorna o número de posts reagendados, ou -1 se a campanha não existe,
-- não é do usuário ou não está pausada.
CREATE OR REPLACE FUNCTION public.resume_distribute_campaign(
  p_campaign_id uuid, p_user_id uuid
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_paused_at timestamptz;
  v_shift interval;
  v_count integer;
BEGIN
  SELECT paused_at INTO v_paused_at
  FROM distribute_campaigns
  WHERE id = p_campaign_id AND user_id = p_user_id AND status = 'paused'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  v_shift := GREATEST(now() - COALESCE(v_paused_at, now()), interval '0');

  UPDATE scheduled_posts
  SET scheduled_at = scheduled_at + v_shift
  WHERE campaign_id = p_campaign_id
    AND user_id = p_user_id
    AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE distribute_campaigns
  SET status = 'active', paused_at = NULL
  WHERE id = p_campaign_id;

  RETURN v_count;
END;
$$;

-- Recebe p_user_id como parâmetro: só o servidor (service_role) pode chamar —
-- mesmo padrão de revoke_public_rpc_execute.sql.
REVOKE EXECUTE ON FUNCTION public.resume_distribute_campaign(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_distribute_campaign(uuid, uuid) TO service_role;
