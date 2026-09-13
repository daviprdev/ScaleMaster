/**
 * POST /api/inspirations/scrape/recover
 *
 * Importa para o histórico de Inspirações buscas que TERMINARAM na Apify mas
 * nunca foram salvas (ex.: buscas feitas antes de a busca ser durável, quando
 * sair da página perdia o resultado). Não inicia nenhum run novo — só lê
 * datasets que já foram pagos. A Apify guarda datasets de runs por ~7 dias.
 *
 * ADMIN ONLY: os tokens da Apify são do SaaS (compartilhados), e um run não
 * guarda qual usuário o iniciou — importar para um usuário comum poderia
 * entregar a ele a busca de outro. Também aceita CRON_SECRET + ?userId= para
 * execução operacional.
 *
 * Regras:
 *   - só runs do actor instagram-scraper, SUCCEEDED, das últimas `hours` (máx 168);
 *   - ignora runs já registrados em inspiration_scrape_searches;
 *   - agrupa por perfil (runs paralelos da mesma busca), dedup por shortCode;
 *   - não sobrescreve histórico mais novo que o run.
 */

import { NextRequest, NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hasValidCronSecret } from "@/lib/cron-auth";
import { resolveApifyTokens } from "@/lib/apify-token-pool";
import { APIFY_ACTOR, listAllItems, normalizeUsername, processItems, saveToHistory } from "@/lib/inspiration-scrape";

export const runtime = "nodejs";
export const maxDuration = 300;

interface OrphanRun {
  runId: string;
  client: ApifyClient;
  datasetId: string;
  finishedAt: string;
  username: string;
}

function usernameFromUrl(url: string): string | null {
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  if (!m) return null;
  const u = normalizeUsername(m[1]);
  if (["reel", "reels", "p", "explore", "stories"].includes(u)) return null;
  return /^[a-z0-9._]{1,30}$/.test(u) ? u : null;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const admin = getSupabaseAdmin() as any;

  // ── Autorização: admin logado OU CRON_SECRET + userId ─────────────────────
  let userId: string | null = null;
  if (hasValidCronSecret(req.headers.get("authorization"))) {
    userId = url.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "userId obrigatório com CRON_SECRET." }, { status: 400 });
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (role?.role !== "admin") {
      return NextResponse.json({ error: "Apenas administradores podem recuperar buscas." }, { status: 403 });
    }
    userId = user.id;
  }

  const hours = Math.min(Math.max(Number(url.searchParams.get("hours")) || 96, 1), 168);
  const since = Date.now() - hours * 60 * 60 * 1000;
  const tokens = resolveApifyTokens();
  if (!tokens.length) return NextResponse.json({ error: "Nenhum token da Apify configurado." }, { status: 503 });

  // Runs já conhecidos pelo sistema novo não são "órfãos".
  const { data: known } = await admin
    .from("inspiration_scrape_searches")
    .select("run_ids, fallback_run_ids")
    .gte("created_at", new Date(since - 60 * 60 * 1000).toISOString());
  const knownRunIds = new Set<string>(
    ((known ?? []) as { run_ids: string[]; fallback_run_ids: string[] }[]).flatMap((k) => [...k.run_ids, ...k.fallback_run_ids])
  );

  // ── Varre os runs recentes de cada token ───────────────────────────────────
  const orphans: OrphanRun[] = [];
  const tokenErrors: string[] = [];
  for (const token of tokens) {
    const client = new ApifyClient({ token });
    try {
      const { items } = await client.actor(APIFY_ACTOR).runs().list({ desc: true, limit: 100 });
      for (const run of items) {
        const startedAt = new Date(run.startedAt).getTime();
        if (startedAt < since) break; // lista em ordem decrescente
        if (run.status !== "SUCCEEDED" || knownRunIds.has(run.id)) continue;
        let username: string | null = null;
        try {
          const rec = await client.keyValueStore(run.defaultKeyValueStoreId).getRecord("INPUT");
          const input = (rec?.value ?? {}) as { directUrls?: string[] };
          username = usernameFromUrl(input.directUrls?.[0] ?? "");
        } catch { /* INPUT indisponível */ }
        if (!username) continue;
        orphans.push({
          runId: run.id,
          client,
          datasetId: run.defaultDatasetId,
          finishedAt: new Date(run.finishedAt ?? run.startedAt).toISOString(),
          username,
        });
      }
    } catch (err) {
      tokenErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Agrupa por perfil e importa ────────────────────────────────────────────
  const byUser = new Map<string, OrphanRun[]>();
  for (const o of orphans) byUser.set(o.username, [...(byUser.get(o.username) ?? []), o]);

  const imported: { username: string; reels: number }[] = [];
  const skipped: { username: string; reason: string }[] = [];

  for (const [username, runs] of byUser) {
    const latestFinish = runs.map((r) => r.finishedAt).sort().at(-1)!;

    const { data: existing } = await admin
      .from("scraped_profiles")
      .select("scraped_at, video_count")
      .eq("user_id", userId)
      .eq("username", username)
      .maybeSingle();
    if (existing && existing.scraped_at >= latestFinish) {
      skipped.push({ username, reason: "histórico já está atualizado" });
      continue;
    }

    try {
      const seen = new Set<string>();
      const items: unknown[] = [];
      for (const r of runs) {
        for (const item of await listAllItems(r.client, r.datasetId)) {
          const sc = String((item as Record<string, unknown>).shortCode ?? "");
          if (sc && seen.has(sc)) continue;
          if (sc) seen.add(sc);
          items.push(item);
        }
      }
      const reels = processItems(items, username);
      if (reels.length === 0) {
        skipped.push({ username, reason: "runs sem vídeos" });
        continue;
      }
      // Nunca troca um histórico maior por um menor.
      if (existing && (existing.video_count ?? 0) > reels.length) {
        skipped.push({ username, reason: `histórico atual tem mais vídeos (${existing.video_count})` });
        continue;
      }
      await saveToHistory(admin, userId!, username, reels, items);
      imported.push({ username, reels: reels.length });
      console.log(`[scrape/recover] @${username}: ${reels.length} reels importados de ${runs.length} run(s)`);
    } catch (err) {
      skipped.push({ username, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    hours,
    runs_found: orphans.length,
    imported,
    skipped,
    token_errors: tokenErrors.length,
  });
}
