import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET ?jobId= — acompanha um job de raspagem via conta leitora.
// Quando done, os reels são lidos de scraped_profiles (o cron gravou lá, na
// MESMA tabela que a Apify usa) — assim o grid e o "Salvar na Biblioteca"
// funcionam sem qualquer mudança.
export async function GET(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId obrigatório" }, { status: 400 });

  // RLS: SELECT só das próprias linhas.
  const { data: job, error: jobErr } = await supabase
    .from("scrape_jobs")
    .select("id, status, target_username, error_message, result_count")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Job não encontrado." }, { status: 404 });

  if (job.status === "error") {
    return NextResponse.json({
      status: "error",
      error: job.error_message || "Falha na raspagem via conta leitora.",
    });
  }

  if (job.status === "done") {
    const { data: profile } = await supabase
      .from("scraped_profiles")
      .select("videos_data, video_count")
      .eq("user_id", user.id)
      .eq("username", job.target_username)
      .maybeSingle();

    const reels = (profile?.videos_data ?? []) as unknown[];
    if (reels.length === 0) {
      return NextResponse.json({
        status: "error",
        error: `Nenhum Reel encontrado para @${job.target_username} via conta leitora.`,
      });
    }
    return NextResponse.json({ status: "done", reels });
  }

  // queued | processing
  return NextResponse.json({ status: "running" });
}
