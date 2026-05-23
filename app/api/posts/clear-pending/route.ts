import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Hard-reset: removes all pending/publishing scheduled_posts and orphaned
// pending_containers for the authenticated user.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = getSupabaseAdmin() as any;

  const [postsRes, containersRes] = await Promise.all([
    admin
      .from("scheduled_posts")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .in("status", ["pending", "publishing"]),

    admin
      .from("pending_containers")
      .delete({ count: "exact" })
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"]),
  ]);

  if (postsRes.error) {
    console.error("[clear-pending] scheduled_posts error:", postsRes.error);
    return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deleted: {
      scheduled_posts: postsRes.count ?? 0,
      pending_containers: containersRes.count ?? 0,
    },
  });
}
