import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET - Cria o bucket onboarding-media se não existir
// Chamar uma vez após o deploy: /api/onboarding/media/setup
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const BUCKET = "onboarding-media";

  try {
    // Tenta criar o bucket (idempotente - não falha se já existir)
    const { error } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 104857600, // 100 MB
      allowedMimeTypes: [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "video/mp4",
        "video/quicktime",
      ],
    });

    if (error && !error.message.includes("already exists")) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: error?.message.includes("already exists")
        ? "Bucket já existia."
        : "Bucket criado com sucesso!",
      bucket: BUCKET,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro desconhecido" },
      { status: 500 }
    );
  }
}