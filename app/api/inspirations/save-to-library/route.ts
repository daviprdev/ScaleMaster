import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { sanitizeAndHashBust } from "@/utils/videoSanitizer";

export const runtime = "nodejs";

// 300 s on Vercel Pro; Hobby is capped at 60 s regardless of this setting.
// Each video takes ~5–15 s (download + FFmpeg stream-copy + Storage upload).
// Frontend sends batches of 3, so worst-case is ~45 s per request — safe on both plans.
export const maxDuration = 300;

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
//
// Full sanitization pipeline per reel:
//   1. Download video buffer from CDN URL
//   2. FFmpeg: strip ALL metadata (-map_metadata -1)          ← Level 1
//   3. FFmpeg: inject UUID comment for unique file hash        ← Level 2 (Hash Busting)
//   4. Upload sanitized buffer to Supabase Storage
//   5. Insert record in videos_library with real storage_path
//
// Processed sequentially to avoid parallel FFmpeg processes hitting the timeout.
export async function POST(req: NextRequest) {
  const body = await req.json() as { reels: ReelPayload[] };
  const reels = Array.isArray(body.reels) ? body.reels : [];

  if (reels.length === 0) {
    return NextResponse.json({ error: "Lista de reels vazia." }, { status: 400 });
  }

  // Mock mode — no Supabase configured
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

  // Filter reels with no usable video URL before processing
  const valid = reels.filter(r =>
    r.videoUrl && r.videoUrl.trim() !== "" && r.videoUrl !== "undefined"
  );
  errors += reels.length - valid.length;

  // Process one reel at a time — sequential to respect serverless memory/timeout limits
  for (const reel of valid) {
    let cleanup: (() => void) | null = null;
    try {
      const baseName = `reel_${reel.owner || "unknown"}_${(reel.shortCode || reel.id).replace(/[^a-z0-9_-]/gi, "_")}`;

      // ── Download → Strip metadata → Hash bust ────────────────
      const result = await sanitizeAndHashBust(reel.videoUrl, baseName);
      cleanup = result.cleanup;

      // ── Upload sanitized file to Supabase Storage ─────────────
      const fileBuffer = fs.readFileSync(result.outputPath);
      const { error: uploadError } = await admin.storage
        .from("videos-library")
        .upload(result.storagePath, fileBuffer, {
          contentType: "video/mp4",
          upsert: false,
        });

      if (uploadError) throw new Error(`Storage: ${uploadError.message}`);

      // ── Get public URL ────────────────────────────────────────
      const { data: urlData } = admin.storage
        .from("videos-library")
        .getPublicUrl(result.storagePath);

      // ── Insert DB record ──────────────────────────────────────
      const { data, error: dbError } = await admin
        .from("videos_library")
        .insert({
          user_id: user.id,
          filename: result.storagePath.split("/").pop()!,
          original_url: reel.videoUrl,
          storage_path: result.storagePath,
          public_url: urlData.publicUrl,
          file_size: result.fileSize,
          owner_username: reel.owner || null,
          caption: (reel.caption || "").slice(0, 500) || null,
          views: Number(reel.views) || 0,
          likes: Number(reel.likes) || 0,
          comments: Number(reel.comments) || 0,
          duration: Number(reel.duration) || 0,
        } as never)
        .select("id, filename, public_url, owner_username, created_at")
        .single();

      if (dbError) throw new Error(`DB: ${dbError.message}`);

      savedRecords.push(data);
    } catch (err) {
      console.error(
        `[save-to-library] reel ${reel.shortCode || reel.id}:`,
        err instanceof Error ? err.message : err
      );
      errors++;
    } finally {
      cleanup?.();
    }
  }

  return NextResponse.json({
    saved: savedRecords.length,
    errors,
    records: savedRecords,
  });
}
