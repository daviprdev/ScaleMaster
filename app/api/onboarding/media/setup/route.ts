import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET - Cria o bucket onboarding-media se não existir
// Chamar uma vez após o deploy: /api/onboarding/media/setup
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    return NextResponse.json({
      error: "NEXT_PUBLIC_SUPABASE_URL não configurado",
      debug: { hasUrl: false, hasKey: !!serviceKey }
    }, { status: 503 });
  }

  if (!serviceKey) {
    return NextResponse.json({
      error: "SUPABASE_SERVICE_ROLE_KEY não configurado na Vercel",
      instructions: "Adicione a variável SUPABASE_SERVICE_ROLE_KEY nas Environment Variables da Vercel (Settings → Environment Variables). O valor está em Supabase Dashboard → Settings → API → service_role key.",
      debug: { hasUrl: true, hasKey: false }
    }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const BUCKET = "onboarding-media";

  try {
    // Primeiro, verifica se o bucket já existe
    const { data: buckets, error: listError } = await admin.storage.listBuckets();

    if (listError) {
      console.error("[setup] Erro ao listar buckets:", listError);
      return NextResponse.json({
        error: `Falha ao acessar Storage: ${listError.message}`,
        instructions: "Verifique se a SUPABASE_SERVICE_ROLE_KEY está correta e tem permissões de admin.",
        debug: { listError: listError.message }
      }, { status: 500 });
    }

    const bucketExists = buckets?.some(b => b.id === BUCKET);

    if (bucketExists) {
      return NextResponse.json({
        success: true,
        message: "Bucket já existe!",
        bucket: BUCKET,
        debug: { bucketsCount: buckets?.length }
      });
    }

    // Tenta criar o bucket
    const { error: createError } = await admin.storage.createBucket(BUCKET, {
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

    if (createError) {
      console.error("[setup] Erro ao criar bucket:", createError);
      return NextResponse.json({
        error: `Falha ao criar bucket: ${createError.message}`,
        instructions: "Crie o bucket manualmente no Supabase Dashboard → Storage → New Bucket. Nome: onboarding-media, marque 'Public bucket'.",
        manualSteps: [
          "1. Acesse https://supabase.com/dashboard/project/_/storage/buckets",
          "2. Clique em 'New Bucket'",
          "3. Nome: onboarding-media",
          "4. Marque 'Public bucket'",
          "5. Clique em 'Create bucket'"
        ],
        debug: { createError: createError.message }
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Bucket criado com sucesso!",
      bucket: BUCKET,
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Erro desconhecido";
    console.error("[setup] Exceção:", e);
    return NextResponse.json(
      {
        error: errorMsg,
        instructions: "Crie o bucket manualmente no Supabase Dashboard → Storage → New Bucket. Nome: onboarding-media, marque 'Public bucket'.",
        debug: { exception: errorMsg }
      },
      { status: 500 }
    );
  }
}