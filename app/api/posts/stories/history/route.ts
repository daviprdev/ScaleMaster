import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HistoryRow {
  id: string;
  account_id: string | null;
  video_url: string | null;
  status: string;
  media_id: string | null;
  error_message: string | null;
  scheduled_at: string;
  created_at: string | null;
  instagram_accounts: { username: string; avatar_url: string | null } | null;
}

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ items: [], published: 0, queued: 0 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("scheduled_posts")
    .select("id, account_id, video_url, status, media_id, error_message, scheduled_at, created_at, instagram_accounts(username, avatar_url)")
    .eq("user_id", user.id)
    .eq("post_type", "story")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []) as unknown as HistoryRow[];
  const published = items.filter((i) => i.status === "published").length;
  const queued = items.filter((i) => i.status === "pending" || i.status === "publishing").length;

  return NextResponse.json({ items, published, queued });
}

export async function DELETE(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const all = searchParams.get("all") === "true";

  if (all) {
    const { error } = await admin
      .from("scheduled_posts")
      .delete()
      .eq("user_id", user.id)
      .eq("post_type", "story");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (!id) return NextResponse.json({ error: "Informe id ou all=true." }, { status: 400 });

  const { error } = await admin
    .from("scheduled_posts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("post_type", "story");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
