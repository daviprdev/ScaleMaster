import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET - Setup completo: cria tabela + políticas RLS + verifica bucket
// Chamar uma vez: /api/onboarding/media/setup-complete
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({
      error: "Variáveis de ambiente do Supabase não configuradas",
      debug: { hasUrl: !!supabaseUrl, hasKey: !!serviceKey },
      instructions: "Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel."
    }, { status: 503 });
  }

  const admin = getSupabaseAdmin();
  const results: Record<string, { status: string; message?: string; [key: string]: unknown }> = {};

  try {
    // 1. Verifica se o bucket existe
    const { data: buckets, error: listError } = await admin.storage.listBuckets();
    if (listError) {
      results.bucket = { status: "error", message: listError.message };
    } else {
      const bucketExists = buckets?.some(b => b.id === "onboarding-media");
      results.bucket = {
        status: bucketExists ? "exists" : "missing",
        message: bucketExists ? "Bucket onboarding-media existe." : "Bucket onboarding-media NÃO existe. Crie em Storage → New Bucket (nome: onboarding-media, público)."
      };
    }

    // 2. Tenta criar a tabela via SQL (usando rpc ou query direta)
    // Nota: Supabase não permite CREATE TABLE via client JS diretamente,
    // então vamos verificar se a tabela existe tentando um SELECT
    const { data: testRow, error: tableError } = await admin
      .from("onboarding_media_library")
      .select("id")
      .limit(1);

    if (tableError && tableError.message.includes("does not exist")) {
      results.table = {
        status: "missing",
        message: "Tabela onboarding_media_library NÃO existe.",
        sqlToRun: `
-- Execute este SQL no Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS onboarding_media_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('profile_photo', 'story_media')),
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_media_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_select_own" ON onboarding_media_library
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "media_insert_own" ON onboarding_media_library
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "media_delete_own" ON onboarding_media_library
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_media_user_category
  ON onboarding_media_library(user_id, category, created_at DESC);

-- Após executar, vá em Settings → API → Reload Schema (ou aguarde 1 min)
        `
      };
    } else if (tableError) {
      results.table = { status: "error", message: tableError.message };
    } else {
      results.table = { status: "exists", message: "Tabela onboarding_media_library existe.", rowCount: testRow?.length ?? 0 };
    }

    // 3. Verifica se há políticas de Storage configuradas (não dá para verificar via API, retorna instruções)
    results.storagePolicies = {
      status: "needs_manual_check",
      message: "Verifique manualmente se as 3 políticas de Storage existem (INSERT, SELECT, DELETE) para o bucket onboarding-media.",
      instructions: [
        "1. Acesse Supabase Dashboard → Storage → Policies",
        "2. Selecione o bucket 'onboarding-media'",
        "3. Verifique se existem estas 3 políticas:",
        "",
        "Policy 1 - media_storage_upload (INSERT):",
        "  Roles: authenticated",
        "  WITH CHECK: bucket_id = 'onboarding-media' AND auth.uid()::text = (storage.foldername(name))[1]",
        "",
        "Policy 2 - media_storage_read (SELECT):",
        "  Roles: authenticated, anon",
        "  USING: bucket_id = 'onboarding-media'",
        "",
        "Policy 3 - media_storage_delete (DELETE):",
        "  Roles: authenticated",
        "  USING: bucket_id = 'onboarding-media' AND auth.uid()::text = (storage.foldername(name))[1]"
      ]
    };

    // 4. Resumo final
    const allGood = results.bucket.status === "exists" && results.table.status === "exists";

    return NextResponse.json({
      success: allGood,
      message: allGood
        ? "Tudo configurado! Tente fazer o upload novamente."
        : "Alguns itens precisam de configuração manual. Veja os detalhes abaixo.",
      results,
      nextSteps: allGood
        ? ["Volte para /dashboard/onboarding e tente fazer o upload."]
        : [
            "1. Se a tabela não existe: execute o SQL acima no Supabase SQL Editor",
            "2. Se o bucket não existe: crie em Storage → New Bucket (nome: onboarding-media, público)",
            "3. Configure as 3 políticas de Storage (INSERT, SELECT, DELETE)",
            "4. Após criar a tabela, vá em Settings → API → Reload Schema",
            "5. Tente fazer o upload novamente"
          ]
    });

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Erro desconhecido";
    console.error("[setup-complete] Exceção:", e);
    return NextResponse.json({
      error: errorMsg,
      instructions: "Verifique os logs da Vercel para mais detalhes."
    }, { status: 500 });
  }
}