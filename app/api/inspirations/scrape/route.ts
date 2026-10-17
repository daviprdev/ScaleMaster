import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeUsername } from "@/lib/inspiration-scrape";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST — inicia a busca de um perfil via ScrapeCreators e REGISTRA a busca no
// banco. A finalização (paginação completa + salvar no histórico) é feita pelo
// polling da página OU pelo cron finalize-inspiration-scrapes.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  // Precisa de uma fonte: HikerAPI (principal) ou ScrapeCreators (reserva).
  if (!process.env.HIKERAPI_KEY?.trim() && !process.env.SCRAPECREATORS_API_KEY?.trim()) {
    return NextResponse.json({
      error: "Nenhuma fonte configurada (HIKERAPI_KEY ou SCRAPECREATORS_API_KEY). Adicione a variável de ambiente e faça um novo deploy.",
    }, { status: 503 });
  }

  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const username = normalizeUsername(body.username ?? "");

  if (!username) {
    return NextResponse.json({ error: "O campo 'username' é obrigatório." }, { status: 400 });
  }
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return NextResponse.json({ error: "Username do Instagram inválido." }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as any;

  // Já existe busca rodando desse perfil? Reaproveita.
  const { data: existing } = await admin
    .from("inspiration_scrape_searches")
    .select("id, run_ids, limit_items")
    .eq("user_id", user.id)
    .eq("username", username)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log(`[scrape] @${username} — reaproveitando busca em andamento ${existing.id}`);
    return NextResponse.json({ searchId: existing.id, resumed: true });
  }

  // Cria registro de busca. O estado de paginação é guardado em run_ids:
  // run_ids[0] = cursor (max_id), run_ids[1] = páginas processadas, run_ids[2] = reels acumulados.
  const { data: search, error: insertErr } = await admin
    .from("inspiration_scrape_searches")
    .insert({
      user_id: user.id,
      username,
      run_ids: ["", "0", "0"], // estado inicial: sem cursor, 0 páginas, 0 reels
      fallback_run_ids: [],
      limit_items: 0, // 0 = sem limite (pagina até o fim)
      status: "running",
    })
    .select("id")
    .single();

  if (insertErr || !search) {
    console.error(`[scrape] @${username} — FALHA ao registrar busca (${insertErr?.message})`);
    return NextResponse.json(
      { error: "Falha ao registrar a busca. Tente novamente." },
      { status: 500 }
    );
  }

  console.log(`[scrape] @${username} — busca ${search.id} iniciada via ScrapeCreators`);
  return NextResponse.json({ searchId: search.id });
}