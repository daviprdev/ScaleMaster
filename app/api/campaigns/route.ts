import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RpcRow {
  campaign_id: string;
  total: number;
  published: number;
  pending: number;
  failed: number;
  cancelled: number;
  first_slot: string;
  last_slot: string;
  next_pending: string | null;
  last_published_at: string | null;
  last_error_message: string | null;
  created_at: string;
  account_ids: string[];
  clone_source_profile: string | null;
  is_clone: boolean;
}

interface CampaignSummary extends RpcRow {
  campaign_status: "running" | "completed";
  is_automation: boolean;
  is_synced: boolean;
  synced_folder_names: string[];
}

export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ campaigns: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const postTypeFilter = searchParams.get("post_type"); // "reel" | "story" | null (todos)

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  // Usa RPC para agregar server-side — evita o hard cap de 1000 linhas do PostgREST
  const { data, error } = await (admin as any)
    .rpc("get_campaign_summaries", { p_user_id: user.id });

  if (error) {
    if (error.code === "42703" || error.message?.includes("campaign_id") ||
        error.code === "42883" || error.message?.includes("get_campaign_summaries")) {
      return NextResponse.json({ campaigns: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Automatizar usa campaign_id = automation.id — marca essas linhas para que
  // a lista de Campanhas Ativas (aba Postar) possa exibi-las separadas ou ocultá-las
  const automationIds = new Set<string>();
  {
    const { data: autoRows } = await (admin as any)
      .from("automations")
      .select("id")
      .eq("user_id", user.id);
    for (const r of (autoRows ?? []) as { id: string }[]) automationIds.add(r.id);
  }

  // Campanhas do Postar sincronizadas com pasta(s) de contas — contas novas
  // entram sozinhas via cron sync-distribute-accounts.
  const syncedFolderNames = new Map<string, string[]>();
  {
    const { data: syncRows } = await (admin as any)
      .from("distribute_campaigns")
      .select("id, account_folder_ids")
      .eq("user_id", user.id);
    if (syncRows?.length) {
      const allFolderIds = Array.from(new Set(
        (syncRows as { id: string; account_folder_ids: string[] }[]).flatMap(r => r.account_folder_ids ?? [])
      ));
      let folderNameById = new Map<string, string>();
      if (allFolderIds.length) {
        const { data: folderRows } = await (admin as any)
          .from("account_folders")
          .select("id, name")
          .in("id", allFolderIds);
        folderNameById = new Map((folderRows ?? []).map((f: { id: string; name: string }) => [f.id, f.name]));
      }
      for (const r of syncRows as { id: string; account_folder_ids: string[] }[]) {
        syncedFolderNames.set(r.id, (r.account_folder_ids ?? []).map(fid => folderNameById.get(fid) ?? "?"));
      }
    }
  }

  let campaigns: CampaignSummary[] = ((data as RpcRow[]) ?? []).map(row => ({
    ...row,
    total: Number(row.total),
    published: Number(row.published),
    pending: Number(row.pending),
    failed: Number(row.failed),
    cancelled: Number(row.cancelled),
    account_ids: row.account_ids ?? [],
    campaign_status: (Number(row.pending) > 0 ? "running" : "completed") as "running" | "completed",
    is_automation: automationIds.has(row.campaign_id),
    is_synced: syncedFolderNames.has(row.campaign_id),
    synced_folder_names: syncedFolderNames.get(row.campaign_id) ?? [],
  })).sort((a, b) => {
    if (a.campaign_status !== b.campaign_status) {
      return a.campaign_status === "running" ? -1 : 1;
    }
    return new Date(b.first_slot ?? b.last_slot ?? 0).getTime() - new Date(a.first_slot ?? a.last_slot ?? 0).getTime();
  });

  // Filtra por post_type se solicitado — consulta quais campaign_ids têm o tipo indicado
  if (postTypeFilter && campaigns.length > 0) {
    const campaignIds = campaigns.map(c => c.campaign_id);
    const { data: typedRows } = await (admin as any)
      .from("scheduled_posts")
      .select("campaign_id")
      .eq("user_id", user.id)
      .eq("post_type", postTypeFilter)
      .in("campaign_id", campaignIds)
      .limit(campaignIds.length * 2);
    const storyIds = new Set<string>((typedRows ?? []).map((r: { campaign_id: string }) => r.campaign_id));
    campaigns = campaigns.filter(c => storyIds.has(c.campaign_id));
  }

  return NextResponse.json({ campaigns });
}

export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("id");
  const hardDelete = searchParams.get("hard") === "true";

  if (!campaignId) {
    return NextResponse.json({ error: "Parâmetro id obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  if (hardDelete) {
    // Remove todas as linhas da campanha do banco (excluir histórico)
    const { error } = await (admin as any)
      .from("scheduled_posts")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // Apenas cancela os posts pendentes (cancelar campanha ativa)
    const { error } = await (admin as any)
      .from("scheduled_posts")
      .update({ status: "cancelled" })
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .in("status", ["pending", "publishing"]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Cancelar ou excluir a campanha encerra a sincronização com pasta — contas
  // novas adicionadas depois não devem mais ser matriculadas automaticamente.
  await (admin as any)
    .from("distribute_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}
