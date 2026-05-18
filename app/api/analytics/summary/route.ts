import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PostRow {
  id: string;
  status: string;
  published_at: string | null;
  media_id: string | null;
  caption: string | null;
  video_url: string | null;
  insights_likes: number | null;
  insights_comments: number | null;
  insights_reach: number | null;
  insights_plays: number | null;
  insights_shares: number | null;
  insights_saved: number | null;
  insights_fetched_at: string | null;
  instagram_accounts: { username: string; display_name: string | null; avatar_url: string | null } | null;
  videos_library: { filename: string; public_url: string } | null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select(
      "id, status, published_at, media_id, caption, video_url, " +
      "insights_likes, insights_comments, insights_reach, insights_plays, " +
      "insights_shares, insights_saved, insights_fetched_at, " +
      "instagram_accounts(username, display_name, avatar_url), " +
      "videos_library(filename, public_url)"
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(100);

  // Cast to typed rows — new columns not yet in generated Supabase types
  const rows = (posts ?? []) as unknown as PostRow[];

  const totalLikes = rows.reduce((s, p) => s + (p.insights_likes ?? 0), 0);
  const totalComments = rows.reduce((s, p) => s + (p.insights_comments ?? 0), 0);
  const totalReach = rows.reduce((s, p) => s + (p.insights_reach ?? 0), 0);
  const totalPlays = rows.reduce((s, p) => s + (p.insights_plays ?? 0), 0);
  const totalShares = rows.reduce((s, p) => s + (p.insights_shares ?? 0), 0);
  const totalSaved = rows.reduce((s, p) => s + (p.insights_saved ?? 0), 0);

  return NextResponse.json({
    summary: {
      total_published: rows.length,
      total_likes: totalLikes,
      total_comments: totalComments,
      total_reach: totalReach,
      total_plays: totalPlays,
      total_shares: totalShares,
      total_saved: totalSaved,
    },
    posts: rows,
  });
}
