import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { downloadOriginalMedia, buildLibraryStoragePath } from "@/lib/media-ingest";

export const runtime = "nodejs";

// 300 s on Vercel Pro; Hobby is capped at 60 s regardless of this setting.
// Each video takes ~3–10 s (download + Storage upload — sem FFmpeg).
// Frontend sends batches of 3, so worst-case is ~30 s per request — safe on both plans.
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
// INGESTÃO SEM ALTERAÇÃO (2026-09-06): o arquivo salvo na Biblioteca é o
// ORIGINAL baixado da fonte, byte a byte. Não roda FFmpeg, não remove
// metadados/SEI, não injeta creation_time, não re-encoda.
//   1. Download dos bytes originais do CDN
//   2. Upload dos MESMOS bytes para o Supabase Storage
//   3. Insert em videos_library apontando para o original
//
// A limpeza de metadados existe, mas só na CONFIGURAÇÃO DA PUBLICAÇÃO
// (video_processing_mode = "clean_metadata"), gerando uma VARIANTE separada
// — ver lib/video-processing.ts. O original permanece imutável.
//
// Processed sequentially to avoid parallel downloads hitting the timeout.
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
    try {
      const baseName = `reel_${reel.owner || "unknown"}_${(reel.shortCode || reel.id).replace(/[^a-z0-9_-]/gi, "_")}`;

      // ── Download dos bytes ORIGINAIS (zero transformação) ─────────
      const fileBuffer = await downloadOriginalMedia(reel.videoUrl);
      const storagePath = buildLibraryStoragePath(baseName, randomUUID());
      console.log(
        `[save-to-library] original ${(fileBuffer.byteLength / 1_048_576).toFixed(1)} MB → ${storagePath}`
      );

      // ── Upload dos MESMOS bytes para o Supabase Storage ──────────
      const { error: uploadError } = await admin.storage
        .from("videos-library")
        .upload(storagePath, fileBuffer, {
          contentType: "video/mp4",
          upsert: false,
        });

      if (uploadError) throw new Error(`Storage: ${uploadError.message}`);

      // ── Get public URL ────────────────────────────────────────
      const { data: urlData } = admin.storage
        .from("videos-library")
        .getPublicUrl(storagePath);

      // ── Insert DB record ──────────────────────────────────────
      const { data, error: dbError } = await admin
        .from("videos_library")
        .insert({
          user_id: user.id,
          filename: storagePath.split("/").pop()!,
          original_url: reel.videoUrl,
          storage_path: storagePath,
          public_url: urlData.publicUrl,
          file_size: fileBuffer.byteLength,
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
    }
  }

  return NextResponse.json({
    saved: savedRecords.length,
    errors,
    records: savedRecords,
  });
}
