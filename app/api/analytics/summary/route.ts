import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/video-history";

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

  // Os cards somam TODOS os posts publicados; a lista segue com os 100 mais
  // recentes. Antes os totais eram só desses 100 (e "Publicados" travava em 100).
  type TotRow = Pick<PostRow, "insights_likes" | "insights_comments" | "insights_reach" | "insights_plays" | "insights_shares" | "insights_saved">;
  let all: TotRow[] = rows;
  try {
    all = await fetchAllRows<TotRow>((from, to) =>
      supabase
        .from("scheduled_posts")
        .select("insights_likes, insights_comments, insights_reach, insights_plays, insights_shares, insights_saved")
        .eq("user_id", user.id)
        .eq("status", "published")
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: TotRow[] | null; error: { message: string } | null }>
    );
  } catch (e) {
    console.error("[analytics/summary] totais falharam:", (e as Error).message);
  }

  const totalLikes = all.reduce((s, p) => s + (p.insights_likes ?? 0), 0);
  const totalComments = all.reduce((s, p) => s + (p.insights_comments ?? 0), 0);
  const totalReach = all.reduce((s, p) => s + (p.insights_reach ?? 0), 0);
  const totalPlays = all.reduce((s, p) => s + (p.insights_plays ?? 0), 0);
  const totalShares = all.reduce((s, p) => s + (p.insights_shares ?? 0), 0);
  const totalSaved = all.reduce((s, p) => s + (p.insights_saved ?? 0), 0);

  return NextResponse.json({
    summary: {
      total_published: all.length,
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
