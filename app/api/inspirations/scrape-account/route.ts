import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — enfileira uma raspagem de perfil via conta LEITORA dedicada
// (fonte alternativa à Apify na aba Inspirações). Retorna { jobId }; o
// frontend acompanha via /api/inspirations/scrape-account/poll.
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let body: { readerAccountId?: string; targetUsername?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const readerAccountId = body.readerAccountId?.trim();
  // Username do Instagram é case-insensitive: normaliza para minúsculas para
  // que "Perfil" e "perfil" caiam na MESMA linha de scraped_profiles
  // (unique user_id+username) em vez de duplicar o histórico.
  const targetUsername = body.targetUsername?.trim().replace(/^@/, "").toLowerCase();
  const limit = Math.min(Math.max(Number(body.limit) || 120, 1), 300);

  if (!readerAccountId) {
    return NextResponse.json({ error: "Selecione uma conta leitora." }, { status: 400 });
  }
  if (!targetUsername) {
    return NextResponse.json({ error: "Informe o perfil-alvo." }, { status: 400 });
  }
  if (!/^[a-z0-9._]{1,30}$/.test(targetUsername)) {
    return NextResponse.json({ error: "Username do Instagram inválido." }, { status: 400 });
  }

  // Ownership + pré-condições (RLS garante que só vem conta do próprio usuário).
  const { data: reader, error: readerErr } = await supabase
    .from("reader_accounts")
    .select("id, proxy_url, status")
    .eq("id", readerAccountId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readerErr) return NextResponse.json({ error: readerErr.message }, { status: 500 });
  if (!reader) return NextResponse.json({ error: "Conta leitora não encontrada." }, { status: 404 });
  if (!reader.proxy_url) {
    return NextResponse.json(
      { error: "Esta conta leitora não tem proxy dedicado configurado." },
      { status: 400 }
    );
  }
  if (reader.status === "error") {
    return NextResponse.json(
      { error: "Esta conta leitora está com erro. Reconecte-a em Contas Leitoras antes de usar." },
      { status: 409 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: job, error: jobErr } = await admin
    .from("scrape_jobs")
    .insert({
      user_id: user.id,
      reader_account_id: reader.id,
      target_username: targetUsername,
      limit_items: limit,
      verify: false,
      status: "queued",
      retry_after: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? "Falha ao enfileirar." }, { status: 500 });
  }

  return NextResponse.json({ jobId: job.id });
}
