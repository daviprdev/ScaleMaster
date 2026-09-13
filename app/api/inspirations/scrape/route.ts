import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { APIFY_ACTOR, actorInput, normalizeUsername } from "@/lib/inspiration-scrape";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST — inicia a busca de um perfil e REGISTRA a busca no banco antes de
// responder. A finalização (salvar no histórico) é do servidor: o polling da
// página ou, se o usuário sair, o cron finalize-inspiration-scrapes.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: { username?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const username = normalizeUsername(body.username ?? "");
  const limit = Math.min(Math.max(Number(body.limit) || 500, 1), 2000);

  if (!username) {
    return NextResponse.json({ error: "O campo 'username' é obrigatório." }, { status: 400 });
  }
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return NextResponse.json({ error: "Username do Instagram inválido." }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as any;

  // Já existe busca rodando desse perfil? Reaproveita — não paga de novo.
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
    return NextResponse.json({ searchId: existing.id, runIds: existing.run_ids, limit: existing.limit_items, resumed: true });
  }

  const tokens = resolveApifyTokens();
  if (tokens.length === 0) {
    return NextResponse.json({
      error: "APIFY_API_TOKEN não configurado. Adicione a variável de ambiente e faça um novo deploy.",
    }, { status: 503 });
  }

  // Um run por token em paralelo — IPs diferentes; resultados deduplicados ao final.
  const url = `https://www.instagram.com/${username}/reels/`;
  const starts = await Promise.allSettled(
    tokens.map(async (token) => {
      const client = new ApifyClient({ token });
      const run = await client.actor(APIFY_ACTOR).start(actorInput(url, limit));
      return run.id;
    })
  );

  const runIds = starts
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);

  if (runIds.length === 0) {
    const firstErr = starts.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    const msg = firstErr?.reason instanceof Error ? firstErr.reason.message : "Erro ao iniciar busca.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: search, error: insertErr } = await admin
    .from("inspiration_scrape_searches")
    .insert({ user_id: user.id, username, run_ids: runIds, limit_items: limit, status: "running" })
    .select("id")
    .single();

  if (insertErr || !search) {
    // Runs já foram iniciados (e pagos). Loga os ids para recuperação manual
    // via /api/inspirations/scrape/recover, que importa runs órfãos da Apify.
    console.error(`[scrape] @${username} — FALHA ao registrar busca (${insertErr?.message}); runs: ${runIds.join(",")}`);
    return NextResponse.json(
      { error: "A busca foi iniciada, mas não consegui registrá-la. Use \"Recuperar buscas\" em alguns minutos." },
      { status: 500 }
    );
  }

  console.log(`[scrape] @${username} — busca ${search.id}, ${runIds.length}/${tokens.length} runs: ${runIds.join(",")}`);
  return NextResponse.json({ searchId: search.id, runIds, limit });
}
