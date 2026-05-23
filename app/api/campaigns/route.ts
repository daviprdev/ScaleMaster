import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostRow {
  campaign_id: string;
  status: string;
  scheduled_at: string;
  account_id: string;
  created_at: string;
}

interface CampaignSummary {
  campaign_id: string;
  total: number;
  published: number;
  pending: number;
  failed: number;
  cancelled: number;
  first_slot: string;
  last_slot: string;
  next_pending: string | null;
  account_ids: string[];
  campaign_status: "running" | "completed";
  created_at: string;
}

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ campaigns: [] });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  const { data, error } = await (admin as any)
    .from("scheduled_posts")
    .select("campaign_id, status, scheduled_at, account_id, created_at")
    .eq("user_id", user.id)
    .not("campaign_id", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    // If campaign_id column doesn't exist yet, return empty
    if (error.code === "42703" || error.message?.includes("campaign_id")) {
      return NextResponse.json({ campaigns: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by campaign_id in JS
  const campaignsMap = new Map<string, CampaignSummary>();

  for (const post of (data as PostRow[])) {
    if (!post.campaign_id) continue;

    if (!campaignsMap.has(post.campaign_id)) {
      campaignsMap.set(post.campaign_id, {
        campaign_id: post.campaign_id,
        total: 0,
        published: 0,
        pending: 0,
        failed: 0,
        cancelled: 0,
        first_slot: post.scheduled_at,
        last_slot: post.scheduled_at,
        next_pending: null,
        account_ids: [],
        campaign_status: "completed",
        created_at: post.created_at,
      });
    }

    const campaign = campaignsMap.get(post.campaign_id)!;
    campaign.total++;

    if (post.status === "published") campaign.published++;
    else if (post.status === "pending" || post.status === "publishing") campaign.pending++;
    else if (post.status === "failed") campaign.failed++;
    else if (post.status === "cancelled") campaign.cancelled++;

    // Track date range
    if (post.scheduled_at < campaign.first_slot) campaign.first_slot = post.scheduled_at;
    if (post.scheduled_at > campaign.last_slot) campaign.last_slot = post.scheduled_at;

    // Track next pending slot
    if (post.status === "pending" || post.status === "publishing") {
      if (!campaign.next_pending || post.scheduled_at < campaign.next_pending) {
        campaign.next_pending = post.scheduled_at;
      }
    }

    // Track unique accounts
    if (!campaign.account_ids.includes(post.account_id)) {
      campaign.account_ids.push(post.account_id);
    }
  }

  // Compute status and sort: running first, then by created_at desc
  const campaigns = Array.from(campaignsMap.values())
    .map(c => ({ ...c, campaign_status: (c.pending > 0 ? "running" : "completed") as "running" | "completed" }))
    .sort((a, b) => {
      if (a.campaign_status !== b.campaign_status) {
        return a.campaign_status === "running" ? -1 : 1;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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

  // Cancel all pending/publishing posts for this campaign
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
