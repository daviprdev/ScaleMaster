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
}

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ campaigns: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

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

  const campaigns: CampaignSummary[] = ((data as RpcRow[]) ?? []).map(row => ({
    ...row,
    total: Number(row.total),
    published: Number(row.published),
    pending: Number(row.pending),
    failed: Number(row.failed),
    cancelled: Number(row.cancelled),
    account_ids: row.account_ids ?? [],
    campaign_status: (Number(row.pending) > 0 ? "running" : "completed") as "running" | "completed",
  })).sort((a, b) => {
    if (a.campaign_status !== b.campaign_status) {
      return a.campaign_status === "running" ? -1 : 1;
    }
    return new Date(b.first_slot ?? b.last_slot ?? 0).getTime() - new Date(a.first_slot ?? a.last_slot ?? 0).getTime();
  });

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

  if (!campaignId) {
    return NextResponse.json({ error: "Parâmetro id obrigatório." }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  const { error } = await (admin as any)
    .from("scheduled_posts")
    .update({ status: "cancelled" })
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .in("status", ["pending", "publishing"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
