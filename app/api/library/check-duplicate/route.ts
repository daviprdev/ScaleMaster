import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ exists: false });
  }

  const filename = req.nextUrl.searchParams.get("filename");
  const fileSize = parseInt(req.nextUrl.searchParams.get("fileSize") ?? "0", 10);

  if (!filename) return NextResponse.json({ exists: false });

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ exists: false });

  const { data } = await getSupabaseAdmin()
    .from("videos_library")
    .select("id, filename")
    .eq("user_id", user.id)
    .eq("filename", filename)
    .eq("file_size", fileSize)
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ exists: !!data, video: data ?? null });
}
