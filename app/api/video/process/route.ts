import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import { downloadOriginalMedia } from "@/lib/media-ingest";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

// ── Configuração de runtime ───────────────────────────────────
// Next.js precisa do runtime Node.js para usar FFmpeg e fs
export const runtime = "nodejs";

// Timeout estendido (necessário para vídeos grandes)
// Vercel Free: máx 10s | Pro: máx 300s
// Para produção com vídeos longos, considere uma fila (ex: Inngest, Trigger.dev)
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────
// POST /api/video/process
//
// Body esperado:
// {
//   videoUrl: string        ← URL do vídeo retornado pelo Apify
//   filename?: string       ← Nome base do arquivo (opcional)
//   reelData?: {            ← Metadados para salvar no banco
//     caption: string
//     views: number
//     likes: number
//     comments: number
//     duration: number
//     owner: string
//   }
// }
//
// INGESTÃO SEM ALTERAÇÃO (2026-09-06): salva o arquivo ORIGINAL, byte a byte.
// Nenhum FFmpeg roda aqui. A limpeza de metadados é opt-in na configuração da
// publicação (video_processing_mode) e gera uma VARIANTE separada.
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { videoUrl, filename, reelData } = body as {
    videoUrl: string;
    filename?: string;
    reelData?: {
      caption: string;
      views: number;
      likes: number;
      comments: number;
      duration: number;
      owner: string;
    };
  };

  if (!videoUrl) {
    return NextResponse.json(
      { error: "O campo 'videoUrl' é obrigatório." },
      { status: 400 }
    );
  }

  // ── Modo de desenvolvimento sem Supabase configurado ─────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    // Simula o processamento para testes locais
    await new Promise((r) => setTimeout(r, 1500));
    return NextResponse.json({
      success: true,
      publicUrl: videoUrl,
      record: {
        id: `mock_${Date.now()}`,
        filename: filename ?? "video_mock.mp4",
        public_url: videoUrl,
        created_at: new Date().toISOString(),
        ...reelData,
      },
      message: "Modo mock — configure NEXT_PUBLIC_SUPABASE_URL para upload real",
    });
  }

  // Obtém o usuário autenticado via cookies da sessão
  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  const userId = user.id;

  try {
    // 1. Baixa os bytes ORIGINAIS (sem transformação)
    const fileBuffer = await downloadOriginalMedia(videoUrl);

    // 2. Gera nome do arquivo no Storage
    const timestamp = Date.now();
    const baseName = filename
      ? filename.replace(/[^a-z0-9_-]/gi, "_")
      : `reel_${timestamp}`;
    const storagePath = `videos/${baseName}_${timestamp}.mp4`;

    // 3. Sobe os MESMOS bytes para o Supabase Storage
    const { error: uploadError } = await getSupabaseAdmin().storage
      .from("videos-library")
      .upload(storagePath, fileBuffer, {
        contentType: "video/mp4",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Storage upload: ${uploadError.message}`);
    }

    // 4. Busca a URL pública
    const { data: urlData } = getSupabaseAdmin().storage
      .from("videos-library")
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;

    // 5. Salva registro na tabela videos_library
    const { data: record, error: dbError } = await getSupabaseAdmin()
      .from("videos_library")
      .insert({
        user_id: userId,
        filename: path.basename(storagePath),
        original_url: videoUrl,
        storage_path: storagePath,
        public_url: publicUrl,
        file_size: fileBuffer.byteLength,
        owner_username: reelData?.owner ?? null,
        caption: reelData?.caption ?? null,
        views: reelData?.views ?? 0,
        likes: reelData?.likes ?? 0,
        comments: reelData?.comments ?? 0,
        duration: reelData?.duration ?? 0,
      })
      .select()
      .single();

    if (dbError) {
      throw new Error(`Database insert: ${dbError.message}`);
    }

    return NextResponse.json({ success: true, publicUrl, record });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
