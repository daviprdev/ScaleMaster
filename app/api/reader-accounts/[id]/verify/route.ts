import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — enfileira um job de VERIFICAÇÃO da conta leitora. O job raspa o
// próprio perfil da conta (target = username dela, limit pequeno): isso força o
// login via instagrapi, estabelece/renova a sessão salva e confirma que a
// conta funciona — sem poluir o histórico das Inspirações (o cron pula o
// upsert em scraped_profiles quando verify=true).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // RLS garante que só vem conta do próprio usuário.
  const { data: reader, error: readerErr } = await supabase
    .from("reader_accounts")
    .select("id, username, proxy_url")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readerErr) return NextResponse.json({ error: readerErr.message }, { status: 500 });
  if (!reader) return NextResponse.json({ error: "Conta leitora não encontrada." }, { status: 404 });

  if (!reader.proxy_url) {
    return NextResponse.json(
      { error: "Configure um proxy dedicado para esta conta antes de conectar." },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();

  // Evita enfileirar duas verificações simultâneas da mesma conta.
  const { data: pending } = await admin
    .from("scrape_jobs")
    .select("id")
    .eq("reader_account_id", reader.id)
    .eq("verify", true)
    .in("status", ["queued", "processing"])
    .limit(1);

  if (pending?.length) {
    return NextResponse.json({ ok: true, alreadyQueued: true });
  }

  const { error: jobErr } = await admin.from("scrape_jobs").insert({
    user_id: user.id,
    reader_account_id: reader.id,
    target_username: reader.username,
    limit_items: 1,
    verify: true,
    status: "queued",
    retry_after: new Date().toISOString(),
  });

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
