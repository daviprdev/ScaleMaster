import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ReelPayload {
  id: string;
  shortCode: string;
  videoUrl: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  owner: string;
}

// POST /api/inspirations/save-to-library
// Body: { reels: ReelPayload[] }
// Saves reel metadata directly to videos_library in batches of 5.
// No FFmpeg processing — uses the Apify video URL as public_url directly.
export async function POST(req: NextRequest) {
  const body = await req.json() as { reels: ReelPayload[] };
  const reels = Array.isArray(body.reels) ? body.reels : [];

  if (reels.length === 0) {
    return NextResponse.json({ error: "Lista de reels vazia." }, { status: 400 });
  }

  // Mock mode (no Supabase configured)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ saved: reels.length, errors: 0, records: [] });
  }

  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const savedRecords: unknown[] = [];
  let errors = 0;

  // Filter out reels with no usable video URL
  const valid = reels.filter(r =>
    r.videoUrl && r.videoUrl !== "" && r.videoUrl !== "undefined"
  );
  const skipped = reels.length - valid.length;
  errors += skipped;

  // Process in batches of 5 to avoid hitting DB row limits per request
  const BATCH = 5;
  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);

    const rows = batch.map(reel => ({
      user_id: user.id,
      filename: `reel_${reel.owner}_${(reel.shortCode || reel.id).replace(/[^a-z0-9_-]/gi, "_")}.mp4`,
      original_url: reel.videoUrl,
      // Uses the Apify CDN URL directly — no Storage upload needed
      storage_path: `direct/${reel.shortCode || reel.id}`,
      public_url: reel.videoUrl,
      file_size: 0,
      owner_username: reel.owner || null,
      caption: (reel.caption || "").slice(0, 500) || null,
      views: Number(reel.views) || 0,
      likes: Number(reel.likes) || 0,
      comments: Number(reel.comments) || 0,
      duration: Number(reel.duration) || 0,
    }));

    const { data, error } = await admin
      .from("videos_library")
      .insert(rows as never)
      .select("id, filename, public_url, owner_username, created_at");

    if (error) {
      console.error(`[save-to-library] batch ${i / BATCH + 1} insert failed:`, error.message, error.details);
      errors += batch.length;
    } else {
      savedRecords.push(...(data ?? []));
    }
  }

  return NextResponse.json({
    saved: savedRecords.length,
    errors,
    records: savedRecords,
  });
}
