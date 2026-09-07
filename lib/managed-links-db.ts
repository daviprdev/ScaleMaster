/**
 * managed-links-db.ts — validações de vínculo que precisam do banco.
 *
 * Separado de `lib/managed-links.ts` (que é puro e testável sem banco) e das
 * rotas (um `route.ts` do App Router só pode exportar handlers HTTP e config).
 */

import type { getSupabaseAdmin } from "@/lib/supabase";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** A conta do Instagram existe E pertence ao usuário da sessão. */
export async function userOwnsAccount(
  admin: Admin,
  userId: string,
  accountId: string
): Promise<boolean> {
  const { data } = await admin
    .from("instagram_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Campanha é um agrupamento virtual (`scheduled_posts.campaign_id`) — não há
 * tabela canônica. Só as campanhas do Postar têm linha em
 * `distribute_campaigns`, então checar as duas fontes é o que permite vincular
 * também campanhas de Clone e as antigas de Automatizar.
 */
export async function userOwnsCampaign(
  admin: Admin,
  userId: string,
  campaignId: string
): Promise<boolean> {
  const { data: post } = await admin
    .from("scheduled_posts")
    .select("id")
    .eq("user_id", userId)
    .eq("campaign_id", campaignId)
    .limit(1)
    .maybeSingle();
  if (post) return true;

  const { data: dist } = await admin
    .from("distribute_campaigns")
    .select("id")
    .eq("user_id", userId)
    .eq("id", campaignId)
    .maybeSingle();
  return Boolean(dist);
}
